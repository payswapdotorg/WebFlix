/**
 * @wfx/native-media — playback scheduler domain model (WFX-023, Lane B).
 *
 * The typed inputs and outputs of the deadline-aware playback scheduler
 * ("the pure scheduling brain" of the Native Media Service — the frozen
 * architecture names piece prioritization + deadline-aware streaming as
 * first-class service duties). Everything here is PURE and DETERMINISTIC:
 * no timers, no network, no hidden globals — the clock and the network
 * estimate are always INJECTED by the caller (see plan.ts / drive.ts).
 *
 * Design decisions (documented for lead review):
 *
 * 1. PIECE GEOMETRY. `PlaybackDemand` carries `bitrateBps`, not a piece
 *    duration. Pieces are consumed at the deterministic timeline
 *    `positionMs + k * pieceDurationMs` (task packet formula), so the
 *    piece duration is DERIVED from a NOMINAL piece size in bytes
 *    (256 KiB, the BitTorrent-standard default): `pieceDurationMs =
 *    NOMINAL_PIECE_BYTES * 8 * 1000 / bitrateBps`. Higher bitrate ⇒
 *    shorter piece duration. The frozen engine contract exposes no
 *    byte↔piece map, so the nominal size is the only honest constant
 *    available; it is exported for tests and telemetry.
 * 2. PIECE INDICES ARE RELATIVE ORDINALS. `PlannedPieceDeadline.piece` is `k`
 *    from the task formula — the piece ordinal anchored at the CURRENT
 *    playback position (k=0 is the piece whose consumption point is the
 *    current position). Translating to absolute torrent piece indices
 *    requires a byte-offset↔piece map that no merged contract (WFX-004/
 *    014/015) exposes yet; inventing an anchor would be fake precision.
 *    Deferred to the lead / a future work item.
 * 3. `PlaybackDemand.state` (the WFX-004 session FSM state) is carried
 *    because priority is "a deterministic weight per state from the
 *    session FSM": `playing` ⇒ foreground, `background` ⇒ background,
 *    everything else ⇒ idle (nothing needed). The FSM has NO `paused`
 *    state (WFX-004 design note: pause is an engine-level operation);
 *    a paused-but-`playing` session is reported by the host as
 *    `playbackRate: 0`, which naturally yields an EMPTY plan (nothing
 *    is consumed ⇒ nothing is needed).
 * 4. MEDIA END IS UNKNOWN. Neither the frozen `NativeMediaSession` nor
 *    `PlaybackDemand` carries a media duration, so a plan may include
 *    pieces beyond the end of the media when the horizon exceeds the
 *    remaining runtime. The engine owns the real piece count and ignores
 *    out-of-range pieces; capping here would require data nobody provides.
 */

import { NativeMediaError } from "../errors";
import { isSessionState, type SessionState } from "../session";

// ---------------------------------------------------------------------------
// Piece geometry + injected-estimate defaults
// ---------------------------------------------------------------------------

/**
 * Nominal piece size (256 KiB) used to derive piece durations from bitrate.
 * See module docs — design decision 1.
 */
export const NOMINAL_PIECE_BYTES = 262_144;

/**
 * The DEFAULT network estimate injected into deadline computation when the
 * caller does not supply one: a fixed constant, NOT a latency probe. Tests
 * and hosts inject their own estimate through the explicit parameters.
 */
export const DEFAULT_NETWORK_ESTIMATE_MS = 500;

/**
 * Duration of one nominal piece at `bitrateBps`, in timeline milliseconds:
 * `NOMINAL_PIECE_BYTES * 8 * 1000 / bitrateBps`. Pure arithmetic; throws a
 * typed `INVALID_INPUT` error for a non-positive or non-finite bitrate.
 */
export function pieceDurationMs(bitrateBps: number): number {
  if (
    typeof bitrateBps !== "number" ||
    !Number.isFinite(bitrateBps) ||
    bitrateBps <= 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `pieceDurationMs: bitrateBps must be a finite number > 0 (got ${String(bitrateBps)})`,
    });
  }
  return (NOMINAL_PIECE_BYTES * 8 * 1000) / bitrateBps;
}

