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
 * - features.ts:     assembleFeatures — the deterministic feature stage +
 *                    the documented candidate feature keys (incl. R05's
 *                    topic / creatorId) and the anti-tunnel diversity key.
 * - scoring.ts:      score(ctx, features, model) — injected-model contract —
 *                    and createHeuristicModel, the explainable default.
 * - attention.ts:    the attention-policy law + ordering-repair algorithms
 *                    + the R05 mode-derived signals (effective exploration,
 *                    time budget, novelty weight).
 * - policy.ts:       applyPolicy — dedupe, custom objectives, availability
 *                    floor, attention modes (incl. mindful novelty).
 * - feedback.ts:     R05 — the J15 control vocabulary + applyFeedback (the
 *                    reversible per-profile controls stage).
 * - diversity.ts:    diversify — intent-aware anti-tunnel-vision re-ranking
 *                    (topic-keyed: watch-driven concentration included).
 * - composition.ts:  composeFeed — watch/short surface composition.
 * - pipeline.ts:     runRecommendation — the six-stage pipeline + trace
 *                    (feedback controls ride the options seam).
 */
export * from "./types";
export * from "./validate";
export * from "./events";
export * from "./fatigue";
export * from "./features";
export * from "./scoring";
export * from "./attention";
export * from "./policy";
export * from "./feedback";
export * from "./diversity";
export * from "./composition";
export * from "./pipeline";
