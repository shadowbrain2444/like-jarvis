//! Typed data-access methods layered over [`super::Db`]. Keeping the SQL
//! next to the model it maps to keeps `mod.rs` a pure connection manager.

use super::Db;
use crate::error::VeyraResult;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub category: String,
    pub action: String,
    pub detail: String,
    pub result: String, // "ok" | "denied" | "error"
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionScope {
    /// Never allowed; every call is rejected.
    Denied,
    /// Caller must confirm in the UI every time (default for destructive tools).
    Ask,
    /// Pre-approved; calls proceed without a prompt.
    Allow,
}

impl PermissionScope {
    fn as_str(&self) -> &'static str {
        match self {
            PermissionScope::Denied => "denied",
            PermissionScope::Ask => "ask",
            PermissionScope::Allow => "allow",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "allow" => PermissionScope::Allow,
            "denied" => PermissionScope::Denied,
            _ => PermissionScope::Ask,
        }
    }
}

impl Db {
    // ---- settings (simple key/value JSON store) ----

    pub fn get_setting(&self, key: &str) -> VeyraResult<Option<String>> {
        let conn = self.lock();
        Ok(conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> VeyraResult<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> VeyraResult<Vec<(String, String)>> {
        let conn = self.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---- tool permissions ----

    pub fn get_tool_permission(&self, tool_name: &str) -> VeyraResult<PermissionScope> {
        let conn = self.lock();
        let scope: Option<String> = conn
            .query_row(
                "SELECT scope FROM tool_permissions WHERE tool_name = ?1",
                [tool_name],
                |r| r.get(0),
            )
            .optional()?;
        Ok(scope
            .map(|s| PermissionScope::from_str(&s))
            .unwrap_or(PermissionScope::Ask))
    }

    pub fn set_tool_permission(&self, tool_name: &str, scope: PermissionScope) -> VeyraResult<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO tool_permissions (tool_name, granted, scope, updated_at)
             VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(tool_name) DO UPDATE SET granted = excluded.granted, scope = excluded.scope, updated_at = datetime('now')",
            params![tool_name, matches!(scope, PermissionScope::Allow) as i64, scope.as_str()],
        )?;
        Ok(())
    }

    // ---- audit log ----

    pub fn audit(&self, category: &str, action: &str, detail: &str, result: &str) -> VeyraResult<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO audit_log (id, category, action, detail, result) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![uuid::Uuid::new_v4().to_string(), category, action, detail, result],
        )?;
        Ok(())
    }

    pub fn recent_audit(&self, limit: u32) -> VeyraResult<Vec<AuditEntry>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, category, action, detail, result, created_at
             FROM audit_log ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map([limit], |r| {
                Ok(AuditEntry {
                    id: r.get(0)?,
                    category: r.get(1)?,
                    action: r.get(2)?,
                    detail: r.get(3)?,
                    result: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---- performance metrics ----

    pub fn record_metric(&self, metric: &str, value_ms: f64) -> VeyraResult<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO performance_metrics (id, metric, value_ms) VALUES (?1, ?2, ?3)",
            params![uuid::Uuid::new_v4().to_string(), metric, value_ms],
        )?;
        Ok(())
    }
}
