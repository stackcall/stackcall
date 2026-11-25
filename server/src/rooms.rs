use crate::{
    Config,
    auth::{self, User},
    db,
    livekit::Tokens,
    valid_name,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post},
};
use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/salas", get(list).post(create))
        .route("/api/salas/{id}", patch(update).delete(delete))
        .route("/api/salas/{id}/token", post(token))
}

pub fn ensure_exists(conn: &rusqlite::Connection, id: &str) -> Result<(), StatusCode> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM salas WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(db::internal)?;
    if exists {
        Ok(())
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[derive(Serialize)]
struct Room {
    id: String,
    nome: String,
    ordem: i64,
    pessoas: usize,
    no_ar: bool,
}

impl Room {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            nome: row.get(1)?,
            ordem: row.get(2)?,
            pessoas: 0,
            no_ar: false,
        })
    }
}

#[derive(Deserialize)]
struct RoomInput {
    nome: Option<String>,
    ordem: Option<u32>,
}

fn room_name(name: String) -> Result<String, StatusCode> {
    let name = name.trim();
    if !valid_name(name) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(name.to_owned())
}

async fn list(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Vec<Room>>, StatusCode> {
    let mut rooms = db::run(config.clone(), move |conn| {
        user.ensure_active(conn)?;
        let mut query = conn
            .prepare("SELECT id, nome, ordem FROM salas ORDER BY ordem, id")
            .map_err(db::internal)?;
        let rooms = query
            .query_map([], Room::from_row)
            .map_err(db::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db::internal)?;
        Ok(rooms)
    })
    .await?;
    let online = config.livekit.online().await;
    for room in &mut rooms {
        (room.pessoas, room.no_ar) = online.room_status(&room.id);
    }
    Ok(Json(rooms))
}

async fn create(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<RoomInput>,
) -> Result<(StatusCode, Json<Room>), StatusCode> {
    user.manager()?;
    let name = room_name(input.nome.ok_or(StatusCode::BAD_REQUEST)?)?;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let room = conn.query_row(
            "INSERT INTO salas VALUES (?1, ?2, COALESCE(?3, (SELECT MAX(ordem) FROM salas) + 1, 0))
             RETURNING id, nome, ordem",
            params![auth::id(), name, input.ordem], Room::from_row,
        ).map_err(db::internal)?;
        Ok((StatusCode::CREATED, Json(room)))
    })
    .await
}

async fn update(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
    Json(input): Json<RoomInput>,
) -> Result<Json<Room>, StatusCode> {
    user.manager()?;
    let name = input.nome.map(room_name).transpose()?;
    if name.is_none() && input.ordem.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        conn.query_row(
            "UPDATE salas SET nome = COALESCE(?1, nome), ordem = COALESCE(?2, ordem) WHERE id = ?3
             RETURNING id, nome, ordem",
            params![name, input.ordem, id],
            Room::from_row,
        )
        .optional()
        .map_err(db::internal)?
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
    })
    .await
}

async fn delete(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    user.manager()?;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        if conn
            .execute("DELETE FROM salas WHERE id = ?1", [id])
            .map_err(db::internal)?
            == 0
        {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn token(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<Json<Tokens>, StatusCode> {
    db::run(config.clone(), move |conn| {
        user.ensure_active(conn)?;
        let name: String = conn
            .query_row(
                "SELECT u.nome FROM usuarios u WHERE u.id = ?1 AND u.removido_em IS NULL
             AND EXISTS (SELECT 1 FROM salas WHERE id = ?2)",
                params![user.id, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db::internal)?
            .ok_or(StatusCode::NOT_FOUND)?;
        config.livekit.tokens(&user.id, &name, id).map(Json)
    })
    .await
}
