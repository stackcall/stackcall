use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "falantes";

#[derive(Deserialize, Serialize)]
struct Position {
    x: i32,
    y: i32,
}

fn position_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("falantes-posicao.json"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn falantes_abrir(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return window.show().map_err(|error| error.to_string());
    }
    let window =
        WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?falantes=1".into()))
            .title("Stackcall · Falantes")
            .inner_size(320.0, 96.0)
            .decorations(false)
            .resizable(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
    if let Ok(path) = position_path(&app) {
        if let Some(position) = std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Position>(&bytes).ok())
        {
            let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
        }
    }
    window
        .set_ignore_cursor_events(true)
        .and_then(|()| window.show())
        .map_err(|error| {
            let _ = window.destroy();
            error.to_string()
        })
}

#[tauri::command]
pub async fn falantes_fechar(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn falantes_posicionar(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let path = position_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec(&Position { x, y }).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(LABEL) {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
