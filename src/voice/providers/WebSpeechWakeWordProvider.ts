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
import { getSpeechRecognitionCtor } from "./webSpeechSupport";

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
  private wakeCallbacks = new Set<WakeCallback>();
  private stopCallbacks = new Set<() => void>();

  get isListening(): boolean {
    return this._isListening;
  }

  async start(): Promise<void> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      throw new Error(
        "[VEYRA][WAKE] speech recognition is not available in this runtime"
      );
    }
    this.shouldRestart = true;
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
        this.matchPhrases(transcript);
      }
    };
    recognition.onerror = (event) => {
      console.warn("[VEYRA][WAKE] recognition error:", event.error);
    };
    recognition.onstart = () => {
      this._isListening = true;
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
      this.stopCallbacks.forEach((cb) => cb());
      return;
    }
    for (const phrase of this.wakePhrases) {
      if (normalized.includes(normalize(phrase))) {
        this.wakeCallbacks.forEach((cb) => cb(phrase));
        return;
      }
    }
  }
}
