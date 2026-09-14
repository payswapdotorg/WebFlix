/**
 * Recommendation OS — model scoring (WFX-021, Lane A).
 *
 * `score(ctx, features, model)` — the third pipeline stage: invoke the
 * INJECTED `RecommendationModel` (the frozen interface — `score(ctx)`), and
 * attach its verbatim output to every pool candidate of the scored item.
 *
 * Model-injection law (the OS may not hardcode a provider): the model sees
 * the frozen `RecommendationContext` exactly as given. Features are pure,
 * deterministic functions of ctx (`assembleFeatures` is exported from this
 * package), so the shipped heuristic model — and ANY model — can recompute
 * them identically; the `features` argument of this wrapper is used for
 * alignment validation and attachment, never to bypass the model.
 *
 * Model-contract enforcement (typed, honest — no fake success):
 * - output entries must be well-formed `RecommendationScore` records
 *   (itemId string; finite score; finite confidence; string[] explanations);
 * - a score for an itemId NOT in the pool is a contract violation
 *   (`RecommendationOSError` kind "model-contract");
 * - a duplicate itemId in the output is a contract violation;
 * - an item the model OMITTED is never invented and never dropped: it flows
 *   on with `modelScore: null` plus a "model-omitted-score" trace decision.
 *
 * Ordering: model score descending, unscored items after scored ones, ties
 * by pool index ascending. Model scores are never modified — ordering
 * decisions live in the later stages and the trace.
 *
 * `createHeuristicModel()` ships the deterministic, explainable default:
 * a weighted linear combination of the assembled features where every
 * contributing term carries its own explanation string (e.g. `matches
 * session intent "sci-fi" +0.22`), and the policy dials
 * (exploration / novelty / socialInfluence) are MULTIPLIERS on their
 * features. Fatigue enters negatively and is never clamped, preserving the
 * fatigue monotonicity law (see fatigue.ts).
 */

import type {
  IntentScope,
  RecommendationContext,
  RecommendationModel,
  RecommendationScore,
} from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";

import { assembleFeatures } from "./features";
import type { CandidateFeatures, ScoredCandidate, TraceDecision } from "./types";
import { RecommendationOSError } from "./types";
import { assertValidContext, assertValidModel } from "./validate";

// ---------------------------------------------------------------------------
// Scoring stage (injected-model invocation)
// ---------------------------------------------------------------------------

/** Output of the scoring stage. */
export interface ScoringResult {
  /** Scored candidates ordered by model score desc (unscored last), pool order tiebreak. */
  scored: readonly ScoredCandidate[];
  /** Auditable decisions (one "model-omitted-score" per omitted item). */
  decisions: readonly TraceDecision[];
}

/** Field-level validation of one claimed RecommendationScore entry. */
function scoreEntryErrors(entry: unknown, index: number): string[] {
  if (!isRecord(entry)) {
    return [`scores[${index}]: expected a RecommendationScore object, got ${previewValue(entry)}`];
  }
  const errors: string[] = [];
  if (typeof entry.itemId !== "string" || entry.itemId.trim().length === 0) {
    errors.push(`scores[${index}].itemId: expected a non-empty string, got ${previewValue(entry.itemId)}`);
  }
  if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
    errors.push(`scores[${index}].score: expected a finite number, got ${previewValue(entry.score)}`);
  }
  if (typeof entry.confidence !== "number" || !Number.isFinite(entry.confidence)) {
    errors.push(
      `scores[${index}].confidence: expected a finite number, got ${previewValue(entry.confidence)}`,
    );
  }
  if (
    !Array.isArray(entry.explanations) ||
    !entry.explanations.every((explanation) => typeof explanation === "string")
  ) {
    errors.push(
      `scores[${index}].explanations: expected an array of strings, got ${previewValue(entry.explanations)}`,
    );
  }
  return errors;
}

/**
 * Invoke the injected model and attach its verbatim scores.
 *
 * The model's own thrown errors propagate untouched (a model failure is the
 * model's, never rebranded). Returns the ordered scored list plus one trace
 * decision per item the model omitted.
 */
