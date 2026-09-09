/**
 * Provider interfaces for the voice pipeline (spec section 4).
 *
 * Nothing in `voice/` or above ever imports a concrete provider directly —
 * only these interfaces. Swapping Web Speech for Porcupine/Whisper/
 * ElevenLabs later means writing one new file that implements one of
 * these, and registering it in `settings`; no other code changes.
 *
 * Pipeline: Mic -> AudioEngine -> VAD -> WakeWordProvider -> STTProvider ->
 * (intent router / AI orchestrator) -> LLMProvider -> TTSProvider -> audio
 * output -> AvatarController. See VEYRA_ARCHITECTURE.md for the diagram.
 */

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
}

/** Whether a capability runs on-device, needs the network, or can do either. */
export type ProviderLocality = "local" | "cloud" | "hybrid";

export interface VoiceProviderDescriptor {
  id: string;
  displayName: string;
  locality: ProviderLocality;
  requiresApiKey: boolean;
}

// ---- Voice Activity Detection ----

export interface VADProvider extends VoiceProviderDescriptor {
  /** Feed one audio frame (mono, 16-bit-range floats in [-1, 1]). */
  processFrame(frame: Float32Array, sampleRate: number): void;
  onSpeechStart(cb: () => void): () => void;
  onSpeechEnd(cb: () => void): () => void;
  reset(): void;
}

// ---- Wake word ----

export type WakeCallback = (phrase: string) => void;

export interface WakeWordProvider extends VoiceProviderDescriptor {
  /** Phrases this provider listens for while SLEEPING (e.g. "veyra"). */
  readonly wakePhrases: readonly string[];
  /** Phrase that stops VEYRA while ACTIVE (e.g. "stop veyra"). */
  readonly stopPhrase: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onWake(cb: WakeCallback): () => void;
  onStop(cb: () => void): () => void;
  readonly isListening: boolean;
}

// ---- Speech to text ----

export interface STTPartialResult {
  text: string;
  isFinal: boolean;
}

export interface STTProvider extends VoiceProviderDescriptor {
  start(): Promise<void>;
  stop(): Promise<void>;
  onPartial(cb: (result: STTPartialResult) => void): () => void;
  onFinal(cb: (text: string) => void): () => void;
  onError(cb: (message: string) => void): () => void;
  readonly isListening: boolean;
}

// ---- Text to speech ----

export interface TTSVoiceInfo {
  id: string;
  name: string;
  lang: string;
  gender: "female" | "male" | "unknown";
}

export interface TTSOptions {
  voiceId?: string;
  rate?: number; // 0.5 - 2.0
  volume?: number; // 0.0 - 1.0
  pitch?: number; // 0.0 - 2.0
}

export interface TTSProvider extends VoiceProviderDescriptor {
  listVoices(): Promise<TTSVoiceInfo[]>;
  /**
   * Speaks `text`, resolving when playback finishes or is cancelled
   * (`cancel()` / barge-in / "Stop Veyra" — those are not failures).
   * Rejects on a genuine synthesis/playback failure; callers must not
   * treat rejection as success.
   */
  speak(text: string, options?: TTSOptions): Promise<void>;
  /** Stops playback immediately (spec: "Stop Veyra" / interruption). */
  cancel(): void;
  onAudioLevel(cb: (level: number) => void): () => void;
  readonly isSpeaking: boolean;
}
