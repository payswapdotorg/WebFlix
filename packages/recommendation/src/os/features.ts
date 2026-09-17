/**
 * Recommendation OS — feature assembly (WFX-021, Lane A).
 *
 * `assembleFeatures(ctx)` — the second pipeline stage: one typed
 * `CandidateFeatures` record per pool candidate, aligned 1:1 with
 * `ctx.candidatePool` by index. Deterministic: EVERY feature is computable
 * from `ctx` alone — no I/O, no clocks, no randomness.
 *
 * Feature inventory (each documented, each surfaced to the model):
 * - intent-match per scope — the candidate's text surface vs each intent's
 *   objective tokens (the SAME matching semantics as the merged WFX-020
 *   `rankForIntents`: lowercase, whitespace-split, tokens of at least 3
 *   characters, substring containment; strength = weight * confidence;
 *   re-implemented here because retrieval's matcher is private and operates
 *   on `RetrievedCandidate`, while the frozen ctx carries flat candidates).
 * - freshness — content age vs the session anchor, read from the documented
 *   candidate feature key `publishedAt` (ISO 8601); `1 / (1 + ageDays)`,
 *   neutral 0.5 when the key or the anchor is absent.
 * - repetition count / fatigue — from recentEvents (see fatigue.ts).
 * - source availability ratio — distinct realization reports of the item
 *   present in the pool, available/total. The frozen flat candidate carries
 *   ONE realization report per pool entry, so per-item aggregation over the
 *   pool is the honest availability signal computable from ctx alone; a
 *   duplicate (connectorId, externalRef) report is collapsed keeping the
 *   LAST occurrence (re-report replacement, mirroring the index's
 *   whole-realization replacement semantics).
 * - duration/orientation fit for the REQUESTED surface — documented tables
 *   and targets (see constants below).
 * - exploration flag — unseen item (no non-impression events, see events.ts).
 * - social signal strength — sum of matched SOCIAL-scope strengths.
 *
 * Malformed ctx is a typed aggregated `RecommendationOSError` — never a
 * silent coercion (see validate.ts).
 */

import {
  isRecord,
  type EntertainmentCandidate,
  type RecommendationContext,
} from "@wfx/domain";

import {
  anchorIsoOf,
  anchorEpochOf,
  seenItemIds,
} from "./events";
import { DAY_MS, repetitionSignal } from "./fatigue";
import type {
  CandidateFeatures,
  FeatureSet,
  ItemOrientation,
  MatchedIntentSignal,
} from "./types";
import { assertValidContext } from "./validate";

/** The realization availability union of the frozen flat candidate. */
type CandidateAvailability = EntertainmentCandidate["realization"]["availability"];

// ---------------------------------------------------------------------------
// Documented constants
// ---------------------------------------------------------------------------

/**
 * Minimum objective-token length that can match (skips short function
 * words). Mirrors the merged retrieval constant
 * `INTENT_MATCH_MIN_TOKEN_LENGTH` (WFX-020) so both matchers agree by law.
 */
export const INTENT_TOKEN_MIN_LENGTH = 3;

/** Freshness assigned when content age is unknown (no `publishedAt` / no anchor). */
export const NEUTRAL_FRESHNESS = 0.5;

/**
 * Duration-fit target for the watch (long-form) surface: an item at or above
 * this duration reaches fit 1.0 (`durationMs / target`, clamped to [0, 1]).
 */
export const WATCH_DURATION_FIT_TARGET_MS = 1_800_000; // 30 minutes

/**
 * Duration-fit target for the short (vertical) surface: an item at or below
 * this duration reaches fit 1.0 (`target / durationMs`, clamped to [0, 1]).
 */
export const SHORT_DURATION_FIT_TARGET_MS = 90_000; // 90 seconds

/**
 * Orientation fit, per surface (documented tables). Vertical is the short
 * feed's native orientation; horizontal is the watch feed's. "unknown" is
 * honestly mid-tier (audio items legitimately report unknown).
 */
export const ORIENTATION_FIT: Readonly<
  Record<RecommendationContext["surface"], Readonly<Record<ItemOrientation, number>>>
> = Object.freeze({
  watch: Object.freeze({
    horizontal: 1,
    unknown: 0.5,
    square: 0.5,
    vertical: 0.25,
  }),
  short: Object.freeze({
    vertical: 1,
    square: 0.5,
    unknown: 0.5,
    horizontal: 0,
  }),
});

/** Documented candidate feature key carrying the content's publish instant. */
export const CANDIDATE_FEATURE_PUBLISHED_AT = "publishedAt";

/** Documented candidate feature key carrying the preceding episode's item id. */
export const CANDIDATE_FEATURE_NEXT_EPISODE_OF = "nextEpisodeOf";

