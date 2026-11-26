use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, oneshot, watch, Mutex},
    time::{timeout, Instant},
};

use crate::conta::Accounts;

const EVENT: &str = "stackcall-stream";
const UNAVAILABLE: &str = "O núcleo de transmissão não está disponível nesta máquina.";
const CACHE_VERSION: u32 = 4;

#[derive(Default)]
pub struct Sidecar {
    hub: Hub,
    probe: Mutex<()>,
}

#[derive(Clone, Default)]
struct Hub {
    active: Arc<Mutex<Option<Running>>>,
    settings: Arc<Mutex<Preferences>>,
    replay_active: Arc<AtomicBool>,
}

#[derive(Default)]
struct Preferences {
    config: Option<ReplayConfig>,
    mic: Mic,
}

#[derive(Clone, Default, PartialEq)]
struct Mic {
    ativo: bool,
    dispositivo: Option<String>,
}

impl Mic {
    fn command(&self) -> Value {
        json!({"cmd":"microphone", "ativo":self.ativo, "dispositivo":self.dispositivo})
    }
}

#[derive(Clone, PartialEq, Deserialize)]
pub struct ReplayConfig {
    segundos: u32,
    sempre: bool,
    fonte: Option<String>,
    resolucao: Option<String>,
    fps: Option<u32>,
    kbps: Option<u32>,
    encoder: Option<String>,
}

#[derive(Clone)]
struct Running {
    id: Option<String>,
    controls: mpsc::Sender<Value>,
    ended: watch::Receiver<bool>,
}

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x08000000 | 0x20); // CREATE_NO_WINDOW | NORMAL_PRIORITY_CLASS: game mode lowers the app, never the encoder
    command.kill_on_drop(true).stderr(Stdio::null());
    command
}

fn core() -> Result<Command, String> {
    let executable = std::env::current_exe().map_err(|_| UNAVAILABLE)?;
    Ok(command(executable.with_file_name("stackcall-core.exe")))
}

