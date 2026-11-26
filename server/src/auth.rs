use crate::{Config, db};
use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{Method, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fmt::Write, sync::Arc};

pub struct User {
    pub id: String,
    pub role: String,
    pub(crate) token_hash: [u8; 32],
}

impl User {
    pub fn manager(&self) -> Result<(), StatusCode> {
        if matches!(self.role.as_str(), "dono" | "admin") {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        }
    }

    pub fn ensure_active(&self, conn: &Connection) -> Result<(), StatusCode> {
        let active: bool = conn
            .query_row(
                "SELECT EXISTS (
                SELECT 1 FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
                WHERE s.token_hash = ?1 AND u.removido_em IS NULL
             )",
                [self.token_hash],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        if active {
            Ok(())
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

impl FromRequestParts<Arc<Config>> for User {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        config: &Arc<Config>,
    ) -> Result<Self, StatusCode> {
        let bearer = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split_once(' '))
            .filter(|(scheme, token)| scheme.eq_ignore_ascii_case("Bearer") && is_hex(token, 64))
            .map(|(_, token)| token.to_owned());
        let token = match bearer {
            Some(token) => token,
            None => {
                let token = session_cookie(parts).ok_or(StatusCode::UNAUTHORIZED)?;
                // A cookie travels with any request to this host: writes also need a header that
                // another site cannot send without a CORS preflight, which only the apps pass.
                let read = matches!(parts.method, Method::GET | Method::HEAD);
                if !read && parts.headers.get(WEB_HEADER).is_none_or(|v| v != "1") {
                    return Err(StatusCode::FORBIDDEN);
                }
                token
            }
        };
        let token_hash = hash(&token);
        db::run(config.clone(), move |conn| {
            let user_id: String = conn
                .query_row(
                    "UPDATE sessoes SET ultimo_uso = unixepoch()
                 WHERE token_hash = ?1 AND EXISTS (
                     SELECT 1 FROM usuarios WHERE id = usuario_id AND removido_em IS NULL
                 )
                 RETURNING usuario_id",
                    [token_hash],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db::internal)?
                .ok_or(StatusCode::UNAUTHORIZED)?;
            let role = conn
                .query_row(
                    "SELECT papel FROM usuarios WHERE id = ?1",
                    [&user_id],
                    |row| row.get(0),
                )
                .map_err(db::internal)?;
            Ok(Self {
                id: user_id,
                role,
                token_hash,
            })
        })
        .await
    }
}

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/eu", get(me))
        .route("/api/sair", post(logout))
        .route("/api/aparelhos/link", post(link))
        .route("/api/aparelhos/entrar", post(exchange))
}

pub fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

pub fn hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(output, "{byte:02x}").expect("writing to String");
    }
    output
}

pub fn is_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn id() -> String {
    hex(&rand::random::<[u8; 16]>())
}

fn token() -> String {
    hex(&rand::random::<[u8; 32]>())
}

pub fn device(value: String) -> Result<String, StatusCode> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(name.to_owned())
}

pub const PROFILE_FIELDS: &str = "id, nome, papel, criado_em,
    '/media/' || avatar || '.webp', '/media/' || banner || '.webp', bio, tema_perfil, cor";

#[derive(Serialize)]
pub struct Profile {
    pub id: String,
    nome: String,
    papel: String,
    criado_em: i64,
    avatar: Option<String>,
    banner: Option<String>,
    bio: String,
    tema_perfil: String,
    cor: Option<String>,
}

impl Profile {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            nome: row.get(1)?,
            papel: row.get(2)?,
            criado_em: row.get(3)?,
            avatar: row.get(4)?,
            banner: row.get(5)?,
            bio: row.get(6)?,
            tema_perfil: row.get(7)?,
            cor: row.get(8)?,
        })
    }
}

pub fn profile(conn: &Connection, id: &str) -> rusqlite::Result<Profile> {
    conn.query_row(
        &format!("SELECT {PROFILE_FIELDS} FROM usuarios WHERE id = ?1 AND removido_em IS NULL"),
        [id],
        Profile::from_row,
    )
}

