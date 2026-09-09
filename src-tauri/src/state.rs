use crate::db::Db;
use std::sync::Arc;

/// Shared application state, injected into every Tauri command via
/// `State<AppState>`. Currently just the database handle; grows as new
/// subsystems (skill registry, active session, etc.) come online.
pub struct AppState {
    pub db: Arc<Db>,
}
