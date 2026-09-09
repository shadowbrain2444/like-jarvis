# VEYRA Troubleshooting

## "Veyra" doesn't wake the assistant

- Check that the OS granted microphone access to the app (Windows Settings
  → Privacy & security → Microphone → make sure desktop apps are allowed
  and VEYRA specifically isn't blocked).
- Open Settings → Voice → Wake word engine. If it's set to "Manual trigger
  (no microphone)", that's `MockWakeWordProvider` — it never listens; it
  only exists for automated tests/no-mic environments. Switch it to
  "Continuous speech keyword spotting."
- Check the console (`npm run tauri dev` prints WebView console output to
  the terminal) for `[VEYRA][WAKE] speech recognition is not available in
  this runtime`. That means the WebView build in use doesn't implement
  `SpeechRecognition` — confirm you're running the actual Tauri shell
  (WebView2 on Windows), not a browser/engine that lacks it.
- Speak clearly and directly into the mic; the wake-word provider is
  transcript-based (see `VEYRA_ARCHITECTURE.md` "Wake word"), so it needs
  a usable transcript, not just any noise.

## VEYRA hears me but never responds ("Thinking..." forever, or silently returns to Listening)

- Settings → AI: confirm a provider is selected. With "Offline scripted
  responder" (the default with no API key), you should always get a canned
  reply — if that's not happening, check the console for an error.
- With "Claude (Anthropic)": confirm the API key is set and valid, and
  check the console for the error surfaced via `system.error`
  (`[VEYRA][ERROR] [orchestrator] ...`). A 401 means a bad/missing key; a
  CORS/network error means outbound HTTPS to `api.anthropic.com` is
  blocked — check your network/proxy and the CSP in `tauri.conf.json`
  (`connect-src` must include `https://api.anthropic.com`).
- Settings → Developer → "Recent activity (audit log)" shows every
  computer-control tool call VEYRA attempted, including denied ones — if
  VEYRA tried to call a tool and got `PERMISSION_DENIED`, grant it under
  Settings → Permissions and try again.

## VEYRA responds but I can't hear anything

- Settings → Voice → Voice output: if set to "Silent (testing)"
  (`MockTTSProvider`), that's intentional — it never plays audio, only
  used for automated tests. Switch to "System voice (offline)."
- Check system output volume and that the correct output device is active
  in Windows sound settings (VEYRA currently uses whatever the OS default
  output device is — Settings → Voice doesn't yet expose separate output
  device selection, only microphone input).
- If a specific voice is selected in Settings → Voice → Voice, and it's no
  longer installed (OS voice pack changed), reset it to "Auto" — the
  Web Speech-based provider re-resolves automatically to the best
  available female voice.

## "Stop Veyra" doesn't stop it, or interruption doesn't work while VEYRA is talking

- This is expected in one narrow window: while VEYRA is in `THINKING`
  (waiting on the LLM), the microphone isn't actively being transcribed —
  see `VEYRA_ARCHITECTURE.md`'s "Known MVP limitation" under Session
  Manager. Wait for VEYRA to start speaking, then say "Stop Veyra" — VAD-
  triggered barge-in will catch it there.
- If it doesn't stop even while VEYRA is speaking: confirm the microphone
  is actually capturing (check the console for
  `[VEYRA][VOICE] microphone capture unavailable`, which means
  `getUserMedia` failed — usually a permission or device issue, same fix
  as the wake-word section above). Barge-in depends on `AudioEngine`
  capturing frames for `EnergyVADProvider`, which is separate from the
  wake-word/STT recognizer.

## Computer-control commands ("open Chrome", "delete that file") don't do anything

- Check Settings → Permissions. Destructive/OS-touching tools (file
  delete/rename/move/copy, app close, window control, keyboard/mouse
  input, clipboard write) default to **denied** until explicitly granted —
  this is intentional (spec section 20: security-by-default). Set the
  relevant tool to "Allow."
- Read-only tools (`system.info`, `clipboard.read`, `files.search`,
  `files.list`, `apps.list`, `windows.list`) work without any grant. If
  even those fail, check the audit log for the actual Rust-side error
  (`DATABASE_ERROR`, `IO_ERROR`, etc. — see `src-tauri/src/error.rs` for
  the full code list).
- Window control tools return `NOT_SUPPORTED` on non-Windows — expected
  during Linux/macOS development; VEYRA's window control is Windows-only
  (`windows-rs`/`user32`).

## Build fails on Linux with `error: linking with 'cc' failed ... unable to find library -lxdo`

Missing `libxdo-dev` (the `enigo` crate's X11 backend dependency):

```bash
sudo apt-get install -y libxdo-dev
```

## Build fails with webkit2gtk/gtk/soup "not found" (pkg-config errors)

Missing the Tauri Linux system dependencies — see
`VEYRA_SETUP.md` → "Linux development machine" for the full `apt-get
install` list.

## `npm run tauri build` on Linux fails or produces nothing useful

Expected: `tauri.conf.json`'s `bundle.targets` is `["msi", "nsis"]` —
Windows-only bundle formats. Tauri's bundler for those must run on Windows.
Use `npm run tauri dev` for local development/testing on Linux (runs the
app without producing an installer), and see `VEYRA_SETUP.md` → "Building
the real Windows installer" for how to get an actual `.msi`/`.exe`.

## Tests fail with jsdom/`getUserMedia` errors

If you see `TypeError: Cannot read properties of undefined (reading
'getUserMedia')` in test output — this is expected and handled, not a
failure: `SessionManager.start()` wraps microphone capture in a try/catch
specifically because `jsdom` (the test environment) has no real media
devices. Check the actual test result (pass/fail), not just console
warnings — the warning is `logger.warn`, not a thrown error.

## Rust `cargo clippy --all-targets -- -D warnings` fails on a fresh checkout

Some lints only appear when both the library and test targets are checked
together (test-only code, like `Db::in_memory()`, is `#[cfg(test)]`-gated).
Always run clippy as `--all-targets`, matching CI
(`.github/workflows/build-windows.yml`), not just `--lib`.
