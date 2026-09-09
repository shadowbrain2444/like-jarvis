//! Window management tools (spec section 7, "Windows"): minimize, maximize,
//! restore, move, resize, focus, and enumeration/"switch windows".
//!
//! This is inherently OS-specific — there is no cross-platform window
//! manager API. The Windows implementation uses `windows-rs` bindings to
//! `user32`. On non-Windows targets every command returns
//! [`VeyraError::NotSupported`] so the crate still builds (and the rest of
//! the app still runs) during Linux/macOS development; VEYRA's shipping
//! target is Windows.

use crate::error::{VeyraError, VeyraResult};
use crate::permissions::guard;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct WindowHandle {
    pub id: u64,
    pub title: String,
}

#[tauri::command]
pub fn windows_list(state: State<AppState>) -> VeyraResult<Vec<WindowHandle>> {
    guard(&state.db, "windows.list")?;
    platform::list_windows()
}

#[tauri::command]
pub fn window_focus(state: State<AppState>, id: u64) -> VeyraResult<()> {
    guard(&state.db, "windows.control")?;
    platform::focus(id)?;
    let _ = state.db.audit("computer.windows", "focus", &id.to_string(), "ok");
    Ok(())
}

#[tauri::command]
pub fn window_set_state(state: State<AppState>, id: u64, action: String) -> VeyraResult<()> {
    guard(&state.db, "windows.control")?;
    // Validated once here (not per-platform) so an unknown action is
    // rejected identically on every OS, not just Windows.
    if !matches!(action.as_str(), "minimize" | "maximize" | "restore") {
        return Err(VeyraError::InvalidArgument(format!(
            "unknown window action '{action}'; expected minimize, maximize, or restore"
        )));
    }
    platform::set_state(id, &action)?;
    let _ = state.db.audit("computer.windows", &action, &id.to_string(), "ok");
    Ok(())
}

#[tauri::command]
pub fn window_move_resize(
    state: State<AppState>,
    id: u64,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> VeyraResult<()> {
    guard(&state.db, "windows.control")?;
    platform::move_resize(id, x, y, width, height)?;
    let _ = state
        .db
        .audit("computer.windows", "move_resize", &id.to_string(), "ok");
    Ok(())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::WindowHandle;
    use crate::error::{VeyraError, VeyraResult};
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible, MoveWindow,
        SetForegroundWindow, ShowWindow, SHOW_WINDOW_CMD, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE,
    };

    unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<WindowHandle>);
        if IsWindowVisible(hwnd).as_bool() {
            let len = GetWindowTextLengthW(hwnd);
            if len > 0 {
                let mut buf = vec![0u16; len as usize + 1];
                let copied = GetWindowTextW(hwnd, &mut buf);
                if copied > 0 {
                    let title = String::from_utf16_lossy(&buf[..copied as usize]);
                    out.push(WindowHandle {
                        id: hwnd.0 as u64,
                        title,
                    });
                }
            }
        }
        BOOL::from(true)
    }

    pub fn list_windows() -> VeyraResult<Vec<WindowHandle>> {
        let mut out: Vec<WindowHandle> = Vec::new();
        unsafe {
            let _ = EnumWindows(
                Some(enum_callback),
                LPARAM(&mut out as *mut _ as isize),
            );
        }
        Ok(out)
    }

    fn hwnd_from(id: u64) -> HWND {
        HWND(id as *mut core::ffi::c_void)
    }

    pub fn focus(id: u64) -> VeyraResult<()> {
        unsafe {
            let _ = SetForegroundWindow(hwnd_from(id));
        }
        Ok(())
    }

    pub fn set_state(id: u64, action: &str) -> VeyraResult<()> {
        let cmd: SHOW_WINDOW_CMD = match action {
            "minimize" => SW_MINIMIZE,
            "maximize" => SW_MAXIMIZE,
            "restore" => SW_RESTORE,
            other => {
                return Err(VeyraError::InvalidArgument(format!(
                    "unknown window action '{other}'"
                )))
            }
        };
        unsafe {
            let _ = ShowWindow(hwnd_from(id), cmd);
        }
        Ok(())
    }

    pub fn move_resize(id: u64, x: i32, y: i32, width: i32, height: i32) -> VeyraResult<()> {
        unsafe {
            MoveWindow(hwnd_from(id), x, y, width, height, true)
                .map_err(|e| VeyraError::Internal(e.to_string()))?;
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn _unused(_: RECT) {}
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::WindowHandle;
    use crate::error::{VeyraError, VeyraResult};

    fn unsupported() -> VeyraError {
        VeyraError::NotSupported("window control requires Windows".into())
    }

    pub fn list_windows() -> VeyraResult<Vec<WindowHandle>> {
        Err(unsupported())
    }
    pub fn focus(_id: u64) -> VeyraResult<()> {
        Err(unsupported())
    }
    pub fn set_state(_id: u64, _action: &str) -> VeyraResult<()> {
        Err(unsupported())
    }
    pub fn move_resize(_id: u64, _x: i32, _y: i32, _width: i32, _height: i32) -> VeyraResult<()> {
        Err(unsupported())
    }
}
