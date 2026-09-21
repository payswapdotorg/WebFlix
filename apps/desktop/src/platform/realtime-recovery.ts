/**
 * @wfx/app-desktop — the realtime translation recovery supervisor (R25-W3,
 * the plan's desktop lane "reconnect/recovery" + J43's interruption step).
 *
 * THE LAW THIS SUPERVISOR KEEPS (docs/plans/2026-09-20-webflix-qwen-
 * livetranslate-plan.md R25-L + J43): "a network interruption must NOT
 * restart the media item; recovery restores the translation without losing
 * base playback."
 *
 * HOW THE LAW IS KEPT STRUCTURALLY: the supervisor holds ONLY the
 * realtime translation session handle. It has NO reference to the
 * playback session, the native media port, or the playback controller —
 * there is nothing it COULD restart, pause, or seek. The base playback
 * path is not merely "usually untouched"; the supervisor is incapable of
 * touching it (the structural half of the frozen product law "base
 * playback NEVER waits for translation ... failure falls back to original
 * playback").
 *
 * THE RECOVERY LOOP (bounded, honest, observable):
 * - A session `recoverable-error` (with `requiresReconnect`) — or an
 *   injected transport-loss signal — enters the INTERRUPTED state: the
 *   translated output degrades gracefully (the mixer's original-carries
 *   fallback carries the moments — the mixer is the composition's, this
 *   supervisor only reports the state the composition acts on).
 * - The supervisor drives `session.reconnect()` — THE SESSION'S OWN
 *   operation from the plan's R25-A list — with bounded attempts and
 *   exponential backoff (injectable, deterministic in tests).
 * - A successful reconnect (the session-created event returning, or the
 *   reconnect() promise resolving) answers RECONNECTED; the composition
 *   resumes feeding the capture frames.
 * - A TERMINAL error — or the attempt budget exhausted — answers FAILED:
 *   the composition stops translating and falls back to the original
 *   playback/captions. NEVER a media restart; NEVER a silent give-up
 *   (the failure carries the honest detail + the attempt count).
 *
 * THE ACCOUNTING (the instrument's reconnect evidence): every state
 * transition is timestamped through the injectable clock; the reconnect
 * time is a REAL delta (interrupted-at → reconnected-at), null when
 * never observed — the R24 instrument discipline: never a synthetic
 * pass, null absence, real clocks.
 */

import type {
  RealtimeTranslationEvent,
  RealtimeTranslationSession,
} from "./realtime-translation-port";

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/** The supervisor's closed state vocabulary. */
export type RealtimeRecoveryState =
  | "idle" // no session supervised yet
  | "active" // the session is translating
  | "interrupted" // an interruption is in flight; reconnect attempts pending
  | "reconnected" // the last interruption recovered
  | "failed"; // terminal: translation stopped (base playback continues)

/** One observable recovery transition (the instrument's raw record). */
export interface RecoveryTransition {
  readonly from: RealtimeRecoveryState;
  readonly to: RealtimeRecoveryState;
  readonly atMs: number;
  /** The honest detail (the error text, the attempt verdict). */
  readonly detail: string | null;
}

/** The supervisor's live accounting (the honest statistics). */
export interface RealtimeRecoveryReport {
  readonly state: RealtimeRecoveryState;
  /** Interruptions observed. */
  readonly interruptions: number;
  /** Reconnect attempts issued (this interruption or the last one). */
  readonly reconnectAttempts: number;
  /** The attempt budget (the bound). */
  readonly maxAttempts: number;
  /** Reconnects that recovered the translation. */
  readonly recoveries: number;
  /** Terminal failures (translation stopped; base playback continued). */
  readonly terminalFailures: number;
  /** The last reconnect time (interrupted-at → reconnected-at; null when none). */
  readonly lastReconnectMs: number | null;
  /** The raw transition record (append-only). */
  readonly transitions: readonly RecoveryTransition[];
}

/** Options for {@link createRealtimeRecoverySupervisor}. */
export interface RealtimeRecoverySupervisorOptions {
  /** The session being supervised (subscribe happens here). */
  readonly session: RealtimeTranslationSession;
  /** The clock (every transition stamp; never a hidden wall clock). */
  readonly nowMs: () => number;
  /**
   * The maximum reconnect attempts per interruption before the honest
   * FAILED verdict. Default: 3.
   */
  readonly maxAttempts?: number | undefined;
  /**
   * The backoff schedule, ms per attempt index (attempt 1 waits
   * schedule[0], attempt 2 schedule[1], ...). Default: [250, 1000, 4000].
   */
  readonly backoffMs?: readonly number[];
  /**
   * The reconnect driver — the async seam that calls
   * `session.reconnect()`. Injectable for deterministic tests; the
   * production default drives the session's own operation.
   */
  readonly reconnectDriver?: (session: RealtimeTranslationSession) => Promise<void>;
  /**
   * TEST/EDGE SEAM — the scheduler that runs a callback after `ms`. The
   * production default uses setTimeout; deterministic tests inject a
   * manual pump.
   */
  readonly schedule?: (callback: () => void, ms: number) => void;
}

// ---------------------------------------------------------------------------
// The supervisor
// ---------------------------------------------------------------------------

