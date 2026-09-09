/**
 * Computer Control Engine skill (spec section 7): the tool definitions the
 * AI orchestrator hands to the LLM. Every `execute` is a thin wrapper
 * around a Tauri command in `src-tauri/src/commands/` — this file owns the
 * tool-calling *shape* (name, description, JSON schema) that the model
 * sees; the Rust side owns permission enforcement and the actual OS call.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ToolDefinition } from "../ai/types";

export const computerControlTools: ToolDefinition[] = [
  {
    name: "get_system_info",
    description:
      "Get current system information: CPU usage, memory, disk space, OS version, hostname.",
    permission: "system.info",
    inputSchema: { type: "object", properties: {} },
    execute: () => invoke("system_info"),
  },
  {
    name: "read_clipboard",
    description: "Read the current text content of the system clipboard.",
    permission: "clipboard.read",
    inputSchema: { type: "object", properties: {} },
    execute: () => invoke("clipboard_read"),
  },
  {
    name: "write_clipboard",
    description: "Write text to the system clipboard.",
    permission: "clipboard.write",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to copy to the clipboard" } },
      required: ["text"],
    },
    execute: (input) => invoke("clipboard_write", { text: input.text }),
  },
  {
    name: "search_files",
    description:
      "Recursively search for files/folders under a root directory by name substring, optionally filtered by extension.",
    permission: "files.search",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Directory to search under" },
        query: { type: "string", description: "Case-insensitive substring to match in the file name" },
        extension: { type: "string", description: "Optional file extension filter, e.g. 'pdf'" },
      },
      required: ["root", "query"],
    },
    execute: (input) =>
      invoke("files_search", {
        root: input.root,
        query: input.query,
        extension: input.extension ?? null,
        maxResults: 50,
      }),
  },
  {
    name: "find_latest_file",
    description: "Find the most recently modified file under a root directory, optionally filtered by extension.",
    permission: "files.search",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        extension: { type: "string" },
      },
      required: ["root"],
    },
    execute: (input) =>
      invoke("files_find_latest", { root: input.root, extension: input.extension ?? null }),
  },
  {
    name: "open_file_or_folder",
    description: "Open a file or folder with its default OS application.",
    permission: "files.open",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: (input) => invoke("files_open", { path: input.path }),
  },
  {
    name: "delete_file",
    description: "Permanently delete a file or folder. Destructive — requires explicit user-granted permission.",
    permission: "files.delete",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    execute: (input) => invoke("files_delete", { path: input.path }),
  },
  {
    name: "open_application",
    description: "Launch an application by executable name or path (e.g. 'notepad.exe', 'chrome').",
    permission: "apps.open",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string" },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["target"],
    },
    execute: (input) => invoke("app_open", { target: input.target, args: input.args ?? [] }),
  },
  {
    name: "close_application",
    description: "Terminate a running application by process ID (get the PID from list_running_applications).",
    permission: "apps.close",
    inputSchema: {
      type: "object",
      properties: { pid: { type: "number" } },
      required: ["pid"],
    },
    execute: (input) => invoke("app_close", { pid: input.pid }),
  },
  {
    name: "list_running_applications",
    description: "List currently running processes with PID, name, and memory usage.",
    permission: "apps.list",
    inputSchema: { type: "object", properties: {} },
    execute: () => invoke("app_list_running"),
  },
  {
    name: "search_installed_applications",
    description: "Search installed applications by name.",
    permission: "apps.list",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: (input) => invoke("app_search_installed", { query: input.query }),
  },
  {
    name: "list_windows",
    description: "List currently open, visible windows with their titles and window IDs.",
    permission: "windows.list",
    inputSchema: { type: "object", properties: {} },
    execute: () => invoke("windows_list"),
  },
  {
    name: "focus_window",
    description: "Bring a window to the foreground by its window ID (from list_windows).",
    permission: "windows.control",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
    execute: (input) => invoke("window_focus", { id: input.id }),
  },
  {
    name: "set_window_state",
    description: "Minimize, maximize, or restore a window by ID.",
    permission: "windows.control",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        action: { type: "string", enum: ["minimize", "maximize", "restore"] },
      },
      required: ["id", "action"],
    },
    execute: (input) => invoke("window_set_state", { id: input.id, action: input.action }),
  },
  {
    name: "type_text",
    description: "Type text at the current cursor/focus position, as if typed on the keyboard.",
    permission: "keyboard.type",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: (input) => invoke("keyboard_type", { text: input.text }),
  },
  {
    name: "press_hotkey",
    description: "Press a keyboard shortcut, e.g. ['control', 'c'] for copy.",
    permission: "keyboard.hotkey",
    inputSchema: {
      type: "object",
      properties: { keys: { type: "array", items: { type: "string" } } },
      required: ["keys"],
    },
    execute: (input) => invoke("keyboard_hotkey", { keys: input.keys }),
  },
];
