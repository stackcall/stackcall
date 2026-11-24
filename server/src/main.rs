#[cfg(test)]
mod api_tests;
mod auth;
mod db;
mod groups;
mod profile;
mod steam;

use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Path, Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use futures_util::StreamExt;
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::Serialize;
use serde_json::json;
use std::{
    collections::{HashMap, VecDeque},
    env,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tower_http::cors::CorsLayer;

const MIN_APP_VERSION: &str = "0.3.0";
const WINDOW: Duration = Duration::from_secs(60);
const TOKEN_TTL: Duration = Duration::from_secs(3600);
const TOKEN_LIMIT: u8 = 30;
const RATE_LIMIT_CAPACITY: usize = 4096;
// The app's upload test sends a series of growing blocks for about 5 seconds.
const UPLOAD_LIMIT: u8 = 60;
const UPLOAD_MAX_BYTES: usize = 16 * 1024 * 1024;
const UPLOAD_READ_TIMEOUT: Duration = Duration::from_secs(20);
// Origins of the Tauri app on Windows (release and `tauri dev`).
const APP_ORIGINS: [&str; 3] = [
    "http://tauri.localhost",
    "tauri://localhost",
    "http://127.0.0.1:1420",
];

#[derive(Default)]
struct Attempts {
    counts: HashMap<IpAddr, u8>,
    oldest_first: VecDeque<(IpAddr, Instant)>,
}

struct Config {
    instance_name: String,
    public_url: url::Url,
    steam: Option<steam::Steam>,
    db: Mutex<rusqlite::Connection>,
    registration: auth::Registration,
    password_jobs: Arc<tokio::sync::Semaphore>,
    image_jobs: Arc<tokio::sync::Semaphore>,
    key: String,
    secret: String,
    url: String,
    trusted_proxy: Option<IpAddr>,
    attempts: Mutex<Attempts>,
    uploads: Mutex<Attempts>,
}

#[derive(Serialize)]
struct TokenResponse {
    url: String,
    token: String,
    screen_token: String,
}

fn valid_name(value: &str) -> bool {
    (1..=32).contains(&value.chars().count())
        && !value.chars().any(|ch| ch.is_control() || ch == ':')
}

fn client_ip(config: &Config, peer: SocketAddr, request: &Request) -> Result<IpAddr, StatusCode> {
    let mut ip = peer.ip();
    if Some(ip) == config.trusted_proxy {
        // O Caddy substitui o cabecalho pelo IP da conexao.
        if let Some(forwarded) = request.headers().get("x-forwarded-for") {
            ip = forwarded
                .to_str()
                .ok()
                .and_then(|value| value.parse().ok())
                .ok_or(StatusCode::BAD_REQUEST)?;
        }
    }
    Ok(ip)
}

fn allow(attempts: &Mutex<Attempts>, ip: IpAddr, max: u8) -> Result<(), StatusCode> {
    let ip = match ip.to_canonical() {
        IpAddr::V6(ip) => IpAddr::V6((ip.to_bits() & (u128::MAX << 64)).into()),
        ip => ip,
    };
    let mut attempts = attempts.lock().expect("rate limiter lock");
    let now = Instant::now();
    while attempts
        .oldest_first
        .front()
        .is_some_and(|(_, start)| now.duration_since(*start) >= WINDOW)
    {
        let (expired, _) = attempts.oldest_first.pop_front().unwrap();
        attempts.counts.remove(&expired);
    }
    if !attempts.counts.contains_key(&ip) {
        if attempts.counts.len() == RATE_LIMIT_CAPACITY {
            let (oldest, _) = attempts.oldest_first.pop_front().unwrap();
            attempts.counts.remove(&oldest);
        }
        attempts.oldest_first.push_back((ip, now));
    }
    let count = attempts.counts.entry(ip).or_default();
    if *count >= max {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    *count += 1;
    Ok(())
}

async fn limit_token(
    State(config): State<Arc<Config>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    allow(
        &config.attempts,
        client_ip(&config, peer, &request)?,
        TOKEN_LIMIT,
    )?;
    Ok(next.run(request).await)
}

async fn limit_upload(
    State(config): State<Arc<Config>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    allow(
        &config.uploads,
        client_ip(&config, peer, &request)?,
        UPLOAD_LIMIT,
    )?;
    Ok(next.run(request).await)
}

/// Reads and discards the body, so the app can measure its upload speed.
/// Streams instead of buffering: avoid allocating the entire upload.
async fn upload_test(body: Body) -> Result<Json<serde_json::Value>, StatusCode> {
    let start = Instant::now();
    let bytes = tokio::time::timeout(UPLOAD_READ_TIMEOUT, async {
        let mut bytes = 0usize;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            bytes += chunk.map_err(|_| StatusCode::BAD_REQUEST)?.len();
            if bytes > UPLOAD_MAX_BYTES {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
        }
        Ok(bytes)
    })
    .await
    .map_err(|_| StatusCode::REQUEST_TIMEOUT)??;
    Ok(Json(
        json!({"bytes": bytes, "ms": start.elapsed().as_millis() as u64}),
    ))
}

async fn token(
    State(config): State<Arc<Config>>,
    user: auth::User,
    Path(room): Path<String>,
) -> Result<Json<TokenResponse>, StatusCode> {
    let (name, room, identity) = db::run(config.clone(), move |conn| {
        groups::room_role(conn, &room, &user)?;
        let name = conn
            .query_row(
                "SELECT nome_exibicao FROM usuarios WHERE id = ?1",
                [&user.id],
                |row| row.get::<_, String>(0),
            )
            .map_err(db::internal)?;
        Ok((name, room, user.id))
    })
    .await?;
    let grants = VideoGrants {
        room_join: true,
        room,
        ..Default::default()
    };
    let token = AccessToken::with_api_key(&config.key, &config.secret)
        .with_identity(&identity)
        .with_name(&name)
        .with_ttl(TOKEN_TTL)
        .with_grants(grants.clone())
        .to_jwt()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let screen_token = AccessToken::with_api_key(&config.key, &config.secret)
        .with_identity(&format!("{identity}:tela"))
        .with_name(&name)
        .with_ttl(TOKEN_TTL)
        .with_grants(VideoGrants {
            can_publish: Some(true),
            can_subscribe: Some(false),
            can_publish_data: Some(false),
            can_publish_sources: vec!["screen_share".into(), "screen_share_audio".into()],
            ..grants
        })
        .to_jwt()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TokenResponse {
        url: config.url.clone(),
        token,
        screen_token,
    }))
}

