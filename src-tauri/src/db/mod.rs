//! Local persistent storage.
//!
//! VEYRA is local-first: all durable state (settings, conversation history,
//! tool permissions, audit log, device registry) lives in a single SQLite
//! file under the OS app-data directory. Nothing here talks to a network.
//!
//! This module is intentionally the *only* place that knows SQL exists —
//! everything else in the crate goes through [`Db`]'s typed methods, so the
//! storage engine can be swapped later without touching callers.

mod migrations;
pub mod models;
mod tests;

use crate::error::{VeyraError, VeyraResult};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Opens (creating if needed) the VEYRA database in the OS app-data dir,
    /// or wherever `override_path` points (used by tests).
    pub fn open(override_path: Option<PathBuf>) -> VeyraResult<Self> {
        let path = match override_path {
            Some(p) => p,
            None => {
                let mut dir = dirs::data_dir().ok_or_else(|| {
                    VeyraError::Internal("could not resolve OS data directory".into())
                })?;
                dir.push("veyra");
                std::fs::create_dir_all(&dir)?;
                dir.push("veyra.sqlite3");
                dir
            }
        };

        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::run(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Test-only: an ephemeral database with no file on disk.
    #[cfg(test)]
    pub fn in_memory() -> VeyraResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::run(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("veyra db mutex poisoned")
    }
}
