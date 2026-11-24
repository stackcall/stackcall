use crate::{Config, db, valid_name};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use axum::{
    Json, Router,
    extract::{FromRequestParts, State},
    http::{StatusCode, header, request::Parts},
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fmt::Write, sync::Arc};

const SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;
// Unknown names still perform the same Argon2id work as known names.
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$c3RhY2tjYWxsLWR1bW15IQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Registration {
    Open,
    Invite,
    Closed,
}

impl Registration {
    pub fn parse(value: &str) -> Self {
        match value {
            "aberto" => Self::Open,
            "convite" => Self::Invite,
            "fechado" => Self::Closed,
            _ => panic!("configure MODO_CADASTRO com aberto, convite ou fechado"),
        }
    }

    pub fn ensure_allowed(self, code: Option<&str>) -> Result<(), StatusCode> {
        match self {
            Self::Closed => Err(StatusCode::FORBIDDEN),
            Self::Invite if code.is_none() => Err(StatusCode::FORBIDDEN),
            _ => Ok(()),
        }
    }
}

#[derive(Deserialize)]
struct Credentials {
    nome: String,
    senha: String,
    codigo: Option<String>,
    nome_aparelho: Option<String>,
}

#[derive(Serialize)]
struct Session {
    sessao: String,
    expira_em: i64,
}

pub struct User {
    pub id: String,
    token_hash: [u8; 32],
}

impl FromRequestParts<Arc<Config>> for User {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        config: &Arc<Config>,
    ) -> Result<Self, StatusCode> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split_once(' '))
            .filter(|(scheme, token)| scheme.eq_ignore_ascii_case("Bearer") && is_hex(token, 64))
            .map(|(_, token)| token)
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let token_hash = hash(token);
        db::run(config.clone(), move |conn| {
            let id = conn
                .query_row(
                    "UPDATE sessoes SET ultimo_uso = unixepoch(), expira_em = unixepoch() + ?1
                 WHERE token_hash = ?2 AND expira_em > unixepoch() RETURNING usuario_id",
                    params![SESSION_SECONDS, token_hash],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db::internal)?
                .ok_or(StatusCode::UNAUTHORIZED)?;
            Ok(Self { id, token_hash })
        })
        .await
    }
}

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/auth/cadastro", post(register))
        .route("/api/auth/entrar", post(login))
        .route("/api/auth/sair", post(logout))
        .route("/api/eu", get(me))
}

pub fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

pub fn hex(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(text, "{byte:02x}").expect("writing to String");
    }
    text
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

pub fn token() -> String {
    hex(&rand::random::<[u8; 32]>())
}

pub fn first_user(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row("SELECT NOT EXISTS (SELECT 1 FROM usuarios)", [], |row| {
        row.get(0)
    })
}

fn device(value: Option<String>) -> Result<Option<String>, StatusCode> {
    value
        .map(|name| {
            let name = name.trim();
            if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
                return Err(StatusCode::BAD_REQUEST);
            }
            Ok(name.to_owned())
        })
        .transpose()
}

fn issue_session(
    tx: &Transaction<'_>,
    user_id: &str,
    device: Option<String>,
) -> rusqlite::Result<Session> {
    tx.execute("DELETE FROM sessoes WHERE expira_em <= unixepoch()", [])?;
    let sessao = token();
    let expira_em = tx.query_row(
        "INSERT INTO sessoes (id, usuario_id, token_hash, criado_em, expira_em, ultimo_uso, nome_aparelho)
         VALUES (?1, ?2, ?3, unixepoch(), unixepoch() + ?4, unixepoch(), ?5) RETURNING expira_em",
        params![id(), user_id, hash(&sessao), SESSION_SECONDS, device],
        |row| row.get(0),
    )?;
    Ok(Session { sessao, expira_em })
}

async fn password_job<T: Send + 'static>(
    config: &Config,
    work: impl FnOnce() -> Result<T, StatusCode> + Send + 'static,
) -> Result<T, StatusCode> {
    let permit = config
        .password_jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(db::internal)?
}

