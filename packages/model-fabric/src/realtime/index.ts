/**
 * @wfx/model-fabric — realtime folder entry (R25).
 *
 * - `session.ts`          — R25-A: the provider-neutral realtime
 *                           translation session contract's operational
 *                           layer — the runtime vocabularies (inputs,
 *                           the 12 event kinds, the 7 operations, the
 *                           6 states), input/configuration validation
 *                           (field-path issues, fail-closed, the
 *                           legal-audio + consent gates), the
 *                           operation × state legality table, the
 *                           provider-neutrality forbidden-token scan,
 *                           the pure event-stream helper, and the
 *                           never-block-playback law.
 * - `task.ts`             — R25-B: the `realtime-translation`
 *                           LOGICAL task (a vocabulary BESIDE the
 *                           frozen ModelTask union — never an
 *                           overload of the batch transform task),
 *                           the 15 capability dimensions, the
 *                           capability profile + validation, and the
 *                           request/language serving derivations.
 * - `provider.ts`         — R25-B provider metadata + provenance: the
 *                           managed-cloud provider record for the
 *                           realtime translation specialist (managed
 *                           service, managed-service-only
 *                           distribution, no open-weight rights
 *                           assumed), the frozen research facts, and
 *                           the managed-provider laws.
 * - `router.ts`           — R25-B router policy seams: the realtime
 *                           routing decision (specialist for
 *                           translation combos; R2T2 for
 *                           transcription-only; batch workloads
 *                           refused; honest typed gaps; the policy
 *                           preference wins when registered and
 *                           capable).
 * - `cost.ts`             — R25-K: the token rate card (the frozen
 *                           indicative pricing), the usage/cost math
 *                           (bit-stable), the cost-policy controls
 *                           (modality, duration limits, anonymous
 *                           quotas, budgets, adaptive visual
 *                           sampling), the automatic text-only
 *                           fallback, and the never-block-playback
 *                           law.
 * - `consent.ts`          — R25-H: the voice-cloning consent state
 *                           contracts — the consent gate (neutral
 *                           voice default; preservation only with
 *                           satisfied consent; the typed
 *                           consent-required refusal), the provenance
 *                           record that must accompany every
 *                           session/artifact, and the total
 *                           never-silent-clone / never-default laws.
 * - `anonymous-session.ts`— R25-J: the anonymous realtime translation
 *                           behavior — the accountless session
 *                           capability (no login for currently
 *                           playable public media), the durable
 *                           capability list that honestly requires
 *                           the account, the no-login-wall law, and
 *                           the anonymous readiness gate.
 */

export * from "./session";
export * from "./task";
export * from "./cost";
export * from "./provider";
export * from "./router";
export * from "./consent";
export * from "./anonymous-session";
