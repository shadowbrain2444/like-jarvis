import { describe, expect, it, vi } from "vitest";
import { EnergyVADProvider } from "./EnergyVADProvider";

function silence(len = 512): Float32Array {
  return new Float32Array(len); // all zeros
}

function loud(len = 512, amplitude = 0.5): Float32Array {
  const frame = new Float32Array(len);
  for (let i = 0; i < len; i++) frame[i] = amplitude * Math.sin(i);
  return frame;
}

describe("EnergyVADProvider", () => {
  it("fires speechStart when a loud frame crosses the threshold", () => {
    const vad = new EnergyVADProvider({ threshold: 0.02 });
    const onStart = vi.fn();
    vad.onSpeechStart(onStart);
    vad.processFrame(loud(), 16000);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("does not fire speechStart for silence", () => {
    const vad = new EnergyVADProvider({ threshold: 0.02 });
    const onStart = vi.fn();
    vad.onSpeechStart(onStart);
    vad.processFrame(silence(), 16000);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("only fires speechStart once while continuously speaking", () => {
    const vad = new EnergyVADProvider({ threshold: 0.02 });
    const onStart = vi.fn();
    vad.onSpeechStart(onStart);
    vad.processFrame(loud(), 16000);
    vad.processFrame(loud(), 16000);
    vad.processFrame(loud(), 16000);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("fires speechEnd only after the hangover window elapses in silence", () => {
    vi.useFakeTimers();
    const vad = new EnergyVADProvider({ threshold: 0.02, hangoverMs: 500 });
    const onEnd = vi.fn();
    vad.onSpeechEnd(onEnd);

    vad.processFrame(loud(), 16000);
    vad.processFrame(silence(), 16000);
    expect(onEnd).not.toHaveBeenCalled(); // hangover not elapsed yet

    vi.advanceTimersByTime(600);
    vad.processFrame(silence(), 16000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a brief silence dip within the hangover window does not end speech", () => {
    vi.useFakeTimers();
    const vad = new EnergyVADProvider({ threshold: 0.02, hangoverMs: 500 });
    const onStart = vi.fn();
    const onEnd = vi.fn();
    vad.onSpeechStart(onStart);
    vad.onSpeechEnd(onEnd);

    vad.processFrame(loud(), 16000);
    vi.advanceTimersByTime(100);
    vad.processFrame(silence(), 16000); // brief dip
    vi.advanceTimersByTime(100);
    vad.processFrame(loud(), 16000); // resumes speaking

    expect(onStart).toHaveBeenCalledTimes(1); // still one continuous utterance
    expect(onEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reset() clears speaking state so the next loud frame fires speechStart again", () => {
    const vad = new EnergyVADProvider({ threshold: 0.02 });
    const onStart = vi.fn();
    vad.onSpeechStart(onStart);
    vad.processFrame(loud(), 16000);
    vad.reset();
    vad.processFrame(loud(), 16000);
    expect(onStart).toHaveBeenCalledTimes(2);
  });
});
