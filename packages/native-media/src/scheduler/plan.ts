/**
 * @wfx/native-media — deadline-aware priority planning (WFX-023, Lane B).
 *
 * `planPriorities` is the PURE scheduling brain: from one session's
 * playback demand it computes WHICH pieces to prioritize WHEN, as a
 * deadline-sorted, batch-capped `PlannedPieceDeadline[]`. No timers, no network,
 * no randomness, no hidden globals — `nowMs` and the network estimate are
 * INJECTED parameters (the estimate defaults to a fixed constant, never a
 * latency probe).
 *
 * The deterministic model (documented for lead review):
 *
 * 1. PIECE TIMELINE. Piece `k` is consumed at timeline position
 *    `positionMs + k * pieceDurationMs` (task packet formula). In REAL
 *    time (at playbackRate r) that is `k * pieceDurationMs / r` ms from
 *    now, so the position anchor cancels in the arithmetic (deadlines are
 *    real-time offsets from now) — `positionMs` is still carried on the
 *    demand for identity/telemetry.
 * 2. NEEDED PIECES. The buffer covers the half-open timeline interval
 *    `[positionMs, positionMs + bufferAheadMs)` at consumption-point
 *    granularity: a piece is NEEDED iff its consumption point lies at or
 *    beyond the buffer edge, i.e. `k >= ceil(bufferAheadMs / D)` where D
 *    is the piece duration. Partially covered pieces whose consumption
 *    point is strictly inside the buffer are treated as satisfied — an
 *    approximation documented in model.ts (no byte-level buffer map
 *    exists on any merged contract).
 * 3. DEADLINES. `deadline(k) = now + consumptionOffsetRealMs / slack -
 *    safetyMarginMs - networkEstimateMs`, clamped up to `now` when
 *    expired (the `late` marker records the clamp; the head piece due at
 *    or before `now` is the IMMEDIATE piece with a hard `now` deadline).
 * 4. FOREGROUND vs BACKGROUND. Foreground (`playing`) sessions plan over
 *    the full horizon. Background (`background`) sessions plan over
 *    `horizon * backgroundRateFactor` (a shorter lookahead — a smaller
 *    bandwidth share) and every background deadline is dilated by
 *    `1 / backgroundRateFactor`: a piece consumed in T ms is granted
 *    `T / factor` ms of slack, mirroring how long it would take to arrive
 *    on a `factor` share of throughput. Background deadlines are therefore
 *    always LATER than the foreground-equivalent deadline for the same
 *    consumption point — background never preempts foreground, and never
 *    exceeds the full horizon either. Non-playing sessions (and paused
 *    rate-0 sessions) need nothing: EMPTY plan.
 * 5. HORIZON LAW. Only pieces whose consumption offset is within the
 *    (tier-scaled) horizon are planned, so every emitted deadline is
 *    `<= now + horizon - margins` — one tick never schedules beyond the
 *    horizon.
 * 6. IDEMPOTENCE. Planning is a pure function of (demand, config, now,
 *    estimate): recomputing with unchanged inputs yields the identical
 *    plan — no drift without clock movement.
 */

import { NativeMediaError } from "../errors";
import {
  DEFAULT_NETWORK_ESTIMATE_MS,
  isConsumingDemand,
  pieceDurationMs,
  priorityForState,
  validatePlaybackDemand,
  validateSchedulerConfig,
  type PlaybackDemand,
  type PlannedPieceDeadline,
  type SchedulerConfig,
} from "./model";

// ---------------------------------------------------------------------------
// Input validation (now / network estimate)
// ---------------------------------------------------------------------------

function requireNonNegativeFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `planPriorities: ${field} must be a finite number >= 0 (got ${String(value)})`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// planPriorities
// ---------------------------------------------------------------------------

