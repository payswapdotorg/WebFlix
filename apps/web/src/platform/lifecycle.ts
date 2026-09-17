/**
 * @wfx/app-web — the Web LifecyclePort (R07).
 *
 * The OS lifecycle seam of the Web adapter, over the browser's REAL page
 * lifecycle signals:
 *
 * - `visibilitychange` (document hidden ⇄ visible) → `background` ⇄ `resume`
 *   — the runtime persists watch state on `background` and refreshes on
 *   `resume` (the frozen LifecyclePort contract).
 * - `pagehide` (the page is being unloaded) → `shutdown`, and ASYNC SHUTDOWN
 *   HOOKS ARE AWAITED (best effort, bounded) before the browser tears the
 *   page down — this is how the runtime's at-least-once watch-event outbox
 *   flushes on exit. The `pagehide` event is the modern, reliable unload
 *   signal (it fires even when the page goes into the back/forward cache);
 *   `beforeunload` is deliberately NOT used (it is unreliable and
 *   deprecated for this purpose).
 * - `markReady()` — the adapter's boot-completion signal → `ready` +
 *   phase `active`. The composition root calls it after the runtime is
 *   constructed and the first surface is servable.
 *
 * HONESTY LAWS (the port contract):
 * - `phase()` and the emitted events never disagree: an adapter never
 *   reports `active` after emitting `shutdown`.
 * - A boot context with NO document (a server render pass) emits nothing
 *   and stays in `initializing` until `markReady()` — honest absence, never
 *   synthetic visibility events. The shutdown hooks registered by the
 *   runtime still exist (callable via `emit("shutdown")` from a host that
 *   manages its own termination), but no DOM signal fires them server-side.
 * - Occurrence times come from the injected clock seam (the runtime never
 *   reads a wall clock; the adapter supplies real time — here the same
 *   `RuntimeClock` seam, defaulting to the real `Date.now`).
 *
 * Determinism: no randomness, no globals beyond the injected environment;
 * tests drive transitions through the port's own `emit` test pump with a
 * fixed clock.
 */

import type {
  LifecycleEvent,
  LifecycleEventKind,
  LifecycleHook,
  LifecycleListener,
  LifecyclePhase,
  LifecyclePort,
  Unsubscribe,
} from "@wfx/platform-contracts";

import type { RuntimeClock } from "@wfx/client-runtime";

import type { WebEnvironment } from "./environment";

/** The real wall clock (the ONE default time source of this adapter). */
export class WebClock implements RuntimeClock {
  now(): number {
    return Date.now();
  }
}

/** Options for {@link createWebLifecyclePort}. */
export interface WebLifecyclePortOptions {
  /** The environment (default: the real detected one). */
  readonly environment?: WebEnvironment;
  /** The clock stamping event times (default: the real wall clock). */
  readonly clock?: RuntimeClock;
  /**
   * The bound on awaiting async shutdown hooks, in milliseconds (default
   * 3000). The browser will not wait forever for `pagehide` handlers; the
   * adapter bounds its own flush await and proceeds — best effort, by
   * contract.
   */
  readonly shutdownTimeoutMs?: number;
}

/**
 * The Web LifecyclePort. The returned port carries a test pump (`emit`) —
 * the ONLY way tests drive transitions deterministically without a DOM.
 */
export interface WebLifecyclePort extends LifecyclePort {
  /**
   * TEST/HOST PUMP: emit one transition explicitly (the DOM listeners call
   * the same path). Hosts that manage their own termination (a server
   * process shutting down) may emit `shutdown` themselves; the port awaits
   * async hooks with the configured bound. Returns the hooks' outcome.
   */
  emit(kind: LifecycleEventKind): Promise<void>;
  /** The boot-completion signal: `ready` + phase `active`. */
  markReady(): void;
}

/** Create the Web LifecyclePort over the environment's document signals. */
export function createWebLifecyclePort(options: WebLifecyclePortOptions = {}): WebLifecyclePort {
  const environment = options.environment ?? null;
  const clock = options.clock ?? new WebClock();
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 3_000;

  let phase: LifecyclePhase = "initializing";
  let readyEmitted = false;
  const listeners = new Set<LifecycleListener>();
  const hooks = new Map<LifecycleEventKind, Set<LifecycleHook>>();

  function emitTo(listenerSets: Set<LifecycleListener>, event: LifecycleEvent): void {
    for (const listener of listenerSets) listener(event);
  }

  /** Run the hooks of one kind; async hooks are awaited (bounded). */
  async function runHooks(kind: LifecycleEventKind, event: LifecycleEvent): Promise<void> {
    const kindHooks = hooks.get(kind);
    if (kindHooks === undefined || kindHooks.size === 0) return;
    const pending: (void | Promise<void>)[] = [];
    for (const hook of kindHooks) pending.push(hook(event));
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) => {
        setTimeout(resolve, shutdownTimeoutMs);
      }),
    ]);
  }

  async function emit(kind: LifecycleEventKind): Promise<void> {
    const event: LifecycleEvent = { kind, occurredAtMs: clock.now() };
    // Phase agreement law: the phase moves WITH the event, never after.
    if (kind === "ready") phase = "active";
    else if (kind === "background") phase = "background";
    else if (kind === "resume") phase = "active";
    else if (kind === "shutdown") phase = "shutdown";
    emitTo(listeners, event);
    await runHooks(kind, event);
  }

  // — the real DOM wiring (only when a document exists in this context) —
  if (environment?.document !== null && environment?.document !== undefined) {
    const document = environment.document;
    const onVisibilityChange = (): void => {
      // Hidden ⇄ visible maps onto background ⇄ resume — the runtime's
      // persist/refresh signals. Only ACTIVE-phase transitions emit (a
      // hidden prerender before ready is not a background event; the
      // ready signal owns the start of the interactive lifetime).
      if (phase === "initializing" || phase === "shutdown") return;
      if (document.visibilityState === "hidden" && phase === "active") {
        void emit("background");
      } else if (document.visibilityState === "visible" && phase === "background") {
        void emit("resume");
      }
    };
    const onPageHide = (): void => {
      if (phase === "shutdown") return; // exactly once
      void emit("shutdown");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pagehide", onPageHide);
    if (environment.window !== null) {
      // Safari's bfcache age signal complements pagehide for resume flows.
      environment.window.addEventListener("pageshow", onVisibilityChange);
    }
  }

  return {
    phase: () => phase,
    subscribe(listener: LifecycleListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hook(kind: LifecycleEventKind, hook: LifecycleHook): Unsubscribe {
      const set = hooks.get(kind) ?? new Set();
      set.add(hook);
      hooks.set(kind, set);
      return () => {
        set.delete(hook);
      };
    },
    emit,
    markReady(): void {
      if (readyEmitted) return; // exactly once
      readyEmitted = true;
      void emit("ready");
    },
  };
}

