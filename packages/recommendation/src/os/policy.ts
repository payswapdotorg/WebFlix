/**
 * Recommendation OS — policy constraints (WFX-021, Lane A).
 *
 * `applyPolicy(ctx, scored)` — the fourth pipeline stage, in this order:
 *
 * 1. Canonical dedupe — one realization per `entertainmentItemId`. The
 *    winner is deterministic: realization availability rank
 *    (available > unknown > unavailable), then richer capabilities, then
 *    pool order. Every dropped duplicate is recorded as a "dedupe-kept"
 *    decision naming the winner AND the losers.
 * 2. Custom-mode objectives — when `attentionMode === "custom"`, each
 *    policy objective (maximize/minimize, weight) that matches an item
 *    applies an explicit rank ADJUSTMENT (the model score itself is never
 *    modified — the adjustment and the model score are recorded
 *    separately). Matching: an `item:`-prefixed objective id matches that
 *    exact canonical item; any other id is token-matched against the
 *    candidate text surface (the same documented semantics as intent
 *    matching, see features.ts).
 * 3. Availability floor — items with ZERO available realizations (per the
 *    pool-aggregated availability ratio) are DEMOTED to the tail, never
 *    deleted: surface-agnostic retrieval is preserved and the demotion is
 *    traced ("availability-demotion"). The floor holds in every mode.
 * 4. Attention mode — the attention-policy law (see attention.ts): mindful
 *    inserts mandatory diversity gaps (run cap 2) and caps session-extending
 *    chains (2); balanced caps chains at 4; immersive/custom allow chains.
 *    The derived constraints are declared in the trace ("attention-policy")
 *    and enforced here AND re-enforced after the later stages reorder (the
 *    composition stage owns the final sweep — the output invariant is what
 *    the law protects). R05: mindful ALSO applies the mode's NOVELTY
 *    WEIGHTING — fresh content is rank-boosted by
 *    `MINDFUL_NOVELTY_RANK_WEIGHT * freshness` (a traced adjustment; model
 *    scores untouched) — and derives its own exploration floor + time
 *    budget (see attention.ts).
 * 5. `maxSessionExtensionMinutes` — respected in every mode when provided;
 *    the minutes accounting happens at composition time (where OS-planned
 *    chaining actually accumulates minutes) and every stop is traced.
 *
 * The output is a REORDERING of the input (dedupe aside — dedupe is the one
 * explicitly specified collapse: one card per canonical item). Nothing is
 * ever silently dropped; every decision is in the trace.
 */

import type { RecommendationContext, RecommendationPolicy } from "@wfx/domain";

import {
  MINDFUL_NOVELTY_RANK_WEIGHT,
  attentionConstraints,
  breakDominantObjectiveRuns,
  breakSessionChains,
} from "./attention";
import { consumedItemIds, inProgressItemIds } from "./events";
import { objectiveTokens } from "./features";
import type {
  AttentionConstraints,
  ScoredCandidate,
  TraceDecision,
} from "./types";
import { assertValidContext } from "./validate";

/** Output of the policy stage. */
export interface PolicyResult {
  /** Deduped, policy-constrained, ordered candidates. */
  ranked: readonly ScoredCandidate[];
  /** The derived attention constraints downstream stages must maintain. */
  constraints: AttentionConstraints;
  /** Auditable decisions (dedupe, objectives, floor, attention). */
  decisions: readonly TraceDecision[];
}

/** Availability rank for dedupe winner selection: available > unknown > unavailable. */
const AVAILABILITY_RANK: Readonly<Record<ScoredCandidate["candidate"]["realization"]["availability"], number>> =
  Object.freeze({ available: 3, unknown: 2, unavailable: 1 });

/** A short realization label for trace details. */
function realizationLabel(item: ScoredCandidate): string {
  const realization = item.candidate.realization;
  return `${realization.connectorId}/${realization.externalRef} (${realization.availability}, ${realization.capabilities.length} capabilities)`;
}

