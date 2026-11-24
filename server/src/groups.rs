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
    routing::{get, patch, post},
};
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use url::Url;

const DAY: i64 = 86_400;

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/grupos", post(create_group))
        .route("/api/grupos/{id}", get(group))
        .route("/api/grupos/{id}/salas", post(create_room))
        .route("/api/salas/{id}", patch(update_room).delete(delete_room))
        .route("/api/grupos/{id}/convites", post(create_invite))
        .route(
            "/api/convites/{id}",
            get(preview_invite).delete(revoke_invite),
        )
        .route("/api/convites/{codigo}/aceitar", post(accept_invite))
        .route("/c/{codigo}", get(invite_page))
}

#[derive(Deserialize)]
struct Name {
    nome: String,
}

#[derive(Deserialize)]
struct RoomInput {
    nome: Option<String>,
    ordem: Option<i64>,
}

#[derive(Serialize)]
struct Room {
    id: String,
    grupo_id: String,
    nome: String,
    ordem: i64,
}

impl Room {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            grupo_id: row.get(1)?,
            nome: row.get(2)?,
            ordem: row.get(3)?,
        })
    }
}

fn name(input: String) -> Result<String, StatusCode> {
    let input = input.trim();
    if !valid_name(input) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(input.to_owned())
}

fn group_role(conn: &Connection, group: &str, user: &User) -> Result<String, StatusCode> {
    conn.query_row(
        "SELECT papel FROM membros WHERE grupo_id = ?1 AND usuario_id = ?2",
        params![group, user.id],
        |row| row.get(0),
    )
    .optional()
    .map_err(db::internal)?
    .ok_or(StatusCode::NOT_FOUND)
}

pub fn room_role(conn: &Connection, room: &str, user: &User) -> Result<String, StatusCode> {
    conn.query_row(
        "SELECT m.papel FROM salas s JOIN membros m ON m.grupo_id = s.grupo_id
         WHERE s.id = ?1 AND m.usuario_id = ?2",
        params![room, user.id],
        |row| row.get(0),
    )
    .optional()
    .map_err(db::internal)?
    .ok_or(StatusCode::NOT_FOUND)
}

fn manager(role: &str) -> Result<(), StatusCode> {
    match role {
        "dono" | "admin" => Ok(()),
        _ => Err(StatusCode::FORBIDDEN),
    }
}

async fn create_group(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<Name>,
) -> Result<(StatusCode, Json<Value>), StatusCode> {
    let name = name(input.nome)?;
    db::run(config, move |conn| {
        let tx = conn.transaction().map_err(db::internal)?;
        let id = auth::id();
        tx.execute(
            "INSERT INTO grupos VALUES (?1, ?2, ?3, unixepoch())",
            params![id, name, user.id],
        )
        .map_err(db::internal)?;
        auth::add_member(&tx, &id, &user.id, "dono").map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok((
            StatusCode::CREATED,
            Json(json!({"id": id, "nome": name, "dono_id": user.id, "papel": "dono"})),
        ))
    })
    .await
}

