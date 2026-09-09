//! VEYRA desktop core (Rust / Tauri side).
//!
//! This crate owns the parts of VEYRA that need OS access: local
//! persistence (SQLite), the Computer Control Engine (files, apps,
//! windows, input, clipboard, system info), and permission/audit
//! enforcement. Everything voice-, LLM-, and UI-related lives in the
//! TypeScript frontend (`src/`) and talks to this crate only through the
//! Tauri command surface registered below — see `VEYRA_ARCHITECTURE.md`
//! for the full process diagram.

mod commands;
mod db;
mod error;
mod permissions;
#[cfg(test)]
mod permissions_tests;
mod state;

use db::Db;
use state::AppState;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let db = Db::open(None).expect("[VEYRA][DB] failed to open local database");
            app.manage(AppState { db: Arc::new(db) });
            log::info!("[VEYRA][CORE] backend initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // system
            commands::system::system_info,
            // clipboard
            commands::clipboard::clipboard_read,
            commands::clipboard::clipboard_write,
            // input
            commands::input::keyboard_type,
            commands::input::keyboard_hotkey,
            commands::input::mouse_move,
            commands::input::mouse_click,
            commands::input::mouse_scroll,
            // files
            commands::files::files_list,
            commands::files::files_search,
            commands::files::files_find_latest,
            commands::files::files_create,
            commands::files::files_delete,
            commands::files::files_rename,
            commands::files::files_copy,
            commands::files::files_move,
            commands::files::files_open,
            // apps
            commands::apps::app_open,
            commands::apps::app_close,
            commands::apps::app_list_running,
            commands::apps::app_search_installed,
            // windows
            commands::window_control::windows_list,
            commands::window_control::window_focus,
            commands::window_control::window_set_state,
            commands::window_control::window_move_resize,
            // settings / permissions / audit
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_get_all,
            commands::settings::permission_get,
            commands::settings::permission_set,
            commands::settings::audit_recent,
            commands::settings::metric_record,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
