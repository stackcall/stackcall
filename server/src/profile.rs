use crate::{
    Config,
    auth::{self, User},
    db,
};
use axum::{
    Json, Router,
    body::{Body, Bytes, to_bytes},
    extract::{Path, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, patch, put},
};
use image::{
    ExtendedColorType, ImageEncoder, ImageFormat, ImageReader, Limits, codecs::webp::WebPEncoder,
    imageops::FilterType,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Deserializer};
use sha2::{Digest, Sha256};
use std::{io::Cursor, sync::Arc, time::Duration};

const MAX_BYTES: usize = 1024 * 1024;

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/eu/perfil", patch(update))
        .route("/api/eu/avatar", put(avatar))
        .route("/api/eu/banner", put(banner))
        .route("/media/{file}", get(media))
}

#[derive(Deserialize)]
struct Profile {
    bio: Option<String>,
    tema_perfil: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    cor: Option<Option<String>>,
}

fn nullable<'de, D: Deserializer<'de>>(input: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(input).map(Some)
}

async fn update(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<Profile>,
) -> Result<Json<auth::Profile>, StatusCode> {
    if input.bio.as_ref().is_some_and(|bio| {
        bio.chars().count() > 160 || bio.chars().any(|ch| ch.is_control() && ch != '\n')
    }) || input
        .tema_perfil
        .as_deref()
        .is_some_and(|theme| !matches!(theme, "papel" | "noite" | "lima"))
        || input
            .cor
            .as_ref()
            .and_then(Option::as_deref)
            .is_some_and(|color| {
                !color.strip_prefix('#').is_some_and(|hex| {
                    hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
            })
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        conn.execute(
            "UPDATE usuarios SET bio = COALESCE(?1, bio), tema_perfil = COALESCE(?2, tema_perfil),
             cor = CASE WHEN ?3 THEN ?4 ELSE cor END WHERE id = ?5",
            params![
                input.bio,
                input.tema_perfil,
                input.cor.is_some(),
                input.cor.flatten(),
                user.id
            ],
        )
        .map_err(db::internal)?;
        auth::profile(conn, &user.id)
            .map(Json)
            .map_err(db::internal)
    })
    .await
}

async fn avatar(
    State(config): State<Arc<Config>>,
    user: User,
    request: Request,
) -> Result<Json<auth::Profile>, StatusCode> {
    upload(config, user, request, false).await
}

async fn banner(
    State(config): State<Arc<Config>>,
    user: User,
    request: Request,
) -> Result<Json<auth::Profile>, StatusCode> {
    upload(config, user, request, true).await
}

async fn upload(
    config: Arc<Config>,
    user: User,
    request: Request,
    banner: bool,
) -> Result<Json<auth::Profile>, StatusCode> {
    let permit = config
        .image_jobs
        .clone()
        .try_acquire_owned()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let bytes = tokio::time::timeout(
        Duration::from_secs(10),
        to_bytes(request.into_body(), MAX_BYTES),
    )
    .await
    .map_err(|_| StatusCode::REQUEST_TIMEOUT)?
    .map_err(|err| {
        if std::error::Error::source(&err)
            .is_some_and(|cause| cause.is::<http_body_util::LengthLimitError>())
        {
            StatusCode::PAYLOAD_TOO_LARGE
        } else {
            StatusCode::BAD_REQUEST
        }
    })?;
    let webp = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        encode(bytes, banner)
    })
    .await
    .map_err(db::internal)??;
    let hash = auth::hex(&Sha256::digest(&webp));
    db::run(config, move |conn| {
        let tx = conn.transaction().map_err(db::internal)?;
        user.ensure_active(&tx)?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT CASE WHEN ?1 THEN banner ELSE avatar END FROM usuarios WHERE id = ?2",
                params![banner, user.id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        tx.execute(
            "INSERT INTO midias VALUES (?1, ?2) ON CONFLICT(hash) DO NOTHING",
            params![hash, webp],
        )
        .map_err(db::internal)?;
        let update = if banner {
            "UPDATE usuarios SET banner = ?1 WHERE id = ?2"
        } else {
            "UPDATE usuarios SET avatar = ?1 WHERE id = ?2"
        };
        tx.execute(update, params![hash, user.id])
            .map_err(db::internal)?;
        if let Some(previous) = previous {
            tx.execute(
                "DELETE FROM midias WHERE hash = ?1
                 AND NOT EXISTS (SELECT 1 FROM usuarios WHERE avatar = ?1)
                 AND NOT EXISTS (SELECT 1 FROM usuarios WHERE banner = ?1)",
                [previous],
            )
            .map_err(db::internal)?;
        }
        let user = auth::profile(&tx, &user.id).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(Json(user))
    })
    .await
}

fn encode(bytes: Bytes, banner: bool) -> Result<Vec<u8>, StatusCode> {
    let format = image::guess_format(&bytes).map_err(|_| StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(2048);
    limits.max_image_height = Some(2048);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)?;
    let (width, height) = if banner { (1200, 400) } else { (256, 256) };
    let image = if image.width() > width || image.height() > height {
        image.resize(width, height, FilterType::Triangle)
    } else {
        image
    }
    .into_rgba8();
    let mut webp = Vec::new();
    WebPEncoder::new_lossless(&mut webp)
        .write_image(
            &image,
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(db::internal)?;
    Ok(webp)
}

async fn media(
    State(config): State<Arc<Config>>,
    Path(file): Path<String>,
) -> Result<Response, StatusCode> {
    let hash = file
        .strip_suffix(".webp")
        .filter(|hash| auth::is_hex(hash, 64))
        .ok_or(StatusCode::NOT_FOUND)?
        .to_owned();
    let bytes: Vec<u8> = db::run(config, move |conn| {
        conn.query_row("SELECT webp FROM midias WHERE hash = ?1", [hash], |row| {
            row.get(0)
        })
        .optional()
        .map_err(db::internal)?
        .ok_or(StatusCode::NOT_FOUND)
    })
    .await?;
    Ok((
        [
            (header::CONTENT_TYPE, "image/webp"),
            (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Body::from(bytes),
    )
        .into_response())
}
