/**
 * The real, working activation path when voice wake word can't run at all
 * (WebView2 has no `SpeechRecognition` — see `bootstrap.ts`'s
 * `voice.capability` check and `VEYRA_TROUBLESHOOTING.md`). Always
 * rendered, not just as a degraded-mode fallback: the Activate/Stop
 * buttons and the global hotkey work identically whether or not voice
 * wake word is also working, so there's always a way to drive VEYRA.
 */

import { useEffect, useState } from "react";
import { eventBus } from "../core/eventBus";
import { useActiveSession } from "../core/activeSession";
import { useVeyraState } from "../core/useVeyraState";
import { DEFAULT_ACTIVATION_HOTKEY } from "../core/hotkey";

export function ActivationControls() {
  const session = useActiveSession();
  const state = useVeyraState();
  const [capability, setCapability] = useState<{
    speechRecognitionAvailable: boolean;
  } | null>(null);
  const [typedCommand, setTypedCommand] = useState("");

  useEffect(() => {
    return eventBus.on("voice.capability", (payload) => setCapability(payload));
  }, []);

  const speechUnavailable = capability?.speechRecognitionAvailable === false;

  function handleActivate() {
    session?.activateManually().catch(() => {});
  }

  function handleStop() {
    session?.stopManually().catch(() => {});
  }

  function handleSubmitTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typedCommand.trim();
    if (!text || !session) return;
    session.submitTypedCommand(text).catch(() => {});
    setTypedCommand("");
  }

  return (
    <div className="veyra-activation">
      {speechUnavailable && (
        <div className="veyra-capability-banner">
          Voice wake word / speech recognition isn't available on this system. Use Activate
          below, the <kbd>{DEFAULT_ACTIVATION_HOTKEY}</kbd> hotkey, or type a command once
          listening.
        </div>
      )}

      {state === "SLEEPING" ? (
        <button className="veyra-activate-btn" onClick={handleActivate}>
          Activate VEYRA
        </button>
      ) : (
        <button className="veyra-stop-btn" onClick={handleStop}>
          Stop
        </button>
      )}

      {speechUnavailable && state === "LISTENING" && (
        <form className="veyra-typed-command" onSubmit={handleSubmitTyped}>
          <input
            type="text"
            value={typedCommand}
            onChange={(e) => setTypedCommand(e.target.value)}
            placeholder="Type a command…"
            autoFocus
          />
          <button type="submit">Send</button>
        </form>
      )}
    </div>
  );
}
