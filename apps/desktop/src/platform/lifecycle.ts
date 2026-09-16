/**
 * @wfx/app-desktop — LifecyclePort over native window events (R08).
 *
 * The OS lifecycle seam of the Desktop adapter: the native shell's window
 * events (window created + frontend ready, minimized/hidden, restored,
 * close-requested) cross the `ShellIpc` seam and become the frozen
 * `LifecyclePort` vocabulary (`ready` / `background` / `resume` /
 * `shutdown`).
 *
 * THE SHUTDOWN LAW (the adapter contract the runtime depends on):
 *
 * - On the shell's `shutdown` event, the port sets its phase to
 *   `"shutdown"`, emits the event, and DRAINS registered async hooks —
 *   `await`ing each in registration order (the shared client runtime
 *   registers its at-least-once watch-event outbox flush here).
 * - When every hook settles (or throws — a failing hook never blocks the
 *   rest), the port calls `lifecycleShutdownComplete()` so the shell can
 *   exit. The shell independently bounds the wait with its own
 *   `shutdownTimeoutMs` budget (documented, honest teardown).
 * - Phase/event honesty: `phase()` is derived from the last emitted event
 *   — an adapter never reports `active` after emitting `shutdown`, and no
 *   transitions are emitted after `shutdown` (the shell is terminating).
 *
 * Occurrence times come from the SHELL's clock (the native side owns
 * window-event timestamps); the port never reads a wall clock itself.
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

import type { ShellIpc, ShellLifecycleEvent } from "./shell-ipc";

/** The Desktop lifecycle port: the frozen port plus the drain handle. */
export interface ShellLifecyclePort extends LifecyclePort {
  /**
   * Resolves when the shutdown hook drain finished and the shell was
   * released. Deterministic: tests await this instead of timers.
   */
  shutdownSettled(): Promise<void>;
}

/**
 * Build the Desktop `LifecyclePort` over the native shell.
 *
 * The port starts in `"initializing"` and moves with the shell's events:
 * `ready` → `active`, `background` ↔ `resume` toggles, `shutdown` →
 * terminal (hooks drained, then the shell is told teardown is complete).
 */
export function createShellLifecyclePort(shell: ShellIpc): ShellLifecyclePort {
  const listeners = new Set<LifecycleListener>();
  // Hooks are an ARRAY (not a set): registering the same hook twice
  // invokes it twice — the port contract's exact law. Unsubscribe removes
  // ONE registration.
  const hooks = new Map<LifecycleEventKind, LifecycleHook[]>();
  let phase: LifecyclePhase = "initializing";
  let terminated = false;
  let drain: Promise<void> = Promise.resolve();

  function phaseFor(kind: ShellLifecycleEvent["kind"]): LifecyclePhase {
    switch (kind) {
      case "ready":
        return "active";
      case "background":
        return "background";
      case "resume":
        return "active";
      case "shutdown":
        return "shutdown";
    }
  }

  function emit(event: LifecycleEvent): void {
    for (const listener of listeners) listener(event);
  }

  /**
   * Drain the hooks of one kind IN ORDER, awaiting each; a hook that
   * throws is swallowed after its rejection settles (teardown never
   * dead-locks on a failing flush — the failure is visible through the
   * hook's own channel, e.g. the pending-event outbox).
   */
  async function drainHooks(kind: LifecycleEventKind, event: LifecycleEvent): Promise<void> {
    for (const hook of [...(hooks.get(kind) ?? [])]) {
      try {
        await hook(event);
      } catch {
        // A failing flush hook does not block teardown; the at-least-once
        // outbox keeps its pending events visible for the next session.
      }
    }
  }

  const unsubscribeShell = shell.onLifecycleEvent((shellEvent) => {
    if (terminated) return; // no transitions after shutdown (honest terminal)
    const event: LifecycleEvent = {
      kind: shellEvent.kind,
      occurredAtMs: shellEvent.occurredAtMs,
    };
    phase = phaseFor(shellEvent.kind);
    emit(event);
    if (shellEvent.kind === "shutdown") {
      terminated = true;
      unsubscribeShell();
      // Drain async hooks, release the shell, and record settlement.
      drain = (async () => {
        await drainHooks("shutdown", event);
        try {
          await shell.lifecycleShutdownComplete();
        } catch {
          // The shell's bounded timeout is the backstop; a failed release
          // never blocks the already-terminal adapter.
        }
      })();
    } else {
      // Non-shutdown hooks are awaited too (the port contract); the shell
      // event stream already serializes the transitions.
      void drainHooks(shellEvent.kind, event);
    }
  });

  return {
    phase(): LifecyclePhase {
      return phase;
    },
    subscribe(listener: LifecycleListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hook(kind: LifecycleEventKind, hook: LifecycleHook): Unsubscribe {
      const list = hooks.get(kind) ?? [];
      list.push(hook);
      hooks.set(kind, list);
      return () => {
        const current = hooks.get(kind);
        if (current === undefined) return;
        const index = current.indexOf(hook);
        if (index >= 0) current.splice(index, 1);
      };
    },
    shutdownSettled(): Promise<void> {
      return drain;
    },
  };
}
