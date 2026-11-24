use crate::Config;
use axum::http::StatusCode;
use std::sync::Arc;

use rusqlite::{Connection, TransactionBehavior};
use std::{path::Path, time::Duration};

const MIGRATIONS: &[&str] = &[include_str!("../migrations/001.sql")];

pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Connection> {
    let mut db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;

    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: usize = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let pending = MIGRATIONS
        .get(version..)
        .ok_or(rusqlite::Error::InvalidQuery)?;
    for migration in pending {
        tx.execute_batch(migration)?;
    }
    tx.pragma_update(None, "user_version", MIGRATIONS.len())?;
    tx.commit()?;
    Ok(db)
}

#[cfg(test)]
mod tests {
    #[test]
    fn creates_the_schema_with_foreign_keys_enabled() {
        let db = super::open(":memory:").unwrap();
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_schema WHERE type = 'table'",
                [],
                |row| row.get::<_, u32>(0)
            )
            .unwrap(),
            7
        );
        assert!(
            db.execute("INSERT INTO salas VALUES ('s', 'missing', 'Geral', 0)", [])
                .is_err()
        );
    }
}

pub fn internal(_: impl std::fmt::Debug) -> StatusCode {
    StatusCode::INTERNAL_SERVER_ERROR
}

pub async fn run<T: Send + 'static>(
    config: Arc<Config>,
    work: impl FnOnce(&mut Connection) -> Result<T, StatusCode> + Send + 'static,
) -> Result<T, StatusCode> {
    tokio::task::spawn_blocking(move || {
        let mut db = config.db.lock().map_err(internal)?;
        work(&mut db)
    })
    .await
    .map_err(internal)?
}
