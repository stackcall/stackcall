use crate::{Config, auth, db, valid_name};
use axum::{
    Json, Router,
    extract::{Query, RawQuery, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc, time::Duration};
use url::{Url, form_urlencoded};

const OP_ENDPOINT: &str = "https://steamcommunity.com/openid/login";
const NS: &str = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT: &str = "http://specs.openid.net/auth/2.0/identifier_select";
const CALLBACK: &str = "/api/auth/steam/retorno";
const COOKIE: &str = "__Host-stackcall-steam";
const FLOW_SECONDS: i64 = 600;

pub struct Steam {
    client: reqwest::Client,
    endpoint: String,
    api_key: Option<String>,
}

impl Steam {
    pub fn new(api_key: Option<String>) -> reqwest::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            client,
            endpoint: OP_ENDPOINT.into(),
            api_key,
        })
    }
}

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/auth/steam/iniciar", get(start))
        .route(CALLBACK, get(callback))
        .route("/api/auth/troca", post(exchange))
}

#[derive(Deserialize)]
struct Start {
    retorno: String,
    desafio: String,
    codigo: Option<String>,
}

fn return_to(config: &Config, state: &str) -> Url {
    let mut url = config.public_url.clone();
    url.set_path(CALLBACK);
    url.query_pairs_mut().append_pair("estado", state);
    url
}

async fn start(
    State(config): State<Arc<Config>>,
    Query(input): Query<Start>,
) -> Result<Response, StatusCode> {
    let steam = config.steam.as_ref().ok_or(StatusCode::NOT_FOUND)?;
    if input.retorno != "stackcall"
        || !auth::is_hex(&input.desafio, 64)
        || input
            .codigo
            .as_deref()
            .is_some_and(|code| !auth::is_hex(code, 32))
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let state = auth::token();
    let mut provider = Url::parse(&steam.endpoint).map_err(db::internal)?;
    provider.query_pairs_mut().extend_pairs([
        ("openid.ns", NS),
        ("openid.mode", "checkid_setup"),
        ("openid.claimed_id", IDENTIFIER_SELECT),
        ("openid.identity", IDENTIFIER_SELECT),
        ("openid.realm", config.public_url.as_str()),
        ("openid.return_to", return_to(&config, &state).as_str()),
    ]);
    let state_hash = auth::hash(&state);
    db::run(config, move |conn| {
        conn.execute(
            "DELETE FROM steam_fluxos WHERE expira_em <= unixepoch()",
            [],
        )
        .map_err(db::internal)?;
        conn.execute(
            "INSERT INTO steam_fluxos (estado_hash, desafio, codigo_hash, expira_em)
             VALUES (?1, ?2, ?3, unixepoch() + ?4)",
            params![
                state_hash,
                input.desafio,
                input.codigo.as_deref().map(auth::hash),
                FLOW_SECONDS
            ],
        )
        .map_err(db::internal)?;
        Ok(())
    })
    .await?;
    let cookie =
        format!("{COOKIE}={state}; Path=/; Max-Age={FLOW_SECONDS}; HttpOnly; Secure; SameSite=Lax");
    Ok((
        [(header::SET_COOKIE, cookie)],
        Redirect::to(provider.as_str()),
    )
        .into_response())
}

