/**
 * Recommendation OS — feed composition (WFX-021, Lane A).
 *
 * `composeFeed(surface, ranked, ctx)` — the sixth pipeline stage. Feed mode
 * comes from the REQUESTED SURFACE and the session context ONLY — never
 * from the source: no connector id, capability, or realization field ever
 * influences the feed mode (frozen architecture: "Source does not choose
 * feed mode; content and session context do").
 *
 * WATCH (long-form) composition, in order:
 * 1. Resume-aware ordering — in-progress items (latest start/progress newer
 *    than latest complete, see events.ts) are placed first, in incoming
 *    rank order. A resume is the user's own continuation: it never counts
 *    toward session-extending chains or minutes.
 * 2. Episodic continuity — next-episode adjacency WHEN THE GRAPH SAYS SO:
 *    the frozen ctx carries no graph relations, so adjacency reaches the OS
 *    through the documented candidate feature key `nextEpisodeOf` (the
 *    canonical id of the preceding episode), which graph-aware callers
 *    populate from `ItemRelationship` edges. The OS NEVER guesses adjacency
 *    from titles. Successors are placed adjacent to their anchor and chain
 *    transitively, subject to the attention chain cap and the
 *    session-extension minutes cap (placements that would exceed a cap are
 *    demoted to the remainder with a trace reason — never removed; items
 *    with unknown duration are never chained under a minutes cap: the OS
 *    refuses to extend a session it cannot measure).
 * 3. Long-form preference — the remainder partitions long items
 *    (durationMs >= WATCH_LONG_ITEM_MS) before shorter/unknown ones,
 *    incoming order preserved within each partition.
 * 4. Availability floor tail — policy-demoted items hold the very tail.
 *
 * SHORT (vertical) composition — tiered ordering, incoming order preserved
 * within every tier (the policy+diversity rank is never re-sorted away):
 * orientation tier (vertical first) -> session-intent boost tier (matched
 * before unmatched — session-aware ranking; the ordering re-derives from
 * the live session-scope match, which is the rapid-replacement signal) ->
 * micro-duration tier (<= SHORT_MICRO_ITEM_MS preferred) -> incoming order.
 * No episodic chaining in the short feed (rapid candidate replacement, not
 * continuity); the run cap is still enforced by the final sweep.
 *
 * Final invariant sweeps (both surfaces): the composition reorders for the
 * surface, so the attention law is re-enforced AFTER reordering —
 * `breakDominantObjectiveRuns` (effective run cap) and
 * `breakSessionChains` (watch only) alternate up to MAX_SWEEP_PASSES; a
 * non-converging residual is recorded as a "constraint-residual" decision
 * (honest, bounded termination — the output invariant is what the law
 * protects, and the pool is never narrowed).
 *
 * Every card carries its position reasons, and one "position" trace
 * decision is emitted per card — end-to-end explainability.
 */

import type { EntertainmentCandidate, RecommendationContext } from "@wfx/domain";

import {
  MAX_SWEEP_PASSES,
  attentionConstraints,
  breakDominantObjectiveRuns,
  breakSessionChains,
  nextEpisodeOf,
} from "./attention";
import { consumedItemIds, inProgressItemIds } from "./events";
import { effectiveRunCap } from "./diversity";
import type { FeedCard, FeedSurface, ScoredCandidate, TraceDecision } from "./types";
import { assertValidContext } from "./validate";

// ---------------------------------------------------------------------------
// Documented constants
// ---------------------------------------------------------------------------

/** Duration at or above which an item is "long-form" in the watch feed. */
export const WATCH_LONG_ITEM_MS = 1_200_000; // 20 minutes

/** Duration at or below which an item is "micro" in the short feed. */
export const SHORT_MICRO_ITEM_MS = 180_000; // 3 minutes

