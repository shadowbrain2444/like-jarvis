//! Settings, tool-permission and audit-log commands exposed to the
//! frontend. Settings values are opaque JSON strings from Rust's point of
//! view — the frontend owns the schema (see `src/settings/settingsStore.ts`)
//! so new settings never require a Rust-side migration.

use crate::db::models::{AuditEntry, PermissionScope};
use crate::error::VeyraResult;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<AppState>, key: String) -> VeyraResult<Option<String>> {
    state.db.get_setting(&key)
}

#[tauri::command]
pub fn settings_set(state: State<AppState>, key: String, value: String) -> VeyraResult<()> {
    state.db.set_setting(&key, &value)
}

#[derive(Serialize)]
pub struct SettingPair {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub fn settings_get_all(state: State<AppState>) -> VeyraResult<Vec<SettingPair>> {
    Ok(state
        .db
        .get_all_settings()?
        .into_iter()
        .map(|(key, value)| SettingPair { key, value })
        .collect())
}

#[tauri::command]
pub fn permission_get(state: State<AppState>, tool_name: String) -> VeyraResult<PermissionScope> {
    state.db.get_tool_permission(&tool_name)
}

#[tauri::command]
pub fn permission_set(
    state: State<AppState>,
    tool_name: String,
    scope: PermissionScope,
) -> VeyraResult<()> {
    state.db.set_tool_permission(&tool_name, scope)
}

#[tauri::command]
pub fn audit_recent(state: State<AppState>, limit: Option<u32>) -> VeyraResult<Vec<AuditEntry>> {
    state.db.recent_audit(limit.unwrap_or(100))
}

#[tauri::command]
pub fn metric_record(state: State<AppState>, metric: String, value_ms: f64) -> VeyraResult<()> {
    state.db.record_metric(&metric, value_ms)
}