// ---------------------------------------------------------------------------
// PlaybackDemand
// ---------------------------------------------------------------------------

/**
 * What the host reports about one active playback session. The scheduler's
 * ENTIRE view of the world: playback position + rate, media bitrate, buffer
 * state, and the session's FSM state (see module docs — design decision 3).
 */
export interface PlaybackDemand {
  /** The media session this demand concerns. */
  readonly sessionId: string;
  /** Current WFX-004 session FSM state — drives priority tier. */
  readonly state: SessionState;
  /** Current playback position on the media timeline, in ms. */
  readonly positionMs: number;
  /**
   * Timeline ms consumed per real ms (1 = normal, 2 = 2x, 0.5 = slow-mo).
   * `0` means paused (the FSM has no paused state) — nothing is consumed,
   * so planning yields an empty result.
   */
  readonly playbackRate: number;
  /** Media bitrate in bits per second — sets the piece timeline. */
  readonly bitrateBps: number;
  /** Playable media already buffered AHEAD of the current position, in timeline ms. */
  readonly bufferAheadMs: number;
  /** Buffer headroom the host is willing to tolerate before protecting against stalls, in timeline ms. */
  readonly stallBudgetMs: number;
}

/**
 * Validate a {@link PlaybackDemand} at runtime (total for JS callers and
 * corrupted snapshots). Returns a fresh, well-formed copy — the input is
 * never mutated nor retained. Throws a typed `INVALID_INPUT`
 * `NativeMediaError` on any malformed field; never a fake default-filled
 * demand.
 */
export function validatePlaybackDemand(demand: unknown): PlaybackDemand {
  if (typeof demand !== "object" || demand === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "PlaybackDemand: expected an object",
    });
  }
  const d = demand as Record<string, unknown>;
  const sessionId = d.sessionId;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "PlaybackDemand: sessionId must be a non-empty string",
    });
  }
  const state = d.state;
  if (!isSessionState(state)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `PlaybackDemand: state '${String(state)}' is not a session state`,
    });
  }
  const positionMs = requireFinite(
    d.positionMs,
    "positionMs",
    ">= 0",
    (v) => v >= 0,
  );
  const playbackRate = requireFinite(
    d.playbackRate,
    "playbackRate",
    ">= 0 (0 = paused)",
    (v) => v >= 0,
  );
  const bitrateBps = requireFinite(
    d.bitrateBps,
    "bitrateBps",
    "> 0",
    (v) => v > 0,
  );
  const bufferAheadMs = requireFinite(
    d.bufferAheadMs,
    "bufferAheadMs",
    ">= 0",
    (v) => v >= 0,
  );
  const stallBudgetMs = requireFinite(
    d.stallBudgetMs,
    "stallBudgetMs",
    ">= 0",
    (v) => v >= 0,
  );
  return {
    sessionId,
    state,
    positionMs,
    playbackRate,
    bitrateBps,
    bufferAheadMs,
    stallBudgetMs,
  };
}

function requireFinite(
  value: unknown,
  field: string,
  constraint: string,
  predicate: (v: number) => boolean,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !predicate(value)
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `PlaybackDemand: ${field} must be a finite number ${constraint} (got ${String(value)})`,
    });
  }
  return value;
}

/**
 * Is this demand actually consuming media? Only `playing` and `background`
 * sessions consume (background completion is a frozen-architecture service
 * capability), and only at a positive playback rate — rate 0 is paused.
 */
export function isConsumingDemand(demand: PlaybackDemand): boolean {
  return (
    (demand.state === "playing" || demand.state === "background") &&
    demand.playbackRate > 0
  );
}

// ---------------------------------------------------------------------------
// SessionPriority — deterministic weight per FSM state
// ---------------------------------------------------------------------------

/** The three scheduling tiers, in urgency order. */
export type PriorityTier = "foreground" | "background" | "idle";

