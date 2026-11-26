//! "Bora?": someone calls the group to play; everyone answers with one tap.
//! A call lasts 2 hours; each person has at most one open call.
use crate::{
    Config,
    auth::{self, User},
    db, push,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

const DURACAO: i64 = 2 * 3600;

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/boras", get(list).post(create))
        .route("/api/boras/{id}", delete(close))
        .route("/api/boras/{id}/resposta", post(answer))
}

#[derive(Serialize)]
struct Resposta {
    usuario: String,
    resposta: String,
    em: i64,
}

#[derive(Serialize)]
struct Bora {
    id: String,
    autor: String,
    sala: Option<String>,
    recado: String,
    criado_em: i64,
    expira_em: i64,
    respostas: Vec<Resposta>,
}

fn open_calls(conn: &Connection) -> rusqlite::Result<Vec<Bora>> {
    let mut query = conn.prepare(
        "SELECT b.id, b.autor_id, b.sala_id, b.recado, b.criado_em, b.expira_em
         FROM boras b JOIN usuarios u ON u.id = b.autor_id AND u.removido_em IS NULL
         WHERE b.expira_em > unixepoch() ORDER BY b.criado_em DESC LIMIT 20",
    )?;
    let mut answers = conn.prepare(
        "SELECT r.usuario_id, r.resposta, r.em FROM bora_respostas r
         JOIN usuarios u ON u.id = r.usuario_id AND u.removido_em IS NULL
         WHERE r.bora_id = ?1 ORDER BY r.em",
    )?;
    let calls = query
        .query_map([], |row| {
            Ok(Bora {
                id: row.get(0)?,
                autor: row.get(1)?,
                sala: row.get(2)?,
                recado: row.get(3)?,
                criado_em: row.get(4)?,
                expira_em: row.get(5)?,
                respostas: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    calls
        .into_iter()
        .map(|mut call| {
            call.respostas = answers
                .query_map([&call.id], |row| {
                    Ok(Resposta {
                        usuario: row.get(0)?,
                        resposta: row.get(1)?,
                        em: row.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(call)
        })
        .collect()
}

async fn list(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Vec<Bora>>, StatusCode> {
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        open_calls(conn).map(Json).map_err(db::internal)
    })
    .await
}

#[derive(Deserialize)]
struct NewCall {
    #[serde(default)]
    sala: Option<String>,
    #[serde(default)]
    recado: String,
}

async fn create(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<NewCall>,
) -> Result<(StatusCode, Json<serde_json::Value>), StatusCode> {
    let recado = input.recado.trim().to_owned();
    if recado.chars().count() > 80
        || recado.chars().any(char::is_control)
        || input.sala.as_ref().is_some_and(|id| !auth::is_hex(id, 32))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let notify_config = config.clone();
    let (id, author, room, targets) = db::run(config, move |conn| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db::internal)?;
        user.ensure_active(&tx)?;
        let recent: i64 = tx
            .query_row(
                "SELECT count(*) FROM boras WHERE autor_id = ?1 AND criado_em > unixepoch() - 600",
                [&user.id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        if recent >= 3 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        let room: Option<(String, String)> = match &input.sala {
            Some(id) => Some(
                tx.query_row("SELECT id, nome FROM salas WHERE id = ?1", [id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .optional()
                .map_err(db::internal)?
                .ok_or(StatusCode::NOT_FOUND)?,
            ),
            None => None,
        };
        // One open call per person: a new one replaces the previous.
        tx.execute(
            "UPDATE boras SET expira_em = unixepoch() WHERE autor_id = ?1 AND expira_em > unixepoch()",
            [&user.id],
        )
        .map_err(db::internal)?;
        tx.execute(
            "DELETE FROM boras WHERE expira_em <= unixepoch() - 86400",
            [],
        )
        .map_err(db::internal)?;
        let id = auth::id();
        tx.execute(
            "INSERT INTO boras (id, autor_id, sala_id, recado, criado_em, expira_em)
             VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch() + ?5)",
            params![id, user.id, room.as_ref().map(|r| &r.0), recado, DURACAO],
        )
        .map_err(db::internal)?;
        // The author counts as in.
        tx.execute(
            "INSERT INTO bora_respostas (bora_id, usuario_id, resposta, em) VALUES (?1, ?2, 'dentro', unixepoch())",
            params![id, user.id],
        )
        .map_err(db::internal)?;
        let author: String = tx
            .query_row("SELECT nome FROM usuarios WHERE id = ?1", [&user.id], |row| row.get(0))
            .map_err(db::internal)?;
        // Same rule as pokes: "ninguem" gets nothing, "amigos" only from friends.
        let targets = {
            let mut query = tx
                .prepare(
                    "SELECT u.id FROM usuarios u WHERE u.removido_em IS NULL AND u.id <> ?1
                       AND (u.receber_cutucadas = 'todos' OR (u.receber_cutucadas = 'amigos' AND EXISTS (
                           SELECT 1 FROM amizades WHERE usuario_id = u.id AND amigo_id = ?1)))",
                )
                .map_err(db::internal)?;
            query
                .query_map([&user.id], |row| row.get::<_, String>(0))
                .map_err(db::internal)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(db::internal)?
        };
        tx.commit().map_err(db::internal)?;
        Ok((id, author, room.map(|r| r.1), targets))
    })
    .await?;
    push::notify(
        notify_config,
        targets,
        json!({
            "tipo": "bora",
            "id": id,
            "titulo": format!("{author}: bora?"),
            "texto": room.map_or_else(|| "Toque para responder.".to_owned(), |room| format!("Sala {room}. Toque para responder.")),
        }),
    );
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct Answer {
    resposta: String,
}

async fn answer(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
    Json(input): Json<Answer>,
) -> Result<StatusCode, StatusCode> {
    if !auth::is_hex(&id, 32) || !matches!(input.resposta.as_str(), "dentro" | "10min" | "nao") {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let open: bool = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM boras WHERE id = ?1 AND expira_em > unixepoch())",
                [&id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        if !open {
            return Err(StatusCode::NOT_FOUND);
        }
        conn.execute(
            "INSERT INTO bora_respostas (bora_id, usuario_id, resposta, em) VALUES (?1, ?2, ?3, unixepoch())
             ON CONFLICT (bora_id, usuario_id) DO UPDATE SET resposta = ?3, em = unixepoch()",
            params![id, user.id, input.resposta],
        )
        .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn close(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    if !auth::is_hex(&id, 32) {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let changed = conn
            .execute(
                "UPDATE boras SET expira_em = unixepoch()
                 WHERE id = ?1 AND expira_em > unixepoch() AND (autor_id = ?2 OR ?3)",
                params![id, user.id, user.manager().is_ok()],
            )
            .map_err(db::internal)?;
        if changed == 0 {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}
