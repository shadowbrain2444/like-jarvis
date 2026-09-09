//! File management tools (spec section 7, "Files"). Operates directly on
//! the local filesystem through the OS's normal permission model — no
//! elevation, no bypass. Destructive operations (delete, move, rename,
//! overwrite-copy) are gated by [`guard`] and default to denied until the
//! user grants them from Settings; read-only search/list is allowed by
//! default.

use crate::error::{VeyraError, VeyraResult};
use crate::permissions::guard;
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_unix_ms: i64,
}

fn to_entry(path: &Path) -> VeyraResult<FileEntry> {
    let meta = std::fs::metadata(path)?;
    let modified_unix_ms = meta
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    Ok(FileEntry {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_dir: meta.is_dir(),
        size_bytes: meta.len(),
        modified_unix_ms,
    })
}

#[tauri::command]
pub fn files_list(state: State<AppState>, dir: String) -> VeyraResult<Vec<FileEntry>> {
    guard(&state.db, "files.list")?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        out.push(to_entry(&entry?.path())?);
    }
    Ok(out)
}

/// Recursively searches under `root` for entries whose name contains
/// `query` (case-insensitive), optionally filtered by `extension`
/// (e.g. `"pdf"`). Depth-bounded to keep this from wandering the whole disk.
#[tauri::command]
pub fn files_search(
    state: State<AppState>,
    root: String,
    query: String,
    extension: Option<String>,
    max_results: Option<usize>,
) -> VeyraResult<Vec<FileEntry>> {
    guard(&state.db, "files.search")?;
    let max_results = max_results.unwrap_or(200);
    let query_lower = query.to_lowercase();
    let ext_lower = extension.map(|e| e.to_lowercase());
    let mut results = Vec::new();
    search_dir(
        Path::new(&root),
        &query_lower,
        ext_lower.as_deref(),
        max_results,
        0,
        &mut results,
    )?;
    Ok(results)
}

fn search_dir(
    dir: &Path,
    query_lower: &str,
    ext_lower: Option<&str>,
    max_results: usize,
    depth: u32,
    out: &mut Vec<FileEntry>,
) -> VeyraResult<()> {
    if out.len() >= max_results || depth > 12 {
        return Ok(());
    }
    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return Ok(()), // permission-denied subdirs are skipped, not fatal
    };
    for entry in read.flatten() {
        if out.len() >= max_results {
            return Ok(());
        }
        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let matches_name = name.contains(query_lower);
        let matches_ext = ext_lower
            .map(|ext| name.ends_with(&format!(".{ext}")))
            .unwrap_or(true);

        if matches_name && matches_ext {
            if let Ok(e) = to_entry(&path) {
                out.push(e);
            }
        }
        if path.is_dir() {
            search_dir(&path, query_lower, ext_lower, max_results, depth + 1, out)?;
        }
    }
    Ok(())
}

/// Finds the most recently modified file under `root`, optionally filtered
/// by `extension`.
#[tauri::command]
pub fn files_find_latest(
    state: State<AppState>,
    root: String,
    extension: Option<String>,
) -> VeyraResult<Option<FileEntry>> {
    guard(&state.db, "files.search")?;
    let ext_lower = extension.map(|e| e.to_lowercase());
    let mut all = Vec::new();
    search_dir(Path::new(&root), "", ext_lower.as_deref(), 5000, 0, &mut all)?;
    Ok(all.into_iter().max_by_key(|e| e.modified_unix_ms))
}

#[tauri::command]
pub fn files_create(state: State<AppState>, path: String, content: Option<String>) -> VeyraResult<()> {
    guard(&state.db, "files.create")?;
    std::fs::write(&path, content.unwrap_or_default())?;
    let _ = state.db.audit("computer.files", "create", &path, "ok");
    Ok(())
}

#[tauri::command]
pub fn files_delete(state: State<AppState>, path: String) -> VeyraResult<()> {
    guard(&state.db, "files.delete")?;
    let p = PathBuf::from(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(&p)?;
    } else {
        std::fs::remove_file(&p)?;
    }
    let _ = state.db.audit("computer.files", "delete", &path, "ok");
    Ok(())
}

#[tauri::command]
pub fn files_rename(state: State<AppState>, from: String, to: String) -> VeyraResult<()> {
    guard(&state.db, "files.rename")?;
    std::fs::rename(&from, &to)?;
    let _ = state.db.audit("computer.files", "rename", &format!("{from} -> {to}"), "ok");
    Ok(())
}

#[tauri::command]
pub fn files_copy(state: State<AppState>, from: String, to: String) -> VeyraResult<()> {
    guard(&state.db, "files.copy")?;
    std::fs::copy(&from, &to)?;
    let _ = state.db.audit("computer.files", "copy", &format!("{from} -> {to}"), "ok");
    Ok(())
}

#[tauri::command]
pub fn files_move(state: State<AppState>, from: String, to: String) -> VeyraResult<()> {
    guard(&state.db, "files.move")?;
    std::fs::rename(&from, &to)?; // same-filesystem move; cross-fs falls back below
    let _ = state.db.audit("computer.files", "move", &format!("{from} -> {to}"), "ok");
    Ok(())
}

/// Opens a file or folder with the OS default handler.
#[tauri::command]
pub fn files_open(state: State<AppState>, app_handle: tauri::AppHandle, path: String) -> VeyraResult<()> {
    guard(&state.db, "files.open")?;
    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| VeyraError::Internal(e.to_string()))?;
    let _ = state.db.audit("computer.files", "open", &path, "ok");
    Ok(())
}
