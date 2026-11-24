use axum::{
    Json, Router,
    extract::{ConnectInfo, DefaultBodyLimit, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;

const WINDOW: Duration = Duration::from_secs(60);
const TOKEN_TTL: Duration = Duration::from_secs(3600);

struct Config {
    key: String,
    secret: String,
    url: String,
    invite_hash: [u8; 32],
    trusted_proxy: IpAddr,
    attempts: Mutex<HashMap<IpAddr, (Instant, u8)>>,
}

#[derive(Deserialize)]
struct TokenRequest {
    convite: String,
    nome: String,
    sala: String,
}

#[derive(Serialize)]
struct TokenResponse {
    url: String,
    token: String,
}

fn valid_label(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

async fn limit_token(
    State(config): State<Arc<Config>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let mut ip = peer.ip();
    if ip == config.trusted_proxy {
        // O Caddy substitui o cabecalho pelo IP da conexao.
        if let Some(forwarded) = request.headers().get("x-forwarded-for") {
            ip = forwarded
                .to_str()
                .ok()
                .and_then(|value| value.parse().ok())
                .ok_or(StatusCode::BAD_REQUEST)?;
        }
    }

    {
        let now = Instant::now();
        let mut attempts = config.attempts.lock().expect("rate limiter lock");
        if attempts
            .get(&ip)
            .is_none_or(|(start, _)| now.duration_since(*start) >= WINDOW)
        {
            attempts.retain(|_, (start, _)| now.duration_since(*start) < WINDOW);
            if attempts.len() >= 4096 {
                return Err(StatusCode::TOO_MANY_REQUESTS);
            }
        }
        let (_, count) = attempts.entry(ip).or_insert((now, 0));
        if *count >= 10 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        *count += 1;
    }

    Ok(next.run(request).await)
}

async fn token(
    State(config): State<Arc<Config>>,
    payload: Result<Json<TokenRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<TokenResponse>, StatusCode> {
    let Json(input) = payload.map_err(|error| match error.status() {
        StatusCode::PAYLOAD_TOO_LARGE => StatusCode::PAYLOAD_TOO_LARGE,
        _ => StatusCode::BAD_REQUEST,
    })?;

    // TODO(fase1): substituir o convite compartilhado por contas e convites individuais.
    let provided: [u8; 32] = Sha256::digest(input.convite.as_bytes()).into();
    if !bool::from(provided.ct_eq(&config.invite_hash)) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if !valid_label(&input.nome) || !valid_label(&input.sala) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let token = AccessToken::with_api_key(&config.key, &config.secret)
        .with_identity(&input.nome)
        .with_ttl(TOKEN_TTL)
        .with_grants(VideoGrants {
            room_join: true,
            room: input.sala,
            ..Default::default()
        })
        .to_jwt()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TokenResponse {
        url: config.url.clone(),
        token,
    }))
}

fn app(config: Arc<Config>) -> Router {
    Router::new()
        .route(
            "/api/token",
            post(token).route_layer(middleware::from_fn_with_state(config.clone(), limit_token)),
        )
        .route("/api/rtt", get(|| async { StatusCode::NO_CONTENT }))
        .route(
            "/api/health",
            get(|| async { Json(json!({"ok": true, "versao": env!("CARGO_PKG_VERSION")})) }),
        )
        .route(
            "/api/versao-minima-app",
            get(|| async { Json(json!({"versao_minima_app": "0.0.0"})) }),
        )
        .layer(DefaultBodyLimit::max(4096))
        .with_state(config)
}

fn required(name: &str) -> String {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| panic!("configure {name}"))
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let address = env::var("PORTEIRO_ADDR").unwrap_or_else(|_| "127.0.0.1:8100".into());
    let config = Arc::new(Config {
        key: required("LIVEKIT_API_KEY"),
        secret: required("LIVEKIT_API_SECRET"),
        url: required("LIVEKIT_PUBLIC_URL"),
        invite_hash: Sha256::digest(required("STACKCALL_CONVITE_DEV")).into(),
        // Gateway fixo da rede privada do Compose. Fora do Docker, o proxy usa loopback.
        trusted_proxy: if address == "0.0.0.0:8100" {
            "172.31.240.1".parse().unwrap()
        } else {
            IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        },
        attempts: Mutex::default(),
    });
    let listener = tokio::net::TcpListener::bind(address).await?;
    eprintln!("Porteiro ouvindo em {}", listener.local_addr()?);
    axum::serve(
        listener,
        app(config).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use livekit_api::access_token::TokenVerifier;
    use tower::ServiceExt;

    fn router() -> Router {
        app(Arc::new(Config {
            key: "test_key".into(),
            secret: "test_secret".into(),
            url: "wss://example.test/rtc".into(),
            invite_hash: Sha256::digest(b"test_invite").into(),
            trusted_proxy: "127.0.0.1".parse().unwrap(),
            attempts: Mutex::default(),
        }))
    }

    async fn request(
        router: Router,
        invite: &str,
        name: &str,
        peer: &str,
        forwarded: &str,
    ) -> Response {
        let mut request = Request::post("/api/token")
            .header("content-type", "application/json")
            .header("x-forwarded-for", forwarded)
            .body(Body::from(
                json!({"convite": invite, "nome": name, "sala": "sala-1"}).to_string(),
            ))
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
        router.oneshot(request).await.unwrap()
    }

    #[tokio::test]
    async fn signs_room_token_for_one_hour() {
        let response = request(
            router(),
            "test_invite",
            "Pessoa_1",
            "127.0.0.1:1234",
            "192.0.2.1",
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["url"], "wss://example.test/rtc");
        let claims = TokenVerifier::with_api_key("test_key", "test_secret")
            .verify(body["token"].as_str().unwrap())
            .unwrap();
        assert_eq!(claims.sub, "Pessoa_1");
        assert_eq!(claims.video.room, "sala-1");
        assert!(claims.video.room_join);
        assert!(!claims.video.room_admin);
        assert_eq!(claims.exp - claims.nbf, 3600);
    }

    #[tokio::test]
    async fn rejects_bad_invite_and_name() {
        let app = router();
        for (invite, name, expected) in [
            ("wrong", "valid", StatusCode::UNAUTHORIZED),
            ("test_invite", "invalid name", StatusCode::BAD_REQUEST),
        ] {
            let response = request(app.clone(), invite, name, "127.0.0.1:1234", "192.0.2.1").await;
            assert_eq!(response.status(), expected);
        }
    }

    #[tokio::test]
    async fn only_the_proxy_can_supply_a_client_ip() {
        let app = router();
        for index in 1..=11 {
            let response = request(
                app.clone(),
                "wrong",
                "valid",
                "192.0.2.10:1234",
                &format!("192.0.2.{index}"),
            )
            .await;
            let expected = if index <= 10 {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::TOO_MANY_REQUESTS
            };
            assert_eq!(response.status(), expected);
        }
        let response = request(app, "wrong", "valid", "127.0.0.1:1234", "192.0.2.20").await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
