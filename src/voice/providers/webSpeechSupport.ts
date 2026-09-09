/** Shared helpers for the Web Speech API-backed providers. */

export function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * True only if the `SpeechRecognition` constructor exists. This is
 * necessary but NOT sufficient for wake word / STT to actually work: the
 * constructor can exist and `recognition.start()` can still fail (see
 * [[diagnoseSpeechRecognitionError]]) — e.g. Windows has a separate
 * Settings -> Privacy & security -> Speech "online speech recognition"
 * toggle, independent of the microphone permission, that can block it
 * even when this returns `true`. Callers that need to know whether
 * recognition is *actually working*, not just present, should watch for
 * `onerror` at runtime instead of trusting this alone.
 */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Maps a `SpeechRecognitionErrorEvent.error` code to a concrete, actionable
 * diagnosis instead of a bare code string — this is what lets "Veyra"
 * failing to be recognized be reported as a specific, real reason rather
 * than a generic "didn't work."
 */
export function diagnoseSpeechRecognitionError(code: string): string {
  switch (code) {
    case "not-allowed":
      return (
        "permission denied — check Windows Settings > Privacy & security > Speech " +
        "(online speech recognition), separate from the microphone permission"
      );
    case "service-not-allowed":
      return (
        "the speech recognition service refused the request — WebView2's speech " +
        "backend may not be configured/available on this system"
      );
    case "network":
      return (
        "no network path to the speech recognition service — this engine typically " +
        "requires an online service; check internet connectivity"
      );
    case "audio-capture":
      return "no audio could be captured for recognition (distinct from the raw mic capture used for VAD/metering)";
    case "no-speech":
      return "no speech was detected before the recognizer timed out";
    case "aborted":
      return "recognition was aborted (often just a restart in progress, not necessarily an error)";
    case "language-not-supported":
      return "the configured recognition language is not supported by this engine";
    case "bad-grammar":
      return "invalid recognition grammar configuration";
    default:
      return `unrecognized error code "${code}"`;
  }
}

export function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

export function isSpeechSynthesisSupported(): boolean {
  return getSpeechSynthesis() !== null;
}
