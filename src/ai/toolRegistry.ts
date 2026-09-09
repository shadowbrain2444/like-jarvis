/**
 * Central tool/skill registry (spec section 11). Tools register themselves
 * here once at startup (see `src/tools/index.ts`); the AI orchestrator
 * hands the registry's tool list to the LLM provider and routes any
 * `tool_use` the model produces back through [[ToolRegistry.execute]].
 *
 * This is also where every tool call becomes observable: each execution
 * emits `tool.started` / `tool.completed` / `tool.failed` on the shared
 * event bus (for the UI/dev overlay) in addition to whatever audit trail
 * the Rust side records for OS-level actions.
 */

import { eventBus } from "../core/eventBus";
import type { ToolDefinition } from "./types";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`[VEYRA][TOOL] duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Test-only: drop all registrations so each test starts from a clean registry. */
  clear(): void {
    this.tools.clear();
  }

  async execute(name: string, input: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    const requestId = crypto.randomUUID();
    if (!tool) {
      const error = `unknown tool: ${name}`;
      eventBus.emit("tool.failed", { toolName: name, requestId, error });
      throw new Error(`[VEYRA][TOOL] ${error}`);
    }

    eventBus.emit("tool.started", { toolName: name, requestId });
    const start = performance.now();
    try {
      const result = await tool.execute(input);
      eventBus.emit("tool.completed", {
        toolName: name,
        requestId,
        durationMs: performance.now() - start,
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      eventBus.emit("tool.failed", { toolName: name, requestId, error });
      throw err;
    }
  }
}

export const toolRegistry = new ToolRegistry();
