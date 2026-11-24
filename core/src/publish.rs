use crate::media::{self, Frame as AvFrame, Picture, Pixel};
use crate::{
    cli::{Codec, Publish, Source, bits_per_second},
    encoder, gpu,
};
use anyhow::{Context as _, Result, ensure};
use livekit::{
    options::{TrackPublishOptions, VideoCodec, VideoEncoderBackend, VideoEncoding},
    prelude::*,
    webrtc::{
        video_frame::{EncodedFrameType, EncodedVideoCodec, EncodedVideoFrame},
        video_source::{RtcVideoSource, VideoResolution, native::NativeVideoSource},
    },
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::*,
    window::Window,
};

type Control = CaptureControl<Capture, anyhow::Error>;

struct Setup {
    args: Publish,
    source: NativeVideoSource,
    stats: Arc<Mutex<Stats>>,
}

#[derive(Default)]
struct Stats {
    captured: u64,
    encoded: u64,
    dropped: u64,
    bytes: u64,
    latency: Vec<f64>,
    nvenc: bool,
}

struct Capture {
    setup: Setup,
    session: Option<Session>,
    first_timestamp: Option<i64>,
    last_key_request: Option<i64>,
    last_slot: Option<u128>,
    kbps: u32,
}

struct Session {
    name: &'static str,
    encoder: encoder::Session,
    gpu: Option<gpu::Converter>,
    input_size: (u32, u32),
    pending: BTreeMap<i64, (i64, Instant)>,
}

fn start_capture(setup: Setup) -> Result<Control> {
    fn start<T: TryInto<GraphicsCaptureItemType> + Send + 'static>(
        target: T,
        setup: Setup,
    ) -> Result<Control> {
        Capture::start_free_threaded(Settings::new(
            target,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            setup,
        ))
        .map_err(|err| anyhow::anyhow!("{err:?}"))
    }

    match &setup.args.source {
        Source::Monitor(index) => start(
            *Monitor::enumerate()?
                .get(*index)
                .context("monitor index out of range")?,
            setup,
        ),
        Source::Window(title) => start(Window::from_name(title)?, setup),
        Source::Pid(pid) => {
            let window = Window::enumerate()?
                .into_iter()
                .find(|window| window.process_id().ok() == Some(*pid))
                .context("no capturable window for this PID")?;
            start(window, setup)
        }
    }
}

