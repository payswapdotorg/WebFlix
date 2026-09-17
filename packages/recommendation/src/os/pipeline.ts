/**
 * Recommendation OS — the pipeline (WFX-021, Lane A; R05 feedback stage).
 *
 * `runRecommendation(ctx, options?)` — the full ranking pipeline as PURE
 * TypeScript, orchestrating the frozen-architecture stages in order, each a
 * pure function consuming the previous output:
 *
 *   retrieval (pool intake) -> features -> scoring (injected model) ->
 *   feedback controls (R05) -> policy constraints -> intent-aware
 *   diversity -> feed composition
 *
 * Every stage's decision lands in the auditable `PipelineTrace` (stage
 * name, input count, output count, decisions) — recommendations are
 * explainable end-to-end. No I/O, no network, no persistence, no hidden
 * clocks, no randomness: the output is a pure function of (ctx, model,
 * options.feedback).
 *
 * Model injection: `options.model` injects any frozen `RecommendationModel`;
 * the default is the shipped deterministic heuristic
 * (`createHeuristicModel()`). The OS never hardcodes a provider.
 *
 * R05 feedback injection: `options.feedback` is the active profile's
 * reversible control set (see feedback.ts); the OS never fetches it — the
 * caller reads the per-profile records and passes them in. Structural
 * garbage in the set throws the typed error before any stage runs.
 *
 * The retrieval stage is pool INTAKE: candidate generation itself is the
 * merged WFX-020 retrieval index feeding `ctx.candidatePool`; the OS stage
 * validates the pool and materializes frozen defensive copies (the caller's
 * ctx objects are never mutated and never handed back raw).
 */

import type {
  EntertainmentCandidate,
  RecommendationContext,
  RecommendationModel,
} from "@wfx/domain";

import { composeFeed } from "./composition";
import { diversify } from "./diversity";
import { applyFeedback, type RecommendationFeedback } from "./feedback";
import { assembleFeatures } from "./features";
import { applyPolicy } from "./policy";
import { createHeuristicModel, score } from "./scoring";
import type {
  FeedPage,
  PipelineStageRecord,
  TraceDecision,
} from "./types";
import { assertValidContext, assertValidModel } from "./validate";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for `runRecommendation`. */
export interface RunRecommendationOptions {
  /**
   * The injected model (the frozen `RecommendationModel` interface).
   * Defaults to the shipped deterministic heuristic model. The OS may not
   * hardcode a provider — injection is the only model channel.
   */
  model?: RecommendationModel;
  /**
   * R05: the ACTIVE PROFILE's feedback set (the J15 controls — reversible,
   * per-profile records the caller reads from the server and passes in;
   * the OS never fetches). Defaults to the empty set: a run without
   * feedback is byte-identical to the pre-R05 pipeline (minus the trace's
   * empty feedback stage row, which is always present).
   */
  feedback?: readonly RecommendationFeedback[];
}

// ---------------------------------------------------------------------------
// Stage 1 — retrieval (pool intake)
// ---------------------------------------------------------------------------

/** Output of the pool-intake stage. */
export interface IntakeResult {
  /** Frozen defensive copies of the pool candidates, in pool order. */
  pool: readonly EntertainmentCandidate[];
  /** Auditable decisions ("pool-empty" when the pool is empty). */
  decisions: readonly TraceDecision[];
}

/** Frozen defensive copy of one pool candidate (never the caller's object). */
function frozenCandidate(candidate: EntertainmentCandidate): EntertainmentCandidate {
  return Object.freeze({
    ...candidate,
    realization: Object.freeze({
      ...candidate.realization,
      capabilities: Object.freeze([...candidate.realization.capabilities]) as string[],
    }),
    features: Object.freeze({ ...candidate.features }),
  });
}

/**
 * The retrieval stage: intake and freeze the candidate pool. The output
 * count always equals the input count (a validation/materialization pass —
 * surface-agnostic retrieval is upstream, WFX-020; the OS never filters
 * here). An empty pool is an honest result recorded in the trace.
 */
