use crate::media::{self, Frame as AvFrame, Picture, Scaler};
use crate::{
    audio::{self, Target as AudioTarget},
    cli::{Codec, Publish, Resolution, Source, bits_per_second},
    encoder, gpu, replay,
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
    collections::{BTreeMap, HashMap},
    io::{BufRead, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering},
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
    size: (u32, u32),
    source: NativeVideoSource,
    stats: Arc<Mutex<Stats>>,
    requests: Arc<Requests>,
    tuning: encoder::Tuning,
    recorder: Option<replay::Recorder>,
}

#[derive(Default)]
struct Requests {
    kbps: AtomicU32,
    keyframe: AtomicBool,
    network: AtomicU8,
}

const NETWORK_OFF: u8 = 0;
const NETWORK_KEY: u8 = 1;
const NETWORK_ACTIVE: u8 = 2;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Stop,
    Pause,
    Resume,
    Bitrate {
        kbps: u32,
    },
    Keyframe,
    Replay {
        segundos: Option<u32>,
    },
    Microphone {
        ativo: bool,
        dispositivo: Option<String>,
    },
    Light {
        participante: String,
        assistir: bool,
    },
    Clip,
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
    first_timestamp: Option<(i64, Instant)>,
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
    /// Fill the output (screens and fullscreen games) instead of keeping the aspect ratio.
    fill: bool,
    pending: BTreeMap<i64, (i64, Instant, Instant)>,
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
    match resolve_target(&setup.args.source)? {
        CaptureTarget::Window(window) => start_window(window, setup),
        CaptureTarget::Monitor(monitor) => start(monitor, Some(monitor), setup),
    }
}

enum CaptureTarget {
    Window(Window),
    Monitor(Monitor),
}

fn resolve_target(source: &Source) -> Result<CaptureTarget> {
    Ok(match source {
        Source::Monitor(index) => {
            let monitor = *Monitor::enumerate()?
                .get(*index)
                .context("monitor index out of range")?;
            CaptureTarget::Monitor(monitor)
        }
        Source::Window(title) => CaptureTarget::Window(Window::from_name(title)?),
        Source::Pid(pid) => {
            let window = Window::enumerate()?
                .into_iter()
                .find(|window| window.process_id().ok() == Some(*pid))
                .context("no capturable window for this PID")?;
            CaptureTarget::Window(window)
        }
        Source::WindowHandle { handle, pid } => {
            let window = Window::from_raw_hwnd(*handle as *mut _);
            ensure!(
                window.is_valid() && window.process_id().ok() == Some(*pid),
                "A janela escolhida foi fechada."
            );
            CaptureTarget::Window(window)
        }
        Source::MonitorHandle(handle) => {
            let found = Monitor::enumerate()?
                .into_iter()
                .find(|monitor| monitor.as_raw_hmonitor() as usize == *handle);
            // A mode change (game in exclusive fullscreen, Parsec) can renumber the monitor.
            let monitor = match found {
                Some(monitor) => monitor,
                None => Monitor::primary().context("A tela escolhida foi desconectada.")?,
            };
            CaptureTarget::Monitor(monitor)
        }
    })
}

/// Screens fill the stream exactly like the monitor shows them; a game in fullscreen does too,
/// even at 1280×960 stretched by the monitor. Only a window smaller than its screen keeps its shape.
fn fills_screen(source: &Source, frame: (u32, u32)) -> bool {
    match resolve_target(source) {
        Ok(CaptureTarget::Monitor(_)) => true,
        Ok(CaptureTarget::Window(window)) => window
            .monitor()
            .and_then(|monitor| Some((monitor.width().ok()?, monitor.height().ok()?)))
            .is_some_and(|screen| {
                screen.0.abs_diff(frame.0) <= 16 && screen.1.abs_diff(frame.1) <= 16
            }),
        Err(_) => false,
    }
}

/// Current size of a monitor source; `None` for windows (their resizes are handled per frame).
fn monitor_dimensions(source: &Source) -> Option<(u32, u32)> {
    match resolve_target(source).ok()? {
        CaptureTarget::Monitor(monitor) => Some((monitor.width().ok()?, monitor.height().ok()?)),
        CaptureTarget::Window(_) => None,
    }
}

