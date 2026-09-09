import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "../../core/eventBus";
import { WebSpeechWakeWordProvider } from "./WebSpeechWakeWordProvider";

/**
 * A controllable fake of the browser's `SpeechRecognition`, driven
 * manually from tests to exercise the real provider's error-handling and
 * restart logic — the exact logic that determines whether "Veyra" is ever
 * actually detected on a given runtime.
 */
class FakeRecognition implements SpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  startCount = 0;

  start(): void {
    this.startCount++;
    this.onstart?.();
  }
  stop(): void {
    this.onend?.();
  }
  abort(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }

  emitResult(transcript: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: Object.assign([{ isFinal: true, 0: { transcript, confidence: 1 }, length: 1 }], {
        length: 1,
      }),
    } as unknown as SpeechRecognitionEventLike);
  }

  emitError(code: string): void {
    this.onerror?.({ error: code, message: "" } as SpeechRecognitionErrorEventLike);
    this.onend?.();
  }
}

describe("WebSpeechWakeWordProvider", () => {
  let fake: FakeRecognition;

  beforeEach(() => {
    eventBus.clear();
    fake = new FakeRecognition();
    (window as unknown as { SpeechRecognition: new () => SpeechRecognitionLike }).SpeechRecognition =
      vi.fn(() => fake) as unknown as new () => SpeechRecognitionLike;
  });

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("detects 'veyra' and 'wake up veyra', and the stop phrase", async () => {
    const provider = new WebSpeechWakeWordProvider();
    const onWake = vi.fn();
    const onStop = vi.fn();
    provider.onWake(onWake);
    provider.onStop(onStop);

    await provider.start();
    fake.emitResult("hey veyra how are you");
    expect(onWake).toHaveBeenCalledWith("veyra");

    fake.emitResult("stop veyra please");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("recovers from an isolated error without giving up (restarts and stays listening)", async () => {
    const provider = new WebSpeechWakeWordProvider();
    await provider.start();
    const startsBefore = fake.startCount;

    fake.emitError("no-speech"); // routine, single occurrence
    // The fake's start()/onend fire synchronously, so by the time this
    // returns the auto-restart has already completed: isListening ends up
    // true again, having briefly gone false in between.
    expect(provider.isListening).toBe(true);
    expect(fake.startCount).toBeGreaterThan(startsBefore);
  });

  it("stops auto-restarting and reports system.error after repeated consecutive failures", async () => {
    const provider = new WebSpeechWakeWordProvider();
    const onSystemError = vi.fn();
    eventBus.on("system.error", onSystemError);

    await provider.start();
    fake.emitError("not-allowed"); // 1: warns, auto-restarts
    fake.emitError("not-allowed"); // 2: warns, auto-restarts
    const startsAfterTwo = fake.startCount;
    fake.emitError("not-allowed"); // 3rd consecutive -> gives up, no further restart

    expect(onSystemError).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "wake-word", recoverable: true })
    );
    expect(onSystemError.mock.calls[0][0].message).toMatch(/not-allowed/);
    // No further restart attempt after giving up.
    expect(fake.startCount).toBe(startsAfterTwo);
  });

  it("a genuine recognition result in between resets the consecutive-error counter", async () => {
    const provider = new WebSpeechWakeWordProvider();
    const onSystemError = vi.fn();
    eventBus.on("system.error", onSystemError);

    await provider.start();
    fake.emitError("no-speech");
    fake.emitError("no-speech");
    // Recognition demonstrably works (unrelated speech, not a wake
    // phrase) — this must break the failure streak. A bare restart
    // (onstart alone, with no result) deliberately does NOT do this; see
    // the implementation comment on why.
    fake.emitResult("just some ambient conversation");
    fake.emitError("no-speech");
    fake.emitError("no-speech");

    // Never reached 3 *consecutive* failures because of the reset in between.
    expect(onSystemError).not.toHaveBeenCalled();
  });
});
