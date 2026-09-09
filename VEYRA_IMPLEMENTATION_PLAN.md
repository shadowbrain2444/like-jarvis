# VEYRA Implementation Plan

This tracks the development order from the master spec (section 32) against
what's actually in the repo. "Done" means: real code, compiled/type-checked,
and covered by tests where the phase has meaningful logic to test — not a
stub or a TODO.

## Phase 1 — Repository audit + architecture

**Done.** Repository was empty (no commits) at the start of this pass. See
`VEYRA_ARCHITECTURE.md` for the resulting design.

## Phase 2 — Desktop shell + UI foundation

**Done.** Tauri v2 + React 19 + TypeScript + Vite. `src-tauri/tauri.conf.json`
sets the window title/size/background, a locked-down CSP (only
`api.anthropic.com` as an external `connect-src`), and Windows installer
targets (`msi`, `nsis`). `src/ui/MainScreen.tsx` is the shell: full-bleed
avatar stage, status overlay, bottom control bar, slide-in settings panel.

## Phase 3 — VEYRA state machine + event bus

**Done.** `src/core/eventBus.ts` (typed pub/sub, 8 tests) and
`src/core/stateMachine.ts` (explicit transition table, `InvalidTransitionError`
on an illegal transition, 11 tests covering both wake phrases, the stop
phrase, interruption, and error recovery).

## Phase 4 — Audio engine + microphone

**Done.** `src/voice/AudioEngine.ts`: `getUserMedia` capture, device
enumeration (`listDevices()`), per-frame callback (`onFrame`) for VAD, and
live RMS-based amplitude metering emitted as `avatar.listening` for the
avatar's listening-state reactivity.

## Phase 5 — Wake word

**Done, with an honestly-documented locality caveat.**
`WebSpeechWakeWordProvider` runs the WebView's continuous
`SpeechRecognition` and matches "veyra" / "wake up veyra" / "stop veyra"
against the transcript text, entirely in-process — no audio or transcript
is sent anywhere by VEYRA's own code. It's marked `locality: "hybrid"`
rather than `"local"` because the WebView's recognizer itself typically
routes audio through the OS/browser speech service rather than a dedicated
offline neural wake-word model (Porcupine/openWakeWord-class). A
`MockWakeWordProvider` exists for testing and for use without a
microphone/speech engine at all.

## Phase 6 — Streaming STT

**Done.** `WebSpeechSTTProvider` streams partial and final transcripts from
the same WebView recognizer, via `onPartial`/`onFinal`/`onError` callbacks.

## Phase 7 — AI orchestration + streaming LLM

**Done.** `AnthropicProvider` streams from the Anthropic Messages API with
native tool use (see `VEYRA_ARCHITECTURE.md` "AI Orchestrator..."),
reporting first-token and total latency. `AIOrchestrator` manages a capped
rolling conversation history and emits the full `llm.*` event sequence.
`MockLLMProvider` gives a fully offline, no-API-key path for development
and is what the app defaults to until an Anthropic key is configured.
5 orchestrator tests + 6 tool-registry tests.

## Phase 8 — Streaming TTS + female voice

**Done.** `WebSpeechTTSProvider` uses the OS's own voices (`speechSynthesis`,
fully offline/local), auto-selects the best-available female voice
(name-heuristic matching, configurable in Settings), supports rate/volume/
pitch, and is genuinely cancellable mid-utterance (`cancel()`) — required
for both "Stop Veyra" and barge-in interruption. Amplitude is exposed via
`onAudioLevel` as a decaying pulse per word boundary, feeding both the
avatar's mouth animation and the `tts.first_audio` latency metric.

## Phase 9 — 3D female avatar

**Done, with a documented scope limit.** `src/avatar/` is a stylized,
procedurally animated head (React Three Fiber) reacting in real time to
every assistant state plus live speaking/listening amplitude. It is
**not** a licensed, rigged 3D character model — see
`VEYRA_ARCHITECTURE.md` "Avatar" for exactly what's real (state-driven
material/ring/particles, amplitude-driven mouth, idle blink/breathe) and
what a future rigged-model swap would need to change (geometry + morph
target wiring only, not the animation logic).

