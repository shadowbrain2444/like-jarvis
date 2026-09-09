import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "../core/eventBus";
import { toolRegistry } from "./toolRegistry";
import { AIOrchestrator } from "./orchestrator";
import { MockLLMProvider } from "./providers/MockLLMProvider";

describe("AIOrchestrator", () => {
  let provider: MockLLMProvider;
  let orchestrator: AIOrchestrator;

  beforeEach(() => {
    provider = new MockLLMProvider();
    orchestrator = new AIOrchestrator(provider);
    eventBus.clear();
    // toolRegistry is a module singleton shared across tests/files; reset
    // it to a known state so tool registration in one test can't leak.
    toolRegistry.clear();
  });

  it("streams a response and records it in history", async () => {
    provider.nextResponse = "Hello there.";
    const result = await orchestrator.sendMessage("hi");
    expect(result.text).toBe("Hello there.");
    expect(result.cancelled).toBe(false);
    expect(orchestrator.getHistory()).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello there." },
    ]);
  });

  it("emits llm.started, llm.first_token, and llm.completed", async () => {
    const started = vi.fn();
    const firstToken = vi.fn();
    const completed = vi.fn();
    eventBus.on("llm.started", started);
    eventBus.on("llm.first_token", firstToken);
    eventBus.on("llm.completed", completed);

    await orchestrator.sendMessage("hi");
    expect(started).toHaveBeenCalledTimes(1);
    expect(firstToken).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("routes a model tool call through the tool registry", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    toolRegistry.register({
      name: "get_weather",
      description: "test tool",
      permission: "test",
      inputSchema: { type: "object", properties: {} },
      execute,
    });
    provider.toolCallToMake = { name: "get_weather", input: { city: "NYC" } };

    await orchestrator.sendMessage("what's the weather");
    expect(execute).toHaveBeenCalledWith({ city: "NYC" });
  });

  it("caps history at the rolling window instead of growing unboundedly", async () => {
    for (let i = 0; i < 15; i++) {
      await orchestrator.sendMessage(`message ${i}`);
    }
    expect(orchestrator.getHistory().length).toBeLessThanOrEqual(20);
  });

  it("a new sendMessage cancels an in-flight one", async () => {
    // MockLLMProvider resolves synchronously token-by-token, so to observe
    // cancellation we abort a slow provider mid-stream instead.
    let capturedSignal: AbortSignal | undefined;
    const slowProvider = {
      id: "slow",
      displayName: "slow",
      locality: "local" as const,
      requiresApiKey: false,
      streamChat: (_m: unknown, _t: unknown, handlers: { onComplete?: (t: string, l: number) => void }, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
          setTimeout(() => {
            handlers.onComplete?.("too slow", 999);
            resolve();
          }, 5000);
        });
      },
    };
    orchestrator.setProvider(slowProvider);

    const first = orchestrator.sendMessage("first");
    orchestrator.cancel();
    await first;
    expect(capturedSignal?.aborted).toBe(true);
  });
});
