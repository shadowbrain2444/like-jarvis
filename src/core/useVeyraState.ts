/**
 * React hook bridging the event-bus-driven state machine into components
 * that *do* need to re-render on state change (status text, settings
 * panel) — as opposed to the avatar scene, which polls
 * [[avatarRuntime]] directly inside `useFrame` to avoid a React re-render
 * on every audio-level tick.
 */

import { useSyncExternalStore } from "react";
import { eventBus } from "./eventBus";
import { veyraStateMachine } from "./stateMachine";
import type { VeyraState } from "./types";

export function useVeyraState(): VeyraState {
  return useSyncExternalStore(
    (onStoreChange) => eventBus.on("avatar.state_changed", onStoreChange),
    () => veyraStateMachine.state
  );
}
