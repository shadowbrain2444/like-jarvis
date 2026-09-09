import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "./eventBus";
import { InvalidTransitionError, VeyraStateMachine } from "./stateMachine";

describe("VeyraStateMachine", () => {
  let sm: VeyraStateMachine;

  beforeEach(() => {
    sm = new VeyraStateMachine();
  });

  // The state machine emits on the shared `eventBus` singleton, so each
  // test must clear its own listeners or they'd keep firing (and
  // accumulating asserted-against arrays) in every later test.
  afterEach(() => {
    eventBus.clear();
  });

  it("starts SLEEPING", () => {
    expect(sm.state).toBe("SLEEPING");
  });

  it("'Veyra' activates: SLEEPING -> ACTIVE -> LISTENING", () => {
    sm.activate();
    expect(sm.state).toBe("LISTENING");
  });

  it("'Wake up Veyra' follows the same activation path", () => {
    // Both wake phrases map to the same activate() call at the orchestration
    // layer; the state machine only cares that activation happened.
    sm.activate();
    expect(sm.state).toBe("LISTENING");
  });

  it("full conversation turn: LISTENING -> THINKING -> SPEAKING -> LISTENING", () => {
    sm.activate();
    sm.startThinking();
    expect(sm.state).toBe("THINKING");
    sm.startSpeaking();
    expect(sm.state).toBe("SPEAKING");
    sm.finishSpeaking();
    expect(sm.state).toBe("LISTENING");
  });

  it("'Stop Veyra' from ACTIVE-derived states returns to SLEEPING via STOPPING", () => {
    sm.activate();
    sm.startThinking();
    sm.startSpeaking();
    const states: string[] = [];
    eventBus.on("avatar.state_changed", (p) => states.push(p.state));
    sm.stop();
    expect(sm.state).toBe("SLEEPING");
    expect(states).toEqual(["STOPPING", "SLEEPING"]);
  });

  it("stop() while already SLEEPING is a no-op", () => {
    const listener = vi.fn();
    eventBus.on("avatar.state_changed", listener);
    sm.stop();
    expect(sm.state).toBe("SLEEPING");
    expect(listener).not.toHaveBeenCalled();
  });

  it("interrupting speech: SPEAKING -> INTERRUPTED -> LISTENING", () => {
    sm.activate();
    sm.startThinking();
    sm.startSpeaking();
    sm.interrupt();
    expect(sm.state).toBe("LISTENING");
  });

  it("rejects an invalid transition instead of silently changing state", () => {
    // Cannot jump straight to THINKING while SLEEPING.
    expect(() => sm.startThinking()).toThrow(InvalidTransitionError);
    expect(sm.state).toBe("SLEEPING");
  });

  it("errorOccurred() is reachable from any state and recover() returns to SLEEPING", () => {
    sm.activate();
    sm.startThinking();
    sm.errorOccurred();
    expect(sm.state).toBe("ERROR");
    sm.recover();
    expect(sm.state).toBe("SLEEPING");
  });

  it("emits avatar.state_changed on every transition", () => {
    const seen: string[] = [];
    eventBus.on("avatar.state_changed", (p) => seen.push(p.state));
    sm.activate();
    sm.startThinking();
    sm.startSpeaking();
    sm.finishSpeaking();
    expect(seen).toEqual(["ACTIVE", "LISTENING", "THINKING", "SPEAKING", "LISTENING"]);
  });

  it("reset() forces SLEEPING regardless of current state", () => {
    sm.activate();
    sm.startThinking();
    sm.reset();
    expect(sm.state).toBe("SLEEPING");
  });
});