/** The candidate's text surface for objective matching (matchText / title). */
function surfaceText(item: ScoredCandidate): string | null {
  const features = item.candidate.features;
  if (typeof features.matchText === "string") return features.matchText.toLowerCase();
  if (typeof features.canonicalTitle === "string") return features.canonicalTitle.toLowerCase();
  return null;
}

/** Does one policy objective match this item? (item: prefix or token match) */
function objectiveMatches(
  objectiveId: string,
  item: ScoredCandidate,
): boolean {
  if (objectiveId.startsWith("item:")) {
    const target = objectiveId.slice("item:".length);
    return target.length > 0 && target === item.candidate.itemId;
  }
  const tokens = objectiveTokens(objectiveId);
  if (tokens.length === 0) return false;
  const text = surfaceText(item);
  if (text === null) return false;
  return tokens.some((token) => text.includes(token));
}

/** The custom-mode rank adjustment of one item (signed sum of matched objectives). */
function customAdjustment(
  policy: RecommendationPolicy,
  item: ScoredCandidate,
): { adjustment: number; matched: string[] } {
  let adjustment = 0;
  const matched: string[] = [];
  for (const objective of policy.objectives) {
    if (!objectiveMatches(objective.id, item)) continue;
    const signed = objective.direction === "maximize" ? objective.weight : -objective.weight;
    adjustment += signed;
    matched.push(
      `objective "${objective.id}" (${objective.direction}, weight ${objective.weight}) ${signed >= 0 ? "+" : ""}${signed}`,
    );
  }
  return { adjustment, matched };
}

/**
 * Apply the policy constraints. Pure and deterministic; the input array and
 * its objects are never mutated. Throws the typed aggregated error on a
 * malformed ctx (stage entry validation).
 */
