/**
 * Typed, synchronous, in-process event bus (spec section 26).
 *
 * This is the one channel voice, AI, avatar, tools, and UI use to talk to
 * each other. Nothing subscribes to another module's internals directly —
 * they publish/subscribe events here instead, so e.g. the avatar can react
 * to `tts.first_audio` without importing anything from the TTS provider.
 */

import type { VeyraEventMap, VeyraEventName } from "./types";

type Listener<K extends VeyraEventName> = (payload: VeyraEventMap[K]) => void;

export class EventBus {
  private listeners = new Map<VeyraEventName, Set<Listener<any>>>();

  on<K extends VeyraEventName>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  once<K extends VeyraEventName>(event: K, listener: Listener<K>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends VeyraEventName>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit<K extends VeyraEventName>(event: K, payload: VeyraEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Snapshot before iterating: a listener may unsubscribe itself (or
    // another listener) mid-emit, which must not corrupt this dispatch.
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (err) {
        // A single misbehaving listener must never break the bus for
        // everyone else on this event.
        console.error(`[VEYRA][CORE] listener for "${event}" threw`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Process-wide singleton — every module imports this same instance. */
export const eventBus = new EventBus();