/** The deterministic priority of a session, derived from its FSM state. */
export interface SessionPriority {
  readonly tier: PriorityTier;
  readonly weight: number;
}

/**
 * Deterministic priority weight per session FSM state: foreground
 * (`playing`) = 100, background (`background`) = 10, idle states
 * (`resolving`, `buffering`, `complete`, `failed`) = 0. Foreground always
 * outweighs background; idle sessions are never scheduled. The table
 * covers every `SESSION_STATES` member (shape-checked at compile time;
 * the scheduler tests assert the exact values against `SESSION_STATES`).
 */
export const SESSION_PRIORITY_WEIGHTS: { readonly [S in SessionState]: number } = {
  playing: 100,
  background: 10,
  resolving: 0,
  buffering: 0,
  complete: 0,
  failed: 0,
};

/** Derive the deterministic {@link SessionPriority} for a session state. */
export function priorityForState(state: SessionState): SessionPriority {
  const weight = SESSION_PRIORITY_WEIGHTS[state];
  const tier: PriorityTier =
    state === "playing"
      ? "foreground"
      : state === "background"
        ? "background"
        : "idle";
  return { tier, weight };
}

// ---------------------------------------------------------------------------
// SchedulerConfig
// ---------------------------------------------------------------------------

/** Tuning knobs of the playback scheduler. All fields validated. */
export interface SchedulerConfig {
  /**
   * Planning horizon in REAL time: a foreground tick never schedules a
   * piece whose consumption point is further than this many ms ahead.
   * Must be finite > 0. Default: 30_000.
   */
  readonly horizonMs: number;
  /**
   * Safety margin subtracted from every consumption time so pieces are
   * requested BEFORE they are strictly needed. Finite >= 0.
   * Default: 2_000.
   */
  readonly safetyMarginMs: number;
  /**
   * Maximum number of piece deadlines in one session's batch (the plan is
   * capped AFTER sorting — the immediate piece always survives the cap).
   * Safe integer >= 1. Default: 32.
   */
  readonly maxDeadlineBatch: number;
  /**
   * The background tier's share, in (0, 1]: background sessions plan over
   * `horizonMs * backgroundRateFactor` and their deadlines are dilated by
   * `1 / backgroundRateFactor` (a background piece is granted slack
   * mirroring how long it would take to arrive on a `backgroundRateFactor`
   * share of throughput) — background never starves, never preempts
   * foreground. Default: 0.25.
   */
  readonly backgroundRateFactor: number;
}

/** Validated defaults for {@link SchedulerConfig}. */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  horizonMs: 30_000,
  safetyMarginMs: 2_000,
  maxDeadlineBatch: 32,
  backgroundRateFactor: 0.25,
};

/** A partial scheduler config: omitted fields fall back to validated defaults. */
export type SchedulerConfigInput = Partial<SchedulerConfig>;

/**
 * Validate a COMPLETE {@link SchedulerConfig}. Returns a fresh copy.
 * Throws a typed `INVALID_INPUT` `NativeMediaError` on malformed values.
 */
export function validateSchedulerConfig(config: unknown): SchedulerConfig {
  if (typeof config !== "object" || config === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "SchedulerConfig: expected an object",
    });
  }
  const c = config as Record<string, unknown>;
  const horizonMs = c.horizonMs;
  if (
    typeof horizonMs !== "number" ||
    !Number.isFinite(horizonMs) ||
    horizonMs <= 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `SchedulerConfig: horizonMs must be a finite number > 0 (got ${String(horizonMs)})`,
    });
  }
  const safetyMarginMs = c.safetyMarginMs;
  if (
    typeof safetyMarginMs !== "number" ||
    !Number.isFinite(safetyMarginMs) ||
    safetyMarginMs < 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `SchedulerConfig: safetyMarginMs must be a finite number >= 0 (got ${String(safetyMarginMs)})`,
    });
  }
  const maxDeadlineBatch = c.maxDeadlineBatch;
  if (
    typeof maxDeadlineBatch !== "number" ||
    !Number.isSafeInteger(maxDeadlineBatch) ||
    maxDeadlineBatch < 1
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `SchedulerConfig: maxDeadlineBatch must be a safe integer >= 1 (got ${String(maxDeadlineBatch)})`,
    });
  }
  const backgroundRateFactor = c.backgroundRateFactor;
  if (
    typeof backgroundRateFactor !== "number" ||
    !Number.isFinite(backgroundRateFactor) ||
    backgroundRateFactor <= 0 ||
    backgroundRateFactor > 1
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `SchedulerConfig: backgroundRateFactor must be a finite number in (0, 1] (got ${String(backgroundRateFactor)})`,
    });
  }
  return {
    horizonMs,
    safetyMarginMs,
    maxDeadlineBatch,
    backgroundRateFactor,
  };
}

