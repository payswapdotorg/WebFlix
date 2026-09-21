/**
 * @wfx/model-fabric — public entry (WFX-030, Lane A).
 *
 * Surface (all re-exported here; import ONLY from "@wfx/model-fabric"):
 * - types.ts    — `FabricResult`, `FabricError` (closed six-kind union) with
 *                 constructors, guards, and `describeFabricError`;
 *                 `InvocationTrace` + invocation-id scheme; runtime
 *                 vocabularies (`MODEL_TASKS`, `MODEL_POLICY_PRIVACIES`)
 * - registry.ts — `ModelFabricRegistry` (capability indexing by ModelTask,
 *                 duplicate-id rejection, `describe()` id × task matrix),
 *                 `RegisteredModelProvider` (frozen `ModelProvider` + the
 *                 documented `privacy: 'local' | 'cloud'` registration field
 *                 + `costPerOperation(task)`), `ProviderDirectory`,
 *                 `declaredCostFor`, registration error classes
 * - router.ts   — `ModelRouter.route(task, policy)` → `RoutePlan`
 *                 (preferred + fallbacks, filtered by capability, privacy,
 *                 cost), `RoutePlanner` seam, `RoutePolicyError`
 * - fabric.ts   — `ModelFabric.invoke()` gateway: ordered attempts,
 *                 per-provider timeout (default 30s), fallback on
 *                 provider-error/timeout, cost budget skip, privacy
 *                 defense-in-depth, full `InvocationTrace` on success AND
 *                 failure
 * - testing.ts  — TEST FIXTURES (`makeEchoProvider`, `makeFailingProvider`,
 *                 `makeSlowProvider`) — never production providers
 *
 * NO real model providers ship in this package: the fabric routes to
 * REGISTERED providers; concrete cloud/local providers arrive in later work
 * items (WFX-031/032/033). Frozen domain types (`ModelTask`, `ModelProvider`,
 * `ModelPolicy`) come from `@wfx/domain`, the frozen public entry — never
 * deep paths.
 */

export * from "./types";
export * from "./registry";
export * from "./router";
export * from "./fabric";
export * from "./testing";
export * from "./transform/subtitle";
export * from "./transform/tasks";
export * from "./transform/permissions";
export * from "./transform/pipeline";
export * from "./transform/fakes";
export * from "./transform/operation-controller"; // R06 — the transform-operation controller (explicit state machine).
export * from "./byom/byom-binding-adapter"; // R06 — the BYOM binding provider adapter (control surface).
export * from "./wfx-model"; // WFX-031 — the first-party recommendation model adapter (Lane A).
export * from "./byom"; // WFX-032 — the BYOM (bring-your-own-model) adapter (Lane A).
export * from "./media-intelligence"; // R23-F — the media intelligence artifact contracts (typed shapes + honest provenance).
export * from "./open-models"; // R23-G/H/I/J — the open-model provider category, researched catalog, R2T2 live ASR route, discovery features, and the privacy/local path.