/**
 * R05 — documented candidate feature key carrying the item's topic tag
 * (the anti-tunnel diversity key when no intent matches). Graph-aware
 * callers populate it from the Entertainment Graph's topic clusters; the
 * OS never guesses a topic from titles.
 */
export const CANDIDATE_FEATURE_TOPIC = "topic";

/**
 * R05 — documented candidate feature key carrying the item's creator id
 * (the `dont-recommend-creator` feedback target). Graph-aware callers
 * populate it from the item's creator relations; candidates without it are
 * never creator-suppressed (the OS never guesses a creator).
 */
export const CANDIDATE_FEATURE_CREATOR_ID = "creatorId";

/**
 * R05 — the anti-tunnel diversity key of one scored candidate: the dominant
 * matched objective when an intent matched, else the documented `topic`
 * feature (read from the candidate's raw feature record), else null (no
 * monoculture signal — run-neutral). Concentration and run-cap machinery
 * key on THIS so that WATCH-DRIVEN concentration (no intents, pure topic
 * watching — the J16 scenario) is still subject to the exploration dial's
 * diversity floor, not just intent-driven runs.
 */
export function diversityKeyOf(item: {
  /** The typed feature record (carries the dominant matched objective). */
  readonly features: { readonly dominantObjective: string | null };
  /** The pool candidate (its raw feature record carries the topic tag). */
  readonly candidate: { readonly features: Record<string, number | string | boolean> };
}): string | null {
  if (item.features.dominantObjective !== null) return item.features.dominantObjective;
  const value = item.candidate.features[CANDIDATE_FEATURE_TOPIC];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Candidate surface helpers
// ---------------------------------------------------------------------------

/**
 * The candidate's text surface for intent matching: `features.matchText`
 * when present (the index's lowercase title + resolved creator/topic names
 * + type + orientation), else a lowercased `features.canonicalTitle`, else
 * null (no text signal — the candidate can match no intent).
 */
function textSurfaceOf(candidateIndex: number, ctx: RecommendationContext): string | null {
  const features = ctx.candidatePool[candidateIndex]?.features;
  if (isRecord(features) && typeof features.matchText === "string") {
    return features.matchText.toLowerCase();
  }
  if (isRecord(features) && typeof features.canonicalTitle === "string") {
    return features.canonicalTitle.toLowerCase();
  }
  return null;
}

/** Objective tokens: lowercase, whitespace-split, min-length filtered. */
export function objectiveTokens(objective: string): string[] {
  return objective
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= INTENT_TOKEN_MIN_LENGTH);
}

/** Read a string feature value from a candidate (typed, null when absent). */
function stringFeature(candidateIndex: number, ctx: RecommendationContext, key: string): string | null {
  const value = ctx.candidatePool[candidateIndex]?.features[key];
  return typeof value === "string" ? value : null;
}

