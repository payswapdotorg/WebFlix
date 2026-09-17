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

import { diversityKeyOf } from "./features";
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
 * R05 — Mindful: the mode's own EXPLORATION FLOOR. Mindful guards the
 * user's exploration capability even when the raw dial was left low: the
 * effective exploration the diversity machinery consumes is never below
 * this value in mindful mode (the time-budget/novelty signals of the J18
 * law — a mode, not a cosmetic setting).
 */
export const MINDFUL_MIN_EFFECTIVE_EXPLORATION = 0.5;

/**
 * R05 — Mindful: the mode's own TIME BUDGET. When the policy sets no
 * explicit `maxSessionExtensionMinutes`, mindful imposes this default cap
 * on OS-PLANNED session extension (minutes) — the system does not silently
 * optimize for maximum time spent when another mode is selected (the
 * user's own playback is never interrupted; the budget bounds what the OS
 * chains on its own). Explicit caps (any mode) always win when smaller;
 * larger explicit caps are narrowed to this mode ceiling (mindful never
 * extends beyond its budget).
 */
export const MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES = 60;

/**
 * R05 — Mindful: the NOVELTY WEIGHTING — fresh content (known `publishedAt`)
 * receives this rank weight per unit of freshness, applied by the policy
 * stage as a traced adjustment (model scores untouched). Measurable mode
 * behavior: mindful reorders fresh-above-stale; immersive does not.
 */
export const MINDFUL_NOVELTY_RANK_WEIGHT = 0.05;

/**
 * Maximum (breakRuns, breakChains) repair sweeps composition alternates
 * before recording a residual constraint decision (bounded termination —
 * repairs move items strictly later, so conflicts converge in practice).
 */
export const MAX_SWEEP_PASSES = 4;

/**
 * R05 — the mode-derived effective exploration dial (the J18 "exploration
 * weight" signal): mindful floors the dial at
 * `MINDFUL_MIN_EFFECTIVE_EXPLORATION` (never below 0.5); every other mode
 * passes the user's dial through unchanged (clamped to [0,1]). The
 * diversity stage's run cap K and concentration threshold X derive from
 * THIS value, so mindful measurably retains exploration capability even
 * with a low raw dial.
 */
export function attentionEffectiveExploration(
  policy: RecommendationPolicy,
): number {
  const raw = Math.min(1, Math.max(0, policy.exploration));
  if (policy.attentionMode !== "mindful") return raw;
  return Math.max(raw, MINDFUL_MIN_EFFECTIVE_EXPLORATION);
}

/**
 * R05 — the mode-derived session-extension budget (the J18 "time-budget
 * signal"): the policy's explicit cap when present, else the mindful
 * default when the mode is mindful, else null (no cap). In mindful mode an
 * explicit cap LARGER than the mode ceiling is narrowed to the ceiling
 * (the mode is policy, not a suggestion).
 */
export function attentionSessionExtensionBudget(
  policy: RecommendationPolicy,
): number | null {
  const explicit =
    typeof policy.maxSessionExtensionMinutes === "number" &&
    Number.isFinite(policy.maxSessionExtensionMinutes)
      ? Math.max(0, policy.maxSessionExtensionMinutes)
      : null;
  if (policy.attentionMode === "mindful") {
    if (explicit === null) return MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES;
    return Math.min(explicit, MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES);
  }
  return explicit;
}

/**
 * Derive the attention constraints from the policy. Deterministic and pure;
 * the derived values are recorded by the policy stage as an "attention-policy"
 * trace decision and enforced downstream. R05: mindful derives its OWN time
 * budget when none was set (`attentionSessionExtensionBudget`).
 */
export function attentionConstraints(policy: RecommendationPolicy): AttentionConstraints {
  const minutes = attentionSessionExtensionBudget(policy);

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
 * cards share the same diversity key (the dominant matched objective, or —
 * R05 — the documented `topic` feature when no intent matched: watch-driven
 * topic runs are subject to the same anti-tunnel law). Cards with a null
 * diversity key are run-neutral (they carry no monoculture signal and break
 * runs). Extenders are demoted BELOW the next placeable card (never
 * deleted). When every remaining card shares one key (no alternative
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
      const objective = diversityKeyOf(item);
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

    const objective = diversityKeyOf(placed);
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