async fn instance(State(config): State<Arc<Config>>) -> Json<serde_json::Value> {
    Json(json!({
        "nome": config.instance_name,
        "versao": env!("CARGO_PKG_VERSION"),
        "modo_cadastro": config.registration.as_str(),
        "steam": config.steam.is_some(),
        "versao_minima_app": MIN_APP_VERSION,
    }))
}

fn app(config: Arc<Config>) -> Router {
    Router::new()
        .merge(auth::routes())
        .merge(steam::routes())
        .merge(groups::routes())
        .merge(profile::routes())
        .route(
            "/api/salas/{id}/token",
            post(token).route_layer(middleware::from_fn_with_state(config.clone(), limit_token)),
        )
        .route(
            "/api/upload-test",
            post(upload_test)
                .route_layer(middleware::from_fn_with_state(config.clone(), limit_upload)),
        )
        .route("/api/instancia", get(instance))
        .route("/api/rtt", get(|| async { StatusCode::NO_CONTENT }))
        .route(
            "/api/health",
            get(|| async { Json(json!({"ok": true, "versao": env!("CARGO_PKG_VERSION")})) }),
        )
        .route(
            "/api/versao-minima-app",
            get(|| async { Json(json!({"versao_minima_app": MIN_APP_VERSION})) }),
        )
        .layer(DefaultBodyLimit::max(4096))
        .layer(
            CorsLayer::new()
                .allow_origin(APP_ORIGINS.map(HeaderValue::from_static))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PATCH,
                    Method::PUT,
                    Method::DELETE,
                ])
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]),
        )
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
    let public_url = url::Url::parse(
        &env::var("INSTANCIA_URL").unwrap_or_else(|_| "http://localhost:8100".into()),
    )
    .map_err(std::io::Error::other)?;
    assert!(
        matches!(public_url.scheme(), "http" | "https")
            && public_url.host().is_some()
            && public_url.username().is_empty()
            && public_url.password().is_none()
            && public_url.path() == "/"
            && public_url.query().is_none()
            && public_url.fragment().is_none(),
        "configure INSTANCIA_URL com a origem pública da instância"
    );
    let steam = (public_url.scheme() == "https")
        .then(|| {
            steam::Steam::new(
                env::var("STEAM_API_KEY")
                    .ok()
                    .filter(|key| !key.trim().is_empty()),
            )
        })
        .transpose()
        .map_err(std::io::Error::other)?;
    let db = db::open(env::var("PORTEIRO_DB").unwrap_or_else(|_| "stackcall.sqlite3".into()))
        .map_err(std::io::Error::other)?;
    let instance_name = env::var("INSTANCIA_NOME").unwrap_or_else(|_| "Stackcall".into());
    assert!(
        valid_name(instance_name.trim()),
        "configure INSTANCIA_NOME com até 32 caracteres"
    );
    let mut config = Config {
        instance_name: instance_name.trim().to_owned(),
        public_url,
        steam,
        db: Mutex::new(db),
        registration: auth::Registration::parse(
            &env::var("MODO_CADASTRO").unwrap_or_else(|_| "convite".into()),
        ),
        image_jobs: Arc::new(tokio::sync::Semaphore::new(1)),
        password_jobs: Arc::new(tokio::sync::Semaphore::new(2)),
        key: required("LIVEKIT_API_KEY"),
        secret: required("LIVEKIT_API_SECRET"),
        url: required("LIVEKIT_PUBLIC_URL"),
        trusted_proxy: env::var("PORTEIRO_TRUSTED_PROXY").ok().map(|ip| {
            ip.parse()
                .expect("configure PORTEIRO_TRUSTED_PROXY com um IP")
        }),
        attempts: Mutex::default(),
        uploads: Mutex::default(),
    };
    let listener = tokio::net::TcpListener::bind(address).await?;
    if let Some(code) = auth::bootstrap(config.db.get_mut().expect("new database lock"))
        .map_err(std::io::Error::other)?
    {
        eprintln!(
            "Convite do primeiro admin: {}",
            groups::invite_url(&config.public_url, &code)
        );
    }
    let config = Arc::new(config);
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
    use tower::ServiceExt;

    fn router() -> Router {
        app(api_tests::config(auth::Registration::Open))
    }

    async fn request(router: Router, peer: &str, forwarded: &str) -> Response {
        let mut request = Request::post("/api/salas/geral/token")
            .header("x-forwarded-for", forwarded)
            .body(Body::empty())
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
        router.oneshot(request).await.unwrap()
    }

    #[tokio::test]
    async fn upload_test_discards_body_and_caps_size() {
        for (size, expected) in [
            (1024 * 1024, StatusCode::OK),
            (UPLOAD_MAX_BYTES + 1, StatusCode::PAYLOAD_TOO_LARGE),
        ] {
            let mut request = Request::post("/api/upload-test")
                .body(Body::from(vec![0u8; size]))
                .unwrap();
            request.extensions_mut().insert(ConnectInfo(
                "192.0.2.30:1234".parse::<SocketAddr>().unwrap(),
            ));
            let response = router().oneshot(request).await.unwrap();
            assert_eq!(response.status(), expected);
            if expected == StatusCode::OK {
                let body = to_bytes(response.into_body(), 4096).await.unwrap();
                let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(body["bytes"], size);
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn upload_times_out_if_the_body_never_finishes() {
        let body = Body::from_stream(futures_util::stream::pending::<
            Result<axum::body::Bytes, std::io::Error>,
        >());
        let mut request = Request::post("/api/upload-test").body(body).unwrap();
        request.extensions_mut().insert(ConnectInfo(
            "192.0.2.30:1234".parse::<SocketAddr>().unwrap(),
        ));
        let start = tokio::time::Instant::now();
        let response = router().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
        assert_eq!(start.elapsed(), UPLOAD_READ_TIMEOUT);
    }

    #[tokio::test]
    async fn answers_cors_preflight_for_the_app_only() {
        for (origin, allowed) in [
            ("http://tauri.localhost", true),
            ("https://evil.example", false),
        ] {
            let request = Request::options("/api/salas/geral/token")
                .header("origin", origin)
                .header("access-control-request-method", "POST")
                .header("access-control-request-headers", "content-type")
                .body(Body::empty())
                .unwrap();
            let response = router().oneshot(request).await.unwrap();
            let header = response.headers().get("access-control-allow-origin");
            assert_eq!(
                header.map(|h| h.to_str().unwrap()),
                allowed.then_some(origin)
            );
        }
    }

    #[tokio::test]
    async fn only_the_proxy_can_supply_a_client_ip() {
        let app = router();
        for index in 1..=TOKEN_LIMIT + 1 {
            let response =
                request(app.clone(), "192.0.2.10:1234", &format!("192.0.2.{index}")).await;
            let expected = if index <= TOKEN_LIMIT {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::TOO_MANY_REQUESTS
            };
            assert_eq!(response.status(), expected);
        }
        let response = request(app, "127.0.0.1:1234", "192.0.2.20").await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_limit_groups_ipv6_addresses_in_the_same_prefix() {
        let app = router();
        let proxy = "127.0.0.1:1234";
        for _ in 0..30 {
            let result = request(app.clone(), proxy, "2001:db8:0:1::1").await;
            assert_eq!(result.status(), StatusCode::UNAUTHORIZED);
        }
        let result = request(app.clone(), proxy, "2001:db8:0:1::2").await;
        assert_eq!(result.status(), StatusCode::TOO_MANY_REQUESTS);
        let result = request(app, proxy, "2001:db8:0:2::1").await;
        assert_eq!(result.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn full_table_admits_new_ip_and_evicts_oldest() {
        let attempts = Mutex::new(Attempts::default());
        for index in 0..RATE_LIMIT_CAPACITY {
            let ip = IpAddr::V4((index as u32).into());
            assert_eq!(allow(&attempts, ip, 1), Ok(()));
        }
        let new_ip = IpAddr::V4((RATE_LIMIT_CAPACITY as u32).into());
        assert_eq!(allow(&attempts, new_ip, 1), Ok(()));
        let attempts = attempts.into_inner().unwrap();
        assert_eq!(attempts.counts.len(), RATE_LIMIT_CAPACITY);
        assert!(!attempts.counts.contains_key(&"0.0.0.0".parse().unwrap()));
        assert!(attempts.counts.contains_key(&new_ip));
    }
}
