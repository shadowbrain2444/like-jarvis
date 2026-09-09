/**
 * Streaming speech-to-text backed by the WebView's `SpeechRecognition`
 * (spec section 4). Same underlying engine as [[WebSpeechWakeWordProvider]]
 * but used during LISTENING to transcribe the actual command, emitting
 * partial results as they arrive and a final result on
 * `SpeechRecognitionResult.isFinal`.
 */

import type { STTPartialResult, STTProvider } from "../types";
import { getSpeechRecognitionCtor } from "./webSpeechSupport";

export class WebSpeechSTTProvider implements STTProvider {
  readonly id = "web-speech-stt";
  readonly displayName = "Browser speech recognition";
  readonly locality = "hybrid" as const;
  readonly requiresApiKey = false;

  private recognition: SpeechRecognitionLike | null = null;
  private _isListening = false;
  private partialCallbacks = new Set<(r: STTPartialResult) => void>();
  private finalCallbacks = new Set<(text: string) => void>();
  private errorCallbacks = new Set<(message: string) => void>();

  get isListening(): boolean {
    return this._isListening;
  }

  async start(): Promise<void> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      const message = "speech recognition is not available in this runtime";
      this.errorCallbacks.forEach((cb) => cb(message));
      throw new Error(`[VEYRA][STT] ${message}`);
    }
    const recognition = new Ctor();
    this.recognition = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (interimText) {
        this.partialCallbacks.forEach((cb) => cb({ text: interimText, isFinal: false }));
      }
      if (finalText) {
        this.partialCallbacks.forEach((cb) => cb({ text: finalText, isFinal: true }));
        this.finalCallbacks.forEach((cb) => cb(finalText.trim()));
      }
    };
    recognition.onerror = (event) => {
      this.errorCallbacks.forEach((cb) => cb(event.error));
    };
    recognition.onstart = () => {
      this._isListening = true;
    };
    recognition.onend = () => {
      this._isListening = false;
    };
    recognition.start();
  }

  async stop(): Promise<void> {
    this.recognition?.stop();
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
}
