use anyhow::{Result, ensure};
use ffmpeg_next::ffi::*;
use std::{
    ffi::{CStr, c_char, c_int},
    ptr::NonNull,
};

pub use ffmpeg_next::ffi::{AVPictureType as Picture, AVPixelFormat as Pixel};

use std::sync::OnceLock;
use windows::{
    Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW},
    core::{PCSTR, w},
};

// WebRTC embeds FFmpeg symbols of its own. Resolve each call in the LGPL DLL
// to keep the two ABIs separate even when their exported names are identical.
macro_rules! dll {
    ($module:ident, $dll:literal, { $(fn $name:ident($($arg:ident: $ty:ty),* $(,)?) $(-> $ret:ty)?;)* }) => {
        #[allow(non_snake_case)]
        mod $module {
            use super::*;

            struct Api {
                $($name: unsafe extern "C" fn($($ty),*) $(-> $ret)?,)*
            }

            static API: OnceLock<Api> = OnceLock::new();

            pub fn init() -> Result<()> {
                if API.get().is_some() {
                    return Ok(());
                }
                let library = unsafe { LoadLibraryW(w!($dll)) }
                    .map_err(|error| anyhow::anyhow!("loading {}: {error}", $dll))?;
                let api = Api {
                    $($name: {
                        let symbol = PCSTR(concat!(stringify!($name), "\0").as_ptr());
                        let address = unsafe { GetProcAddress(library, symbol) }
                            .ok_or_else(|| anyhow::anyhow!("{} has no {}", $dll, stringify!($name)))?;
                        unsafe {
                            std::mem::transmute::<
                                unsafe extern "system" fn() -> isize,
                                unsafe extern "C" fn($($ty),*) $(-> $ret)?,
                            >(address)
                        }
                    },)*
                };
                // Keep each DLL loaded for the lifetime of its function table.
                let _ = API.set(api);
                Ok(())
            }

            $(#[allow(clippy::too_many_arguments)] // Match the FFmpeg function signature.
            pub unsafe fn $name($($arg: $ty),*) $(-> $ret)? {
                unsafe { (API.get().expect("FFmpeg DLL initialized").$name)($($arg),*) }
            })*
        }
        pub use $module::{$($name),*};
    };
}

pub fn init() -> Result<()> {
    avcodec::init()?;
    avutil::init()?;
    swscale::init()
}
dll!(avcodec, "avcodec-63.dll", {
    fn avcodec_find_encoder_by_name(name: *const c_char) -> *const AVCodec;
    fn avcodec_alloc_context3(codec: *const AVCodec) -> *mut AVCodecContext;
    fn avcodec_free_context(ctx: *mut *mut AVCodecContext);
    fn avcodec_open2(
        ctx: *mut AVCodecContext,
        codec: *const AVCodec,
        options: *mut *mut AVDictionary,
    ) -> c_int;
    fn avcodec_send_frame(ctx: *mut AVCodecContext, frame: *const AVFrame) -> c_int;
    fn avcodec_receive_packet(ctx: *mut AVCodecContext, packet: *mut AVPacket) -> c_int;
    fn av_packet_alloc() -> *mut AVPacket;
    fn av_packet_free(packet: *mut *mut AVPacket);
});

dll!(avutil, "avutil-61.dll", {
    fn av_buffer_ref(buffer: *const AVBufferRef) -> *mut AVBufferRef;
    fn av_buffer_unref(buffer: *mut *mut AVBufferRef);
    fn av_dict_set(
        dict: *mut *mut AVDictionary,
        key: *const c_char,
        value: *const c_char,
        flags: c_int,
    ) -> c_int;
    fn av_dict_free(dict: *mut *mut AVDictionary);
    fn av_strerror(err: c_int, buffer: *mut c_char, size: usize) -> c_int;
    fn av_frame_alloc() -> *mut AVFrame;
    fn av_frame_free(frame: *mut *mut AVFrame);
    fn av_frame_get_buffer(frame: *mut AVFrame, align: c_int) -> c_int;
    fn av_hwdevice_ctx_alloc(kind: AVHWDeviceType) -> *mut AVBufferRef;
    fn av_hwdevice_ctx_init(device: *mut AVBufferRef) -> c_int;
    fn av_hwdevice_ctx_create_derived(
        out: *mut *mut AVBufferRef,
        kind: AVHWDeviceType,
        source: *mut AVBufferRef,
        flags: c_int,
    ) -> c_int;
    fn av_hwframe_ctx_alloc(device: *mut AVBufferRef) -> *mut AVBufferRef;
    fn av_hwframe_ctx_init(frames: *mut AVBufferRef) -> c_int;
    fn av_hwframe_ctx_create_derived(
        out: *mut *mut AVBufferRef,
        pixel: AVPixelFormat,
        device: *mut AVBufferRef,
        source: *mut AVBufferRef,
        flags: c_int,
    ) -> c_int;
    fn av_hwframe_get_buffer(ctx: *mut AVBufferRef, frame: *mut AVFrame, flags: c_int) -> c_int;
    fn av_hwframe_map(dest: *mut AVFrame, source: *const AVFrame, flags: c_int) -> c_int;
});

