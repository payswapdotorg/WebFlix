/**
 * Recommendation OS — intent-aware diversity (WFX-021, Lane A).
 *
 * `diversify(ranked, intents, policy)` — the fifth pipeline stage: greedy
 * re-ranking that prevents topic/intent monoculture WITHOUT ever deleting a
 * candidate (reorder/demote only — the anti-tunnel-vision law: the pool
 * stays wide; demotion with trace reasons is the only soft-exclusion
 * mechanism).
 *
 * Two mechanisms, both deterministic formulas of the policy exploration
 * dial (documented, tested):
 *
 * 1. RUN CAP (K): no more than K consecutive cards sharing the same
 *    dominant matched objective.
 *       K(exploration) = 1 + floor((1 - exploration) * (K_MAX - K_MIN))
 *    clamped to [K_MIN, K_MAX] = [1, 5]: exploration 0 -> K=5 (tolerant),
 *    0.2 -> 4, 0.5 -> 3, 0.75 -> 2, 1 -> 1 (never two adjacent
 *    same-objective cards). When the attention mode mandates gaps (mindful),
 *    the STRICTER cap wins: K_effective = min(K, mindful cap).
 *
 * 2. TOP-BLOCK CONCENTRATION (X): when the first B =
 *    min(DIVERSITY_TOP_BLOCK_SIZE, n) cards concentrate more than X% on one
 *    dominant objective,
 *       X(exploration) = 80 - exploration * 40   (percent, [40, 80]),
 *    exploration candidates (unseen items, preferred with a DIFFERENT
 *    dominant objective) are SWAPPED into the block: the unseen item takes
 *    the block position of the LAST same-objective card, and that card is
 *    demoted below the block. Every swap is traced; when concentration
 *    remains but no unseen candidates are left below the block, an
 *    "exploration-injection-unsatisfied" decision records the honest
 *    residual (no fake success).
 *
 * Anti-tunnel-vision by construction: the output is ALWAYS a permutation of
 * the input, a user with any number of watches of one topic still receives
 * every other candidate, and no single watched topic can narrow what the
 * feed offers.
 */

import type { RecommendationPolicy, UserIntent } from "@wfx/domain";

import { attentionConstraints, breakDominantObjectiveRuns } from "./attention";
import type { ScoredCandidate, TraceDecision } from "./types";
import { assertValidIntents } from "./validate";

// ---------------------------------------------------------------------------
// Documented constants (deterministic formulas of the exploration dial)
// ---------------------------------------------------------------------------

/** Minimum run cap K (exploration = 1: no two adjacent same-objective cards). */
export const DIVERSITY_K_MIN = 1;
/** Maximum run cap K (exploration = 0: tolerate long same-objective runs). */
export const DIVERSITY_K_MAX = 5;

/** Minimum top-block concentration threshold X, in percent (exploration = 1). */
export const DIVERSITY_CONCENTRATION_MIN_PERCENT = 40;
/** Maximum top-block concentration threshold X, in percent (exploration = 0). */
export const DIVERSITY_CONCENTRATION_MAX_PERCENT = 80;

/** Number of leading cards that form the "top block" for concentration. */
export const DIVERSITY_TOP_BLOCK_SIZE = 8;

/**
 * The run cap K derived from the policy exploration dial:
 * `1 + floor((1 - exploration) * 4)`, clamped to [1, 5].
 */
export function diversityRunCap(policy: RecommendationPolicy): number {
  const exploration = Math.min(1, Math.max(0, policy.exploration));
  const raw =
    DIVERSITY_K_MIN +
    Math.floor((1 - exploration) * (DIVERSITY_K_MAX - DIVERSITY_K_MIN));
  return Math.min(DIVERSITY_K_MAX, Math.max(DIVERSITY_K_MIN, raw));
}

/**
 * The top-block concentration threshold X (percent) derived from the policy
 * exploration dial: `80 - exploration * 40`, clamped to [40, 80].
 */
export function diversityConcentrationThresholdPercent(policy: RecommendationPolicy): number {
  const exploration = Math.min(1, Math.max(0, policy.exploration));
  const raw =
    DIVERSITY_CONCENTRATION_MAX_PERCENT -
    exploration *
      (DIVERSITY_CONCENTRATION_MAX_PERCENT - DIVERSITY_CONCENTRATION_MIN_PERCENT);
  return Math.min(
    DIVERSITY_CONCENTRATION_MAX_PERCENT,
    Math.max(DIVERSITY_CONCENTRATION_MIN_PERCENT, raw),
  );
}

