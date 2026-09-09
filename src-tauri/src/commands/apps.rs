//! Application lifecycle tools (spec section 7, "Applications"): launch,
//! close, search installed apps, and list running processes.
//!
//! Launching/closing use the OS process APIs directly — no shell injection,
//! no elevation. `app_search` looks in the OS's normal application listing
//! (Start Menu shortcuts on Windows, `.desktop` files on Linux) rather than
//! scanning the whole filesystem.

use crate::error::{VeyraError, VeyraResult};
use crate::permissions::guard;
use crate::state::AppState;
use serde::Serialize;
use sysinfo::System;
use tauri::State;

#[derive(Serialize)]
pub struct RunningApp {
    pub pid: u32,
    pub name: String,
    pub memory_mb: u64,
}

#[derive(Serialize)]
pub struct InstalledApp {
    pub name: String,
    pub launch_target: String,
}

/// Launches an application by executable/command name. `args` are passed
/// through verbatim (not shell-interpreted — `Command` execs the binary
/// directly, so there is no shell metacharacter injection risk).
#[tauri::command]
pub fn app_open(state: State<AppState>, target: String, args: Vec<String>) -> VeyraResult<u32> {
    guard(&state.db, "apps.open")?;
    let child = std::process::Command::new(&target)
        .args(&args)
        .spawn()
        .map_err(|e| VeyraError::Internal(format!("failed to launch '{target}': {e}")))?;
    let pid = child.id();
    let _ = state.db.audit("computer.apps", "open", &target, "ok");
    Ok(pid)
}

#[tauri::command]
pub fn app_close(state: State<AppState>, pid: u32) -> VeyraResult<()> {
    guard(&state.db, "apps.close")?;
    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let process = sys
        .process(sysinfo::Pid::from_u32(pid))
        .ok_or_else(|| VeyraError::NotFound(format!("no running process with pid {pid}")))?;
    if !process.kill() {
        return Err(VeyraError::Internal(format!("failed to terminate pid {pid}")));
    }
    let _ = state.db.audit("computer.apps", "close", &pid.to_string(), "ok");
    Ok(())
}

#[tauri::command]
pub fn app_list_running(state: State<AppState>) -> VeyraResult<Vec<RunningApp>> {
    guard(&state.db, "apps.list")?;
    let mut sys = System::new_all();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    Ok(sys
        .processes()
        .values()
        .map(|p| RunningApp {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().to_string(),
            memory_mb: p.memory() / 1_048_576,
        })
        .collect())
}

#[tauri::command]
pub fn app_search_installed(state: State<AppState>, query: String) -> VeyraResult<Vec<InstalledApp>> {
    guard(&state.db, "apps.list")?;
    let query_lower = query.to_lowercase();
    let all = list_installed_apps()?;
    Ok(all
        .into_iter()
        .filter(|a| a.name.to_lowercase().contains(&query_lower))
        .collect())
}

#[cfg(target_os = "windows")]
fn list_installed_apps() -> VeyraResult<Vec<InstalledApp>> {
    let mut apps = Vec::new();
    let mut roots = Vec::new();
    if let Some(pd) = dirs::data_dir() {
        roots.push(pd.join("Microsoft/Windows/Start Menu/Programs"));
    }
    roots.push(std::path::PathBuf::from(
        r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs",
    ));
    for root in roots {
        collect_shortcuts(&root, &mut apps);
    }
    Ok(apps)
}

#[cfg(target_os = "windows")]
fn collect_shortcuts(dir: &std::path::Path, out: &mut Vec<InstalledApp>) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_shortcuts(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("lnk") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push(InstalledApp {
                    name: stem.to_string(),
                    launch_target: path.to_string_lossy().to_string(),
                });
            }
        }
    }
}

/// Non-Windows fallback (used for local development / CI on Linux and
/// macOS): reads the freedesktop `.desktop` application registry on Linux
/// so this command is exercisable outside of a Windows build.
#[cfg(not(target_os = "windows"))]
fn list_installed_apps() -> VeyraResult<Vec<InstalledApp>> {
    let mut apps = Vec::new();
    for dir in ["/usr/share/applications", "/usr/local/share/applications"] {
        let Ok(read) = std::fs::read_dir(dir) else { continue };
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("desktop") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    apps.push(InstalledApp {
                        name: stem.to_string(),
                        launch_target: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    Ok(apps)
}