export async function score(
  ctx: RecommendationContext,
  features: { byCandidate: readonly CandidateFeatures[] },
  model: RecommendationModel,
): Promise<ScoringResult> {
  assertValidContext(ctx);
  assertValidModel(model);
  if (features.byCandidate.length !== ctx.candidatePool.length) {
    throw new RecommendationOSError(
      "invalid-input",
      `features: expected one feature record per pool candidate (${ctx.candidatePool.length}), got ${features.byCandidate.length} — reassemble with assembleFeatures(ctx)`,
    );
  }

  const poolItemIds = new Set(ctx.candidatePool.map((candidate) => candidate.itemId));
  const raw = await model.score(ctx);

  if (!Array.isArray(raw)) {
    throw new RecommendationOSError(
      "model-contract",
      `model "${model.id}" v${model.version} returned ${previewValue(raw)} — expected an array of RecommendationScore`,
    );
  }

  const byItem = new Map<string, RecommendationScore>();
  const errors: string[] = [];
  for (const [index, entry] of raw.entries()) {
    errors.push(...scoreEntryErrors(entry, index));
  }
  if (errors.length > 0) {
    throw new RecommendationOSError("model-contract", errors);
  }
  for (const [index, entry] of raw.entries()) {
    const scoreEntry = entry as RecommendationScore;
    if (!poolItemIds.has(scoreEntry.itemId)) {
      errors.push(
        `scores[${index}].itemId "${scoreEntry.itemId}": not present in the context candidate pool — the model may only score the candidates it was given`,
      );
      continue;
    }
    if (byItem.has(scoreEntry.itemId)) {
      errors.push(
        `scores[${index}].itemId "${scoreEntry.itemId}": duplicate score — exactly one score per item`,
      );
      continue;
    }
    byItem.set(scoreEntry.itemId, scoreEntry);
  }
  if (errors.length > 0) {
    throw new RecommendationOSError("model-contract", errors);
  }

  // Attach verbatim model output to every pool candidate of the item.
  const scored: ScoredCandidate[] = ctx.candidatePool.map((candidate, index) => {
    const itemScore = byItem.get(candidate.itemId) ?? null;
    return Object.freeze({
      candidate,
      features: features.byCandidate[index]!,
      modelScore: itemScore === null ? null : itemScore.score,
      confidence: itemScore === null ? null : itemScore.confidence,
      explanations: itemScore === null ? [] : Object.freeze([...itemScore.explanations]),
      availabilityDemoted: false,
    }) as ScoredCandidate;
  });

  // Honest carry: items the model omitted flow on unscored (never dropped,
  // never invented), with a trace decision per item.
  const decisions: TraceDecision[] = [];
  const omitted = [...poolItemIds].filter((itemId) => !byItem.has(itemId));
  for (const itemId of omitted) {
    decisions.push({
      kind: "model-omitted-score",
      detail: `model "${model.id}" v${model.version} returned no score for this item — carried unscored (modelScore null), never dropped and never invented`,
      itemIds: [itemId],
    });
  }

  // Order: model score desc, unscored after scored, pool index tiebreak.
  const ordered = [...scored].sort((a, b) => {
    const aScore = a.modelScore === null ? Number.NEGATIVE_INFINITY : a.modelScore;
    const bScore = b.modelScore === null ? Number.NEGATIVE_INFINITY : b.modelScore;
    if (aScore !== bScore) return bScore - aScore;
    return a.features.poolIndex - b.features.poolIndex;
  });

  return {
    scored: Object.freeze(ordered),
    decisions: Object.freeze(decisions),
  };
}

// ---------------------------------------------------------------------------
// The shipped heuristic default model
// ---------------------------------------------------------------------------

export const HEURISTIC_MODEL_ID = "wfx-heuristic-recommender";
export const HEURISTIC_MODEL_VERSION = "1.0.0";

/** Per-matched-intent weight (non-social scopes). */
export const HEURISTIC_INTENT_WEIGHT = 0.3;

/** Scope weights: long-lived preference strongest, momentary context weakest. */
export const HEURISTIC_SCOPE_WEIGHTS: Readonly<Record<IntentScope, number>> = Object.freeze({
    persistent: 1,
    session: 0.95,
    temporary: 0.9,
    momentary: 0.75,
    social: 1,
  });

/** Base weight of the social term (multiplied by the policy socialInfluence dial). */
export const HEURISTIC_SOCIAL_BASE = 0.15;
/** Base weight of the novelty term (multiplied by the policy novelty dial). */
export const HEURISTIC_NOVELTY_BASE = 0.1;
/** Base weight of the exploration term (multiplied by the policy exploration dial). */
export const HEURISTIC_EXPLORATION_BASE = 0.15;
/** Weight of the source-availability term. */
export const HEURISTIC_AVAILABILITY_WEIGHT = 0.1;
/** Base weight of the surface-fit term (split evenly between duration and orientation fit). */
export const HEURISTIC_SURFACE_FIT_BASE = 0.1;
/** Weight of the fatigue term — SUBTRACTED, never clamped (monotonicity law). */
export const HEURISTIC_FATIGUE_WEIGHT = 0.25;

/** Fixed lower bound of the heuristic confidence before intent evidence. */
export const HEURISTIC_CONFIDENCE_BASE = 0.5;
/** Confidence added per matched non-social intent (capped at 1). */
export const HEURISTIC_CONFIDENCE_PER_INTENT = 0.25;

/** Round a term contribution for explanation strings (auditable, stable). */
function term(value: number): string {
  return value >= 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
}

