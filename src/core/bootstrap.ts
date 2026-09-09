/**
 * Wires concrete providers (chosen from persisted settings) into a
 * [[SessionManager]]. This is the one place that imports every concrete
 * provider class — everything downstream only ever sees the interfaces in
 * `voice/types.ts` / `ai/types.ts`.
 */

import { SessionManager } from "./sessionManager";
import { AIOrchestrator } from "../ai/orchestrator";
import { AnthropicProvider } from "../ai/providers/AnthropicProvider";
import { MockLLMProvider } from "../ai/providers/MockLLMProvider";
import { WebSpeechWakeWordProvider } from "../voice/providers/WebSpeechWakeWordProvider";
import { MockWakeWordProvider } from "../voice/providers/MockWakeWordProvider";
import { WebSpeechSTTProvider } from "../voice/providers/WebSpeechSTTProvider";
import { MockSTTProvider } from "../voice/providers/MockSTTProvider";
import { WebSpeechTTSProvider } from "../voice/providers/WebSpeechTTSProvider";
import { MockTTSProvider } from "../voice/providers/MockTTSProvider";
import type { VeyraSettings } from "../settings/settingsStore";
import { registerBuiltinSkills } from "../tools";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
} from "../voice/providers/webSpeechSupport";
import { eventBus } from "./eventBus";
import { logger } from "../logging/logger";

export function buildSessionManager(settings: VeyraSettings): SessionManager {
  registerBuiltinSkills();

  const speechAvailable = isSpeechRecognitionSupported();
  const synthesisAvailable = isSpeechSynthesisSupported();
  logger.info(
    "VOICE",
    `Runtime speech capability — SpeechRecognition: ${speechAvailable}, speechSynthesis: ${synthesisAvailable}`
  );
  eventBus.emit("voice.capability", {
    speechRecognitionAvailable: speechAvailable,
    speechSynthesisAvailable: synthesisAvailable,
  });

  const wakeWordProvider =
    settings.wakeWordProviderId === "web-speech-wake-word" && speechAvailable
      ? new WebSpeechWakeWordProvider()
      : new MockWakeWordProvider();

  const sttProvider =
    settings.sttProviderId === "web-speech-stt" && speechAvailable
      ? new WebSpeechSTTProvider()
      : new MockSTTProvider();

  const ttsProvider =
    settings.ttsProviderId === "web-speech-tts"
      ? new WebSpeechTTSProvider()
      : new MockTTSProvider();

  const llmProvider =
    settings.llmProviderId === "anthropic" && settings.anthropicApiKey
      ? new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel)
      : new MockLLMProvider();

  const orchestrator = new AIOrchestrator(llmProvider);

  return new SessionManager({
    wakeWordProvider,
    sttProvider,
    ttsProvider,
    orchestrator,
    getTTSOptions: () => ({
      voiceId: settings.ttsVoiceId ?? undefined,
      rate: settings.ttsRate,
      volume: settings.ttsVolume,
    }),
  });
}
