/**
 * Persistent settings (spec section 12/27/28). The frontend owns the
 * settings *schema* — Rust just stores whatever JSON blob it's given under
 * one key (`settings_get`/`settings_set` in
 * `src-tauri/src/commands/settings.rs`), so adding a new setting here
 * never requires a backend change or migration.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "../logging/logger";

const SETTINGS_KEY = "veyra.settings.v1";

export interface VeyraSettings {
  // Voice
  wakeWordProviderId: "web-speech-wake-word" | "mock-wake-word";
  sttProviderId: "web-speech-stt" | "mock-stt";
  ttsProviderId: "web-speech-tts" | "mock-tts";
  ttsVoiceId: string | null;
  ttsRate: number;
  ttsVolume: number;
  micDeviceId: string | null;

  // AI
  llmProviderId: "anthropic" | "mock";
  anthropicApiKey: string;
  anthropicModel: string;

  // UX
  performanceOverlayEnabled: boolean;
  personalityVerbosity: "concise" | "balanced" | "detailed";
}

export const DEFAULT_SETTINGS: VeyraSettings = {
  wakeWordProviderId: "web-speech-wake-word",
  sttProviderId: "web-speech-stt",
  ttsProviderId: "web-speech-tts",
  ttsVoiceId: null,
  ttsRate: 1.0,
  ttsVolume: 1.0,
  micDeviceId: null,

  llmProviderId: "mock",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",

  performanceOverlayEnabled: false,
  personalityVerbosity: "balanced",
};

interface SettingsState {
  settings: VeyraSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<VeyraSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const raw = await invoke<string | null>("settings_get", { key: SETTINGS_KEY });
      if (raw) {
        set({ settings: { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch (err) {
      logger.warn("SETTINGS", "failed to load persisted settings, using defaults", err);
      set({ loaded: true });
    }
  },

  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      await invoke("settings_set", { key: SETTINGS_KEY, value: JSON.stringify(next) });
    } catch (err) {
      logger.warn("SETTINGS", "failed to persist settings", err);
    }
  },
}));