dll!(swscale, "swscale-10.dll", {
    fn sws_getContext(
        src_w: c_int,
        src_h: c_int,
        src_fmt: Pixel,
        dst_w: c_int,
        dst_h: c_int,
        dst_fmt: Pixel,
        flags: c_int,
        src_filter: *mut SwsFilter,
        dst_filter: *mut SwsFilter,
        param: *const f64,
    ) -> *mut SwsContext;
    fn sws_scale(
        ctx: *mut SwsContext,
        source: *const *const u8,
        source_stride: *const c_int,
        y: c_int,
        h: c_int,
        dest: *const *mut u8,
        dest_stride: *const c_int,
    ) -> c_int;
    fn sws_freeContext(ctx: *mut SwsContext);
});

pub fn check(code: i32) -> Result<()> {
    if code < 0 {
        let mut buffer = [0; 128];
        unsafe {
            av_strerror(code, buffer.as_mut_ptr(), buffer.len());
            anyhow::bail!(
                "{} ({code})",
                CStr::from_ptr(buffer.as_ptr()).to_string_lossy()
            );
        }
    }
    Ok(())
}

pub struct Frame(NonNull<AVFrame>);

impl Frame {
    pub fn empty() -> Result<Self> {
        Ok(Self(NonNull::new(unsafe { av_frame_alloc() }).ok_or_else(
            || anyhow::anyhow!("could not allocate AVFrame"),
        )?))
    }

    pub fn new(format: Pixel, width: u32, height: u32) -> Result<Self> {
        let mut frame = Self::empty()?;
        frame.raw_mut().format = format as i32;
        frame.set_size(width, height);
        check(unsafe { av_frame_get_buffer(frame.as_mut_ptr(), 32) })?;
        Ok(frame)
    }

    pub fn as_ptr(&self) -> *const AVFrame {
        self.0.as_ptr()
    }
    pub fn as_mut_ptr(&mut self) -> *mut AVFrame {
        self.0.as_ptr()
    }
    pub fn raw_mut(&mut self) -> &mut AVFrame {
        unsafe { self.0.as_mut() }
    }
    pub fn set_size(&mut self, width: u32, height: u32) {
        self.raw_mut().width = width as i32;
        self.raw_mut().height = height as i32;
    }
    pub fn stride(&self, plane: usize) -> usize {
        unsafe { (*self.as_ptr()).linesize[plane] as usize }
    }
    pub fn plane_mut(&mut self, plane: usize, rows: usize) -> &mut [u8] {
        let size = self.stride(plane) * rows;
        unsafe { std::slice::from_raw_parts_mut(self.raw_mut().data[plane], size) }
    }
}

impl Drop for Frame {
    fn drop(&mut self) {
        let mut ptr = self.as_mut_ptr();
        unsafe { av_frame_free(&mut ptr) };
    }
}

pub fn to_nv12(input: &Frame, width: u32, height: u32) -> Result<Frame> {
    let mut output = Frame::new(Pixel::AV_PIX_FMT_NV12, width, height)?;
    unsafe {
        let src = &*input.as_ptr();
        let dst = output.raw_mut();
        let scaler = sws_getContext(
            src.width,
            src.height,
            Pixel::AV_PIX_FMT_BGRA,
            dst.width,
            dst.height,
            Pixel::AV_PIX_FMT_NV12,
            SwsFlags::SWS_BILINEAR as i32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        ensure!(
            !scaler.is_null(),
            "could not initialize BGRA to NV12 conversion"
        );
        let rows = sws_scale(
            scaler,
            src.data.as_ptr().cast(),
            src.linesize.as_ptr(),
            0,
            src.height,
            dst.data.as_ptr(),
            dst.linesize.as_ptr(),
        );
        sws_freeContext(scaler);
        check(rows)?;
        ensure!(rows == height as i32, "FFmpeg converted only {rows} rows");
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_bgra_to_nv12_with_lgpl_dlls() -> Result<()> {
        init()?;
        let mut source = Frame::new(Pixel::AV_PIX_FMT_BGRA, 16, 16)?;
        source.plane_mut(0, 16).fill(0);
        let mut output = to_nv12(&source, 16, 16)?;
        assert_eq!(output.raw_mut().format, Pixel::AV_PIX_FMT_NV12 as i32);
        assert_eq!(output.plane_mut(0, 16)[0], 16);
        assert_eq!(output.plane_mut(1, 8)[0], 128);
        Ok(())
    }
}
