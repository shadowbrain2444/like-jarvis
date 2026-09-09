/**
 * Text-to-speech backed by the OS's own voices via `speechSynthesis`
 * (spec section 4). Fully local/offline, no API key, and — critically for
 * spec section 22 — genuinely cancellable mid-utterance for "Stop Veyra"
 * and barge-in interruption.
 *
 * `speechSynthesis` does not expose per-sample audio, so there is no real
 * waveform to analyse for lip-sync here. Amplitude is instead approximated
 * with a decaying pulse on each `boundary` (word) event — good enough to
 * drive [[LipSyncController]]'s mouth-open animation without claiming a
 * precision this API can't deliver. A cloud provider that returns actual
 * audio bytes (e.g. an ElevenLabs-style provider) can and should do real
 * `AnalyserNode` amplitude analysis instead.
 */

import type { TTSOptions, TTSProvider, TTSVoiceInfo } from "../types";
import { getSpeechSynthesis } from "./webSpeechSupport";
import { logger } from "../../logging/logger";

const FEMALE_VOICE_HINTS = [
  "female",
  "samantha",
  "victoria",
  "zira",
  "susan",
  "jenny",
  "aria",
  "hazel",
  "eva",
];

function guessGender(voice: SpeechSynthesisVoice): TTSVoiceInfo["gender"] {
  const name = voice.name.toLowerCase();
  if (FEMALE_VOICE_HINTS.some((hint) => name.includes(hint))) return "female";
  if (name.includes("male") || name.includes("david") || name.includes("mark")) {
    return "male";
  }
  return "unknown";
}

function waitForVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const existing = synth.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const handler = () => {
      synth.removeEventListener("voiceschanged", handler);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", handler);
    // Some engines never fire voiceschanged if voices are already cached;
    // fall back after a short delay rather than hanging forever.
    setTimeout(() => resolve(synth.getVoices()), 1000);
  });
}

export class WebSpeechTTSProvider implements TTSProvider {
  readonly id = "web-speech-tts";
  readonly displayName = "System voice (offline)";
  readonly locality = "local" as const;
  readonly requiresApiKey = false;

  private synth: SpeechSynthesis | null = getSpeechSynthesis();
  private _isSpeaking = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private audioLevelCallbacks = new Set<(level: number) => void>();
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  private currentLevel = 0;

  get isSpeaking(): boolean {
    return this._isSpeaking;
  }

  async listVoices(): Promise<TTSVoiceInfo[]> {
    if (!this.synth) return [];
    const voices = await waitForVoices(this.synth);
    return voices.map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      gender: guessGender(v),
    }));
  }

  /** Picks the configured voice, or the best-guess female default. */
  private async resolveVoice(voiceId?: string): Promise<SpeechSynthesisVoice | undefined> {
    if (!this.synth) return undefined;
    const voices = await waitForVoices(this.synth);
    if (voiceId) {
      const match = voices.find((v) => v.voiceURI === voiceId);
      if (match) return match;
    }
    return (
      voices.find((v) => guessGender(v) === "female" && v.lang.startsWith("en")) ??
      voices.find((v) => guessGender(v) === "female") ??
      voices.find((v) => v.lang.startsWith("en")) ??
      voices[0]
    );
  }

  async speak(text: string, options: TTSOptions = {}): Promise<void> {
    logger.info("TTS", "Starting synthesis");
    if (!this.synth) {
      const message = "speechSynthesis is not available in this runtime";
      logger.error("TTS", message);
      throw new Error(`[VEYRA][TTS] ${message}`);
    }
    this.cancel(); // barge-in: a new utterance always preempts the current one

    const utterance = new SpeechSynthesisUtterance(text);
    const resolvedVoice = await this.resolveVoice(options.voiceId);
    utterance.voice = resolvedVoice ?? null;
    utterance.rate = options.rate ?? 1.0;
    utterance.volume = options.volume ?? 1.0;
    utterance.pitch = options.pitch ?? 1.05; // a hair brighter, per VEYRA's voice identity

    if (resolvedVoice) {
      const gender = guessGender(resolvedVoice);
      logger.info("TTS", `Using voice: "${resolvedVoice.name}" (${resolvedVoice.lang}, ${gender})`);
      if (gender !== "female") {
        // VEYRA's identity requires a female voice by default (spec
        // section 22) — this is not fatal (some systems genuinely have no
        // female voice installed), but it must never be silent.
        logger.warn(
          "TTS",
          `resolved voice "${resolvedVoice.name}" is not recognized as female — ` +
            "check installed OS voices, or set one explicitly in Settings > Voice"
        );
      }
    } else {
      logger.warn("TTS", "no voice resolved — speechSynthesis has no installed voices");
    }

    this.currentUtterance = utterance;

    return new Promise<void>((resolve, reject) => {
      utterance.onstart = () => {
        this._isSpeaking = true;
        logger.info("TTS", "Playback started");
      };
      utterance.onboundary = () => {
        this.pulse();
      };
      const finish = () => {
        this._isSpeaking = false;
        this.stopDecay();
        if (this.currentUtterance === utterance) this.currentUtterance = null;
      };
      utterance.onend = () => {
        finish();
        logger.info("TTS", "Playback completed");
        resolve();
      };
      utterance.onerror = (event) => {
        finish();
        // "canceled"/"interrupted" are expected on barge-in/Stop Veyra —
        // resolved normally, not reported as a failure. Anything else
        // (e.g. "synthesis-failed", "voice-unavailable") is real and must
        // not be swallowed as if playback had simply completed.
        if (event.error === "canceled" || event.error === "interrupted") {
          logger.info("TTS", `Playback cancelled (${event.error})`);
          resolve();
        } else {
          logger.error("TTS", `Playback failed: ${event.error}`);
          reject(new Error(`[VEYRA][TTS] playback failed: ${event.error}`));
        }
      };

      this.synth!.speak(utterance);
    });
  }

  cancel(): void {
    if (!this.synth) return;
    if (this._isSpeaking || this.synth.speaking || this.synth.pending) {
      this.synth.cancel();
    }
    this._isSpeaking = false;
    this.currentUtterance = null;
    this.stopDecay();
  }

  onAudioLevel(cb: (level: number) => void): () => void {
    this.audioLevelCallbacks.add(cb);
    return () => this.audioLevelCallbacks.delete(cb);
  }

  private pulse(): void {
    this.currentLevel = 1.0;
    this.emitLevel();
    if (!this.decayTimer) {
      this.decayTimer = setInterval(() => {
        this.currentLevel *= 0.7;
        if (this.currentLevel < 0.02) this.currentLevel = 0;
        this.emitLevel();
      }, 40);
    }
  }

  private stopDecay(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    this.currentLevel = 0;
    this.emitLevel();
  }

  private emitLevel(): void {
    this.audioLevelCallbacks.forEach((cb) => cb(this.currentLevel));
  }
}
