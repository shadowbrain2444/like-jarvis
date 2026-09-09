/**
 * Deterministic, dependency-free [[WakeWordProvider]] for unit tests and
 * for the Settings > Developer "type instead of speak" fallback when no
 * microphone/speech engine is available.
 */

import type { WakeCallback, WakeWordProvider } from "../types";

export class MockWakeWordProvider implements WakeWordProvider {
  readonly id = "mock-wake-word";
  readonly displayName = "Manual trigger (testing)";
  readonly locality = "local" as const;
  readonly requiresApiKey = false;
  readonly wakePhrases = ["veyra", "wake up veyra"] as const;
  readonly stopPhrase = "stop veyra";

  private _isListening = false;
  private wakeCallbacks = new Set<WakeCallback>();
  private stopCallbacks = new Set<() => void>();

  get isListening(): boolean {
    return this._isListening;
  }

  async start(): Promise<void> {
    this._isListening = true;
  }

  async stop(): Promise<void> {
    this._isListening = false;
  }

  onWake(cb: WakeCallback): () => void {
    this.wakeCallbacks.add(cb);
    return () => this.wakeCallbacks.delete(cb);
  }

  onStop(cb: () => void): () => void {
    this.stopCallbacks.add(cb);
    return () => this.stopCallbacks.delete(cb);
  }

  /** Test/dev-only: simulate hearing a wake phrase. */
  simulateWake(phrase: string = this.wakePhrases[0]): void {
    this.wakeCallbacks.forEach((cb) => cb(phrase));
  }

  /** Test/dev-only: simulate hearing "Stop Veyra". */
  simulateStop(): void {
    this.stopCallbacks.forEach((cb) => cb());
  }
}
