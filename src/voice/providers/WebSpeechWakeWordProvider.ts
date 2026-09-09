/**
 * Wake word detection backed by the WebView's built-in continuous speech
 * recognition (spec section 6).
 *
 * Honesty note: this is *not* a dedicated offline neural wake-word model
 * (e.g. Porcupine/openWakeWord) — the WebView's `SpeechRecognition`
 * typically routes audio through the OS/browser's own speech service, so
 * it is marked `locality: "hybrid"` rather than `"local"`. It requires no
 * API key and does the phrase matching itself, in-process, against the
 * transcript text only (no audio or transcript ever leaves this function).
 * It exists so wake-word detection works out of the box; swapping in a
 * true on-device model later means implementing [[WakeWordProvider]] again
 * and changing one line in provider registration — see
 * VEYRA_ARCHITECTURE.md "Provider abstraction".
 */

import type { WakeCallback, WakeWordProvider } from "../types";
import { diagnoseSpeechRecognitionError, getSpeechRecognitionCtor } from "./webSpeechSupport";
import { logger } from "../../logging/logger";
import { eventBus } from "../../core/eventBus";

/** After this many consecutive recognition errors, stop auto-restarting and report clearly instead of looping silently. */
const MAX_CONSECUTIVE_ERRORS = 3;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class WebSpeechWakeWordProvider implements WakeWordProvider {
  readonly id = "web-speech-wake-word";
  readonly displayName = "Continuous speech keyword spotting";
  readonly locality = "hybrid" as const;
  readonly requiresApiKey = false;
  readonly wakePhrases = ["veyra", "wake up veyra"] as const;
  readonly stopPhrase = "stop veyra";

  private recognition: SpeechRecognitionLike | null = null;
  private _isListening = false;
  private shouldRestart = false;
  private consecutiveErrors = 0;
  private wakeCallbacks = new Set<WakeCallback>();
  private stopCallbacks = new Set<() => void>();

  get isListening(): boolean {
    return this._isListening;
  }

  async start(): Promise<void> {
    logger.info("WAKE", "Wake engine initializing...");
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      const message =
        "SpeechRecognition API is not available in this WebView (WebView2 does not " +
        "implement it) — this provider cannot listen for a wake word here";
      logger.error("WAKE", message);
      throw new Error(`[VEYRA][WAKE] ${message}`);
    }
    this.shouldRestart = true;
    this.consecutiveErrors = 0;
    this.attach(new Ctor());
    this.recognition!.start();
  }

  async stop(): Promise<void> {
    this.shouldRestart = false;
    this.recognition?.stop();
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

  private attach(recognition: SpeechRecognitionLike): void {
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript ?? "";
        if (transcript) {
          // Recognition is demonstrably working — any actual result (not
          // just a wake-phrase match) breaks an error streak. Deliberately
          // NOT reset in `onstart`: the engine auto-restarts after every
          // single error too (see `onend` below), so resetting there would
          // mean consecutive failures could never accumulate to the
          // give-up threshold below.
          this.consecutiveErrors = 0;
        }
        this.matchPhrases(transcript);
      }
    };
    recognition.onerror = (event) => {
      this.consecutiveErrors++;
      const diagnosis = diagnoseSpeechRecognitionError(event.error);
      logger.warn(
        "WAKE",
        `recognition error (${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${event.error} — ${diagnosis}`
      );
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // A single "aborted"/"no-speech" is routine; a *run* of the same
        // failure means recognition fundamentally isn't working (e.g. the
        // constructor exists but Windows' separate speech-recognition
        // privacy toggle is off) — stop the restart loop and say so
        // clearly instead of silently retrying forever.
        this.shouldRestart = false;
        const message = `wake engine gave up after ${this.consecutiveErrors} consecutive "${event.error}" errors: ${diagnosis}`;
        logger.error("WAKE", message);
        eventBus.emit("system.error", { scope: "wake-word", message, recoverable: true });
      }
    };
    recognition.onstart = () => {
      this._isListening = true;
      // NOT resetting consecutiveErrors here: onstart fires on every
      // auto-restart-after-error too, so resetting it here would make the
      // give-up threshold above unreachable. See onresult for the actual
      // "recognition is working" reset.
      logger.info("WAKE", "Wake engine started");
      logger.info("WAKE", `Listening for wake phrase: ${this.wakePhrases.join(", ")}`);
    };
    recognition.onend = () => {
      this._isListening = false;
      if (this.shouldRestart) {
        // Some engines auto-stop after a period of silence; restart to
        // stay continuously listening for the wake phrase.
        try {
          recognition.start();
        } catch {
          // Already starting/stopping — a subsequent onend will retry.
        }
      }
    };
  }

  private matchPhrases(transcript: string): void {
    const normalized = normalize(transcript);
    if (normalized.length === 0) return;

    if (normalized.includes(normalize(this.stopPhrase))) {
      logger.info("WAKE", "Stop phrase detected: stop veyra");
      this.stopCallbacks.forEach((cb) => cb());
      return;
    }
    for (const phrase of this.wakePhrases) {
      if (normalized.includes(normalize(phrase))) {
        logger.info("WAKE", `Wake phrase detected: ${phrase}`);
        this.wakeCallbacks.forEach((cb) => cb(phrase));
        return;
      }
    }
  }
}
