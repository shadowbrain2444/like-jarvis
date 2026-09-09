#![cfg(test)]

use crate::db::models::PermissionScope;
use crate::db::Db;
use crate::permissions::guard;

#[test]
fn safe_by_default_tool_is_allowed_without_grant() {
    let db = Db::in_memory().unwrap();
    assert!(guard(&db, "system.info").is_ok());
    assert!(guard(&db, "clipboard.read").is_ok());
}

#[test]
fn destructive_tool_is_denied_without_grant() {
    let db = Db::in_memory().unwrap();
    let err = guard(&db, "files.delete").unwrap_err();
    assert_eq!(err.code(), "PERMISSION_DENIED");
}

#[test]
fn destructive_tool_succeeds_once_granted() {
    let db = Db::in_memory().unwrap();
    db.set_tool_permission("files.delete", PermissionScope::Allow).unwrap();
    assert!(guard(&db, "files.delete").is_ok());
}

#[test]
fn explicit_denial_overrides_safe_default_list() {
    let db = Db::in_memory().unwrap();
    db.set_tool_permission("system.info", PermissionScope::Denied).unwrap();
    assert!(guard(&db, "system.info").is_err());
}

#[test]
fn every_guard_call_is_audited() {
    let db = Db::in_memory().unwrap();
    let _ = guard(&db, "system.info");
    let _ = guard(&db, "files.delete");
    let entries = db.recent_audit(10).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|e| e.result == "ok"));
    assert!(entries.iter().any(|e| e.result == "denied"));
}
