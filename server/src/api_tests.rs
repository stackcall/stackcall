use super::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use livekit_api::access_token::TokenVerifier;
use serde_json::Value;
use tower::ServiceExt;

struct Fixture {
    app: Router,
    config: Arc<Config>,
    owner_code: String,
    online: Arc<Mutex<Vec<String>>>,
    subrooms: Arc<Mutex<HashMap<String, Vec<String>>>>,
    commands: Arc<Mutex<Vec<&'static str>>>,
    kicked: Arc<Mutex<Vec<String>>>,
    livekit: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.livekit.abort();
    }
}

async fn fixture(members_can_invite: bool) -> Fixture {
    fixture_with_sleep(members_can_invite, None).await
}

async fn fixture_with_sleep(members_can_invite: bool, idle: Option<Duration>) -> Fixture {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let internal_url: Url = format!("http://{}", listener.local_addr().unwrap())
        .parse()
        .unwrap();
    let online = Arc::new(Mutex::new(Vec::<String>::new()));
    let subrooms = Arc::new(Mutex::new(HashMap::<String, Vec<String>>::new()));
    let commands = Arc::new(Mutex::new(Vec::new()));
    let kicked = Arc::new(Mutex::new(Vec::<String>::new()));
    let livekit = tokio::spawn({
        let online = online.clone();
        let subrooms = subrooms.clone();
        let commands = commands.clone();
        let kicked = kicked.clone();
        async move {
            let api = Router::new()
                .route(
                    "/start",
                    post({
                        let commands = commands.clone();
                        move || async move {
                            commands.lock().unwrap().push("start");
                            StatusCode::NO_CONTENT
                        }
                    }),
                )
                .route(
                    "/stop",
                    post(move || async move {
                        commands.lock().unwrap().push("stop");
                        StatusCode::NO_CONTENT
                    }),
                )
                .route(
                    "/twirp/livekit.RoomService/ListRooms",
                    post({
                        let subrooms = subrooms.clone();
                        move || async move {
                            let mut rooms = vec![json!({"name":"room-in-use"})];
                            rooms.extend(
                                subrooms
                                    .lock()
                                    .unwrap()
                                    .keys()
                                    .map(|name| json!({"name":name})),
                            );
                            Json(json!({"rooms":rooms}))
                        }
                    }),
                )
                .route(
                    "/twirp/livekit.RoomService/ListParticipants",
                    post(move |Json(body): Json<Value>| async move {
                        let room = body["room"].as_str().unwrap();
                        let people = if room == "room-in-use" {
                            online.lock().unwrap().clone()
                        } else {
                            subrooms
                                .lock()
                                .unwrap()
                                .get(room)
                                .cloned()
                                .unwrap_or_default()
                        };
                        let identities: Vec<_> = people
                            .iter()
                            .map(|id| {
                                json!({"identity": id, "tracks": [
                                    {"sid":"microphone", "source":"MICROPHONE"},
                                    {"sid":"screen-audio", "source":"SCREEN_SHARE_AUDIO"}
                                ]})
                            })
                            .collect();
                        Json(json!({"participants": identities}))
                    }),
                )
                .route(
                    "/twirp/livekit.RoomService/MutePublishedTrack",
                    post(|Json(body): Json<Value>| async move {
                        assert_eq!(body["room"], "room-in-use");
                        assert_eq!(body["trackSid"], "microphone");
                        assert_eq!(body["muted"], true);
                        StatusCode::OK
                    }),
                )
                .route(
                    "/twirp/livekit.RoomService/MoveParticipant",
                    post(
                        |headers: axum::http::HeaderMap, Json(body): Json<Value>| async move {
                            let jwt = headers[header::AUTHORIZATION]
                                .to_str()
                                .unwrap()
                                .strip_prefix("Bearer ")
                                .unwrap();
                            let claims = TokenVerifier::with_api_key("test_key", "test_secret")
                                .verify(jwt)
                                .unwrap();
                            assert_eq!(claims.video.room, body["room"]);
                            assert_eq!(claims.video.destination_room, body["destinationRoom"]);
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(json!({"code":"unknown","msg":"not implemented"})),
                            )
                        },
                    ),
                )
                .route(
                    "/twirp/livekit.RoomService/RemoveParticipant",
                    post(move |Json(body): Json<Value>| async move {
                        assert_eq!(body["room"], "room-in-use");
                        kicked
                            .lock()
                            .unwrap()
                            .push(body["identity"].as_str().unwrap().into());
                        Json(json!({}))
                    }),
                );
            axum::serve(listener, api).await.unwrap();
        }
    });
    let mut db = db::open(":memory:").unwrap();
    let owner_code = invites::bootstrap(&mut db).unwrap().unwrap();
    assert!(invites::bootstrap(&mut db).unwrap().is_none());
    let config = Arc::new(Config {
        sleep: idle.map(|idle| sleep::Sleep::new(idle, internal_url.clone()).unwrap()),
        server_name: "Galera teste".into(),
        public_url: "https://example.test/".parse().unwrap(),
        members_can_invite,
        image_jobs: Arc::new(tokio::sync::Semaphore::new(1)),
        db: Mutex::new(db),
        livekit: livekit::LiveKit::new(
            "test_key".into(),
            "test_secret".into(),
            "wss://example.test/rtc".into(),
            internal_url,
        )
        .unwrap(),
        trusted_proxy: Some("127.0.0.1".parse().unwrap()),
        invite_attempts: Mutex::default(),
        api_attempts: Mutex::default(),
        uploads: Mutex::default(),
    });
    Fixture {
        app: app(config.clone()),
        config,
        owner_code,
        online,
        subrooms,
        commands,
        kicked,
        livekit,
    }
}

