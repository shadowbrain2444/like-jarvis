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
});
