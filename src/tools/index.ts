/**
 * Registers every built-in skill with the tool registry. Called once at
 * app startup (see `src/main.tsx`). Adding a new skill means adding a new
 * `ToolDefinition[]` module here — nothing else in the AI orchestrator,
 * intent routing, or LLM providers needs to change (spec section 11).
 */

import { toolRegistry } from "../ai/toolRegistry";
import { computerControlTools } from "./computerControlSkill";

let registered = false;

export function registerBuiltinSkills(): void {
  if (registered) return;
  registered = true;
  for (const tool of computerControlTools) {
    toolRegistry.register(tool);
  }
}
