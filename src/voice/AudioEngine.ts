/**
 * Owns the microphone (`getUserMedia`) and speaker/device enumeration
 * (spec section 4: "Audio device selection", "Microphone selection",
 * "Audio buffering"). Wraps the Web Audio API so the rest of the voice
 * pipeline (VAD, wake word, STT) reads audio frames without touching
 * `MediaStream`/`AudioContext` directly.
 *
 * This does not do speech recognition itself — `SpeechRecognition`-backed
 * providers open their own internal audio path per the browser spec and
 * don't take frames from here. `AudioEngine` is what VAD and a future
 * frame-based STT/wake-word provider (e.g. one running an ONNX model) would
 * consume, and it is also what drives the LISTENING-state audio-reactive
 * avatar visualization today.
 */

import { eventBus } from "../core/eventBus";
import { logger } from "../logging/logger";
import type { AudioDeviceInfo } from "./types";

export type AudioFrameListener = (frame: Float32Array, sampleRate: number) => void;

/**
 * Safe runtime diagnostics: confirms whether audio is actually flowing
 * without exposing any sample data, recorded audio, or transcript content.
 * Consumed by `src/ui/MicDiagnostics.tsx` (Settings -> Developer).
 */
export interface AudioDiagnostics {
  capturing: boolean;
  deviceLabel: string | null;
  sampleRate: number | null;
  framesReceived: number;
  lastFrameAgoMs: number | null;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private workletNode: ScriptProcessorNode | null = null;
  private frameListeners = new Set<AudioFrameListener>();
  private levelRaf: number | null = null;
  private deviceLabel: string | null = null;
  private frameCount = 0;
  private lastFrameAt: number | null = null;

  get isCapturing(): boolean {
    return this.mediaStream !== null;
  }

  /** Non-sensitive snapshot for the diagnostic overlay — no raw audio, ever. */
  getDiagnostics(): AudioDiagnostics {
    return {
      capturing: this.isCapturing,
      deviceLabel: this.deviceLabel,
      sampleRate: this.audioContext?.sampleRate ?? null,
      framesReceived: this.frameCount,
      lastFrameAgoMs: this.lastFrameAt !== null ? Date.now() - this.lastFrameAt : null,
    };
  }

  async listDevices(): Promise<AudioDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    // Labels are only populated after a permission grant; callers that
    // need labels should call this again after `startCapture()`.
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput" || d.kind === "audiooutput")
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `${d.kind} (${d.deviceId.slice(0, 8)})`,
        kind: d.kind as "audioinput" | "audiooutput",
      }));
  }

  async startCapture(deviceId?: string): Promise<void> {
    if (this.mediaStream) this.stopCapture();

    logger.info("VOICE", "Initializing microphone...");
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (err) {
      // Not swallowed: logged with the real DOMException name (e.g.
      // NotAllowedError, NotFoundError) before propagating to the caller.
      logger.error("VOICE", "Microphone initialization failed", err);
      throw err;
    }

    this.deviceLabel = this.mediaStream.getAudioTracks()[0]?.label || "default microphone";
    logger.info("VOICE", `Audio input device found: ${this.deviceLabel}`);

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 1024;
    this.sourceNode.connect(this.analyserNode);

    this.frameCount = 0;
    this.lastFrameAt = null;

    // ScriptProcessorNode is deprecated in favor of AudioWorklet, but needs
    // no separate module file to load and is broadly supported in
    // WebView2/Chromium today — an AudioWorklet-based VAD path is a drop-in
    // upgrade behind the same `onFrame` interface.
    this.workletNode = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.workletNode.onaudioprocess = (event) => {
      const frame = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(frame);
      this.frameCount++;
      this.lastFrameAt = Date.now();
      if (this.frameCount === 1) {
        // Logged once, not per-frame (audio callbacks fire dozens of
        // times a second) — this is the confirmation that real samples
        // are flowing, not just that the stream opened.
        logger.info("VOICE", "Receiving audio frames");
      }
      this.frameListeners.forEach((cb) => cb(copy, this.audioContext!.sampleRate));
    };
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination);

    logger.info("VOICE", "Audio stream started");
    eventBus.emit("voice.started", { source: "mic" });
    this.startLevelMetering();
  }

  stopCapture(): void {
    this.stopLevelMetering();
    this.workletNode?.disconnect();
    this.analyserNode?.disconnect();
    this.sourceNode?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();

    this.workletNode = null;
    this.analyserNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.deviceLabel = null;
    this.frameCount = 0;
    this.lastFrameAt = null;
  }

  onFrame(cb: AudioFrameListener): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  private startLevelMetering(): void {
    if (!this.analyserNode) return;
    const buffer = new Float32Array(this.analyserNode.fftSize);
    const tick = () => {
      if (!this.analyserNode) return;
      this.analyserNode.getFloatTimeDomainData(buffer);
      let sumSquares = 0;
      for (const sample of buffer) sumSquares += sample * sample;
      const rms = Math.sqrt(sumSquares / buffer.length);
      eventBus.emit("avatar.listening", { amplitude: Math.min(1, rms * 4) });
      this.levelRaf = requestAnimationFrame(tick);
    };
    this.levelRaf = requestAnimationFrame(tick);
  }

  private stopLevelMetering(): void {
    if (this.levelRaf !== null) {
      cancelAnimationFrame(this.levelRaf);
      this.levelRaf = null;
    }
  }
}

export const audioEngine = new AudioEngine();
