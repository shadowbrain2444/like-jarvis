/**
 * Safe diagnostic mode (explicitly requested): confirms whether audio
 * frames are actually arriving from the microphone without recording or
 * displaying any of the audio itself — reads only
 * `AudioEngine.getDiagnostics()`'s non-sensitive counters.
 */

import { useEffect, useState } from "react";
import { audioEngine, type AudioDiagnostics } from "../voice/AudioEngine";

export function MicDiagnostics() {
  const [diag, setDiag] = useState<AudioDiagnostics>(audioEngine.getDiagnostics());

  useEffect(() => {
    const interval = setInterval(() => setDiag(audioEngine.getDiagnostics()), 500);
    return () => clearInterval(interval);
  }, []);

  const framesFlowing = diag.capturing && diag.lastFrameAgoMs !== null && diag.lastFrameAgoMs < 1000;

  return (
    <ul className="veyra-audit-list">
      <li>
        <span>Microphone capturing</span>
        <span className={diag.capturing ? "ok" : "denied"}>{diag.capturing ? "yes" : "no"}</span>
      </li>
      <li>
        <span>Device</span>
        <span>{diag.deviceLabel ?? "—"}</span>
      </li>
      <li>
        <span>Frames received</span>
        <span>{diag.framesReceived}</span>
      </li>
      <li>
        <span>Audio flowing right now</span>
        <span className={framesFlowing ? "ok" : "denied"}>{framesFlowing ? "yes" : "no"}</span>
      </li>
    </ul>
  );
}
