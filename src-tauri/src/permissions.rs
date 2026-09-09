//! Central permission gate for every Computer Control Engine command.
//!
//! Every tool that touches the OS (files, input, windows, clipboard, apps)
//! goes through [`guard`] before doing anything. This is the one place that
//! decides "denied" vs "allowed" so no individual command can silently skip
//! the check — see spec section 20 (Security Architecture): VEYRA must
//! never bypass the OS security model, and every non-trivial action must be
//! auditable.
//!
//! Tools default to [`PermissionScope::Ask`], which this build treats as
//! "allow and audit" for *read-only / reversible* tools (so VEYRA doesn't
//! nag for ordinary operations, per the UX requirement in section 20) and
//! as "deny" for anything destructive until the user explicitly grants it
//! from Settings. This is a deliberate, narrow allowlist — not a bypass.

use crate::db::models::PermissionScope;
use crate::db::Db;
use crate::error::{VeyraError, VeyraResult};

/// Tools that are safe to run without an explicit grant: read-only or
/// trivially reversible. Everything else requires `PermissionScope::Allow`
/// in the database before it will execute.
const SAFE_BY_DEFAULT: &[&str] = &[
    "system.info",
    "clipboard.read",
    "files.search",
    "files.list",
    "apps.list",
    "windows.list",
];

pub fn guard(db: &Db, tool_name: &str) -> VeyraResult<()> {
    let scope = db.get_tool_permission(tool_name)?;
    let allowed = match scope {
        PermissionScope::Allow => true,
        PermissionScope::Denied => false,
        PermissionScope::Ask => SAFE_BY_DEFAULT.contains(&tool_name),
    };

    if allowed {
        let _ = db.audit("permissions", tool_name, "", "ok");
        Ok(())
    } else {
        let _ = db.audit("permissions", tool_name, "", "denied");
        Err(VeyraError::PermissionDenied(format!(
            "tool '{tool_name}' requires explicit permission; grant it from Settings > Permissions"
        )))
    }
}
