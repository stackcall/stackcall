//! Accounts: every porteiro call goes through here so the session token stays in the
//! Windows Credential Manager and never reaches the WebView (docs/PLANO-ABERTO.md).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State, Url};

const KEYRING_SERVICE: &str = "io.github.stackcall";

#[derive(Default)]
pub struct Accounts(Mutex<HashMap<String, ScreenAccess>>);

#[derive(Default)]
struct ScreenAccess {
    url: String,
    tokens: VecDeque<String>,
}

impl ScreenAccess {
    fn remember(&mut self, body: &Value) {
        let (Some(url), Some(token)) = (body["url"].as_str(), body["screen_token"].as_str()) else {
            *self = Self::default();
            return;
        };
        if self.url != url {
            self.url = url.into();
            self.tokens.clear();
        }
        // A response from a concurrent room request must not invalidate a just-issued token.
        if self.tokens.len() == 8 {
            self.tokens.pop_front();
        }
        self.tokens.push_back(token.into());
    }
}

impl Accounts {
    pub fn valid_livekit_url(&self, value: &str, token: &str) -> bool {
        if value
            .chars()
            .any(|ch| ch == '\\' || ch.is_control() || ch.is_whitespace())
        {
            return false;
        }
        let Ok(url) = Url::parse(value) else {
            return false;
        };
        let transport = match url.scheme() {
            "https" | "wss" => true,
            "http" | "ws" => matches!(url.host_str(), Some("localhost" | "127.0.0.1")),
            _ => false,
        };
        transport
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && self.0.lock().is_ok_and(|sessions| {
                // The WebView passes the original pair without choosing which server vouched for it.
                sessions.values().any(|access| {
                    access.url == value && access.tokens.iter().any(|saved| saved == token)
                })
            })
    }
}

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
        && !rota
            .chars()
            .any(|c| c == '\\' || c == '#' || c == '@' || c.is_whitespace() || c.is_control())
}

fn entrada(origem: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("sessao:{origem}")).map_err(|e| e.to_string())
}

fn sessao(origem: &str) -> Option<String> {
    entrada(origem).ok()?.get_password().ok()
}

