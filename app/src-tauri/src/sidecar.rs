use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
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
const CACHE_VERSION: u32 = 3;

#[derive(Default)]
pub struct Sidecar {
    active: Arc<Mutex<Option<Running>>>,
    probe: Mutex<()>,
}

struct Running {
    id: String,
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

async fn query(subcommand: &str, seconds: u64) -> Result<Value, String> {
    let output = timeout(
        Duration::from_secs(seconds),
        core()?
            .arg(subcommand)
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
    query("sources", 30).await
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
                return Ok(report.clone());
            }
        }
    }
    let report = query("probe", 90).await?;
    if let (Some(driver), Some(path)) = (driver, path) {
        let cache = json!({ "version": CACHE_VERSION, "driver": driver, "report": report });
        if let Some(directory) = path.parent() {
            let _ = std::fs::create_dir_all(directory);
            let _ = std::fs::write(path, cache.to_string());
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
    let mut active = sidecar.active.lock().await;
    if active.is_some() {
        return Err("Já existe uma transmissão em andamento.".into());
    }
    let mut command = core()?;
    command
        .args(["publish", "--control-stdin"])
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
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    if let Some(pid) = args.audio_pid {
        command.args(["--audio-pid", &pid.to_string()]);
    }
    #[cfg(windows)]
    command.creation_flags(
        windows_sys::Win32::System::Threading::CREATE_NO_WINDOW
            | windows_sys::Win32::System::Threading::ABOVE_NORMAL_PRIORITY_CLASS,
    );
    let child = command.spawn().map_err(|_| UNAVAILABLE)?;
    #[cfg(windows)]
    opt_out_of_eco_qos(&child);
    let (control_tx, control_rx) = mpsc::channel(8);
    let (started_tx, started_rx) = oneshot::channel();
    let (ended_tx, ended_rx) = watch::channel(false);
    *active = Some(Running {
        id: args.id.clone(),
        controls: control_tx,
        ended: ended_rx,
    });
    drop(active);

    let state = sidecar.active.clone();
    tauri::async_runtime::spawn(async move {
        let mut started = Some(started_tx);
        let result = supervise(&app, &args, child, control_rx, &mut started).await;
        if let Some(started) = started {
            let reason = result
                .as_ref()
                .err()
                .cloned()
                .unwrap_or_else(|| "A transmissão foi cancelada.".into());
            let _ = started.send(Err(reason));
        }
        *state.lock().await = None;
        let _ = ended_tx.send(true);
        let event = match result {
            Ok(()) => json!({"event":"stopped"}),
            Err(reason) => json!({"event":"error", "reason": reason}),
        };
        emit(&app, &args.id, event);
    });
    started_rx.await.map_err(|_| UNAVAILABLE)?
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
    args: &Publish,
    mut child: Child,
    mut controls: mpsc::Receiver<Value>,
    started: &mut Option<oneshot::Sender<Result<(), String>>>,
) -> Result<(), String> {
    let mut stdin = child.stdin.take().ok_or(UNAVAILABLE)?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or(UNAVAILABLE)?).lines();
    stdin
        .write_all(format!("{}\n", args.token).as_bytes())
        .await
        .map_err(|_| UNAVAILABLE)?;
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
                            emit(app, &args.id, event);
                        }
                    }
                    Some("stats" | "pause_changed") => emit(app, &args.id, event),
                    Some("stopped") => break Ok(()),
                    Some("error") => break Err(event["reason"].as_str().unwrap_or(UNAVAILABLE).into()),
                    _ => (),
                }
            }
            control = controls.recv(), if !stopping => {
                let control = control.unwrap_or_else(|| json!({"cmd": "stop"}));
                if control["cmd"] == "stop" {
                    stopping = true;
                    deadline.as_mut().reset(Instant::now() + Duration::from_secs(5));
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
    let running = sidecar.active.lock().await;
    let Some(active) = running.as_ref().filter(|active| active.id == id) else {
        return Ok(());
    };
    let (controls, mut ended) = (active.controls.clone(), active.ended.clone());
    drop(running);
    let _ = controls.send(json!({"cmd":"stop"})).await;
    let _ = ended.wait_for(|ended| *ended).await;
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

async fn send_control(sidecar: &Sidecar, id: &str, command: Value) -> Result<(), String> {
    let controls = sidecar
        .active
        .lock()
        .await
        .as_ref()
        .filter(|running| running.id == id)
        .map(|running| running.controls.clone())
        .ok_or("Nenhuma transmissão em andamento.")?;
    controls
        .send(command)
        .await
        .map_err(|_| "O núcleo parou de responder.".into())
}

#[cfg(test)]
mod tests {
    use super::valid_capture_source;

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
