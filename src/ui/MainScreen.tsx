/**
 * Main screen layout (spec section 23 mockup): full-bleed avatar stage,
 * centered status/transcript overlay, and a bottom control bar for
 * Status / Voice / Settings.
 */

import { useState } from "react";
import { AvatarScene } from "../avatar/AvatarScene";
import { StatusDisplay } from "./StatusDisplay";
import { SettingsPanel } from "./SettingsPanel";
import { PerformanceOverlay } from "./PerformanceOverlay";
import { useSettingsStore } from "../settings/settingsStore";

type PanelId = "settings" | null;

export function MainScreen() {
  const [openPanel, setOpenPanel] = useState<PanelId>(null);
  const performanceOverlayEnabled = useSettingsStore((s) => s.settings.performanceOverlayEnabled);

  return (
    <div className="veyra-app">
      <div className="veyra-avatar-stage">
        <AvatarScene />
        <StatusDisplay />
        {performanceOverlayEnabled && <PerformanceOverlay />}
        {openPanel === "settings" && <SettingsPanel onClose={() => setOpenPanel(null)} />}
      </div>

      <div className="veyra-bottom-bar">
        {(["Status", "Voice", "Settings"] as const).map((label) => (
          <button
            key={label}
            className={`veyra-bottom-bar__btn${openPanel === "settings" ? " veyra-bottom-bar__btn--active" : ""}`}
            onClick={() => setOpenPanel(openPanel === "settings" ? null : "settings")}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