fn request(
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Body,
    peer: SocketAddr,
) -> Request<Body> {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(session) = token {
        req = req.header(header::AUTHORIZATION, format!("Bearer {session}"));
    }
    let mut req = req.body(body).unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    req
}

async fn send(
    app: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    value: Value,
) -> (StatusCode, Value) {
    let req = request(
        method,
        uri,
        token,
        Body::from(value.to_string()),
        "192.0.2.200:1234".parse().unwrap(),
    );
    result(app, req).await
}

async fn result(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let raw = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
    (status, serde_json::from_slice(&raw).unwrap_or(Value::Null))
}

async fn join(app: &Router, code: &str, name: &str) -> Value {
    let (code_status, account) = send(
        app,
        Method::POST,
        &format!("/api/convites/{code}/aceitar"),
        None,
        json!({"nome":name, "aparelho":"PC teste"}),
    )
    .await;
    assert_eq!(code_status, StatusCode::CREATED, "{account}");
    account
}

fn session(account: &Value) -> &str {
    account["sessao"].as_str().unwrap()
}

fn id(account: &Value) -> &str {
    account["usuario"]["id"].as_str().unwrap()
}

async fn make_invite(app: &Router, owner: &str) -> Value {
    let (status, invite) = send(app, Method::POST, "/api/convites", Some(owner), json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(invite["usos_max"], 1);
    invite
}

async fn member(app: &Router, owner: &str) -> Value {
    let invite = make_invite(app, owner).await;
    join(app, invite["codigo"].as_str().unwrap(), "Membro").await
}

#[tokio::test]
async fn livekit_sleeps_only_after_idle_and_starts_on_an_authenticated_token_request() {
    let fixture = fixture_with_sleep(false, Some(Duration::from_millis(20))).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let sleep = fixture.config.sleep.as_ref().unwrap();
    let livekit = &fixture.config.livekit;
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute("INSERT INTO salas VALUES ('room-in-use', 'Em uso', 99)", [])
        .unwrap();
    sleep.check_idle(livekit).await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    fixture
        .online
        .lock()
        .unwrap()
        .push(format!("{}:tela", id(&owner)));
    sleep.check_idle(livekit).await;
    assert!(fixture.commands.lock().unwrap().is_empty());
    fixture.online.lock().unwrap().clear();
    sleep.check_idle(livekit).await;
    tokio::time::sleep(Duration::from_millis(30)).await;
    sleep.check_idle(livekit).await;
    assert_eq!(*fixture.commands.lock().unwrap(), ["stop"]);

    let uri = "/api/salas/room-in-use/token";
    assert_eq!(
        send(app, Method::POST, uri, None, Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            app,
            Method::GET,
            "/api/salas",
            Some(session(&owner)),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(*fixture.commands.lock().unwrap(), ["stop"]);
    let token = || send(app, Method::POST, uri, Some(session(&owner)), Value::Null);
    assert_eq!(
        token().await,
        (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"erro":"livekit_acordando"})
        )
    );
    let mut response = (StatusCode::SERVICE_UNAVAILABLE, Value::Null);
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        response = token().await;
        if response.0 == StatusCode::OK {
            break;
        }
    }
    assert_eq!(response.0, StatusCode::OK);
    assert!(response.1["token"].is_string());
    assert_eq!(*fixture.commands.lock().unwrap(), ["stop", "start"]);
}

