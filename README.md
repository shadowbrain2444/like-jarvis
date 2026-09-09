# VEYRA

A local-first, voice-driven desktop AI assistant for Windows. Say "Veyra"
to wake it, talk to it, watch it think and respond through a live 3D
avatar, and let it control your computer — files, apps, windows, input,
clipboard, system info — through an explicit, permission-gated tool layer.

Built on Tauri v2 (Rust core) + React 19/TypeScript (voice pipeline, AI
orchestration, avatar, UI).

## Documentation

- [`VEYRA_ARCHITECTURE.md`](./VEYRA_ARCHITECTURE.md) — how it's built: process
  architecture, event bus, state machine, provider abstractions, security model.
- [`VEYRA_IMPLEMENTATION_PLAN.md`](./VEYRA_IMPLEMENTATION_PLAN.md) — development
  phases and what's actually done vs. still open.
- [`VEYRA_SETUP.md`](./VEYRA_SETUP.md) — prerequisites, running it, running
  the tests, building the real Windows installer.
- [`VEYRA_TROUBLESHOOTING.md`](./VEYRA_TROUBLESHOOTING.md) — common problems
  and fixes.
- [`FEATURE_STATUS.md`](./FEATURE_STATUS.md) — full capability checklist
  against the original spec.

## Quick start

```bash
npm install
npm run tauri dev
```

Say "Veyra" or "Wake up Veyra" to activate; "Stop Veyra" to stop. Works
fully offline out of the box (mock AI provider, local wake/STT/TTS); add a
real Anthropic API key in Settings → AI for genuine conversational
responses. See `VEYRA_SETUP.md` for details.

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
