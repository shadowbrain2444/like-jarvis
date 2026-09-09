import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "../core/eventBus";
import { ToolRegistry } from "./toolRegistry";
import type { ToolDefinition } from "./types";

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "echo",
    description: "Echoes input",
    permission: "test.echo",
    inputSchema: { type: "object", properties: {} },
    execute: async (input) => input,
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    eventBus.clear();
  });

  it("registers and executes a tool", async () => {
    registry.register(makeTool());
    const result = await registry.execute("echo", { hello: "world" });
    expect(result).toEqual({ hello: "world" });
  });

  it("throws on duplicate registration", () => {
    registry.register(makeTool());
    expect(() => registry.register(makeTool())).toThrow(/duplicate/);
  });

  it("throws when executing an unknown tool", async () => {
    await expect(registry.execute("nope", {})).rejects.toThrow(/unknown tool/);
  });

  it("emits tool.started and tool.completed on success", async () => {
    registry.register(makeTool());
    const started = vi.fn();
    const completed = vi.fn();
    eventBus.on("tool.started", started);
    eventBus.on("tool.completed", completed);

    await registry.execute("echo", {});
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ toolName: "echo" }));
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ toolName: "echo" }));
  });

  it("emits tool.failed when the tool throws", async () => {
    registry.register(
      makeTool({
        name: "boom",
        execute: async () => {
          throw new Error("kaboom");
        },
      })
    );
    const failed = vi.fn();
    eventBus.on("tool.failed", failed);

    await expect(registry.execute("boom", {})).rejects.toThrow("kaboom");
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "boom", error: "kaboom" })
    );
  });

  it("list() returns every registered tool", () => {
    registry.register(makeTool({ name: "a" }));
    registry.register(makeTool({ name: "b" }));
    expect(registry.list().map((t) => t.name).sort()).toEqual(["a", "b"]);
  });
});
