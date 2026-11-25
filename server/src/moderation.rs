use crate::{
    Config,
    auth::{self, User},
    db, rooms,
};
use axum::{
    Router,
    extract::{Path, State},
    http::StatusCode,
    routing::post,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub fn routes() -> Router<Arc<Config>> {
    Router::new().route("/api/salas/{sala}/moderacao/{acao}", post(moderate))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Target {
    usuario_id: String,
    destino_id: Option<String>,
}

#[derive(Serialize)]
pub struct RoomMove {
    id: i64,
    origem_id: String,
    destino_id: String,
    expira_em: i64,
}

pub fn pending_move(
    conn: &rusqlite::Connection,
    user: &str,
) -> Result<Option<RoomMove>, StatusCode> {
    conn.query_row(
        "SELECT log.id, log.sala_id, log.destino_id, log.criado_em + 60
         FROM (SELECT * FROM moderacao_log WHERE usuario_id = ?1
               AND resultado IN ('ok', 'reconectar') ORDER BY id DESC LIMIT 1) log
         WHERE log.resultado = 'reconectar' AND log.criado_em + 60 > unixepoch()",
        [user],
        |row| {
            Ok(RoomMove {
                id: row.get(0)?,
                origem_id: row.get(1)?,
                destino_id: row.get(2)?,
                expira_em: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(db::internal)
}

async fn moderate(
    State(config): State<Arc<Config>>,
    user: User,
    Path((room, action)): Path<(String, String)>,
    body: axum::body::Bytes,
) -> Result<StatusCode, StatusCode> {
    user.manager()?;
    let target = match action.as_str() {
        "silenciar" => {
            if !body.is_empty() {
                serde_json::from_slice::<std::collections::BTreeMap<String, serde_json::Value>>(
                    &body,
                )
                .ok()
                .filter(|object| object.is_empty())
                .ok_or(StatusCode::BAD_REQUEST)?;
            }
            None
        }
        "mover" | "retirar" => {
            let target: Target =
                serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
            let valid_destination = match target.destino_id.as_deref() {
                Some(destination) => action == "mover" && destination != room,
                None => action == "retirar",
            };
            if !auth::is_hex(&target.usuario_id, 32) || !valid_destination {
                return Err(StatusCode::BAD_REQUEST);
            }
            Some(target)
        }
        _ => return Err(StatusCode::NOT_FOUND),
    };
    let (room, target, log_id) = db::run(config.clone(), move |conn| {
        user.ensure_active(conn)?;
        rooms::ensure_exists(conn, &room)?;
        if let Some(target) = &target {
            if let Some(destination) = &target.destino_id {
                rooms::ensure_exists(conn, destination)?;
            }
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = ?1 AND removido_em IS NULL)",
                    [&target.usuario_id],
                    |row| row.get(0),
                )
                .map_err(db::internal)?;
            if !exists {
                return Err(StatusCode::NOT_FOUND);
            }
        }
        let log_id = conn
            .query_row(
                "INSERT INTO moderacao_log (autor_id, acao, sala_id, usuario_id, destino_id)
             VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
                params![
                    user.id,
                    action,
                    room,
                    target.as_ref().map(|t| &t.usuario_id),
                    target.as_ref().and_then(|t| t.destino_id.as_ref())
                ],
                |row| row.get::<_, i64>(0),
            )
            .map_err(db::internal)?;
        Ok((room, target, log_id))
    })
    .await?;

    let result = match target {
        None => config.livekit.mute_room(&room).await.map(|()| false),
        Some(target) => match target.destino_id {
            Some(destination) => {
                config
                    .livekit
                    .move_person(&room, &target.usuario_id, &destination)
                    .await
            }
            None => config
                .livekit
                .remove_from_room(&room, &target.usuario_id)
                .await
                .map(|()| false),
        },
    };
    db::run(config, move |conn| {
        let outcome = match result {
            Ok(false) => "ok",
            Ok(true) => "reconectar",
            Err(_) => "falhou",
        };
        conn.execute(
            "UPDATE moderacao_log SET resultado = ?1 WHERE id = ?2",
            params![outcome, log_id],
        )
        .map_err(db::internal)?;
        Ok(())
    })
    .await?;
    result.map(|reconnect| {
        if reconnect {
            StatusCode::ACCEPTED
        } else {
            StatusCode::NO_CONTENT
        }
    })
}
