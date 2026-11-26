use crate::{
    Config,
    auth::{self, User},
    db, valid_name,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use url::Url;

const DAY: i64 = 86_400;

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/convites", get(list).post(create))
        .route("/api/convites/{codigo}", get(preview).delete(revoke))
        .route("/api/convites/{codigo}/aceitar", post(accept))
        .route("/c/{codigo}", get(page))
}

pub fn bootstrap(conn: &mut Connection) -> rusqlite::Result<Option<String>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let exists: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM usuarios)
             OR EXISTS (SELECT 1 FROM convites WHERE inicial AND NOT revogado AND expira_em > unixepoch())",
        [], |row| row.get(0),
    )?;
    if exists {
        return Ok(None);
    }
    tx.execute("DELETE FROM convites WHERE inicial", [])?;
    tx.execute(
        "INSERT INTO salas (id, nome, ordem) SELECT ?1, 'Geral', 0 WHERE NOT EXISTS (SELECT 1 FROM salas)",
        [auth::id()],
    )?;
    let code = auth::id();
    tx.execute(
        "INSERT INTO convites (id, codigo_hash, expira_em, usos_max, inicial)
         VALUES (?1, ?2, unixepoch() + ?3, 1, 1)",
        params![auth::id(), auth::hash(&code), 7 * DAY],
    )?;
    tx.commit()?;
    Ok(Some(code))
}

pub fn invite_url(public_url: &Url, code: &str) -> Url {
    let mut url = public_url.clone();
    url.set_path(&format!("/c/{code}"));
    url
}

#[derive(Deserialize)]
struct InviteInput {
    dias: Option<i64>,
    usos_max: Option<i64>,
}

#[derive(Serialize)]
struct Invite {
    id: String,
    criado_por: String,
    expira_em: i64,
    usos_max: i64,
    usos: i64,
    revogado: bool,
}

impl Invite {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            criado_por: row.get(1)?,
            expira_em: row.get(2)?,
            usos_max: row.get(3)?,
            usos: row.get(4)?,
            revogado: row.get(5)?,
        })
    }
}

async fn list(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Vec<Invite>>, StatusCode> {
    user.manager()?;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let mut query = conn
            .prepare(
                "SELECT id, criado_por, expira_em, usos_max, usos, revogado
             FROM convites WHERE NOT inicial ORDER BY expira_em DESC, id",
            )
            .map_err(db::internal)?;
        let invites = query
            .query_map([], Invite::from_row)
            .map_err(db::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db::internal)?;
        Ok(Json(invites))
    })
    .await
}

async fn create(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<InviteInput>,
) -> Result<(StatusCode, Json<Value>), StatusCode> {
    if !config.members_can_invite {
        user.manager()?;
    }
    let days = input.dias.unwrap_or(7);
    let limit = input.usos_max.unwrap_or(1);
    if !(1..=365).contains(&days) || !(1..=1000).contains(&limit) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // A group link (more than one use) can spread beyond the group: only managers create it.
    if limit > 1 {
        user.manager()?;
    }
    let code = auth::id();
    let url = invite_url(&config.public_url, &code);
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let id = auth::id();
        let expires: i64 = conn.query_row(
            "INSERT INTO convites (id, criado_por, codigo_hash, expira_em, usos_max)
             VALUES (?1, ?2, ?3, unixepoch() + ?4, ?5) RETURNING expira_em",
            params![id, user.id, auth::hash(&code), days * DAY, limit], |row| row.get(0),
        ).map_err(db::internal)?;
        Ok((StatusCode::CREATED, Json(json!({"id": id, "codigo": code, "url": url.as_str(), "expira_em": expires, "usos_max": limit}))))
    }).await
}

