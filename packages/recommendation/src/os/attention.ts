/**
 * Recommendation OS — attention policy (WFX-021, Lane A).
 *
 * THE ATTENTION-POLICY LAW (frozen architecture): Mindful / Balanced /
 * Immersive / Custom are EXPLICIT policy. The system does NOT silently
 * optimize for maximum session length when the user selected a different
 * objective. Every constraint this module derives is declared in the trace
 * ("attention-policy" decision) and enforced by reordering only — never by
 * removing candidates, and never by touching model scores.
 *
 * Mode semantics (documented constants, deterministic formulas):
 * - `mindful`   — mandatory diversity gap every N items
 *   (N = MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE = 2: no more than 2
 *   consecutive cards sharing a dominant matched objective) AND capped
 *   session-extending chains (max 2 consecutive chained placements).
 * - `balanced`  — the default: no mandated gaps (the exploration-derived
 *   diversity K applies), moderate chain tolerance (max 4).
 * - `immersive` — chains allowed with NO count cap; alternatives are never
 *   removed (nothing is ever removed in any mode — demotion with trace
 *   reasons is the only soft-exclusion mechanism).
 * - `custom`    — attention tuning is delegated to the user's explicit
 *   policy objectives (policy.ts applies them with maximize/minimize
 *   directions honored); no extra gap or chain constraints.
 * - `maxSessionExtensionMinutes` — when provided, respected in ALL modes:
 *   the composed feed's OS-planned session extension (next-episode chaining,
 *   see composition.ts) stays within the cap; placements that would exceed
 *   it are demoted with a trace reason.
 *
 * This module also owns the two pure ordering-repair algorithms every later
 * stage reuses so the invariants hold at the OUTPUT even after composition
 * reorders for the surface:
 * - `breakDominantObjectiveRuns` — no more than K consecutive cards sharing
 *   the same dominant matched objective (greedy demotion; null-objective
 *   cards break runs — they carry no monoculture signal).
 * - `breakSessionChains` — no more than N consecutive session-extending
 *   placements (an item extends when its `nextEpisodeOf` links to the
 *   previous card's item or to a consumed anchor — see composition.ts).
 * Both NEVER delete: the output is always a permutation of the input, and
 * unsatisfiable remainders (e.g. every remaining card shares one objective)
 * are placed in incoming order with an explicit trace decision — honesty
 * over fake success.
 */

import type { RecommendationPolicy } from "@wfx/domain";

import type { AttentionConstraints, ScoredCandidate, TraceDecision } from "./types";

// ---------------------------------------------------------------------------
// Attention mode constants (documented law)
// ---------------------------------------------------------------------------

/** Mindful: mandatory diversity gap after at most this many consecutive same-objective cards. */
export const MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE = 2;

/** Mindful: at most this many consecutive session-extending placements. */
export const MINDFUL_MAX_SESSION_EXTENDING_CHAIN = 2;

/** Balanced (default): moderate chain tolerance, no mandated objective gaps. */
export const BALANCED_MAX_SESSION_EXTENDING_CHAIN = 4;

/**
 * Maximum (breakRuns, breakChains) repair sweeps composition alternates
 * before recording a residual constraint decision (bounded termination —
 * repairs move items strictly later, so conflicts converge in practice).
 */
export const MAX_SWEEP_PASSES = 4;

/**
 * Derive the attention constraints from the policy. Deterministic and pure;
 * the derived values are recorded by the policy stage as an "attention-policy"
 * trace decision and enforced downstream.
 */
export function attentionConstraints(policy: RecommendationPolicy): AttentionConstraints {
  const minutes =
    typeof policy.maxSessionExtensionMinutes === "number" &&
    Number.isFinite(policy.maxSessionExtensionMinutes)
      ? Math.max(0, policy.maxSessionExtensionMinutes)
      : null;

  switch (policy.attentionMode) {
    case "mindful":
      return {
        attentionMode: "mindful",
        maxConsecutiveSameObjective: MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE,
        maxSessionExtendingChain: MINDFUL_MAX_SESSION_EXTENDING_CHAIN,
        maxSessionExtensionMinutes: minutes,
      };
    case "balanced":
      return {
        attentionMode: "balanced",
        maxConsecutiveSameObjective: null,
        maxSessionExtendingChain: BALANCED_MAX_SESSION_EXTENDING_CHAIN,
        maxSessionExtensionMinutes: minutes,
      };
    case "immersive":
      return {
        attentionMode: "immersive",
        maxConsecutiveSameObjective: null,
        maxSessionExtendingChain: null,
        maxSessionExtensionMinutes: minutes,
      };
    case "custom":
      return {
        attentionMode: "custom",
        maxConsecutiveSameObjective: null,
        maxSessionExtendingChain: null,
        maxSessionExtensionMinutes: minutes,
      };
  }
}

// ---------------------------------------------------------------------------
// Shared ordering-repair machinery
// ---------------------------------------------------------------------------

/** Result of one ordering-repair pass (a permutation + auditable decisions). */
export interface SweepResult {
  ranked: readonly ScoredCandidate[];
  decisions: readonly TraceDecision[];
}

/**
 * Greedy run-breaking: reorder so no more than `maxConsecutive` CONSECUTIVE
 * cards share the same dominant matched objective. Cards with a null
 * dominant objective are run-neutral (they carry no monoculture signal and
 * break runs). Extenders are demoted BELOW the next placeable card (never
 * deleted). When every remaining card shares one objective (no alternative
 * exists to interleave), the remainder is placed in incoming order with an
 * explicit "objective-run-unsatisfiable" decision — the pool stays wide.
 */
