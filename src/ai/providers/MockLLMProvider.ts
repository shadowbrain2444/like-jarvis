/**
 * Deterministic [[LLMProvider]] for unit tests and offline/no-API-key
 * development. Streams a canned or scripted response token-by-token so
 * callers exercise the same streaming path they'd hit with a real
 * provider.
 */

import type { ChatMessage, LLMProvider, LLMStreamHandlers, ToolDefinition } from "../types";

export class MockLLMProvider implements LLMProvider {
  readonly id = "mock-llm";
  readonly displayName = "Scripted responder (testing)";
  readonly locality = "local" as const;
  readonly requiresApiKey = false;

  /** Set by tests to control what the "model" says next. */
  public nextResponse = "This is a test response from VEYRA.";
  public toolCallToMake: { name: string; input: Record<string, unknown> } | null = null;

  async streamChat(
    _messages: ChatMessage[],
    _tools: ToolDefinition[],
    handlers: LLMStreamHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    const start = Date.now();

    if (this.toolCallToMake && handlers.onToolUse) {
      const { name, input } = this.toolCallToMake;
      await handlers.onToolUse(name, input);
    }

    const words = this.nextResponse.split(" ");
    let emitted = "";
    for (let i = 0; i < words.length; i++) {
      if (signal?.aborted) return;
      const token = i === 0 ? words[i] : ` ${words[i]}`;
      emitted += token;
      if (i === 0) handlers.onFirstToken?.(Date.now() - start);
      handlers.onToken?.(token);
    }
    handlers.onComplete?.(emitted, Date.now() - start);
  }
}