pub async fn run(args: Publish) -> Result<()> {
    media::init()?;
    let (width, height) = args.res.dimensions();
    let (codec, source) = (
        match args.codec {
            Codec::H264 => VideoCodec::H264,
            Codec::Av1 => VideoCodec::AV1,
        },
        NativeVideoSource::new_encoded(VideoResolution { width, height }),
    );
    let duration = args.duration.map(Duration::from_secs);
    let audio_pid = args.audio_pid;
    let (room, mut events) = Room::connect(&args.url, &args.token, RoomOptions::default()).await?;
    let result = async {
        room.local_participant().publish_track(
            LocalTrack::Video(LocalVideoTrack::create_video_track("screen", RtcVideoSource::Native(source.clone()))),
            TrackPublishOptions {
                source: TrackSource::Screenshare,
                    stream: "screen".into(),
                video_codec: codec,
                video_encoder: VideoEncoderBackend::PreEncoded,
                video_encoding: Some(VideoEncoding { max_bitrate: bits_per_second(args.bitrate) as u64, max_framerate: f64::from(args.fps) }),
                simulcast: false,
                ..Default::default()
            },
        ).await?;
        let stats = Arc::new(Mutex::new(Stats::default()));
        let control = start_capture(Setup { args, source, stats: stats.clone() })?;
        let mut audio = crate::audio::Worker::default();
        let result = async {
            if let Some(pid) = audio_pid {
                audio.start(&room, pid).await?;
            }
            let start = Instant::now();
            let mut sample_start = start;
            let mut cpu_start = process_ticks();
            let nvml = nvml_wrapper::Nvml::init().ok();
            let logical_cpus = std::thread::available_parallelism().map_or(1, |count| count.get()) as f64;
            let mut timer = tokio::time::interval(Duration::from_millis(100));
            let signal = tokio::signal::ctrl_c();
            tokio::pin!(signal);
            loop {
                tokio::select! {
                    result = &mut signal => { result?; break; }
                    event = events.recv() => {
                        if matches!(event, None | Some(RoomEvent::Disconnected { .. })) {
                            anyhow::bail!("LiveKit room disconnected");
                        }
                    }
                    _ = timer.tick() => {
                        audio.check().await?;
                        if control.is_finished() || duration.is_some_and(|limit| start.elapsed() >= limit) { break; }
                        let elapsed = sample_start.elapsed().as_secs_f64();
                        if elapsed >= 5.0 {
                            let mut sample = {
                                let mut guard = stats.lock().unwrap();
                                let sample = std::mem::take(&mut *guard);
                                guard.nvenc = sample.nvenc;
                                sample
                            };
                            let (p50, p95) = encoder::percentiles(&mut sample.latency);
                            let gpu = nvml.as_ref().filter(|_| sample.nvenc)
                                .and_then(|nvml| nvml.device_by_index(0).ok())
                                .and_then(|device| device.encoder_utilization().ok())
                                .map(|utilization| utilization.utilization);
                            let cpu = process_ticks();
                            let cpu_percent = cpu.zip(cpu_start).map(|(now, last)| {
                                (now.saturating_sub(last) as f64 / 100_000.0) / (elapsed * logical_cpus)
                            });
                            println!("{}", serde_json::json!({
                                "captured_fps": sample.captured as f64 / elapsed,
                                "encoded_fps": sample.encoded as f64 / elapsed,
                                "dropped_frames": sample.dropped,
                                "encode_ms_p50": p50, "encode_ms_p95": p95,
                                "bitrate_kbps": sample.bytes as f64 * 0.008 / elapsed,
                                "cpu_percent": cpu_percent, "gpu_encoder_percent": gpu,
                            }));
                            cpu_start = cpu;
                            sample_start = Instant::now();
                        }
                    }
                }
            }
            Ok::<_, anyhow::Error>(())
        }.await;
        let capture_result = if control.is_finished() { control.wait() } else { control.stop() }
            .map_err(|err| anyhow::anyhow!("{err:?}"));
        let audio_result = audio.stop().await;
        result.and(capture_result).and(audio_result)
    }.await;
    let close = room.close().await;
    result?;
    close?;
    Ok(())
}

fn process_ticks() -> Option<u64> {
    use windows::Win32::{
        Foundation::FILETIME,
        System::Threading::{GetCurrentProcess, GetProcessTimes},
    };
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    }
    .ok()?;
    let ticks =
        |time: FILETIME| (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime);
    Some(ticks(kernel) + ticks(user))
}

impl GraphicsCaptureApiHandler for Capture {
    type Flags = Setup;
    type Error = anyhow::Error;

