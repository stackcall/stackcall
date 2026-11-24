use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::Value;
use tower::ServiceExt;

pub(super) fn config(registration: auth::Registration) -> Arc<Config> {
    Arc::new(Config {
        public_url: "https://example.test/".parse().unwrap(),
        steam: None,
        key: "test_key".into(),
        secret: "test_secret".into(),
        url: "wss://example.test/rtc".into(),
        invite_hash: Sha256::digest(b"test_invite").into(),
        rooms: vec!["geral".into()],
        trusted_proxy: Some("127.0.0.1".parse().unwrap()),
        attempts: Mutex::default(),
        uploads: Mutex::default(),
        db: Mutex::new(db::open(":memory:").unwrap()),
        registration,
        password_jobs: Arc::new(tokio::sync::Semaphore::new(2)),
    })
}

pub(super) async fn send(
    router: Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Value,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let mut request = request.body(Body::from(body.to_string())).unwrap();
    request.extensions_mut().insert(ConnectInfo(
        "192.0.2.30:1234".parse::<SocketAddr>().unwrap(),
    ));
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let raw = to_bytes(response.into_body(), 32_768).await.unwrap();
    (status, serde_json::from_slice(&raw).unwrap_or(Value::Null))
}

const PASSWORD: &str = "senha fictícia longa";

pub(super) async fn register(router: Router, name: &str) -> String {
    let (status, body) = send(
        router,
        Method::POST,
        "/api/auth/cadastro",
        None,
        json!({"nome": name, "senha": PASSWORD}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["sessao"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn registers_logs_in_and_revokes_only_the_current_session() {
    let app = app(config(auth::Registration::Open));
    let first = register(app.clone(), "Alice").await;
    let (_, me) = send(
        app.clone(),
        Method::GET,
        "/api/eu",
        Some(&first),
        Value::Null,
    )
    .await;
    assert_eq!(me["usuario"]["papel_instancia"], "admin");
    assert_eq!(me["usuario"]["nome_exibicao"], "Alice");

    let (status, login) = send(
        app.clone(),
        Method::POST,
        "/api/auth/entrar",
        None,
        json!({"nome":"ALICE", "senha": PASSWORD}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let second = login["sessao"].as_str().unwrap();
    assert_ne!(first, second);

    let (status, _) = send(
        app.clone(),
        Method::POST,
        "/api/auth/sair",
        Some(second),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        send(
            app.clone(),
            Method::GET,
            "/api/eu",
            Some(second),
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(app, Method::GET, "/api/eu", Some(&first), Value::Null)
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn rejects_an_expired_session() {
    let config = config(auth::Registration::Open);
    let app = app(config.clone());
    let token = register(app.clone(), "Alice").await;
    config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE sessoes SET expira_em = unixepoch() - 1 WHERE token_hash = ?1",
            [auth::hash(&token)],
        )
        .unwrap();
    assert_eq!(
        send(app, Method::GET, "/api/eu", Some(&token), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invite_registration_requires_an_invite() {
    let app = app(config(auth::Registration::Invite));
    let (status, _) = send(
        app,
        Method::POST,
        "/api/auth/cadastro",
        None,
        json!({"nome": "Alice", "senha": PASSWORD}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
