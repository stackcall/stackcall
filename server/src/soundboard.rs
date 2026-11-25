use crate::{
    Config, audio,
    auth::{self, User},
    db, valid_name,
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{error::Error, sync::Arc, time::Duration};

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/soundboard", get(list).post(upload))
        .route("/api/soundboard/{id}", axum::routing::delete(remove))
        .route("/api/soundboard/{id}/arquivo", get(file))
}

#[derive(Deserialize)]
struct SoundInput {
    nome: String,
    emoji: String,
}

#[derive(Serialize)]
struct Sound {
    id: String,
    nome: String,
    emoji: String,
    tipo: String,
    duracao_ms: u64,
    url: String,
}

impl Sound {
    fn new(id: String, nome: String, emoji: String, tipo: String, duracao_ms: u64) -> Self {
        let url = format!("/api/soundboard/{id}/arquivo");
        Self {
            id,
            nome,
            emoji,
            tipo,
            duracao_ms,
            url,
        }
    }
}

async fn list(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Vec<Sound>>, StatusCode> {
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let mut query = conn
            .prepare("SELECT id, nome, emoji, tipo, duracao_ms FROM sons ORDER BY nome, id")
            .map_err(db::internal)?;
        let sounds = query
            .query_map([], |row| {
                Ok(Sound::new(
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .map_err(db::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db::internal)?;
        Ok(Json(sounds))
    })
    .await
}

async fn upload(
    State(config): State<Arc<Config>>,
    user: User,
    Query(input): Query<SoundInput>,
    body: Body,
) -> Result<(StatusCode, Json<Sound>), StatusCode> {
    user.manager()?;
    let name = input.nome.trim();
    if !valid_name(name)
        || input.nome.chars().any(char::is_control)
        || emojis::get(&input.emoji).is_none()
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let name = name.to_owned();
    let job = config
        .sound_jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| StatusCode::TOO_MANY_REQUESTS)?;
    let bytes = tokio::time::timeout(Duration::from_secs(10), to_bytes(body, audio::MAX_BYTES))
        .await
        .map_err(|_| StatusCode::REQUEST_TIMEOUT)?
        .map_err(|error| {
            if error
                .source()
                .is_some_and(|cause| cause.is::<http_body_util::LengthLimitError>())
            {
                StatusCode::PAYLOAD_TOO_LARGE
            } else {
                StatusCode::BAD_REQUEST
            }
        })?
        .to_vec();
    let (mime, millis, bytes) = tokio::task::spawn_blocking(move || {
        let _job = job;
        audio::validate(bytes)
    })
    .await
    .map_err(db::internal)??;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let id = auth::id();
        let inserted = conn.execute(
            "INSERT INTO sons SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT count(*) FROM sons) < 24",
            params![id, name, input.emoji, mime, millis, bytes],
        ).map_err(db::internal)?;
        if inserted == 0 {
            return Err(StatusCode::CONFLICT);
        }
        Ok((
            StatusCode::CREATED,
            Json(Sound::new(id, name, input.emoji, mime.into(), millis)),
        ))
    })
    .await
}

async fn file(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<Response, StatusCode> {
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let (mime, bytes): (String, Vec<u8>) = conn
            .query_row(
                "SELECT tipo, arquivo FROM sons WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db::internal)?
            .ok_or(StatusCode::NOT_FOUND)?;
        Ok((
            [
                (header::CONTENT_TYPE, mime.as_str()),
                (header::CACHE_CONTROL, "private, max-age=86400, immutable"),
                (header::VARY, "Authorization"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            bytes,
        )
            .into_response())
    })
    .await
}

async fn remove(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    user.manager()?;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let deleted = conn
            .execute("DELETE FROM sons WHERE id = ?1", [id])
            .map_err(db::internal)?;
        if deleted == 0 {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}
