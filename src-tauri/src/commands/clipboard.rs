//! Clipboard read/write (spec section 7, "Clipboard").

use crate::error::{VeyraError, VeyraResult};
use crate::permissions::guard;
use crate::state::AppState;
use arboard::Clipboard;
use tauri::State;

#[tauri::command]
pub fn clipboard_read(state: State<AppState>) -> VeyraResult<String> {
    guard(&state.db, "clipboard.read")?;
    let mut cb = Clipboard::new().map_err(|e| VeyraError::Internal(e.to_string()))?;
    cb.get_text().map_err(|e| VeyraError::Internal(e.to_string()))
}

#[tauri::command]
pub fn clipboard_write(state: State<AppState>, text: String) -> VeyraResult<()> {
    guard(&state.db, "clipboard.write")?;
    let mut cb = Clipboard::new().map_err(|e| VeyraError::Internal(e.to_string()))?;
    cb.set_text(text).map_err(|e| VeyraError::Internal(e.to_string()))
}
