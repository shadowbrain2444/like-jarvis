/**
 * VEYRA's deterministic assistant state machine (spec section 6).
 *
 * This is a pure FSM: it holds no timers, no audio, no network calls. It
 * only tracks the current [[VeyraState]], validates transitions against an
 * explicit table, and emits `avatar.state_changed` on the shared event bus
 * so the avatar, UI, and voice pipeline react without this class knowing
 * anything about them. Orchestration (deciding *when* to call these
 * methods in response to wake words, transcripts, LLM/TTS events) lives in
 * [[SessionManager]].
 */

import { eventBus } from "./eventBus";
import type { VeyraState } from "./types";

const TRANSITIONS: Record<VeyraState, readonly VeyraState[]> = {
  SLEEPING: ["ACTIVE"],
  ACTIVE: ["LISTENING", "STOPPING", "ERROR"],
  LISTENING: ["THINKING", "STOPPING", "ERROR"],
  THINKING: ["SPEAKING", "STOPPING", "ERROR"],
  SPEAKING: ["LISTENING", "INTERRUPTED", "STOPPING", "ERROR"],
  INTERRUPTED: ["LISTENING", "STOPPING", "ERROR"],
  STOPPING: ["SLEEPING", "ERROR"],
  ERROR: ["SLEEPING"],
};

export class InvalidTransitionError extends Error {
  constructor(from: VeyraState, to: VeyraState) {
    super(`[VEYRA][CORE] invalid state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class VeyraStateMachine {
  private _state: VeyraState = "SLEEPING";

  get state(): VeyraState {
    return this._state;
  }

  canTransition(to: VeyraState): boolean {
    return TRANSITIONS[this._state].includes(to);
  }

  /** Throws [[InvalidTransitionError]] if `to` isn't reachable from the current state. */
  private transition(to: VeyraState): void {
    if (!this.canTransition(to)) {
      throw new InvalidTransitionError(this._state, to);
    }
    this._state = to;
    eventBus.emit("avatar.state_changed", { state: to });
  }

  // ---- intent-named methods; each maps to exactly one transition ----

  /** "Veyra" / "Wake up Veyra" heard while SLEEPING. */
  activate(): void {
    this.transition("ACTIVE");
    // ACTIVE is momentary: VEYRA immediately starts listening for the
    // command that follows activation.
    this.transition("LISTENING");
  }

  startThinking(): void {
    this.transition("THINKING");
  }

  startSpeaking(): void {
    this.transition("SPEAKING");
  }

  /** Response finished playing; back to listening for the next turn. */
  finishSpeaking(): void {
    this.transition("LISTENING");
  }

  /** User started talking while VEYRA was speaking. */
  interrupt(): void {
    this.transition("INTERRUPTED");
    this.transition("LISTENING");
  }

  /** "Stop Veyra" heard, or the user cancelled from the UI. */
  stop(): void {
    if (this._state === "STOPPING" || this._state === "SLEEPING") return;
    this.transition("STOPPING");
    this.transition("SLEEPING");
  }

  errorOccurred(): void {
    if (this._state === "ERROR") return;
    this.transition("ERROR");
  }

  /** Leaves ERROR and returns to the idle/sleeping baseline. */
  recover(): void {
    this.transition("SLEEPING");
  }

  reset(): void {
    this._state = "SLEEPING";
    eventBus.emit("avatar.state_changed", { state: "SLEEPING" });
  }
}

/** Process-wide singleton, mirroring [[eventBus]]. */
export const veyraStateMachine = new VeyraStateMachine();
