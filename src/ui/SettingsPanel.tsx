/**
 * Settings panel (spec section 4/12/20/23): voice provider selection,
 * voice tuning, AI provider + API key, and per-tool permission grants.
 * Everything here reads/writes through `settingsStore` (frontend schema,
 * persisted as one JSON blob) or the permission/audit Tauri commands
 * (Rust-owned, per-tool).
 */

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../settings/settingsStore";
import { WebSpeechTTSProvider } from "../voice/providers/WebSpeechTTSProvider";
import { audioEngine } from "../voice/AudioEngine";
import type { TTSVoiceInfo } from "../voice/types";
import type { AudioDeviceInfo } from "../voice/types";
import type { AuditEntry, PermissionScope } from "../core/backendTypes";
import { MicDiagnostics } from "./MicDiagnostics";

const DESTRUCTIVE_TOOLS = [
  "files.delete",
  "files.rename",
  "files.copy",
  "files.move",
  "files.create",
  "apps.close",
  "windows.control",
  "keyboard.type",
  "keyboard.hotkey",
  "mouse.click",
  "mouse.move",
  "mouse.scroll",
  "clipboard.write",
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettingsStore();
  const [voices, setVoices] = useState<TTSVoiceInfo[]>([]);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissions, setPermissions] = useState<Record<string, PermissionScope>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const ttsForVoiceList = useMemo(() => new WebSpeechTTSProvider(), []);

  useEffect(() => {
    ttsForVoiceList.listVoices().then(setVoices).catch(() => setVoices([]));
    audioEngine.listDevices().then(setDevices).catch(() => setDevices([]));
    invoke<AuditEntry[]>("audit_recent", { limit: 25 })
      .then(setAudit)
      .catch(() => setAudit([]));

    Promise.all(
      DESTRUCTIVE_TOOLS.map((name) =>
        invoke<PermissionScope>("permission_get", { toolName: name }).then(
          (scope) => [name, scope] as const
        )
      )
    ).then((entries) => setPermissions(Object.fromEntries(entries)));
  }, [ttsForVoiceList]);

  async function setPermission(toolName: string, scope: PermissionScope) {
    await invoke("permission_set", { toolName, scope });
    setPermissions((prev) => ({ ...prev, [toolName]: scope }));
  }

  return (
    <div className="veyra-panel" onClick={onClose}>
      <div className="veyra-panel__card" onClick={(e) => e.stopPropagation()}>
        <div className="veyra-panel__header">
          <h2 className="veyra-panel__title">Settings</h2>
          <button className="veyra-panel__close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="veyra-section-label">Voice</div>

        <div className="veyra-field">
          <label className="veyra-field__label">Wake word engine</label>
          <select
            value={settings.wakeWordProviderId}
            onChange={(e) => update({ wakeWordProviderId: e.target.value as typeof settings.wakeWordProviderId })}
          >
            <option value="web-speech-wake-word">Continuous speech keyword spotting</option>
            <option value="mock-wake-word">Manual trigger (no microphone)</option>
          </select>
        </div>

        <div className="veyra-field">
          <label className="veyra-field__label">Speech recognition</label>
          <select
            value={settings.sttProviderId}
            onChange={(e) => update({ sttProviderId: e.target.value as typeof settings.sttProviderId })}
          >
            <option value="web-speech-stt">Browser speech recognition</option>
            <option value="mock-stt">Manual text input</option>
          </select>
        </div>

        <div className="veyra-field">
          <label className="veyra-field__label">Voice output</label>
          <select
            value={settings.ttsProviderId}
            onChange={(e) => update({ ttsProviderId: e.target.value as typeof settings.ttsProviderId })}
          >
            <option value="web-speech-tts">System voice (offline)</option>
            <option value="mock-tts">Silent (testing)</option>
          </select>
        </div>

        {settings.ttsProviderId === "web-speech-tts" && (
          <div className="veyra-field">
            <label className="veyra-field__label">Voice</label>
            <select
              value={settings.ttsVoiceId ?? ""}
              onChange={(e) => update({ ttsVoiceId: e.target.value || null })}
            >
              <option value="">Auto (best available female voice)</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.lang}
                  {v.gender !== "unknown" ? `, ${v.gender}` : ""})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="veyra-field">
          <label className="veyra-field__label">Speaking rate ({settings.ttsRate.toFixed(2)}x)</label>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={settings.ttsRate}
            onChange={(e) => update({ ttsRate: Number(e.target.value) })}
          />
        </div>

        <div className="veyra-field">
          <label className="veyra-field__label">Volume ({Math.round(settings.ttsVolume * 100)}%)</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.ttsVolume}
            onChange={(e) => update({ ttsVolume: Number(e.target.value) })}
          />
        </div>

        <div className="veyra-field">
          <label className="veyra-field__label">Microphone</label>
          <select
            value={settings.micDeviceId ?? ""}
            onChange={(e) => update({ micDeviceId: e.target.value || null })}
          >
            <option value="">System default</option>
            {devices
              .filter((d) => d.kind === "audioinput")
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
          </select>
        </div>

        <div className="veyra-section-label">AI</div>

        <div className="veyra-field">
          <label className="veyra-field__label">Provider</label>
          <select
            value={settings.llmProviderId}
            onChange={(e) => update({ llmProviderId: e.target.value as typeof settings.llmProviderId })}
          >
            <option value="mock">Offline scripted responder (no API key needed)</option>
            <option value="anthropic">Claude (Anthropic — cloud)</option>
          </select>
        </div>

        {settings.llmProviderId === "anthropic" && (
          <>
            <div className="veyra-field">
              <label className="veyra-field__label">Anthropic API key</label>
              <input
                type="password"
                value={settings.anthropicApiKey}
                onChange={(e) => update({ anthropicApiKey: e.target.value })}
                placeholder="sk-ant-..."
                autoComplete="off"
              />
            </div>
            <div className="veyra-field">
              <label className="veyra-field__label">Model</label>
              <input
                type="text"
                value={settings.anthropicModel}
                onChange={(e) => update({ anthropicModel: e.target.value })}
              />
            </div>
          </>
        )}

        <div className="veyra-section-label">Permissions</div>
        {DESTRUCTIVE_TOOLS.map((name) => (
          <div className="veyra-field veyra-field--row" key={name}>
            <label className="veyra-field__label">{name}</label>
            <select
              style={{ width: 140 }}
              value={permissions[name] ?? "ask"}
              onChange={(e) => setPermission(name, e.target.value as PermissionScope)}
            >
              <option value="ask">Ask / default-safe</option>
              <option value="allow">Allow</option>
              <option value="denied">Deny</option>
            </select>
          </div>
        ))}

        <div className="veyra-section-label">Developer</div>
        <div className="veyra-field veyra-field--row">
          <label className="veyra-field__label">Performance overlay</label>
          <input
            type="checkbox"
            checked={settings.performanceOverlayEnabled}
            onChange={(e) => update({ performanceOverlayEnabled: e.target.checked })}
          />
        </div>

        <div className="veyra-field">
          <label className="veyra-field__label">Microphone diagnostics</label>
          <MicDiagnostics />
        </div>

        <div className="veyra-field">
          <label className="veyra-field__label">Recent activity (audit log)</label>
          <ul className="veyra-audit-list">
            {audit.length === 0 && <li>No activity yet.</li>}
            {audit.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.category} / {entry.action}
                </span>
                <span className={entry.result}>{entry.result}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
