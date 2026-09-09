/**
 * Cloud [[LLMProvider]] backed by the Anthropic Messages API, with native
 * tool use (spec sections 3 "Multiple AI providers" / 11 "Skills" / 17
 * "Automation Engine" — tool-calling *is* VEYRA's intent router and
 * planner: the model decides which registered tool to call and with what
 * arguments, VEYRA executes it and feeds the result back, looping until
 * the model produces a final answer).
 *
 * The API key is supplied by the caller (read from local settings, see
 * `settings/settingsStore.ts`) — never hardcoded, never logged.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, LLMProvider, LLMStreamHandlers, ToolDefinition } from "../types";

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048;
/** Guards against a runaway tool-call loop if a tool keeps re-triggering itself. */
const MAX_TOOL_ROUNDS = 6;

export const VEYRA_SYSTEM_PROMPT = `You are VEYRA, a local-first desktop AI assistant running on the
user's own Windows PC. You speak your replies aloud through text-to-speech, so keep responses
concise, natural, and conversational — short sentences, no markdown, no bullet lists, no headers.
You have tools to control the computer (files, apps, windows, input, clipboard, system info).
Use a tool when the user's request requires it; otherwise just answer directly. Confirm briefly
before or after destructive actions (deleting or overwriting files, closing applications).
Personality: warm, capable, understated confidence — closer to a sharp chief-of-staff than a
cheerful chatbot. Never mention that you are an AI language model unless asked.`;

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly displayName = "Claude (Anthropic)";
  readonly locality = "cloud" as const;
  readonly requiresApiKey = true;

  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.model = model;
  }

  async streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    handlers: LLMStreamHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    const start = Date.now();
    let firstTokenSeen = false;
    let fullText = "";

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    let conversation: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role === "system" ? "user" : m.role,
      content: m.content,
    }));

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = this.client.messages.stream(
          {
            model: this.model,
            max_tokens: MAX_TOKENS,
            system: VEYRA_SYSTEM_PROMPT,
            messages: conversation,
            tools: anthropicTools.length > 0 ? anthropicTools : undefined,
          },
          { signal }
        );

        stream.on("text", (delta) => {
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            handlers.onFirstToken?.(Date.now() - start);
          }
          fullText += delta;
          handlers.onToken?.(delta);
        });

        const finalMessage = await stream.finalMessage();

        if (finalMessage.stop_reason !== "tool_use") {
          handlers.onComplete?.(fullText, Date.now() - start);
          return;
        }

        // Model wants to call one or more tools: execute each, then loop
        // back with the tool results appended so it can produce a final
        // answer (or call another tool).
        conversation = [...conversation, { role: "assistant", content: finalMessage.content }];

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of finalMessage.content) {
          if (block.type !== "tool_use") continue;
          try {
            const result = await handlers.onToolUse?.(
              block.name,
              block.input as Record<string, unknown>
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result ?? null),
            });
          } catch (err) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `error: ${err instanceof Error ? err.message : String(err)}`,
              is_error: true,
            });
          }
        }
        conversation = [...conversation, { role: "user", content: toolResults }];
      }

      handlers.onError?.("tool call loop exceeded maximum rounds");
    } catch (err) {
      if (signal?.aborted) return; // cancellation, not an error
      handlers.onError?.(err instanceof Error ? err.message : String(err));
    }
  }
}
