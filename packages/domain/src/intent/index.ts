/**
 * Intent Graph module barrel (WFX-011, Lane A — intelligence).
 *
 * - model.ts: IntentRecord / IntentSnapshot entities, scope + provenance
 *   vocabularies, typed IntentError, canonical `wfxint_` id helpers.
 * - store.ts: IntentGraph in-memory store (create-or-reinforce, half-life
 *   decay, expiry, point-in-time snapshots).
 * - infer.ts: evidence-based, strictly additive intent inference.
 * - policy.ts: RecommendationPolicy default / validate / clamp helpers.
 */
export * from "./model";
export * from "./store";
export * from "./infer";
export * from "./policy";
