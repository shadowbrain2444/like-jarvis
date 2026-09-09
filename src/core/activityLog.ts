/**
 * Live, in-memory voice-pipeline activity feed — what Settings > Voice
 * pipeline activity renders.
 *
 * This is deliberately separate from the Rust-side `audit_log` table
 * (`src-tauri/src/db/models.rs`, surfaced via the `audit_recent` command):
 * that log is scoped to permission-gated Computer Control Engine calls
 * (file/app/window/input operations) and is correctly empty until VEYRA
 * actually executes a tool. It was never meant to record — and previously
 * *never did* record — wake/listen/transcript/AI/TTS lifecycle events, so
 * "no activity yet" there did not mean the voice pipeline was idle; it
 * meant no tool had run. This module fixes the actual gap: a feed of the
 * pipeline events themselves, sourced straight from the event bus.
 */

import { useSyncExternalStore } from "react";
import { eventBus } from "./eventBus";

export type ActivityKind =
  | "WAKE_DETECTED"
  | "LISTENING_STARTED"
  | "TRANSCRIPT_RECEIVED"
  | "AI_RESPONSE_STARTED"
  | "AI_RESPONSE_COMPLETED"
  | "TTS_STARTED"
  | "COMMAND_COMPLETED"
  | "STOPPED"
  | "ERROR";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  detail: string;
  at: number;
}

const MAX_ENTRIES = 50;
let entries: ActivityEntry[] = [];
const listeners = new Set<() => void>();

function push(kind: ActivityKind, detail: string): void {
  entries = [{ id: crypto.randomUUID(), kind, detail, at: Date.now() }, ...entries].slice(
    0,
    MAX_ENTRIES
  );
  listeners.forEach((l) => l());
}

let attached = false;

/** Idempotent: safe to call more than once (e.g. across SessionManager rebuilds). */
export function attachActivityLog(): void {
  if (attached) return;
  attached = true;

  eventBus.on("wake.detected", ({ phrase }) => push("WAKE_DETECTED", `wake phrase: "${phrase}"`));
  eventBus.on("avatar.state_changed", ({ state }) => {
    if (state === "LISTENING") push("LISTENING_STARTED", "");
  });
  eventBus.on("voice.final_transcript", ({ text }) => push("TRANSCRIPT_RECEIVED", `"${text}"`));
  eventBus.on("llm.started", () => push("AI_RESPONSE_STARTED", ""));
  eventBus.on("llm.completed", ({ text }) => push("AI_RESPONSE_COMPLETED", `"${text}"`));
  eventBus.on("llm.failed", ({ error }) => push("ERROR", `AI: ${error}`));
  eventBus.on("tts.started", () => push("TTS_STARTED", ""));
  eventBus.on("tts.completed", () => push("COMMAND_COMPLETED", ""));
  eventBus.on("assistant.stopped", ({ reason }) => push("STOPPED", `reason: ${reason}`));
  eventBus.on("system.error", ({ scope, message }) => push("ERROR", `${scope}: ${message}`));
}

export function getActivityEntries(): readonly ActivityEntry[] {
  return entries;
}

export function clearActivityLog(): void {
  entries = [];
  listeners.forEach((l) => l());
}

export function useActivityLog(): readonly ActivityEntry[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => entries
  );
}
