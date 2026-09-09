/**
 * Shared types for VEYRA's core: assistant states, event payloads, and the
 * event names used on the event bus. This file has no dependencies on
 * React, Tauri, or any provider — everything else imports from here so the
 * vocabulary stays consistent across voice, AI, avatar, and UI layers.
 */

/** Deterministic assistant state machine states (spec section 6). */
export type VeyraState =
  | "SLEEPING"
  | "ACTIVE"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "INTERRUPTED"
  | "STOPPING"
  | "ERROR";

export const VEYRA_STATES: readonly VeyraState[] = [
  "SLEEPING",
  "ACTIVE",
  "LISTENING",
  "THINKING",
  "SPEAKING",
  "INTERRUPTED",
  "STOPPING",
  "ERROR",
];

/** Every event the internal bus carries, and the payload shape for each. */
export interface VeyraEventMap {
  "voice.started": { source: "mic" };
  "voice.partial_transcript": { text: string };
  "voice.final_transcript": { text: string };
  "voice.silence_detected": Record<string, never>;

  "wake.detected": { phrase: string };
  "wake.stop_detected": Record<string, never>;

  "assistant.activated": { via: "wake_word" | "manual" };
  "assistant.stopped": { reason: "user" | "error" | "timeout" };

  "llm.started": { requestId: string };
  "llm.first_token": { requestId: string; latencyMs: number };
  "llm.token": { requestId: string; token: string };
  "llm.completed": { requestId: string; text: string; latencyMs: number };
  "llm.failed": { requestId: string; error: string };

  "tts.started": { requestId: string };
  "tts.first_audio": { requestId: string; latencyMs: number };
  "tts.completed": { requestId: string };
  "tts.cancelled": { requestId: string };
  "tts.audio_level": { level: number };

  "avatar.state_changed": { state: VeyraState };
  "avatar.speaking": { amplitude: number };
  "avatar.listening": { amplitude: number };

  "tool.started": { toolName: string; requestId: string };
  "tool.completed": { toolName: string; requestId: string; durationMs: number };
  "tool.failed": { toolName: string; requestId: string; error: string };

  "performance.metric": { metric: string; valueMs: number };

  "system.error": { scope: string; message: string; recoverable: boolean };

  /**
   * Emitted once per session build (`core/bootstrap.ts`) reporting whether
   * the runtime actually implements the Web Speech APIs voice depends on —
   * e.g. WebView2 has no `SpeechRecognition`, so this comes back
   * `speechRecognitionAvailable: false` there even though `speechSynthesis`
   * still works. The UI uses this to show the manual-activation fallback
   * instead of silently doing nothing when someone says "Veyra".
   */
  "voice.capability": { speechRecognitionAvailable: boolean; speechSynthesisAvailable: boolean };
}

export type VeyraEventName = keyof VeyraEventMap;

/** A single conversation turn, as stored/rendered. */
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

/** Stable, machine-readable error shape returned by the Rust core. */
export interface VeyraBackendError {
  code:
    | "PERMISSION_DENIED"
    | "NOT_SUPPORTED"
    | "NOT_FOUND"
    | "INVALID_ARGUMENT"
    | "DATABASE_ERROR"
    | "IO_ERROR"
    | "INTERNAL_ERROR";
  message: string;
}

export function isVeyraBackendError(e: unknown): e is VeyraBackendError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e
  );
}
