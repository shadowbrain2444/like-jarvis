import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBus } from "./eventBus";

// `registerActivationHotkey` loads `@tauri-apps/plugin-global-shortcut` via
// a dynamic `import()` specifically so the app still starts when that
// plugin isn't available (plain-browser dev mode, or — the real-world bug
// this file guards against — a stale `node_modules` missing the package).
// `vi.doMock` + `vi.resetModules()` let each test control exactly what
// that dynamic import resolves to.
//
// `vi.resetModules()` clears vitest's whole module registry, which means
// `eventBus` (a module-level singleton) gets re-instantiated too — so
// each test re-imports `./eventBus` *after* resetting, and uses that
// instance, to stay the same object identity `hotkey.ts`'s own internal
// import resolves to. Importing it statically at the top of this file
// would silently observe a stale, disconnected instance.
async function freshEventBus(): Promise<EventBus> {
  const mod = await import("./eventBus");
  return mod.eventBus;
}

describe("registerActivationHotkey", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@tauri-apps/plugin-global-shortcut");
  });

  it("registers the hotkey and routes 'Pressed' events to the callback", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const unregister = vi.fn().mockResolvedValue(undefined);
    const isRegistered = vi.fn().mockResolvedValue(false);
    vi.doMock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister, isRegistered }));

    const { registerActivationHotkey } = await import("./hotkey");
    const onPressed = vi.fn();
    await registerActivationHotkey(onPressed, "Ctrl+Shift+V");

    expect(register).toHaveBeenCalledWith("Ctrl+Shift+V", expect.any(Function));
    const handler = register.mock.calls[0][1];
    handler({ shortcut: "Ctrl+Shift+V", id: 1, state: "Pressed" });
    expect(onPressed).toHaveBeenCalledTimes(1);

    // A "Released" event (key-up) must not re-trigger activation.
    handler({ shortcut: "Ctrl+Shift+V", id: 1, state: "Released" });
    expect(onPressed).toHaveBeenCalledTimes(1);
  });

  it("unregisters a previously-held registration before registering fresh (no duplicate registration)", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const unregister = vi.fn().mockResolvedValue(undefined);
    const isRegistered = vi.fn().mockResolvedValue(true); // already held
    vi.doMock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister, isRegistered }));

    const { registerActivationHotkey } = await import("./hotkey");
    await registerActivationHotkey(vi.fn(), "Ctrl+Shift+V");

    expect(isRegistered).toHaveBeenCalledWith("Ctrl+Shift+V");
    // unregister must happen before the fresh register call.
    const unregisterOrder = unregister.mock.invocationCallOrder[0];
    const registerOrder = register.mock.invocationCallOrder[0];
    expect(unregisterOrder).toBeLessThan(registerOrder);
  });

  it("the returned cleanup unregisters the hotkey exactly once even if called twice", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const unregister = vi.fn().mockResolvedValue(undefined);
    const isRegistered = vi.fn().mockResolvedValue(false);
    vi.doMock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister, isRegistered }));

    const { registerActivationHotkey } = await import("./hotkey");
    const cleanup = await registerActivationHotkey(vi.fn(), "Ctrl+Shift+V");

    await cleanup();
    await cleanup();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("register() failure (e.g. shortcut claimed by another app) reports system.error and returns a no-op cleanup", async () => {
    const register = vi.fn().mockRejectedValue(new Error("shortcut already registered"));
    const unregister = vi.fn().mockResolvedValue(undefined);
    const isRegistered = vi.fn().mockResolvedValue(false);
    vi.doMock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister, isRegistered }));

    const errorSpy = vi.fn();
    (await freshEventBus()).on("system.error", errorSpy);

    const { registerActivationHotkey } = await import("./hotkey");
    const cleanup = await registerActivationHotkey(vi.fn(), "Ctrl+Shift+V");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "hotkey", recoverable: true })
    );
    await expect(cleanup()).resolves.toBeUndefined(); // safe no-op, doesn't throw
  });

  it("a missing/unresolvable plugin module reports system.error instead of throwing (this is the bug: a stale node_modules must not crash the app)", async () => {
    vi.doMock("@tauri-apps/plugin-global-shortcut", () => {
      throw new Error("Failed to resolve module");
    });

    const errorSpy = vi.fn();
    (await freshEventBus()).on("system.error", errorSpy);

    const { registerActivationHotkey } = await import("./hotkey");
    const cleanup = await registerActivationHotkey(vi.fn(), "Ctrl+Shift+V");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "hotkey", recoverable: true })
    );
    expect(errorSpy.mock.calls[0][0].message).toMatch(/plugin module unavailable/);
    await expect(cleanup()).resolves.toBeUndefined();
  });
});
