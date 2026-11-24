use crate::cli::{Codec, Encoder, Resolution, bits_per_second};
use crate::media::{self, Frame, Pixel, check};
use anyhow::{Context, Result};
use ffmpeg_sys_next::{
    AV_PKT_FLAG_KEY, AVCodecContext, AVDictionary, AVERROR, AVERROR_EOF, AVPacket, AVRational,
};
use std::{ffi::CString, ptr};

pub const CANDIDATES: [&str; 6] = [
    "h264_nvenc",
    "av1_nvenc",
    "h264_amf",
    "av1_amf",
    "h264_qsv",
    "av1_qsv",
];

pub fn candidates(codec: Codec, encoder: Encoder) -> impl Iterator<Item = &'static str> {
    let prefix = match codec {
        Codec::H264 => "h264_",
        Codec::Av1 => "av1_",
    };
    let suffix = match encoder {
        Encoder::Auto => "",
        Encoder::Nvenc => "nvenc",
        Encoder::Amf => "amf",
        Encoder::Qsv => "qsv",
    };
    CANDIDATES
        .into_iter()
        .filter(move |name| name.starts_with(prefix) && name.ends_with(suffix))
}

pub struct Session(*mut AVCodecContext);

// The capture thread owns the encoder and never accesses it concurrently.
unsafe impl Send for Session {}

impl Drop for Session {
    fn drop(&mut self) {
        unsafe { media::avcodec_free_context(&mut self.0) }
    }
}

impl Session {
    pub fn send_frame(&mut self, frame: &Frame) -> Result<()> {
        check(unsafe { media::avcodec_send_frame(self.0, frame.as_ptr()) })
    }

    pub fn send_eof(&mut self) -> Result<()> {
        check(unsafe { media::avcodec_send_frame(self.0, ptr::null()) })
    }
}

#[derive(Default)]
struct Options(*mut AVDictionary);

impl Options {
    fn set(&mut self, key: &str, value: &str) -> Result<()> {
        let key = CString::new(key)?;
        let value = CString::new(value)?;
        check(unsafe { media::av_dict_set(&mut self.0, key.as_ptr(), value.as_ptr(), 0) })
    }
}

impl Drop for Options {
    fn drop(&mut self) {
        unsafe { media::av_dict_free(&mut self.0) }
    }
}

pub fn open(
    name: &str,
    res: Resolution,
    fps: u32,
    kbps: u32,
    hardware: Option<&crate::gpu::Frames>,
) -> Result<Session> {
    let c_name = CString::new(name)?;
    let codec = unsafe { media::avcodec_find_encoder_by_name(c_name.as_ptr()) };
    anyhow::ensure!(!codec.is_null(), "FFmpeg encoder {name} is unavailable");
    let session = Session(unsafe { media::avcodec_alloc_context3(codec) });
    let video = unsafe { session.0.as_mut() }.context("could not allocate FFmpeg encoder")?;
    let (width, height) = res.dimensions();
    video.width = width as i32;
    video.height = height as i32;
    video.pix_fmt = hardware.map_or(Pixel::AV_PIX_FMT_NV12, |frames| frames.format());
    if let Some(frames) = hardware {
        video.hw_frames_ctx = unsafe { frames.reference()? };
    }
    video.time_base = AVRational {
        num: 1,
        den: 90_000,
    };
    video.framerate = AVRational {
        num: fps as i32,
        den: 1,
    };
    video.gop_size = (2 * fps) as i32;
    video.max_b_frames = 0;
    video.bit_rate = bits_per_second(kbps) as i64;
    let mut options = Options::default();
    if name.starts_with("h264") {
        let profile = if name.ends_with("_amf") {
            "constrained_baseline"
        } else {
            "baseline"
        };
        options.set("profile", profile)?;
    }
    let tuning: &[(&str, &str)] = if name.ends_with("nvenc") {
        &[
            ("preset", "p1"),
            ("tune", "ull"),
            ("zerolatency", "1"),
            ("forced-idr", "1"),
            ("delay", "0"),
        ]
    } else if name.ends_with("amf") {
        &[("usage", "ultralowlatency"), ("quality", "speed")]
    } else {
        &[
            ("async_depth", "1"),
            ("look_ahead", "0"),
            ("forced_idr", "1"),
        ]
    };
    for (key, value) in tuning {
        options.set(key, value)?;
    }
    check(unsafe { media::avcodec_open2(session.0, codec, &mut options.0) })
        .with_context(|| format!("opening {name}"))?;
    Ok(session)
}

pub struct Packet(*mut AVPacket);

impl Packet {
    pub fn pts(&self) -> Option<i64> {
        let pts = unsafe { (*self.0).pts };
        (pts != i64::MIN).then_some(pts)
    }

    pub fn data(&self) -> Option<&[u8]> {
        let packet = unsafe { &*self.0 };
        if packet.data.is_null() || packet.size <= 0 {
            return None;
        }
        Some(unsafe { std::slice::from_raw_parts(packet.data, packet.size as usize) })
    }

    pub fn is_key(&self) -> bool {
        unsafe { (*self.0).flags & AV_PKT_FLAG_KEY != 0 }
    }
}

impl Drop for Packet {
    fn drop(&mut self) {
        unsafe { media::av_packet_free(&mut self.0) }
    }
}

pub fn drain(encoder: &mut Session, mut consume: impl FnMut(&Packet) -> Result<()>) -> Result<()> {
    let packet = Packet(unsafe { media::av_packet_alloc() });
    anyhow::ensure!(!packet.0.is_null(), "could not allocate FFmpeg packet");
    loop {
        let status = unsafe { media::avcodec_receive_packet(encoder.0, packet.0) };
        if status == AVERROR_EOF || status == AVERROR(libc::EAGAIN) {
            return Ok(());
        }
        check(status)?;
        consume(&packet)?;
    }
}

pub fn percentiles(samples: &mut [f64]) -> (Option<f64>, Option<f64>) {
    samples.sort_unstable_by(f64::total_cmp);
    let at = |p: usize| {
        let rank = (samples.len() * p).div_ceil(100);
        rank.checked_sub(1).map(|index| samples[index])
    };
    (at(50), at(95))
}
