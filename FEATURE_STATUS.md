# VEYRA Feature Status

Status against the milestone "Definition of Done" (spec section 35) and the
full capability list. Legend: ✅ done and tested · 🟡 done with a documented
limitation · ⬜ not built (Phase 16+, has an extension point).

## Milestone 1 "Definition of Done" checklist

| Requirement | Status | Notes |
|---|---|---|
| Launches as a Windows desktop application | 🟡 | Builds and compiles for Windows (verified via cross-target `cargo check` and a full Rust binary link on Linux); the real `.msi`/`.exe` is produced by CI on `windows-latest` (`.github/workflows/build-windows.yml`) since this pass ran in a Linux container. Not run/clicked on a physical Windows machine. |
| Premium maroon/black/white UI visible | ✅ | `src/styles/theme.css`, `src/avatar/theme.ts` |
| Female 3D avatar visible in the center | 🟡 | Real, animated, state-reactive avatar — procedurally modeled, not a licensed rigged character. See `VEYRA_ARCHITECTURE.md` "Avatar." |
| "Veyra" activates the assistant | ✅ | `WebSpeechWakeWordProvider`, tested via `MockWakeWordProvider` in `sessionManager.test.ts` |
| "Wake up Veyra" activates the assistant | ✅ | Same provider, second phrase |
| "Stop Veyra" stops the assistant | ✅ | Tested: stop phrase as a command, and via the dedicated stop-phrase path |
| VEYRA speaks using a female voice | ✅ | `WebSpeechTTSProvider` auto-selects a female OS voice |
| Voice can be changed from settings | ✅ | Settings → Voice → Voice dropdown |
| Streaming/low-latency recognition + response | ✅ | Partial/final STT, token-streamed LLM, latency tracked at every stage |
| Avatar responds to idle/listening/thinking/speaking | ✅ | `AvatarHead.tsx`, all states incl. sleeping/interrupted/stopping/error |
| Basic local computer-control foundation works | ✅ | 16 tools across files/apps/windows/input/clipboard/system, permission-gated |
| Settings persist after restart | ✅ | SQLite; verified by `migrations_are_idempotent_across_reopen` |
| Failures don't crash the app | ✅ | Mic-permission denial, LLM/STT/TTS errors all caught and routed to `ERROR` state + auto-recovery |
| Automated tests for core state/voice logic | ✅ | 42 Vitest + 11 `cargo test`, all passing |
| Windows production build can be generated | 🟡 | CI produces it; not hand-verified on physical Windows hardware in this pass |

## Full capability breakdown

### Conversational AI
✅ Streaming responses · ✅ multi-turn (rolling history) · ✅ interruption
(barge-in) · ✅ multiple providers (Anthropic + mock, interface-based) ·
✅ model switching (Settings → AI → Model) · ⬜ local LLM provider (interface
supports it; no Ollama-class implementation shipped) · 🟡 personality
(system-prompt-encoded default persona; no separate configurable
personality subsystem)

### Voice system
✅ Female default voice · ✅ voice selection · ✅ provider abstraction ·
🟡 voice preview (selectable in Settings; no explicit "preview" button that
speaks a sample) · ✅ speed/volume · 🟡 language (English default; no
language switch UI, though `SpeechRecognition`/`speechSynthesis` support it)
· ✅ streaming TTS (word-boundary-driven) · ✅ TTS cancellation · ✅ interrupt
speaking · ✅ audio buffering (`AudioEngine`) · ✅ audio device selection
(microphone only — no separate output-device picker) · ✅ VAD · ✅ wake word
detection · ✅ STT provider abstraction · ✅ streaming transcription ·
✅ partial transcript · ✅ final transcript

### Low-latency architecture
✅ Streaming pipeline (partial STT → LLM stream → first token → TTS stream
→ first audio) · ✅ latency tracked at every named stage · ✅ dev-mode
performance overlay

