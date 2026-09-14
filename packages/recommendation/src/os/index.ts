/**
 * Recommendation OS barrel (WFX-021, Lane A — intelligence).
 *
 * - types.ts:        CandidateFeatures / ScoredCandidate / PipelineTrace /
 *                    FeedPage / TraceDecision / typed RecommendationOSError,
 *                    plus the frozen OS contracts re-exported.
 * - validate.ts:     total ctx/model validation (field-level, aggregated).
 * - events.ts:       event-derived signals (anchor, seen, consumed,
 *                    in-progress) — the OS's only time source.
 * - fatigue.ts:      repetition/fatigue typed signals (monotonicity law).
 * - features.ts:     assembleFeatures — the deterministic feature stage.
 * - scoring.ts:      score(ctx, features, model) — injected-model contract —
 *                    and createHeuristicModel, the explainable default.
 * - attention.ts:    the attention-policy law + ordering-repair algorithms.
 * - policy.ts:       applyPolicy — dedupe, custom objectives, availability
 *                    floor, attention modes.
 * - diversity.ts:    diversify — intent-aware anti-tunnel-vision re-ranking.
 * - composition.ts:  composeFeed — watch/short surface composition.
 * - pipeline.ts:     runRecommendation — the six-stage pipeline + trace.
 */
export * from "./types";
export * from "./validate";
export * from "./events";
export * from "./fatigue";
export * from "./features";
export * from "./scoring";
export * from "./attention";
export * from "./policy";
export * from "./diversity";
export * from "./composition";
export * from "./pipeline";