/**
 * Merge a {@link SchedulerConfigInput} over {@link DEFAULT_SCHEDULER_CONFIG}
 * and validate the result. Omitted / undefined fields use the defaults.
 * Throws a typed `INVALID_INPUT` `NativeMediaError` on malformed values.
 */
export function resolveSchedulerConfig(
  input?: SchedulerConfigInput,
): SchedulerConfig {
  // Runtime garbage (strings, arrays, null) is rejected outright — it must
  // never silently resolve to the defaults.
  if (
    input !== undefined &&
    (typeof input !== "object" || input === null || Array.isArray(input))
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `SchedulerConfig: input must be an object when provided (got ${String(input)})`,
    });
  }
  const i = (input ?? {}) as Record<string, unknown>;
  return validateSchedulerConfig({
    horizonMs: i.horizonMs ?? DEFAULT_SCHEDULER_CONFIG.horizonMs,
    safetyMarginMs: i.safetyMarginMs ?? DEFAULT_SCHEDULER_CONFIG.safetyMarginMs,
    maxDeadlineBatch:
      i.maxDeadlineBatch ?? DEFAULT_SCHEDULER_CONFIG.maxDeadlineBatch,
    backgroundRateFactor:
      i.backgroundRateFactor ?? DEFAULT_SCHEDULER_CONFIG.backgroundRateFactor,
  });
}

// ---------------------------------------------------------------------------
// PlannedPieceDeadline
// ---------------------------------------------------------------------------

/**
 * One scheduled piece. This is the plan entry; the engine batch is the
 * `{ piece, deadlineMs }` subset of it (the frozen prioritize wire shape).
 *
 * NAMING NOTE: the task packet calls this type `PieceDeadline`, but
 * WFX-015's gateway/server.ts already exports `PieceDeadline` in THIS
 * package for the identical `{ piece, deadlineMs }` wire shape — a
 * star-export collision. The scheduler's plan entry is therefore named
 * `PlannedPieceDeadline` (the plan SUPERSET carrying the `late` /
 * `immediate` markers); the wire shape itself is structurally identical
 * to the gateway's `PieceDeadline`.
 *
 * - `piece` — the RELATIVE piece ordinal `k` from the playback anchor
 *   (module docs, design decision 2): piece `k` is consumed at timeline
 *   position `positionMs + k * pieceDurationMs`.
 * - `deadlineMs` — ABSOLUTE wall-clock deadline, always >= `nowMs`
 *   (expired deadlines are clamped to `nowMs`) and >= 0, so the value is
 *   always valid for the frozen `engine.prioritize` wire shape.
 * - `late` — the RAW deadline (before clamping) was already expired
 *   (`< nowMs`): the piece should have been scheduled earlier.
 * - `immediate` — this is the NEXT IMMEDIATE piece (the first needed
 *   piece whose raw deadline is `<= nowMs`): it carries a HARD deadline at
 *   exactly `nowMs` and is always the first entry of the plan.
 */
export interface PlannedPieceDeadline {
  readonly piece: number;
  readonly deadlineMs: number;
  readonly late: boolean;
  readonly immediate: boolean;
}
