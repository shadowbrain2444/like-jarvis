# VEYRA Architecture

VEYRA is a local-first, voice-driven desktop AI assistant for Windows, built as a
Tauri v2 application: a Rust core with direct OS access, and a React/TypeScript
frontend that owns the voice pipeline, AI orchestration, and 3D avatar.

This document describes what's built (Phases 1–15 of the development order — see
`VEYRA_IMPLEMENTATION_PLAN.md`) and the extension points left for Phase 16+
(browser control, vision, long-term memory, additional skills/integrations).

## Process architecture

```
┌────────────────────────────────────────────────────────────┐
│ VEYRA DESKTOP (Tauri WebView — React UI)                    │
│                                                               │
│  MainScreen                                                  │
│  ├── AvatarScene (React Three Fiber)                         │
│  ├── StatusDisplay                                           │
│  ├── SettingsPanel                                            │
│  └── PerformanceOverlay (dev)                                │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────────────┐
│ VEYRA CORE (TypeScript, runs in the WebView)                  │
│                                                                  │
│  EventBus  (src/core/eventBus.ts)                               │
│  VeyraStateMachine  (src/core/stateMachine.ts)                  │
│  SessionManager  (src/core/sessionManager.ts)                   │
│  AIOrchestrator + ToolRegistry  (src/ai/)                       │
└──────┬───────────────────────────────────────┬─────────────────┘
       │                                       │
       ▼                                       ▼
  VOICE ENGINE (src/voice/)               TOOLS (src/tools/)
  AudioEngine, VAD, WakeWord,             ToolDefinition[] wrapping
  STT, TTS provider interfaces            Tauri `invoke()` calls
       │                                       │
       │ (Web Speech API,                     │ IPC (`@tauri-apps/api/core`)
       │  Web Audio API)                       ▼
       │                          ┌─────────────────────────────────┐
       │                          │ VEYRA CORE (Rust, src-tauri/src) │
       │                          │                                   │
       │                          │  Db (SQLite)                      │
       │                          │  permissions::guard                │
       │                          │  commands::{system,clipboard,      │
       │                          │    input,files,apps,window_control,│
       │                          │    settings}                       │
       │                          └──────────────┬──────────────────────┘
       │                                         ▼
       │                                Windows APIs (user32 via
       │                                windows-rs; enigo; sysinfo;
       │                                arboard; std::fs/process)
       ▼
  OS audio devices (getUserMedia / speechSynthesis)
```

Two processes, two languages, one boundary: **the Tauri IPC bridge**
(`invoke()` on the frontend, `#[tauri::command]` on the backend). Everything
that needs real OS access (files, processes, windows, input, clipboard,
system info, persistent storage) lives in Rust; everything about being an AI
assistant (voice, conversation, avatar) lives in TypeScript. This split is
deliberate: Rust has no business making TTS/LLM streaming decisions, and the
WebView sandbox has no direct OS access at all — it *must* go through Rust.

## Event-driven core (spec section 26)

`src/core/eventBus.ts` is a small typed pub/sub bus (see `VeyraEventMap` in
`src/core/types.ts` for the full event vocabulary: `voice.*`, `wake.*`,
`assistant.*`, `llm.*`, `tts.*`, `avatar.*`, `tool.*`, `performance.*`,
`system.error`). Nothing subscribes to another module's internals — the
avatar reacts to `avatar.state_changed` / `avatar.speaking` without knowing
anything about the TTS provider that ultimately caused them; the performance
overlay reacts to `performance.metric` without knowing anything about the
LLM provider.

## State machine (spec section 6)

`src/core/stateMachine.ts` implements the exact state graph from the spec:

```
SLEEPING → ACTIVE → LISTENING → THINKING → SPEAKING → LISTENING → ...
                        ▲                      │
                        └──────INTERRUPTED◄─────┘
(any active state) → STOPPING → SLEEPING
(any state) → ERROR → (recover) → SLEEPING
```

