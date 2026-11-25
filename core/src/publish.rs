use crate::media::{self, Frame as AvFrame, Picture, Scaler};
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
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    io::{BufRead, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::{Duration, Instant},
};
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl},
    monitor::Monitor,
    settings::*,
    window::Window,
};

type Control = CaptureControl<Capture, anyhow::Error>;

#[derive(Clone)]
struct Setup {
    args: Publish,
    source: NativeVideoSource,
    stats: Arc<Mutex<Stats>>,
    requests: Arc<Requests>,
    tuning: encoder::Tuning,
}

#[derive(Default)]
struct Requests {
    kbps: AtomicU32,
    keyframe: AtomicBool,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Stop,
    Pause,
    Resume,
    Bitrate { kbps: u32 },
    Keyframe,
}

fn stop_capture(control: Control) -> Result<()> {
    if control.is_finished() {
        control.wait()
    } else {
        control.stop()
    }
    .map_err(|err| anyhow::anyhow!("Falha na captura ou na codificação: {err:?}"))
}

fn stdin_commands() -> tokio::sync::mpsc::Receiver<Command> {
    let (tx, rx) = tokio::sync::mpsc::channel(16);
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            match serde_json::from_str(&line) {
                Ok(command) => {
                    let stop = matches!(command, Command::Stop);
                    if tx.blocking_send(command).is_err() || stop {
                        break;
                    }
                }
                Err(_) => eprintln!("Comando de transmissão inválido."),
            }
        }
    });
    rx
}

#[derive(Default)]
struct Stats {
    captured: u64,
    encoded: u64,
    dropped: u64,
    bytes: u64,
    latency: Vec<f64>,
    nvenc: bool,
    encoder: Option<&'static str>,
    cpu_path: bool,
}

struct Capture {
    setup: Setup,
    session: Option<Session>,
    first_timestamp: Option<i64>,
    last_key_request: Option<i64>,
    last_slot: Option<u128>,
    kbps: u32,
    limit_kbps: u32,
    pending_kbps: Option<u32>,
    last_bitrate_change: Instant,
    qsv_reset_supported: bool,
}

struct Session {
    name: &'static str,
    encoder: encoder::Session,
    conversion: Conversion,
    input_size: (u32, u32),
    pending: BTreeMap<i64, (i64, Instant)>,
}

#[derive(Default)]
struct Conversion {
    gpu: Option<gpu::Converter>,
    scaler: Option<Scaler>,
}

fn start_capture(setup: Setup) -> Result<Control> {
    fn start<T: TryInto<GraphicsCaptureItemType> + Send + 'static>(
        target: T,
        monitor: Option<Monitor>,
        setup: Setup,
    ) -> Result<Control> {
        let interval = if setup.args.limit_capture_fps
            && GraphicsCaptureApi::is_minimum_update_interval_supported().unwrap_or(false)
        {
            let refresh = monitor.and_then(|monitor| monitor.refresh_rate().ok());
            MinimumUpdateIntervalSettings::Custom(Duration::from_micros(capture_interval_us(
                setup.args.fps,
                refresh,
            )))
        } else {
            MinimumUpdateIntervalSettings::Default
        };
        Capture::start_free_threaded(Settings::new(
            target,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            interval,
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            setup,
        ))
        .map_err(|err| anyhow::anyhow!("{err:?}"))
    }

    let start_window = |window: Window, setup| {
        let monitor = window.monitor();
        start(window, monitor, setup)
    };
    match &setup.args.source {
        Source::Monitor(index) => {
            let monitor = *Monitor::enumerate()?
                .get(*index)
                .context("monitor index out of range")?;
            start(monitor, Some(monitor), setup)
        }
        Source::Window(title) => start_window(Window::from_name(title)?, setup),
        Source::Pid(pid) => {
            let window = Window::enumerate()?
                .into_iter()
                .find(|window| window.process_id().ok() == Some(*pid))
                .context("no capturable window for this PID")?;
            start_window(window, setup)
        }
        Source::WindowHandle { handle, pid } => {
            let window = Window::from_raw_hwnd(*handle as *mut _);
            ensure!(
                window.is_valid() && window.process_id().ok() == Some(*pid),
                "A janela escolhida foi fechada."
            );
            start_window(window, setup)
        }
        Source::MonitorHandle(handle) => {
            let monitor = Monitor::enumerate()?
                .into_iter()
                .find(|monitor| monitor.as_raw_hmonitor() as usize == *handle)
                .context("A tela escolhida foi desconectada.")?;
            start(monitor, Some(monitor), setup)
        }
    }
}