async fn query(args: &[&str], seconds: u64) -> Result<Value, String> {
    let output = timeout(
        Duration::from_secs(seconds),
        core()?
            .args(args)
            .env("STACKCALL_APP_PID", std::process::id().to_string())
            .output(),
    )
    .await
    .map_err(|_| "O núcleo demorou para responder.")?
    .map_err(|_| UNAVAILABLE)?;
    if !output.status.success() {
        return Err(UNAVAILABLE.into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub async fn listar_fontes() -> Result<Value, String> {
    query(&["sources"], 30).await
}

async fn driver_signature() -> Option<String> {
    let output = timeout(Duration::from_secs(5), command("reg.exe")
        .args(["query", r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}", "/s", "/v", "DriverVersion"])
        .output()).await.ok()?.ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_local_data_dir().ok()?.join("gpu-probe.json"))
}

fn report_path(cache: &Path) -> PathBuf {
    cache.with_file_name(format!("gpu-probe-v{CACHE_VERSION}-report.json"))
}

fn save_report(cache: &Path, report: &Value) {
    let path = report_path(cache);
    let pending = path.with_extension("tmp");
    // The publisher can open this report while a new probe is finishing.
    if std::fs::write(&pending, report.to_string()).is_ok() {
        let _ = std::fs::rename(pending, path);
    }
}

#[tauri::command]
pub async fn testar_maquina(
    app: AppHandle,
    sidecar: State<'_, Sidecar>,
    force: Option<bool>,
) -> Result<Value, String> {
    let _guard = sidecar.probe.lock().await;
    let driver = driver_signature().await;
    let path = cache_path(&app);
    if let (false, Some(driver), Some(path)) = (force.unwrap_or(false), &driver, &path) {
        if let Some(cache) = std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .filter(|cache| cache["version"] == CACHE_VERSION && cache["driver"] == *driver)
        {
            if let Some(report) = cache.get("report") {
                if !report_path(path).is_file() {
                    save_report(path, report);
                }
                return Ok(report.clone());
            }
        }
    }
    let report = query(&["probe", "--cbr", "--hardware-quality"], 120).await?;
    if let Some(path) = path {
        if path
            .parent()
            .is_some_and(|dir| std::fs::create_dir_all(dir).is_ok())
        {
            save_report(&path, &report);
            if let Some(driver) = driver {
                let cache = json!({ "version": CACHE_VERSION, "driver": driver, "report": report });
                let _ = std::fs::write(path, cache.to_string());
            }
        }
    }
    Ok(report)
}

#[derive(Deserialize)]
pub struct Publish {
    id: String,
    source: String,
    resolution: String,
    fps: u32,
    codec: String,
    encoder: String,
    kbps: u32,
    audio_pid: Option<u32>,
    game_audio: Option<bool>,
    url: String,
    token: String,
}

fn valid_capture_source(value: &str) -> bool {
    match value.split_once(':') {
        Some(("hmonitor", handle)) => handle.parse::<usize>().is_ok_and(|handle| handle > 0),
        Some(("hwnd", identity)) => identity.split_once(':').is_some_and(|(handle, pid)| {
            handle.parse::<usize>().is_ok_and(|handle| handle > 0)
                && pid.parse::<u32>().is_ok_and(|pid| pid > 0)
        }),
        _ => false,
    }
}

fn publish_arguments(command: &mut Command, args: &Publish, report: Option<&Path>) {
    command
        .args([
            "publish",
            "--control-stdin",
            "--limit-capture-fps",
            "--cbr",
            "--adaptive-bitrate",
            "--hardware-quality",
            "--cache-cpu-scaler",
        ])
        .arg(format!("--source={}", args.source))
        .arg(format!("--url={}", args.url))
        .args([
            "--res",
            &args.resolution,
            "--fps",
            &args.fps.to_string(),
            "--codec",
            &args.codec,
            "--encoder",
            &args.encoder,
            "--bitrate",
            &args.kbps.to_string(),
        ]);
    if args.game_audio == Some(true) && args.source.starts_with("hmonitor:") {
        // Whole screen: with a known game open, only its sound (no Discord, no music);
        // otherwise everything on the PC except Stackcall itself.
        match crate::jogo::running_game_pid() {
            Some(game) => command.args(["--audio-pid", &game.to_string()]),
            None => command.args([
                "--audio-pid",
                &std::process::id().to_string(),
                "--audio-exclude",
            ]),
        };
    } else if let Some(pid) = match args.game_audio {
        Some(true) => args
            .source
            .rsplit_once(':')
            .and_then(|(_, pid)| pid.parse().ok()),
        Some(false) => None,
        None => args.audio_pid,
    } {
        command.args(["--audio-pid", &pid.to_string()]);
    }
    command.args(["--app-pid", &std::process::id().to_string()]);
    if let Some(report) = report {
        command.arg("--nvenc-probe").arg(report);
    }
}

#[tauri::command]
pub async fn iniciar_transmissao(
    app: AppHandle,
    accounts: State<'_, Accounts>,
    sidecar: State<'_, Sidecar>,
    args: Publish,
) -> Result<(), String> {
    if !matches!(args.resolution.as_str(), "720p" | "1080p" | "1440p" | "4k")
        || !matches!(args.fps, 30 | 60)
        || !matches!(args.codec.as_str(), "h264" | "av1")
        || !matches!(args.encoder.as_str(), "nvenc" | "amf" | "qsv")
        || !(1..=100_000).contains(&args.kbps)
        || !accounts.valid_livekit_url(&args.url, &args.token)
        || !valid_capture_source(&args.source)
        || args.audio_pid == Some(0)
        || args.token.is_empty()
        || args.token.contains(['\r', '\n'])
    {
        return Err("Parâmetros da transmissão inválidos.".into());
    }
    let hub = &sidecar.hub;
    let prefs = hub.settings.lock().await;
    let previous = hub.active.lock().await.clone();
    if previous.as_ref().is_some_and(|run| run.id.is_some()) {
        return Err("Já existe uma transmissão em andamento.".into());
    }
    let mut command = core()?;
    let report = cache_path(&app)
        .map(|cache| report_path(&cache))
        .filter(|report| report.is_file());
    publish_arguments(&mut command, &args, report.as_deref());
    if let Ok(dir) = replay_dir(&app) {
        command.arg("--replay-dir").arg(dir);
        if let Some(config) = &prefs.config {
            command
                .arg("--replay-seconds")
                .arg(config.segundos.to_string());
        }
    }
    #[cfg(windows)]
    command.creation_flags(
        windows_sys::Win32::System::Threading::CREATE_NO_WINDOW
            | windows_sys::Win32::System::Threading::ABOVE_NORMAL_PRIORITY_CLASS,
    );
    if let Some(previous) = previous {
        end(previous).await;
    }
    let mut active = hub.active.lock().await;
    let started = match launch(
        &app,
        hub,
        &mut active,
        command,
        Some((args.id, args.token)),
        prefs.mic.clone(),
    ) {
        Ok(started) => started,
        Err(error) => {
            resume_local(&app, hub, &mut active, &prefs);
            return Err(error);
        }
    };
    drop(active);
    drop(prefs);
    started.await.map_err(|_| UNAVAILABLE)?
}

/// The core's stderr (why a stream dropped, capture rebuilt, encoder errors) goes to
/// `%LOCALAPPDATA%\io.github.stackcall\logs\nucleo.log`, kept under 2 MB with one old copy.
fn guardar_log(app: &AppHandle, stderr: tokio::process::ChildStderr) {
    let Ok(dir) = app.path().app_local_data_dir().map(|dir| dir.join("logs")) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("nucleo.log");
        if std::fs::metadata(&path).is_ok_and(|meta| meta.len() > 2_000_000) {
            let _ = std::fs::rename(&path, dir.join("nucleo.1.log"));
        }
        let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        else {
            return;
        };
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            use std::io::Write;
            let _ = writeln!(file, "{secs} {line}");
        }
    });
}

