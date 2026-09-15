/**
 * @wfx/native-media — stall guard signal layer (WFX-023, Lane B).
 *
 * `shouldStallProtect` is the PURE typed signal layer that decides whether
 * a session's buffer needs protection, feeding WFX-024 (stall handling)
 * later. It performs NO actions itself — it returns a typed recommendation
 * (`{ protect, reason, suggestedActions }`) so the decision is observable
 * and testable before any policy acts on it.
 *
 * The projection (documented for lead review):
 *
 * 1. DRAIN MODEL. While the NEXT needed piece is in flight for
 *    `networkEstimateMs` real ms, playback consumes
 *    `networkEstimateMs * playbackRate` timeline ms of buffer. The
 *    projected buffer at next-piece arrival is therefore
 *    `bufferAheadMs - networkEstimateMs * playbackRate`. The network
 *    estimate is INJECTED (default: the same fixed constant the planner
 *    uses — never a hidden latency probe).
 * 2. UNDERRUN. The projection underruns the stall budget when it lands
 *    STRICTLY below `stallBudgetMs` (a projection exactly at budget is
 *    healthy). Non-consuming sessions (paused rate-0, or non-playing FSM
 *    states) cannot underrun: `protect: false`.
 * 3. ACTIONS are deterministic, ordered, and never empty when protecting:
 *    - `reduce-bitrate` — a HARD underrun is projected (buffer empties
 *      before arrival): only consuming less closes that gap.
 *    - `pause-prefetch` — the scheduler's own stats show missed deadlines
 *      (`latePieces > 0`) or other sessions hold non-empty plans while
 *      this session projects a hard underrun: shedding prefetch load
 *      frees bandwidth for the at-risk session.
 *    - `extend-horizon` — a SOFT underrun (buffer still positive but
 *      below budget): more lead time absorbs the latency.
 */

import { NativeMediaError } from "../errors";
import {
  DEFAULT_NETWORK_ESTIMATE_MS,
  isConsumingDemand,
  validatePlaybackDemand,
  type PlaybackDemand,
} from "./model";
import type { SchedulerStats } from "./drive";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The typed, ordered remediation hints the stall guard can emit. */
export type StallGuardAction =
  | "reduce-bitrate"
  | "pause-prefetch"
  | "extend-horizon";

/** The typed recommendation — a SIGNAL, never an action. */
export interface StallGuardRecommendation {
  /** True when the projected buffer underruns the stall budget. */
  readonly protect: boolean;
  /** Deterministic human-readable explanation (numbers included). */
  readonly reason: string;
  /** Ordered remediation hints; empty unless `protect` is true. */
  readonly suggestedActions: readonly StallGuardAction[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateStats(stats: SchedulerStats): void {
  if (typeof stats !== "object" || stats === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "shouldStallProtect: stats must be a SchedulerStats object",
    });
  }
  const s = stats as unknown as Record<string, unknown>;
  for (const field of [
    "ticks",
    "piecesScheduled",
    "latePieces",
    "errorCount",
  ] as const) {
    const value = s[field];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new NativeMediaError("INVALID_INPUT", {
        detail: `shouldStallProtect: stats.${field} must be a finite number >= 0 (got ${String(value)})`,
      });
    }
  }
  const lastTickAt = s.lastTickAt;
  if (
    lastTickAt !== null &&
    (typeof lastTickAt !== "number" || !Number.isFinite(lastTickAt))
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `shouldStallProtect: stats.lastTickAt must be a finite number or null (got ${String(lastTickAt)})`,
    });
  }
  if (!(s.perSessionPlanSizes instanceof Map)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "shouldStallProtect: stats.perSessionPlanSizes must be a Map",
    });
  }
  if (!Array.isArray(s.lastErrors)) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "shouldStallProtect: stats.lastErrors must be an array",
    });
  }
}

// ---------------------------------------------------------------------------
// shouldStallProtect
// ---------------------------------------------------------------------------

/**
 * Pure predicate + typed recommendation: does this session's buffer need
 * stall protection? See the module docs for the drain model.
 *
 * @param demand            the session's playback demand (validated)
 * @param stats             the scheduler stats snapshot (validated) —
 *                          supplies the missed-deadline signal
 *                          (`latePieces`) and the other sessions' plan
 *                          sizes (prefetch load).
 * @param networkEstimateMs INJECTED network estimate (finite, >= 0);
 *                          defaults to the fixed planner constant.
 * @throws NativeMediaError (`INVALID_INPUT`) on malformed demand / stats /
 *         estimate — typed, never a fake recommendation.
 */
export function shouldStallProtect(
  demand: PlaybackDemand,
  stats: SchedulerStats,
  networkEstimateMs: number = DEFAULT_NETWORK_ESTIMATE_MS,
): StallGuardRecommendation {
  const d = validatePlaybackDemand(demand);
  validateStats(stats);
  if (
    typeof networkEstimateMs !== "number" ||
    !Number.isFinite(networkEstimateMs) ||
    networkEstimateMs < 0
  ) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `shouldStallProtect: networkEstimateMs must be a finite number >= 0 (got ${String(networkEstimateMs)})`,
    });
  }

  // Non-consuming sessions cannot underrun: nothing drains the buffer.
  if (!isConsumingDemand(d)) {
    return {
      protect: false,
      reason: `session '${d.sessionId}' is not consuming (state '${d.state}', playbackRate ${d.playbackRate}) — no buffer drain, no underrun to protect`,
      suggestedActions: [],
    };
  }

  const drainByArrivalMs = networkEstimateMs * d.playbackRate;
  const projectedBufferMs = d.bufferAheadMs - drainByArrivalMs;

  if (projectedBufferMs >= d.stallBudgetMs) {
    return {
      protect: false,
      reason: `session '${d.sessionId}' healthy: projected buffer ${projectedBufferMs}ms at next-piece arrival meets the ${d.stallBudgetMs}ms stall budget`,
      suggestedActions: [],
    };
  }

  const hardUnderrun = projectedBufferMs < 0;
  const otherSessionsPlanning = [...stats.perSessionPlanSizes].some(
    ([sessionId, planSize]) =>
      sessionId !== d.sessionId && planSize > 0,
  );
  // Deterministic, ordered, never-empty-when-protecting: a hard underrun
  // always emits `reduce-bitrate`, a soft underrun always emits
  // `extend-horizon`, and missed deadlines / competing prefetch plans add
  // `pause-prefetch`.
  const actions: StallGuardAction[] = [];
  if (hardUnderrun) actions.push("reduce-bitrate");
  if (stats.latePieces > 0 || (hardUnderrun && otherSessionsPlanning)) {
    actions.push("pause-prefetch");
  }
  if (!hardUnderrun) actions.push("extend-horizon");

  return {
    protect: true,
    reason:
      `session '${d.sessionId}' projected underrun: buffer ${d.bufferAheadMs}ms drains to ${projectedBufferMs}ms ` +
      `while the next piece is in flight (network estimate ${networkEstimateMs}ms at playbackRate ${d.playbackRate}) ` +
      `— below the ${d.stallBudgetMs}ms stall budget`,
    suggestedActions: actions,
  };
}