async fn register(
    State(config): State<Arc<Config>>,
    Json(input): Json<Credentials>,
) -> Result<(StatusCode, Json<Session>), StatusCode> {
    let name = input.nome.trim().to_owned();
    if !valid_name(&name) || !(8..=256).contains(&input.senha.len()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    config
        .registration
        .ensure_allowed(input.codigo.as_deref())?;
    let device = device(input.nome_aparelho)?;
    let password = password_job(&config, move || {
        let salt = SaltString::encode_b64(&rand::random::<[u8; 16]>()).map_err(db::internal)?;
        Argon2::default()
            .hash_password(input.senha.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(db::internal)
    })
    .await?;

    let session = db::run(config, move |conn| {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db::internal)?;
        let login = name.to_lowercase();
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM usuarios WHERE nome_login = ?1)", [&login], |row| row.get(0)).map_err(db::internal)?;
        if exists {
            return Err(StatusCode::CONFLICT);
        }
        let user_id = id();
        let role = if first_user(&tx).map_err(db::internal)? { "admin" } else { "membro" };
        tx.execute(
            "INSERT INTO usuarios (id, nome_exibicao, nome_login, senha_hash, criado_em, papel_instancia)
             VALUES (?1, ?2, ?3, ?4, unixepoch(), ?5)",
            params![user_id, name, login, password, role],
        ).map_err(db::internal)?;
        if let Some(code) = input.codigo {
            let group = consume_invite(&tx, &code)?;
            add_member(&tx, &group, &user_id, "membro").map_err(db::internal)?;
        }
        let session = issue_session(&tx, &user_id, device).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(session)
    }).await?;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn login(
    State(config): State<Arc<Config>>,
    Json(input): Json<Credentials>,
) -> Result<Json<Session>, StatusCode> {
    let name = input.nome.trim().to_lowercase();
    if !valid_name(input.nome.trim()) || input.senha.len() > 256 {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let device = device(input.nome_aparelho)?;
    let account: Option<(String, String)> = db::run(config.clone(), move |conn| {
        conn.query_row(
            "SELECT id, senha_hash FROM usuarios WHERE nome_login = ?1",
            [name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db::internal)
    })
    .await?;
    let user = password_job(&config, move || {
        let stored = account.as_ref().map_or(DUMMY_HASH, |(_, hash)| hash);
        let phc = PasswordHash::new(stored).map_err(db::internal)?;
        Argon2::default()
            .verify_password(input.senha.as_bytes(), &phc)
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
        account.map(|(id, _)| id).ok_or(StatusCode::UNAUTHORIZED)
    })
    .await?;
    db::run(config, move |conn| {
        let tx = conn.transaction().map_err(db::internal)?;
        let session = issue_session(&tx, &user, device).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(Json(session))
    })
    .await
}

async fn logout(State(config): State<Arc<Config>>, user: User) -> Result<StatusCode, StatusCode> {
    db::run(config, move |conn| {
        conn.execute(
            "DELETE FROM sessoes WHERE token_hash = ?1",
            [user.token_hash],
        )
        .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn me(State(config): State<Arc<Config>>, user: User) -> Result<Json<Value>, StatusCode> {
    db::run(config, move |conn| {
        let profile = user_json(conn, &user.id).map_err(db::internal)?;
        let mut groups = conn.prepare(
            "SELECT g.id, g.nome, m.papel FROM membros m JOIN grupos g ON g.id = m.grupo_id
             WHERE m.usuario_id = ?1 ORDER BY g.nome, g.id",
        ).map_err(db::internal)?;
        let groups = groups.query_map([user.id], |row| {
            Ok(json!({"id": row.get::<_, String>(0)?, "nome": row.get::<_, String>(1)?, "papel": row.get::<_, String>(2)?}))
        }).map_err(db::internal)?.collect::<rusqlite::Result<Vec<_>>>().map_err(db::internal)?;
        Ok(Json(json!({"usuario": profile, "grupos": groups})))
    }).await
}

pub fn user_json(conn: &Connection, id: &str) -> rusqlite::Result<Value> {
    conn.query_row(
        "SELECT nome_exibicao, avatar_url, papel_instancia, steam_id, criado_em FROM usuarios WHERE id = ?1",
        [id],
        |row| Ok(json!({
            "id": id, "nome_exibicao": row.get::<_, String>(0)?,
            "avatar_url": row.get::<_, Option<String>>(1)?, "papel_instancia": row.get::<_, String>(2)?,
            "steam_id": row.get::<_, Option<String>>(3)?, "criado_em": row.get::<_, i64>(4)?,
        })),
    )
}

pub fn consume_invite(tx: &Transaction<'_>, code: &str) -> Result<String, StatusCode> {
    if !is_hex(code, 32) {
        return Err(StatusCode::NOT_FOUND);
    }
    tx.query_row(
        "UPDATE convites SET usos = usos + 1
         WHERE codigo_hash = ?1 AND NOT revogado AND usos < usos_max AND expira_em > unixepoch()
         RETURNING grupo_id",
        [hash(code)],
        |row| row.get(0),
    )
    .optional()
    .map_err(db::internal)?
    .ok_or(StatusCode::NOT_FOUND)
}

pub fn add_member(conn: &Connection, group: &str, user: &str, role: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO membros (grupo_id, usuario_id, papel, entrou_em) VALUES (?1, ?2, ?3, unixepoch())",
        params![group, user, role],
    )?;
    Ok(())
}
