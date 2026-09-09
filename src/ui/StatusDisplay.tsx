/** Center-top title + state label, and the fading last-line transcript (spec section 23 mockup). */

import { useEffect, useState } from "react";
import { useVeyraState } from "../core/useVeyraState";
import { eventBus } from "../core/eventBus";
import type { VeyraState } from "../core/types";

const STATE_LABELS: Record<VeyraState, string> = {
  SLEEPING: "Sleeping — say “Veyra”",
  ACTIVE: "Waking up",
  LISTENING: "Listening…",
  THINKING: "Thinking…",
  SPEAKING: "Speaking",
  INTERRUPTED: "Listening…",
  STOPPING: "Stopping",
  ERROR: "Something went wrong",
};

export function StatusDisplay() {
  const state = useVeyraState();
  const [lastLine, setLastLine] = useState<string | null>(null);

  useEffect(() => {
    const offFinal = eventBus.on("voice.final_transcript", ({ text }) => setLastLine(`“${text}”`));
    const offLLM = eventBus.on("llm.completed", ({ text }) => setLastLine(text));
    return () => {
      offFinal();
      offLLM();
    };
  }, []);

  const active = state !== "SLEEPING";

  return (
    <>
      <div className="veyra-status">
        <h1 className="veyra-status__title">VEYRA</h1>
        <div className={`veyra-status__state${active ? " veyra-status__state--active" : ""}`}>
          {STATE_LABELS[state]}
        </div>
      </div>
      {lastLine && (
        <div className="veyra-transcript">
          <div className="veyra-transcript__line" key={lastLine}>
            {lastLine}
          </div>
        </div>
      )}
    </>
  );
}
