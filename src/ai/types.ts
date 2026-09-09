/**
 * AI orchestration types (spec sections 3, 11, 17): LLM provider
 * abstraction plus the tool/skill contract every capability in
 * `src/tools/` implements.
 */

import type { ProviderLocality } from "../voice/types";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** JSON-schema-shaped tool description, matching Anthropic's tool-use format. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Permissions this tool exercises, checked Rust-side via `permission_get`/`permissions::guard`. */
  permission: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export interface LLMStreamHandlers {
  onFirstToken?: (latencyMs: number) => void;
  onToken?: (token: string) => void;
  /** A tool the model wants to call; return its result to continue the turn. */
  onToolUse?: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  onComplete?: (fullText: string, latencyMs: number) => void;
  onError?: (message: string) => void;
}

export interface LLMProviderDescriptor {
  id: string;
  displayName: string;
  locality: ProviderLocality;
  requiresApiKey: boolean;
}

export interface LLMProvider extends LLMProviderDescriptor {
  streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    handlers: LLMStreamHandlers,
    signal?: AbortSignal
  ): Promise<void>;
}
