//! Accounts: every porteiro call goes through here so the session token stays in the
//! Windows Credential Manager and never reaches the WebView (docs/PLANO-ABERTO.md).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::net::IpAddr;
use std::time::Duration;
use tauri::Url;

const KEYRING_SERVICE: &str = "io.github.stackcall";

/// The v0.2 invite lived here; v0.3 logs in with accounts, so it is removed once.
pub fn limpar_convite_antigo() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "convite") {
        let _ = entry.delete_credential();
    }
}

/// Origin of a server (`https://host[:port]`). Plain http only on the local network (self-host `--local`).
fn origem(servidor: &str) -> Result<String, String> {
    let url = Url::parse(servidor.trim()).map_err(|_| "Endereço de servidor inválido.")?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Endereço de servidor inválido.".into());
    }
    let host = url.host_str().ok_or("Endereço de servidor inválido.")?;
    let local = host == "localhost"
        || host.ends_with(".local")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| match ip {
                IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
                IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
            });
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("O servidor precisa de https (http só na rede local).".into()),
    }
    Ok(url.origin().ascii_serialization())
}

fn rota_valida(rota: &str) -> bool {
    rota.starts_with("/api/")
        && !rota.contains("..")
        && !rota.contains("//")
        && !rota.chars().any(|c| c == '\\' || c == '#' || c == '@' || c.is_whitespace() || c.is_control())
}

fn entrada(origem: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("sessao:{origem}")).map_err(|e| e.to_string())
}

fn sessao(origem: &str) -> Option<String> {
    entrada(origem).ok()?.get_password().ok()
}

fn apagar_sessao(origem: &str) {
    if let Ok(entry) = entrada(origem) {
        let _ = entry.delete_credential();
    }
}

#[tauri::command]
pub fn sessao_existe(servidor: String) -> bool {
    origem(&servidor).ok().and_then(|o| sessao(&o)).is_some()
}

#[derive(Deserialize)]
pub struct Chamada {
    servidor: String,
    metodo: String,
    rota: String,
    corpo: Option<Value>,
    /// Image upload (avatar, banner): raw bytes plus their type.
    bytes: Option<Vec<u8>>,
    tipo: Option<String>,
}

#[derive(Serialize)]
pub struct Resposta {
    status: u16,
    corpo: Value,
}

#[tauri::command]
pub async fn api(chamada: Chamada) -> Result<Resposta, String> {
    let origem = origem(&chamada.servidor)?;
    if !rota_valida(&chamada.rota) {
        return Err("Rota inválida.".into());
    }
    let metodo = match chamada.metodo.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("Método inválido.".into()),
    };
    // No redirects: the bearer must never follow the request to another host.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.request(metodo, format!("{origem}{}", chamada.rota));
    let token = sessao(&origem);
    if let Some(token) = &token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(bytes) = chamada.bytes {
        let tipo = chamada.tipo.unwrap_or_default();
        if !matches!(tipo.as_str(), "image/webp" | "image/png" | "image/jpeg") || bytes.len() > 1024 * 1024 {
            return Err("Imagem recusada: use PNG, JPEG ou WebP de até 1 MB.".into());
        }
        request = request.header("content-type", tipo).body(bytes);
    } else if let Some(corpo) = chamada.corpo {
        request = request
            .header("content-type", "application/json")
            .body(serde_json::to_vec(&corpo).map_err(|e| e.to_string())?);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Servidor fora do ar ou sem internet.".to_string())?;
    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let mut corpo: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    // Accepting an invite or a device link returns `sessao`: keep it in the vault, hide it from the WebView.
    if let Some(nova) = corpo.as_object_mut().and_then(|o| o.remove("sessao")) {
        if let (Some(nova), true) = (nova.as_str(), (200..300).contains(&status)) {
            entrada(&origem)?.set_password(nova).map_err(|e| e.to_string())?;
        }
    }
    if chamada.rota == "/api/sair" || (status == 401 && token.is_some()) {
        apagar_sessao(&origem);
    }
    Ok(Resposta { status, corpo })
}

#[cfg(test)]
mod tests {
    use super::{origem, rota_valida};

    #[test]
    fn aceita_https_e_http_so_na_rede_local() {
        assert_eq!(origem("https://stackcall.example.test/").unwrap(), "https://stackcall.example.test");
        assert_eq!(origem("http://192.168.0.10:8080").unwrap(), "http://192.168.0.10:8080");
        assert!(origem("http://localhost:3000").is_ok());
        assert!(origem("http://example.test").is_err());
        assert!(origem("http://8.8.8.8").is_err());
        assert!(origem("https://user:pw@example.test").is_err());
        assert!(origem("ftp://example.test").is_err());
        assert!(origem("javascript:alert(1)").is_err());
    }

    #[test]
    fn rota_fica_dentro_da_api() {
        assert!(rota_valida("/api/eu"));
        assert!(rota_valida("/api/grupos/12/salas"));
        assert!(!rota_valida("/media/x.webp"));
        assert!(!rota_valida("/api/../admin"));
        assert!(!rota_valida("/api//evil.test"));
        assert!(!rota_valida("/api/eu@evil.test"));
        assert!(!rota_valida("/api/eu\n"));
    }
}