fn rota_autenticada(metodo: &str, path: &str) -> bool {
    let segments: Vec<_> = path.trim_start_matches('/').split('/').collect();
    matches!(
        (metodo, segments.as_slice()),
        ("GET", ["api", "eu" | "salas" | "pessoas" | "convites"])
            | ("POST", ["api", "sair" | "salas" | "convites"])
            | ("POST", ["api", "aparelhos", "link"])
            | ("POST", ["api", "salas", _, "token"])
            | ("POST" | "DELETE", ["api", "amigos", _])
            | ("PATCH", ["api", "eu", "perfil"])
            | ("PUT", ["api", "eu", "avatar" | "banner"])
            | ("PATCH" | "DELETE", ["api", "salas", _])
            | ("DELETE", ["api", "convites" | "pessoas", _])
            | ("DELETE", ["api", "pessoas", _, "aparelhos"])
    )
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
pub async fn api(
    app: AppHandle,
    accounts: State<'_, Accounts>,
    chamada: Chamada,
) -> Result<Resposta, String> {
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
    let url = Url::parse(&format!("{origem}{}", chamada.rota)).map_err(|_| "Rota inválida.")?;
    let mut request = client.request(metodo, url.clone());
    let token = sessao(&origem);
    if let Some(token) = &token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    if let Some(bytes) = chamada.bytes {
        let tipo = chamada.tipo.unwrap_or_default();
        if !matches!(tipo.as_str(), "image/webp" | "image/png" | "image/jpeg")
            || bytes.len() > 1024 * 1024
        {
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
    let sucesso = (200..300).contains(&status);
    let logout = chamada.metodo == "POST" && url.path() == "/api/sair";
    let revogada = status == 401 && rota_autenticada(&chamada.metodo, url.path());
    if let Some(token) = &token {
        if revogada || (logout && sucesso) {
            let mut sessions = accounts.0.lock().map_err(|e| e.to_string())?;
            let entry = entrada(&origem)?;
            // A delayed response must not clear a session that was opened while it was in flight.
            if entry.get_password().is_ok_and(|current| &current == token) {
                entry.delete_credential().map_err(|e| e.to_string())?;
                sessions.remove(&origem);
                if revogada {
                    let _ = app.emit("sessao-encerrada", serde_json::json!({ "origem": origem }));
                }
            }
        }
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let mut corpo: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);

    // Accepting an invite or a device link returns `sessao`: keep it in the vault, hide it from the WebView.
    if let Some(nova) = corpo.as_object_mut().and_then(|o| o.remove("sessao")) {
        if let (Some(nova), true) = (nova.as_str(), sucesso) {
            let mut sessions = accounts.0.lock().map_err(|e| e.to_string())?;
            entrada(&origem)?
                .set_password(nova)
                .map_err(|e| e.to_string())?;
            sessions.remove(&origem);
        }
    }
    if sucesso
        && chamada.metodo == "POST"
        && url.path().strip_prefix("/api/salas/").is_some_and(|route| {
            route
                .strip_suffix("/token")
                .is_some_and(|id| !id.is_empty() && !id.contains('/'))
        })
    {
        let mut sessions = accounts.0.lock().map_err(|e| e.to_string())?;
        if token.is_some() && token == sessao(&origem) {
            sessions.entry(origem).or_default().remember(&corpo);
        }
    }
    Ok(Resposta { status, corpo })
}

#[cfg(test)]
mod tests {
    use super::{origem, rota_autenticada, rota_valida, Accounts};

    #[test]
    fn livekit_aceita_apenas_o_par_de_url_e_token_da_origem() {
        let accounts = Accounts::default();
        let remember = |origin: &str, url: &str, token: &str| {
            accounts
                .0
                .lock()
                .unwrap()
                .entry(origin.into())
                .or_default()
                .remember(&serde_json::json!({"url": url, "screen_token": token}));
        };
        for (origin, url, token) in [
            ("https://a.test", "wss://a.test/rtc", "token-a"),
            ("https://b.test", "wss://video.b.test:444/rtc", "token-b"),
            (
                "http://localhost:8100",
                "ws://localhost:7880",
                "token-local",
            ),
            (
                "http://127.0.0.1:8100",
                "http://127.0.0.1:7880",
                "token-loopback",
            ),
        ] {
            remember(origin, url, token);
            assert!(accounts.valid_livekit_url(url, token));
        }
        remember("https://a.test", "wss://a.test/rtc", "token-concurrent");
        assert!(accounts.valid_livekit_url("wss://a.test/rtc", "token-a"));
        assert!(!accounts.valid_livekit_url("wss://video.b.test:444/rtc", "token-a"));
        assert!(!accounts.valid_livekit_url("wss://a.test/other", "token-a"));
        for url in [
            "ws://192.168.0.10:7880",
            "wss://user@example.test/rtc",
            "wss://example.test/rtc#fragment",
            "wss://example.test/rtc\n",
        ] {
            remember("https://unusable.test", url, "token-unusable");
            assert!(!accounts.valid_livekit_url(url, "token-unusable"));
        }
    }

    #[test]
    fn so_rotas_autenticadas_podem_encerrar_sessao() {
        for (metodo, rota) in [
            ("POST", "/api/aparelhos/entrar"),
            ("POST", "/api/convites/codigo/aceitar"),
            ("GET", "/api/convites/codigo"),
            ("GET", "/api/servidor"),
            ("GET", "/api/desconhecida"),
        ] {
            assert!(!rota_autenticada(metodo, rota));
        }
        for (metodo, rota) in [
            ("GET", "/api/eu"),
            ("POST", "/api/aparelhos/link"),
            ("POST", "/api/salas/geral/token"),
            ("DELETE", "/api/convites/codigo"),
        ] {
            assert!(rota_autenticada(metodo, rota));
        }
    }

    #[test]
    fn aceita_https_e_http_so_na_rede_local() {
        assert_eq!(
            origem("https://stackcall.example.test/").unwrap(),
            "https://stackcall.example.test"
        );
        assert_eq!(
            origem("http://192.168.0.10:8080").unwrap(),
            "http://192.168.0.10:8080"
        );
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
