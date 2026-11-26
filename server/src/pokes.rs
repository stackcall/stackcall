use crate::{
    Config,
    auth::{self, User},
    db, push,
};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/cutucar", post(create))
        .route("/api/eu/cutucadas", get(get_preference).put(set_preference))
}

#[derive(Deserialize)]
struct PokeInput {
    para: String,
    #[serde(default)]
    recado: String,
}

#[derive(Serialize)]
pub struct Poke {
    id: String,
    de: String,
    recado: String,
    criado_em: i64,
}

#[derive(Deserialize, Serialize)]
struct Preference {
    receber: String,
}

async fn get_preference(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Preference>, StatusCode> {
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let receber = conn
            .query_row(
                "SELECT receber_cutucadas FROM usuarios WHERE id = ?1",
                [&user.id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        Ok(Json(Preference { receber }))
    })
    .await
}

async fn set_preference(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<Preference>,
) -> Result<StatusCode, StatusCode> {
    if !matches!(input.receber.as_str(), "todos" | "amigos" | "ninguem") {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        conn.execute(
            "UPDATE usuarios SET receber_cutucadas = ?1 WHERE id = ?2",
            params![input.receber, user.id],
        )
        .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn create(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<PokeInput>,
) -> Result<StatusCode, StatusCode> {
    if !auth::is_hex(&input.para, 32)
        || input.para == user.id
        || input.recado.chars().count() > 80
        || input.recado.chars().any(char::is_control)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let notify_config = config.clone();
    let recipient = input.para.clone();
    let note = input.recado.trim().to_owned();
    let sender = db::run(config, move |conn| {
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db::internal)?;
        user.ensure_active(&tx)?;
        let accepts: bool = tx
            .query_row(
                "SELECT receber_cutucadas = 'todos' OR (receber_cutucadas = 'amigos' AND EXISTS (
                SELECT 1 FROM amizades WHERE usuario_id = ?2 AND amigo_id = ?1
             )) FROM usuarios WHERE id = ?2 AND removido_em IS NULL",
                params![user.id, input.para],
                |row| row.get(0),
            )
            .optional()
            .map_err(db::internal)?
            .ok_or(StatusCode::NOT_FOUND)?;
        if !accepts {
            return Err(StatusCode::FORBIDDEN);
        }
        let now: f64 = tx
            .query_row("SELECT unixepoch('subsec')", [], |row| row.get(0))
            .map_err(db::internal)?;
        let (total, pair): (i64, i64) = tx.query_row(
            "SELECT count(*), count(*) FILTER (WHERE destinatario_id = ?2 AND criado_em > ?3 - 30)
             FROM cutucadas WHERE remetente_id = ?1 AND criado_em > ?3 - 60",
            params![user.id, input.para, now], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(db::internal)?;
        if total >= 10 || pair > 0 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        tx.execute("DELETE FROM cutucadas WHERE criado_em <= ?1 - 120", [now])
            .map_err(db::internal)?;
        tx.execute(
            "INSERT INTO cutucadas (id, remetente_id, destinatario_id, recado, criado_em)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![auth::id(), user.id, input.para, input.recado.trim(), now],
        )
        .map_err(db::internal)?;
        let sender: String = tx
            .query_row(
                "SELECT nome FROM usuarios WHERE id = ?1",
                [&user.id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok(sender)
    })
    .await?;
    push::notify(
        notify_config,
        vec![recipient],
        serde_json::json!({
            "tipo": "cutucada",
            "titulo": format!("{sender} cutucou você"),
            "texto": if note.is_empty() { "Toque para abrir o Stackcall.".to_owned() } else { note },
        }),
    );
    Ok(StatusCode::NO_CONTENT)
}

pub fn take(conn: &mut Connection, recipient: &str) -> Result<Vec<Poke>, StatusCode> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db::internal)?;
    let cutoff: f64 = tx
        .query_row("SELECT unixepoch('subsec') - 120", [], |row| row.get(0))
        .map_err(db::internal)?;
    let pending = {
        let mut query = tx.prepare(
            "SELECT p.id, p.remetente_id, p.recado, CAST(p.criado_em AS INTEGER)
             FROM cutucadas p
             JOIN usuarios sender ON sender.id = p.remetente_id AND sender.removido_em IS NULL
             JOIN usuarios recipient ON recipient.id = p.destinatario_id AND recipient.removido_em IS NULL
             WHERE p.destinatario_id = ?1 AND p.entregue = 0 AND p.criado_em > ?2
               AND (recipient.receber_cutucadas = 'todos' OR (recipient.receber_cutucadas = 'amigos' AND EXISTS (
                   SELECT 1 FROM amizades WHERE usuario_id = ?1 AND amigo_id = p.remetente_id
               )))
             ORDER BY p.criado_em, p.id",
        ).map_err(db::internal)?;
        query
            .query_map(params![recipient, cutoff], |row| {
                Ok(Poke {
                    id: row.get(0)?,
                    de: row.get(1)?,
                    recado: row.get(2)?,
                    criado_em: row.get(3)?,
                })
            })
            .map_err(db::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db::internal)?
    };
    // Keep the timestamps for rate limiting after consuming the inbox.
    tx.execute(
        "UPDATE cutucadas SET entregue = 1, recado = '' WHERE destinatario_id = ?1 AND entregue = 0",
        [recipient],
    ).map_err(db::internal)?;
    tx.commit().map_err(db::internal)?;
    Ok(pending)
}
