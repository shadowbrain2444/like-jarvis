/**
 * Session Manager (spec section 25, "VEYRA CORE"): the orchestration layer
 * that wires wake word, STT, the AI orchestrator, and TTS to the state
 * machine. This is the only place that decides *when* to start/stop each
 * provider — individual providers stay ignorant of each other.
 *
 * Turn flow:
 *   SLEEPING --wake word heard--> activate() --> LISTENING (STT starts)
 *   LISTENING --final transcript--> THINKING (AI orchestrator streams)
 *   THINKING --response ready--> SPEAKING (TTS plays, VAD arms for barge-in)
 *   SPEAKING --finishes naturally--> LISTENING (STT restarts for next turn)
 *   SPEAKING --user starts talking (VAD)--> INTERRUPTED -> LISTENING (STT
 *     restarts immediately; if what they say is the stop phrase, this
 *     naturally routes to stop() below rather than a new AI turn)
 *   (any active state) --"stop veyra" heard as a final transcript--> stop()
 *
 * Known MVP gap: while THINKING (the brief LLM round-trip), the mic isn't
 * actively monitored, so "Stop Veyra" said in that narrow window isn't
 * caught until the response starts playing. Documented in
 * VEYRA_ARCHITECTURE.md rather than papered over.
 */

import { eventBus } from "./eventBus";
import { veyraStateMachine } from "./stateMachine";
import type { VeyraState } from "./types";
import { audioEngine } from "../voice/AudioEngine";
import { EnergyVADProvider } from "../voice/providers/EnergyVADProvider";
import type { STTProvider, TTSOptions, TTSProvider, WakeWordProvider } from "../voice/types";
import { AIOrchestrator } from "../ai/orchestrator";
import { logger } from "../logging/logger";

function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Reads the live state machine state. Deliberately a function, not a
 * direct `veyraStateMachine.state` access at every call site: TypeScript's
 * control-flow narrowing treats a getter as unchanging within a function
 * body, which is wrong here since `await`s in between can and do change
 * it via other event handlers.
 */
function currentState(): VeyraState {
  return veyraStateMachine.state;
}

export interface SessionManagerDeps {
  wakeWordProvider: WakeWordProvider;
  sttProvider: STTProvider;
  ttsProvider: TTSProvider;
  orchestrator: AIOrchestrator;
  /** Re-read on every `speak()` call so a settings change applies to the next turn. */
  getTTSOptions?: () => TTSOptions;
}

export class SessionManager {
  private wakeWordProvider: WakeWordProvider;
  private sttProvider: STTProvider;
  private ttsProvider: TTSProvider;
  private orchestrator: AIOrchestrator;
  private getTTSOptions: () => TTSOptions;
  private vad = new EnergyVADProvider();
  private unsubscribers: Array<() => void> = [];
  private running = false;
  private micStarted = false;