#[tokio::test]
async fn cs2_rooms_have_stable_team_ids_and_are_listed_only_while_occupied() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let player = member(app, session(&owner)).await;
    let session = Some(session(&player));
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute("INSERT INTO salas VALUES ('cs', 'CS', 1)", [])
        .unwrap();
    let enter = |room: &'static str, team: &'static str| async move {
        send(
            app,
            Method::POST,
            &format!("/api/salas/{room}/cs2/token"),
            session,
            json!({"time":team}),
        )
        .await
    };
    assert_eq!(
        enter("cs", "invalid").await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(enter("missing", "ct").await.0, StatusCode::NOT_FOUND);
    assert_eq!(enter("cs:cs:ct", "ct").await.0, StatusCode::NOT_FOUND);
    let (status, ct) = enter("cs", "ct").await;
    assert_eq!(status, StatusCode::OK);
    let (status, tr) = enter("cs", "tr").await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(ct["sala_id"], tr["sala_id"]);
    assert_eq!(enter("cs", "ct").await.1["sala_id"], ct["sala_id"]);
    for field in ["token", "screen_token"] {
        let claims = TokenVerifier::with_api_key("test_key", "test_secret")
            .verify(ct[field].as_str().unwrap())
            .unwrap();
        assert_eq!(claims.video.room, ct["sala_id"]);
    }
    let child = ct["sala_id"].as_str().unwrap();
    let rooms = || async {
        let (_, rooms) = send(app, Method::GET, "/api/salas", session, Value::Null).await;
        rooms
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == child)
            .cloned()
    };
    assert!(rooms().await.is_none());
    fixture.subrooms.lock().unwrap().insert(
        child.into(),
        vec![id(&player).into(), format!("{}:tela", id(&player))],
    );
    let room = rooms().await.unwrap();
    assert_eq!(room["nome"], "CS · CT");
    assert_eq!(room["pai_id"], "cs");
    assert_eq!(room["time"], "ct");
    assert_eq!(room["pessoas"], 1);
    assert_eq!(room["no_ar"], true);
    let (status, token) = send(
        app,
        Method::POST,
        &format!("/api/salas/{child}/token"),
        session,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(token["sala_id"], child);
    fixture
        .subrooms
        .lock()
        .unwrap()
        .get_mut(child)
        .unwrap()
        .clear();
    assert!(rooms().await.is_none());
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute("DELETE FROM salas WHERE id = 'cs'", [])
        .unwrap();
    assert_eq!(enter("cs", "ct").await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        send(
            app,
            Method::POST,
            &format!("/api/salas/{child}/token"),
            session,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

async fn poke(app: &Router, sender: &Value, recipient: &str, note: &str) -> StatusCode {
    send(
        app,
        Method::POST,
        "/api/cutucar",
        Some(session(sender)),
        json!({"para":recipient,"recado":note}),
    )
    .await
    .0
}

async fn received_pokes(app: &Router, recipient: &Value) -> Vec<Value> {
    let (status, profiles) = send(
        app,
        Method::GET,
        "/api/pessoas",
        Some(session(recipient)),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let profiles = profiles.as_array().unwrap();
    assert!(
        profiles
            .iter()
            .filter(|person| person["id"] != id(recipient))
            .all(|person| person.get("cutucadas").is_none())
    );
    profiles
        .iter()
        .find(|person| person["id"] == id(recipient))
        .unwrap()["cutucadas"]
        .as_array()
        .unwrap()
        .clone()
}

#[tokio::test]
async fn poke_preferences_follow_the_recipients_friend_list_and_apply_at_delivery() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let recipient = member(app, session(&owner)).await;
    let stranger = member(app, session(&owner)).await;
    let settings = "/api/eu/cutucadas";
    let set = |value: &'static str| {
        send(
            app,
            Method::PUT,
            settings,
            Some(session(&recipient)),
            json!({"receber":value}),
        )
    };
    assert_eq!(
        send(
            app,
            Method::GET,
            settings,
            Some(session(&recipient)),
            Value::Null
        )
        .await,
        (StatusCode::OK, json!({"receber":"amigos"}))
    );
    assert_eq!(set("invalid").await.0, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        poke(app, &owner, id(&recipient), "").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app,
            Method::POST,
            &format!("/api/amigos/{}", id(&recipient)),
            Some(session(&owner)),
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        poke(app, &owner, id(&recipient), "").await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app,
            Method::POST,
            &format!("/api/amigos/{}", id(&owner)),
            Some(session(&recipient)),
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        poke(app, &owner, id(&recipient), "antes do bloqueio").await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(set("ninguem").await.0, StatusCode::NO_CONTENT);
    assert_eq!(
        poke(app, &owner, id(&recipient), "").await,
        StatusCode::FORBIDDEN
    );
    assert!(received_pokes(app, &recipient).await.is_empty());
    assert_eq!(set("todos").await.0, StatusCode::NO_CONTENT);
    assert_eq!(
        send(
            app,
            Method::GET,
            settings,
            Some(session(&recipient)),
            Value::Null
        )
        .await,
        (StatusCode::OK, json!({"receber":"todos"}))
    );
    assert_eq!(
        poke(app, &stranger, id(&recipient), "  Oi!  ").await,
        StatusCode::NO_CONTENT
    );
    assert!(received_pokes(app, &owner).await.is_empty());
    let received = received_pokes(app, &recipient).await;
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["de"], id(&stranger));
    assert_eq!(received[0]["recado"], "Oi!");
    assert_eq!(
        poke(app, &owner, &auth::id(), "").await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        poke(app, &owner, id(&owner), "").await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        poke(app, &owner, id(&recipient), "linha\n").await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        poke(app, &owner, id(&recipient), &"á".repeat(81)).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        send(
            app,
            Method::POST,
            "/api/chamar",
            Some(session(&owner)),
            json!({})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn pokes_enforce_pair_and_sender_limits_across_concurrent_requests() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let other_sender = member(app, session(&owner)).await;
    let recipients: Vec<_> = (0..10).map(|_| auth::id()).collect();
    {
        let db = fixture.config.db.lock().unwrap();
        for recipient in &recipients {
            db.execute(
                "INSERT INTO usuarios (id, nome, papel, criado_em, receber_cutucadas)
                 VALUES (?1, 'Destinatário', 'membro', 0, 'todos')",
                [recipient],
            )
            .unwrap();
        }
    }
    let first = &recipients[0];
    let (one, two) = tokio::join!(poke(app, &owner, first, ""), poke(app, &owner, first, ""));
    let mut statuses = [one, two];
    statuses.sort();
    assert_eq!(
        statuses,
        [StatusCode::NO_CONTENT, StatusCode::TOO_MANY_REQUESTS]
    );

    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE cutucadas SET criado_em = unixepoch('subsec') - 30",
            [],
        )
        .unwrap();
    assert_eq!(poke(app, &owner, first, "").await, StatusCode::NO_CONTENT);
    for recipient in &recipients[1..9] {
        assert_eq!(
            poke(app, &owner, recipient, "").await,
            StatusCode::NO_CONTENT
        );
    }
    let last = &recipients[9];
    assert_eq!(
        poke(app, &owner, last, "").await,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        poke(app, &other_sender, last, "").await,
        StatusCode::NO_CONTENT
    );

    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE cutucadas SET criado_em = unixepoch('subsec') - 60
         WHERE id = (SELECT id FROM cutucadas WHERE remetente_id = ?1 ORDER BY criado_em LIMIT 1)",
            [id(&owner)],
        )
        .unwrap();
    assert_eq!(poke(app, &owner, last, "").await, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn presence_delivers_a_poke_once_and_ignores_expired_pokes() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let recipient = member(app, session(&owner)).await;
    assert_eq!(
        send(
            app,
            Method::PUT,
            "/api/eu/cutucadas",
            Some(session(&recipient)),
            json!({"receber":"todos"})
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let note = "🖐".repeat(80);
    assert_eq!(
        poke(app, &owner, id(&recipient), &note).await,
        StatusCode::NO_CONTENT
    );
    let (one, two) = tokio::join!(
        received_pokes(app, &recipient),
        received_pokes(app, &recipient)
    );
    let received: Vec<_> = one.into_iter().chain(two).collect();
    assert_eq!(received.len(), 1);
    assert_eq!(received[0]["de"], id(&owner));
    assert_eq!(received[0]["recado"], note);
    assert!(auth::is_hex(received[0]["id"].as_str().unwrap(), 32));
    assert!(received[0]["criado_em"].as_i64().unwrap() > 0);
    assert!(received_pokes(app, &recipient).await.is_empty());
    assert_eq!(
        poke(app, &owner, id(&recipient), "").await,
        StatusCode::TOO_MANY_REQUESTS
    );

    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE cutucadas SET criado_em = unixepoch('subsec') - 120",
            [],
        )
        .unwrap();
    assert_eq!(
        poke(app, &owner, id(&recipient), "").await,
        StatusCode::NO_CONTENT
    );
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE cutucadas SET criado_em = unixepoch('subsec') - 120 WHERE entregue = 0",
            [],
        )
        .unwrap();
    assert!(received_pokes(app, &recipient).await.is_empty());
}

#[tokio::test]
async fn game_presence_expires_and_can_be_cleared() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let player = member(app, session(&owner)).await;
    let set = |name: Value| {
        send(
            app,
            Method::PUT,
            "/api/eu/jogo",
            Some(session(&player)),
            json!({"jogo":name}),
        )
    };
    let read = || async {
        let (status, profiles) = send(
            app,
            Method::GET,
            "/api/pessoas",
            Some(session(&owner)),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        profiles
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id(&player))
            .unwrap()["jogo"]
            .clone()
    };
    assert!(read().await.is_null());
    assert_eq!(set(json!("CS2\n")).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(set(json!("a".repeat(61))).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(set(json!(" CS2 ")).await.0, StatusCode::NO_CONTENT);
    assert_eq!(read().await, "CS2");
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE usuarios SET jogo_expira_em = unixepoch() WHERE id = ?1",
            [id(&player)],
        )
        .unwrap();
    assert!(read().await.is_null());
    assert_eq!(set(json!("CS2")).await.0, StatusCode::NO_CONTENT);
    assert_eq!(set(json!("")).await.0, StatusCode::NO_CONTENT);
    assert!(read().await.is_null());
}

#[tokio::test]
async fn room_moderation_checks_roles_and_keeps_the_target_in_the_group() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let admin = member(app, session(&owner)).await;
    let target = member(app, session(&owner)).await;
    {
        let db = fixture.config.db.lock().unwrap();
        db.execute(
            "UPDATE usuarios SET papel = 'admin' WHERE id = ?1",
            [id(&admin)],
        )
        .unwrap();
        db.execute(
            "INSERT INTO salas VALUES ('room-in-use', 'Em uso', 99), ('dest', 'Destino', 100)",
            [],
        )
        .unwrap();
    }
    *fixture.online.lock().unwrap() = vec![id(&target).into(), format!("{}:tela", id(&target))];
    for (path, payload) in [
        ("silenciar", json!({})),
        (
            "mover",
            json!({"usuario_id": id(&target), "destino_id": "dest"}),
        ),
        ("retirar", json!({"usuario_id": id(&target)})),
    ] {
        let uri = format!("/api/salas/room-in-use/moderacao/{path}");
        assert_eq!(
            send(
                app,
                Method::POST,
                &uri,
                Some(session(&target)),
                payload.clone()
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        for manager in [&owner, &admin] {
            let expected = if path == "mover" {
                StatusCode::ACCEPTED
            } else {
                StatusCode::NO_CONTENT
            };
            assert_eq!(
                send(
                    app,
                    Method::POST,
                    &uri,
                    Some(session(manager)),
                    payload.clone()
                )
                .await
                .0,
                expected
            );
        }
        if path == "mover" {
            let (_, people) = send(
                app,
                Method::GET,
                "/api/pessoas",
                Some(session(&target)),
                Value::Null,
            )
            .await;
            let own = people
                .as_array()
                .unwrap()
                .iter()
                .find(|person| person["id"] == id(&target))
                .unwrap();
            assert_eq!(own["mudanca_sala"]["destino_id"], "dest");
            let (_, people) = send(
                app,
                Method::GET,
                "/api/pessoas",
                Some(session(&owner)),
                Value::Null,
            )
            .await;
            assert!(
                people
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|person| person["mudanca_sala"].is_null())
            );
        }
    }
    assert_eq!(
        send(
            app,
            Method::GET,
            "/api/eu",
            Some(session(&target)),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, people) = send(
        app,
        Method::GET,
        "/api/pessoas",
        Some(session(&target)),
        Value::Null,
    )
    .await;
    let target_profile = people
        .as_array()
        .unwrap()
        .iter()
        .find(|person| person["id"] == id(&target))
        .unwrap();
    assert!(target_profile["mudanca_sala"].is_null());
    assert_eq!(fixture.kicked.lock().unwrap().len(), 8);
    assert_eq!(
        fixture
            .config
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM moderacao_log WHERE resultado IN ('ok', 'reconectar')",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        6
    );
}

#[tokio::test]
async fn joins_with_a_link_then_exchanges_one_device_code_and_logs_out() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let code = &fixture.owner_code;
    let (status, preview) = send(
        app,
        Method::GET,
        &format!("/api/convites/{code}"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview["servidor"], "Galera teste");
    let html = app
        .clone()
        .oneshot(request(
            Method::GET,
            &format!("/c/{code}"),
            None,
            Body::empty(),
            "192.0.2.200:80".parse().unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(html.status(), StatusCode::OK);
    assert_eq!(html.headers()[header::CACHE_CONTROL], "no-store");
    let html = to_bytes(html.into_body(), 4096).await.unwrap();
    assert!(
        String::from_utf8_lossy(&html)
            .contains("stackcall://entrar?servidor=https%3A%2F%2Fexample.test")
    );
    let owner = join(app, code, "Dono").await;
    let token = session(&owner);
    assert_eq!(owner["usuario"]["papel"], "dono");
    let (status, me) = send(app, Method::GET, "/api/eu", Some(token), Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["id"], id(&owner));

    let (status, link) = send(
        app,
        Method::POST,
        "/api/aparelhos/link",
        Some(token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(
        link["url"]
            .as_str()
            .unwrap()
            .starts_with("stackcall://aparelho?")
    );
    let body = json!({"codigo": link["codigo"], "aparelho":"Outro PC"});
    let (status, account) = send(
        app,
        Method::POST,
        "/api/aparelhos/entrar",
        None,
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(id(&account), id(&owner));
    assert_ne!(token, session(&account));
    assert_eq!(
        send(app, Method::POST, "/api/aparelhos/entrar", None, body)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let device = session(&account);
    assert_eq!(
        send(app, Method::POST, "/api/sair", Some(device), Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(app, Method::GET, "/api/eu", Some(device), Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(app, Method::GET, "/api/eu", Some(token), Value::Null)
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn admits_only_one_of_twenty_concurrent_invite_acceptances() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let invite = make_invite(app, session(&owner)).await;
    let uri = format!(
        "/api/convites/{}/aceitar",
        invite["codigo"].as_str().unwrap()
    );
    let results = futures_util::future::join_all((1..=20).map(|index| {
        result(
            app,
            request(
                Method::POST,
                &uri,
                None,
                Body::from(
                    json!({"nome": format!("Pessoa {index}"), "aparelho": "PC"}).to_string(),
                ),
                format!("192.0.2.{index}:1234").parse().unwrap(),
            ),
        )
    }))
    .await;
    assert_eq!(
        results
            .iter()
            .filter(|result| result.0 == StatusCode::CREATED)
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
    let users: i64 = fixture
        .config
        .db
        .lock()
        .unwrap()
        .query_row("SELECT count(*) FROM usuarios", [], |row| row.get(0))
        .unwrap();
    assert_eq!(users, 2);
}

#[tokio::test]
async fn revoked_and_expired_invites_have_the_same_response() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let token = session(&owner);
    let revoked = make_invite(app, token).await;
    let expired = make_invite(app, token).await;
    assert_eq!(
        send(
            app,
            Method::DELETE,
            &format!("/api/convites/{}", revoked["id"].as_str().unwrap()),
            Some(token),
            Value::Null
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE convites SET expira_em = unixepoch() - 1 WHERE id = ?1",
            [expired["id"].as_str().unwrap()],
        )
        .unwrap();
    for invite in [revoked, expired] {
        let path = format!("/api/convites/{}", invite["codigo"].as_str().unwrap());
        let expected = (
            StatusCode::NOT_FOUND,
            json!({"erro":"Convite indisponível"}),
        );
        assert_eq!(
            send(app, Method::GET, &path, None, Value::Null).await,
            expected
        );
        assert_eq!(
            send(
                app,
                Method::POST,
                &format!("{path}/aceitar"),
                None,
                json!({"nome":"Teste","aparelho":"PC"})
            )
            .await,
            expected
        );
    }
}

#[tokio::test]
async fn signs_scoped_livekit_tokens_and_checks_room_permissions() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let member = member(app, session(&owner)).await;
    let token = session(&member);
    let (status, rooms) = send(app, Method::GET, "/api/salas", Some(token), Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rooms[0]["nome"], "Geral");
    let room = rooms[0]["id"].as_str().unwrap();
    let path = format!("/api/salas/{room}/token");
    assert_eq!(
        send(app, Method::POST, &path, None, Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            app,
            Method::POST,
            "/api/salas/ausente/token",
            Some(token),
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(
            app,
            Method::POST,
            "/api/salas",
            Some(token),
            json!({"nome":"Teste"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(app, Method::POST, "/api/convites", Some(token), json!({}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, tokens) = send(
        app,
        Method::POST,
        &path,
        Some(token),
        json!({"identity":"impostor", "sala":"outra"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let verifier = TokenVerifier::with_api_key("test_key", "test_secret");
    let voice = verifier.verify(tokens["token"].as_str().unwrap()).unwrap();
    let screen = verifier
        .verify(tokens["screen_token"].as_str().unwrap())
        .unwrap();
    assert_eq!(voice.sub, id(&member));
    assert_eq!(voice.video.room, room);
    assert!(voice.video.room_join);
    assert!(!voice.video.room_admin);
    assert!(voice.video.can_update_own_metadata());
    assert_eq!(screen.sub, format!("{}:tela", id(&member)));
    assert_eq!(screen.video.room, room);
    assert_eq!(screen.exp - screen.nbf, 3600);
    assert_eq!(
        screen.video.can_publish_sources,
        ["screen_share", "screen_share_audio"]
    );
    assert_eq!(screen.video.can_subscribe, Some(false));
    assert_eq!(screen.video.can_publish_data, Some(false));
    assert!(!screen.video.can_update_own_metadata());
}

#[tokio::test]
async fn removal_revokes_every_device_and_disconnects_both_livekit_identities() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let member = member(app, session(&owner)).await;
    let token = session(&member);
    let (status, link) = send(
        app,
        Method::POST,
        "/api/aparelhos/link",
        Some(token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, second) = send(
        app,
        Method::POST,
        "/api/aparelhos/entrar",
        None,
        json!({"codigo": link["codigo"], "aparelho": "Outro PC"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, pending) = send(
        app,
        Method::POST,
        "/api/aparelhos/link",
        Some(token),
        Value::Null,
    )
    .await;

    let uri = format!("/api/pessoas/{}", id(&member));
    assert_eq!(
        send(app, Method::DELETE, &uri, Some(token), Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        send(
            app,
            Method::DELETE,
            &uri,
            Some(session(&owner)),
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    for session in [token, session(&second)] {
        assert_eq!(
            send(app, Method::GET, "/api/eu", Some(session), Value::Null)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        send(
            app,
            Method::POST,
            "/api/aparelhos/entrar",
            None,
            json!({"codigo": pending["codigo"], "aparelho":"Terceiro PC"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let mut kicked = fixture.kicked.lock().unwrap().clone();
    kicked.sort();
    assert_eq!(
        kicked,
        [id(&member).to_owned(), format!("{}:tela", id(&member))]
    );
}

#[tokio::test]
async fn removal_succeeds_and_revokes_the_session_during_livekit_outage() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let member = member(app, session(&owner)).await;
    fixture.livekit.abort();

    let (status, _) = send(
        app,
        Method::DELETE,
        &format!("/api/pessoas/{}", id(&member)),
        Some(session(&owner)),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(
        app,
        Method::GET,
        "/api/eu",
        Some(session(&member)),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn friendship_is_personal_and_presence_comes_from_livekit() {
    let fixture = fixture(true).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let member = member(app, session(&owner)).await;
    fixture
        .online
        .lock()
        .unwrap()
        .extend([id(&member).to_owned(), format!("{}:tela", id(&member))]);
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute("INSERT INTO salas VALUES ('room-in-use', 'Em uso', 99)", [])
        .unwrap();
    let owner_token = session(&owner);
    let member_token = session(&member);
    make_invite(app, member_token).await;
    let uri = format!("/api/amigos/{}", id(&member));
    assert_eq!(
        send(app, Method::POST, &uri, Some(owner_token), Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let (status, people) = send(
        app,
        Method::GET,
        "/api/pessoas",
        Some(owner_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entry = people
        .as_array()
        .unwrap()
        .iter()
        .find(|person| person["id"] == id(&member))
        .unwrap();
    assert_eq!(entry["amigo"], true);
    assert_eq!(entry["online"], true);
    assert_eq!(entry["sala"], "room-in-use");
    let (status, rooms) = send(
        app,
        Method::GET,
        "/api/salas",
        Some(owner_token),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let live = rooms
        .as_array()
        .unwrap()
        .iter()
        .find(|room| room["id"] == "room-in-use")
        .unwrap();
    assert_eq!(live["pessoas"], 1);
    assert_eq!(live["no_ar"], true);
    let (_, people) = send(
        app,
        Method::GET,
        "/api/pessoas",
        Some(member_token),
        Value::Null,
    )
    .await;
    let entry = people
        .as_array()
        .unwrap()
        .iter()
        .find(|person| person["id"] == id(&owner))
        .unwrap();
    assert_eq!(entry["amigo"], false);
    assert!(entry["sala"].is_null());
    assert_eq!(
        send(app, Method::DELETE, &uri, Some(owner_token), Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn lists_rooms_and_people_with_empty_presence_during_livekit_outage() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let owner_token = Some(session(&owner));
    fixture.livekit.abort();

    let (status, rooms) = send(app, Method::GET, "/api/salas", owner_token, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    let rooms = rooms.as_array().unwrap();
    assert!(!rooms.is_empty());
    for room in rooms {
        assert_eq!(room["pessoas"], 0);
        assert_eq!(room["no_ar"], false);
    }
    let (status, people) = send(app, Method::GET, "/api/pessoas", owner_token, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(people[0]["online"], false);
    assert!(people[0]["sala"].is_null());
}

#[tokio::test]
async fn images_are_checked_by_content_and_stored_as_cacheable_webp() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let token = session(&owner);
    let peer = "192.0.2.200:1234".parse().unwrap();
    for (payload, expected) in [
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (vec![0; 1024 * 1024 + 1], StatusCode::PAYLOAD_TOO_LARGE),
    ] {
        let mut req = request(
            Method::PUT,
            "/api/eu/avatar",
            Some(token),
            Body::from(payload),
            peer,
        );
        req.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
        assert_eq!(result(app, req).await.0, expected);
    }
    let (status, profile) = send(
        app,
        Method::PATCH,
        "/api/eu/perfil",
        Some(token),
        json!({"bio": "Teste", "tema_perfil":"lima","cor":"#123456"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(profile["bio"], "Teste");
    assert_eq!(profile["tema_perfil"], "lima");
    assert_eq!(profile["cor"], "#123456");
    let (_, profile) = send(
        app,
        Method::PATCH,
        "/api/eu/perfil",
        Some(token),
        json!({"cor":null}),
    )
    .await;
    assert!(profile["cor"].is_null());

    let mut source = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(16, 16)
        .write_to(&mut source, image::ImageFormat::Png)
        .unwrap();
    let (status, profile) = result(
        app,
        request(
            Method::PUT,
            "/api/eu/banner",
            Some(token),
            Body::from(source.into_inner()),
            peer,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let url = profile["banner"].as_str().unwrap();
    let response = app
        .clone()
        .oneshot(request(Method::GET, url, None, Body::empty(), peer))
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
async fn an_expired_device_link_cannot_issue_a_session() {
    let fixture = fixture(false).await;
    let owner = join(&fixture.app, &fixture.owner_code, "Dono").await;
    let (_, link) = send(
        &fixture.app,
        Method::POST,
        "/api/aparelhos/link",
        Some(session(&owner)),
        Value::Null,
    )
    .await;
    let code = link["codigo"].as_str().unwrap();
    fixture
        .config
        .db
        .lock()
        .unwrap()
        .execute(
            "UPDATE logins_aparelho SET expira_em = unixepoch() - 1 WHERE codigo_hash = ?1",
            [auth::hash(code)],
        )
        .unwrap();
    assert_eq!(
        send(
            &fixture.app,
            Method::POST,
            "/api/aparelhos/entrar",
            None,
            json!({"codigo": code, "aparelho": "Outro"})
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invitation_limits_group_ipv6_addresses_by_prefix_and_keep_other_routes_available() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let peer = "127.0.0.1:1234".parse().unwrap();
    let call = |uri, ip| {
        let mut req = request(Method::GET, uri, None, Body::empty(), peer);
        req.headers_mut()
            .insert("x-forwarded-for", HeaderValue::from_static(ip));
        app.clone().oneshot(req)
    };
    for _ in 0..10 {
        assert_eq!(
            call("/api/convites/invalido", "2001:db8:1::1")
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        call("/c/invalido", "2001:db8:1::2").await.unwrap().status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        call("/api/convites/invalido", "2001:db8:2::2")
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call("/api/servidor", "2001:db8:1::2")
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn invitation_management_keeps_working_after_anonymous_limit() {
    let fixture = fixture(false).await;
    let app = &fixture.app;
    let owner = join(app, &fixture.owner_code, "Dono").await;
    let token = Some(session(&owner));

    for _ in 0..9 {
        assert_eq!(
            send(
                app,
                Method::GET,
                "/api/convites/invalido",
                None,
                Value::Null
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        send(
            app,
            Method::POST,
            "/api/aparelhos/entrar",
            None,
            json!({"codigo": "invalido"})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        send(
            app,
            Method::POST,
            "/api/convites/invalid/aceitar",
            None,
            json!({})
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );

    let invite = make_invite(app, session(&owner)).await;
    assert_eq!(
        send(app, Method::GET, "/api/convites", token, Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    let route = format!("/api/convites/{}", invite["id"].as_str().unwrap());
    assert_eq!(
        send(app, Method::DELETE, &route, token, Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test(start_paused = true)]
async fn keeps_the_upload_probe_bounded_and_times_out_incomplete_bodies() {
    let fixture = fixture(false).await;
    let peer = "192.0.2.200:1234".parse().unwrap();
    let req = request(
        Method::POST,
        "/api/upload-test",
        None,
        Body::from(vec![0; UPLOAD_MAX_BYTES + 1]),
        peer,
    );
    assert_eq!(
        result(&fixture.app, req).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let body = Body::from_stream(futures_util::stream::pending::<
        Result<axum::body::Bytes, std::io::Error>,
    >());
    let req = request(Method::POST, "/api/upload-test", None, body, peer);
    assert_eq!(
        result(&fixture.app, req).await.0,
        StatusCode::REQUEST_TIMEOUT
    );
}
