use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State as HttpState},
    http::StatusCode,
    routing::post,
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{net::TcpListener, sync::Mutex};

const FILE: &str = "gamestate_integration_stackcall.cfg";
const HEADER: &str = "\"Stackcall GSI\"";

#[derive(Default)]
pub struct Gsi(Mutex<Option<Config>>);

#[derive(Clone, Deserialize, Serialize)]
struct Config {
    port: u16,
    token: uuid::Uuid,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize)]
struct GameState {
    time: Option<String>,
    fase: Option<String>,
}

struct Http {
    app: AppHandle,
    token: String,
    last: Mutex<Option<GameState>>,
}

pub fn restore(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Gsi>();
        let mut running = state.0.lock().await;
        if let Err(error) = start(&app, &mut running, false).await {
            eprintln!("GSI do CS2: {error}");
        }
    });
}

async fn start(app: &AppHandle, running: &mut Option<Config>, create: bool) -> Result<(), String> {
    if running.is_some() {
        return Ok(());
    }
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let file = directory.join("cs2-gsi.json");
    let mut config = match fs::read(&file) {
        Ok(bytes) => match serde_json::from_slice::<Config>(&bytes) {
            Ok(config) if config.port != 0 => Some(config),
            _ if create => None,
            _ => {
                return Err(
                    "A configuração local do GSI está inválida. Reinstale pelo Stackcall.".into(),
                )
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if config.is_none() && !create {
        return Ok(());
    }
    let port = config.as_ref().map_or(0, |config| config.port);
    let localhost = std::net::Ipv4Addr::LOCALHOST;
    let listener = match TcpListener::bind((localhost, port)).await {
        Err(_) if create && port != 0 => {
            config = None;
            TcpListener::bind((localhost, 0)).await
        }
        result => result,
    }
    .map_err(|error| format!("Não foi possível abrir a porta local do GSI: {error}"))?;
    let config = match config {
        Some(config) => config,
        None => {
            let config = Config {
                port: listener
                    .local_addr()
                    .map_err(|error| error.to_string())?
                    .port(),
                token: uuid::Uuid::new_v4(),
            };
            fs::create_dir_all(directory).map_err(|error| error.to_string())?;
            fs::write(
                file,
                serde_json::to_vec(&config).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            config
        }
    };
    let http = Arc::new(Http {
        app: app.clone(),
        token: config.token.to_string(),
        last: Mutex::new(None),
    });
    let router = Router::new()
        .route("/gsi", post(receive))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(http);
    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("GSI do CS2: {error}");
        }
    });
    *running = Some(config);
    Ok(())
}

async fn receive(HttpState(http): HttpState<Arc<Http>>, body: Bytes) -> StatusCode {
    let Ok(json) = serde_json::from_slice::<Value>(&body) else {
        return StatusCode::BAD_REQUEST;
    };
    let Some(game) = parse(&json, &http.token) else {
        return StatusCode::UNAUTHORIZED;
    };
    let mut last = http.last.lock().await;
    if last.as_ref() != Some(&game) {
        let _ = http.app.emit("stackcall-gsi", &game);
        *last = Some(game);
    }
    StatusCode::NO_CONTENT
}

fn parse(json: &Value, token: &str) -> Option<GameState> {
    if json.pointer("/auth/token").and_then(Value::as_str) != Some(token) {
        return None;
    }
    let other_player = json
        .pointer("/provider/steamid")
        .and_then(Value::as_str)
        .zip(json.pointer("/player/steamid").and_then(Value::as_str))
        .is_some_and(|(own, player)| own != player);
    let time = match json.pointer("/player/team").and_then(Value::as_str) {
        Some("CT") if !other_player => Some("CT".into()),
        Some("T") if !other_player => Some("TR".into()),
        _ => None,
    };
    let fase = json
        .pointer("/round/phase")
        .and_then(Value::as_str)
        .or_else(|| json.pointer("/map/phase").and_then(Value::as_str))
        .map(str::to_owned);
    Some(GameState { time, fase })
}

#[tauri::command]
pub async fn gsi_cs2_localizar() -> Option<String> {
    cs2_config().map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn gsi_cs2_instalar(
    app: AppHandle,
    state: State<'_, Gsi>,
    confirmado: bool,
) -> Result<String, String> {
    if !confirmado {
        return Err("Confirme a gravação do arquivo na pasta do CS2.".into());
    }
    let path =
        cs2_config().ok_or("A pasta cfg do CS2 não foi encontrada nas bibliotecas do Steam.")?;
    if path.exists() && !fs::read_to_string(&path).is_ok_and(|text| text.starts_with(HEADER)) {
        return Err(
            "Já existe um arquivo GSI com esse nome que não foi gerado pelo Stackcall.".into(),
        );
    }
    let mut running = state.0.lock().await;
    start(&app, &mut running, true).await?;
    let config = running
        .as_ref()
        .ok_or("O serviço local do GSI não iniciou.")?;
    fs::write(&path, configuration(config))
        .map_err(|error| format!("Não foi possível gravar o arquivo GSI: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

fn configuration(config: &Config) -> String {
    let Config { port, token } = config;
    format!(
        r#"{HEADER}
{{
    "uri" "http://127.0.0.1:{port}/gsi"
    "timeout" "2.0"
    "buffer" "0.1"
    "throttle" "0.5"
    "heartbeat" "15.0"
    "auth" {{ "token" "{token}" }}
    "data" {{ "map" "1" "round" "1" "player_id" "1" }}
}}
"#
    )
}

fn vdf_values<'a>(vdf: &'a str, field: &str) -> Vec<&'a str> {
    vdf.lines()
        .filter_map(|line| {
            let mut pieces = line.split('"');
            pieces.next()?;
            let key = pieces.next()?;
            pieces.next()?;
            let value = pieces.next()?;
            key.eq_ignore_ascii_case(field).then_some(value)
        })
        .collect()
}

fn cs2_in(root: &Path) -> Option<PathBuf> {
    let steamapps = root.join("steamapps");
    let vdf = fs::read_to_string(steamapps.join("libraryfolders.vdf")).unwrap_or_default();
    std::iter::once(root.to_owned())
        .chain(
            vdf_values(&vdf, "path")
                .into_iter()
                .map(|path| PathBuf::from(path.replace(r"\\", r"\"))),
        )
        .find_map(|library| {
            let steamapps = library.join("steamapps");
            let manifest = fs::read_to_string(steamapps.join("appmanifest_730.acf")).ok()?;
            let folder = Path::new(*vdf_values(&manifest, "installdir").first()?);
            if !matches!(
                folder.components().collect::<Vec<_>>().as_slice(),
                [Component::Normal(_)]
            ) {
                return None;
            }
            let cfg = steamapps.join("common").join(folder).join("game/csgo/cfg");
            cfg.is_dir().then(|| cfg.join(FILE))
        })
}

#[cfg(windows)]
fn cs2_config() -> Option<PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt, ptr};
    use windows_sys::{
        core::w,
        Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ},
    };
    let mut root = vec![0u16; 32_768];
    let mut bytes = (root.len() * 2) as u32;
    // SAFETY: the output buffer has `bytes` bytes available and the registry names are terminated.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Valve\Steam"),
            w!("SteamPath"),
            RRF_RT_REG_SZ,
            ptr::null_mut(),
            root.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    if status != 0 {
        return None;
    }
    let used = root.iter().position(|&unit| unit == 0)?;
    if used == 0 {
        return None;
    }
    cs2_in(Path::new(&OsString::from_wide(&root[..used])))
}

#[cfg(not(windows))]
fn cs2_config() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn authenticates_gsi_and_only_reports_the_local_team() {
        let mut json = json!({"auth":{"token":"test"},"provider":{"steamid":"1"},"player":{"steamid":"1","team":"T"},"map":{"phase":"live"},"round":{"phase":"freezetime"}});
        assert_eq!(parse(&json, "wrong"), None);
        assert_eq!(
            parse(&json, "test"),
            Some(GameState {
                time: Some("TR".into()),
                fase: Some("freezetime".into())
            })
        );
        json["player"]["steamid"] = "2".into();
        json["round"] = Value::Null;
        assert_eq!(
            parse(&json, "test"),
            Some(GameState {
                time: None,
                fase: Some("live".into())
            })
        );
    }

    #[test]
    fn finds_cs2_in_a_second_steam_library() {
        let root =
            std::env::temp_dir().join(format!("stackcall-gsi-test-{}", uuid::Uuid::new_v4()));
        let steam = root.join("Steam");
        let library = root.join("Jogos do Steam");
        let cfg = library.join("steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg");
        fs::create_dir_all(&cfg).unwrap();
        fs::create_dir_all(steam.join("steamapps")).unwrap();
        fs::write(
            steam.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"path\" \"{}\"\n",
                library.display().to_string().replace('\\', "\\\\")
            ),
        )
        .unwrap();
        fs::write(
            library.join("steamapps/appmanifest_730.acf"),
            "\"installdir\" \"Counter-Strike Global Offensive\"\n",
        )
        .unwrap();
        assert_eq!(cs2_in(&steam), Some(cfg.join(FILE)));
        fs::remove_dir_all(root).unwrap();
    }
}
