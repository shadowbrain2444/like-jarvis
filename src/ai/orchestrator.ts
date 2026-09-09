/**
 * AI Orchestrator (spec sections 3, 5, 17): turns one final transcript
 * into a streamed reply, executing any tools the model calls along the
 * way, and reports latency at every stage for the performance monitor.
 *
 * Memory here is intentionally just short-term/working memory — the
 * current conversation's rolling message list, capped so it doesn't grow
 * unboundedly (spec section 10: "do not dump the entire history into every
 * LLM request"). Long-term/semantic/episodic memory is a real subsystem
 * with its own storage and ranking concerns; it plugs in here later as a
 * step that runs before `streamChat` to inject relevant retrieved context,
 * without changing this class's public shape.
 */

import { eventBus } from "../core/eventBus";
import type { ChatMessage, LLMProvider } from "./types";
import { toolRegistry } from "./toolRegistry";

const MAX_HISTORY_MESSAGES = 20;

export interface OrchestratorTurnResult {
  text: string;
  cancelled: boolean;
}

export class AIOrchestrator {
  private history: ChatMessage[] = [];
  private activeAbortController: AbortController | null = null;

  constructor(private llmProvider: LLMProvider) {}

  setProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  getHistory(): readonly ChatMessage[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  /** Cancels the in-flight turn, if any (barge-in / "Stop Veyra"). */
  cancel(): void {
    this.activeAbortController?.abort();
  }

  async sendMessage(userText: string): Promise<OrchestratorTurnResult> {
    this.cancel(); // a new turn always preempts an in-flight one

    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    this.activeAbortController = controller;

    this.history.push({ role: "user", content: userText });
    this.trimHistory();

    eventBus.emit("llm.started", { requestId });
    const start = performance.now();
    let fullText = "";
    let errored: string | null = null;

    await this.llmProvider.streamChat(
      this.history,
      toolRegistry.list(),
      {
        onFirstToken: (latencyMs) => {
          eventBus.emit("llm.first_token", { requestId, latencyMs });
          eventBus.emit("performance.metric", { metric: "llm.first_token_ms", valueMs: latencyMs });
        },
        onToken: (token) => {
          fullText += token;
          eventBus.emit("llm.token", { requestId, token });
        },
        onToolUse: (name, input) => toolRegistry.execute(name, input),
        onComplete: (text, latencyMs) => {
          fullText = text;
          eventBus.emit("llm.completed", { requestId, text, latencyMs });
          eventBus.emit("performance.metric", { metric: "llm.total_ms", valueMs: latencyMs });
        },
        onError: (message) => {
          errored = message;
          eventBus.emit("llm.failed", { requestId, error: message });
          eventBus.emit("system.error", { scope: "llm", message, recoverable: true });
        },
      },
      controller.signal
    );

    const cancelled = controller.signal.aborted;
    if (this.activeAbortController === controller) this.activeAbortController = null;

    if (!cancelled && !errored && fullText) {
      this.history.push({ role: "assistant", content: fullText });
      this.trimHistory();
    }

    void start; // total wall time already reported via onComplete's latencyMs
    return { text: fullText, cancelled };
  }

  private trimHistory(): void {
    if (this.history.length > MAX_HISTORY_MESSAGES) {
      this.history = this.history.slice(this.history.length - MAX_HISTORY_MESSAGES);
    }
  }
}
