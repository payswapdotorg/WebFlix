/**
 * WFX-032 barrel — the BYOM (bring-your-own-model) adapter, packaged inside
 * `@wfx/model-fabric` (Lane A — intelligence):
 *
 * - byom.ts       — `ByomModel` port (the seam: untyped output, typed
 *                   redacted input) + `ByomPrivacyClass` vocabulary +
 *                   `assertValidByomModel` (typed construction validation).
 * - redaction.ts  — `redactForPrivacy(ctx, class)`: pure privacy enforcement
 *                   (pseudonymization via deterministic salted SHA-256,
 *                   any-cloud payload minimization) returning the `ByomInput`
 *                   plus a golden-pinnable `RedactionReport` — auditable,
 *                   never silent, never leaking values.
 * - enforce.ts    — `validateByomOutput` (strict RecommendationScore[]
 *                   schema, typed path errors, tolerated-unknown-fields log),
 *                   `enforcePolicy` (clamps, explanation caps, the typed
 *                   `degraded` verdict with confidence 0 — never fabricated
 *                   zeros), `checkCostCeiling` (pre-invocation cost gate).
 * - adapter.ts    — `createByomAdapter(byom)`: the frozen
 *                   `RecommendationModel` wrapper — redact → cost check →
 *                   invoke → validate → enforce, every stage traced to the
 *                   `debug` accessor (scores stay clean), every failure a
 *                   typed `ByomError` rejection the OS can catch.
 * - fabric.ts     — `createByomProvider` / `registerByom`: the Model Fabric
 *                   wrapper (tasks recommendation/ranking, privacy from the
 *                   byom class, routing + cost through the MERGED APIs).
 * - fixtures.ts   — TEST FIXTURES (`makeWellBehavedByom`, `makeScriptedByom`,
 *                   `makeThrowingByom`) — never production models.
 */

export * from "./byom";
export * from "./redaction";
export * from "./enforce";
export * from "./adapter";
export * from "./fabric";
export * from "./fixtures";
