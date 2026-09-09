# VEYRA Setup

## Prerequisites

| Tool | Version used in this repo | Notes |
|---|---|---|
| Node.js | 22.x | `npm` comes with it |
| Rust | 1.94 (stable) via `rustup` | |
| Tauri CLI | installed as a dev dependency (`@tauri-apps/cli`) | invoked via `npm run tauri` |

### Linux development machine (this repo was built and tested on one)

Tauri needs system WebKitGTK/GTK libraries to *compile*, even though the
shipping target is Windows:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libxdo-dev build-essential curl wget file libssl-dev
```

(`libxdo-dev` is required by the `enigo` crate's X11 keyboard/mouse backend.)

To also compile-check the Windows-only code paths (window control) from
Linux, add the cross toolchain:

```bash
sudo apt-get install -y mingw-w64 gcc-mingw-w64-x86-64
rustup target add x86_64-pc-windows-gnu
cargo check --manifest-path src-tauri/Cargo.toml --lib --target x86_64-pc-windows-gnu
```

This lets you verify the Windows-specific Rust code compiles without a
Windows machine — it does not let you run it or produce a real installer.
See "Building the real Windows installer" below for that.

### Windows development machine

Install the [Tauri v2 prerequisites for Windows](https://tauri.app/start/prerequisites/)
(Rust + the Visual Studio C++ build tools + WebView2, which ships with
Windows 10/11 by default). No Linux-specific packages needed.

## Install and run

```bash
npm install
npm run tauri dev     # launches the real desktop app with hot reload
```

`npm run dev` alone starts only the Vite dev server (frontend in a regular
browser tab) — useful for fast UI iteration, but the Computer Control Engine
tools won't work outside the Tauri shell since they call `invoke()`.

## Configuration — Settings, not environment variables

VEYRA deliberately does not read API keys from `.env`/environment
variables: they're entered in Settings → AI (persisted locally via SQLite,
under the OS app-data directory — never committed, never logged). This
keeps the "which provider, which key" decision a runtime, per-user choice
rather than a build-time one, consistent with the provider-abstraction
architecture in `VEYRA_ARCHITECTURE.md`.

| Setting | Where | Required for |
|---|---|---|
| Anthropic API key | Settings → AI → Anthropic API key | Real (non-mock) conversational AI. Without it, VEYRA defaults to `MockLLMProvider` (a scripted offline responder) so the rest of the app is fully exercisable with zero configuration. |
| Anthropic model | Settings → AI → Model | Defaults to `claude-sonnet-5`. |
| Wake word / STT / TTS provider | Settings → Voice | Default to the built-in Web Speech-based providers (no key needed). Falls back automatically to the manual/mock providers if `SpeechRecognition` isn't available in the runtime. |

There is no `.env.example` in this repo for that reason — nothing here is
read from process environment variables. If you add a provider that does
need one (e.g. a cloud STT service read from env instead of Settings),
document it here and add a real `.env.example`.

## Running the tests

```bash
# Frontend: type-check + unit tests (Vitest)
npx tsc --noEmit
npx vitest run

# Backend: Rust unit tests + lint
cd src-tauri
cargo test --lib
cargo clippy --all-targets -- -D warnings
```

All of the above are also what `.github/workflows/build-windows.yml` runs
on every push/PR.

## Building the real Windows installer

Tauri's Windows bundler (`.msi` via WiX, `.exe` via NSIS) must run on
Windows. Two ways to get a real installer:

1. **On a Windows machine**, after the prerequisites above:
   ```powershell
   npm install
   npm run tauri build
   ```
   Output lands in `src-tauri/target/release/bundle/msi/` and
   `.../bundle/nsis/`.

2. **CI** — push to `main` or open a PR; `.github/workflows/build-windows.yml`'s
   `build-windows` job runs on `windows-latest` and uploads the installer
   as a build artifact (`veyra-windows-installer`). This is the path used
   during this development pass, since it ran in a Linux container that
   cannot produce a Windows binary bundle itself (it could, and did,
   compile and test the Rust/TypeScript source — see
   `VEYRA_IMPLEMENTATION_PLAN.md` Phase 15).

## First run

1. Launch VEYRA (`npm run tauri dev` or the installed app).
2. Grant microphone access when the OS prompts (Windows Settings → Privacy
   → Microphone, if it doesn't prompt automatically).
3. Check the log line `[VEYRA][CORE] Voice providers selected — wake:
   "..."`. **On Windows/WebView2, this will very likely say
   `"mock-wake-word"`** — WebView2 doesn't implement browser speech
   recognition (see `VEYRA_TROUBLESHOOTING.md`) — in which case skip to
   step 3b. If it says `"web-speech-wake-word"`, try step 3a first.
   - **3a (voice):** Say "Veyra" or "Wake up Veyra" — the avatar should
     transition from Sleeping to Listening.
   - **3b (manual/hotkey — the reliable path on Windows today):** Click
     "Activate VEYRA" on screen, or press `Ctrl+Shift+V` from anywhere.
     Same effect as saying the wake word.
4. Give a command — say it (if STT is working) or type it into the text
   box that appears when speech recognition isn't available, e.g. "what's
   my CPU usage" — VEYRA calls the `get_system_info` tool and speaks the
   answer back.
5. Say "Stop Veyra," press `Ctrl+Shift+V` again, or click "Stop" any time
   to return to Sleeping.
6. Open Settings (bottom bar) to configure a real AI provider, pick a
   voice, adjust rate/volume, review/grant tool permissions, and check
   live microphone diagnostics under Developer.

If no Anthropic API key is configured, step 4 still works end-to-end
against `MockLLMProvider`'s scripted response — useful for confirming the
whole voice pipeline (wake → STT → "LLM" → TTS → avatar) before setting up
a real API key.
