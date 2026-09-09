/**
 * Structured logging (spec section 30). Every log line is tagged with a
 * category so `[VEYRA][STT]`, `[VEYRA][LLM]`, `[VEYRA][TOOL]` etc. can be
 * grepped independently. Categories mirror the Rust side's `log::info!`
 * calls (see `src-tauri/src/*.rs`) so a single mental model covers both
 * processes.
 *
 * Every call also bridges through `@tauri-apps/plugin-log` (JS -> Rust,
 * `commands::log` in the Rust crate routes it through the same `log`
 * sinks `lib.rs` configured — Stdout by default, i.e. the terminal
 * running `npm run tauri dev`). Without this, frontend logs only ever
 * reached the WebView's own DevTools console, invisible to anyone
 * watching just the Rust process output — which made the entire voice
 * pipeline look silent even when it wasn't. Console output is kept too,
 * for DevTools use during development.
 *
 * Never pass API keys, OAuth tokens, or other secrets to these functions —
 * there is no redaction here by design, so nothing secret should ever
 * reach it in the first place.
 */

export type LogCategory =
  | "CORE"
  | "VOICE"
  | "WAKE"
  | "VAD"
  | "STT"
  | "AI"
  | "LLM"
  | "TTS"
  | "AVATAR"
  | "COMPUTER"
  | "BROWSER"
  | "VISION"
  | "MEMORY"
  | "TOOL"
  | "PERFORMANCE"
  | "SETTINGS"
  | "ERROR";

function prefix(category: LogCategory): string {
  return `[VEYRA][${category}]`;
}

/** Best-effort flatten of extra log arguments into one bridgeable string. */
function formatRest(rest: unknown[]): string {
  if (rest.length === 0) return "";
  const parts = rest.map((item) => {
    if (item instanceof Error) return item.message;
    if (typeof item === "string") return item;
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
  return " " + parts.join(" ");
}

// Loaded once, lazily: keeps this module usable in tests/plain-browser dev
// (`npm run dev`) where the Tauri plugin doesn't exist, without every call
// site needing its own try/catch.
let bridge: typeof import("@tauri-apps/plugin-log") | null | undefined;

async function getBridge(): Promise<typeof import("@tauri-apps/plugin-log") | null> {
  if (bridge !== undefined) return bridge;
  try {
    bridge = await import("@tauri-apps/plugin-log");
  } catch {
    bridge = null;
  }
  return bridge;
}

function bridgeLog(
  level: "debug" | "info" | "warn" | "error",
  category: LogCategory,
  message: string,
  rest: unknown[]
): void {
  const line = `${prefix(category)} ${message}${formatRest(rest)}`;
  getBridge()
    .then((plugin) => plugin?.[level](line))
    .catch(() => {
      // The bridge itself failing must never break app logging — the
      // console.* call already happened below regardless.
    });
}

export const logger = {
  debug(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.debug(prefix(category), message, ...rest);
    bridgeLog("debug", category, message, rest);
  },
  info(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.info(prefix(category), message, ...rest);
    bridgeLog("info", category, message, rest);
  },
  warn(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.warn(prefix(category), message, ...rest);
    bridgeLog("warn", category, message, rest);
  },
  error(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.error(prefix(category), message, ...rest);
    bridgeLog("error", category, message, rest);
  },
};
