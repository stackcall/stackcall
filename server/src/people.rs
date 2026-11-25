use crate::{
    Config,
    auth::{self, Profile, User},
    db, moderation,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use std::{collections::HashSet, sync::Arc};

pub fn routes() -> Router<Arc<Config>> {
    Router::new()
        .route("/api/pessoas", get(list))
        .route("/api/amigos/{id}", post(add_friend).delete(remove_friend))
        .route("/api/pessoas/{id}", delete(remove_person))
        .route("/api/pessoas/{id}/aparelhos", delete(remove_devices))
}

#[derive(Serialize)]
struct Person {
    #[serde(flatten)]
    profile: Profile,
    amigo: bool,
    online: bool,
    sala: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mudanca_sala: Option<moderation::RoomMove>,
}

async fn list(
    State(config): State<Arc<Config>>,
    user: User,
) -> Result<Json<Vec<Person>>, StatusCode> {
    let online = config.livekit.online().await;
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let mut friends = conn
            .prepare("SELECT amigo_id FROM amizades WHERE usuario_id = ?1")
            .map_err(db::internal)?;
        let friends = friends
            .query_map([&user.id], |row| row.get(0))
            .map_err(db::internal)?
            .collect::<rusqlite::Result<HashSet<String>>>()
            .map_err(db::internal)?;
        let mut users = conn
            .prepare(&format!(
                "SELECT {} FROM usuarios WHERE removido_em IS NULL ORDER BY nome, id",
                auth::PROFILE_FIELDS,
            ))
            .map_err(db::internal)?;
        let mut people = users
            .query_map([], Profile::from_row)
            .map_err(db::internal)?
            .map(|row| {
                row.map(|profile| {
                    let sala = online.room_for(&profile.id);
                    Person {
                        amigo: friends.contains(&profile.id),
                        online: sala.is_some(),
                        sala: sala.map(str::to_owned),
                        profile,
                        mudanca_sala: None,
                    }
                })
            })
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db::internal)?;
        if let Some(own) = people
            .iter_mut()
            .find(|person| person.profile.id == user.id)
        {
            own.mudanca_sala = moderation::pending_move(conn, &user.id)?;
        }
        Ok(Json(people))
    })
    .await
}

async fn add_friend(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    change_friend(config, user, id, true).await
}

async fn remove_friend(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    change_friend(config, user, id, false).await
}

async fn change_friend(
    config: Arc<Config>,
    user: User,
    id: String,
    add: bool,
) -> Result<StatusCode, StatusCode> {
    if id == user.id {
        return Err(StatusCode::BAD_REQUEST);
    }
    db::run(config, move |conn| {
        user.ensure_active(conn)?;
        let active: bool = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = ?1 AND removido_em IS NULL)",
                [&id],
                |row| row.get(0),
            )
            .map_err(db::internal)?;
        if !active {
            return Err(StatusCode::NOT_FOUND);
        }
        let sql = if add {
            "INSERT INTO amizades VALUES (?1, ?2, unixepoch()) ON CONFLICT DO NOTHING"
        } else {
            "DELETE FROM amizades WHERE usuario_id = ?1 AND amigo_id = ?2"
        };
        conn.execute(sql, params![user.id, id])
            .map_err(db::internal)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn remove_person(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    revoke(config.clone(), user, id.clone(), true).await?;
    if let Err(status) = config.livekit.kick(&id).await {
        eprintln!("Aviso: não foi possível desconectar a pessoa removida do LiveKit ({status})");
    }
    Ok(StatusCode::OK)
}

async fn remove_devices(
    State(config): State<Arc<Config>>,
    user: User,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    revoke(config, user, id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn revoke(
    config: Arc<Config>,
    user: User,
    id: String,
    remove_person: bool,
) -> Result<(), StatusCode> {
    user.manager()?;
    db::run(config, move |conn| {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db::internal)?;
        user.ensure_active(&tx)?;
        let (role, removed): (String, bool) = tx.query_row(
            "SELECT papel, removido_em IS NOT NULL FROM usuarios WHERE id = ?1",
            [&id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(db::internal)?.ok_or(StatusCode::NOT_FOUND)?;
        let own = id == user.id;
        if (remove_person && (own || role == "dono"))
            || (!own && user.role != "dono" && role != "membro")
        {
            return Err(StatusCode::FORBIDDEN);
        }
        if removed && !remove_person {
            return Err(StatusCode::NOT_FOUND);
        }
        tx.execute("DELETE FROM sessoes WHERE usuario_id = ?1 AND (NOT ?2 OR token_hash <> ?3)",
            params![id, own, user.token_hash]).map_err(db::internal)?;
        tx.execute("DELETE FROM logins_aparelho WHERE usuario_id = ?1", [&id]).map_err(db::internal)?;
        if remove_person {
            tx.execute("UPDATE usuarios SET removido_em = COALESCE(removido_em, unixepoch()) WHERE id = ?1", [&id])
                .map_err(db::internal)?;
            tx.execute("UPDATE convites SET revogado = 1 WHERE criado_por = ?1", [&id]).map_err(db::internal)?;
            tx.execute("DELETE FROM amizades WHERE usuario_id = ?1 OR amigo_id = ?1", [&id]).map_err(db::internal)?;
        }
        tx.commit().map_err(db::internal)
    }).await
}