/** The effective run cap: the stricter of diversity K and the attention gap. */
export function effectiveRunCap(policy: RecommendationPolicy): number {
  const attentionMax = attentionConstraints(policy).maxConsecutiveSameObjective;
  const k = diversityRunCap(policy);
  return attentionMax === null ? k : Math.min(k, attentionMax);
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/** Output of the diversity stage. */
export interface DiversityResult {
  /** Re-ranked candidates (a permutation of the input — never narrowed). */
  ranked: readonly ScoredCandidate[];
  /** Auditable decisions (run breaks, injections, honest residuals). */
  decisions: readonly TraceDecision[];
}

/** Intent objective lookup for trace details (objective -> intent id). */
function intentIdByObjective(intents: readonly UserIntent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const intent of intents) {
    if (!map.has(intent.objective)) map.set(intent.objective, intent.id);
  }
  return map;
}

/**
 * Diversify the ranked list. Pure and deterministic; the input is never
 * mutated; the output is a permutation of the input.
 */
export function diversify(
  ranked: readonly ScoredCandidate[],
  intents: readonly UserIntent[],
  policy: RecommendationPolicy,
): DiversityResult {
  const checkedIntents = assertValidIntents(intents);
  const intentIds = intentIdByObjective(checkedIntents);
  const decisions: TraceDecision[] = [];

  // (a) Run cap — the stricter of diversity K and the attention-mode gap.
  const runCap = effectiveRunCap(policy);
  const runSweep = breakDominantObjectiveRuns(ranked, runCap);
  let current = [...runSweep.ranked];
  decisions.push(...runSweep.decisions);

  // (b) Top-block concentration + exploration injection (swap/demote only).
  const blockSize = Math.min(DIVERSITY_TOP_BLOCK_SIZE, current.length);
  const thresholdPercent = diversityConcentrationThresholdPercent(policy);
  if (blockSize >= 2) {
    for (;;) {
      const block = current.slice(0, blockSize);
      const counts = new Map<string, number>();
      for (const item of block) {
        const objective = item.features.dominantObjective;
        if (objective === null) continue; // no monoculture signal
        counts.set(objective, (counts.get(objective) ?? 0) + 1);
      }
      let dominantObjective: string | null = null;
      let dominantCount = 0;
      for (const [objective, count] of counts) {
        if (count > dominantCount) {
          dominantObjective = objective;
          dominantCount = count;
        }
      }
      if (dominantObjective === null) break; // nothing concentrated
      const concentration = (dominantCount / blockSize) * 100;
      if (concentration <= thresholdPercent) break; // within the threshold

      // Find the last block card carrying the dominant objective.
      let targetIndex = -1;
      for (let index = blockSize - 1; index >= 0; index -= 1) {
        if (block[index]!.features.dominantObjective === dominantObjective) {
          targetIndex = index;
          break;
        }
      }
      if (targetIndex === -1) break; // defensive — cannot happen when dominant

      // Find an unseen injectable below the block: prefer a DIFFERENT
      // dominant objective (real dilution), fall back to any unseen.
      let injectIndex = -1;
      for (let index = blockSize; index < current.length; index += 1) {
        const item = current[index]!;
        if (!item.features.unseen) continue;
        if (item.features.dominantObjective !== dominantObjective) {
          injectIndex = index;
          break;
        }
      }
      if (injectIndex === -1) {
        for (let index = blockSize; index < current.length; index += 1) {
          if (current[index]!.features.unseen) {
            injectIndex = index;
            break;
          }
        }
      }
      if (injectIndex === -1) {
        decisions.push({
          kind: "exploration-injection-unsatisfied",
          detail: `top block ${concentration.toFixed(1)}% concentrated on "${dominantObjective}" (threshold ${thresholdPercent}%) but no unseen candidates remain below the block — residual recorded honestly, pool never narrowed`,
          itemIds: [],
        });
        break;
      }

      const injected = current[injectIndex]!;
      const demoted = current[targetIndex]!;
      // Swap: the unseen item enters the block; the concentrated card is
      // demoted to the injectable's old position below the block.
      current[targetIndex] = injected;
      current[injectIndex] = demoted;
      const intentId = intentIds.get(dominantObjective);
      decisions.push({
        kind: "exploration-injection",
        detail: `top block ${concentration.toFixed(1)}% concentrated on "${dominantObjective}"${intentId === undefined ? "" : ` (intent ${intentId})`} > threshold ${thresholdPercent}% — swapped unseen item ${injected.candidate.itemId} into the block, demoting ${demoted.candidate.itemId}`,
        itemIds: [injected.candidate.itemId, demoted.candidate.itemId],
      });
    }
  }

  // (c) Re-enforce the run cap after the injections moved cards.
  const finalSweep = breakDominantObjectiveRuns(current, runCap);
  current = [...finalSweep.ranked];
  decisions.push(...finalSweep.decisions);

  return {
    ranked: Object.freeze(current),
    decisions: Object.freeze(decisions),
  };
}
