import { useEffect, useRef } from "react";
import { MainScreen } from "./ui/MainScreen";
import { useSettingsStore } from "./settings/settingsStore";
import { buildSessionManager } from "./core/bootstrap";
import { latencyMonitor } from "./performance/latencyMonitor";
import type { SessionManager } from "./core/sessionManager";
import { logger } from "./logging/logger";
import { setActiveSession } from "./core/activeSession";
import { registerActivationHotkey } from "./core/hotkey";

export default function App() {
  const loaded = useSettingsStore((s) => s.loaded);
  const load = useSettingsStore((s) => s.load);
  const settings = useSettingsStore((s) => s.settings);
  const sessionRef = useRef<SessionManager | null>(null);

  useEffect(() => {
    load();
    latencyMonitor.start();
    return () => latencyMonitor.stop();
  }, [load]);

  // Rebuild the voice/AI pipeline whenever a provider-affecting setting
  // changes; provider *tuning* (rate/volume/voice id) is read live via
  // `getTTSOptions` in bootstrap.ts and doesn't need a rebuild.
  useEffect(() => {
    if (!loaded) return;

    let cancelled = false;
    sessionRef.current?.stop();
    const session = buildSessionManager(settings);
    sessionRef.current = session;
    setActiveSession(session);
    session.start().catch((err) => {
      if (!cancelled) logger.error("CORE", "failed to start session", err);
    });

    // Always registered, independent of which wake-word provider is
    // active: the real, working fallback for "say Veyra" when the WebView
    // can't do speech recognition at all (see hotkey.ts).
    let unregisterHotkey: (() => Promise<void>) | null = null;
    registerActivationHotkey(() => {
      session.activateManually().catch((err) =>
        logger.error("CORE", "manual activation via hotkey failed", err)
      );
    }).then((unregister) => {
      if (cancelled) unregister();
      else unregisterHotkey = unregister;
    });

    return () => {
      cancelled = true;
      unregisterHotkey?.();
      setActiveSession(null);
      session.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loaded,
    settings.wakeWordProviderId,
    settings.sttProviderId,
    settings.ttsProviderId,
    settings.llmProviderId,
    settings.anthropicApiKey,
    settings.anthropicModel,
  ]);

  return <MainScreen />;
}