### Wake word system
✅ Deterministic state machine, all 8 states · ✅ both wake phrases + stop
phrase · 🟡 voice-triggered activation depends on the WebView implementing
`SpeechRecognition`, which WebView2 does **not** — confirmed on a real
Windows build. VEYRA detects this at startup and falls back to a fully
functional manual-activation path instead (Activate button, global
`Ctrl+Shift+V` hotkey, typed commands) rather than silently doing nothing;
see `VEYRA_TROUBLESHOOTING.md` "Veyra doesn't wake the assistant" and
`VEYRA_ARCHITECTURE.md` "Manual/hotkey activation." · 🟡 "preferably local" — see locality note in
`VEYRA_ARCHITECTURE.md`; not a dedicated offline neural wake model

### Computer Control Engine
✅ Open/close/list/search applications · ✅ minimize/maximize/restore/move/
resize/focus windows (Windows-only) · ✅ keyboard type + hotkeys · ✅ mouse
move/click/scroll · ✅ file search/open/create/rename/move/copy/delete/
find-latest · ✅ system info (CPU/RAM/disk/OS) · ⬜ brightness control ·
✅ clipboard read/write · 🟡 network/battery info (not exposed as separate
tools yet, though `sysinfo` supports extending `system_info`)

### Browser agent
⬜ Not built. Extension point documented.

### Vision system
⬜ Not built. Extension point documented.

### Memory system
✅ Short-term/working memory (capped rolling conversation history) ·
⬜ long-term, semantic (embeddings), episodic memory

### Skills/plugin system
✅ `ToolDefinition` contract (metadata, description, permission, JSON-schema
input, execution) · ✅ dynamically discoverable by the orchestrator
(`ToolRegistry.list()` passed to the LLM every turn) · ✅ one skill shipped
(computer control, 16 tools) · ⬜ file/browser/email/WhatsApp/calendar/
search/music/vision/automation/smart-home skills

### Internet / web search
⬜ Not built. Extension point: a `SearchProvider` interface + tool, same
pattern as `computerControlSkill.ts`.

### Email, WhatsApp, Music/media, Calendar/tasks, IoT
⬜ Not built. Each has a described extension point in
`VEYRA_ARCHITECTURE.md`.

### Automation engine
🟡 Sequential + bounded-loop tool calling via the LLM's native tool use
(real, working, tested) · ⬜ explicit `TaskPlanner`/`TaskExecutor` with
conditional branches, retries, per-step timeout/cancellation

### Proactive intelligence
⬜ Not built.

### Security architecture
✅ Tool permissions (per-tool grant/ask/deny, persisted) · ✅ audit log
(every guarded call, allowed or denied) · ✅ command validation (e.g. window
action validated before dispatch) · 🟡 credential/secret storage (API key
in the settings JSON blob in SQLite — not OS-keychain-backed yet) ·
⬜ device authorization (no IoT devices exist yet to authorize) ·
⬜ formal tool sandboxing beyond the permission gate

### Personality
🟡 Fixed system-prompt persona (`AnthropicProvider.VEYRA_SYSTEM_PROMPT`);
verbosity setting exists in the schema (`personalityVerbosity`) but isn't
yet wired into the prompt.

### 3D avatar / visual design
✅ All required states · ✅ lip-sync approximation, eye movement (blink),
idle animation, audio-reactive · ✅ maroon/black/white identity, no direct
JARVIS UI copying · ⬜ licensed/rigged 3D model (procedural stand-in today)

### Desktop application / process architecture
✅ Tauri (Rust core + React/TS UI), matching the recommended architecture ·
✅ event bus, state machine, session manager, AI orchestrator, intent
routing (via LLM tool use), tool registry all present and wired

### Configuration / database / offline-first / observability
✅ Centralized settings (frontend schema, Rust storage) · ✅ SQLite with
migrations · ✅ offline-capable core (mock providers + local TTS/wake/STT
require no network; only the Anthropic LLM path needs one, clearly marked
`locality: "cloud"`) · ✅ structured `[VEYRA][CATEGORY]` logging on both
sides, secrets excluded by construction

### Testing
✅ 42 TypeScript unit tests (event bus, state machine, VAD, tool registry,
orchestrator, session manager integration) · ✅ 11 Rust unit tests
(database, permission guard) · ⬜ end-to-end/UI tests (no browser-driven
test harness set up) · ⬜ tests run against a real Windows build (CI builds
it but doesn't yet execute UI tests on it)