/** Read a finite non-negative number feature (null when absent or invalid). */
function numberFeature(
  candidateIndex: number,
  ctx: RecommendationContext,
  key: string,
): number | null {
  const value = ctx.candidatePool[candidateIndex]?.features[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Clamp a number into [0, 1]. */
function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Availability aggregation
// ---------------------------------------------------------------------------

/** Per-item availability aggregation across the pool (distinct pair keys). */
interface AvailabilityAggregate {
  realizationReports: number;
  availableRealizations: number;
}

/**
 * Aggregate realization availability per canonical item: distinct
 * (connectorId, externalRef) pairs; the LAST occurrence of a duplicated pair
 * wins (re-report replacement). availableRealizations counts pairs whose
 * winning availability is exactly "available" ("unknown" is NOT available —
 * unconfirmed is not playable).
 */
function availabilityByItem(ctx: RecommendationContext): Map<string, AvailabilityAggregate> {
  const byItem = new Map<string, Map<string, CandidateAvailability>>();
  for (const candidate of ctx.candidatePool) {
    let pairs = byItem.get(candidate.itemId);
    if (pairs === undefined) {
      pairs = new Map();
      byItem.set(candidate.itemId, pairs);
    }
    const pairKey = `${candidate.realization.connectorId}\u0000${candidate.realization.externalRef}`;
    pairs.set(pairKey, candidate.realization.availability);
  }
  const aggregates = new Map<string, AvailabilityAggregate>();
  for (const [itemId, pairs] of byItem) {
    let available = 0;
    for (const availability of pairs.values()) {
      if (availability === "available") available += 1;
    }
    aggregates.set(itemId, {
      realizationReports: pairs.size,
      availableRealizations: available,
    });
  }
  return aggregates;
}

// ---------------------------------------------------------------------------
// Feature assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the typed per-candidate feature records (the pipeline's feature
 * stage). Pure and deterministic: identical ctx yields identical features.
 *
 * Throws a typed aggregated `RecommendationOSError` (kind "invalid-input")
 * on malformed ctx — never coerces.
 */
export function assembleFeatures(ctx: RecommendationContext): FeatureSet {
  assertValidContext(ctx);

  const anchorEpoch = anchorEpochOf(ctx.recentEvents);
  const anchorAt = anchorIsoOf(ctx.recentEvents);
  const seen = seenItemIds(ctx.recentEvents);
  const availability = availabilityByItem(ctx);
  const surface = ctx.surface;
  const emptyScopeRecord = Object.freeze({
    persistent: 0,
    temporary: 0,
    session: 0,
    momentary: 0,
    social: 0,
  }) as Record<MatchedIntentSignal["scope"], number>;

  const byCandidate: CandidateFeatures[] = ctx.candidatePool.map((candidate, index) => {
    // --- intent matching (deterministic, ctx order) ---
    const surfaceText = textSurfaceOf(index, ctx);
    const matchedIntents: MatchedIntentSignal[] = [];
    if (surfaceText !== null) {
      for (const intent of ctx.intents) {
        const tokens = objectiveTokens(intent.objective);
        if (tokens.length === 0) continue; // no matchable signal in this objective
        if (tokens.some((token) => surfaceText.includes(token))) {
          matchedIntents.push({
            intentId: intent.id,
            objective: intent.objective,
            scope: intent.scope,
            strength: intent.weight * intent.confidence,
          });
        }
      }
    }
    const intentMatchByScope: Record<MatchedIntentSignal["scope"], number> = {
      ...emptyScopeRecord,
    };
    let nonSocialTotal = 0;
    let socialTotal = 0;
    let strongest: MatchedIntentSignal | null = null;
    for (const signal of matchedIntents) {
      intentMatchByScope[signal.scope] += signal.strength;
      if (signal.scope === "social") {
        socialTotal += signal.strength;
      } else {
        nonSocialTotal += signal.strength;
      }
      if (strongest === null || signal.strength > strongest.strength) {
        strongest = signal; // ties keep the FIRST (ctx order) — deterministic
      }
    }

    // --- freshness (publishedAt vs the session anchor) ---
    const publishedAt = stringFeature(index, ctx, CANDIDATE_FEATURE_PUBLISHED_AT);
    let ageDays: number | null = null;
    let freshness = NEUTRAL_FRESHNESS;
    if (publishedAt !== null && anchorEpoch !== null) {
      const publishedEpoch = Date.parse(publishedAt);
      if (Number.isFinite(publishedEpoch)) {
        ageDays = Math.max(0, (anchorEpoch - publishedEpoch) / DAY_MS);
        freshness = 1 / (1 + ageDays);
      }
    }

    // --- repetition / fatigue ---
    const repetition = repetitionSignal(candidate.itemId, ctx.recentEvents, anchorAt);

    // --- availability ratio ---
    const aggregate = availability.get(candidate.itemId) ?? {
      realizationReports: 0,
      availableRealizations: 0,
    };
    const availabilityRatio =
      aggregate.realizationReports === 0
        ? 0
        : aggregate.availableRealizations / aggregate.realizationReports;

    // --- duration / orientation fit for the requested surface ---
    const durationMs = numberFeature(index, ctx, "durationMs");
    const orientation = stringFeature(index, ctx, "orientation");
    const orientationFit =
      ORIENTATION_FIT[surface][(orientation ?? "unknown") as ItemOrientation];
    const durationFit =
      durationMs === null
        ? NEUTRAL_FRESHNESS // 0.5: duration unknown — neither fit nor misfit
        : surface === "watch"
          ? clampUnit(durationMs / WATCH_DURATION_FIT_TARGET_MS)
          : clampUnit(SHORT_DURATION_FIT_TARGET_MS / Math.max(durationMs, 1));

    return Object.freeze({
      poolIndex: index,
      itemId: candidate.itemId,
      realizationKey: `${candidate.realization.connectorId}\u0000${candidate.realization.externalRef}`,
      matchedIntents: Object.freeze(matchedIntents),
      intentMatchByScope: Object.freeze(intentMatchByScope),
      intentMatchTotal: clampUnit(nonSocialTotal),
      dominantObjective: strongest === null ? null : strongest.objective,
      ageDays,
      freshness,
      repetitionCount: repetition.repetitionCount,
      fatigue: repetition.fatigue,
      realizationReports: aggregate.realizationReports,
      availableRealizations: aggregate.availableRealizations,
      availabilityRatio,
      durationMs,
      orientation: (orientation ?? null) as ItemOrientation | null,
      durationFit,
      orientationFit,
      unseen: !seen.has(candidate.itemId),
      socialMatch: clampUnit(socialTotal),
    }) as CandidateFeatures;
  });

  return {
    byCandidate: Object.freeze(byCandidate),
    anchorAt,
  };
}