fn launch(
    app: &AppHandle,
    hub: &Hub,
    active: &mut Option<Running>,
    mut command: Command,
    live: Option<(String, String)>,
    mic: Mic,
) -> Result<oneshot::Receiver<Result<(), String>>, String> {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|_| UNAVAILABLE)?;
    if let Some(stderr) = child.stderr.take() {
        guardar_log(app, stderr);
    }
    #[cfg(windows)]
    if live.is_some() {
        opt_out_of_eco_qos(&child);
    }
    let (control_tx, control_rx) = mpsc::channel(8);
    let (started_tx, started_rx) = oneshot::channel();
    let (ended_tx, ended_rx) = watch::channel(false);
    *active = Some(Running {
        id: live.as_ref().map(|(id, _)| id.clone()),
        controls: control_tx,
        ended: ended_rx,
    });
    let app = app.clone();
    let hub = hub.clone();
    tauri::async_runtime::spawn(async move {
        let mut started = Some(started_tx);
        let result = supervise(
            &app,
            &hub,
            live.as_ref(),
            &mic,
            child,
            control_rx,
            &mut started,
        )
        .await;
        if let Some(started) = started {
            let reason = result
                .as_ref()
                .err()
                .cloned()
                .unwrap_or_else(|| "A captura foi cancelada.".into());
            let _ = started.send(Err(reason));
        }
        let mut active = hub.active.lock().await;
        *active = None;
        replay_state(&app, &hub, false);
        drop(active);
        let _ = ended_tx.send(true);
        if let Some((id, _)) = live {
            let event = match result {
                Ok(()) => json!({"event":"stopped"}),
                Err(reason) => json!({"event":"error", "reason": reason}),
            };
            emit(&app, &id, event);
            let prefs = hub.settings.lock().await;
            let mut active = hub.active.lock().await;
            resume_local(&app, &hub, &mut active, &prefs);
        } else if let Err(reason) = result {
            replay_error(&app, reason);
        }
    });
    Ok(started_rx)
}

#[cfg(windows)]
fn opt_out_of_eco_qos(child: &Child) {
    use windows_sys::Win32::System::Threading::{
        ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };

    if let Some(handle) = child.raw_handle() {
        let power = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            StateMask: 0,
        };
        let ok = unsafe {
            SetProcessInformation(
                handle,
                ProcessPowerThrottling,
                (&power as *const PROCESS_POWER_THROTTLING_STATE).cast(),
                std::mem::size_of_val(&power) as u32,
            )
        };
        if ok == 0 {
            eprintln!(
                "Não foi possível desativar o EcoQoS do núcleo: {}",
                std::io::Error::last_os_error()
            );
        }
    }
}

