#[cfg(test)]
mod api_tests;
mod audio;
mod auth;
mod calls;
mod db;
mod invites;
mod livekit;
mod moderation;
mod people;
mod profile;
mod rooms;
mod sleep;
mod soundboard;

use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
};
use futures_util::StreamExt;
use serde_json::json;
use std::{
    collections::{HashMap, VecDeque},
    env,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tower_http::cors::CorsLayer;
use url::Url;

const MIN_APP_VERSION: &str = "0.3.0";
const WINDOW: Duration = Duration::from_secs(60);
const RATE_LIMIT_CAPACITY: usize = 4096;
const UPLOAD_LIMIT: u8 = 60;
const UPLOAD_MAX_BYTES: usize = 16 * 1024 * 1024;
const UPLOAD_READ_TIMEOUT: Duration = Duration::from_secs(20);
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
    livekit: livekit::LiveKit,
    sleep: Option<sleep::Sleep>,
    server_name: String,
    public_url: Url,
    members_can_invite: bool,
    db: Mutex<rusqlite::Connection>,
    trusted_proxy: Option<IpAddr>,
    invite_attempts: Mutex<Attempts>,
    api_attempts: Mutex<Attempts>,
    uploads: Mutex<Attempts>,
    image_jobs: Arc<tokio::sync::Semaphore>,
    sound_jobs: Arc<tokio::sync::Semaphore>,
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

async fn api_policy(
    State(config): State<Arc<Config>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();
    let method = request.method();
    let invite = path.strip_prefix("/api/convites/");
    let preview =
        method == Method::GET && invite.is_some_and(|code| !code.is_empty() && !code.contains('/'));
    let accept = method == Method::POST
        && invite
            .and_then(|route| route.strip_suffix("/aceitar"))
            .is_some_and(|code| !code.is_empty() && !code.contains('/'));
    let device = method == Method::POST && path == "/api/aparelhos/entrar";
    let bucket = if path.starts_with("/c/") || preview || accept || device {
        Some((&config.invite_attempts, 10))
    } else if path.starts_with("/api/")
        && !matches!(
            path,
            "/api/health" | "/api/rtt" | "/api/upload-test" | "/api/versao-minima-app"
        )
    {
        Some((&config.api_attempts, 30))
    } else {
        None
    };
    if let Some((bucket, limit)) = bucket
        && request.method() != Method::OPTIONS
    {
        let peer = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
            .0;
        allow(bucket, client_ip(&config, peer, &request)?, limit)?;
    }
    let no_cache = path.starts_with("/api/") || path.starts_with("/c/");
    let mut response = next.run(request).await;
    if no_cache && !response.headers().contains_key(header::CACHE_CONTROL) {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    Ok(response)
}

async fn server_info(State(config): State<Arc<Config>>) -> Json<serde_json::Value> {
    Json(json!({
        "nome": config.server_name,
        "versao": env!("CARGO_PKG_VERSION"),
        "versao_minima_app": MIN_APP_VERSION,
        "membros_convidam": config.members_can_invite,
    }))
}

fn app(config: Arc<Config>) -> Router {
    Router::new()
        .merge(auth::routes())
        .merge(invites::routes())
        .merge(rooms::routes())
        .merge(moderation::routes())
        .merge(people::routes())
        .merge(calls::routes())
        .merge(profile::routes())
        .merge(soundboard::routes())
        .route(
            "/api/upload-test",
            post(upload_test)
                .route_layer(middleware::from_fn_with_state(config.clone(), limit_upload)),
        )
        .route("/api/servidor", get(server_info))
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
        .layer(middleware::from_fn_with_state(config.clone(), api_policy))
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
                .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
                .expose_headers([header::RETRY_AFTER]),
        )
        .with_state(config)
}

fn origin(value: &str) -> std::io::Result<Url> {
    let url = Url::parse(value).map_err(std::io::Error::other)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(std::io::Error::other(
            "configure uma origem HTTP ou HTTPS sem caminho",
        ));
    }
    Ok(url)
}

fn required(name: &str) -> std::io::Result<String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| std::io::Error::other(format!("configure {name}")))
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let address = env::var("PORTEIRO_ADDR").unwrap_or_else(|_| "127.0.0.1:8100".into());
    let public_url =
        origin(&env::var("SERVIDOR_URL").unwrap_or_else(|_| "http://localhost:8100".into()))?;
    let livekit = livekit::LiveKit::new(
        required("LIVEKIT_API_KEY")?,
        required("LIVEKIT_API_SECRET")?,
        required("LIVEKIT_PUBLIC_URL")?,
        origin(
            &env::var("LIVEKIT_INTERNAL_URL").unwrap_or_else(|_| "http://127.0.0.1:7880".into()),
        )?,
    )
    .map_err(std::io::Error::other)?;
    let sleep = sleep::Sleep::from_env()?;
    let mut conn = db::open(env::var("PORTEIRO_DB").unwrap_or_else(|_| "stackcall.sqlite3".into()))
        .map_err(std::io::Error::other)?;
    let configured_name = env::var("SERVIDOR_NOME").ok();
    let configured_members = env::var("MEMBROS_CONVIDAM").ok();
    if configured_name
        .as_deref()
        .is_some_and(|name| !valid_name(name.trim()))
        || configured_members
            .as_deref()
            .is_some_and(|flag| !matches!(flag, "true" | "false"))
    {
        return Err(std::io::Error::other(
            "revise SERVIDOR_NOME e MEMBROS_CONVIDAM",
        ));
    }
    let (server_name, members_can_invite) = db::settings(
        &mut conn,
        configured_name.as_deref().map(str::trim),
        configured_members.as_deref(),
    )
    .map_err(std::io::Error::other)?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    let trusted_proxy = env::var("PORTEIRO_TRUSTED_PROXY")
        .ok()
        .map(|ip| ip.parse::<IpAddr>())
        .transpose()
        .map_err(std::io::Error::other)?;
    if let Some(code) = invites::bootstrap(&mut conn).map_err(std::io::Error::other)? {
        eprintln!(
            "Convite do dono: {}",
            invites::invite_url(&public_url, &code)
        );
    }
    let config = Arc::new(Config {
        livekit,
        sleep,
        server_name,
        public_url,
        members_can_invite,
        trusted_proxy,
        db: Mutex::new(conn),
        invite_attempts: Mutex::default(),
        api_attempts: Mutex::default(),
        uploads: Mutex::default(),
        image_jobs: Arc::new(tokio::sync::Semaphore::new(1)),
        sound_jobs: Arc::new(tokio::sync::Semaphore::new(1)),
    });
    sleep::monitor(config.clone());
    eprintln!("Porteiro ouvindo em {}", listener.local_addr()?);
    axum::serve(
        listener,
        app(config).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
}
