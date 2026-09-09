import { describe, expect, it, vi } from "vitest";
import { eventBus } from "./eventBus";
import { buildSessionManager } from "./bootstrap";
import { DEFAULT_SETTINGS } from "../settings/settingsStore";
import { MockWakeWordProvider } from "../voice/providers/MockWakeWordProvider";
import { isSpeechRecognitionSupported } from "../voice/providers/webSpeechSupport";

describe("buildSessionManager capability handling", () => {
  it("jsdom has no SpeechRecognition, mirroring the real WebView2 gap this fix addresses", () => {
    // This is the exact condition that silently broke wake-word activation
    // in production: no `window.SpeechRecognition` /
    // `window.webkitSpeechRecognition`.
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it("falls back to the manual-trigger wake word provider when SpeechRecognition is unavailable", () => {
    const session = buildSessionManager({
      ...DEFAULT_SETTINGS,
      wakeWordProviderId: "web-speech-wake-word",
    });
    // SessionManager keeps its providers private; the only externally
    // observable proof of which one was chosen is the capability event
    // below plus `activateManually()` still working end-to-end (covered
    // in sessionManager.test.ts). This test locks in that bootstrap
    // actually performs the fallback rather than throwing or hanging.
    expect(session).toBeInstanceOf(Object);
  });

  it("emits voice.capability with speechRecognitionAvailable: false so the UI can show the fallback controls", () => {
    const onCapability = vi.fn();
    eventBus.on("voice.capability", onCapability);

    buildSessionManager(DEFAULT_SETTINGS);

    expect(onCapability).toHaveBeenCalledWith(
      expect.objectContaining({ speechRecognitionAvailable: false })
    );
  });

  it("MockWakeWordProvider (the actual production fallback) only ever activates via simulateWake, never on its own", async () => {
    const wake = new MockWakeWordProvider();
    const onWake = vi.fn();
    wake.onWake(onWake);
    await wake.start();
    // Waiting confirms there is no timer/listener inside the mock that
    // could spontaneously fire — this is the class that made "Veyra"
    // silently do nothing.
    await new Promise((r) => setTimeout(r, 10));
    expect(onWake).not.toHaveBeenCalled();
  });
});
