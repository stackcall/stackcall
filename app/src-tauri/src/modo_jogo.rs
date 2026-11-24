//! Game mode: while another app runs full screen in the foreground, the interface stops
//! drawing and the app process drops to below-normal priority. Voice keeps going (it lives in
//! the WebView2 process) and the encoder is started with normal priority (sidecar.rs).

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

const EVENTO: &str = "stackcall-modo-jogo";
static ATIVO: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn modo_jogo_atual() -> bool {
    ATIVO.load(Ordering::Relaxed)
}

#[cfg(windows)]
fn jogo_em_tela_cheia() -> bool {
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let mut estado = 0;
    // SAFETY: plain Win32 queries with valid out pointers.
    unsafe {
        if SHQueryUserNotificationState(&mut estado) != 0
            || !matches!(estado, QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE)
        {
            return false;
        }
        // Our own window in full screen (watching a stream) is not a game.
        let mut pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
        pid != std::process::id()
    }
}

#[cfg(not(windows))]
fn jogo_em_tela_cheia() -> bool {
    false
}

#[cfg(windows)]
fn prioridade(baixa: bool) {
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
    };
    // SAFETY: pseudo handle of the current process.
    unsafe {
        SetPriorityClass(GetCurrentProcess(), if baixa { BELOW_NORMAL_PRIORITY_CLASS } else { NORMAL_PRIORITY_CLASS });
    }
}

#[cfg(not(windows))]
fn prioridade(_baixa: bool) {}

/// Windows has no event for "a full-screen app took the foreground", so a background thread
/// asks every 2 s. It is two cheap syscalls; the interface itself stays event-driven.
pub fn iniciar(app: AppHandle) {
    std::thread::Builder::new()
        .name("modo-jogo".into())
        .spawn(move || loop {
            let agora = jogo_em_tela_cheia();
            if agora != ATIVO.swap(agora, Ordering::Relaxed) {
                prioridade(agora);
                let _ = app.emit(EVENTO, agora);
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        })
        .expect("thread do modo jogo");
}