    fn new(ctx: Context<Setup>) -> Result<Self> {
        let kbps = ctx.flags.args.bitrate;
        Ok(Self {
            setup: ctx.flags,
            session: None,
            first_timestamp: None,
            last_key_request: None,
            last_slot: None,
            kbps,
        })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, _: InternalCaptureControl) -> Result<()> {
        let timestamp = frame.timestamp()?.Duration / 10;
        let elapsed_us = timestamp.saturating_sub(*self.first_timestamp.get_or_insert(timestamp));
        let args = &self.setup.args;
        let dimensions = (frame.width(), frame.height());
        let slot = (elapsed_us.max(0) as u128 * u128::from(args.fps) + 500_000) / 1_000_000;
        {
            let mut stats = self.setup.stats.lock().unwrap();
            stats.captured += 1;
            if let Some(last) = self.last_slot {
                if slot <= last {
                    return Ok(());
                }
                stats.dropped += (slot - last - 1) as u64;
            }
        }
        self.last_slot = Some(slot);
        let source = &self.setup.source;
        let requested = source
            .take_rate_control_request()
            .map(|rate| (rate.target_bitrate_bps / 1000).clamp(1, u64::from(args.bitrate)) as u32);
        let update =
            requested.filter(|requested| requested.abs_diff(self.kbps) >= (self.kbps / 10).max(1));
        let mut key = source.take_keyframe_request();
        if self
            .session
            .as_ref()
            .is_none_or(|session| session.input_size != dimensions)
            || update.is_some()
        {
            if let Some(mut old) = self.session.take() {
                old.encoder.send_eof()?;
                self.send_packets(&mut old)?;
            }
            self.kbps = update.unwrap_or(self.kbps);
            let mut errors = Vec::new();
            for name in encoder::candidates(args.codec, args.encoder) {
                let attempt = (|| {
                    let (w, h) = args.res.dimensions();
                    let gpu = if args.cpu_path {
                        None
                    } else {
                        Some(gpu::Converter::new(
                            frame,
                            w,
                            h,
                            args.fps,
                            name.ends_with("_qsv"),
                        )?)
                    };
                    let encoder = encoder::open(
                        name,
                        args.res,
                        args.fps,
                        self.kbps,
                        gpu.as_ref().map(gpu::Converter::output_pool),
                    )?;
                    Ok::<_, anyhow::Error>(Session {
                        name,
                        encoder,
                        gpu,
                        input_size: dimensions,
                        pending: BTreeMap::new(),
                    })
                })();
                match attempt {
                    Ok(session) => {
                        self.session = Some(session);
                        break;
                    }
                    Err(err) => errors.push(format!("{name}: {err:#}")),
                }
            }
            ensure!(
                self.session.is_some(),
                "no usable encoder: {}",
                errors.join("; ")
            );
            key = true;
        }
        let mut session = self.session.take().context("encoder session missing")?;
        let pts = timestamp;
        key |= self
            .last_key_request
            .is_none_or(|last| pts - last >= 2_000_000);
        if key {
            self.last_key_request = Some(pts);
        }
        let mut picture = match &mut session.gpu {
            Some(gpu) => gpu.convert(frame)?,
            None => cpu_convert(frame, args.res.dimensions())?,
        };
        let (width, height) = args.res.dimensions();
        picture.set_size(width, height);
        let encoder_pts = pts * 9 / 100;
        picture.raw_mut().pts = encoder_pts;
        picture.raw_mut().pict_type = if key {
            Picture::AV_PICTURE_TYPE_I
        } else {
            Picture::AV_PICTURE_TYPE_NONE
        };
        session.pending.insert(encoder_pts, (pts, Instant::now()));
        session.encoder.send_frame(&picture)?;
        self.send_packets(&mut session)?;
        self.session = Some(session);
        Ok(())
    }
}

impl Capture {
    fn send_packets(&self, session: &mut Session) -> Result<()> {
        let (width, height) = self.setup.args.res.dimensions();
        let codec = match self.setup.args.codec {
            Codec::H264 => EncodedVideoCodec::H264,
            Codec::Av1 => EncodedVideoCodec::AV1,
        };
        encoder::drain(&mut session.encoder, |packet| {
            let pts = packet.pts().context("encoded packet missing PTS")?;
            let payload = packet.data().context("encoded packet missing data")?;
            let (timestamp_us, started) = session
                .pending
                .remove(&pts)
                .context("unexpected encoded packet timestamp")?;
            let encode_ms = started.elapsed().as_secs_f64() * 1000.0;
            let accepted = self.setup.source.capture_encoded_frame(&EncodedVideoFrame {
                codec,
                payload,
                timestamp_us,
                resolution: VideoResolution { width, height },
                frame_metadata: None,
                frame_type: if packet.is_key() {
                    EncodedFrameType::Key
                } else {
                    EncodedFrameType::Delta
                },
            });
            ensure!(
                accepted,
                "LiveKit 0.12.0 rejected {codec:?} access unit in capture_encoded_frame"
            );
            let mut stats = self.setup.stats.lock().unwrap();
            stats.encoded += 1;
            stats.bytes += payload.len() as u64;
            stats.latency.push(encode_ms);
            stats.nvenc = session.name.ends_with("_nvenc");
            Ok(())
        })
    }
}

fn cpu_convert(frame: &mut Frame, (width, height): (u32, u32)) -> Result<AvFrame> {
    let (input_w, input_h) = (frame.width(), frame.height());
    let mut input = AvFrame::new(Pixel::AV_PIX_FMT_BGRA, input_w, input_h)?;
    let mut buffer = frame.buffer()?;
    let src_pitch = buffer.row_pitch() as usize;
    let dst_pitch = input.stride(0);
    let row_len = input_w as usize * 4;
    for (dst, src) in input
        .plane_mut(0, input_h as usize)
        .chunks_mut(dst_pitch)
        .zip(buffer.as_raw_buffer().chunks(src_pitch))
    {
        dst[..row_len].copy_from_slice(&src[..row_len]);
    }
    media::to_nv12(&input, width, height)
}