fn capture_interval_us(fps: u32, refresh: Option<u32>) -> u64 {
    let nominal = 900_000 / u64::from(fps);
    refresh.filter(|&hz| hz >= fps).map_or(nominal, |hz| {
        // Round down to a whole number of refreshes so 144 Hz can feed a 60 fps stream.
        nominal.min(950_000 * u64::from(hz / fps) / u64::from(hz))
    })
}

#[cfg(test)]
#[test]
fn capture_interval_preserves_target_on_high_refresh_displays() {
    assert_eq!(capture_interval_us(60, None), 15_000);
    assert_eq!(capture_interval_us(60, Some(240)), 15_000);
    for hz in [75, 144, 165] {
        assert!(capture_interval_us(60, Some(hz)) * u64::from(hz) < 1_000_000 * u64::from(hz / 60));
    }
}

pub async fn run(args: Publish) -> Result<()> {
    media::init().context("Não foi possível carregar o FFmpeg")?;
    let nvenc_preset = args
        .nvenc_probe
        .as_deref()
        .map(|path| {
            crate::probe::nvenc_recommendation(path, args.codec, args.res, args.fps, args.cbr)
                .unwrap_or_else(|error| {
                    eprintln!("Aviso: não foi possível ler o relatório do probe: {error:#}");
                    Default::default()
                })
        })
        .unwrap_or_default();
    let tuning = encoder::Tuning {
        cbr: args.cbr,
        high_profile: args.hardware_quality,
        nvenc_preset,
    };
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
    let controlled = args.control_stdin;
    let pause_when_alone = args.pause_when_alone;
    let token = match &args.token {
        Some(token) => token.clone(),
        None => {
            let mut token = String::new();
            std::io::stdin().read_line(&mut token)?;
            ensure!(
                !token.trim().is_empty(),
                "O núcleo não recebeu o token de transmissão."
            );
            token.trim().to_owned()
        }
    };
    let mut commands = controlled.then(stdin_commands);
    let mut room_options = RoomOptions::default();
    room_options.auto_subscribe = false;
    let (room, mut events) = Room::connect(&args.url, &token, room_options)
        .await
        .context("Não foi possível conectar a transmissão à sala")?;
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
        ).await.context("O servidor recusou a publicação da tela")?;
        let stats = Arc::new(Mutex::new(Stats::default()));
        let requests = Arc::new(Requests::default());
        let mut setup = Setup { args, source, stats: stats.clone(), requests: requests.clone(), tuning };
        let mut control = Some(start_capture(setup.clone()).context("Não foi possível iniciar a captura")?);
        let mut alone = pause_when_alone && room.remote_participants().is_empty();
        let mut manual_pause = false;
        let mut audio = crate::audio::Worker::default();
        let result = async {
            if let Some(pid) = audio_pid {
                audio.start(&room, pid).await.context("Não foi possível capturar o som do app")?;
            }
            let start = Instant::now();
            let mut sample_start = start;
            let mut cpu_start = process_ticks();
            let nvml = nvml_wrapper::Nvml::init().ok();
            let logical_cpus = std::thread::available_parallelism().map_or(1, |count| count.get()) as f64;
            let mut timer = tokio::time::interval(Duration::from_millis(100));
            let signal = tokio::signal::ctrl_c();
            tokio::pin!(signal);
            let mut started = !controlled;
            loop {
                tokio::select! {
                    result = &mut signal => { result?; break; }
                    command = async {
                        match commands.as_mut() {
                            Some(rx) => rx.recv().await,
                            None => std::future::pending().await,
                        }
                    } => match command {
                        Some(Command::Stop) | None => break,
                        Some(Command::Pause) => manual_pause = true,
                        Some(Command::Resume) => manual_pause = false,
                        Some(Command::Bitrate { kbps }) if (1..=100_000).contains(&kbps) => {
                            setup.args.bitrate = kbps;
                            requests.kbps.store(kbps, Ordering::Relaxed);
                        }
                        Some(Command::Keyframe) => { requests.keyframe.store(true, Ordering::Relaxed); }
                        Some(Command::Bitrate { .. }) => eprintln!("Bitrate fora do intervalo de 1 a 100.000 kbps."),
                    },
                    event = events.recv() => {
                        match event {
                            None | Some(RoomEvent::Disconnected { .. }) => {
                                anyhow::bail!("A conexão com a sala caiu.");
                            }
                            Some(RoomEvent::ParticipantConnected(_) | RoomEvent::ParticipantDisconnected(_) |
                                RoomEvent::Reconnecting | RoomEvent::Reconnected) if pause_when_alone => {
                                // The public SDK reports joins and leaves, but no last-subscriber event.
                                alone = room.connection_state() == ConnectionState::Connected
                                    && room.remote_participants().is_empty();
                            }
                            Some(RoomEvent::LocalTrackSubscribed { track })
                                if pause_when_alone && track.source() == TrackSource::Screenshare => {
                                alone = false;
                                requests.keyframe.store(true, Ordering::Relaxed);
                            }
                            _ => {}
                        }
                    }
                    _ = timer.tick() => {
                        audio.check().await.context("A captura do som do app foi interrompida")?;
                        if control.as_ref().is_some_and(Control::is_finished) {
                            if controlled { anyhow::bail!("A captura foi encerrada pela janela ou pelo codificador."); }
                            break;
                        }
                        if duration.is_some_and(|limit| start.elapsed() >= limit) { break; }
                        if !started {
                            let mut sample = stats.lock().unwrap();
                            if sample.encoded > 0 {
                                emit(serde_json::json!({"event": "started", "encoder": sample.encoder, "cpu_path": sample.cpu_path}));
                                *sample = Stats { encoder: sample.encoder, nvenc: sample.nvenc, cpu_path: sample.cpu_path, ..Stats::default() };
                                started = true;
                                sample_start = Instant::now();
                                cpu_start = process_ticks();
                            } else {
                                ensure!(start.elapsed() < Duration::from_secs(12), "A captura não enviou quadros. Confira se a janela está aberta e visível.");
                                continue;
                            }
                        }
                        let elapsed = sample_start.elapsed().as_secs_f64();
                        if elapsed >= if controlled { 2.0 } else { 5.0 } {
                            let mut sample = {
                                let mut guard = stats.lock().unwrap();
                                let sample = std::mem::take(&mut *guard);
                                guard.nvenc = sample.nvenc;
                                guard.encoder = sample.encoder;
                                guard.cpu_path = sample.cpu_path;
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
                            let mut event = serde_json::json!({
                                "captured_fps": sample.captured as f64 / elapsed,
                                "encoded_fps": sample.encoded as f64 / elapsed,
                                "dropped_frames": sample.dropped,
                                "encode_ms_p50": p50, "encode_ms_p95": p95,
                                "bitrate_kbps": sample.bytes as f64 * 0.008 / elapsed,
                                "cpu_percent": cpu_percent, "gpu_encoder_percent": gpu,
                            });
                            if controlled {
                                event["event"] = "stats".into();
                            }
                            emit(event);
                            cpu_start = cpu;
                            sample_start = Instant::now();
                        }
                    }
                }
                let paused = manual_pause || alone;
                if paused != control.is_none() && stats.lock().unwrap().encoder.is_some() {
                    if let Some(capture) = control.take() {
                        stop_capture(capture)?;
                    } else {
                        // A new encoder session sends a keyframe first. Keep the published track.
                        control = Some(start_capture(setup.clone()).context("Não foi possível retomar a captura")?);
                    }
                    if controlled {
                        emit(serde_json::json!({"event":"pause_changed", "paused": paused}));
                    }
                }
            }
            Ok::<_, anyhow::Error>(())
        }.await;
        let capture_result = control.map_or(Ok(()), stop_capture);
        let audio_result = audio.stop().await;
        capture_result.and(result).and(audio_result)
    }.await;
    let close = room.close().await;
    result?;
    close.context("Não foi possível encerrar a conexão com a sala")?;
    Ok(())
}

