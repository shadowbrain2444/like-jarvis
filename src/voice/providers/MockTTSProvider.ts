/** Deterministic [[TTSProvider]] for unit tests: no timers, no audio. */

import type { TTSOptions, TTSProvider, TTSVoiceInfo } from "../types";

export class MockTTSProvider implements TTSProvider {
  readonly id = "mock-tts";
  readonly displayName = "Silent (testing)";
  readonly locality = "local" as const;
  readonly requiresApiKey = false;

  private _isSpeaking = false;
  private resolveCurrent: (() => void) | null = null;
  private audioLevelCallbacks = new Set<(level: number) => void>();
  public lastSpoken: { text: string; options?: TTSOptions } | null = null;

  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  async listVoices(): Promise<TTSVoiceInfo[]> {
    return [
      { id: "mock-female", name: "Mock Female", lang: "en-US", gender: "female" },
    ];
  }

  speak(text: string, options?: TTSOptions): Promise<void> {
    this.cancel();
    this.lastSpoken = { text, options };
    this._isSpeaking = true;
    return new Promise((resolve) => {
      this.resolveCurrent = () => {
        this._isSpeaking = false;
        resolve();
      };
    });
  }

  cancel(): void {
    if (this.resolveCurrent) {
      const resolve = this.resolveCurrent;
      this.resolveCurrent = null;
      this._isSpeaking = false;
      resolve();
    }
  }

  onAudioLevel(cb: (level: number) => void): () => void {
    this.audioLevelCallbacks.add(cb);
    return () => this.audioLevelCallbacks.delete(cb);
  }

  /** Test-only: finish the in-flight `speak()` as if playback completed naturally. */
  completeSpeaking(): void {
    this.cancel();
  }
}
