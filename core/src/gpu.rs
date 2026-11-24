use crate::media::{
    Frame as AvFrame, av_buffer_ref, av_buffer_unref, av_hwdevice_ctx_alloc,
    av_hwdevice_ctx_create_derived, av_hwdevice_ctx_init, av_hwframe_ctx_alloc,
    av_hwframe_ctx_create_derived, av_hwframe_ctx_init, av_hwframe_get_buffer, av_hwframe_map,
    check,
};
use anyhow::{Context, Result, ensure};
use ffmpeg_sys_next::{
    AV_HWFRAME_MAP_READ, AVBufferRef, AVD3D11VADeviceContext, AVD3D11VAFramesContext,
    AVHWDeviceContext, AVHWDeviceType, AVHWFramesContext, AVPixelFormat,
};
use std::{mem::ManuallyDrop, ptr};
use windows::{
    Win32::{
        Foundation::RECT,
        Graphics::{Direct3D11::*, Dxgi::Common::DXGI_RATIONAL},
    },
    core::Interface,
};
use windows_capture::frame::Frame;

pub struct Frames {
    buffer: Buffer,
    format: AVPixelFormat,
}

impl Frames {
    pub fn format(&self) -> AVPixelFormat {
        self.format
    }

    pub unsafe fn reference(&self) -> Result<*mut AVBufferRef> {
        let owned = unsafe { av_buffer_ref(self.buffer.0) };
        ensure!(!owned.is_null(), "could not retain FFmpeg hardware context");
        Ok(owned)
    }

    fn pool(&self) -> *mut AVBufferRef {
        self.buffer.0
    }

    fn new(buffer: Buffer, format: AVPixelFormat) -> Self {
        Self { buffer, format }
    }
}

pub struct Converter {
    device: ID3D11VideoDevice,
    context: ID3D11VideoContext,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    d3d_pool: Frames,
    qsv_pool: Option<Frames>,
}

struct Buffer(*mut AVBufferRef);

// Each buffer owns one FFmpeg reference and the capture thread owns the pool.
unsafe impl Send for Buffer {}

impl Drop for Buffer {
    fn drop(&mut self) {
        unsafe { av_buffer_unref(&mut self.0) }
    }
}

impl Converter {
    pub fn output_pool(&self) -> &Frames {
        self.qsv_pool.as_ref().unwrap_or(&self.d3d_pool)
    }

