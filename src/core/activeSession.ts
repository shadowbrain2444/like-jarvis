/**
 * Exposes the currently-running [[SessionManager]] to UI components
 * without prop-drilling it through the whole tree — same pattern as the
 * `eventBus`/`veyraStateMachine` singletons, except this one really does
 * change identity (rebuilt whenever a provider-affecting setting changes;
 * see `App.tsx`), so it's a tiny external store rather than a constant.
 */

import { useSyncExternalStore } from "react";
import type { SessionManager } from "./sessionManager";

let current: SessionManager | null = null;
const listeners = new Set<() => void>();

export function setActiveSession(session: SessionManager | null): void {
  current = session;
  listeners.forEach((l) => l());
}

export function getActiveSession(): SessionManager | null {
  return current;
}

export function useActiveSession(): SessionManager | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current
  );
}
