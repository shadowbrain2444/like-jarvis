import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./eventBus";

describe("EventBus", () => {
  it("delivers a payload to a subscribed listener", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("wake.detected", listener);
    bus.emit("wake.detected", { phrase: "veyra" });
    expect(listener).toHaveBeenCalledWith({ phrase: "veyra" });
  });

  it("supports multiple listeners on the same event", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("wake.stop_detected", a);
    bus.on("wake.stop_detected", b);
    bus.emit("wake.stop_detected", {});
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("off() stops delivering to that listener only", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("wake.stop_detected", a);
    bus.on("wake.stop_detected", b);
    bus.off("wake.stop_detected", a);
    bus.emit("wake.stop_detected", {});
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("once() fires exactly one time", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.once("wake.detected", listener);
    bus.emit("wake.detected", { phrase: "veyra" });
    bus.emit("wake.detected", { phrase: "veyra" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a listener unsubscribing itself mid-emit does not break delivery to others", () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const offA = bus.on("wake.detected", () => {
      calls.push("a");
      offA();
    });
    bus.on("wake.detected", () => calls.push("b"));
    bus.emit("wake.detected", { phrase: "veyra" });
    expect(calls).toEqual(["a", "b"]);
  });

  it("a throwing listener does not prevent other listeners from running", () => {
    const bus = new EventBus();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    bus.on("wake.detected", () => {
      calls.push("first");
      throw new Error("boom");
    });
    bus.on("wake.detected", () => calls.push("second"));
    bus.emit("wake.detected", { phrase: "veyra" });
    expect(calls).toEqual(["first", "second"]);
    errSpy.mockRestore();
  });

  it("emitting an event with no listeners is a no-op", () => {
    const bus = new EventBus();
    expect(() => bus.emit("wake.stop_detected", {})).not.toThrow();
  });

  it("clear() removes all listeners", () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on("wake.detected", listener);
    bus.clear();
    bus.emit("wake.detected", { phrase: "veyra" });
    expect(listener).not.toHaveBeenCalled();
  });
});