export function breakDominantObjectiveRuns(
  ranked: readonly ScoredCandidate[],
  maxConsecutive: number,
): SweepResult {
  const decisions: TraceDecision[] = [];
  const remaining = [...ranked];
  const out: ScoredCandidate[] = [];
  let lastObjective: string | null = null;
  let runLength = 0;

  while (remaining.length > 0) {
    const placeableIndex = remaining.findIndex((item) => {
      const objective = item.features.dominantObjective;
      return objective === null || objective !== lastObjective || runLength < maxConsecutive;
    });

    if (placeableIndex === -1) {
      // Every remaining card shares the run objective — unsatisfiable by
      // reordering alone; place honestly, record it, never delete.
      const itemIds = remaining.map((item) => item.candidate.itemId);
      decisions.push({
        kind: "objective-run-unsatisfiable",
        detail: `remaining ${remaining.length} item(s) all share dominant objective "${lastObjective}" — placed in rank order (no alternatives to interleave; pool never narrowed)`,
        itemIds,
      });
      out.push(...remaining);
      break;
    }

    if (placeableIndex > 0) {
      const demoted = remaining.slice(0, placeableIndex);
      decisions.push({
        kind: "objective-run-break",
        detail: `run of ${runLength} consecutive "${lastObjective}" cards at cap K=${maxConsecutive} — demoted ${demoted.length} item(s) below the next different-objective card`,
        itemIds: demoted.map((item) => item.candidate.itemId),
      });
    }

    const placed = remaining[placeableIndex]!;
    out.push(placed);
    remaining.splice(placeableIndex, 1);

    const objective = placed.features.dominantObjective;
    if (objective === null) {
      lastObjective = null;
      runLength = 0;
    } else if (objective === lastObjective) {
      runLength += 1;
    } else {
      lastObjective = objective;
      runLength = 1;
    }
  }

  return { ranked: Object.freeze(out), decisions: Object.freeze(decisions) };
}

/** Read the documented `nextEpisodeOf` feature key from a scored candidate. */
export function nextEpisodeOf(item: ScoredCandidate): string | null {
  const value = item.candidate.features["nextEpisodeOf"];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Does this item extend the session when placed after `previousItemId`?
 *
 * SESSION-EXTENSION SEMANTICS (the one definition used by placement AND the
 * sweeps, so the invariant holds at the output): an item extends when its
 * documented `nextEpisodeOf` feature links to the previous card's item
 * (in-feed episodic chaining) or to an item the user actually consumed
 * (external anchor — it continues what the user was watching) — UNLESS the
 * item itself is IN PROGRESS (resume): a resume is the user's own
 * continuation, not OS-planned extension, so it never counts toward chain
 * caps or session-extension minutes. `null` links never extend.
 */
export function isSessionExtending(
  item: ScoredCandidate,
  previousItemId: string | null,
  consumedIds: ReadonlySet<string>,
  resumeIds: ReadonlySet<string>,
): boolean {
  if (resumeIds.has(item.candidate.itemId)) return false;
  const next = nextEpisodeOf(item);
  if (next === null) return false;
  if (previousItemId !== null && next === previousItemId) return true;
  return consumedIds.has(next);
}

/**
 * Greedy chain-breaking: reorder so no more than `maxChain` CONSECUTIVE
 * cards are session-extending (see `isSessionExtending` — resume items are
 * never extension). Extenders past the cap are demoted below the next
 * non-extending card (never deleted). An unsatisfiable remainder (every
 * remaining card extends) is placed in incoming order with a "chain-cap"
 * decision naming the residual.
 */
export function breakSessionChains(
  ranked: readonly ScoredCandidate[],
  maxChain: number,
  consumedIds: ReadonlySet<string>,
  resumeIds: ReadonlySet<string> = new Set(),
): SweepResult {
  const decisions: TraceDecision[] = [];
  const remaining = [...ranked];
  const out: ScoredCandidate[] = [];
  let lastItemId: string | null = null;
  let chainLength = 0;

  while (remaining.length > 0) {
    const placeableIndex = remaining.findIndex(
      (item) =>
        !isSessionExtending(item, lastItemId, consumedIds, resumeIds) ||
        chainLength < maxChain,
    );

    if (placeableIndex === -1) {
      const itemIds = remaining.map((item) => item.candidate.itemId);
      decisions.push({
        kind: "chain-cap",
        detail: `remaining ${remaining.length} item(s) all extend the session chain — placed in rank order (chain cap ${maxChain} residual; pool never narrowed)`,
        itemIds,
      });
      out.push(...remaining);
      break;
    }

    if (placeableIndex > 0) {
      const demoted = remaining.slice(0, placeableIndex);
      decisions.push({
        kind: "chain-cap",
        detail: `session-extending chain reached cap ${maxChain} — demoted ${demoted.length} item(s) below the next non-extending card`,
        itemIds: demoted.map((item) => item.candidate.itemId),
      });
    }

    const placed = remaining[placeableIndex]!;
    out.push(placed);
    remaining.splice(placeableIndex, 1);

    if (isSessionExtending(placed, lastItemId, consumedIds, resumeIds)) {
      chainLength += 1;
    } else {
      chainLength = 0;
    }
    lastItemId = placed.candidate.itemId;
  }

  return { ranked: Object.freeze(out), decisions: Object.freeze(decisions) };
}
