/**
 * Latency tracking and the dev-mode performance overlay data source (spec
 * section 5). Listens to `performance.metric` on the event bus, keeps a
 * rolling window per metric name in memory for the UI, and persists every
 * sample to the local database (`metric_record`) so trends survive a
 * restart.
 *
 * Stages tracked end-to-end for one conversation turn:
 * wake -> stt.final -> llm.first_token -> llm.total -> tts.first_audio ->
 * turn.total (wake detected to first audio out).
 */

import { invoke } from "@tauri-apps/api/core";
import { eventBus } from "../core/eventBus";
import { logger } from "../logging/logger";

const ROLLING_WINDOW = 20;

export interface MetricSnapshot {
  metric: string;
  latestMs: number;
  averageMs: number;
  sampleCount: number;
}

export class LatencyMonitor {
  private samples = new Map<string, number[]>();
  private turnStartedAt: number | null = null;
  private unsubscribe: (() => void) | null = null;

  start(): void {
    if (this.unsubscribe) return;
    const off1 = eventBus.on("performance.metric", ({ metric, valueMs }) => {
      this.record(metric, valueMs);
    });
    const off2 = eventBus.on("wake.detected", () => {
      this.turnStartedAt = performance.now();
    });
    const off3 = eventBus.on("tts.first_audio", ({ latencyMs }) => {
      this.record("tts.first_audio_ms", latencyMs);
      if (this.turnStartedAt !== null) {
        this.record("turn.total_ms", performance.now() - this.turnStartedAt);
        this.turnStartedAt = null;
      }
    });
    this.unsubscribe = () => {
      off1();
      off2();
      off3();
    };
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private record(metric: string, valueMs: number): void {
    const list = this.samples.get(metric) ?? [];
    list.push(valueMs);
    if (list.length > ROLLING_WINDOW) list.shift();
    this.samples.set(metric, list);

    logger.debug("PERFORMANCE", `${metric} = ${valueMs.toFixed(1)}ms`);
    invoke("metric_record", { metric, valueMs }).catch((err) => {
      logger.warn("PERFORMANCE", "failed to persist metric", err);
    });
  }

  getSnapshot(): MetricSnapshot[] {
    return [...this.samples.entries()].map(([metric, values]) => ({
      metric,
      latestMs: values[values.length - 1] ?? 0,
      averageMs: values.reduce((a, b) => a + b, 0) / values.length,
      sampleCount: values.length,
    }));
  }
}

export const latencyMonitor = new LatencyMonitor();