It is a *pure* FSM: no timers, no audio, no network. Every transition is
validated against an explicit table (`TRANSITIONS`) and an invalid one
throws `InvalidTransitionError` rather than silently corrupting state. Every
successful transition emits `avatar.state_changed` on the event bus. 19
unit tests in `stateMachine.test.ts` cover both wake phrases, the stop
phrase, interruption, and error recovery.

## Session Manager — orchestration (spec section 25)

`src/core/sessionManager.ts` is the only place that decides *when* to
start/stop each voice provider. It owns:

- A [`WakeWordProvider`](#provider-abstractions) instance, listening while `SLEEPING`.
- An [`STTProvider`](#provider-abstractions) instance, listening while `LISTENING`.
- An `EnergyVADProvider` running continuously off raw mic frames
  (`AudioEngine`), used specifically to detect **barge-in**: if the user
  starts talking while VEYRA is `SPEAKING`, VAD fires, TTS is cancelled,
  and VEYRA transitions `SPEAKING → INTERRUPTED → LISTENING` immediately.
- The `AIOrchestrator` and the active `TTSProvider`.

**Known MVP limitation, documented rather than hidden:** because the
Web Speech-backed wake word and STT providers can't reliably run two
concurrent recognition sessions in most WebView engines, only one is ever
active at a time. During `THINKING` (the LLM round-trip), the microphone
isn't being actively transcribed, so "Stop Veyra" said in that narrow
window isn't caught until the response starts `SPEAKING` (at which point
VAD-triggered barge-in catches it). This is a real, working design with a
narrow, documented gap — not a stub.

### Manual/hotkey activation (the actual default on Windows — see below)

`SessionManager` exposes `activateManually()`, `stopManually()`, and
`submitTypedCommand()` alongside the wake-word/STT-driven paths — not as
optional extras, but because on the real shipping target (WebView2) they
are, today, the *primary* way VEYRA activates at all (see "Why Web Speech
API..." below for why). All three drive the exact same state-machine
transitions and `AIOrchestrator`/tool-execution/TTS path a voice-driven
turn would; nothing downstream of activation knows or cares which path
triggered it. `App.tsx` wires `activateManually()` to both a global OS
hotkey (`Ctrl+Shift+V` by default, `src/core/hotkey.ts`, via
`tauri-plugin-global-shortcut`) and an on-screen "Activate VEYRA" button
(`src/ui/ActivationControls.tsx`), and wires `submitTypedCommand()` to a
text-input fallback shown whenever `voice.capability` reports STT is
unavailable.

## Provider abstractions (spec section 4/33/34: "don't hardcode one provider")

Every external capability is an interface first, concrete implementation
second, so a new provider is a new file + one line in `src/core/bootstrap.ts`
— nothing else changes.

| Interface | File | Built-in implementations |
|---|---|---|
| `VADProvider` | `voice/types.ts` | `EnergyVADProvider` (RMS threshold + hysteresis) |
| `WakeWordProvider` | `voice/types.ts` | `WebSpeechWakeWordProvider`, `MockWakeWordProvider` |
| `STTProvider` | `voice/types.ts` | `WebSpeechSTTProvider`, `MockSTTProvider` |
| `TTSProvider` | `voice/types.ts` | `WebSpeechTTSProvider`, `MockTTSProvider` |
| `LLMProvider` | `ai/types.ts` | `AnthropicProvider` (Claude, streaming + native tool use), `MockLLMProvider` |

**Locality is explicit** (`ProviderLocality: "local" | "cloud" | "hybrid"`,
spec section 29): `EnergyVADProvider` and `WebSpeechTTSProvider` are
`"local"` (RMS thresholding and the OS's own TTS voices need no network).
`WebSpeechWakeWordProvider`/`WebSpeechSTTProvider` are marked `"hybrid"` —
they use the WebView's built-in `SpeechRecognition`, which typically routes
audio through the OS/browser's speech service rather than a dedicated
offline neural wake-word model (Porcupine/openWakeWord-class). That's
called out explicitly in the provider's own doc comment rather than
claimed as fully local. `AnthropicProvider` is `"cloud"` and
`requiresApiKey: true`.

### Why Web Speech API as the default, no-API-key providers — and its real limit on Windows

VEYRA needs to work the moment it's launched, with no signup and no paid
API key. `speechSynthesis` (TTS) is genuinely well-supported in WebView2 —
real OS voices, cancellation, rate/volume control, no stub. **`SpeechRecognition`
(STT/wake-word) is not**: confirmed against a real Windows build, WebView2
does not implement it at all (`window.SpeechRecognition` and
`window.webkitSpeechRecognition` are both `undefined`) — this is a
Chromium capability gated behind Google's own cloud infrastructure that
generic Chromium embeddings, WebView2 included, don't have. An earlier
version of this document claimed otherwise; it was wrong, and the fix in
this section is what actually makes the pipeline work as a result.

`core/bootstrap.ts` detects this at runtime
(`isSpeechRecognitionSupported()`) and falls back to
`MockWakeWordProvider`/`MockSTTProvider` — but unlike before, that
fallback is no longer silent: `SessionManager.start()` logs which
providers were actually selected (`Voice providers selected — wake:
"..."`) and warns explicitly when the mock is in play, `bootstrap.ts`
emits `voice.capability` on the event bus so the UI can react, and
`SessionManager`'s manual/hotkey/typed-command entry points (above) are
what actually let you use VEYRA when this fallback is active. Swapping in
Porcupine or another true on-device wake-word engine, a cloud STT
provider, or ElevenLabs for TTS remains exactly what the provider
interfaces exist for; none of it requires touching `SessionManager`,
`AIOrchestrator`, or the avatar.

## AI Orchestrator, Intent Router, Tool Registry (spec sections 3, 11, 17)

`src/ai/orchestrator.ts`'s `AIOrchestrator.sendMessage()` is the whole
turn: it appends to a capped rolling conversation history (short-term
memory, spec section 10 — "do not dump the entire history into every LLM
request"), calls the active `LLMProvider.streamChat()`, and emits
`llm.started` / `llm.first_token` / `llm.token` / `llm.completed` /
`llm.failed` with latencies at each stage.

**Intent routing and planning are delegated to the LLM's native tool use**
rather than a hand-rolled keyword router: `AnthropicProvider` passes every
registered `ToolDefinition` (`src/ai/toolRegistry.ts`) to Claude as a tool,
and when the model responds with `stop_reason: "tool_use"`, the provider
executes the tool(s) via `ToolRegistry.execute()`, feeds the result back as
a `tool_result` block, and loops (bounded to `MAX_TOOL_ROUNDS = 6`) until
the model produces a final answer. This *is* VEYRA's automation engine for
single- and multi-step tool use today — a full `TaskPlanner`/`TaskExecutor`
with explicit task graphs (spec section 17) is a Phase 16+ addition that
would sit in front of `AIOrchestrator`, not replace it.

Every tool call is independently observable and auditable:
`ToolRegistry.execute()` emits `tool.started`/`tool.completed`/`tool.failed`
on the event bus (frontend observability), and the Rust command it
ultimately invokes goes through `permissions::guard()` and writes to the
`audit_log` table (backend observability/security — see below).

## Computer Control Engine (spec section 7)

Lives entirely in Rust (`src-tauri/src/commands/`), reachable from the
frontend only via named Tauri commands, and from the LLM only via the tool
definitions in `src/tools/computerControlSkill.ts` that wrap those commands.

| Module | Capabilities |
|---|---|
| `commands::system` | CPU/RAM/disk/OS info (`sysinfo`) |
| `commands::clipboard` | read/write (`arboard`) |
| `commands::input` | keyboard type/hotkey, mouse move/click/scroll (`enigo`) |
| `commands::files` | list/search/find-latest/create/delete/rename/copy/move/open |
| `commands::apps` | launch/close/list-running/search-installed |
| `commands::window_control` | list/focus/minimize/maximize/restore/move/resize — Windows-only via `windows-rs`; returns `NotSupported` on other OSes so the crate still builds during Linux/macOS development |

All of it goes through `std::process::Command`/`std::fs`/documented Win32
APIs — no shell string interpolation (so no command-injection surface),
no privilege elevation, no UAC/ACL/antivirus bypass. See "Security" below.

## Persistence (spec section 28)

`src-tauri/src/db/` is the *only* module that touches SQL. `Db` wraps a
single `rusqlite::Connection` (WAL mode) behind a mutex, with forward-only,
idempotent migrations (`db/migrations.rs`) tracked in a
`schema_migrations` table. Everything else in the crate calls typed methods
on `Db` (`db/models.rs`) — `get_setting`/`set_setting`,
`get_tool_permission`/`set_tool_permission`, `audit`/`recent_audit`,
`record_metric`. The database file lives under the OS data directory
(`dirs::data_dir()/veyra/veyra.sqlite3` — `%APPDATA%\veyra\veyra.sqlite3`
on Windows).

The frontend's settings schema (`src/settings/settingsStore.ts`) is stored
as a single JSON blob under one settings key — adding a new setting is a
frontend-only change, never a backend migration.

## Security (spec section 20)

- **`permissions::guard(db, tool_name)`** (`src-tauri/src/permissions.rs`)
  is called at the top of every OS-touching command. A small
  `SAFE_BY_DEFAULT` allowlist (read-only tools: `system.info`,
  `clipboard.read`, `files.search`, `files.list`, `apps.list`,
  `windows.list`) runs without a prompt so VEYRA isn't naggy for ordinary
  operations (a UX requirement) — this is a narrow, explicit allowlist, not
  a bypass. Everything else (`files.delete`, `apps.close`,
  `windows.control`, `keyboard.*`, `mouse.*`, `clipboard.write`, ...)
  defaults to **denied** until the user grants it a scope of `allow` from
  Settings → Permissions.
- **Every guard call is audited** (`audit_log` table) regardless of outcome
  — allowed, denied, or errored — with category/action/detail/result.
  Settings → Permissions renders the most recent 25 entries.
- **No elevation, no bypass.** Input simulation goes through `enigo`
  (SendInput on Windows); window control through documented `user32`
  calls; file operations through `std::fs` under the invoking user's own
  permissions. Nothing here escalates privileges, disables UAC, or touches
  antivirus/ACLs.
- **Secrets never touch the log.** The Anthropic API key is read from
  settings and passed straight to the SDK client constructor; it is never
  logged, never included in an audit entry, and the settings field is a
  password input in the UI.

## Avatar (spec sections 22–23)

`src/avatar/` is a stylized, low-poly, procedurally animated
female-presenting head rendered with React Three Fiber
(`AvatarScene.tsx` for the `Canvas`/lighting rig, `AvatarHead.tsx` for the
geometry and per-frame animation). **This is not a licensed/rigged 3D
model** — sourcing and rigging one is out of scope for this pass — but
every animation hook a real GLTF avatar would need is implemented for
real against live state:

- `avatarRuntime.ts` is a plain mutable object (deliberately *not* React
  state) updated by event-bus subscriptions (`avatar.state_changed`,
  `avatar.speaking`, `avatar.listening`) and polled once per rendered
  frame inside `useFrame` — this avoids a React re-render on every audio
  amplitude tick, which would happen dozens of times a second while
  speaking.
- Mouth scale is driven by live TTS amplitude (`SPEAKING`) or held near-
  closed otherwise — genuine amplitude-driven "lip sync," even though
  `speechSynthesis` doesn't expose a real waveform (the amplitude itself
  is a decaying pulse on each word `boundary` event; a cloud TTS provider
  that returns actual audio bytes could and should drive this with a real
  `AnalyserNode` instead — noted in `WebSpeechTTSProvider`'s doc comment).
- Eyes blink on a randomized idle timer (closed while `SLEEPING`).
- The activity ring pulses with listening amplitude, spins while
  `THINKING`, and flashes faster in `ERROR`.
- Small orbiting particles appear only during `THINKING`.
- The whole head has a subtle idle "breathing" scale animation, faster and
  slightly larger while more "alert" (per-state `breathe` constant in
  `avatar/theme.ts`).

Swapping in a real rigged model later means replacing `AvatarHead.tsx`'s
geometry and wiring its morph targets/bones to the same
`avatarRuntime.sample()` calls — the animation *logic* doesn't change.

## Performance monitoring (spec section 5)

`src/performance/latencyMonitor.ts` listens for `performance.metric` on
the event bus (emitted by the orchestrator at `llm.first_token`/
`llm.completed`, and by `SessionManager` at `tts.first_audio`), keeps a
rolling window per metric for the dev overlay
(`src/ui/PerformanceOverlay.tsx`, toggled from Settings → Developer), and
persists every sample to `performance_metrics` via the `metric_record`
command so trends survive a restart.

## What's NOT built yet (Phase 16+, per spec section 32)

These have explicit extension points but no implementation in this pass —
listed here rather than silently omitted:

- **Browser agent** (`BrowserController`/`BrowserSession`/`BrowserTool`):
  no code yet. Would be a new `src/tools/browserSkill.ts` plus a Rust or
  WebDriver-based controller; the tool-registry/orchestrator plumbing
  already supports adding it as more `ToolDefinition`s.
- **Vision** (screenshot capture, OCR, screen understanding): no code yet.
  A `visionSkill.ts` calling a new Rust screenshot command plus a vision
  model provider (local or cloud) would slot in the same way.
- **Long-term/semantic/episodic memory**: only short-term/working memory
  (the orchestrator's capped rolling history) exists. A real memory
  subsystem (embeddings, ranking, retrieval) would run as a step before
  `AIOrchestrator.sendMessage()` calls the LLM, injecting retrieved
  context — noted directly in `ai/orchestrator.ts`'s doc comment.
- **Email, WhatsApp, calendar/tasks, music/media, IoT/smart-home,
  proactive notifications**: no code. Each is a `ToolDefinition[]` module
  plus (where relevant) a provider interface, following the exact pattern
  `computerControlSkill.ts` establishes.
- **`TaskPlanner`/`TaskExecutor` with explicit task graphs**: today,
  multi-step automation happens via the LLM's own tool-use loop
  (bounded, sequential). A dedicated planner with conditional branches,
  retries, and cancellation of individual sub-tasks is future work.

## Directory map

```
src/                        Frontend (TypeScript/React)
  core/                      EventBus, state machine, SessionManager, types
  voice/                     Provider interfaces, AudioEngine, providers/
  ai/                        LLM provider interface, orchestrator, tool registry
  tools/                     ToolDefinition[] skills (computer control today)
  avatar/                    React Three Fiber avatar scene + runtime state
  ui/                        MainScreen, SettingsPanel, StatusDisplay, overlays
  settings/                  Persistent settings store (Zustand + Tauri backend)
  performance/                Latency tracking
  logging/                   Structured [VEYRA][CATEGORY] logger
  styles/                    Maroon/black/white theme (CSS variables)

src-tauri/src/               Backend (Rust)
  commands/                  Tauri commands: system, clipboard, input, files, apps, window_control, settings
  db/                        SQLite connection, migrations, typed models
  permissions.rs             Tool permission guard
  error.rs                   Shared VeyraError -> {code, message}
  state.rs                   AppState (shared Db handle)
  lib.rs                     Builder setup, command registration
```