fn local_dimensions(target: &CaptureTarget, preset: (u32, u32)) -> Result<(u32, u32)> {
    let (width, height) = match target {
        CaptureTarget::Monitor(monitor) => (monitor.width()?, monitor.height()?),
        CaptureTarget::Window(window) => (
            window.width()?.max(0) as u32,
            window.height()?.max(0) as u32,
        ),
    };
    ensure!(
        width >= 2 && height >= 2,
        "A fonte do replay não tem uma área visível."
    );
    let scale = (f64::from(preset.0) / f64::from(width))
        .min(f64::from(preset.1) / f64::from(height))
        .min(1.0);
    Ok((
        ((f64::from(width) * scale) as u32).max(2) & !1,
        ((f64::from(height) * scale) as u32).max(2) & !1,
    ))
}

async fn publish_video(room: &Room, setup: &Setup, name: &str) -> Result<TrackSid> {
    let video_codec = match setup.args.codec {
        Codec::H264 => VideoCodec::H264,
        Codec::Av1 => VideoCodec::AV1,
    };
    let publication = room
        .local_participant()
        .publish_track(
            LocalTrack::Video(LocalVideoTrack::create_video_track(
                name,
                RtcVideoSource::Native(setup.source.clone()),
            )),
            TrackPublishOptions {
                source: TrackSource::Screenshare,
                stream: "screen".into(),
                video_codec,
                video_encoder: VideoEncoderBackend::PreEncoded,
                video_encoding: Some(VideoEncoding {
                    max_bitrate: bits_per_second(setup.args.bitrate) as u64,
                    max_framerate: f64::from(setup.args.fps),
                }),
                simulcast: false,
                ..Default::default()
            },
        )
        .await?;
    Ok(publication.sid())
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

#[derive(Default)]
struct Light {
    viewers: HashMap<String, Instant>,
    running: Option<(Control, TrackSid)>,
    failed: bool,
}

impl Light {
    fn request(&mut self, identity: String, assistir: bool) {
        if identity.is_empty() || identity.len() > 128 || identity.ends_with(":tela") {
            return;
        }
        if assistir {
            self.viewers.insert(identity, Instant::now());
        } else {
            self.viewers.remove(&identity);
        }
    }

    async fn stop(&mut self, room: &Room) {
        if let Some((control, sid)) = self.running.take() {
            if let Err(error) = stop_capture(control) {
                eprintln!("Faixa leve: {error:#}");
            }
            if let Err(error) = room.local_participant().unpublish_track(&sid).await {
                eprintln!("Encerrar faixa leve: {error:#}");
            }
        }
    }

    async fn update(&mut self, room: &Room, main: &Setup) {
        self.viewers
            .retain(|_, last| last.elapsed() < Duration::from_secs(45));
        if self.viewers.is_empty() {
            self.stop(room).await;
            self.failed = false;
        } else if self
            .running
            .as_ref()
            .is_some_and(|(capture, _)| capture.is_finished())
        {
            self.stop(room).await;
            self.fail("O segundo codificador não está disponível.");
        } else if self.running.is_none() && !self.failed {
            let mut setup = main.clone();
            setup.args.codec = Codec::H264;
            setup.args.res = Resolution::P720;
            setup.args.bitrate = 1500;
            setup.args.fps = 30;
            setup.args.limit_capture_fps = true;
            setup.args.nvenc_probe = None;
            setup.size = setup.args.res.dimensions();
            setup.source = NativeVideoSource::new_encoded(VideoResolution {
                width: setup.size.0,
                height: setup.size.1,
            });
            setup.stats = Arc::new(Mutex::new(Stats::default()));
            setup.requests = Arc::new(Requests::default());
            setup
                .requests
                .network
                .store(NETWORK_ACTIVE, Ordering::Relaxed);
            setup.recorder = None;
            let result = async {
                let sid = publish_video(room, &setup, "screen-low").await?;
                match start_capture(setup) {
                    Ok(capture) => Ok((capture, sid)),
                    Err(error) => {
                        let _ = room.local_participant().unpublish_track(&sid).await;
                        Err(error)
                    }
                }
            }
            .await;
            match result {
                Ok(running) => self.running = Some(running),
                Err(error) => self.fail(format!("{error:#}")),
            }
        }
    }

    fn fail(&mut self, reason: impl std::fmt::Display) {
        self.failed = true;
        emit(serde_json::json!({"event":"light_error","reason":reason.to_string()}));
    }
}

pub async fn run(mut args: Publish) -> Result<()> {
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
    let target = resolve_target(&args.source)?;
    let size = if args.local_replay {
        if let CaptureTarget::Monitor(monitor) = &target
            && let Ok(refresh) = monitor.refresh_rate()
        {
            args.fps = args.fps.min(refresh.max(1));
        }
        local_dimensions(&target, args.res.dimensions())?
    } else {
        args.res.dimensions()
    };
    let source = NativeVideoSource::new_encoded(VideoResolution {
        width: size.0,
        height: size.1,
    });
    let duration = args.duration.map(Duration::from_secs);
    let published_audio = args.audio_pid.map(|pid| AudioTarget::Process {
        pid,
        include: !args.audio_exclude,
    });
    let game = match target {
        CaptureTarget::Window(window) => Some(AudioTarget::Process {
            pid: window.process_id()?,
            include: true,
        }),
        CaptureTarget::Monitor(_) => args
            .app_pid
            .map(|pid| AudioTarget::Process {
                pid,
                include: false,
            })
            .or_else(|| published_audio.clone()),
    };
    let call = args
        .app_pid
        .map(|pid| AudioTarget::Process { pid, include: true });
    let mut replay = replay::Replay::new(
        args.replay_dir.clone(),
        if published_audio.is_some() && !args.local_replay {
            None
        } else {
            game
        },
        call,
    );
    let replay_seconds = args.replay_seconds;
    let local = args.local_replay;
    let controlled = args.control_stdin;
    let pause_when_alone = args.pause_when_alone;
    let (room, mut events) = if let Some(url) = &args.url {
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
        let mut room_options = RoomOptions::default();
        room_options.auto_subscribe = false;
        let (room, events) = Room::connect(url, &token, room_options)
            .await
            .context("Não foi possível conectar a transmissão à sala")?;
        (Some(room), Some(events))
    } else {
        (None, None)
    };
    let mut commands = controlled.then(stdin_commands);
    let result = async {
        let stats = Arc::new(Mutex::new(Stats::default()));
        let requests = Arc::new(Requests::default());
        if !local { requests.network.store(NETWORK_ACTIVE, Ordering::Relaxed); }
        let mut setup = Setup { args, source, size, stats: stats.clone(), requests: requests.clone(), tuning, recorder: Some(replay.recorder.clone()) };
        if let Some(room) = &room {
            publish_video(room, &setup, "screen").await.context("O servidor recusou a publicação da tela")?;
        }
        if let Err(error) = replay.configure(replay_seconds).await {
            if local { return Err(error); }
            replay::report_error(error);
        }
        let mut control = Some(start_capture(setup.clone()).context("Não foi possível iniciar a captura")?);
        let mut alone = pause_when_alone && room.as_ref().is_some_and(|room| room.remote_participants().is_empty());
        let mut manual_pause = false;
        let mut was_paused = false;
        let mut audio = audio::Worker::default();
        let mut light = Light::default();
        let result = async {
            if let (Some(room), Some(target)) = (&room, published_audio) {
                audio.start(room, target, replay.recorder.clone()).await.context("Não foi possível capturar o som do jogo")?;
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
            let mut monitor_size = monitor_dimensions(&setup.args.source);
            let mut size_check = Instant::now();
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
                        Some(Command::Replay { segundos }) => {
                            if let Err(error) = replay.configure(segundos).await { replay::report_error(error); }
                            if local && !replay.recorder.active() { break; }
                            requests.keyframe.store(true, Ordering::Relaxed);
                        }
                        Some(Command::Microphone { ativo, dispositivo }) => replay.microphone(ativo, dispositivo).await,
                        Some(Command::Light { participante, assistir }) => light.request(participante, assistir),
                        Some(Command::Clip) => { if let Err(error) = replay.save() { replay::report_error(error); } }
                        Some(Command::Bitrate { .. }) => eprintln!("Bitrate fora do intervalo de 1 a 100.000 kbps."),
                    },
                    event = async { match events.as_mut() { Some(rx) => rx.recv().await, None => std::future::pending().await } } => {
                        let room = room.as_ref().context("Evento sem sala")?;
                        match event {
                            None | Some(RoomEvent::Disconnected { .. }) => {
                                anyhow::bail!("A conexão com a sala caiu.");
                            }
                            Some(RoomEvent::ParticipantDisconnected(participant)) => {
                                light.viewers.remove(&participant.identity().to_string());
                                if pause_when_alone { alone = room.remote_participants().is_empty(); }
                            }
                            Some(RoomEvent::ParticipantConnected(_) |
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
                        // A monitor capture that ends is rebuilt below; a closed window ends the stream.
                        if monitor_size.is_none() && control.as_ref().is_some_and(Control::is_finished) {
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
                if !local && paused != was_paused && stats.lock().unwrap().encoder.is_some() {
                    requests.network.store(if paused { NETWORK_OFF } else { NETWORK_KEY }, Ordering::Relaxed);
                    if !paused { requests.keyframe.store(true, Ordering::Relaxed); }
                    was_paused = paused;
                    if controlled { emit(serde_json::json!({"event":"pause_changed", "paused": paused})); }
                }
                let sleep = was_paused && !replay.recorder.active();
                if sleep != control.is_none() {
                    if let Some(capture) = control.take() {
                        stop_capture(capture)?;
                    } else {
                        // A new encoder session sends a keyframe first. Keep the published track.
                        control = Some(start_capture(setup.clone()).context("Não foi possível retomar a captura")?);
                    }
                }
                // A game in exclusive fullscreen (CS2 at 1280×960) or Parsec changes the monitor mode.
                // WGC keeps sending the old surface (black), so rebuild the capture on a new size.
                if control.is_some() && size_check.elapsed() >= Duration::from_secs(1) {
                    size_check = Instant::now();
                    let current = monitor_dimensions(&setup.args.source);
                    let finished = control.as_ref().is_some_and(Control::is_finished);
                    if (current.is_some() && current != monitor_size) || (finished && monitor_size.is_some()) {
                        eprintln!("A tela mudou de resolução ({monitor_size:?} -> {current:?}); refazendo a captura.");
                        monitor_size = current;
                        if let Some(capture) = control.take() { let _ = stop_capture(capture); }
                        control = Some(start_capture(setup.clone()).context("Não foi possível refazer a captura da tela")?);
                        requests.keyframe.store(true, Ordering::Relaxed);
                    }
                }
                if let Some(room) = &room { light.update(room, &setup).await; }
            }
            Ok::<_, anyhow::Error>(())
        }.await;
        let capture_result = control.map_or(Ok(()), stop_capture);
        if let Some(room) = &room { light.stop(room).await; }
        let audio_result = audio.stop().await;
        capture_result.and(result).and(audio_result)
    }.await;
    replay.close().await;
    let close = match room {
        Some(room) => room.close().await,
        None => Ok(()),
    };
    result?;
    close.context("Não foi possível encerrar a conexão com a sala")?;
    Ok(())
}

pub fn emit(event: serde_json::Value) {
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
        let (origin_us, origin) = *self
            .first_timestamp
            .get_or_insert_with(|| (timestamp, Instant::now()));
        let elapsed_us = timestamp.saturating_sub(origin_us).max(0) as u64;
        let args = &self.setup.args;
        let dimensions = (frame.width(), frame.height());
        let slot = (u128::from(elapsed_us) * u128::from(args.fps) + 500_000) / 1_000_000;
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
        let online = self.setup.requests.network.load(Ordering::Relaxed) != NETWORK_OFF;
        let requested = source
            .take_rate_control_request()
            .filter(|_| online)
            .map(|rate| {
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
        // QSV can emit a corrupt access unit during an in-place reset. An
        // exported clip must decode across bitrate changes without recovery.
        if args.adaptive_bitrate
            && self.qsv_reset_supported
            && !input_changed
            && update.is_some()
            && !self
                .setup
                .recorder
                .as_ref()
                .is_some_and(replay::Recorder::active)
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
                    None => cache.insert(Scaler::new(dimensions, self.setup.size, session.fill)?),
                };
                cpu_convert(frame, scaler)?
            }
        };
        let (width, height) = self.setup.size;
        picture.set_size(width, height);
        let encoder_pts = pts * 9 / 100;
        picture.raw_mut().pts = encoder_pts;
        picture.raw_mut().pict_type = if key {
            Picture::AV_PICTURE_TYPE_I
        } else {
            Picture::AV_PICTURE_TYPE_NONE
        };
        session.pending.insert(
            encoder_pts,
            (
                pts,
                origin + Duration::from_micros(elapsed_us),
                Instant::now(),
            ),
        );
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
        let fill = args.stretch || fills_screen(&args.source, (frame.width(), frame.height()));
        let open = |name, conversion: Conversion| {
            let encoder = encoder::open(
                name,
                self.setup.size,
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
                fill,
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
                let (width, height) = self.setup.size;
                gpu::Converter::new(frame, width, height, args.fps, name.ends_with("_qsv"), fill)
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
        let (width, height) = self.setup.size;
        let codec = match self.setup.args.codec {
            Codec::H264 => EncodedVideoCodec::H264,
            Codec::Av1 => EncodedVideoCodec::AV1,
        };
        encoder::drain(&mut session.encoder, |packet| {
            let pts = packet.pts().context("encoded packet missing PTS")?;
            let payload = packet.data().context("encoded packet missing data")?;
            let (timestamp_us, captured_at, started) = session
                .pending
                .remove(&pts)
                .context("unexpected encoded packet timestamp")?;
            let encode_ms = started.elapsed().as_secs_f64() * 1000.0;
            let key = packet.is_key();
            if let Some(recorder) = &self.setup.recorder {
                recorder.video(
                    replay::VideoFormat {
                        codec: self.setup.args.codec,
                        width,
                        height,
                        fps: self.setup.args.fps,
                    },
                    captured_at,
                    key,
                    payload,
                );
            }
            let network = &self.setup.requests.network;
            let send = match network.load(Ordering::Relaxed) {
                NETWORK_ACTIVE => true,
                NETWORK_KEY if key => network
                    .compare_exchange(
                        NETWORK_KEY,
                        NETWORK_ACTIVE,
                        Ordering::Relaxed,
                        Ordering::Relaxed,
                    )
                    .is_ok(),
                _ => false,
            };
            if send {
                let accepted = self.setup.source.capture_encoded_frame(&EncodedVideoFrame {
                    codec,
                    payload,
                    timestamp_us,
                    resolution: VideoResolution { width, height },
                    frame_metadata: None,
                    frame_type: if key {
                        EncodedFrameType::Key
                    } else {
                        EncodedFrameType::Delta
                    },
                });
                ensure!(
                    accepted,
                    "LiveKit 0.12.0 rejected {codec:?} access unit in capture_encoded_frame"
                );
            }
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

#[tokio::test]
#[ignore = "requires a local publish, a voice token and light requests on publisher stdin"]
async fn local_light_track_is_published_and_removed() -> Result<()> {
    let token = std::env::var("STACKCALL_TEST_VOICE_TOKEN")?;
    let (room, mut events) =
        Room::connect("ws://127.0.0.1:7880", &token, RoomOptions::default()).await?;
    let name = "teste-v05:tela";
    tokio::time::timeout(Duration::from_secs(18), async {
        while !room.remote_participants().values().any(|part| {
            part.identity().to_string() == name
                && part
                    .track_publications()
                    .values()
                    .any(|track| track.name() == "screen")
        }) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await?;
    for assistir in [true, false] {
        tokio::time::timeout(Duration::from_secs(20), async {
            while let Some(event) = events.recv().await {
                match event {
                    RoomEvent::TrackSubscribed { publication, .. }
                        if assistir && publication.name() == "screen-low" =>
                    {
                        return Ok(());
                    }
                    RoomEvent::TrackUnpublished { publication, .. }
                        if !assistir && publication.name() == "screen-low" =>
                    {
                        return Ok(());
                    }
                    _ => (),
                }
            }
            anyhow::bail!("A sala fechou antes da confirmação da faixa leve")
        })
        .await??;
        println!(
            "screen-low: {}",
            if assistir {
                "publicada e assinada"
            } else {
                "removida"
            }
        );
    }
    room.close().await?;
    Ok(())
}