/**
 * Compute the deadline-sorted, batch-capped piece plan for ONE session.
 * PURE: same inputs ⇒ same plan, byte for byte.
 *
 * @param demand           the session's playback demand (validated)
 * @param config           complete scheduler config (validated)
 * @param nowMs            the injected current time (finite, >= 0 — an
 *                         epoch-ms clock; also valid for simulated clocks)
 * @param networkEstimateMs INJECTED network estimate (finite, >= 0);
 *                         defaults to the fixed constant
 *                         {@link DEFAULT_NETWORK_ESTIMATE_MS} — never a
 *                         hidden latency probe.
 * @returns the plan: sorted by deadline ascending (ties by piece
 *          ascending), capped at `maxDeadlineBatch`, with the next
 *          immediate piece (deadline <= now) always first when present.
 *          EMPTY for non-playing or paused (rate 0) sessions.
 * @throws NativeMediaError (`INVALID_INPUT`) on malformed demand / config /
 *         nowMs / networkEstimateMs — typed, never a fake default plan.
 */
export function planPriorities(
  demand: PlaybackDemand,
  config: SchedulerConfig,
  nowMs: number,
  networkEstimateMs: number = DEFAULT_NETWORK_ESTIMATE_MS,
): PlannedPieceDeadline[] {
  const d = validatePlaybackDemand(demand);
  const cfg = validateSchedulerConfig(config);
  const now = requireNonNegativeFinite(nowMs, "nowMs");
  const estimate = requireNonNegativeFinite(networkEstimateMs, "networkEstimateMs");

  // Non-playing sessions (paused/complete/failed/resolving/buffering —
  // and rate-0 "paused while playing") need nothing.
  if (!isConsumingDemand(d)) return [];

  const priority = priorityForState(d.state);
  // isConsumingDemand already gates to playing|background, so the tier is
  // foreground or background here; idle never reaches planning.
  const isBackground = priority.tier === "background";

  // Deterministic piece timeline (module docs, rules 1-2).
  const durationMs = pieceDurationMs(d.bitrateBps);
  const firstNeededPiece = Math.ceil(d.bufferAheadMs / durationMs);

  // Tier-scaled horizon + deadline slack dilation (rule 4).
  const horizonTierMs = isBackground
    ? cfg.horizonMs * cfg.backgroundRateFactor
    : cfg.horizonMs;
  const slackDivisor = isBackground ? cfg.backgroundRateFactor : 1;
  const marginMs = cfg.safetyMarginMs + estimate;

  // Closed-form piece range: consumption offset k*D/rate <= horizonTierMs
  // (rule 5). The per-entry guard below is a floating-point belt-and-braces.
  const lastPiece = Math.floor((horizonTierMs * d.playbackRate) / durationMs);

  const entries: PlannedPieceDeadline[] = [];
  for (let k = firstNeededPiece; k <= lastPiece; k += 1) {
    const consumptionOffsetMs = (k * durationMs) / d.playbackRate;
    if (consumptionOffsetMs > horizonTierMs) break;
    const rawDeadlineMs =
      now + consumptionOffsetMs / slackDivisor - marginMs;
    // Clamp expired deadlines up to now (the `late` marker records it);
    // the clamp also guarantees deadlineMs >= 0 for the engine wire shape.
    const deadlineMs = Math.max(rawDeadlineMs, now);
    const late = rawDeadlineMs < now;
    const immediate = k === firstNeededPiece && rawDeadlineMs <= now;
    entries.push({ piece: k, deadlineMs, late, immediate });
  }

  // Sort by (deadline asc, piece asc). Deadlines are non-decreasing in k by
  // construction (the consumption offset strictly grows), so this is a
  // stable confirmation of the contract rather than a reordering — except
  // for clamped-to-now ties, which the piece-ascending key keeps in order.
  entries.sort((a, b) => a.deadlineMs - b.deadlineMs || a.piece - b.piece);

  // Cap AFTER sorting: the immediate piece (always the head when present)
  // survives the cap.
  return entries.length <= cfg.maxDeadlineBatch
    ? entries
    : entries.slice(0, cfg.maxDeadlineBatch);
}
