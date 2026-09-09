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

export const DEFAULT_ACTIVATION_HOTKEY = "CommandOrControl+Shift+V";

/**
 * Registers the activation hotkey and returns an unregister function.
 * Never throws — if the Tauri plugin isn't available (e.g. running the
 * frontend in a plain browser via `npm run dev`) or the shortcut is
 * already claimed by another app, this logs a warning and returns a no-op
 * cleanup instead of breaking startup.
 */
export async function registerActivationHotkey(
  onPressed: () => void,
  hotkey: string = DEFAULT_ACTIVATION_HOTKEY
): Promise<() => void> {
  try {
    const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await register(hotkey, (event) => {
      if (event.state === "Pressed") onPressed();
    });
    logger.info("CORE", `Global activation hotkey registered: ${hotkey}`);
    return () => {
      unregister(hotkey).catch((err) =>
        logger.warn("CORE", "failed to unregister activation hotkey", err)
      );
    };
  } catch (err) {
    logger.warn(
      "CORE",
      `Global activation hotkey (${hotkey}) unavailable — use the on-screen Activate button instead`,
      err
    );
    return () => {};
  }
}
