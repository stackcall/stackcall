use crate::{
    audio::RATE,
    cli::Codec,
    media::{self, Frame, check},
    replay::{Audio, Clip},
};
use anyhow::{Context, Result, ensure};
use ffmpeg_sys_next::*;
use std::{
    ffi::CString,
    path::{Path, PathBuf},
    ptr::{self, NonNull},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const VIDEO_TIME: AVRational = AVRational {
    num: 1,
    den: 1_000_000,
};
const AUDIO_TIME: AVRational = AVRational {
    num: 1,
    den: RATE as i32,
};

pub struct Saved {
    pub path: PathBuf,
    pub seconds: f64,
    pub bytes: u64,
}

pub fn save(directory: &Path, clip: Clip) -> Result<Saved> {
    std::fs::create_dir_all(directory)?;
    let clock = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let path = directory.join(format!("Stackcall-{clock}-{}.mp4", std::process::id()));
    let pending = path.with_extension("part");
    let result = (|| {
        let seconds = write(&pending, clip)?;
        let bytes = std::fs::metadata(&pending)?.len();
        std::fs::rename(&pending, &path)?;
        Ok(Saved {
            path,
            seconds,
            bytes,
        })
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(pending);
    }
    result
}

struct Mux(NonNull<AVFormatContext>, NonNull<AVPacket>);

impl Mux {
    fn new(path: &Path) -> Result<Self> {
        let path = CString::new(path.to_str().context("Caminho de vídeo inválido")?)?;
        unsafe {
            let mut context = ptr::null_mut();
            check(media::avformat_alloc_output_context2(
                &mut context,
                ptr::null(),
                c"mp4".as_ptr(),
                path.as_ptr(),
            ))?;
            let context = NonNull::new(context).context("FFmpeg não criou o MP4")?;
            let Some(packet) = NonNull::new(media::av_packet_alloc()) else {
                media::avformat_free_context(context.as_ptr());
                anyhow::bail!("FFmpeg não alocou o pacote do MP4");
            };
            let mux = Self(context, packet);
            check(media::avio_open(
                &mut (*mux.0.as_ptr()).pb,
                path.as_ptr(),
                AVIO_FLAG_WRITE,
            ))?;
            Ok(mux)
        }
    }

    fn stream(
        &self,
        name: &std::ffi::CStr,
        time: AVRational,
        default: bool,
    ) -> Result<NonNull<AVStream>> {
        unsafe {
            let mut stream = NonNull::new(media::avformat_new_stream(self.0.as_ptr(), ptr::null()))
                .context("FFmpeg não criou faixa do MP4")?;
            let value = stream.as_mut();
            value.time_base = time;
            if default {
                value.disposition = AV_DISPOSITION_DEFAULT;
            }
            check(media::av_dict_set(
                &mut value.metadata,
                c"handler_name".as_ptr(),
                name.as_ptr(),
                0,
            ))?;
            Ok(stream)
        }
    }

    fn packet(&self, stream: NonNull<AVStream>, time: AVRational) -> Result<()> {
        unsafe {
            let packet = self.1.as_ptr();
            let stream = stream.as_ref();
            (*packet).stream_index = stream.index;
            (*packet).pts = media::av_rescale_q((*packet).pts, time, stream.time_base);
            (*packet).dts = media::av_rescale_q((*packet).dts, time, stream.time_base);
            (*packet).duration = media::av_rescale_q((*packet).duration, time, stream.time_base);
            check(media::av_interleaved_write_frame(self.0.as_ptr(), packet))
        }
    }
}

impl Drop for Mux {
    fn drop(&mut self) {
        unsafe {
            media::av_packet_free(&mut self.1.as_ptr());
            let context = self.0.as_ptr();
            if !(*context).pb.is_null() {
                let _ = media::avio_closep(&mut (*context).pb);
            }
            media::avformat_free_context(context);
        }
    }
}

struct AvcHeaders(NonNull<AVBSFContext>);

impl AvcHeaders {
    fn new() -> Result<Self> {
        unsafe {
            let mut context = ptr::null_mut();
            check(media::av_bsf_list_parse_str(
                c"filter_units=remove_types=7|8".as_ptr(),
                &mut context,
            ))?;
            let filter = Self(NonNull::new(context).context("FFmpeg não criou o filtro H.264")?);
            (*(*context).par_in).codec_type = AVMediaType::AVMEDIA_TYPE_VIDEO;
            (*(*context).par_in).codec_id = AVCodecID::AV_CODEC_ID_H264;
            (*context).time_base_in = VIDEO_TIME;
            check(media::av_bsf_init(context))?;
            Ok(filter)
        }
    }

    fn process(&mut self, packet: NonNull<AVPacket>, changed: Option<&[u8]>) -> Result<()> {
        unsafe {
            check(media::av_bsf_send_packet(self.0.as_ptr(), packet.as_ptr()))?;
            check(media::av_bsf_receive_packet(
                self.0.as_ptr(),
                packet.as_ptr(),
            ))?;
            if let Some(headers) = changed {
                // MOV uses new extradata to switch avc1 sample descriptions.
                let side = media::av_packet_new_side_data(
                    packet.as_ptr(),
                    AVPacketSideDataType::AV_PKT_DATA_NEW_EXTRADATA,
                    headers.len(),
                );
                ensure!(!side.is_null(), "FFmpeg não alocou os parâmetros H.264");
                ptr::copy_nonoverlapping(headers.as_ptr(), side, headers.len());
            }
        }
        Ok(())
    }
}

impl Drop for AvcHeaders {
    fn drop(&mut self) {
        unsafe { media::av_bsf_free(&mut self.0.as_ptr()) };
    }
}

struct Aac {
    encoder: NonNull<AVCodecContext>,
    frame: Frame,
    stream: NonNull<AVStream>,
    size: usize,
}

impl Aac {
    fn new(mux: &Mux, name: &std::ffi::CStr, default: bool) -> Result<Self> {
        let stream = mux.stream(name, AUDIO_TIME, default)?;
        let frame = Frame::empty()?;
        unsafe {
            let codec = media::avcodec_find_encoder_by_name(c"aac".as_ptr());
            ensure!(!codec.is_null(), "O FFmpeg não oferece o codificador AAC");
            let encoder = NonNull::new(media::avcodec_alloc_context3(codec))
                .context("FFmpeg não alocou o codificador AAC")?;
            let mut aac = Self {
                encoder,
                frame,
                stream,
                size: 0,
            };
            let context = aac.encoder.as_mut();
            context.sample_rate = RATE as i32;
            context.time_base = AUDIO_TIME;
            context.sample_fmt = AVSampleFormat::AV_SAMPLE_FMT_FLTP;
            context.bit_rate = 128_000;
            context.flags |= AV_CODEC_FLAG_GLOBAL_HEADER as i32;
            media::av_channel_layout_default(&mut context.ch_layout, 2);
            check(media::avcodec_open2(context, codec, ptr::null_mut()))?;
            check(media::avcodec_parameters_from_context(
                stream.as_ref().codecpar,
                context,
            ))?;
            ensure!(
                context.frame_size > 0,
                "O codificador AAC informou um bloco inválido"
            );
            aac.size = context.frame_size as usize;
            let frame = aac.frame.raw_mut();
            frame.nb_samples = context.frame_size;
            frame.format = context.sample_fmt as i32;
            frame.sample_rate = context.sample_rate;
            media::av_channel_layout_default(&mut frame.ch_layout, 2);
            check(media::av_frame_get_buffer(frame, 0))?;
            Ok(aac)
        }
    }

    fn send(
        &mut self,
        mux: &Mux,
        pts: i64,
        sources: &[Vec<i16>; 3],
        include_game: bool,
    ) -> Result<()> {
        unsafe {
            let frame = self.frame.raw_mut();
            check(media::av_frame_make_writable(frame))?;
            frame.pts = pts;
            for (channel, plane) in frame.data.iter().copied().enumerate().take(2) {
                let dest = std::slice::from_raw_parts_mut(plane.cast::<f32>(), self.size);
                for (i, value) in dest.iter_mut().enumerate() {
                    let sample = i * 2 + channel;
                    let mixed: i32 = sources[usize::from(!include_game)..]
                        .iter()
                        .map(|track| i32::from(track[sample]))
                        .sum();
                    *value = mixed.clamp(-32_768, 32_767) as f32 / 32_768.0;
                }
            }
            check(media::avcodec_send_frame(self.encoder.as_ptr(), frame))?;
        }
        self.drain(mux)
    }

    fn drain(&mut self, mux: &Mux) -> Result<()> {
        loop {
            let ret =
                unsafe { media::avcodec_receive_packet(self.encoder.as_ptr(), mux.1.as_ptr()) };
            if ret == AVERROR_EOF || ret == AVERROR(libc::EAGAIN) {
                return Ok(());
            }
            check(ret)?;
            mux.packet(self.stream, AUDIO_TIME)?;
        }
    }

    fn finish(&mut self, mux: &Mux) -> Result<()> {
        check(unsafe { media::avcodec_send_frame(self.encoder.as_ptr(), ptr::null()) })?;
        self.drain(mux)
    }
}

impl Drop for Aac {
    fn drop(&mut self) {
        unsafe { media::avcodec_free_context(&mut self.encoder.as_ptr()) };
    }
}

fn write(path: &Path, mut clip: Clip) -> Result<f64> {
    let first = clip
        .video
        .first()
        .filter(|frame| frame.key)
        .context("Clipe sem quadro-chave")?;
    let start = first.at;
    let tail = 1_000_000 / i64::from(clip.format.fps);
    let duration = micros(
        clip.video
            .last()
            .unwrap()
            .at
            .saturating_duration_since(start),
    ) + tail;
    let mux = Mux::new(path)?;
    let video = mux.stream(c"Tela", VIDEO_TIME, true)?;
    let (codec, tag) = match clip.format.codec {
        Codec::H264 => (AVCodecID::AV_CODEC_ID_H264, *b"avc1"),
        Codec::Av1 => (AVCodecID::AV_CODEC_ID_AV1, *b"av01"),
    };
    let mut avc_headers = (codec == AVCodecID::AV_CODEC_ID_H264)
        .then(AvcHeaders::new)
        .transpose()
        .context("Não foi possível preparar os parâmetros H.264 do clipe")?;
    unsafe {
        let params = &mut *video.as_ref().codecpar;
        params.codec_type = AVMediaType::AVMEDIA_TYPE_VIDEO;
        // avc1 + avcC opens in the Windows player (avc3 did not); in-band SPS/PPS are stripped and
        // mid-clip changes go as new extradata (see AvcHeaders).
        params.codec_id = codec;
        params.codec_tag = u32::from_le_bytes(tag);
        params.width = clip.format.width as i32;
        params.height = clip.format.height as i32;
        let headers = &clip.headers;
        let extra =
            media::av_mallocz(headers.len() + AV_INPUT_BUFFER_PADDING_SIZE as usize).cast::<u8>();
        ensure!(
            !extra.is_null(),
            "O FFmpeg não alocou os cabeçalhos do vídeo"
        );
        ptr::copy_nonoverlapping(headers.as_ptr(), extra, headers.len());
        params.extradata = extra;
        params.extradata_size = headers.len().try_into()?;
    }
    let mut mix = Aac::new(&mux, c"Jogo e vozes", true)?;
    let mut voices = Aac::new(&mux, c"Vozes", false)?;
    ensure!(
        mix.size == voices.size,
        "Os codificadores AAC usam blocos diferentes"
    );
    check(unsafe { media::avformat_write_header(mux.0.as_ptr(), ptr::null_mut()) })?;

    clip.audio
        .iter_mut()
        .for_each(|track| track.sort_unstable_by_key(|chunk| chunk.at));
    let mut cursors = [0; 3];
    let mut samples: [Vec<i16>; 3] = std::array::from_fn(|_| vec![0; mix.size * 2]);
    let mut audio_pts = 0;
    let mut feed_audio = |until_us: i64| -> Result<()> {
        let until = until_us * i64::from(RATE) / 1_000_000;
        while audio_pts < until {
            for (i, track) in clip.audio.iter().enumerate() {
                audio_block(track, &mut cursors[i], start, audio_pts, &mut samples[i]);
            }
            mix.send(&mux, audio_pts, &samples, true)?;
            voices.send(&mux, audio_pts, &samples, false)?;
            audio_pts += mix.size as i64;
        }
        Ok(())
    };
    let mut last_pts = -1;
    let mut headers = clip.headers.as_ref();
    for (index, frame) in clip.video.iter().enumerate() {
        let pts = micros(frame.at.saturating_duration_since(start)).max(last_pts + 1);
        feed_audio(pts)?;
        let next = clip.video.get(index + 1).map_or(duration, |next| {
            micros(next.at.saturating_duration_since(start))
        });
        unsafe {
            let packet = mux.1.as_ptr();
            media::av_packet_unref(packet);
            check(media::av_new_packet(
                packet,
                frame.payload.data.len().try_into()?,
            ))?;
            ptr::copy_nonoverlapping(
                frame.payload.data.as_ptr(),
                (*packet).data,
                frame.payload.data.len(),
            );
            (*packet).pts = pts;
            (*packet).dts = pts;
            (*packet).duration = (next - pts).max(1);
            if frame.key {
                (*packet).flags |= AV_PKT_FLAG_KEY;
            }
        }
        if let Some(filter) = &mut avc_headers {
            let changed = frame.headers.as_deref().filter(|&next| next != headers);
            filter
                .process(mux.1, changed)
                .context("Não foi possível separar os parâmetros H.264 do clipe")?;
            headers = changed.unwrap_or(headers);
        }
        mux.packet(video, VIDEO_TIME)?;
        last_pts = pts;
    }
    feed_audio(duration)?;
    mix.finish(&mux)?;
    voices.finish(&mux)?;
    check(unsafe { media::av_write_trailer(mux.0.as_ptr()) })?;
    check(unsafe { media::avio_closep(&mut (*mux.0.as_ptr()).pb) })?;
    Ok(duration as f64 / 1_000_000.0)
}

fn micros(time: Duration) -> i64 {
    time.as_micros() as i64
}

fn audio_block(track: &[Audio], cursor: &mut usize, start: Instant, pts: i64, output: &mut [i16]) {
    output.fill(0);
    let end = pts + output.len() as i64 / 2;
    for chunk in &track[*cursor..] {
        let us = if chunk.at >= start {
            micros(chunk.at - start)
        } else {
            -micros(start - chunk.at)
        };
        let from = us * i64::from(RATE) / 1_000_000;
        let to = from + chunk.payload.data.len() as i64 / 2;
        if from >= end {
            break;
        }
        if to > pts {
            let first = from.max(pts);
            let last = to.min(end);
            let length = (last - first) as usize * 2;
            let input = (first - from) as usize * 2;
            let offset = (first - pts) as usize * 2;
            output[offset..offset + length]
                .copy_from_slice(&chunk.payload.data[input..input + length]);
        }
        if to <= end {
            *cursor += 1;
        }
    }
}