/** The realtime translation recovery supervisor. */
export interface RealtimeRecoverySupervisor {
  /** Begin supervising (subscribes to the session's events). */
  start(): void;
  /** The live state. */
  state(): RealtimeRecoveryState;
  /**
   * Signal a transport loss OUTSIDE the session's own event vocabulary
   * (e.g. the composition's bridge detected the drop before the session
   * emitted its recoverable error). Same law as a recoverable-error
   * event: interrupted, bounded reconnect, never a media restart.
   */
  notifyTransportLost(detail: string): void;
  /**
   * Pump ONE pending reconnect attempt now (the deterministic tests'
   * driver; in production the schedule seam fires it). No-op when no
   * attempt is pending.
   */
  pumpPendingAttempt(): Promise<void>;
  /** The honest accounting. */
  report(): RealtimeRecoveryReport;
  /** Stop supervising (unsubscribes; the session's close is the composition's). */
  stop(): void;
}

/**
 * Create the realtime translation recovery supervisor. Bounded
 * reconnection through the session's OWN reconnect/resume operation —
 * never a media restart (structurally impossible: no playback handle
 * exists here), never a silent give-up.
 */
export function createRealtimeRecoverySupervisor(
  options: RealtimeRecoverySupervisorOptions,
): RealtimeRecoverySupervisor {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? [250, 1_000, 4_000];
  const reconnectDriver =
    options.reconnectDriver ??
    (async (session: RealtimeTranslationSession): Promise<void> => {
      await session.reconnect();
    });
  const schedule = options.schedule ?? ((callback: () => void, ms: number): void => {
    setTimeout(callback, ms).unref?.();
  });

  let state: RealtimeRecoveryState = "idle";
  let interruptions = 0;
  let reconnectAttempts = 0;
  let recoveries = 0;
  let terminalFailures = 0;
  let lastReconnectMs: number | null = null;
  let interruptedAtMs: number | null = null;
  let transitions: RecoveryTransition[] = [];
  let pendingAttempt = false;
  let unsubscribe: (() => void) | null = null;
  let started = false;

  function transitionTo(next: RealtimeRecoveryState, detail: string | null): void {
    const from = state;
    if (from === next) return;
    state = next;
    transitions.push({ from, to: next, atMs: options.nowMs(), detail });
  }

  function enterInterrupted(detail: string): void {
    if (state === "failed" || state === "idle" || state === "interrupted") return;
    interruptions += 1;
    reconnectAttempts = 0;
    interruptedAtMs = options.nowMs();
    transitionTo("interrupted", detail);
    scheduleNextAttempt();
  }

  function scheduleNextAttempt(): void {
    if (state !== "interrupted") return;
    if (reconnectAttempts >= maxAttempts) {
      // THE HONEST GIVE-UP: the attempt budget is exhausted — translation
      // stops, base playback continues, the failure is reported with the
      // honest detail. NEVER a media restart; NEVER a silent stop.
      terminalFailures += 1;
      transitionTo(
        "failed",
        `reconnect attempts exhausted (${maxAttempts}) — translation stopped; base playback continues`,
      );
      return;
    }
    const waitMs = backoffMs[Math.min(reconnectAttempts, backoffMs.length - 1)] ?? 1_000;
    pendingAttempt = true;
    schedule(() => {
      void pump();
    }, waitMs);
  }

  // The internal pump body continues below (the try/catch of the attempt).
  async function pump(): Promise<void> {
    if (!pendingAttempt || state !== "interrupted") return;
    pendingAttempt = false;
    reconnectAttempts += 1;
    try {
      await reconnectDriver(options.session);
      // Reconnected: the recovery is observed with the REAL delta.
      recoveries += 1;
      if (interruptedAtMs !== null) {
        lastReconnectMs = Math.max(0, options.nowMs() - interruptedAtMs);
        interruptedAtMs = null;
      }
      transitionTo("reconnected", `reconnect attempt ${reconnectAttempts} recovered the session`);
      return;
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      transitionTo("interrupted", `reconnect attempt ${reconnectAttempts} failed: ${detail}`);
      scheduleNextAttempt();
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      unsubscribe = options.session.subscribe((event: RealtimeTranslationEvent): void => {
        switch (event.kind) {
          case "session-created": {
            if (state === "idle") {
              transitionTo("active", `the session was created (${event.sessionId})`);
            } else if (state === "interrupted") {
              // The session's own re-creation ack after a reconnect().
              recoveries += 1;
              if (interruptedAtMs !== null) {
                lastReconnectMs = Math.max(0, options.nowMs() - interruptedAtMs);
                interruptedAtMs = null;
              }
              transitionTo("reconnected", "the session re-created after the interruption");
            }
            return;
          }
          case "recoverable-error": {
            if (event.requiresReconnect || state === "active" || state === "reconnected") {
              enterInterrupted(event.detail);
            }
            return;
          }
          case "terminal-error": {
            terminalFailures += 1;
            transitionTo("failed", event.detail);
            return;
          }
          case "session-closed": {
            transitionTo("idle", `the session closed (${event.reason})`);
            return;
          }
          default:
            return;
        }
      });
      if (state === "idle") {
        // An already-started session: the supervisor is active on start.
        transitionTo("active", "supervision started");
      }
    },

    state(): RealtimeRecoveryState {
      return state;
    },

    notifyTransportLost(detail: string): void {
      enterInterrupted(detail);
    },

    async pumpPendingAttempt(): Promise<void> {
      await pump();
    },

    report(): RealtimeRecoveryReport {
      return {
        state,
        interruptions,
        reconnectAttempts,
        maxAttempts,
        recoveries,
        terminalFailures,
        lastReconnectMs,
        transitions: [...transitions],
      };
    },

    stop(): void {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
