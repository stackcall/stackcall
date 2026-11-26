//! The web app (`/app/`): the same Stackcall interface, for phones and any browser. The files
//! come from `STACKCALL_WEB` (the Docker image builds them into `/web`).
use crate::Config;
use axum::{Router, http::HeaderValue, http::header};
use std::{path::PathBuf, sync::Arc};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

pub fn routes() -> Router<Arc<Config>> {
    let dir = PathBuf::from(std::env::var("STACKCALL_WEB").unwrap_or_else(|_| "/web".into()));
    // LiveKit may live on another host or port (self-host): allow exactly its address.
    let livekit = std::env::var("LIVEKIT_PUBLIC_URL")
        .ok()
        .and_then(|url| url::Url::parse(&url).ok())
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_default();
    let csp = format!(
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' {livekit}; \
         worker-src 'self' blob:; manifest-src 'self'; font-src 'self'; frame-ancestors 'none'; \
         base-uri 'none'; form-action 'none'"
    );
    let serve = ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")));
    Router::new()
        .nest_service("/app", serve)
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_str(&csp).expect("valid CSP"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("microphone=(self), camera=(), geolocation=()"),
        ))
}
