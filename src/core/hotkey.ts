/**
 * Global activation hotkey — the real, working substitute for "say Veyra"
 * on any runtime where wake-word listening can't run at all (see
 * `bootstrap.ts`'s `voice.capability` check and
 * `VEYRA_TROUBLESHOOTING.md`). Always registered, regardless of which
 * wake-word provider ended up active, so it also works as a fast manual
 * override even when voice wake word is working fine.
 *
 * Uses `@tauri-apps/plugin-global-shortcut`'s JS API directly — no
 * Rust-side handler needed, the plugin delivers the key event straight to
 * this callback in the WebView.
 */

import { logger } from "../logging/logger";
import { eventBus } from "./eventBus";

export const DEFAULT_ACTIVATION_HOTKEY = "CommandOrControl+Shift+V";

/**
 * Registers the activation hotkey and returns an unregister function.
 * Never throws — if the Tauri plugin isn't available (e.g. running the
 * frontend in a plain browser via `npm run dev`) or the shortcut is
 * already claimed by another application, this logs and emits
 * `system.error` (so the UI can surface it) rather than breaking startup,
 * and returns a no-op cleanup.
 *
 * Idempotent by construction: always unregisters `hotkey` first (ignoring
 * "not registered" errors) before registering it fresh. That covers both
 * a caller invoking this twice for the same key and a prior registration
 * surviving a hot-reload/rebuild that skipped its own cleanup — either
 * way, `register()` for an already-claimed-by-this-app shortcut would
 * otherwise be a silent no-op on the *new* handler, which would mean a
 * stale closure (e.g. bound to a session that's since been replaced) kept
 * firing instead of the current one.
 */
export async function registerActivationHotkey(
  onPressed: () => void,
  hotkey: string = DEFAULT_ACTIVATION_HOTKEY
): Promise<() => Promise<void>> {
  let plugin: typeof import("@tauri-apps/plugin-global-shortcut");
  try {
    plugin = await import("@tauri-apps/plugin-global-shortcut");
  } catch (err) {
    reportFailure(hotkey, "plugin module unavailable (not running inside the Tauri shell?)", err);
    return async () => {};
  }

  const { register, unregister, isRegistered } = plugin;

  try {
    if (await isRegistered(hotkey)) {
      await unregister(hotkey);
      logger.info("CORE", `Replaced existing registration for ${hotkey} before re-registering`);
    }
  } catch (err) {
    // Non-fatal: proceed to register() below, which will surface any real
    // problem (e.g. the shortcut is held by a *different* application).
    logger.warn("CORE", `Pre-registration cleanup for ${hotkey} failed`, err);
  }

  try {
    await register(hotkey, (event) => {
      if (event.state === "Pressed") onPressed();
    });
    logger.info("CORE", `Global activation hotkey registered: ${hotkey}`);
  } catch (err) {
    reportFailure(hotkey, "registration failed (likely already claimed by another application)", err);
    return async () => {};
  }

  let unregistered = false;
  return async () => {
    if (unregistered) return;
    unregistered = true;
    try {
      await unregister(hotkey);
      logger.info("CORE", `Global activation hotkey unregistered: ${hotkey}`);
    } catch (err) {
      logger.warn("CORE", `failed to unregister activation hotkey ${hotkey}`, err);
    }
  };
}

function reportFailure(hotkey: string, reason: string, err: unknown): void {
  const message = `Global activation hotkey (${hotkey}) unavailable: ${reason}`;
  logger.warn("CORE", message, err);
  eventBus.emit("system.error", { scope: "hotkey", message, recoverable: true });
}
