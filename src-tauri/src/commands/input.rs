//! Keyboard and mouse control (spec section 7, "Keyboard" / "Mouse"),
//! backed by `enigo` so the same code path works on Windows, macOS and
//! Linux — the actual shipping target is Windows, but keeping this
//! cross-platform means it can be exercised in CI on any OS.

use crate::error::{VeyraError, VeyraResult};
use crate::permissions::guard;
use crate::state::AppState;
use enigo::{
    Button, Coordinate, Direction::Click, Enigo, Keyboard, Mouse, Settings,
};
use tauri::State;

fn enigo() -> VeyraResult<Enigo> {
    Enigo::new(&Settings::default()).map_err(|e| VeyraError::Internal(e.to_string()))
}

#[tauri::command]
pub fn keyboard_type(state: State<AppState>, text: String) -> VeyraResult<()> {
    guard(&state.db, "keyboard.type")?;
    enigo()?
        .text(&text)
        .map_err(|e| VeyraError::Internal(e.to_string()))?;
    let _ = state.db.audit("computer.keyboard", "type", &format!("{} chars", text.len()), "ok");
    Ok(())
}

/// `keys` is a list of key names like `["control", "c"]`, pressed together
/// then released in reverse order (a standard hotkey chord).
#[tauri::command]
pub fn keyboard_hotkey(state: State<AppState>, keys: Vec<String>) -> VeyraResult<()> {
    guard(&state.db, "keyboard.hotkey")?;
    let mut eng = enigo()?;
    let parsed: Vec<enigo::Key> = keys.iter().map(|k| parse_key(k)).collect();

    for key in &parsed {
        eng.key(*key, enigo::Direction::Press)
            .map_err(|e| VeyraError::Internal(e.to_string()))?;
    }
    for key in parsed.iter().rev() {
        eng.key(*key, enigo::Direction::Release)
            .map_err(|e| VeyraError::Internal(e.to_string()))?;
    }
    let _ = state.db.audit("computer.keyboard", "hotkey", &keys.join("+"), "ok");
    Ok(())
}

fn parse_key(name: &str) -> enigo::Key {
    use enigo::Key::*;
    match name.to_lowercase().as_str() {
        "control" | "ctrl" => Control,
        "alt" => Alt,
        "shift" => Shift,
        "meta" | "win" | "windows" | "cmd" | "command" => Meta,
        "enter" | "return" => Return,
        "tab" => Tab,
        "escape" | "esc" => Escape,
        "space" => Space,
        "backspace" => Backspace,
        "delete" => Delete,
        "up" => UpArrow,
        "down" => DownArrow,
        "left" => LeftArrow,
        "right" => RightArrow,
        other => {
            let mut chars = other.chars();
            match chars.next() {
                Some(c) if other.chars().count() == 1 => Unicode(c),
                _ => Unicode('\u{0}'),
            }
        }
    }
}

#[tauri::command]
pub fn mouse_move(state: State<AppState>, x: i32, y: i32) -> VeyraResult<()> {
    guard(&state.db, "mouse.move")?;
    enigo()?
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| VeyraError::Internal(e.to_string()))
}

#[tauri::command]
pub fn mouse_click(state: State<AppState>, button: String, double: bool) -> VeyraResult<()> {
    guard(&state.db, "mouse.click")?;
    let btn = match button.to_lowercase().as_str() {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    };
    let mut eng = enigo()?;
    eng.button(btn, Click)
        .map_err(|e| VeyraError::Internal(e.to_string()))?;
    if double {
        eng.button(btn, Click)
            .map_err(|e| VeyraError::Internal(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn mouse_scroll(state: State<AppState>, delta: i32) -> VeyraResult<()> {
    guard(&state.db, "mouse.scroll")?;
    enigo()?
        .scroll(delta, enigo::Axis::Vertical)
        .map_err(|e| VeyraError::Internal(e.to_string()))
}