async fn group(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<Json<Value>, StatusCode> {
    db::run(config, move |conn| {
        let role = group_role(conn, &id, &user)?;
        let (name, owner, created): (String, String, i64) = conn.query_row(
            "SELECT nome, dono_id, criado_em FROM grupos WHERE id = ?1",
            [&id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(db::internal)?;
        let rooms = conn.prepare("SELECT id, grupo_id, nome, ordem FROM salas WHERE grupo_id = ?1 ORDER BY ordem, id")
            .and_then(|mut query| query.query_map([&id], Room::from_row)?.collect::<rusqlite::Result<Vec<_>>>())
            .map_err(db::internal)?;
        let members = conn.prepare(
            "SELECT u.id, u.nome_exibicao, u.avatar_url, m.papel, m.entrou_em
             FROM membros m JOIN usuarios u ON u.id = m.usuario_id
             WHERE m.grupo_id = ?1 ORDER BY m.entrou_em, u.id",
        ).and_then(|mut query| query.query_map([&id], |row| Ok(json!({
            "id": row.get::<_, String>(0)?, "nome_exibicao": row.get::<_, String>(1)?,
            "avatar_url": row.get::<_, Option<String>>(2)?, "papel": row.get::<_, String>(3)?,
            "entrou_em": row.get::<_, i64>(4)?,
        })))?.collect::<rusqlite::Result<Vec<_>>>()).map_err(db::internal)?;
        let invites = conn.prepare(
            "SELECT id, criado_por, expira_em, usos_max, usos, revogado FROM convites
             WHERE grupo_id = ?1 AND NOT inicial AND (criado_por = ?2 OR ?3 IN ('dono', 'admin'))
             ORDER BY expira_em DESC, id",
        ).and_then(|mut query| query.query_map(params![id, user.id, role], |row| Ok(json!({
            "id": row.get::<_, String>(0)?, "criado_por": row.get::<_, String>(1)?,
            "expira_em": row.get::<_, i64>(2)?, "usos_max": row.get::<_, i64>(3)?,
            "usos": row.get::<_, i64>(4)?, "revogado": row.get::<_, bool>(5)?,
        })))?.collect::<rusqlite::Result<Vec<_>>>()).map_err(db::internal)?;
        Ok(Json(json!({
            "id": id, "nome": name, "dono_id": owner, "criado_em": created,
            "papel": role, "salas": rooms, "membros": members, "convites": invites,
        })))
    }).await
}

async fn create_room(
    State(config): State<Arc<Config>>,
    user: User,
    Path(group): Path<String>,
    Json(input): Json<RoomInput>,
) -> Result<(StatusCode, Json<Room>), StatusCode> {
    let name = name(input.nome.ok_or(StatusCode::BAD_REQUEST)?)?;
    if input.ordem.is_some_and(|order| order < 0) {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        manager(&group_role(conn, &group, &user)?)?;
        let room = conn.query_row(
            "INSERT INTO salas VALUES (?1, ?2, ?3, COALESCE(?4, (SELECT MAX(ordem) FROM salas WHERE grupo_id = ?2) + 1, 0))
             RETURNING id, grupo_id, nome, ordem",
            params![auth::id(), group, name, input.ordem], Room::from_row,
        ).map_err(db::internal)?;
        Ok((StatusCode::CREATED, Json(room)))
    }).await
}

async fn update_room(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
    Json(input): Json<RoomInput>,
) -> Result<Json<Room>, StatusCode> {
    let name = input.nome.map(name).transpose()?;
    if input.ordem.is_some_and(|order| order < 0) || (name.is_none() && input.ordem.is_none()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        manager(&room_role(conn, &id, &user)?)?;
        conn.query_row(
            "UPDATE salas SET nome = COALESCE(?1, nome), ordem = COALESCE(?2, ordem) WHERE id = ?3
             RETURNING id, grupo_id, nome, ordem",
            params![name, input.ordem, id],
            Room::from_row,
        )
        .map(Json)
        .map_err(db::internal)
    })
    .await
}

async fn delete_room(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    db::run(config, move |conn| {
        manager(&room_role(conn, &id, &user)?)?;
        conn.execute("DELETE FROM salas WHERE id = ?1", [id])
            .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

#[derive(Deserialize)]
struct InviteInput {
    dias: Option<i64>,
    usos_max: Option<i64>,
}

pub fn invite_url(public_url: &Url, code: &str) -> Url {
    let mut url = public_url.clone();
    url.set_path(&format!("/c/{code}"));
    url
}

async fn create_invite(
    State(config): State<Arc<Config>>,
    user: User,
    Path(group): Path<String>,
    Json(input): Json<InviteInput>,
) -> Result<(StatusCode, Json<Value>), StatusCode> {
    let days = input.dias.unwrap_or(7);
    let limit = input.usos_max.unwrap_or(10);
    if !(1..=365).contains(&days) || !(1..=1000).contains(&limit) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let code = auth::id();
    let url = invite_url(&config.public_url, &code);
    db::run(config, move |conn| {
        group_role(conn, &group, &user)?;
        let id = auth::id();
        let expires: i64 = conn.query_row(
            "INSERT INTO convites (id, grupo_id, criado_por, codigo_hash, expira_em, usos_max)
             VALUES (?1, ?2, ?3, ?4, unixepoch() + ?5, ?6) RETURNING expira_em",
            params![id, group, user.id, auth::hash(&code), days * DAY, limit], |row| row.get(0),
        ).map_err(db::internal)?;
        Ok((StatusCode::CREATED, Json(json!({"id": id, "codigo": code, "url": url.as_str(), "expira_em": expires, "usos_max": limit}))))
    }).await
}

async fn revoke_invite(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    db::run(config, move |conn| {
        let (creator, role): (String, String) = conn.query_row(
            "SELECT c.criado_por, m.papel FROM convites c JOIN membros m ON m.grupo_id = c.grupo_id
             WHERE c.id = ?1 AND m.usuario_id = ?2 AND NOT c.inicial",
            params![id, user.id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(db::internal)?.ok_or(StatusCode::NOT_FOUND)?;
        if creator != user.id {
            manager(&role)?;
        }
        conn.execute("UPDATE convites SET revogado = 1 WHERE id = ?1", [id])
            .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

fn preview(conn: &Connection, code: &str) -> Result<(String, String, String), StatusCode> {
    if !auth::is_hex(code, 32) {
        return Err(StatusCode::NOT_FOUND);
    }
    conn.query_row(
        "SELECT g.id, g.nome, COALESCE(u.nome_exibicao, 'Stackcall')
         FROM convites c JOIN grupos g ON g.id = c.grupo_id LEFT JOIN usuarios u ON u.id = c.criado_por
         WHERE c.codigo_hash = ?1 AND NOT c.revogado AND c.usos < c.usos_max AND c.expira_em > unixepoch()",
        [auth::hash(code)], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(db::internal)?.ok_or(StatusCode::NOT_FOUND)
}

fn invite_error(status: StatusCode) -> Response {
    if status == StatusCode::NOT_FOUND {
        (status, Json(json!({"erro": "Convite indisponível"}))).into_response()
    } else {
        status.into_response()
    }
}

async fn preview_invite(
    State(config): State<Arc<Config>>,
    Path(code): Path<String>,
) -> Result<Json<Value>, Response> {
    let (_, name, creator) = db::run(config, move |conn| preview(conn, &code))
        .await
        .map_err(invite_error)?;
    Ok(Json(json!({"grupo": name, "convidado_por": creator})))
}

async fn accept_invite(
    State(config): State<Arc<Config>>,
    user: User,
    Path(code): Path<String>,
) -> Result<Json<Value>, Response> {
    db::run(config, move |conn| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db::internal)?;
        let (group, _, _) = preview(&tx, &code)?;
        let is_member: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM membros WHERE grupo_id = ?1 AND usuario_id = ?2)",
                params![group, user.id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        if is_member {
            return Err(StatusCode::CONFLICT);
        }
        auth::consume_invite(&tx, &auth::hash(&code))?;
        auth::add_member(&tx, &group, &user.id, "membro").map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(Json(json!({"grupo_id": group})))
    })
    .await
    .map_err(invite_error)
}

async fn invite_page(
    State(config): State<Arc<Config>>,
    Path(code): Path<String>,
) -> Result<Response, Response> {
    let origin = config.public_url.origin().ascii_serialization();
    let mut link = Url::parse("stackcall://entrar").expect("valid deep link");
    link.query_pairs_mut()
        .append_pair("instancia", &origin)
        .append_pair("codigo", &code);
    db::run(config, move |conn| preview(conn, &code))
        .await
        .map_err(invite_error)?;
    let link = link.as_str().replace('&', "&amp;");
    let nonce = auth::id();
    let html = format!(
        r#"<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Convite do Stackcall</title>
<h1>Convite do Stackcall</h1>
<p><a id="abrir" href="{link}">Abrir no Stackcall</a></p>
<p><a href="https://github.com/stackcall/stackcall/releases/latest">Baixar o Stackcall</a></p>
<script nonce="{nonce}">window.location.href = document.getElementById("abrir").href;</script>
</html>"#
    );
    Ok(([
        (header::CONTENT_SECURITY_POLICY, format!("default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'")),
        (header::REFERRER_POLICY, "no-referrer".into()),
        (header::CACHE_CONTROL, "no-store".into()),
    ], Html(html)).into_response())
}
