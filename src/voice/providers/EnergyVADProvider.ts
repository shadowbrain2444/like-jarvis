/**
 * Signal-energy voice activity detector (spec section 4, "VAD").
 *
 * Deliberately simple: RMS-over-threshold with hysteresis and a
 * silence-hangover window, so a brief dip mid-word doesn't register as
 * speech end. This is what gates whether VEYRA bothers running STT/wake
 * matching on a given stretch of audio — swap for a neural VAD (e.g.
 * Silero) later behind the same [[VADProvider]] interface without
 * touching callers.
 */

import type { VADProvider } from "../types";
import { logger } from "../../logging/logger";

export interface EnergyVADOptions {
  /** RMS above this is "speech". Mic-dependent; 0.02 is a reasonable indoor default. */
  threshold?: number;
  /** How long silence must persist before emitting speech-end, in ms. */
  hangoverMs?: number;
}

export class EnergyVADProvider implements VADProvider {
  readonly id = "energy-vad";
  readonly displayName = "Signal energy (RMS threshold)";
  readonly locality = "local" as const;
  readonly requiresApiKey = false;

  private threshold: number;
  private hangoverMs: number;
  private speaking = false;
  private lastAboveThresholdAt = 0;
  private speechStartCallbacks = new Set<() => void>();
  private speechEndCallbacks = new Set<() => void>();

  constructor(options: EnergyVADOptions = {}) {
    this.threshold = options.threshold ?? 0.02;
    this.hangoverMs = options.hangoverMs ?? 500;
  }

  processFrame(frame: Float32Array, _sampleRate: number): void {
    let sumSquares = 0;
    for (const sample of frame) sumSquares += sample * sample;
    const rms = Math.sqrt(sumSquares / frame.length);
    const now = Date.now();

    if (rms >= this.threshold) {
      this.lastAboveThresholdAt = now;
      if (!this.speaking) {
        this.speaking = true;
        // NOTE: this fires on ANY sufficiently loud sound while frames are
        // flowing (confirming the mic->VAD wiring is alive), regardless of
        // assistant state — SessionManager only *acts* on it during
        // SPEAKING (barge-in). Seeing this log while SLEEPING/LISTENING is
        // expected and does not by itself mean nothing is happening.
        logger.info("VAD", `Speech detected (rms=${rms.toFixed(3)})`);
        this.speechStartCallbacks.forEach((cb) => cb());
      }
    } else if (this.speaking && now - this.lastAboveThresholdAt >= this.hangoverMs) {
      this.speaking = false;
      logger.info("VAD", "Speech ended");
      this.speechEndCallbacks.forEach((cb) => cb());
    }
  }

  onSpeechStart(cb: () => void): () => void {
    this.speechStartCallbacks.add(cb);
    return () => this.speechStartCallbacks.delete(cb);
  }

  onSpeechEnd(cb: () => void): () => void {
    this.speechEndCallbacks.add(cb);
    return () => this.speechEndCallbacks.delete(cb);
  }

  reset(): void {
    this.speaking = false;
    this.lastAboveThresholdAt = 0;
  }
}