  constructor(deps: SessionManagerDeps) {
    this.wakeWordProvider = deps.wakeWordProvider;
    this.sttProvider = deps.sttProvider;
    this.ttsProvider = deps.ttsProvider;
    this.orchestrator = deps.orchestrator;
    this.getTTSOptions = deps.getTTSOptions ?? (() => ({}));
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // The single most important diagnostic line in this file: if the
    // wake-word provider ever silently degrades to the manual-trigger mock
    // (e.g. because the WebView doesn't implement SpeechRecognition — see
    // `bootstrap.ts` and `VEYRA_TROUBLESHOOTING.md`), this makes it visible
    // in the log immediately instead of the assistant just never activating.
    logger.info(
      "CORE",
      `Voice providers selected — wake: "${this.wakeWordProvider.id}" (${this.wakeWordProvider.displayName}), ` +
        `stt: "${this.sttProvider.id}" (${this.sttProvider.displayName}), ` +
        `tts: "${this.ttsProvider.id}" (${this.ttsProvider.displayName})`
    );
    if (this.wakeWordProvider.id === "mock-wake-word") {
      logger.warn(
        "WAKE",
        "Real wake-word listening is NOT active (using the manual-trigger fallback). " +
          "Saying \"Veyra\" will do nothing — use activateManually() / the Activate button / the global hotkey instead."
      );
    }

    this.unsubscribers.push(
      this.wakeWordProvider.onWake((phrase) => this.handleWake(phrase)),
      this.wakeWordProvider.onStop(() => this.handleStopPhrase()),
      this.sttProvider.onFinal((text) => this.handleFinalTranscript(text)),
      this.sttProvider.onError((message) =>
        logger.warn("STT", "recognition error (non-fatal, listening continues)", message)
      ),
      this.vad.onSpeechStart(() => this.handleBargeIn())
    );

    logger.info("VOICE", "Initializing microphone...");
    try {
      await audioEngine.startCapture();
      this.micStarted = true;
      audioEngine.onFrame((frame, sampleRate) => this.vad.processFrame(frame, sampleRate));
    } catch (err) {
      // Microphone permission denial shouldn't crash the app — VEYRA just
      // can't hear anything until the user grants access from Settings.
      logger.warn("VOICE", "microphone capture unavailable", err);
    }

    logger.info("WAKE", "Wake engine initializing...");
    try {
      await this.wakeWordProvider.start();
      logger.info("WAKE", "Listening for wake phrase: veyra, wake up veyra");
    } catch (err) {
      logger.error("WAKE", "Wake engine failed to start", err);
      eventBus.emit("system.error", {
        scope: "wake-word",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.unsubscribers.forEach((off) => off());
    this.unsubscribers = [];
    await this.wakeWordProvider.stop();
    await this.sttProvider.stop();
    this.ttsProvider.cancel();
    if (this.micStarted) {
      audioEngine.stopCapture();
      this.micStarted = false;
    }
    veyraStateMachine.reset();
  }

  private async handleWake(phrase: string): Promise<void> {
    await this.activate("wake_word", phrase);
  }

  /**
   * Public entry point for any non-voice activation trigger (the UI's
   * Activate button, the global hotkey) — a real, working substitute for
   * "say Veyra" on runtimes where wake-word listening can't run at all
   * (see `bootstrap.ts`'s capability check). Goes through the exact same
   * state-machine path as a detected wake word.
   */
  async activateManually(): Promise<void> {
    await this.activate("manual", "manual-activation");
  }

  private async activate(via: "wake_word" | "manual", phrase: string): Promise<void> {
    if (currentState() !== "SLEEPING") return;
    logger.info("WAKE", `Wake phrase detected: ${phrase}`);
    eventBus.emit("wake.detected", { phrase });
    eventBus.emit("assistant.activated", { via });
    veyraStateMachine.activate(); // SLEEPING -> ACTIVE -> LISTENING
    // Only one WebSpeech recognition session runs at a time: hand off from
    // wake-word listening to command listening.
    await this.wakeWordProvider.stop();
    await this.beginListening();
  }

  private async handleStopPhrase(): Promise<void> {
    await this.stopConversation("user");
  }

  /** Public entry point for the UI's Stop button / the global hotkey. */
  async stopManually(): Promise<void> {
    await this.stopConversation("user");
  }

  /**
   * Feeds a typed command through exactly the same path a spoken final
   * transcript would take — the fallback for runtimes where STT can't run
   * (same capability gap as wake word; see `bootstrap.ts`). Only valid
   * while LISTENING; call `activateManually()` first if VEYRA is asleep.
   */
  async submitTypedCommand(text: string): Promise<void> {
    if (currentState() !== "LISTENING") {
      logger.warn("CORE", "submitTypedCommand ignored: VEYRA is not currently LISTENING");
      return;
    }
    await this.handleFinalTranscript(text);
  }

  private async handleBargeIn(): Promise<void> {
    if (currentState() !== "SPEAKING") return;
    this.ttsProvider.cancel();
    veyraStateMachine.interrupt(); // SPEAKING -> INTERRUPTED -> LISTENING
    await this.beginListening();
  }

  private async beginListening(): Promise<void> {
    try {
      await this.sttProvider.start();
    } catch (err) {
      this.fail("stt", err);
    }
  }

  private async handleFinalTranscript(text: string): Promise<void> {
    if (currentState() !== "LISTENING") return;
    eventBus.emit("voice.final_transcript", { text });

    if (normalizePhrase(text).includes(normalizePhrase(this.wakeWordProvider.stopPhrase))) {
      await this.stopConversation("user");
      return;
    }
    if (text.trim().length === 0) {
      // Nothing usable was heard; stay in LISTENING for the next attempt.
      await this.beginListening();
      return;
    }

    veyraStateMachine.startThinking();
    try {
      const result = await this.orchestrator.sendMessage(text);
      if (result.cancelled || currentState() !== "THINKING") return;

      veyraStateMachine.startSpeaking();
      eventBus.emit("tts.started", { requestId: crypto.randomUUID() });
      const speakStart = performance.now();
      let firstAudioReported = false;
      const offLevel = this.ttsProvider.onAudioLevel((level) => {
        eventBus.emit("avatar.speaking", { amplitude: level });
        if (level > 0 && !firstAudioReported) {
          firstAudioReported = true;
          eventBus.emit("tts.first_audio", {
            requestId: "",
            latencyMs: performance.now() - speakStart,
          });
        }
      });
      await this.ttsProvider.speak(result.text, this.getTTSOptions());
      offLevel();
      eventBus.emit("tts.completed", { requestId: "" });

      if (currentState() === "SPEAKING") {
        veyraStateMachine.finishSpeaking(); // -> LISTENING
        await this.beginListening();
      }
    } catch (err) {
      this.fail("orchestrator", err);
    }
  }

  private async stopConversation(reason: "user" | "error"): Promise<void> {
    this.orchestrator.cancel();
    this.ttsProvider.cancel();
    await this.sttProvider.stop();
    eventBus.emit("wake.stop_detected", {});
    eventBus.emit("assistant.stopped", { reason });
    veyraStateMachine.stop();
    await this.wakeWordProvider.start().catch(() => {});
  }

  private fail(scope: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ERROR", `[${scope}]`, message);
    eventBus.emit("system.error", { scope, message, recoverable: true });
    veyraStateMachine.errorOccurred();
    this.ttsProvider.cancel();
    this.sttProvider.stop().finally(() => {
      setTimeout(() => {
        veyraStateMachine.recover();
        this.wakeWordProvider.start().catch(() => {});
      }, 1500);
    });
  }
}
