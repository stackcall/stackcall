use crate::{
    Config,
    auth::{self, User},
    db, rooms, sleep,
};
use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};

pub fn routes() -> Router<Arc<Config>> {
    Router::new().route("/api/chamar", post(create))
}

#[derive(Deserialize)]
struct CallInput {
    sala_id: String,
    mensagem: Option<String>,
}

#[derive(Serialize)]
pub struct Call {
    id: String,
    sala_id: String,
    mensagem: Option<String>,
    expira_em: i64,
}

pub fn for_recipient(
    conn: &Connection,
    user: &str,
) -> Result<HashMap<String, Vec<Call>>, StatusCode> {
    let mut query = conn
        .prepare(
            "SELECT c.autor_id, c.id, c.sala_id, c.mensagem, CAST(c.criado_em + 120 AS INTEGER)
         FROM chamados_destinos d JOIN chamados c ON c.id = d.chamado_id
         JOIN salas s ON s.id = c.sala_pai_id
         WHERE d.usuario_id = ?1 AND c.criado_em + 120 > unixepoch('subsec')
         ORDER BY c.criado_em, c.id",
        )
        .map_err(db::internal)?;
    let rows = query
        .query_map([user], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Call {
                    id: row.get(1)?,
                    sala_id: row.get(2)?,
                    mensagem: row.get(3)?,
                    expira_em: row.get(4)?,
                },
            ))
        })
        .map_err(db::internal)?;
    let mut calls: HashMap<String, Vec<Call>> = HashMap::new();
    for row in rows {
        let (author, call) = row.map_err(db::internal)?;
        calls.entry(author).or_default().push(call);
    }
    Ok(calls)
}

async fn create(
    State(config): State<Arc<Config>>,
    user: User,
    Json(input): Json<CallInput>,
) -> Result<(StatusCode, Json<Call>), StatusCode> {
    let message = input.mensagem.as_deref().unwrap_or_default();
    if message.trim().chars().count() > 120 || message.chars().any(char::is_control) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let message = Some(message.trim().to_owned()).filter(|message| !message.is_empty());
    let online = sleep::try_presence(&config).await?;
    db::run(config, move |conn| {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db::internal)?;
        user.ensure_active(&tx)?;
        rooms::ensure_exists(&tx, &input.sala_id)?;
        tx.execute("DELETE FROM chamados WHERE criado_em + 120 <= unixepoch('subsec')", []).map_err(db::internal)?;
        let call_id = auth::id();
        let created = tx.execute(
            "INSERT INTO chamados SELECT ?1, ?2, ?3, ?4, ?5, unixepoch('subsec')
             WHERE NOT EXISTS (SELECT 1 FROM chamados WHERE autor_id = ?2 AND criado_em + 60 > unixepoch('subsec'))",
            params![call_id, user.id, input.sala_id, rooms::parent_id(&input.sala_id), message],
        ).map_err(db::internal)?;
        if created == 0 {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
        {
            let mut friends = tx.prepare("SELECT amigo_id FROM amizades WHERE usuario_id = ?1").map_err(db::internal)?;
            let friends = friends.query_map([&user.id], |row| row.get::<_, String>(0)).map_err(db::internal)?;
            for friend in friends {
                let friend = friend.map_err(db::internal)?;
                if online.room_for(&friend).is_some() {
                    tx.execute("INSERT INTO chamados_destinos VALUES (?1, ?2)", params![call_id, friend]).map_err(db::internal)?;
                }
            }
        }
        let expires = tx.query_row("SELECT CAST(criado_em + 120 AS INTEGER) FROM chamados WHERE id = ?1",
            [&call_id], |row| row.get(0)).map_err(db::internal)?;
        tx.commit().map_err(db::internal)?;
        Ok((StatusCode::CREATED, Json(Call { id: call_id, sala_id: input.sala_id, mensagem: message, expira_em: expires })))
    }).await
}