async fn supervise(
    app: &AppHandle,
    hub: &Hub,
    live: Option<&(String, String)>,
    mic: &Mic,
    mut child: Child,
    mut controls: mpsc::Receiver<Value>,
    started: &mut Option<oneshot::Sender<Result<(), String>>>,
) -> Result<(), String> {
    let mut stdin = child.stdin.take().ok_or(UNAVAILABLE)?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or(UNAVAILABLE)?).lines();
    if let Some((_, token)) = live {
        stdin
            .write_all(format!("{token}\n").as_bytes())
            .await
            .map_err(|_| UNAVAILABLE)?;
    }
    if mic.ativo {
        stdin
            .write_all(format!("{}\n", mic.command()).as_bytes())
            .await
            .map_err(|_| UNAVAILABLE)?;
    }
    let mut stopping = false;
    let deadline = tokio::time::sleep(Duration::from_secs(25));
    tokio::pin!(deadline);
    let result = loop {
        tokio::select! {
            _ = &mut deadline, if started.is_some() || stopping => {
                break if stopping { Ok(()) } else { Err("O núcleo demorou para iniciar a transmissão.".into()) };
            }
            line = stdout.next_line() => {
                let Ok(Some(line)) = line else {
                    break if stopping { Ok(()) } else { Err("O núcleo de transmissão foi encerrado inesperadamente.".into()) };
                };
                let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
                match event["event"].as_str() {
                    Some("started") if !stopping => {
                        if let Some(started) = started.take() {
                            let _ = started.send(Ok(()));
                            if let Some((id, _)) = live { emit(app, id, event); }
                        }
                    }
                    Some("stats" | "pause_changed" | "light_error") => {
                        if let Some((id, _)) = live { emit(app, id, event); }
                    }
                    Some("minimized") => {
                        // A minimized game delays the first frame: wait for it to come back
                        // (up to 10 min) instead of failing after 25 s.
                        if started.is_some() {
                            let espera = if event["value"].as_bool() == Some(true) { 600 } else { 25 };
                            deadline.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(espera));
                        }
                        if let Some((id, _)) = live { emit(app, id, event); }
                    }
                    Some("replay_state") => replay_state(app, hub, event["ativo"].as_bool().unwrap_or(false)),
                    Some("replay_saved") => {
                        let mut event = event;
                        event["event"] = "saved".into();
                        let _ = app.emit("stackcall-replay", event);
                    }
                    Some("replay_error") => replay_error(app, event["motivo"].as_str().unwrap_or(UNAVAILABLE)),
                    Some("stopped") => break Ok(()),
                    Some("error") => break Err(event["reason"].as_str().unwrap_or(UNAVAILABLE).into()),
                    _ => (),
                }
            }
            control = controls.recv(), if !stopping => {
                let control = control.unwrap_or_else(|| json!({"cmd": "stop"}));
                if control["cmd"] == "stop" {
                    stopping = true;
                    deadline.as_mut().reset(Instant::now() + Duration::from_secs(25));
                }
                let write = timeout(Duration::from_secs(1), stdin.write_all(format!("{control}\n").as_bytes())).await;
                if !matches!(write, Ok(Ok(()))) {
                    break if stopping { Ok(()) } else { Err("O núcleo parou de responder.".into()) };
                }
            }
        }
    };
    drop(stdin);
    if timeout(Duration::from_secs(1), child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
    result
}

fn emit(app: &AppHandle, id: &str, mut event: Value) {
    event["id"] = id.into();
    let _ = app.emit(EVENT, event);
}

