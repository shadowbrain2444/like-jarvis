import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "./eventBus";
import { veyraStateMachine } from "./stateMachine";
import { SessionManager } from "./sessionManager";
import { MockWakeWordProvider } from "../voice/providers/MockWakeWordProvider";
import { MockSTTProvider } from "../voice/providers/MockSTTProvider";
import { MockTTSProvider } from "../voice/providers/MockTTSProvider";
import { AIOrchestrator } from "../ai/orchestrator";
import { MockLLMProvider } from "../ai/providers/MockLLMProvider";

describe("SessionManager", () => {
  let wake: MockWakeWordProvider;
  let stt: MockSTTProvider;
  let tts: MockTTSProvider;
  let llm: MockLLMProvider;
  let orchestrator: AIOrchestrator;
  let session: SessionManager;

  beforeEach(async () => {
    veyraStateMachine.reset();
    eventBus.clear();
    wake = new MockWakeWordProvider();
    stt = new MockSTTProvider();
    tts = new MockTTSProvider();
    llm = new MockLLMProvider();
    orchestrator = new AIOrchestrator(llm);
    session = new SessionManager({
      wakeWordProvider: wake,
      sttProvider: stt,
      ttsProvider: tts,
      orchestrator,
    });
    await session.start();
  });

  afterEach(async () => {
    await session.stop();
  });

  it("starts SLEEPING with the wake word provider listening", () => {
    expect(veyraStateMachine.state).toBe("SLEEPING");
    expect(wake.isListening).toBe(true);
  });

  it("'Veyra' moves to LISTENING and starts STT", async () => {
    wake.simulateWake("veyra");
    await Promise.resolve(); // flush the async handler chain
    expect(veyraStateMachine.state).toBe("LISTENING");
    expect(stt.isListening).toBe(true);
  });

  it("a full turn goes LISTENING -> THINKING -> SPEAKING -> LISTENING", async () => {
    llm.nextResponse = "Here is your answer.";
    wake.simulateWake("veyra");
    await Promise.resolve();

    stt.simulateFinal("what time is it");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(veyraStateMachine.state).toBe("SPEAKING");
    expect(tts.lastSpoken?.text).toBe("Here is your answer.");

    tts.completeSpeaking();
    await Promise.resolve();
    await Promise.resolve();

    expect(veyraStateMachine.state).toBe("LISTENING");
  });

  it("saying the stop phrase as the command stops the conversation", async () => {
    wake.simulateWake("veyra");
    await Promise.resolve();

    stt.simulateFinal("stop veyra");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(veyraStateMachine.state).toBe("SLEEPING");
    expect(wake.isListening).toBe(true);
  });

  it("the wake stop phrase heard while sleeping-adjacent is a no-op safeguard", async () => {
    // Stop phrase detected with nothing active: state machine.stop() is a
    // no-op while already SLEEPING, and must not throw.
    expect(() => wake.simulateStop()).not.toThrow();
    expect(veyraStateMachine.state).toBe("SLEEPING");
  });

  it("emits assistant.activated on wake and assistant.stopped on stop", async () => {
    const activated = vi.fn();
    const stopped = vi.fn();
    eventBus.on("assistant.activated", activated);
    eventBus.on("assistant.stopped", stopped);

    wake.simulateWake("veyra");
    await Promise.resolve();
    expect(activated).toHaveBeenCalledTimes(1);

    stt.simulateFinal("stop veyra");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toHaveBeenCalledWith({ reason: "user" });
  });

  // These three cover the actual activation-pipeline fix: on a runtime
  // where the wake-word/STT providers are silently mocked (no
  // SpeechRecognition — the real-world WebView2 case that motivated this),
  // these are the only way to drive VEYRA at all, so they must work
  // exactly like a real wake word / final transcript would.

  it("activateManually() drives the same SLEEPING -> LISTENING path as a spoken wake word", async () => {
    const activated = vi.fn();
    eventBus.on("assistant.activated", activated);

    await session.activateManually();
    expect(veyraStateMachine.state).toBe("LISTENING");
    expect(stt.isListening).toBe(true);
    expect(activated).toHaveBeenCalledWith({ via: "manual" });
  });

  it("activateManually() is a no-op when VEYRA isn't SLEEPING", async () => {
    await session.activateManually();
    expect(veyraStateMachine.state).toBe("LISTENING");

    await session.activateManually(); // already active; must not re-trigger
    expect(veyraStateMachine.state).toBe("LISTENING");
  });

  it("stopManually() returns to SLEEPING from any active state", async () => {
    await session.activateManually();
    await session.stopManually();
    expect(veyraStateMachine.state).toBe("SLEEPING");
    expect(wake.isListening).toBe(true);
  });

  it("submitTypedCommand() feeds text through the LISTENING pipeline like a spoken final transcript", async () => {
    llm.nextResponse = "Typed answer.";
    await session.activateManually();

    // Not awaited directly: like `stt.simulateFinal()` elsewhere in this
    // file, the full chain doesn't settle until TTS playback finishes
    // (`tts.completeSpeaking()`, unused here), so this only flushes far
    // enough to observe the SPEAKING transition.
    void session.submitTypedCommand("what's my cpu usage");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(veyraStateMachine.state).toBe("SPEAKING");
    expect(tts.lastSpoken?.text).toBe("Typed answer.");
  });

  it("submitTypedCommand() is ignored outside LISTENING", async () => {
    // Still SLEEPING: nothing to submit into.
    await session.submitTypedCommand("hello");
    expect(veyraStateMachine.state).toBe("SLEEPING");
  });

  it("a second command works without saying the wake phrase again (task requirement: no re-wake once active)", async () => {
    llm.nextResponse = "First answer.";
    wake.simulateWake("veyra");
    await Promise.resolve();
    expect(veyraStateMachine.state).toBe("LISTENING");

    // Turn 1 — no second "veyra" here.
    stt.simulateFinal("first question");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(veyraStateMachine.state).toBe("SPEAKING");
    tts.completeSpeaking();
    await Promise.resolve();
    await Promise.resolve();
    expect(veyraStateMachine.state).toBe("LISTENING"); // ready for the next command, still active

    // Turn 2 — again, no wake phrase, straight to a new command.
    llm.nextResponse = "Second answer.";
    stt.simulateFinal("second question");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(veyraStateMachine.state).toBe("SPEAKING");
    expect(tts.lastSpoken?.text).toBe("Second answer.");
  });
});