    pub fn new(frame: &Frame, width: u32, height: u32, fps: u32, qsv: bool) -> Result<Self> {
        unsafe {
            let device: ID3D11VideoDevice = frame.device().cast()?;
            let context: ID3D11VideoContext = frame.device_context().cast()?;
            let rate = DXGI_RATIONAL {
                Numerator: fps,
                Denominator: 1,
            };
            let enumerator =
                device.CreateVideoProcessorEnumerator(&D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                    InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                    InputFrameRate: rate,
                    InputWidth: frame.width(),
                    InputHeight: frame.height(),
                    OutputFrameRate: rate,
                    OutputWidth: width,
                    OutputHeight: height,
                    Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
                })?;
            let processor = device.CreateVideoProcessor(&enumerator, 0)?;
            let rect = |w, h| RECT {
                left: 0,
                top: 0,
                right: w as i32,
                bottom: h as i32,
            };
            let input = rect(frame.width(), frame.height());
            let output = rect(width, height);
            context.VideoProcessorSetStreamSourceRect(&processor, 0, true, Some(&input));
            context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&output));
            context.VideoProcessorSetOutputTargetRect(&processor, true, Some(&output));
            context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);

            let hardware = Buffer(av_hwdevice_ctx_alloc(
                AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA,
            ));
            ensure!(
                !hardware.0.is_null(),
                "could not allocate FFmpeg D3D11 device"
            );
            let generic = (*hardware.0).data.cast::<AVHWDeviceContext>();
            let d3d = (*generic).hwctx.cast::<AVD3D11VADeviceContext>();
            // Transfer one COM reference to FFmpeg.
            (*d3d).device = frame.device().clone().into_raw().cast();
            check(av_hwdevice_ctx_init(hardware.0)).context("initializing shared D3D11 device")?;

            let pool = Buffer(av_hwframe_ctx_alloc(hardware.0));
            ensure!(!pool.0.is_null(), "could not allocate D3D11 frames pool");
            let config = (*pool.0).data.cast::<AVHWFramesContext>();
            (*config).format = AVPixelFormat::AV_PIX_FMT_D3D11;
            (*config).sw_format = AVPixelFormat::AV_PIX_FMT_NV12;
            (*config).width = width as i32;
            (*config).height = height as i32;
            if qsv {
                (*config).width = width.next_multiple_of(32) as i32;
                (*config).height = height.next_multiple_of(32) as i32;
                (*config).initial_pool_size = 16;
            }
            let d3d_frames = (*config).hwctx.cast::<AVD3D11VAFramesContext>();
            (*d3d_frames).BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
            check(av_hwframe_ctx_init(pool.0)).context("allocating NV12 textures")?;

            let qsv_pool = if qsv {
                let mut media = Buffer(ptr::null_mut());
                check(av_hwdevice_ctx_create_derived(
                    &mut media.0,
                    AVHWDeviceType::AV_HWDEVICE_TYPE_QSV,
                    hardware.0,
                    0,
                ))?;
                let mut mapped = Buffer(ptr::null_mut());
                check(av_hwframe_ctx_create_derived(
                    &mut mapped.0,
                    AVPixelFormat::AV_PIX_FMT_QSV,
                    media.0,
                    pool.0,
                    AV_HWFRAME_MAP_READ as i32,
                ))?;
                Some(Frames::new(mapped, AVPixelFormat::AV_PIX_FMT_QSV))
            } else {
                None
            };
            Ok(Self {
                device,
                context,
                enumerator,
                processor,
                d3d_pool: Frames::new(pool, AVPixelFormat::AV_PIX_FMT_D3D11),
                qsv_pool,
            })
        }
    }

    pub fn convert(&self, frame: &Frame) -> Result<AvFrame> {
        unsafe {
            let mut output = AvFrame::empty()?;
            check(av_hwframe_get_buffer(
                self.d3d_pool.pool(),
                output.as_mut_ptr(),
                0,
            ))?;
            let raw = &*output.as_ptr();
            let texture_ptr = raw.data[0].cast();
            let texture =
                ID3D11Texture2D::from_raw_borrowed(&texture_ptr).context("missing NV12 texture")?;
            let mut input_view = None;
            let mut output_view = None;
            self.device.CreateVideoProcessorInputView(
                frame.as_raw_texture(),
                &self.enumerator,
                &D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                    ..Default::default()
                },
                Some(&mut input_view),
            )?;
            let mut view = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                ..Default::default()
            };
            if self.qsv_pool.is_some() {
                view.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2DARRAY;
                view.Anonymous.Texture2DArray = D3D11_TEX2D_ARRAY_VPOV {
                    FirstArraySlice: raw.data[1] as u32,
                    ArraySize: 1,
                    MipSlice: 0,
                };
            }
            self.device.CreateVideoProcessorOutputView(
                texture,
                &self.enumerator,
                &view,
                Some(&mut output_view),
            )?;
            let output_view = output_view.context("missing D3D11 processor output view")?;
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                pInputSurface: ManuallyDrop::new(input_view),
                ..Default::default()
            };
            let result = self.context.VideoProcessorBlt(
                &self.processor,
                &output_view,
                0,
                std::slice::from_ref(&stream),
            );
            ManuallyDrop::drop(&mut stream.pInputSurface);
            result.context("converting WGC texture to NV12")?;

            if let Some(pool) = &self.qsv_pool {
                let mut mapped = AvFrame::empty()?;
                (*mapped.as_mut_ptr()).hw_frames_ctx = pool.reference()?;
                (*mapped.as_mut_ptr()).format = AVPixelFormat::AV_PIX_FMT_QSV as i32;
                check(av_hwframe_map(
                    mapped.as_mut_ptr(),
                    output.as_ptr(),
                    AV_HWFRAME_MAP_READ as i32,
                ))?;
                Ok(mapped)
            } else {
                Ok(output)
            }
        }
    }
}