#[tauri::command]
pub async fn parar_transmissao(sidecar: State<'_, Sidecar>, id: String) -> Result<(), String> {
    let running = sidecar
        .hub
        .active
        .lock()
        .await
        .as_ref()
        .filter(|running| running.id.as_deref() == Some(&id))
        .cloned();
    if let Some(running) = running {
        end(running).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn mudar_bitrate(
    sidecar: State<'_, Sidecar>,
    id: String,
    kbps: u32,
) -> Result<(), String> {
    if !(1..=100_000).contains(&kbps) {
        return Err("Bitrate fora do intervalo de 1 a 100.000 kbps.".into());
    }
    send_control(&sidecar, &id, json!({"cmd":"bitrate", "kbps": kbps})).await
}

#[tauri::command]
pub async fn mudar_pausa_transmissao(
    sidecar: State<'_, Sidecar>,
    id: String,
    paused: bool,
) -> Result<(), String> {
    let command = if paused { "pause" } else { "resume" };
    send_control(&sidecar, &id, json!({"cmd": command})).await
}

#[tauri::command]
pub async fn mudar_faixa_leve(
    sidecar: State<'_, Sidecar>,
    id: String,
    participante: String,
    assistir: bool,
) -> Result<(), String> {
    if participante.is_empty() || participante.len() > 128 || participante.ends_with(":tela") {
        return Err("Identidade de quem assiste inválida.".into());
    }
    send_control(
        &sidecar,
        &id,
        json!({"cmd":"light", "participante":participante, "assistir":assistir}),
    )
    .await
}

async fn send_control(sidecar: &Sidecar, id: &str, command: Value) -> Result<(), String> {
    let controls = sidecar
        .hub
        .active
        .lock()
        .await
        .as_ref()
        .filter(|running| running.id.as_deref() == Some(id))
        .map(|running| running.controls.clone())
        .ok_or("Nenhuma transmissão em andamento.")?;
    controls
        .send(command)
        .await
        .map_err(|_| "O núcleo parou de responder.".into())
}

async fn end(mut running: Running) {
    let _ = running.controls.send(json!({"cmd":"stop"})).await;
    let _ = running.ended.wait_for(|ended| *ended).await;
}

pub(crate) fn replay_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .video_dir()
        .map(|path| path.join("Stackcall"))
        .map_err(|_| "Não foi possível localizar a pasta Vídeos do Windows.".into())
}

fn replay_state(app: &AppHandle, hub: &Hub, ativo: bool) {
    if hub.replay_active.swap(ativo, Ordering::Relaxed) != ativo {
        let _ = app.emit("stackcall-replay", json!({"event":"state", "ativo":ativo}));
    }
}

fn replay_error(app: &AppHandle, motivo: impl AsRef<str>) {
    let _ = app.emit(
        "stackcall-replay",
        json!({"event":"error", "motivo":motivo.as_ref()}),
    );
}

fn local_command(app: &AppHandle, config: &ReplayConfig) -> Result<Command, String> {
    let mut command = core()?;
    command
        .args([
            "publish",
            "--local-replay",
            "--control-stdin",
            "--limit-capture-fps",
            "--cbr",
            "--hardware-quality",
            "--cache-cpu-scaler",
            "--codec",
            "h264",
            "--source",
            config
                .fonte
                .as_deref()
                .ok_or("Escolha a fonte do replay.")?,
            "--res",
            config.resolucao.as_deref().unwrap_or("1080p"),
            "--fps",
            &config.fps.unwrap_or(60).to_string(),
            "--encoder",
            config.encoder.as_deref().unwrap_or("auto"),
            "--bitrate",
            &config.kbps.unwrap_or(12_000).to_string(),
            "--replay-seconds",
            &config.segundos.to_string(),
            "--app-pid",
            &std::process::id().to_string(),
        ])
        .arg("--replay-dir")
        .arg(replay_dir(app)?);
    Ok(command)
}

fn resume_local(app: &AppHandle, hub: &Hub, active: &mut Option<Running>, prefs: &Preferences) {
    if active.is_none() {
        if let Some(config) = prefs.config.as_ref().filter(|config| config.sempre) {
            if let Err(error) = local_command(app, config)
                .and_then(|command| launch(app, hub, active, command, None, prefs.mic.clone()))
            {
                replay_error(app, error);
            }
        }
    }
}

fn validate_replay(config: &ReplayConfig) -> Result<(), String> {
    if !matches!(config.segundos, 30 | 60 | 120)
        || !matches!(
            config.resolucao.as_deref().unwrap_or("1080p"),
            "720p" | "1080p" | "1440p" | "4k"
        )
        || !matches!(config.fps.unwrap_or(60), 30 | 60)
        || !(1..=100_000).contains(&config.kbps.unwrap_or(12_000))
        || !matches!(
            config.encoder.as_deref().unwrap_or("auto"),
            "auto" | "qsv" | "nvenc" | "amf"
        )
        || (config.sempre && !config.fonte.as_deref().is_some_and(valid_capture_source))
    {
        return Err(
            "Configuração de replay inválida. Confira a fonte, a duração e a qualidade.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn replay_atual(sidecar: State<'_, Sidecar>) -> bool {
    sidecar.hub.replay_active.load(Ordering::Relaxed)
}

#[tauri::command]
pub async fn replay_definir(
    app: AppHandle,
    sidecar: State<'_, Sidecar>,
    config: Option<ReplayConfig>,
) -> Result<(), String> {
    if let Some(config) = &config {
        validate_replay(config)?;
        replay_dir(&app)?;
    }
    let hub = &sidecar.hub;
    let mut prefs = hub.settings.lock().await;
    let running = hub.active.lock().await.clone();
    if let Some(run) = running.as_ref().filter(|run| run.id.is_some()) {
        run.controls
            .send(json!({"cmd":"replay", "segundos":config.as_ref().map(|config| config.segundos)}))
            .await
            .map_err(|_| "O núcleo parou de responder.")?;
        prefs.config = config;
        return Ok(());
    }
    if running.is_some() && prefs.config == config {
        return Ok(());
    }
    let command = config
        .as_ref()
        .filter(|config| config.sempre)
        .map(|config| local_command(&app, config))
        .transpose()?;
    if let Some(run) = running {
        end(run).await;
    }
    let started = if let Some(command) = command {
        let mut active = hub.active.lock().await;
        Some(launch(
            &app,
            hub,
            &mut active,
            command,
            None,
            prefs.mic.clone(),
        )?)
    } else {
        None
    };
    if let Some(started) = started {
        started.await.map_err(|_| UNAVAILABLE)??;
    }
    prefs.config = config;
    Ok(())
}

#[tauri::command]
pub async fn replay_microfone(
    sidecar: State<'_, Sidecar>,
    ativo: bool,
    dispositivo: Option<String>,
) -> Result<(), String> {
    let mic = Mic {
        ativo,
        dispositivo: dispositivo.filter(|name| !name.trim().is_empty()),
    };
    if mic
        .dispositivo
        .as_ref()
        .is_some_and(|name| name.len() > 512)
    {
        return Err("Nome do microfone inválido.".into());
    }
    let mut prefs = sidecar.hub.settings.lock().await;
    if prefs.mic != mic {
        prefs.mic = mic;
        let running = sidecar.hub.active.lock().await.clone();
        if let Some(run) = running {
            run.controls
                .send(prefs.mic.command())
                .await
                .map_err(|_| "O núcleo parou de responder.")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn replay_salvar(sidecar: State<'_, Sidecar>) -> Result<(), String> {
    if !sidecar.hub.replay_active.load(Ordering::Relaxed) {
        return Err("Ligue o replay antes de salvar um clipe.".into());
    }
    let running = sidecar
        .hub
        .active
        .lock()
        .await
        .clone()
        .ok_or("A captura do replay foi encerrada.")?;
    running
        .controls
        .send(json!({"cmd":"clip"}))
        .await
        .map_err(|_| "O núcleo parou de responder.".into())
}

#[cfg(test)]
mod tests {
    use super::{publish_arguments, valid_capture_source, Command, Path, Publish};

    #[test]
    fn enables_publish_improvements_and_passes_the_probe_only_when_available() {
        let mut input = Publish {
            id: "stream".into(),
            source: "hmonitor:1".into(),
            resolution: "4k".into(),
            fps: 60,
            codec: "av1".into(),
            encoder: "nvenc".into(),
            kbps: 18000,
            audio_pid: Some(10),
            game_audio: None,
            url: "wss://example.test".into(),
            token: "token-only-through-stdin".into(),
        };
        let report = Path::new("Stackcall dados/gpu-probe-v4-report.json");
        for path in [None, Some(report)] {
            let mut command = Command::new("stackcall-core");
            publish_arguments(&mut command, &input, path);
            let flags: Vec<_> = command.as_std().get_args().collect();
            let mut expected = vec![
                "publish",
                "--control-stdin",
                "--limit-capture-fps",
                "--cbr",
                "--adaptive-bitrate",
                "--hardware-quality",
                "--cache-cpu-scaler",
                "--source=hmonitor:1",
                "--url=wss://example.test",
                "--res",
                "4k",
                "--fps",
                "60",
                "--codec",
                "av1",
                "--encoder",
                "nvenc",
                "--bitrate",
                "18000",
                "--audio-pid",
                "10",
            ];
            let app_pid = std::process::id().to_string();
            expected.extend(["--app-pid", &app_pid]);
            if let Some(path) = path {
                expected.extend(["--nvenc-probe", path.to_str().unwrap()]);
            }
            assert_eq!(flags, expected);
        }
        input.game_audio = Some(true);
        let mut command = Command::new("stackcall-core");
        publish_arguments(&mut command, &input, None);
        let flags: Vec<_> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect();
        let pid = std::process::id().to_string();
        // With a known game running (a dev PC with CS2 open), only the game's sound is taken.
        let expected = match crate::jogo::running_game_pid() {
            Some(game) => flags
                .windows(2)
                .any(|args| args == ["--audio-pid", game.to_string().as_str()]),
            None => flags
                .windows(3)
                .any(|args| args == ["--audio-pid", pid.as_str(), "--audio-exclude"]),
        };
        assert!(expected);
    }

    #[test]
    fn accepts_only_ids_returned_by_the_capture_picker() {
        for source in ["hmonitor:1", "hwnd:123456:100"] {
            assert!(valid_capture_source(source));
        }
        for source in [
            "window:Game",
            "hmonitor:0",
            "hmonitor:1\n",
            "hwnd:1:0",
            "hwnd:1:2:3",
        ] {
            assert!(!valid_capture_source(source));
        }
    }
}