export function intakePool(ctx: RecommendationContext): IntakeResult {
  assertValidContext(ctx);
  const pool = ctx.candidatePool.map(frozenCandidate);
  const decisions: TraceDecision[] =
    pool.length === 0
      ? [
          {
            kind: "pool-empty",
            detail: "candidate pool is empty — an honest result, not an error (the feed is empty and every downstream stage records zero counts)",
            itemIds: [],
          },
        ]
      : [];
  return { pool: Object.freeze(pool), decisions: Object.freeze(decisions) };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full recommendation pipeline for one context.
 *
 * Deterministic: identical (ctx, model) yields an identical FeedPage,
 * trace included. Throws `RecommendationOSError` (kind "invalid-input") on
 * a malformed ctx or model, and (kind "model-contract") when the injected
 * model violates the frozen score interface. A model's own thrown errors
 * propagate untouched.
 */
export async function runRecommendation(
  ctx: RecommendationContext,
  options?: RunRecommendationOptions,
): Promise<FeedPage> {
  assertValidContext(ctx);
  let model: RecommendationModel;
  if (options !== undefined && options.model !== undefined) {
    model = assertValidModel(options.model);
  } else {
    model = createHeuristicModel();
  }

  // --- stage 1: retrieval (pool intake) -----------------------------------
  const intake = intakePool(ctx);

  // --- stage 2: feature assembly ------------------------------------------
  const features = assembleFeatures(ctx);
  const featureDecisions: TraceDecision[] =
    features.anchorAt === null
      ? [
          {
            kind: "no-time-anchor",
            detail: "recentEvents carries no timestamps — the session time anchor is absent; freshness is neutral (0.5) and fatigue cannot decay (recorded, never guessed)",
            itemIds: [],
          },
        ]
      : [];

  // --- stage 3: model scoring (injected) -----------------------------------
  // The pool intake copies are identical in value to ctx.candidatePool, so
  // features (pool-index aligned) attach 1:1; the copies flow on as the
  // candidates the OS hands out.
  const pooledCtx: RecommendationContext = { ...ctx, candidatePool: [...intake.pool] };
  const scoring = await score(pooledCtx, features, model);

  // --- stage 3.5 (R05): the feedback controls -------------------------------
  // Suppressions exclude their targets WITH honest notes; item controls
  // demote/boost; every decision is traced. An empty set is a no-op row.
  const feedbackStage = applyFeedback(scoring.scored, options?.feedback ?? []);

  // --- stage 4: policy constraints ------------------------------------------
  const policy = applyPolicy(ctx, feedbackStage.ranked);

  // --- stage 5: intent-aware diversity --------------------------------------
  const diversity = diversify(policy.ranked, ctx.intents, ctx.policy);

  // --- stage 6: feed composition ---------------------------------------------
  const composition = composeFeed(ctx.surface, diversity.ranked, ctx);

  // --- the auditable trace ----------------------------------------------------
  const stages: PipelineStageRecord[] = [
    {
      stage: "retrieval",
      inputCount: ctx.candidatePool.length,
      outputCount: intake.pool.length,
      decisions: intake.decisions,
    },
    {
      stage: "features",
      inputCount: ctx.candidatePool.length,
      outputCount: features.byCandidate.length,
      decisions: Object.freeze(featureDecisions),
    },
    {
      stage: "scoring",
      inputCount: features.byCandidate.length,
      outputCount: scoring.scored.length,
      decisions: scoring.decisions,
    },
    {
      stage: "feedback",
      inputCount: scoring.scored.length,
      outputCount: feedbackStage.ranked.length,
      decisions: feedbackStage.decisions,
    },
    {
      stage: "policy",
      inputCount: feedbackStage.ranked.length,
      outputCount: policy.ranked.length,
      decisions: policy.decisions,
    },
    {
      stage: "diversity",
      inputCount: policy.ranked.length,
      outputCount: diversity.ranked.length,
      decisions: diversity.decisions,
    },
    {
      stage: "composition",
      inputCount: diversity.ranked.length,
      outputCount: composition.cards.length,
      decisions: composition.decisions,
    },
  ];

  const page: FeedPage = Object.freeze({
    surface: ctx.surface,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    cards: composition.cards,
    trace: Object.freeze({
      model: Object.freeze({ id: model.id, version: model.version }),
      stages: Object.freeze(stages),
    }),
  });
  return page;
}