async fn callback(
    State(config): State<Arc<Config>>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> Result<Response, StatusCode> {
    let steam = config.steam.as_ref().ok_or(StatusCode::NOT_FOUND)?;
    let query = query
        .filter(|query| query.len() <= 8192)
        .ok_or(StatusCode::BAD_REQUEST)?;
    let mut fields = HashMap::new();
    for (key, value) in form_urlencoded::parse(query.as_bytes()) {
        if fields
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let get = |key: &str| fields.get(key).map_or("", String::as_str);
    let state = get("estado");
    let claimed = get("openid.claimed_id");
    let signed = get("openid.signed");
    let has_cookie = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .any(|(name, value)| name == COOKIE && value == state);
    if get("openid.ns") != NS
        || get("openid.mode") != "id_res"
        || get("openid.op_endpoint") != steam.endpoint
        || get("openid.identity") != claimed
        || !auth::is_hex(state, 64)
        || !has_cookie
        || get("openid.return_to") != return_to(&config, state).as_str()
        || ![
            "op_endpoint",
            "claimed_id",
            "identity",
            "return_to",
            "response_nonce",
            "assoc_handle",
        ]
        .iter()
        .all(|required| signed.split(',').any(|field| &field == required))
        || ["openid.response_nonce", "openid.assoc_handle", "openid.sig"]
            .iter()
            .any(|field| get(field).is_empty())
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let steam_id = claimed
        .strip_prefix("https://steamcommunity.com/openid/id/")
        .or_else(|| claimed.strip_prefix("http://steamcommunity.com/openid/id/"))
        .filter(|id| id.len() == 17 && id.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_owned();

    let state_hash = auth::hash(state);
    let active = db::run(config.clone(), move |conn| {
        conn.query_row("SELECT EXISTS(SELECT 1 FROM steam_fluxos WHERE estado_hash = ?1 AND expira_em > unixepoch())", [state_hash], |row| row.get::<_, bool>(0)).map_err(db::internal)
    }).await?;
    if !active {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let mut verification: HashMap<_, _> = fields
        .into_iter()
        .filter(|(key, _)| key.starts_with("openid."))
        .collect();
    verification.insert("openid.mode".into(), "check_authentication".into());
    let reply = steam
        .client
        .post(&steam.endpoint)
        .form(&verification)
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    let reply = read_reply(reply).await.ok_or(StatusCode::BAD_GATEWAY)?;
    if !reply.lines().any(|line| line == "is_valid:true") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let existing = db::run(config.clone(), {
        let steam_id = steam_id.clone();
        move |conn| {
            conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM usuarios WHERE steam_id = ?1)",
                [steam_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(db::internal)
        }
    })
    .await?;
    let profile = if existing {
        None
    } else {
        steam.profile(&steam_id).await
    };
    let mode = config.registration;
    let token = auth::token();
    let token_hash = auth::hash(&token);
    db::run(config, move |conn| {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db::internal)?;
        // A one-time state in the signed return_to also rules out nonce replay.
        let (challenge, invite): (String, Option<Vec<u8>>) = tx.query_row(
            "DELETE FROM steam_fluxos WHERE estado_hash = ?1 AND expira_em > unixepoch()
             RETURNING desafio, codigo_hash",
            [state_hash], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(db::internal)?.ok_or(StatusCode::UNAUTHORIZED)?;
        let existing = tx.query_row("SELECT id FROM usuarios WHERE steam_id = ?1", [&steam_id], |row| row.get::<_, String>(0))
            .optional().map_err(db::internal)?;
        let user = if let Some(user) = existing {
            user
        } else {
            mode.ensure_allowed(invite.is_some())?;
            let user = auth::id();
            let first = auth::first_user(&tx).map_err(db::internal)?;
            let role = if first { "admin" } else { "membro" };
            let name = profile.as_ref().map(|p| p.personaname.trim()).filter(|name| valid_name(name))
                .map_or_else(|| format!("Steam {steam_id}"), str::to_owned);
            let avatar = profile.and_then(|p| p.avatarfull).filter(|avatar| valid_avatar(avatar));
            tx.execute(
                "INSERT INTO usuarios (id, nome_exibicao, steam_id, avatar_url, criado_em, papel_instancia)
                 VALUES (?1, ?2, ?3, ?4, unixepoch(), ?5)",
                params![user, name, steam_id, avatar, role],
            ).map_err(db::internal)?;
            auth::admit_new_user(&tx, mode, &user, first, invite.as_deref())?;
            user
        };
        tx.execute("DELETE FROM steam_trocas WHERE expira_em <= unixepoch()", []).map_err(db::internal)?;
        tx.execute(
            "INSERT INTO steam_trocas VALUES (?1, ?2, ?3, unixepoch() + 60)",
            params![token_hash, user, challenge],
        ).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(())
    }).await?;
    let clear = format!("{COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    Ok((
        [(header::SET_COOKIE, clear)],
        Redirect::to(&format!("stackcall://login?sessao={token}")),
    )
        .into_response())
}

#[derive(Deserialize)]
struct Exchange {
    sessao: String,
    verificador: String,
    nome_aparelho: Option<String>,
}

async fn exchange(
    State(config): State<Arc<Config>>,
    Json(input): Json<Exchange>,
) -> Result<Json<auth::Session>, StatusCode> {
    if !auth::is_hex(&input.sessao, 64) || !auth::is_hex(&input.verificador, 64) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let device = auth::device(input.nome_aparelho)?;
    db::run(config, move |conn| {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db::internal)?;
        let user: String = tx.query_row(
            "DELETE FROM steam_trocas WHERE token_hash = ?1 AND desafio = ?2 AND expira_em > unixepoch()
             RETURNING usuario_id",
            params![auth::hash(&input.sessao), auth::hex(&auth::hash(&input.verificador))],
            |row| row.get(0),
        ).optional().map_err(db::internal)?.ok_or(StatusCode::UNAUTHORIZED)?;
        let session = auth::issue_session(&tx, &user, device).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(Json(session))
    }).await
}

async fn read_reply(reply: reqwest::Response) -> Option<String> {
    let mut reply = reply.error_for_status().ok()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = reply.chunk().await.ok()? {
        if (bytes.len() + chunk.len()) > 32 * 1024 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).ok()
}

#[derive(Deserialize)]
struct Player {
    steamid: String,
    personaname: String,
    avatarfull: Option<String>,
}

impl Steam {
    async fn profile(&self, id: &str) -> Option<Player> {
        #[derive(Deserialize)]
        struct Summary {
            response: Players,
        }
        #[derive(Deserialize)]
        struct Players {
            players: Vec<Player>,
        }
        let key = self.api_key.as_ref()?;
        let reply = self
            .client
            .get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/")
            .query(&[("key", key.as_str()), ("steamids", id)])
            .send()
            .await
            .ok()?;
        let summary: Summary = serde_json::from_str(&read_reply(reply).await?).ok()?;
        summary
            .response
            .players
            .into_iter()
            .find(|player| player.steamid == id)
    }
}

fn valid_avatar(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && matches!(
                url.host_str(),
                Some(
                    "avatars.steamstatic.com"
                        | "avatars.akamai.steamstatic.com"
                        | "avatars.cloudflare.steamstatic.com"
                        | "steamcdn-a.akamaihd.net"
                )
            )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{api_tests, app};
    use axum::{
        Form,
        body::Body,
        extract::ConnectInfo,
        http::{Method, Request},
    };
    use serde_json::json;
    use std::net::SocketAddr;
    use tower::ServiceExt;

    fn with_client_ip(mut request: Request<Body>) -> Request<Body> {
        request
            .extensions_mut()
            .insert(ConnectInfo("192.0.2.1:1234".parse::<SocketAddr>().unwrap()));
        request
    }

    #[tokio::test]
    async fn validates_steam_signature_and_exchanges_a_code_only_once() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/openid/login", listener.local_addr().unwrap());
        let provider = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/openid/login",
                    post(|Form(form): Form<HashMap<String, String>>| async move {
                        assert_eq!(form["openid.mode"], "check_authentication");
                        if form["openid.sig"] == "mock-valid" {
                            "is_valid:true\n"
                        } else {
                            "is_valid:false\n"
                        }
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let mut config = api_tests::config(auth::Registration::Open);
        let mut steam = Steam::new(None).unwrap();
        steam.endpoint = endpoint.clone();
        Arc::get_mut(&mut config).unwrap().steam = Some(steam);
        let app = app(config.clone());
        let proof = auth::token();
        let response = app
            .clone()
            .oneshot(with_client_ip(
                Request::get(format!(
                    "/api/auth/steam/iniciar?retorno=stackcall&desafio={}",
                    auth::hex(&auth::hash(&proof))
                ))
                .body(Body::empty())
                .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let cookie = response.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        let location = Url::parse(response.headers()[header::LOCATION].to_str().unwrap()).unwrap();
        let params: HashMap<_, _> = location.query_pairs().into_owned().collect();
        let id = "https://steamcommunity.com/openid/id/76561198000000000";
        let mut url = Url::parse(&params["openid.return_to"]).unwrap();
        url.query_pairs_mut().extend_pairs([
            ("openid.ns", NS),
            ("openid.mode", "id_res"),
            ("openid.op_endpoint", endpoint.as_str()),
            ("openid.claimed_id", id),
            ("openid.identity", id),
            ("openid.return_to", params["openid.return_to"].as_str()),
            ("openid.response_nonce", "2026-11-24T00:00:00Zabcd"),
            ("openid.assoc_handle", "mock"),
            (
                "openid.signed",
                "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
            ),
        ]);
        let verify = |sig: &str| {
            let mut url = url.clone();
            url.query_pairs_mut().append_pair("openid.sig", sig);
            app.clone().oneshot(with_client_ip(
                Request::get(format!("{}?{}", url.path(), url.query().unwrap()))
                    .header(header::COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            ))
        };
        assert_eq!(
            verify("mock-invalid").await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        assert!(auth::first_user(&config.db.lock().unwrap()).unwrap());
        let response = verify("mock-valid").await.unwrap();
        assert_eq!(response.status(), StatusCode::SEE_OTHER);
        let token = response.headers()[header::LOCATION]
            .to_str()
            .unwrap()
            .strip_prefix("stackcall://login?sessao=")
            .unwrap();
        assert_eq!(
            verify("mock-valid").await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );

        for (verifier, expected) in [
            (auth::token().as_str(), StatusCode::UNAUTHORIZED),
            (&proof, StatusCode::OK),
            (&proof, StatusCode::UNAUTHORIZED),
        ] {
            let (status, _) = api_tests::send(
                app.clone(),
                Method::POST,
                "/api/auth/troca",
                None,
                json!({"sessao": token, "verificador": verifier}),
            )
            .await;
            assert_eq!(status, expected);
        }
        provider.abort();
    }
}