export function applyPolicy(
  ctx: RecommendationContext,
  scored: readonly ScoredCandidate[],
): PolicyResult {
  assertValidContext(ctx);
  const policy = ctx.policy;
  const decisions: TraceDecision[] = [];

  // --- 1. Canonical dedupe (one realization per item, deterministic winner) ---
  const byItem = new Map<string, ScoredCandidate[]>();
  for (const item of scored) {
    const group = byItem.get(item.candidate.itemId);
    if (group === undefined) byItem.set(item.candidate.itemId, [item]);
    else group.push(item);
  }
  const deduped: ScoredCandidate[] = [];
  for (const [itemId, group] of byItem) {
    const winner = [...group].sort((a, b) => {
      const availability =
        AVAILABILITY_RANK[b.candidate.realization.availability] -
        AVAILABILITY_RANK[a.candidate.realization.availability];
      if (availability !== 0) return availability;
      const capabilities =
        b.candidate.realization.capabilities.length - a.candidate.realization.capabilities.length;
      if (capabilities !== 0) return capabilities;
      return a.features.poolIndex - b.features.poolIndex;
    })[0]!;
    deduped.push(winner);
    if (group.length > 1) {
      const losers = group.filter((item) => item !== winner);
      decisions.push({
        kind: "dedupe-kept",
        detail: `item ${itemId}: kept realization ${realizationLabel(winner)} over ${losers.map(realizationLabel).join("; ")}`,
        itemIds: [itemId],
      });
    }
  }

  // --- 2. Custom-mode objective adjustments (explicit, traced, model score untouched) ---
  let current: ScoredCandidate[] = deduped;
  if (policy.attentionMode === "custom" && policy.objectives.length > 0) {
    const adjustments = new Map<ScoredCandidate, number>();
    for (const item of current) {
      const { adjustment, matched } = customAdjustment(policy, item);
      adjustments.set(item, adjustment);
      if (matched.length === 0) continue;
      decisions.push({
        kind: "custom-objective",
        detail: `${matched.join("; ")} — rank adjustment applied (model score ${item.modelScore} unchanged)`,
        itemIds: [item.candidate.itemId],
      });
    }
    // Stable re-order: modelScore + adjustment desc (unscored items last),
    // ties keeping the incoming (dedupe) order.
    const keyed = current.map((item, index) => ({
      item,
      index,
      key:
        item.modelScore === null
          ? Number.NEGATIVE_INFINITY
          : item.modelScore + (adjustments.get(item) ?? 0),
    }));
    keyed.sort((a, b) => {
      if (a.key !== b.key) return b.key - a.key;
      return a.index - b.index;
    });
    current = keyed.map((entry) => entry.item);
  }

  // --- R05 3a. Mindful novelty weighting (the J18 law: a mode is measurable
  // behavior). Fresh content receives a rank adjustment proportional to its
  // freshness; unknown-freshness items receive the neutral-midpoint weight
  // uniformly (no reorder among them). Model scores are NEVER touched —
  // the adjustment is recorded and applied to ordering only, exactly like
  // custom-mode objectives. ---
  if (policy.attentionMode === "mindful") {
    const adjustments = new Map<ScoredCandidate, number>();
    for (const item of current) {
      adjustments.set(item, MINDFUL_NOVELTY_RANK_WEIGHT * item.features.freshness);
    }
    decisions.push({
      kind: "attention-novelty-weighting",
      detail: `mindful novelty weighting: every candidate rank-adjusted by ${MINDFUL_NOVELTY_RANK_WEIGHT} * freshness (fresh-above-stale reordering; model scores untouched; unknown-freshness items carry the neutral ${0.5} midpoint uniformly)`,
      itemIds: [],
    });
    const keyed = current.map((item, index) => ({
      item,
      index,
      key:
        item.modelScore === null
          ? Number.NEGATIVE_INFINITY
          : item.modelScore + (adjustments.get(item) ?? 0),
    }));
    keyed.sort((a, b) => {
      if (a.key !== b.key) return b.key - a.key;
      return a.index - b.index;
    });
    current = keyed.map((entry) => entry.item);
  }

  // --- 3. Availability floor (zero available realizations -> tail, never removed) ---
  const floorKept: ScoredCandidate[] = [];
  const floorDemoted: ScoredCandidate[] = [];
  for (const item of current) {
    if (item.features.availabilityRatio <= 0) {
      floorDemoted.push(
        Object.freeze({ ...item, availabilityDemoted: true }) as ScoredCandidate,
      );
      decisions.push({
        kind: "availability-demotion",
        detail: `0 of ${item.features.realizationReports} realization report(s) available — demoted to the tail (NOT removed: surface-agnostic retrieval preserved)`,
        itemIds: [item.candidate.itemId],
      });
    } else {
      floorKept.push(item);
    }
  }
  current = [...floorKept, ...floorDemoted];

  // --- 4. Attention mode (declare + apply the mode's own ordering law) ---
  const constraints = attentionConstraints(policy);
  decisions.push({
    kind: "attention-policy",
    detail: `mode "${constraints.attentionMode}": maxConsecutiveSameObjective=${constraints.maxConsecutiveSameObjective ?? "diversity-K (no mandated gaps)"}, maxSessionExtendingChain=${constraints.maxSessionExtendingChain ?? "unbounded"}, maxSessionExtensionMinutes=${constraints.maxSessionExtensionMinutes ?? "none"}`,
    itemIds: [],
  });

  if (constraints.maxConsecutiveSameObjective !== null) {
    const swept = breakDominantObjectiveRuns(current, constraints.maxConsecutiveSameObjective);
    current = [...swept.ranked];
    decisions.push(...swept.decisions);
  }

  if (constraints.maxSessionExtendingChain !== null) {
    const consumed = consumedItemIds(ctx.recentEvents);
    const inProgress = inProgressItemIds(ctx.recentEvents);
    const swept = breakSessionChains(
      current,
      constraints.maxSessionExtendingChain,
      consumed,
      inProgress,
    );
    current = [...swept.ranked];
    decisions.push(...swept.decisions);
  }

  return {
    ranked: Object.freeze(current),
    constraints,
    decisions: Object.freeze(decisions),
  };
}
