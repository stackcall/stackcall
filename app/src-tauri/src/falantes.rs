use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

const LABEL: &str = "falantes";

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeakerSize {
    P,
    M,
    G,
}

impl SpeakerSize {
    fn dimensions(&self, lines: u32) -> LogicalSize<u32> {
        let (width, row) = match self {
            Self::P => (260, 26),
            Self::M => (320, 32),
            Self::G => (400, 40),
        };
        LogicalSize::new(width, 26 + lines.min(8) * row)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpeakerAnchor {
    SupEsq,
    SupDir,
    MeioEsq,
    MeioDir,
    InfEsq,
    InfDir,
    Livre,
}

impl SpeakerAnchor {
    fn position(
        self,
        origin: PhysicalPosition<i32>,
        area: PhysicalSize<u32>,
        size: LogicalSize<u32>,
        scale: f64,
    ) -> Option<PhysicalPosition<i32>> {
        let size = size.to_physical::<u32>(scale);
        let margin = (24.0 * scale).round() as u32;
        let horizontal = area.width.saturating_sub(size.width);
        let vertical = area.height.saturating_sub(size.height);
        let left = margin.min(horizontal / 2);
        let top = margin.min(vertical / 2);
        let right = horizontal - left;
        let bottom = vertical - top;
        let (x, y) = match self {
            Self::SupEsq => (left, top),
            Self::SupDir => (right, top),
            Self::MeioEsq => (left, vertical / 2),
            Self::MeioDir => (right, vertical / 2),
            Self::InfEsq => (left, bottom),
            Self::InfDir => (right, bottom),
            Self::Livre => return None,
        };
        Some(PhysicalPosition::new(
            origin.x + x as i32,
            origin.y + y as i32,
        ))
    }
}

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
    // O WebView2 recusa (0x8007139F) uma segunda janela com argumentos de navegador diferentes
    // dos da principal; por isso repete os do tauri.conf.json.
    let browser_args = app
        .config()
        .app
        .windows
        .first()
        .and_then(|main| main.additional_browser_args.clone());
    let mut builder =
        WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?falantes=1".into()));
    if let Some(args) = browser_args.as_deref() {
        builder = builder.additional_browser_args(args);
    }
    let window = builder
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
pub async fn falantes_redimensionar(
    app: AppHandle,
    tamanho: SpeakerSize,
    linhas: u32,
    posicao: Option<SpeakerAnchor>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or("A janela de falantes está fechada.")?;
    let size = tamanho.dimensions(linhas);
    if let Some(anchor) = posicao.filter(|anchor| !matches!(anchor, SpeakerAnchor::Livre)) {
        let monitor = window
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("O monitor principal não está disponível.")?;
        let work = monitor.work_area();
        if let Some(position) =
            anchor.position(work.position, work.size, size, monitor.scale_factor())
        {
            window
                .set_position(position)
                .map_err(|error| error.to_string())?;
        }
    }
    window.set_size(size).map_err(|error| error.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_rows_and_positions_the_resized_window() {
        assert_eq!(SpeakerSize::P.dimensions(0), LogicalSize::new(260, 26));
        assert_eq!(SpeakerSize::G.dimensions(9), LogicalSize::new(400, 346));
        let size = SpeakerSize::M.dimensions(2);
        assert_eq!(size, LogicalSize::new(320, 90));
        let origin = PhysicalPosition::new(-1200, 20);
        let area = PhysicalSize::new(1200, 800);
        for (anchor, x, y) in [
            (SpeakerAnchor::SupEsq, -1170, 50),
            (SpeakerAnchor::SupDir, -430, 50),
            (SpeakerAnchor::MeioEsq, -1170, 363),
            (SpeakerAnchor::MeioDir, -430, 363),
            (SpeakerAnchor::InfEsq, -1170, 677),
            (SpeakerAnchor::InfDir, -430, 677),
        ] {
            assert_eq!(
                anchor.position(origin, area, size, 1.25),
                Some(PhysicalPosition::new(x, y))
            );
        }
        assert_eq!(
            SpeakerAnchor::Livre.position(origin, area, size, 1.25),
            None
        );
    }
}
