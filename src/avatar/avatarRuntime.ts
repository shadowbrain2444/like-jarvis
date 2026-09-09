/**
 * Mutable per-frame state the avatar scene reads directly inside
 * `useFrame` (spec section 22/23). Deliberately *not* React state: a 3D
 * scene wants to read the latest amplitude/state every animation frame
 * without triggering a React re-render each time, so this is a plain
 * object updated by event-bus subscriptions and polled by Three.js code.
 */

import { eventBus } from "../core/eventBus";
import type { VeyraState } from "../core/types";

export interface AvatarSnapshot {
  state: VeyraState;
  /** 0..1, decays toward 0 when no new audio-level events arrive. */
  amplitude: number;
}

const AMPLITUDE_DECAY_PER_MS = 0.006;

class AvatarRuntime {
  private _state: VeyraState = "SLEEPING";
  private _amplitude = 0;
  private lastAmplitudeUpdate = performance.now();
  private unsubscribers: Array<() => void> = [];

  attach(): void {
    this.detach();
    this.unsubscribers.push(
      eventBus.on("avatar.state_changed", ({ state }) => {
        this._state = state;
        if (state !== "SPEAKING" && state !== "LISTENING") this._amplitude = 0;
      }),
      eventBus.on("avatar.speaking", ({ amplitude }) => this.pushAmplitude(amplitude)),
      eventBus.on("avatar.listening", ({ amplitude }) => this.pushAmplitude(amplitude))
    );
  }

  detach(): void {
    this.unsubscribers.forEach((off) => off());
    this.unsubscribers = [];
  }

  private pushAmplitude(amplitude: number): void {
    this._amplitude = Math.max(this._amplitude, Math.min(1, amplitude));
    this.lastAmplitudeUpdate = performance.now();
  }

  /** Call once per rendered frame; returns the current, decayed snapshot. */
  sample(): AvatarSnapshot {
    const now = performance.now();
    const elapsed = now - this.lastAmplitudeUpdate;
    if (elapsed > 0 && this._amplitude > 0) {
      this._amplitude = Math.max(0, this._amplitude - elapsed * AMPLITUDE_DECAY_PER_MS);
    }
    this.lastAmplitudeUpdate = now;
    return { state: this._state, amplitude: this._amplitude };
  }

  get state(): VeyraState {
    return this._state;
  }
}

export const avatarRuntime = new AvatarRuntime();
