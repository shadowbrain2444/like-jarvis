import { beforeEach, describe, expect, it } from "vitest";
import { eventBus } from "./eventBus";
import { attachActivityLog, clearActivityLog, getActivityEntries } from "./activityLog";

describe("activityLog", () => {
  beforeEach(() => {
    clearActivityLog();
  });

  it("attachActivityLog() is idempotent — attaching twice does not double-record events", () => {
    attachActivityLog();
    attachActivityLog();
    eventBus.emit("wake.detected", { phrase: "veyra" });
    expect(getActivityEntries().filter((e) => e.kind === "WAKE_DETECTED")).toHaveLength(1);
  });

  it("records WAKE_DETECTED from wake.detected", () => {
    attachActivityLog();
    eventBus.emit("wake.detected", { phrase: "veyra" });
    const [entry] = getActivityEntries();
    expect(entry.kind).toBe("WAKE_DETECTED");
    expect(entry.detail).toContain("veyra");
  });

  it("records LISTENING_STARTED only when avatar.state_changed reaches LISTENING", () => {
    attachActivityLog();
    eventBus.emit("avatar.state_changed", { state: "ACTIVE" });
    eventBus.emit("avatar.state_changed", { state: "LISTENING" });
    eventBus.emit("avatar.state_changed", { state: "THINKING" });
    const listening = getActivityEntries().filter((e) => e.kind === "LISTENING_STARTED");
    expect(listening).toHaveLength(1);
  });

  it("records TRANSCRIPT_RECEIVED, AI lifecycle, TTS lifecycle, and ERROR", () => {
    attachActivityLog();
    eventBus.emit("voice.final_transcript", { text: "what time is it" });
    eventBus.emit("llm.started", { requestId: "1" });
    eventBus.emit("llm.completed", { requestId: "1", text: "It's noon.", latencyMs: 10 });
    eventBus.emit("tts.started", { requestId: "1" });
    eventBus.emit("tts.completed", { requestId: "1" });
    eventBus.emit("system.error", { scope: "stt", message: "boom", recoverable: true });

    const kinds = getActivityEntries().map((e) => e.kind);
    expect(kinds).toEqual([
      "ERROR",
      "COMMAND_COMPLETED",
      "TTS_STARTED",
      "AI_RESPONSE_COMPLETED",
      "AI_RESPONSE_STARTED",
      "TRANSCRIPT_RECEIVED",
    ]);
  });

  it("caps the feed at 50 entries, newest first", () => {
    attachActivityLog();
    for (let i = 0; i < 60; i++) {
      eventBus.emit("wake.detected", { phrase: `veyra-${i}` });
    }
    const entries = getActivityEntries();
    expect(entries).toHaveLength(50);
    expect(entries[0].detail).toContain("veyra-59"); // most recent first
  });

  it("clearActivityLog() empties the feed", () => {
    attachActivityLog();
    eventBus.emit("wake.detected", { phrase: "veyra" });
    expect(getActivityEntries().length).toBeGreaterThan(0);

    clearActivityLog();
    expect(getActivityEntries()).toHaveLength(0);
  });
});
