#![cfg(test)]

use super::models::PermissionScope;
use super::Db;

#[test]
fn settings_roundtrip() {
    let db = Db::in_memory().unwrap();
    assert_eq!(db.get_setting("voice.name").unwrap(), None);
    db.set_setting("voice.name", "\"veyra-female-1\"").unwrap();
    assert_eq!(
        db.get_setting("voice.name").unwrap(),
        Some("\"veyra-female-1\"".to_string())
    );
    // overwrite
    db.set_setting("voice.name", "\"veyra-female-2\"").unwrap();
    assert_eq!(
        db.get_setting("voice.name").unwrap(),
        Some("\"veyra-female-2\"".to_string())
    );
}

#[test]
fn tool_permission_defaults_to_ask() {
    let db = Db::in_memory().unwrap();
    assert_eq!(db.get_tool_permission("files.delete").unwrap(), PermissionScope::Ask);
}

#[test]
fn tool_permission_persists_grant() {
    let db = Db::in_memory().unwrap();
    db.set_tool_permission("files.delete", PermissionScope::Allow).unwrap();
    assert_eq!(db.get_tool_permission("files.delete").unwrap(), PermissionScope::Allow);

    db.set_tool_permission("files.delete", PermissionScope::Denied).unwrap();
    assert_eq!(db.get_tool_permission("files.delete").unwrap(), PermissionScope::Denied);
}

#[test]
fn audit_log_records_and_orders_recent_first() {
    let db = Db::in_memory().unwrap();
    db.audit("computer.files", "delete", "/tmp/a.txt", "ok").unwrap();
    db.audit("computer.files", "create", "/tmp/b.txt", "ok").unwrap();
    let entries = db.recent_audit(10).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].action, "create");
    assert_eq!(entries[1].action, "delete");
}

#[test]
fn migrations_are_idempotent_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("veyra_test.sqlite3");

    {
        let db = Db::open(Some(path.clone())).unwrap();
        db.set_setting("k", "v").unwrap();
    }
    // Reopening must not fail even though migrations already ran.
    let db = Db::open(Some(path)).unwrap();
    assert_eq!(db.get_setting("k").unwrap(), Some("v".to_string()));
}

#[test]
fn performance_metrics_are_recorded() {
    let db = Db::in_memory().unwrap();
    db.record_metric("stt.first_partial_ms", 180.0).unwrap();
    db.record_metric("llm.first_token_ms", 420.0).unwrap();
    // No dedicated reader yet beyond direct SQL; this test guards against
    // the insert statement itself regressing (column/type mismatch).
}
