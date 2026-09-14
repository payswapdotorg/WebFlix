/**
 * WFX-031 barrel — the WebFlix first-party recommendation model adapter
 * (Lane A — intelligence), packaged inside `@wfx/model-fabric`:
 *
 * - model.ts          — `createWfxRecommendationModel(version)`: the
 *                       deterministic, explainable first-party scorer
 *                       (typed weighted formula; session scope weighted
 *                       highest per surface; half-life freshness; fatigue
 *                       penalty; exploration/novelty policy multipliers;
 *                       completeness-derived confidence).
 * - provider.ts       — `createWfxModelProvider()`: the Model Fabric
 *                       `ModelProvider` adapter for the `recommendation` /
 *                       `ranking` tasks (typed task + input validation with
 *                       field paths, local-only by construction, typed
 *                       zero-cost reporting).
 * - registry.ts       — `registerWfxModel(fabric)`: registration glue using
 *                       ONLY the merged WFX-030 public registry API.
 * - replacability.ts  — `ModelSwapContract` / `assertModelContract` /
 *                       `createStubRecommendationModel`: the drift-proofed
 *                       replaceability invariant (the OS never depends on
 *                       THIS model specifically).
 */

export * from "./model";
export * from "./provider";
export * from "./registry";
export * from "./replacability";