/** Output of the composition stage. */
export interface CompositionResult {
  cards: readonly FeedCard[];
  decisions: readonly TraceDecision[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Frozen defensive copy of a pool candidate (ctx objects never handed out raw). */
export function frozenCandidateCopy(candidate: EntertainmentCandidate): EntertainmentCandidate {
  return Object.freeze({
    ...candidate,
    realization: Object.freeze({
      ...candidate.realization,
      capabilities: Object.freeze([...candidate.realization.capabilities]) as string[],
    }),
    features: Object.freeze({ ...candidate.features }),
  });
}

/** Session-intent objectives matched by an item (for reason strings). */
function sessionObjectives(item: ScoredCandidate): string[] {
  return item.features.matchedIntents
    .filter((signal) => signal.scope === "session")
    .map((signal) => `"${signal.objective}"`);
}

/** Short-feed orientation tier: vertical 0, square/unknown 1, horizontal 2. */
function shortOrientationTier(item: ScoredCandidate): number {
  switch (item.features.orientation) {
    case "vertical":
      return 0;
    case "horizontal":
      return 2;
    default:
      return 1; // square or unknown — honestly mid-tier
  }
}

/** Watch-feed duration tier: long items 0, shorter/unknown 1. */
function watchDurationTier(item: ScoredCandidate): number {
  return item.features.durationMs !== null && item.features.durationMs >= WATCH_LONG_ITEM_MS
    ? 0
    : 1;
}

/** Short-feed micro-duration tier: micro 0, longer/unknown 1. */
function shortMicroTier(item: ScoredCandidate): number {
  return item.features.durationMs !== null && item.features.durationMs <= SHORT_MICRO_ITEM_MS
    ? 0
    : 1;
}

/** Are these two orders the same sequence? */
function sameOrder(a: readonly ScoredCandidate[], b: readonly ScoredCandidate[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

/**
 * Compose the feed for the requested surface. Pure and deterministic; the
 * input is never mutated; every card is placed with recorded reasons.
 */
export function composeFeed(
  surface: FeedSurface,
  ranked: readonly ScoredCandidate[],
  ctx: RecommendationContext,
): CompositionResult {
  assertValidContext(ctx);
  return surface === "watch"
    ? composeWatchFeed(ranked, ctx)
    : composeShortFeed(ranked, ctx);
}

// ---------------------------------------------------------------------------
// Watch (long-form) composition
// ---------------------------------------------------------------------------

function composeWatchFeed(
  ranked: readonly ScoredCandidate[],
  ctx: RecommendationContext,
): CompositionResult {
  const decisions: TraceDecision[] = [];
  const constraints = attentionConstraints(ctx.policy);
  const consumed = consumedItemIds(ctx.recentEvents);
  const resumeIds = inProgressItemIds(ctx.recentEvents);
  const minutesCapMs =
    constraints.maxSessionExtensionMinutes === null
      ? null
      : constraints.maxSessionExtensionMinutes * 60_000;

  const reasonsByItem = new Map<string, string[]>();
  const placed: ScoredCandidate[] = [];
  const remaining = [...ranked];
  const blockedFromChaining = new Set<string>();

  const addReason = (item: ScoredCandidate, reason: string): void => {
    const list = reasonsByItem.get(item.candidate.itemId);
    if (list === undefined) reasonsByItem.set(item.candidate.itemId, [reason]);
    else list.push(reason);
  };

  let chainDepth = 0;
  let accumulatedExtensionMs = 0;

  /** Place an item as OS-planned session extension (cap-checked) or not. */
  const place = (item: ScoredCandidate, asExtension: boolean): boolean => {
    if (asExtension) {
      if (
        constraints.maxSessionExtendingChain !== null &&
        chainDepth >= constraints.maxSessionExtendingChain
      ) {
        decisions.push({
          kind: "chain-cap",
          detail: `session-extending chain reached cap ${constraints.maxSessionExtendingChain} — ${item.candidate.itemId} demoted to the feed remainder (never removed)`,
          itemIds: [item.candidate.itemId],
        });
        blockedFromChaining.add(item.candidate.itemId);
        return false;
      }
      if (minutesCapMs !== null) {
        if (item.features.durationMs === null) {
          decisions.push({
            kind: "session-extension-cap",
            detail: `${item.candidate.itemId} has unknown duration — the ${constraints.maxSessionExtensionMinutes}-minute session-extension cap cannot be verified — demoted to the feed remainder (never removed; the OS refuses to extend a session it cannot measure)`,
            itemIds: [item.candidate.itemId],
          });
          blockedFromChaining.add(item.candidate.itemId);
          return false;
        }
        if (accumulatedExtensionMs + item.features.durationMs > minutesCapMs) {
          decisions.push({
            kind: "session-extension-cap",
            detail: `chaining ${item.candidate.itemId} (${(item.features.durationMs / 60_000).toFixed(1)} min) would extend the session to ${((accumulatedExtensionMs + item.features.durationMs) / 60_000).toFixed(1)} min, past the ${constraints.maxSessionExtensionMinutes}-minute cap — demoted to the feed remainder (never removed)`,
            itemIds: [item.candidate.itemId],
          });
          blockedFromChaining.add(item.candidate.itemId);
          return false;
        }
        accumulatedExtensionMs += item.features.durationMs;
      }
      chainDepth += 1;
    } else {
      chainDepth = 0;
    }
    placed.push(item);
    const index = remaining.indexOf(item);
    if (index >= 0) remaining.splice(index, 1);
    return true;
  };

  /** Attach the transitive next-episode successors of one anchor. */
  const drainChains = (anchor: ScoredCandidate): void => {
    const queue: ScoredCandidate[] = [anchor];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (;;) {
        const successor = remaining.find(
          (item) =>
            !blockedFromChaining.has(item.candidate.itemId) &&
            nextEpisodeOf(item) === current.candidate.itemId,
        );
        if (successor === undefined) break;
        const anchorId = current.candidate.itemId;
        const placedOk = place(successor, true);
        if (!placedOk) break;
        addReason(
          successor,
          `episodic-continuity: next episode of ${anchorId} (graph relation via the nextEpisodeOf feature) — placed adjacent for continuity`,
        );
        queue.push(successor);
      }
    }
  };

  // Phase 1 — resume block (user-driven continuation; never capped, never counted).
  for (const item of ranked) {
    if (!resumeIds.has(item.candidate.itemId)) continue;
    if (!remaining.includes(item)) continue;
    place(item, false);
    addReason(
      item,
      "resume-continuation: in-progress watch (latest start/progress newer than latest complete) — placed first for resume",
    );
    drainChains(item);
  }

  // Phase 2 — continuation chains anchored on consumed (watched) items.
  for (const item of ranked) {
    if (!remaining.includes(item) || blockedFromChaining.has(item.candidate.itemId)) continue;
    const next = nextEpisodeOf(item);
    if (next === null || !consumed.has(next)) continue;
    const placedOk = place(item, true);
    if (!placedOk) continue;
    addReason(
      item,
      `episodic-continuity: next episode of watched item ${next} — continues what the user consumed`,
    );
    drainChains(item);
  }

  // Phase 3 — remainder: long-form preference partition, incoming order within.
  const rest = remaining.filter((item) => !item.availabilityDemoted);
  const longForm = rest.filter((item) => watchDurationTier(item) === 0);
  const shorter = rest.filter((item) => watchDurationTier(item) !== 0);
  for (const item of longForm) {
    addReason(
      item,
      `long-form-preference: duration ${(item.features.durationMs! / 60_000).toFixed(1)} min >= ${(WATCH_LONG_ITEM_MS / 60_000).toFixed(0)} min — longer items preferred in the watch feed`,
    );
    place(item, false);
  }
  for (const item of shorter) {
    addReason(
      item,
      "watch-remainder: duration below the long-form threshold or unknown — placed after long-form items (policy+diversity order preserved)",
    );
    place(item, false);
  }

  // Phase 4 — availability floor tail (policy demotion holds at the very tail).
  for (const item of remaining) {
    if (!item.availabilityDemoted) continue;
    addReason(
      item,
      "availability-tail-placement: zero available realizations — the policy availability floor holds at the feed tail",
    );
    place(item, false);
  }

  // Phase 5 — final invariant sweeps (runs + chains), bounded alternation.
  const runCap = effectiveRunCap(ctx.policy);
  let order: ScoredCandidate[] = [...placed];
  let lastSwept = false;
  for (let pass = 0; pass < MAX_SWEEP_PASSES; pass += 1) {
    let changed = false;

    const runSweep = breakDominantObjectiveRuns(order, runCap);
    if (!sameOrder(runSweep.ranked, order)) {
      order = [...runSweep.ranked];
      changed = true;
    }
    decisions.push(...runSweep.decisions);

    if (constraints.maxSessionExtendingChain !== null) {
      const chainSweep = breakSessionChains(
        order,
        constraints.maxSessionExtendingChain,
        consumed,
        resumeIds,
      );
      if (!sameOrder(chainSweep.ranked, order)) {
        order = [...chainSweep.ranked];
        changed = true;
      }
      decisions.push(...chainSweep.decisions);
    }

    if (!changed) {
      lastSwept = false;
      break;
    }
    lastSwept = true;
  }
  if (lastSwept) {
    decisions.push({
      kind: "constraint-residual",
      detail: `attention constraints did not fully converge within ${MAX_SWEEP_PASSES} sweep passes — residual recorded honestly (pool never narrowed; every card still carries its placement reasons)`,
      itemIds: order.map((item) => item.candidate.itemId),
    });
  }

  return finishCards(order, reasonsByItem, decisions, ctx);
}

// ---------------------------------------------------------------------------
// Short (vertical) composition
// ---------------------------------------------------------------------------

function composeShortFeed(
  ranked: readonly ScoredCandidate[],
  ctx: RecommendationContext,
): CompositionResult {
  const decisions: TraceDecision[] = [];
  const reasonsByItem = new Map<string, string[]>();

  const addReason = (item: ScoredCandidate, reason: string): void => {
    const list = reasonsByItem.get(item.candidate.itemId);
    if (list === undefined) reasonsByItem.set(item.candidate.itemId, [reason]);
    else list.push(reason);
  };

  // Tiered stable sort: orientation -> session boost -> micro duration ->
  // incoming order. The incoming (policy+diversity) order is preserved
  // within every tier — the surface never re-sorts the rank away.
  const keyed = ranked.map((item, index) => ({
    item,
    index,
    orientationTier: shortOrientationTier(item),
    sessionTier: item.features.intentMatchByScope.session > 0 ? 0 : 1,
    microTier: shortMicroTier(item),
  }));
  keyed.sort(
    (a, b) =>
      a.orientationTier - b.orientationTier ||
      a.sessionTier - b.sessionTier ||
      a.microTier - b.microTier ||
      a.index - b.index,
  );

  let order: ScoredCandidate[] = keyed.map((entry) => entry.item);

  for (const item of order) {
    switch (item.features.orientation) {
      case "vertical":
        addReason(item, "orientation-first: vertical orientation — the short feed is vertical-first");
        break;
      case "horizontal":
        addReason(
          item,
          "orientation-tier: horizontal orientation — lowest orientation tier in the short feed",
        );
        break;
      default:
        addReason(
          item,
          "orientation-tier: square/unknown orientation — mid orientation tier in the short feed",
        );
        break;
    }
    const sessionObjectivesOfItem = sessionObjectives(item);
    if (sessionObjectivesOfItem.length > 0) {
      addReason(
        item,
        `session-intent-boost: matches session intent ${sessionObjectivesOfItem.join(", ")} (session-scope strength ${item.features.intentMatchByScope.session.toFixed(3)}) — session-aware ranking, re-derived per session (rapid candidate replacement)`,
      );
    }
    if (shortMicroTier(item) === 0) {
      addReason(
        item,
        `micro-duration-preference: duration ${(item.features.durationMs! / 1000).toFixed(0)}s <= ${(SHORT_MICRO_ITEM_MS / 1000).toFixed(0)}s — shorter items preferred in the short feed`,
      );
    } else {
      addReason(
        item,
        "duration-tier: duration above the micro threshold or unknown — placed after micro items",
      );
    }
    if (item.availabilityDemoted) {
      addReason(
        item,
        "availability-tail-placement: zero available realizations — the policy availability floor holds at the feed tail",
      );
    }
  }

  // Availability floor tail: demoted items go to the very tail (incoming order).
  const demoted = order.filter((item) => item.availabilityDemoted);
  if (demoted.length > 0) {
    order = [
      ...order.filter((item) => !item.availabilityDemoted),
      ...demoted,
    ];
  }

  // Final invariant sweep: the run cap holds at the output (no episodic
  // chaining in the short feed — rapid replacement, not continuity).
  const runCap = effectiveRunCap(ctx.policy);
  let sweptOrder = order;
  let lastSwept = false;
  for (let pass = 0; pass < MAX_SWEEP_PASSES; pass += 1) {
    const runSweep = breakDominantObjectiveRuns(sweptOrder, runCap);
    decisions.push(...runSweep.decisions);
    if (sameOrder(runSweep.ranked, sweptOrder)) {
      lastSwept = false;
      break;
    }
    sweptOrder = [...runSweep.ranked];
    lastSwept = true;
  }
  if (lastSwept) {
    decisions.push({
      kind: "constraint-residual",
      detail: `objective-run cap did not fully converge within ${MAX_SWEEP_PASSES} sweep passes — residual recorded honestly (pool never narrowed)`,
      itemIds: sweptOrder.map((item) => item.candidate.itemId),
    });
  }

  return finishCards(sweptOrder, reasonsByItem, decisions, ctx);
}

// ---------------------------------------------------------------------------
// Card assembly
// ---------------------------------------------------------------------------

/** Build the frozen cards + per-card "position" trace decisions. */
function finishCards(
  order: readonly ScoredCandidate[],
  reasonsByItem: ReadonlyMap<string, string[]>,
  decisions: TraceDecision[],
  _ctx: RecommendationContext,
): CompositionResult {
  const cards: FeedCard[] = order.map((item, position) => {
    const reasons = Object.freeze([...(reasonsByItem.get(item.candidate.itemId) ?? [])]);
    decisions.push({
      kind: "position",
      detail: `position ${position}: ${reasons.join("; ")}`,
      itemIds: [item.candidate.itemId],
    });
    return Object.freeze({
      position,
      candidate: frozenCandidateCopy(item.candidate),
      modelScore: item.modelScore,
      confidence: item.confidence,
      explanations: item.explanations,
      dominantObjective: item.features.dominantObjective,
      positionReasons: reasons,
    }) as FeedCard;
  });

  return {
    cards: Object.freeze(cards),
    decisions: Object.freeze(decisions),
  };
}
