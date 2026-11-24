mod conta;
mod modo_jogo;
mod sidecar;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

const CHANGELOG_URL: &str =
    "https://github.com/stackcall/releases/releases/latest/download/changelog.json";
/// `true` when the window is on screen; the interface stops meters, video and animations otherwise.
const EVENTO_VISIVEL: &str = "stackcall-visivel";

/// Fetches the changelog published with the latest release. Done in Rust because
/// GitHub release downloads do not send CORS headers to the WebView.
#[tauri::command]
async fn remote_changelog() -> Result<String, String> {
    let response = reqwest::Client::new()
        .get(CHANGELOG_URL)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    response.text().await.map_err(|error| error.to_string())
}

fn mostrar(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit(EVENTO_VISIVEL, true);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First plugin: a second launch (deep link from the browser) focuses this one and forwards the URL.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            mostrar(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(sidecar::Sidecar::default())
        .setup(|app| {
            conta::limpar_convite_antigo();
            // Installed builds get the scheme from the NSIS installer; dev runs register it here.
            #[cfg(all(debug_assertions, windows))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            let abrir = MenuItem::with_id(app, "abrir", "Abrir Stackcall", true, None::<&str>)?;
            let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&abrir, &sair])?;
            TrayIconBuilder::with_id("principal")
                .tooltip("Stackcall")
                .icon(app.default_window_icon().cloned().ok_or("sem ícone")?)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "abrir" => mostrar(app),
                    "sair" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        mostrar(tray.app_handle());
                    }
                })
                .build(app)?;
            modo_jogo::iniciar(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing keeps voice running in the tray, like the other voice apps; "Sair" in the tray quits.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit(EVENTO_VISIVEL, false);
            }
            WindowEvent::Resized(_) => {
                let minimizado = window.is_minimized().unwrap_or(false);
                let _ = window.emit(EVENTO_VISIVEL, !minimizado);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            remote_changelog,
            conta::api,
            conta::sessao_existe,
            modo_jogo::modo_jogo_atual,
            sidecar::listar_fontes,
            sidecar::testar_maquina,
            sidecar::iniciar_transmissao,
            sidecar::parar_transmissao,
            sidecar::mudar_bitrate
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Stackcall");
}
