const KEYRING_SERVICE: &str = "io.github.stackcall";
const KEYRING_USER: &str = "convite";
const CHANGELOG_URL: &str =
    "https://github.com/stackcall/releases/releases/latest/download/changelog.json";

fn invite_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| error.to_string())
}

/// Reads the invite from the Windows Credential Manager. `None` when missing.
#[tauri::command]
fn invite_load() -> Option<String> {
    invite_entry().ok()?.get_password().ok()
}

#[tauri::command]
fn invite_save(value: String) -> Result<(), String> {
    invite_entry()?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn invite_clear() -> Result<(), String> {
    match invite_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            invite_load,
            invite_save,
            invite_clear,
            remote_changelog
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Stackcall");
}
