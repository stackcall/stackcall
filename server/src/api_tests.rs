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

async fn create_group(router: Router, owner: &str) -> String {
    let (status, group) = send(
        router,
        Method::POST,
        "/api/grupos",
        Some(owner),
        json!({"nome": "Galera de teste"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    group["id"].as_str().unwrap().to_owned()
}

async fn create_invite(router: Router, owner: &str, group: &str, uses: i64) -> Value {
    let (status, invite) = send(
        router,
        Method::POST,
        &format!("/api/grupos/{group}/convites"),
        Some(owner),
        json!({"usos_max": uses}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    invite
}

#[tokio::test(flavor = "multi_thread")]
async fn a_single_use_invite_admits_exactly_one_of_twenty_concurrent_accounts() {
    let config = config(auth::Registration::Open);
    let app = app(config.clone());
    let owner = register(app.clone(), "Dono").await;
    let group = create_group(app.clone(), &owner).await;
    let invite = create_invite(app.clone(), &owner, &group, 1).await;
    let mut users = Vec::new();
    {
        let mut conn = config.db.lock().unwrap();
        let tx = conn.transaction().unwrap();
        for _ in 0..20 {
            let user = auth::id();
            tx.execute(
                "INSERT INTO usuarios (id, nome_exibicao, steam_id, criado_em, papel_instancia)
                 VALUES (?1, 'Visitante', ?1, unixepoch(), 'membro')",
                [&user],
            )
            .unwrap();
            users.push(auth::issue_session(&tx, &user, None).unwrap().sessao);
        }
        tx.commit().unwrap();
    }
    let path = format!(
        "/api/convites/{}/aceitar",
        invite["codigo"].as_str().unwrap()
    );
    let results = futures_util::future::join_all(
        users
            .iter()
            .map(|token| send(app.clone(), Method::POST, &path, Some(token), Value::Null)),
    )
    .await;
    assert_eq!(
        results
            .iter()
            .filter(|result| result.0 == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.0 == StatusCode::NOT_FOUND)
            .count(),
        19
    );
    let members: i64 = config
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM membros WHERE grupo_id = ?1",
            [&group],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(members, 2);
}

#[tokio::test]
async fn expired_and_revoked_invites_fail_identically() {
    let config = config(auth::Registration::Open);
    let app = app(config.clone());
    let owner = register(app.clone(), "Dono").await;
    let member = register(app.clone(), "Visitante").await;
    let group = create_group(app.clone(), &owner).await;
    let revoked = create_invite(app.clone(), &owner, &group, 10).await;
    let expired = create_invite(app.clone(), &owner, &group, 10).await;
    let code = revoked["codigo"].as_str().unwrap();
    let (status, preview) = send(
        app.clone(),
        Method::GET,
        &format!("/api/convites/{code}"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview["convidado_por"], "Dono");
    assert_eq!(preview["grupo"], "Galera de teste");
    let (status, _) = send(
        app.clone(),
        Method::DELETE,
        &format!("/api/convites/{}", revoked["id"].as_str().unwrap()),
        Some(&owner),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE convites SET expira_em = unixepoch() - 1 WHERE id = ?1",
            [expired["id"].as_str().unwrap()],
        )
        .unwrap();
    let response = |code: &str| {
        let app = app.clone();
        let member = member.clone();
        let path = format!("/api/convites/{code}");
        async move {
            let preview = send(app.clone(), Method::GET, &path, None, Value::Null).await;
            let accept = send(
                app,
                Method::POST,
                &format!("{path}/aceitar"),
                Some(&member),
                Value::Null,
            )
            .await;
            (preview, accept)
        }
    };
    let expected = (
        StatusCode::NOT_FOUND,
        json!({"erro": "Convite indisponível"}),
    );
    assert_eq!(response(code).await, (expected.clone(), expected.clone()));
    assert_eq!(
        response(expired["codigo"].as_str().unwrap()).await,
        (expected.clone(), expected)
    );
}