async fn revoke(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    user.manager()?;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let changed = conn
            .execute(
                "UPDATE convites SET revogado = 1 WHERE id = ?1 AND NOT inicial",
                [id],
            )
            .map_err(db::internal)?;
        if changed == 0 {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

fn invite_hash(code: &str) -> Result<[u8; 32], StatusCode> {
    auth::is_hex(code, 32)
        .then(|| auth::hash(code))
        .ok_or(StatusCode::NOT_FOUND)
}

fn inviter(conn: &Connection, code: &str, server_name: &str) -> Result<String, StatusCode> {
    conn.query_row(
        "SELECT COALESCE(u.nome, ?2)
         FROM convites c LEFT JOIN usuarios u ON u.id = c.criado_por
         WHERE c.codigo_hash = ?1 AND NOT c.revogado AND c.usos < c.usos_max AND c.expira_em > unixepoch()",
        params![invite_hash(code)?, server_name], |row| row.get(0),
    ).optional().map_err(db::internal)?.ok_or(StatusCode::NOT_FOUND)
}

struct InviteError(StatusCode);

impl IntoResponse for InviteError {
    fn into_response(self) -> Response {
        if self.0 == StatusCode::NOT_FOUND {
            (self.0, Json(json!({"erro": "Convite indisponível"}))).into_response()
        } else {
            self.0.into_response()
        }
    }
}

async fn preview(
    State(config): State<Arc<Config>>,
    Path(code): Path<String>,
) -> Result<Json<Value>, InviteError> {
    let server_name = config.server_name.clone();
    db::run(config, move |conn| {
        let creator = inviter(conn, &code, &server_name)?;
        Ok(Json(
            json!({"servidor": server_name, "convidado_por": creator}),
        ))
    })
    .await
    .map_err(InviteError)
}

#[derive(Deserialize)]
struct Join {
    nome: String,
    aparelho: String,
    #[serde(default)]
    web: bool,
}

async fn accept(
    State(config): State<Arc<Config>>,
    Path(code): Path<String>,
    Json(input): Json<Join>,
) -> Result<Response, InviteError> {
    let web = input.web;
    let name = input.nome.trim().to_owned();
    if !valid_name(&name) {
        return Err(InviteError(StatusCode::BAD_REQUEST));
    }
    let device = auth::device(input.aparelho).map_err(InviteError)?;
    let hash = invite_hash(&code).map_err(InviteError)?;
    db::run(config, move |conn| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db::internal)?;
        let initial: bool = tx
            .query_row(
                "UPDATE convites SET usos = usos + 1
             WHERE codigo_hash = ?1 AND NOT revogado AND usos < usos_max AND expira_em > unixepoch()
             RETURNING inicial",
                [hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(db::internal)?
            .ok_or(StatusCode::NOT_FOUND)?;
        let id = auth::id();
        let role = if initial { "dono" } else { "membro" };
        tx.execute(
            "INSERT INTO usuarios (id, nome, papel, criado_em) VALUES (?1, ?2, ?3, unixepoch())",
            params![id, name, role],
        )
        .map_err(db::internal)?;
        let session = auth::issue_session(&tx, &id, &device).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(auth::deliver(StatusCode::CREATED, session, web))
    })
    .await
    .map_err(InviteError)
}

async fn page(
    State(config): State<Arc<Config>>,
    Path(code): Path<String>,
) -> Result<Response, InviteError> {
    let server = config.public_url.origin().ascii_serialization();
    let mut link = Url::parse("stackcall://entrar").expect("valid deep link");
    link.query_pairs_mut()
        .append_pair("servidor", &server)
        .append_pair("codigo", &code);
    let name = config.server_name.clone();
    db::run(config, move |conn| inviter(conn, &code, &name))
        .await
        .map_err(InviteError)?;
    let link = link.as_str().replace('&', "&amp;");
    let nonce = auth::id();
    let html = format!(
        r#"<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Convite do Stackcall</title>
<h1>Convite do Stackcall</h1>
<p><a id="abrir" href="{link}">Abrir no Stackcall</a></p>
<p><a href="https://github.com/stackcall/releases/releases/latest">Baixar o Stackcall</a></p>
<script nonce="{nonce}">window.location.href = document.getElementById("abrir").href;</script>
</html>"#
    );
    Ok(([
        (header::CONTENT_SECURITY_POLICY, format!("default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'")),
        (header::REFERRER_POLICY, "no-referrer".into()),
        (header::CACHE_CONTROL, "no-store".into()),
    ], Html(html)).into_response())
}