#[derive(Serialize)]
pub struct Session {
    pub sessao: String,
    usuario: Profile,
}

/// The web app (`/app/`) keeps its session in this cookie, out of reach of page scripts.
pub const COOKIE: &str = "stackcall_sessao";
/// Header the web app sends on every write when it authenticates by cookie.
pub const WEB_HEADER: &str = "x-stackcall-web";

fn session_cookie(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, value)| *name == COOKIE && is_hex(value, 64))
        .map(|(_, value)| value.to_owned())
}

/// Desktop apps get the token in the body (they keep it in the system vault); the browser gets
/// an HttpOnly cookie instead and never sees the token.
pub fn deliver(status: StatusCode, session: Session, web: bool) -> Response {
    if !web {
        return (status, Json(session)).into_response();
    }
    let cookie = format!(
        "{COOKIE}={}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000",
        session.sessao
    );
    (
        status,
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "usuario": session.usuario })),
    )
        .into_response()
}

pub fn issue_session(conn: &Connection, user: &str, device: &str) -> rusqlite::Result<Session> {
    let sessao = token();
    let usuario = profile(conn, user)?;
    conn.execute(
        "INSERT INTO sessoes (id, usuario_id, token_hash, nome_aparelho, criado_em, ultimo_uso)
         VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch())",
        params![id(), user, hash(&sessao), device],
    )?;
    Ok(Session { sessao, usuario })
}

async fn me(State(config): State<Arc<Config>>, user: User) -> Result<Json<Profile>, StatusCode> {
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        profile(conn, &user.id).map(Json).map_err(db::internal)
    })
    .await
}

async fn logout(State(config): State<Arc<Config>>, user: User) -> Result<Response, StatusCode> {
    db::run(config, move |conn| {
        conn.execute(
            "DELETE FROM sessoes WHERE token_hash = ?1",
            [user.token_hash],
        )
        .map_err(db::internal)?;
        let clear = format!("{COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
        Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, clear)]).into_response())
    })
    .await
}

async fn link(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<(StatusCode, Json<Value>), StatusCode> {
    let mut url = url::Url::parse("stackcall://aparelho").expect("valid deep link");
    let code = token();
    url.query_pairs_mut()
        .append_pair(
            "servidor",
            &config.public_url.origin().ascii_serialization(),
        )
        .append_pair("codigo", &code);
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        conn.execute(
            "DELETE FROM logins_aparelho WHERE expira_em <= unixepoch()",
            [],
        )
        .map_err(db::internal)?;
        let expires: i64 = conn
            .query_row(
                "INSERT INTO logins_aparelho (id, usuario_id, codigo_hash, expira_em)
             VALUES (?1, ?2, ?3, unixepoch() + 600) RETURNING expira_em",
                params![id(), user.id, hash(&code)],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        Ok((
            StatusCode::CREATED,
            Json(json!({"codigo": code, "url": url.as_str(), "expira_em": expires})),
        ))
    })
    .await
}

#[derive(Deserialize)]
struct DeviceLogin {
    codigo: String,
    aparelho: String,
    #[serde(default)]
    web: bool,
}

async fn exchange(
    State(config): State<Arc<Config>>,
    Json(input): Json<DeviceLogin>,
) -> Result<Response, StatusCode> {
    let web = input.web;
    let name = device(input.aparelho)?;
    if !is_hex(&input.codigo, 64) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    db::run(config, move |conn| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db::internal)?;
        let user: String = tx
            .query_row(
                "UPDATE logins_aparelho SET usado = 1
             WHERE codigo_hash = ?1 AND NOT usado AND expira_em > unixepoch()
                 AND EXISTS (SELECT 1 FROM usuarios WHERE id = usuario_id AND removido_em IS NULL)
             RETURNING usuario_id",
                [hash(&input.codigo)],
                |row| row.get(0),
            )
            .optional()
            .map_err(db::internal)?
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let session = issue_session(&tx, &user, &name).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(deliver(StatusCode::OK, session, web))
    })
    .await
}
