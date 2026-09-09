/**
 * Voice Pipeline Test panel (Settings > Developer): exercises each layer
 * — VAD, STT, AI, TTS — independently, using the REAL, currently-
 * configured provider instances (via `core/bootstrap.ts`'s
 * `selectProviders`, the same selection logic the live session uses) —
 * never a mocked "always succeeds" stand-in. A failure here is a real
 * failure of that layer, reported with whatever error the real provider
 * actually raised.
 *
 * Mic is covered by [[MicDiagnostics]] already; wake word has no isolated
 * test button because "isolated" doesn't make sense for it — it's the
 * same recognizer STT uses, just matching different phrases — its status
 * is instead read from the live activity/error feed below.
 */

import { useEffect, useRef, useState } from "react";
import { useSettingsStore } from "../settings/settingsStore";
import { selectProviders } from "../core/bootstrap";
import { AIOrchestrator } from "../ai/orchestrator";
import { eventBus } from "../core/eventBus";
import { useActivityLog } from "../core/activityLog";

type StageStatus = "idle" | "running" | "pass" | "fail";

function StatusDot({ status }: { status: StageStatus }) {
  const color =
    status === "pass" ? "#7fbf7f" : status === "fail" ? "#d95a5a" : status === "running" ? "#d99a3a" : "#666";
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        marginRight: 6,
      }}
    />
  );
}

function useLiveAmplitude(): number {
  const [level, setLevel] = useState(0);
  useEffect(() => eventBus.on("avatar.listening", ({ amplitude }) => setLevel(amplitude)), []);
  return level;
}

export function VoicePipelineTest() {
  const settings = useSettingsStore((s) => s.settings);
  const activity = useActivityLog();

  const [sttStatus, setSttStatus] = useState<StageStatus>("idle");
  const [sttResult, setSttResult] = useState("");
  const [aiStatus, setAiStatus] = useState<StageStatus>("idle");
  const [aiResult, setAiResult] = useState("");
  const [ttsStatus, setTtsStatus] = useState<StageStatus>("idle");
  const [ttsResult, setTtsResult] = useState("");

  const sttStopRef = useRef<(() => void) | null>(null);
  const amplitude = useLiveAmplitude();

  useEffect(() => () => sttStopRef.current?.(), []);

  async function runSttTest() {
    sttStopRef.current?.();
    setSttStatus("running");
    setSttResult("Listening for 8s — say anything…");
    const { sttProvider } = selectProviders(settings);

    const offPartial = sttProvider.onPartial((r) => setSttResult(`(partial) "${r.text}"`));
    const offFinal = sttProvider.onFinal((text) => {
      setSttResult(`"${text}"`);
      setSttStatus("pass");
      cleanup();
    });
    const offError = sttProvider.onError((message) => {
      setSttResult(`error: ${message}`);
      setSttStatus("fail");
      cleanup();
    });
    const timeout = setTimeout(() => {
      if (sttStatus !== "pass") {
        setSttResult((prev) => (prev.startsWith("Listening") ? "timed out — nothing recognized" : prev));
        setSttStatus((prev) => (prev === "running" ? "fail" : prev));
      }
      cleanup();
    }, 8000);

    function cleanup() {
      clearTimeout(timeout);
      offPartial();
      offFinal();
      offError();
      sttProvider.stop().catch(() => {});
      sttStopRef.current = null;
    }
    sttStopRef.current = cleanup;

    try {
      await sttProvider.start();
    } catch (err) {
      setSttResult(`error: ${err instanceof Error ? err.message : String(err)}`);
      setSttStatus("fail");
      cleanup();
    }
  }

  async function runAiTest() {
    setAiStatus("running");
    setAiResult("Sending test request…");
    const { llmProvider } = selectProviders(settings);
    // A throwaway orchestrator: this must not touch the live session's
    // conversation history.
    const orchestrator = new AIOrchestrator(llmProvider);
    try {
      const result = await orchestrator.sendMessage("Say hello in one short sentence.");
      setAiResult(result.text || "(empty response)");
      setAiStatus(result.text ? "pass" : "fail");
    } catch (err) {
      setAiResult(`error: ${err instanceof Error ? err.message : String(err)}`);
      setAiStatus("fail");
    }
  }

  async function runTtsTest() {
    setTtsStatus("running");
    setTtsResult("Speaking…");
    const { ttsProvider } = selectProviders(settings);
    try {
      await ttsProvider.speak("This is a VEYRA voice test.", {
        voiceId: settings.ttsVoiceId ?? undefined,
        rate: settings.ttsRate,
        volume: settings.ttsVolume,
      });
      setTtsResult("playback completed — see log for resolved voice name/gender");
      setTtsStatus("pass");
    } catch (err) {
      setTtsResult(`error: ${err instanceof Error ? err.message : String(err)}`);
      setTtsStatus("fail");
    }
  }

  const wakeActivity = activity.filter((e) => e.kind === "WAKE_DETECTED" || (e.kind === "ERROR" && e.detail.startsWith("wake-word")));

  return (
    <div>
      <div style={{ fontSize: "0.72rem", color: "var(--veyra-white-dim)", marginBottom: 8 }}>
        Uses the real, currently-configured providers — running STT/TTS tests here shares the
        same microphone/speech engine as an active conversation and will interrupt it.
      </div>

      <div className="veyra-field veyra-field--row">
        <label className="veyra-field__label">VAD (live mic amplitude)</label>
        <div style={{ width: 140, height: 8, background: "#1d1113", borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.min(100, amplitude * 100)}%`,
              height: "100%",
              background: amplitude > 0.05 ? "#b02b47" : "#4a0f1f",
              transition: "width 80ms linear",
            }}
          />
        </div>
      </div>

      <div className="veyra-field veyra-field--row">
        <label className="veyra-field__label">
          <StatusDot status={wakeActivity.length > 0 ? "pass" : "idle"} />
          Wake engine ({settings.wakeWordProviderId})
        </label>
        <span style={{ fontSize: "0.75rem", color: "var(--veyra-white-dim)" }}>
          {wakeActivity.length > 0 ? `${wakeActivity.length} event(s) — see activity below` : "no events yet"}
        </span>
      </div>

      <div className="veyra-field">
        <div className="veyra-field--row">
          <label className="veyra-field__label">
            <StatusDot status={sttStatus} />
            STT test ({settings.sttProviderId})
          </label>
          <button onClick={runSttTest} disabled={sttStatus === "running"}>
            Run (8s)
          </button>
        </div>
        {sttResult && <div style={{ fontSize: "0.78rem", color: "var(--veyra-white-dim)", marginTop: 4 }}>{sttResult}</div>}
      </div>

      <div className="veyra-field">
        <div className="veyra-field--row">
          <label className="veyra-field__label">
            <StatusDot status={aiStatus} />
            AI test ({settings.llmProviderId})
          </label>
          <button onClick={runAiTest} disabled={aiStatus === "running"}>
            Run
          </button>
        </div>
        {aiResult && <div style={{ fontSize: "0.78rem", color: "var(--veyra-white-dim)", marginTop: 4 }}>{aiResult}</div>}
      </div>

      <div className="veyra-field">
        <div className="veyra-field--row">
          <label className="veyra-field__label">
            <StatusDot status={ttsStatus} />
            TTS test ({settings.ttsProviderId})
          </label>
          <button onClick={runTtsTest} disabled={ttsStatus === "running"}>
            Run
          </button>
        </div>
        {ttsResult && <div style={{ fontSize: "0.78rem", color: "var(--veyra-white-dim)", marginTop: 4 }}>{ttsResult}</div>}
      </div>
    </div>
  );
}
