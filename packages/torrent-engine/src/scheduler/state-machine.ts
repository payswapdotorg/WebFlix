/**
 * @wfx/torrent-engine — the playback scheduler state machine (R12).
 *
 * THE FIVE STATES (the dispatch's own vocabulary), honest by construction:
 *
 * ```text
 *   idle ──start──> startup ──window satisfied──> steady <──burst satisfied── seeking
 *    │                 │                             │  ▲                       │
 *    │                 └──────────┬─────────────────┼──┴───────────┬───────────┘
 *    └──seek──────────────────────┼─────────────────┘   seek (any live state)
 *                                 ▼                     stop (active states)
 *                        background-completion <─────────┘
 *          background-completion ──start──> startup (playback resumes)
 * ```
 *
 * - `idle`                  — the session is attached but no playback has
 *   been declared. No windows; the library's own selection order IS the
 *   priority (R11's default).
 * - `startup`               — playback declared; the startup window is
 *   pushed at STARTUP urgency until every covering piece is VERIFIED
 *   (first-paint fast). Transitions to `steady` only on that fact — never
 *   on a timer, never on wishful thinking.
 * - `steady`                — playing; the runway window slides with the
 *   playhead. A seek moves to `seeking`.
 * - `seeking`               — a seek target is the most-needed range: a
 *   CRITICAL burst around it, runway re-anchored. Back to `steady` when
 *   the burst's pieces are verified. A re-seek while seeking is legal
 *   (rapid scrubbing is real player behavior; each seek re-anchors).
 * - `background-completion` — playback stopped (or the host paused the
 *   player): windows are CLEARED and the session completes in the
 *   library's own order (J24 background completion). Paused-by-user
 *   torrent sessions also keep completion priority — the scheduler never
 *   fights the R11 pause law.
 *
 * HONESTY LAWS:
 * - Transitions happen on COMMANDS (host-declared playback intent) or on
 *   FACTS (a window's pieces verified against the live bitfield) — never
 *   on timers, never on extrapolation.
 * - An illegal COMMAND from the host is a typed `INVALID_STATE` rejection
 *   at the controller (the host sees the honest refusal); an illegal
 *   INTERNAL hop is a programmer error and throws
 *   `InvalidPlaybackSchedulerTransitionError` (the R11
 *   `InvalidTorrentTransitionError` precedent).
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The playback scheduler states, in lifecycle order. */
export const PLAYBACK_SCHEDULER_STATES = [
  "idle",
  "startup",
  "steady",
  "seeking",
  "background-completion",
] as const;

export type PlaybackSchedulerState = (typeof PLAYBACK_SCHEDULER_STATES)[number];

/** Runtime guard for the state union. */
export function isPlaybackSchedulerState(x: unknown): x is PlaybackSchedulerState {
  return (
    typeof x === "string" &&
    (PLAYBACK_SCHEDULER_STATES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The transition graph
// ---------------------------------------------------------------------------

/**
 * The closed transition graph. `idle` is the birth state (and the detach
 * target); `background-completion` is where stopped playback lands and
 * where resumed playback leaves. Every live state accepts `seeking` and
 * `idle` (detach); the active states accept `background-completion`
 * (stop); `seeking` accepts itself (a re-seek re-anchors the target).
 */
export const ALLOWED_PLAYBACK_SCHEDULER_TRANSITIONS: Readonly<
  Record<PlaybackSchedulerState, readonly PlaybackSchedulerState[]>
> = {
  idle: ["startup", "seeking"],
  startup: ["steady", "seeking", "background-completion", "idle"],
  steady: ["seeking", "background-completion", "idle"],
  seeking: ["steady", "seeking", "background-completion", "idle"],
  "background-completion": ["startup", "seeking", "idle"],
};

/** Predicate: may the scheduler move from `from` to `to`? Total for garbage. */
export function canTransitionPlaybackSchedulerState(
  from: PlaybackSchedulerState,
  to: PlaybackSchedulerState,
): boolean {
  if (!isPlaybackSchedulerState(from) || !isPlaybackSchedulerState(to)) return false;
  const allowed = ALLOWED_PLAYBACK_SCHEDULER_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---------------------------------------------------------------------------
// The FSM (engine-internal)
// ---------------------------------------------------------------------------

/**
 * The per-session playback scheduler FSM. Engine-internal: the controller
 * validates host commands FIRST (typed rejections) and only then drives
 * this machine; an illegal hop reaching `transitionTo` is a programmer
 * error (thrown, the R11 lifecycle precedent).
 */
export class PlaybackSchedulerFsm {
  private current: PlaybackSchedulerState;

  constructor(initial: PlaybackSchedulerState = "idle") {
    if (!isPlaybackSchedulerState(initial)) {
      throw new InvalidPlaybackSchedulerTransitionError("<construction>", String(initial));
    }
    this.current = initial;
  }

  /** The current state. */
  state(): PlaybackSchedulerState {
    return this.current;
  }

  /**
   * Transition to `to`. Throws on an illegal hop (programmer error — the
   * controller must have checked `canTransitionPlaybackSchedulerState`).
   */
  transitionTo(to: PlaybackSchedulerState): void {
    if (!canTransitionPlaybackSchedulerState(this.current, to)) {
      throw new InvalidPlaybackSchedulerTransitionError(this.current, to);
    }
    this.current = to;
  }
}

/**
 * Thrown when the playback scheduler FSM is asked for an illegal hop
 * internally. A programmer error in pure logic — never an enveloped
 * rejection (the R11 `InvalidTorrentTransitionError` precedent).
 * `from`/`to` are plain strings because runtime callers may pass garbage.
 */
export class InvalidPlaybackSchedulerTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `InvalidPlaybackSchedulerTransitionError: playback scheduler state '${from}' cannot transition to '${to}'`,
    );
    this.name = "InvalidPlaybackSchedulerTransitionError";
    this.from = from;
    this.to = to;
  }
}