## Phase 10 — Avatar/audio synchronization

**Done.** `avatarRuntime.ts` bridges event-bus audio-level events
(`avatar.speaking`, `avatar.listening`) into per-frame amplitude sampling
inside `AvatarHead.tsx`'s `useFrame`, with decay so the mouth/ring settle
smoothly between amplitude updates rather than snapping.

## Phase 11 — Computer Control Engine

**Done** for the capability list in spec section 7 (apps, windows,
keyboard, mouse, files, system, clipboard) — see the Rust module table in
`VEYRA_ARCHITECTURE.md`. Window control is Windows-only
(`windows-rs`/`user32`), with an explicit `NotSupported` fallback on other
OSes so the crate still builds during Linux/macOS development; everything
else (`enigo`, `sysinfo`, `arboard`, `std::fs`/`std::process`) is genuinely
cross-platform. 11 Rust unit tests cover the database layer and the
permission guard (default-safe list, explicit grant/deny, audit-on-every-call).

## Phase 12 — Settings + persistence

**Done.** SQLite (`rusqlite`, bundled — no system SQLite dependency),
WAL mode, idempotent forward-only migrations. Frontend settings persist as
one JSON blob (`settings_get`/`settings_set`); tool permissions and audit
log are structured tables with typed Rust accessors. Verified to survive a
process restart via `migrations_are_idempotent_across_reopen` (opens a
real file-backed DB, writes, closes, reopens, reads back).

## Phase 13 — Performance optimization

**Partially done.** Latency instrumentation exists end-to-end (STT final →
LLM first token → LLM total → TTS first audio → turn total) and is both
displayed live (dev overlay) and persisted (`performance_metrics` table).
Actual *optimization* work (bundle splitting — the frontend build currently
warns about a >500KB chunk dominated by `three`/`@react-three/fiber`;
audio-worklet migration off the deprecated `ScriptProcessorNode`) is not
done in this pass and is called out here rather than silently skipped.

## Phase 14 — Testing + error recovery

**Done** for the layers that exist. 42 TypeScript tests (Vitest) + 11 Rust
tests (`cargo test`), all passing — see `VEYRA_SETUP.md` for how to run
them. Error recovery: `SessionManager.fail()` transitions to `ERROR`,
emits `system.error`, stops any in-flight STT/TTS, and auto-recovers to
`SLEEPING` after a short delay so one failed turn doesn't require an app
restart; a microphone permission denial is caught and logged rather than
crashing startup.

## Phase 15 — Packaging Windows desktop application

**Done, with an execution-environment caveat.** `tauri.conf.json` is
configured for `msi`/`nsis` Windows targets. This development pass ran in a
Linux container, which can and did: compile the full Rust workspace
natively, cross-check every Windows-only code path against the
`x86_64-pc-windows-gnu` target, build and link the complete `veyra` binary,
and build/test/type-check the entire frontend — but it cannot produce or
run an actual `.msi`/`.exe`, since Tauri's Windows bundler needs to run on
Windows. `.github/workflows/build-windows.yml` does that: it runs the same
frontend/Rust checks on Linux, then builds the real installer on
`windows-latest` via `tauri-action`. See `VEYRA_SETUP.md` "Building the
real Windows installer."

## Phase 16+ — Not built in this pass

Browser agent, vision, long-term/semantic/episodic memory, skills beyond
computer control (email, WhatsApp, calendar/tasks, music/media),
`TaskPlanner`/`TaskExecutor` task graphs, proactive notifications, and
IoT/smart-home. Each has a stated extension point in
`VEYRA_ARCHITECTURE.md`'s "What's NOT built yet" section — the point being
that adding any of them is additive (new provider/tool files + one
registration line), not a rewrite of the core.
