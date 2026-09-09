/** Deterministic [[STTProvider]] for unit tests and text-input dev mode. */

import type { STTPartialResult, STTProvider } from "../types";

export class MockSTTProvider implements STTProvider {
  readonly id = "mock-stt";
  readonly displayName = "Manual text input (testing)";
  readonly locality = "local" as const;
  readonly requiresApiKey = false;

  private _isListening = false;
  private partialCallbacks = new Set<(r: STTPartialResult) => void>();
  private finalCallbacks = new Set<(text: string) => void>();
  private errorCallbacks = new Set<(message: string) => void>();

  get isListening(): boolean {
    return this._isListening;
  }

  async start(): Promise<void> {
    this._isListening = true;
  }

  async stop(): Promise<void> {
    this._isListening = false;
  }

  onPartial(cb: (result: STTPartialResult) => void): () => void {
    this.partialCallbacks.add(cb);
    return () => this.partialCallbacks.delete(cb);
  }

  onFinal(cb: (text: string) => void): () => void {
    this.finalCallbacks.add(cb);
    return () => this.finalCallbacks.delete(cb);
  }

  onError(cb: (message: string) => void): () => void {
    this.errorCallbacks.add(cb);
    return () => this.errorCallbacks.delete(cb);
  }

  /** Test/dev-only: simulate a partial (interim) transcript. */
  simulatePartial(text: string): void {
    this.partialCallbacks.forEach((cb) => cb({ text, isFinal: false }));
  }

  /** Test/dev-only: simulate the final transcript for this utterance. */
  simulateFinal(text: string): void {
    this.finalCallbacks.forEach((cb) => cb(text));
  }

  simulateError(message: string): void {
    this.errorCallbacks.forEach((cb) => cb(message));
  }
}
