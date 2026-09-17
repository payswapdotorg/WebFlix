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

import { attentionAdjustedDials, attentionConstraints, breakDominantObjectiveRuns } from "./attention";
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
 * R05 (J16) — THE ANTI-TUNNEL DIVERSITY FLOOR: the minimum number of
 * DISTINCT dominant matched objectives that must appear in the top block
 * whenever the pool offers them. After concentrated watching of one topic
 * the composed feed RETAINS exploration capability — adjacent/unrelated
 * candidates still surface — UNLESS the user explicitly narrowed (a
 * persistent-scope intent matching the block's dominant objective is the
 * documented explicit narrowing; the user's own ask always wins).
 */
export const DIVERSITY_FLOOR_MIN_DISTINCT = 2;

/**
 * R05 (J16): has the user EXPLICITLY narrowed the feed to this objective?
 * The one documented yield condition of the diversity floor — an
 * EXPLICITLY SUBMITTED persistent-scope intent whose objective matches,
 * WHILE the user has closed the exploration dial (see
 * {@link DIVERSITY_NARROWING_MAX_EXPLORATION}).
 *
 * The provenance distinction is the whole point: inferred persistent
 * intents are what concentrated watching AUTOMATICALLY accumulates (the
 * IntentGraph's inference) — the very tunnel the floor exists to soften —
 * while an `explicit` persistent intent is the user's own standing ask
 * (R05's `POST /experience/intents`, provenance "explicit"). Only the
 * user's ask narrows; session/momentary/temporary/social intents never do
 * (they are exploration windows and context, not standing asks).
 */
export function narrowedByPersistentIntent(
  intents: readonly UserIntent[],
  dominantObjective: string,
): boolean {
  return intents.some(
    (intent) =>
      intent.scope === "persistent" &&
      intent.provenance === "explicit" &&
      intent.objective === dominantObjective,
  );
}

/**
 * R05 (J16): the exploration dial at or below which a persistent explicit
 * intent counts as an EXPLICIT NARROWING (the user closed the exploration
 * control AND pins the topic — a standing interest with exploration open
 * is an interest, not a narrowing). Mindful mode can never narrow: the
 * mode's exploration floor (0.6) keeps the dial open by construction.
 */
export const DIVERSITY_NARROWING_MAX_EXPLORATION = 0;

/**
 * R05 (J16): the ONE objective (if any) this feed is explicitly narrowed
 * to: the first explicitly-submitted persistent intent (ctx order) whose
 * objective appears as some candidate's dominant objective, WHILE the
 * attention-adjusted exploration dial is at its minimum. Null when the
 * feed is not narrowed. The run-breaking sweeps, the exploration
 * injection, and the diversity floor yield to this objective; the yield is
 * recorded honestly in the trace.
 */
export function explicitNarrowedObjective(
  intents: readonly UserIntent[],
  ranked: readonly ScoredCandidate[],
  policy: RecommendationPolicy,
): string | null {
  if (
    attentionAdjustedDials(policy).exploration > DIVERSITY_NARROWING_MAX_EXPLORATION
  ) {
    return null; // the exploration dial is open — an interest, not a narrowing
  }
  const objectives = new Set(
    ranked
      .map((item) => item.features.dominantObjective)
      .filter((objective) => objective !== null),
  );
  for (const intent of intents) {
    if (
      intent.scope === "persistent" &&
      intent.provenance === "explicit" &&
      objectives.has(intent.objective)
    ) {
      return intent.objective;
    }
  }
  return null;
}

/**
 * The run cap K derived from the RAW policy exploration dial:
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
 * R05: the run cap K derived from the ATTENTION-ADJUSTED exploration dial
 * (mindful's floor applies before the formula — the mode's exploration
 * guarantee feeds the diversity law). This is the value `diversify` and
 * `effectiveRunCap` enforce.
 */
export function effectiveDiversityRunCap(policy: RecommendationPolicy): number {
  const exploration = attentionAdjustedDials(policy).exploration;
  const raw =
    DIVERSITY_K_MIN +
    Math.floor((1 - exploration) * (DIVERSITY_K_MAX - DIVERSITY_K_MIN));
  return Math.min(DIVERSITY_K_MAX, Math.max(DIVERSITY_K_MIN, raw));
}

/**
 * The top-block concentration threshold X (percent) derived from the RAW
 * policy exploration dial: `80 - exploration * 40`, clamped to [40, 80].
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

/**
 * R05: the concentration threshold X derived from the ATTENTION-ADJUSTED
 * exploration dial — the value `diversify` enforces.
 */
export function effectiveConcentrationThresholdPercent(policy: RecommendationPolicy): number {
  const exploration = attentionAdjustedDials(policy).exploration;
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
  const k = effectiveDiversityRunCap(policy);
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
 *
 * R05 adds the ANTI-TUNNEL DIVERSITY FLOOR (mechanism 3, below) — the J16
 * guarantee that concentrated watching cannot collapse the top block onto
 * one topic while the pool still offers alternatives, unless the user
 * explicitly narrowed with a persistent intent.
 */
export function diversify(
  ranked: readonly ScoredCandidate[],
  intents: readonly UserIntent[],
  policy: RecommendationPolicy,
): DiversityResult {
  const checkedIntents = assertValidIntents(intents);
  const intentIds = intentIdByObjective(checkedIntents);
  const decisions: TraceDecision[] = [];
  // R05 (J16): the explicit narrowing (persistent explicit intent + the
  // exploration dial closed) the run cap + injection + floor yield to.
  const narrowedObjective = explicitNarrowedObjective(checkedIntents, ranked, policy);

  // (a) Run cap — the stricter of diversity K and the attention-mode gap
  //     (both derived from the ATTENTION-ADJUSTED exploration dial); the
  //     explicitly narrowed objective's runs are unbounded (the user's ask).
  const runCap = effectiveRunCap(policy);
  const runSweep = breakDominantObjectiveRuns(ranked, runCap, narrowedObjective);
  let current = [...runSweep.ranked];
  decisions.push(...runSweep.decisions);

  // (b) Top-block concentration + exploration injection (swap/demote only).
  const blockSize = Math.min(DIVERSITY_TOP_BLOCK_SIZE, current.length);
  const thresholdPercent = effectiveConcentrationThresholdPercent(policy);
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
      // R05 (J16): the explicit narrowing (dial closed + persistent explicit
      // intent) yields — no injection fights the user's standing ask. The
      // yield itself is recorded ONCE, by the diversity floor below, when
      // the monoculture actually persists.
      if (dominantObjective === narrowedObjective) break;
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
  const finalSweep = breakDominantObjectiveRuns(current, runCap, narrowedObjective);
  current = [...finalSweep.ranked];
  decisions.push(...finalSweep.decisions);

  // (d) R05 — THE ANTI-TUNNEL DIVERSITY FLOOR (J16): the top block must
  //     carry at least DIVERSITY_FLOOR_MIN_DISTINCT distinct dominant
  //     objectives whenever the pool offers them, UNLESS the user explicitly
  //     narrowed (a persistent explicit intent + the exploration dial
  //     closed). Greedy deterministic repair: the highest-ranked
  //     different-objective candidate below the block swaps in at the LAST
  //     block position, the displaced card taking its place below (a
  //     permutation — nothing is removed). When the pool cannot satisfy the
  //     floor, the residual is recorded honestly (never a fake success).
  const floorBlockSize = Math.min(DIVERSITY_TOP_BLOCK_SIZE, current.length);
  if (floorBlockSize >= 2) {
    applyDiversityFloor(current, checkedIntents, intentIds, floorBlockSize, decisions, narrowedObjective);
  }

  return {
    ranked: Object.freeze(current),
    decisions: Object.freeze(decisions),
  };
}

/**
 * The diversity-floor repair (mutates `current` in place — the caller's
 * working copy — and pushes its decisions). Deterministic and bounded: one
 * swap per missing distinct objective, verified once after.
 *
 * VIOLATION (the tunnel, precisely): the top block is a SINGLE-OBJECTIVE
 * MONOCULTURE — every block card carries a dominant objective and they are
 * all the same. Null-objective cards are themselves unrelated candidates
 * (they matched no intent — no monoculture signal), so a block that carries
 * them already surfaces non-topic alternatives and satisfies the floor.
 *
 * YIELD: when the monoculture's objective is the explicitly narrowed one
 * (persistent explicit intent + exploration dial closed), the floor yields
 * — the user's standing ask wins — and the ONE yield note names it.
 */
function applyDiversityFloor(
  current: ScoredCandidate[],
  intents: readonly UserIntent[],
  intentIds: ReadonlyMap<string, string>,
  blockSize: number,
  decisions: TraceDecision[],
  narrowedObjective: string | null,
): void {
  const distinctObjectives = (block: readonly ScoredCandidate[]): Set<string> => {
    const distinct = new Set<string>();
    for (const item of block) {
      if (item.features.dominantObjective !== null) distinct.add(item.features.dominantObjective);
    }
    return distinct;
  };

  const block = current.slice(0, blockSize);
  const distinct = distinctObjectives(block);
  const monoculture =
    distinct.size === 1 && block.every((item) => item.features.dominantObjective !== null);
  if (!monoculture) return; // the floor holds (2+ objectives, or unrelated null-objective cards present)

  const dominantObjective = [...distinct][0]!;
  if (dominantObjective === narrowedObjective) {
    // The user's explicit standing ask — the floor yields (documented). The
    // run cap and the exploration injection yielded too (see (a)/(b)); this
    // ONE note is the honest record of the whole yield.
    decisions.push({
      kind: "diversity-floor",
      detail: `the top block concentrates on "${dominantObjective}" but a persistent intent asks for exactly that with the exploration dial closed — the explicit narrowing wins, the run cap, the exploration injection, and the diversity floor yield (session/momentary/temporary intents never narrow; only a persistent explicit ask with exploration at its minimum does)`,
      itemIds: [],
    });
    return;
  }

  // Greedy repair: swap the highest-ranked different-objective candidate
  // below the block into the LAST block position; the displaced card takes
  // its place below (a permutation — nothing is removed).
  let swaps = 0;
  let satisfied = false;
  while (swaps < DIVERSITY_FLOOR_MIN_DISTINCT - 1 && swaps < blockSize) {
    const targetIndex = current.findIndex(
      (item, index) =>
        index >= blockSize &&
        item.features.dominantObjective !== null &&
        item.features.dominantObjective !== dominantObjective,
    );
    if (targetIndex === -1) {
      decisions.push({
        kind: "diversity-floor-unsatisfiable",
        detail: `the top block is a "${dominantObjective}" monoculture but no different-objective candidate remains below it — the ${DIVERSITY_FLOOR_MIN_DISTINCT}-objective floor is satisfied as far as reordering allows (recorded honestly; pool never narrowed)`,
        itemIds: [],
      });
      return;
    }
    const injected = current[targetIndex]!;
    const displacedIndex = blockSize - 1 - swaps;
    const displaced = current[displacedIndex]!;
    current[displacedIndex] = injected;
    current[targetIndex] = displaced;
    swaps += 1;
    const nowDistinct = distinctObjectives(current.slice(0, blockSize));
    const intentId = intentIds.get(dominantObjective);
    decisions.push({
      kind: "diversity-floor",
      detail: `anti-tunnel floor: the top block was a single-objective "${dominantObjective}"${intentId === undefined ? "" : ` (intent ${intentId})`} monoculture with no persistent narrowing — swapped ${injected.candidate.itemId} (objective ${injected.features.dominantObjective}) into the block, demoting ${displaced.candidate.itemId} (the concentrated topic keeps surfacing; exploration stays possible)`,
      itemIds: [injected.candidate.itemId, displaced.candidate.itemId],
    });
    if (nowDistinct.size >= DIVERSITY_FLOOR_MIN_DISTINCT) {
      satisfied = true;
      break;
    }
  }
  if (!satisfied && swaps > 0) {
    const nowDistinct = distinctObjectives(current.slice(0, blockSize));
    if (nowDistinct.size < DIVERSITY_FLOOR_MIN_DISTINCT) {
      decisions.push({
        kind: "diversity-floor-unsatisfiable",
        detail: `only ${nowDistinct.size} distinct objective(s) could be swapped into the top block — the ${DIVERSITY_FLOOR_MIN_DISTINCT}-objective floor is satisfied as far as reordering allows (recorded honestly; pool never narrowed)`,
        itemIds: [],
      });
    }
  }
}
