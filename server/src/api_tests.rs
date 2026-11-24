use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::Value;
use tower::ServiceExt;

pub(super) fn config(registration: auth::Registration) -> Arc<Config> {
    Arc::new(Config {
        instance_name: "Stackcall teste".into(),
        public_url: "https://example.test/".parse().unwrap(),
        steam: None,
        key: "test_key".into(),
        secret: "test_secret".into(),
        url: "wss://example.test/rtc".into(),
        trusted_proxy: Some("127.0.0.1".parse().unwrap()),
        attempts: Mutex::default(),
        uploads: Mutex::default(),
        db: Mutex::new(db::open(":memory:").unwrap()),
        registration,
        image_jobs: Arc::new(tokio::sync::Semaphore::new(1)),
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

#[tokio::test]
async fn initial_invite_owns_galera_once_even_in_closed_mode() {
    let config = config(auth::Registration::Closed);
    let code = {
        let mut db = config.db.lock().unwrap();
        let code = auth::bootstrap(&mut db).unwrap().unwrap();
        assert!(auth::bootstrap(&mut db).unwrap().is_none());
        code
    };
    let app = app(config);
    let register = |name: &str| {
        send(
            app.clone(),
            Method::POST,
            "/api/auth/cadastro",
            None,
            json!({"nome": name, "senha": PASSWORD, "codigo": code}),
        )
    };
    let (status, first) = register("Primeiro").await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, me) = send(
        app.clone(),
        Method::GET,
        "/api/eu",
        first["sessao"].as_str(),
        Value::Null,
    )
    .await;
    assert_eq!(me["usuario"]["papel_instancia"], "admin");
    assert_eq!(me["grupos"][0]["papel"], "dono");
    assert_eq!(me["grupos"][0]["nome"], "Galera");
    assert_eq!(register("Segundo").await.0, StatusCode::FORBIDDEN);
}

async fn create_room(router: Router, owner: &str, group: &str) -> String {
    let (status, room) = send(
        router,
        Method::POST,
        &format!("/api/grupos/{group}/salas"),
        Some(owner),
        json!({"nome": "Geral"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    room["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn livekit_tokens_use_the_authenticated_user_and_room_ids() {
    use livekit_api::access_token::TokenVerifier;

    let app = app(config(auth::Registration::Open));
    let owner = register(app.clone(), "Dono").await;
    let (_, me) = send(
        app.clone(),
        Method::GET,
        "/api/eu",
        Some(&owner),
        Value::Null,
    )
    .await;
    let id = me["usuario"]["id"].as_str().unwrap();
    let group = create_group(app.clone(), &owner).await;
    let room = create_room(app.clone(), &owner, &group).await;
    let (status, result) = send(
        app,
        Method::POST,
        &format!("/api/salas/{room}/token"),
        Some(&owner),
        json!({"identity": "impostor", "sala": "outra"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let verifier = TokenVerifier::with_api_key("test_key", "test_secret");
    let voice = verifier.verify(result["token"].as_str().unwrap()).unwrap();
    let screen = verifier
        .verify(result["screen_token"].as_str().unwrap())
        .unwrap();
    assert_eq!(voice.sub, id);
    assert_eq!(voice.name, "Dono");
    assert_eq!(voice.video.room, room);
    assert!(voice.video.room_join);
    assert!(!voice.video.room_admin);
    assert_eq!(voice.exp - voice.nbf, 3600);
    assert_eq!(screen.sub, format!("{id}:tela"));
    assert_eq!(screen.video.room, room);
    assert_eq!(screen.exp - screen.nbf, 3600);
    assert_eq!(
        screen.video.can_publish_sources,
        ["screen_share", "screen_share_audio"]
    );
    assert_eq!(screen.video.can_subscribe, Some(false));
    assert_eq!(screen.video.can_publish_data, Some(false));
}

#[tokio::test]
async fn rejects_svg_disguised_as_png_and_oversized_images() {
    let app = app(config(auth::Registration::Open));
    let token = register(app.clone(), "Pessoa").await;
    for (payload, expected) in [
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (vec![0; 1024 * 1024 + 1], StatusCode::PAYLOAD_TOO_LARGE),
    ] {
        let request = Request::put("/api/eu/avatar")
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::from(payload))
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            expected
        );
    }
}

#[tokio::test]
async fn stores_reencoded_webp_under_its_content_hash() {
    let app = app(config(auth::Registration::Open));
    let token = register(app.clone(), "Pessoa").await;
    let mut source = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(16, 16)
        .write_to(&mut source, image::ImageFormat::Png)
        .unwrap();
    let request = Request::put("/api/eu/banner")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(source.into_inner()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let profile: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    let url = profile["banner_url"].as_str().unwrap();
    let response = app
        .oneshot(Request::get(url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/webp");
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );
    let webp = to_bytes(response.into_body(), 8192).await.unwrap();
    assert_eq!(
        image::guess_format(&webp).unwrap(),
        image::ImageFormat::WebP
    );
    use sha2::{Digest, Sha256};
    assert_eq!(
        url,
        format!("/media/{}.webp", auth::hex(&Sha256::digest(&webp)))
    );
}

#[tokio::test]
async fn instance_metadata_matches_the_registration_policy() {
    let app = app(config(auth::Registration::Invite));
    let (status, metadata) = send(app, Method::GET, "/api/instancia", None, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        metadata,
        json!({
            "nome": "Stackcall teste", "versao": "0.3.0", "modo_cadastro": "convite",
            "steam": false, "versao_minima_app": "0.3.0",
        })
    );
}
