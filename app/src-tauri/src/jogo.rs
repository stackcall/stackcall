use serde::Serialize;

#[derive(Serialize)]
pub struct ForegroundGame {
    executavel: String,
    nome: String,
}

#[tauri::command]
pub fn presenca_jogo_atual(ativa: bool) -> Option<ForegroundGame> {
    if !ativa {
        return None;
    }
    let executavel = foreground_executable()?;
    let name = friendly_name(&executavel)?;
    Some(ForegroundGame {
        nome: name.to_owned(),
        executavel,
    })
}

const KNOWN_GAMES: &[&str] = &[
    "cs2.exe",
    "valorant-win64-shipping.exe",
    "league of legends.exe",
    "dota2.exe",
    "fortniteclient-win64-shipping.exe",
    "overwatch.exe",
    "r5apex.exe",
    "gta5.exe",
    "gta5_enhanced.exe",
    "rocketleague.exe",
    "minecraft.windows.exe",
    "robloxplayerbeta.exe",
    "eldenring.exe",
];

/// PID of a known game that is running, if any. Streaming a whole screen with a game open
/// sends only the game's sound, so another call app (Discord) or music never reaches viewers.
#[cfg(windows)]
pub fn running_game_pid() -> Option<u32> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    // SAFETY: the snapshot handle is checked and closed; the entry is a plain C struct.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut ok = Process32FirstW(snapshot, &mut entry) != 0;
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
            let exe = String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase();
            if KNOWN_GAMES.contains(&exe.as_str()) {
                found = Some(entry.th32ProcessID);
                break;
            }
            ok = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        found
    }
}

#[cfg(not(windows))]
pub fn running_game_pid() -> Option<u32> {
    None
}

fn friendly_name(exe: &str) -> Option<&str> {
    Some(match exe.to_ascii_lowercase().as_str() {
        "cs2.exe" => "Counter-Strike 2",
        "valorant-win64-shipping.exe" => "VALORANT",
        "league of legends.exe" => "League of Legends",
        "dota2.exe" => "Dota 2",
        "fortniteclient-win64-shipping.exe" => "Fortnite",
        "overwatch.exe" => "Overwatch",
        "r5apex.exe" => "Apex Legends",
        "gta5.exe" | "gta5_enhanced.exe" => "Grand Theft Auto V",
        "rocketleague.exe" => "Rocket League",
        "minecraft.windows.exe" => "Minecraft",
        "robloxplayerbeta.exe" => "Roblox",
        "eldenring.exe" => "Elden Ring",
        "explorer.exe"
        | "searchhost.exe"
        | "startmenuexperiencehost.exe"
        | "lockapp.exe"
        | "applicationframehost.exe"
        | "systemsettings.exe"
        | "taskmgr.exe"
        | "chrome.exe"
        | "msedge.exe"
        | "msedgewebview2.exe"
        | "firefox.exe"
        | "steam.exe"
        | "steamwebhelper.exe"
        | "stackcall.exe"
        | "discord.exe" => return None,
        _ => exe,
    })
}

#[cfg(windows)]
fn foreground_executable() -> Option<String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };
    let mut pid = 0;
    // SAFETY: the APIs receive a writable PID and later a writable UTF-16 buffer.
    unsafe {
        GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
        if pid == 0 || pid == std::process::id() {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut path = vec![0; 32_768];
        let mut len = path.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut len);
        CloseHandle(process);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&path[..len as usize]);
        std::path::Path::new(&path)
            .file_name()?
            .to_str()
            .map(str::to_owned)
    }
}

#[cfg(not(windows))]
fn foreground_executable() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_game_names_and_keeps_the_executable_as_fallback() {
        assert_eq!(friendly_name("CS2.EXE"), Some("Counter-Strike 2"));
        assert_eq!(friendly_name("unknown.exe"), Some("unknown.exe"));
        assert_eq!(friendly_name("explorer.exe"), None);
        assert!(presenca_jogo_atual(false).is_none());
    }
}
