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
 *   session-extending chains (max 2 consecutive chained placements) AND
 *   (R05) exploration/novelty dials floored at the mode's guarantees
 *   (0.6) AND (R05) a default session-extension time budget when the user
 *   set none.
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
 * R05 — Mindful's EXPLORATION floor: the effective dial never drops below
 * this in mindful mode (the mode's exploration guarantee — attention modes
 * change measurable policy behavior; the user's higher dial always wins).
 */
export const MINDFUL_EXPLORATION_FLOOR = 0.6;

/**
 * R05 — Mindful's NOVELTY floor: same law as the exploration floor (the
 * heuristic model's novelty term reads the effective dial, so a mindful
 * policy measurably prefers fresher items even when the raw dial is low).
 */
export const MINDFUL_NOVELTY_FLOOR = 0.6;

/**
 * R05 — Mindful's DEFAULT session-extension time budget (minutes). Mindful
 * is intentional consumption: when the user set no explicit
 * `maxSessionExtensionMinutes`, the OS caps OS-PLANNED session extension
 * (next-episode chaining) at this budget — a time-budget signal the mode
 * carries and the trace's "attention-policy" decision declares. An explicit
 * user value (any mode) always wins. Immersive/balanced/custom set no
 * default: immersive is the user's explicit choice of unbounded continuity.
 */
export const MINDFUL_DEFAULT_MAX_SESSION_EXTENSION_MINUTES = 90;

/**
 * Maximum (breakRuns, breakChains) repair sweeps composition alternates
 * before recording a residual constraint decision (bounded termination —
 * repairs move items strictly later, so conflicts converge in practice).
 */
export const MAX_SWEEP_PASSES = 4;

/** Clamp one dial to the [0, 1] interval (garbage-proof, documented). */
function clampDial(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * R05 — the attention-adjusted dials of one policy: the mode's floors
 * applied to the user's exploration/novelty dials. Mindful RAISES a low
 * dial to the mode's floor (the exploration/novelty guarantee); balanced,
 * immersive, and custom pass the user's dials through EXACTLY (custom's
 * whole contract is that the dials are the user's direct controls). The
 * socialInfluence dial is mode-INDEPENDENT (documented — the mode governs
 * attention, not social trust) and is therefore not adjusted here.
 *
 * Deterministic and pure; the shipped heuristic model and the diversity
 * stage both read THIS value, so the mode measurably changes behavior
 * (J18) without ever silently optimizing for maximum time spent.
 */
export function attentionAdjustedDials(
  policy: Pick<RecommendationPolicy, "attentionMode" | "exploration" | "novelty">,
): { exploration: number; novelty: number } {
  const exploration = clampDial(policy.exploration);
  const novelty = clampDial(policy.novelty);
  if (policy.attentionMode === "mindful") {
    return {
      exploration: Math.max(exploration, MINDFUL_EXPLORATION_FLOOR),
      novelty: Math.max(novelty, MINDFUL_NOVELTY_FLOOR),
    };
  }
  return { exploration, novelty };
}

/**
 * Derive the attention constraints from the policy. Deterministic and pure;
 * the derived values are recorded by the policy stage as an "attention-policy"
 * trace decision and enforced downstream.
 */
export function attentionConstraints(policy: RecommendationPolicy): AttentionConstraints {
  const explicitMinutes =
    typeof policy.maxSessionExtensionMinutes === "number" &&
    Number.isFinite(policy.maxSessionExtensionMinutes)
      ? Math.max(0, policy.maxSessionExtensionMinutes)
      : null;
  // R05: mindful carries the default time budget when the user set none —
  // an explicit value (any mode) always wins.
  const minutes =
    explicitMinutes !== null
      ? explicitMinutes
      : policy.attentionMode === "mindful"
        ? MINDFUL_DEFAULT_MAX_SESSION_EXTENSION_MINUTES
        : null;
  const dials = attentionAdjustedDials(policy);

  switch (policy.attentionMode) {
    case "mindful":
      return {
        attentionMode: "mindful",
        maxConsecutiveSameObjective: MINDFUL_MAX_CONSECUTIVE_SAME_OBJECTIVE,
        maxSessionExtendingChain: MINDFUL_MAX_SESSION_EXTENDING_CHAIN,
        maxSessionExtensionMinutes: minutes,
        exploration: dials.exploration,
        novelty: dials.novelty,
      };
    case "balanced":
      return {
        attentionMode: "balanced",
        maxConsecutiveSameObjective: null,
        maxSessionExtendingChain: BALANCED_MAX_SESSION_EXTENDING_CHAIN,
        maxSessionExtensionMinutes: minutes,
        exploration: dials.exploration,
        novelty: dials.novelty,
      };
    case "immersive":
      return {
        attentionMode: "immersive",
        maxConsecutiveSameObjective: null,
        maxSessionExtendingChain: null,
        maxSessionExtensionMinutes: minutes,
        exploration: dials.exploration,
        novelty: dials.novelty,
      };
    case "custom":
      return {
        attentionMode: "custom",
        maxConsecutiveSameObjective: null,
        maxSessionExtendingChain: null,
        maxSessionExtensionMinutes: minutes,
        exploration: dials.exploration,
        novelty: dials.novelty,
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
 *
 * R05 (J16) — THE EXPLICIT-NARROWING YIELD: when `narrowedObjective` is
 * provided (the objective of an explicitly submitted persistent intent),
 * cards carrying THAT objective are always placeable — their runs are
 * unbounded. The user's standing ask wins over the exploration-derived cap;
 * the diversity stage records the yield honestly (see diversity.ts). The
 * attention-mode gaps (mindful) are NOT narrowed-objective-aware in the
 * policy stage — the user's explicit ATTENTION choice outranks their topic
 * narrowing (mindful means intentional variety, documented).
 */
export function breakDominantObjectiveRuns(
  ranked: readonly ScoredCandidate[],
  maxConsecutive: number,
  narrowedObjective: string | null = null,
): SweepResult {
  const decisions: TraceDecision[] = [];
  const remaining = [...ranked];
  const out: ScoredCandidate[] = [];
  let lastObjective: string | null = null;
  let runLength = 0;

  while (remaining.length > 0) {
    const placeableIndex = remaining.findIndex((item) => {
      const objective = item.features.dominantObjective;
      if (objective !== null && objective === narrowedObjective) return true; // the explicit narrowing yields
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
