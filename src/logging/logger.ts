/**
 * Structured logging (spec section 30). Every log line is tagged with a
 * category so `[VEYRA][STT]`, `[VEYRA][LLM]`, `[VEYRA][TOOL]` etc. can be
 * grepped independently. Categories mirror the Rust side's `log::info!`
 * calls (see `src-tauri/src/*.rs`) so a single mental model covers both
 * processes.
 *
 * Never pass API keys, OAuth tokens, or other secrets to these functions —
 * there is no redaction here by design, so nothing secret should ever
 * reach it in the first place.
 */

export type LogCategory =
  | "CORE"
  | "VOICE"
  | "WAKE"
  | "STT"
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

export const logger = {
  debug(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.debug(prefix(category), message, ...rest);
  },
  info(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.info(prefix(category), message, ...rest);
  },
  warn(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.warn(prefix(category), message, ...rest);
  },
  error(category: LogCategory, message: string, ...rest: unknown[]): void {
    console.error(prefix(category), message, ...rest);
  },
};
