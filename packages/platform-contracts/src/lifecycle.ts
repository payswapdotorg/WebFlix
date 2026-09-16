/**
 * @wfx/platform-contracts — LifecyclePort (R01).
 *
 * The OS lifecycle seam of a platform adapter: the Web adapter maps this to
 * the document visibility/page lifecycle events, the Desktop adapter to the
 * native shell window/focus events, the Mobile adapter to the OS activity
 * lifecycle. The shared client runtime subscribes to persist watch state on
 * `background`, refresh on `resume`, and FLUSH pending at-least-once events
 * on `shutdown` (async shutdown hooks are awaited by the adapter before
 * process exit — the adapter contract below).
 *
 * Honesty law: `phase()` and the emitted events must agree — an adapter
 * never reports `active` after emitting `shutdown`. Occurrence times are
 * epoch milliseconds supplied by the ADAPTER's clock; the runtime never
 * reads a wall clock itself.
 */

import type { Unsubscribe } from "./common";

/** The adapter's coarse lifecycle phase (a poll view of the event stream). */
export type LifecyclePhase =
  /** Constructed, not yet ready to serve the experience. */
  | "initializing"
  /** Foregrounded and interactive. */
  | "active"
  /** Hidden/minimized/deactivated but alive (watch state must be persisted). */
  | "background"
  /** Terminating; async shutdown hooks are drained before exit. */
  | "shutdown";

/** Every value of `LifecyclePhase`, in union order. */
export const LIFECYCLE_PHASES: readonly LifecyclePhase[] = [
  "initializing",
  "active",
  "background",
  "shutdown",
];

/** The lifecycle transition events the port emits. */
export type LifecycleEventKind =
  /** The adapter finished bootstrapping and can serve the experience. */
  | "ready"
  /** The surface left the foreground. */
  | "background"
  /** The surface returned to the foreground (`background`'s counterpart). */
  | "resume"
  /** The adapter is terminating. */
  | "shutdown";

/** Every value of `LifecycleEventKind`, in union order. */
export const LIFECYCLE_EVENT_KINDS: readonly LifecycleEventKind[] = [
  "ready",
  "background",
  "resume",
  "shutdown",
];

/** One lifecycle transition, timestamped by the adapter's clock. */
export interface LifecycleEvent {
  readonly kind: LifecycleEventKind;
  /** Epoch milliseconds (adapter clock) at the transition. */
  readonly occurredAtMs: number;
}

/** Listener for lifecycle transitions. */
export type LifecycleListener = (event: LifecycleEvent) => void;

/**
 * A phase hook. `shutdown` hooks MAY be async: the adapter MUST await them
 * (best effort, bounded by its own shutdown timeout) before terminating —
 * this is how the runtime flushes its at-least-once event outbox on exit.
 */
export type LifecycleHook = (event: LifecycleEvent) => void | Promise<void>;

/**
 * The OS lifecycle port. Adapters implement it; the runtime consumes it.
 *
 * Contract:
 * - `subscribe` listeners are invoked synchronously on transition (or on the
 *   adapter's event-loop turn); every subscription returns an `Unsubscribe`.
 * - `hook(kind, fn)` registers a hook for ONE event kind and returns an
 *   `Unsubscribe`. Registering the same hook twice invokes it twice.
 * - `phase()` is the adapter's truthful current phase; it never disagrees
 *   with the last emitted event.
 */
export interface LifecyclePort {
  /** The adapter's current lifecycle phase. */
  phase(): LifecyclePhase;
  /** Observe every lifecycle transition. */
  subscribe(listener: LifecycleListener): Unsubscribe;
  /**
   * Register a hook for one event kind. Async `shutdown` hooks are awaited
   * by the adapter before termination (see {@link LifecycleHook}).
   */
  hook(kind: LifecycleEventKind, hook: LifecycleHook): Unsubscribe;
}