fn emit(event: serde_json::Value) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{event}");
    let _ = stdout.flush();
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
            limit_kbps: kbps,
            pending_kbps: None,
            last_bitrate_change: Instant::now(),
            qsv_reset_supported: true,
        })
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, _: InternalCaptureControl) -> Result<()> {
        let mut stats = self.setup.stats.lock().unwrap();
        stats.captured += 1;
        let timestamp = frame.timestamp()?.Duration / 10;
        let elapsed_us = timestamp.saturating_sub(*self.first_timestamp.get_or_insert(timestamp));
        let args = &self.setup.args;
        let dimensions = (frame.width(), frame.height());
        let slot = (elapsed_us.max(0) as u128 * u128::from(args.fps) + 500_000) / 1_000_000;
        if let Some(last) = self.last_slot {
            if slot <= last {
                return Ok(());
            }
            stats.dropped += (slot - last - 1) as u64;
        }
        drop(stats);
        self.last_slot = Some(slot);
        let source = &self.setup.source;
        let manual = self.setup.requests.kbps.swap(0, Ordering::Relaxed);
        if manual != 0 {
            self.limit_kbps = manual;
        }
        let requested = source.take_rate_control_request().map(|rate| {
            (rate.target_bitrate_bps / 1000).clamp(1, u64::from(self.limit_kbps)) as u32
        });
        let update = if args.adaptive_bitrate {
            if let Some(target) = (manual != 0).then_some(manual).or(requested) {
                self.pending_kbps = Some(target);
            }
            self.pending_kbps.filter(|&target| {
                bitrate_change_due(self.kbps, target, self.last_bitrate_change.elapsed())
            })
        } else if manual != 0 && manual != self.kbps {
            Some(manual)
        } else {
            requested.filter(|requested| requested.abs_diff(self.kbps) >= (self.kbps / 10).max(1))
        };
        let mut key = source.take_keyframe_request();
        key |= self.setup.requests.keyframe.swap(false, Ordering::Relaxed);
        let input_changed = self
            .session
            .as_ref()
            .is_none_or(|session| session.input_size != dimensions);
        if let Some(target) = update {
            self.kbps = target;
            self.pending_kbps = None;
            self.last_bitrate_change = Instant::now();
        }
        let mut in_place = false;
        if args.adaptive_bitrate
            && self.qsv_reset_supported
            && !input_changed
            && update.is_some()
            && let Some(session) = self.session.as_mut()
            && session.name.ends_with("_qsv")
        {
            in_place = session.encoder.update_qsv_bitrate(self.kbps, args.cbr);
        }
        if input_changed || (update.is_some() && !in_place) {
            let mut reusable = None;
            if let Some(mut old) = self.session.take() {
                old.encoder.send_eof()?;
                self.send_packets(&mut old)?;
                if args.adaptive_bitrate && !input_changed {
                    reusable = Some((old.name, old.conversion));
                }
            }
            self.session = Some(self.open_session(frame, reusable)?);
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
        let mut picture = match &mut session.conversion.gpu {
            Some(gpu) => gpu.convert(frame)?,
            None => {
                let mut temporary = None;
                let cache = if args.cache_cpu_scaler {
                    &mut session.conversion.scaler
                } else {
                    &mut temporary
                };
                let scaler = match cache {
                    Some(scaler) => scaler,
                    None => cache.insert(Scaler::new(dimensions, args.res.dimensions())?),
                };
                cpu_convert(frame, scaler)?
            }
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
        let result = session
            .encoder
            .send_frame(&picture)
            .and_then(|()| self.send_packets(&mut session));
        if in_place && let Err(error) = result {
            eprintln!("QSV bitrate reset failed, reopening encoder: {error:#}");
            self.qsv_reset_supported = false;
            let reusable = (session.name, session.conversion);
            drop(picture);
            drop(session.encoder);
            self.session = Some(self.open_session(frame, Some(reusable))?);
            self.last_key_request = None;
            return Ok(());
        }
        result?;
        self.session = Some(session);
        Ok(())
    }
}

fn bitrate_change_due(current: u32, target: u32, elapsed: Duration) -> bool {
    elapsed >= Duration::from_secs(3) && target.abs_diff(current) * 5 >= current
}

#[cfg(test)]
#[test]
fn bitrate_hysteresis_is_inclusive_and_bidirectional() {
    let ready = Duration::from_secs(3);
    assert!(!bitrate_change_due(5000, 4000, Duration::from_millis(2999)));
    assert!(!bitrate_change_due(5000, 4001, ready));
    assert!(!bitrate_change_due(5000, 5999, ready));
    assert!(bitrate_change_due(5000, 4000, ready));
    assert!(bitrate_change_due(5000, 6000, ready));
}

impl Capture {
    fn open_session(
        &self,
        frame: &Frame,
        reusable: Option<(&'static str, Conversion)>,
    ) -> Result<Session> {
        let args = &self.setup.args;
        let open = |name, conversion: Conversion| {
            let encoder = encoder::open(
                name,
                args.res,
                args.fps,
                self.kbps,
                conversion.gpu.as_ref().map(gpu::Converter::output_pool),
                self.setup.tuning,
            )?;
            Ok::<_, anyhow::Error>(Session {
                name,
                encoder,
                conversion,
                input_size: (frame.width(), frame.height()),
                pending: BTreeMap::new(),
            })
        };
        let mut errors = Vec::new();
        if let Some((name, converter)) = reusable {
            match open(name, converter) {
                Ok(session) => return Ok(session),
                Err(err) => errors.push(format!("{name} with existing converter: {err:#}")),
            }
        }
        for name in encoder::candidates(args.codec, args.encoder) {
            let attempt = if args.cpu_path {
                open(name, Conversion::default())
            } else {
                let (width, height) = args.res.dimensions();
                gpu::Converter::new(frame, width, height, args.fps, name.ends_with("_qsv"))
                    .and_then(|gpu| {
                        open(
                            name,
                            Conversion {
                                gpu: Some(gpu),
                                scaler: None,
                            },
                        )
                    })
                    .or_else(|error| {
                        open(name, Conversion::default())
                            .with_context(|| format!("D3D11: {error:#}"))
                    })
            };
            match attempt {
                Ok(session) => return Ok(session),
                Err(err) => errors.push(format!("{name}: {err:#}")),
            }
        }
        anyhow::bail!("no usable encoder: {}", errors.join("; "))
    }

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
            stats.encoder = Some(session.name);
            stats.cpu_path = session.conversion.gpu.is_none();
            Ok(())
        })
    }
}

fn cpu_convert(frame: &mut Frame, scaler: &mut Scaler) -> Result<AvFrame> {
    let mut buffer = frame.buffer()?;
    let pitch = buffer.row_pitch() as usize;
    scaler.copy_bgra(buffer.as_raw_buffer(), pitch);
    scaler.scale_nv12()
}
