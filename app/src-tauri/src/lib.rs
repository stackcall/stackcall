#[cfg(windows)]
mod atalhos;
#[cfg(windows)]
mod clipes;
mod conta;
mod falantes;
mod gsi;
mod jogo;
mod modo_jogo;
mod sidecar;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent,
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
        update_visibility(&window, true);
    }
}

fn update_visibility(window: &WebviewWindow, visible: bool) {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        let _ = window.with_webview(move |webview| {
            // Tauri runs this closure on the UI thread that owns the controller.
            unsafe {
                if let Ok(webview) = webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_19>())
                {
                    let level = if visible {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    };
                    let _ = webview.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }
    let _ = window.emit(EVENTO_VISIVEL, visible);
}

/// The microphone is the app's own: grant it to our page instead of showing the WebView2 prompt,
/// whose "Block" is remembered in the profile and could only be undone by deleting EBWebView.
/// Windows' own privacy switch still applies; the page explains that one if it blocks.
fn permitir_microfone(window: &WebviewWindow) {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
        use windows::core::PWSTR;

        let _ = window.with_webview(|webview| unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                let nossa = uri.starts_with("http://tauri.localhost")
                    || uri.starts_with("https://tauri.localhost");
                if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE && nossa {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            }));
            let mut token = Default::default();
            let _ = core.add_PermissionRequested(&handler, &mut token);
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// A game in exclusive fullscreen (CS2 at 1280×960) or Parsec shrinks the monitor; the window
/// then hangs off the screen, cut. Every 2 s, bring it back inside the monitor it is on.
fn manter_na_tela(app: tauri::AppHandle) {
    use tauri::{PhysicalPosition, PhysicalSize};
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let Some(window) = app.get_webview_window("main") else {
            continue;
        };
        let livre = window.is_visible().unwrap_or(false)
            && !window.is_minimized().unwrap_or(true)
            && !window.is_maximized().unwrap_or(true)
            && !window.is_fullscreen().unwrap_or(true);
        if !livre {
            continue;
        }
        let monitor = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten());
        let (Some(monitor), Ok(pos), Ok(size)) =
            (monitor, window.outer_position(), window.outer_size())
        else {
            continue;
        };
        let area = monitor.work_area();
        let (ax, ay) = (area.position.x, area.position.y);
        let (aw, ah) = (area.size.width as i32, area.size.height as i32);
        // Only fix what the resolution change broke: a window bigger than the screen or with its
        // center off it. A window the user dragged half off-screen on purpose stays where it is.
        let (cx, cy) = (
            pos.x + size.width as i32 / 2,
            pos.y + size.height as i32 / 2,
        );
        let maior = size.width as i32 > aw || size.height as i32 > ah;
        let fora = cx < ax || cx > ax + aw || cy < ay || cy > ay + ah;
        if !maior && !fora {
            continue;
        }
        let w = (size.width as i32).min(aw);
        let h = (size.height as i32).min(ah);
        let x = pos.x.clamp(ax, ax + aw - w);
        let y = pos.y.clamp(ay, ay + ah - h);
        if (w, h) != (size.width as i32, size.height as i32) {
            let _ = window.set_size(PhysicalSize::new(w as u32, h as u32));
        }
        if (x, y) != (pos.x, pos.y) {
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    });
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder
        // The Win32 registration is process-wide. Only the shortcut worker needs device events.
        .device_event_filter(tauri::DeviceEventFilter::Always)
        .manage(atalhos::Hotkeys::default());
    builder
        // First plugin: a second launch (deep link from the browser) focuses this one and forwards the URL.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            mostrar(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(conta::Accounts::default())
        .manage(sidecar::Sidecar::default())
        .manage(gsi::Gsi::default())
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
            gsi::restore(app.handle().clone());
            manter_na_tela(app.handle().clone());
            if let Some(window) = app.get_webview_window("main") {
                permitir_microfone(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let Some(view) = window.app_handle().get_webview_window(window.label()) else {
                return;
            };
            match event {
                // Closing keeps voice running in the tray, like the other voice apps; "Sair" in the tray quits.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    update_visibility(&view, false);
                }
                WindowEvent::Resized(_) => {
                    let visible = window.is_visible().unwrap_or(true)
                        && !window.is_minimized().unwrap_or(false);
                    update_visibility(&view, visible);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            #[cfg(windows)]
            atalhos::atalhos_definir,
            #[cfg(windows)]
            atalhos::atalhos_gravar,
            remote_changelog,
            conta::api,
            conta::sessao_existe,
            modo_jogo::modo_jogo_atual,
            falantes::falantes_abrir,
            falantes::falantes_fechar,
            falantes::falantes_posicionar,
            falantes::falantes_redimensionar,
            gsi::gsi_cs2_localizar,
            gsi::gsi_cs2_instalar,
            jogo::presenca_jogo_atual,
            sidecar::listar_fontes,
            sidecar::testar_maquina,
            sidecar::iniciar_transmissao,
            sidecar::parar_transmissao,
            sidecar::mudar_bitrate,
            sidecar::mudar_pausa_transmissao,
            sidecar::mudar_faixa_leve,
            sidecar::replay_definir,
            sidecar::replay_atual,
            sidecar::replay_microfone,
            sidecar::replay_salvar,
            #[cfg(windows)]
            clipes::clipes_listar,
            #[cfg(windows)]
            clipes::clipes_apagar
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Stackcall")
        .run(|_app, _event| {
            #[cfg(windows)]
            if matches!(_event, tauri::RunEvent::Exit) {
                _app.state::<atalhos::Hotkeys>().stop();
            }
        });
}