/**
 * Create the deterministic heuristic default model (one `RecommendationScore`
 * per DISTINCT canonical item in the ctx pool — the frozen score interface is
 * item-keyed; realization selection is the policy stage's dedupe).
 *
 * Item-level features are identical across an item's candidates, so the
 * first pool entry (lowest poolIndex) is the item's representative —
 * deterministic. Explanations cover every contributing term.
 */
export function createHeuristicModel(): RecommendationModel {
  return {
    id: HEURISTIC_MODEL_ID,
    version: HEURISTIC_MODEL_VERSION,
    async score(ctx: RecommendationContext): Promise<RecommendationScore[]> {
      // assembleFeatures validates the ctx (typed error on malformed input).
      const { byCandidate } = assembleFeatures(ctx);

      // One feature record per distinct item (first pool entry wins).
      const representative = new Map<string, CandidateFeatures>();
      for (const features of byCandidate) {
        if (!representative.has(features.itemId)) representative.set(features.itemId, features);
      }

      const surface = ctx.surface;
      const policy = ctx.policy;
      const scores: RecommendationScore[] = [];
      for (const features of representative.values()) {
        const explanations: string[] = [];
        let total = 0;
        let nonSocialMatches = 0;

        // Intent terms (per matched non-social intent, scope-weighted).
        for (const signal of features.matchedIntents) {
          if (signal.scope === "social") continue; // handled by the social term
          const contribution =
            HEURISTIC_INTENT_WEIGHT *
            HEURISTIC_SCOPE_WEIGHTS[signal.scope] *
            signal.strength;
          total += contribution;
          nonSocialMatches += 1;
          explanations.push(
            `matches ${signal.scope} intent "${signal.objective}" ${term(contribution)}`,
          );
        }

        // Social term — policy socialInfluence dial as multiplier.
        if (features.socialMatch > 0) {
          const socialIntents = features.matchedIntents
            .filter((signal) => signal.scope === "social")
            .map((signal) => `"${signal.objective}"`)
            .join(", ");
          const contribution = HEURISTIC_SOCIAL_BASE * policy.socialInfluence * features.socialMatch;
          total += contribution;
          explanations.push(
            `social intent ${socialIntents} (socialInfluence ${policy.socialInfluence}) ${term(contribution)}`,
          );
        }

        // Novelty term — policy novelty dial as multiplier on freshness.
        if (features.freshness > 0 && policy.novelty > 0) {
          const contribution = HEURISTIC_NOVELTY_BASE * policy.novelty * features.freshness;
          total += contribution;
          explanations.push(
            `freshness ${features.freshness.toFixed(3)} (novelty ${policy.novelty}) ${term(contribution)}`,
          );
        }

        // Exploration term — policy exploration dial as multiplier on unseen.
        if (features.unseen) {
          const contribution = HEURISTIC_EXPLORATION_BASE * policy.exploration;
          total += contribution;
          explanations.push(
            `unseen item — exploration appetite (exploration ${policy.exploration}) ${term(contribution)}`,
          );
        }

        // Source availability term.
        if (features.availabilityRatio > 0) {
          const contribution =
            HEURISTIC_AVAILABILITY_WEIGHT * features.availabilityRatio;
          total += contribution;
          explanations.push(
            `source availability ${features.availableRealizations}/${features.realizationReports} ${term(contribution)}`,
          );
        }

        // Surface-fit term (duration + orientation, evenly split).
        const durationContribution =
          HEURISTIC_SURFACE_FIT_BASE * 0.5 * features.durationFit;
        total += durationContribution;
        explanations.push(
          `duration fit for ${surface} ${features.durationFit.toFixed(3)} ${term(durationContribution)}`,
        );
        const orientationContribution =
          HEURISTIC_SURFACE_FIT_BASE * 0.5 * features.orientationFit;
        total += orientationContribution;
        explanations.push(
          `orientation fit for ${surface} (${features.orientation ?? "unknown"}) ${features.orientationFit.toFixed(3)} ${term(orientationContribution)}`,
        );

        // Fatigue term — SUBTRACTED, unclamped (monotonicity law).
        if (features.fatigue > 0) {
          const contribution = -HEURISTIC_FATIGUE_WEIGHT * features.fatigue;
          total += contribution;
          explanations.push(
            `fatigue: ${features.repetitionCount} recent repeat(s), recency-weighted ${features.fatigue.toFixed(3)} ${term(contribution)}`,
          );
        }

        const confidence = Math.min(
          1,
          HEURISTIC_CONFIDENCE_BASE +
            HEURISTIC_CONFIDENCE_PER_INTENT * nonSocialMatches,
        );

        scores.push({
          itemId: features.itemId,
          score: total,
          explanations: Object.freeze(explanations) as string[],
          confidence,
        });
      }

      return scores;
    },
  };
}
