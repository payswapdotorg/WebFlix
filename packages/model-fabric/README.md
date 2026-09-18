# @wfx/model-fabric

The Model Fabric — WebFlix's provider-neutral model gateway and BYOM
(bring-your-own-model) seam. The fabric is the place WHERE the model-
policy router, the cost-ceiling gate, the privacy-class filter, and the
per-provider timeout live; concrete cloud/local providers arrive in
later work items, but the policy machinery is frozen here.

## Public surface

- **`types.ts`** — `FabricResult<T>`, the closed `FabricError` union
  (`no-provider` | `policy` | `privacy` | `cost` | `provider-error` |
  `timeout`) with constructors, guards, and `describeFabricError`;
  `InvocationTrace` + invocation-id scheme; runtime vocabularies
  (`MODEL_TASKS`, `MODEL_POLICY_PRIVACIES`).
- **`registry.ts`** — `ModelFabricRegistry` (capability indexing by
  `ModelTask`, duplicate-id rejection, `describe()` id × task matrix);
  `RegisteredModelProvider` (the frozen `ModelProvider` + the documented
  `privacy: 'local' | 'cloud'` registration field + `costPerOperation(task)`).
- **`router.ts`** — `ModelRouter.route(task, policy) → RoutePlan`
  (preferred + fallbacks, filtered by capability, privacy, cost).
- **`fabric.ts`** — `ModelFabric.invoke()` gateway: ordered attempts,
  per-provider timeout (default 30s), fallback on provider-error/timeout,
  cost budget skip, privacy defense-in-depth, full `InvocationTrace` on
  success AND failure.
- **`testing.ts`** — TEST FIXTURES (`makeEchoProvider`,
  `makeFailingProvider`, `makeSlowProvider`). NEVER production.
- **`transform/`** — the transformation pipeline (WFX-033):
  - **`tasks.ts`** — typed task descriptors (transcript, translation,
    subtitle, summary, speech, transcribe, dubbing, commentary) with
    validated input schemas, deterministic cost/duration estimates, and
    the subtitle realize step.
  - **`permissions.ts`** — the permission authority: unauthorized/DRM
    always denied; license flags required by task kind.
  - **`pipeline.ts`** — `runTransformation(fabric, task, input, options)`:
    validate → permission → cost ceiling → fabric invoke → realize.
  - **`operation-controller.ts`** (R06) — `TransformOperationController`:
    the control-surface wrapper around the pipeline + the persistence
    store. Productionizes the EXPLICIT transformation state machine
    (queued → running → succeeded | failed | cancelled) with append-only
    state history.
- **`byom/`** — the BYOM seam (WFX-032):
  - **`byom.ts`** — the `ByomModel` port (the user's own model).
  - **`adapter.ts`** — `createByomAdapter(byom, options?)`: the frozen
    `RecommendationModel` adapter over the BYOM seam (privacy redaction,
    cost ceiling, output validation, enforcement).
  - **`enforce.ts`** — the safety net: strict output validation, score
    clamps, explanation caps, the degraded verdict.
  - **`redaction.ts`** — pure privacy redaction (local-only faithful
    copy; trusted-cloud pseudonymized; any-cloud minimized).
  - **`byom-binding-adapter.ts`** (R06) — `createByomProviderFromBinding`:
    turns a stored BYOM binding (the persistence layer's
    `OpenedByomBinding`) into a fabric `RegisteredModelProvider`. The
    binding's transport thunk is the ONLY code path that sees the key.
- **`wfx-model/`** — the first-party recommendation model adapter
  (WFX-031): local-only, cost 0, replaceable through the frozen
  `RecommendationModel` interface.

## R06 — the control surface over the fabric (the productionized layer)

R06 productionizes the CONTROL SURFACE over the existing fabric
machinery — the policy storage, the API endpoints, the operation
states, and the enforcement wiring:

### 1. Router enforcement made REAL against the stored policy

The fabric's `router.ts` and `fabric.ts` enforce the policy the storage
layer persists:

- **PRIVACY class restricts routing:** a `local-only` policy NEVER
  routes to a cloud provider. The router excludes cloud providers from
  the plan; the gateway re-checks the plan against the registry BEFORE
  any attempt (defense in depth) and refuses with a typed `privacy`
  error if a cloud provider slipped in (broken/injected planner).
  Fail-closed: nothing is invoked, not even the local providers in the
  plan. Pinned in `tests/r06-router-byom-privacy.test.ts`.
- **`maxCostPerOperation` enforced per operation:** a provider whose
  declared cost exceeds the ceiling is skipped; the gateway tracks the
  cumulative cost across attempts and SKIPS a provider when attempting
  it would exceed the budget. Over-ceiling on EVERY candidate answers
  the typed `cost` failure (never a silent overrun). Pinned in
  `tests/r06-router-byom-privacy.test.ts`.
- **Fallback chain honored in order:** providers are attempted in
  policy order (`preferredProvider` first, then `fallbackProviders` in
  order). The first success wins; the trace records the failed chain.
  An exhausted-fallback scenario answers the honest LAST-provider
  failure (never a fake success). Pinned in
  `tests/r06-router-byom-privacy.test.ts`.

### 2. BYOM binding REPLACES the first-party route

A BYOM binding (stored envelope-encrypted in `@wfx/persistence`'s
`byom_provider_bindings` table) is wrapped into a fabric
`RegisteredModelProvider` through `createByomProviderFromBinding`. The
adapter:

- Registers with `privacy: "cloud"` (BYOM models run remotely — input
  leaves the machine). The router's local-only filter EXCLUDES it
  under local-only policies, by construction.
- Routes the binding's key to the TRANSPORT thunk the caller injects.
  The transport is the ONLY code path that may consume the key — never
  the model-input lane, never logs, never URLs.
- FAILS TYPED on transport rejection (a typed provider-error carrying
  the provider id + a bounded failure message — never raw throw, never
  the input, never the key).
- REPLACES the first-party route when the policy prefers it. The
  fabric's policy layer honors the preferred provider id; the BYOM
  provider is attempted first when preferred, the first-party is the
  fallback. Pinned in `tests/r06-router-byom-privacy.test.ts`.

### 3. Transform pipeline runs as explicit tasks with the state machine

The transformation pipeline (`transform/pipeline.ts`) runs as explicit
operations with the state machine the R06 spec mandates:

```
queued → running → succeeded | failed | cancelled
queued → cancelled (pre-flight cancel)
running → cancelled (in-flight cancel)
succeeded | failed | cancelled are terminal
```

`TransformOperationController` (`transform/operation-controller.ts`)
wraps the pipeline + the persistence store:

- **submit** validates the request, INSERTs a `queued` operation
  record, runs the pipeline ASYNCHRONOUSLY, and answers the queued
  record immediately. The caller renders the queued state; the
  pipeline's outcome transitions the operation's state through the
  append-only history.
- **read** answers the operation's current state + the append-only
  history (every transition recorded — never an overwrite).
- **cancel** transitions a queued/running operation to cancelled
  (race-safe: if the pipeline finished first, the illegal-transition
  error is converted to the typed `terminal` outcome — never a 502).
- **clearResult** transitions a succeeded operation to cancelled and
  clears the result reference (the spec's "DELETE for result cleanup
  where applicable").

### 4. The privacy law (doubled in R06)

> Provider credentials never enter model prompts AND BYOM keys never
> enter logs, URLs, or model prompts. Model privacy policy is enforced
> at the runtime boundary.

The fabric enforces this through THREE layered defenses:

1. **The router's privacy filter** — a `local-only` policy excludes
   every provider not registered with `privacy: "local"`. The plan
   structurally cannot include a cloud provider under local-only.
2. **The gateway's defense-in-depth re-check** — the gateway re-reads
   the live registry BEFORE any attempt and refuses with a typed
   `privacy` error if a cloud provider slipped in (broken/injected
   planner). Fail-closed: nothing is invoked.
3. **The BYOM binding's structural key isolation** — the binding's KEY
   surfaces ONLY through `loadBinding` for the TRANSPORT LANE. The
   fabric's `invoke` input is the plain task input (e.g. the translation
   request) — NO credential material. The BYOM binding adapter routes
   the key to the transport thunk ALONE; the model-input lane is
   structurally unable to read it. Pinned in
   `tests/r06-router-byom-privacy.test.ts`.

## NO real providers ship here

The fabric routes to REGISTERED providers; concrete cloud/local
providers arrive in later work items. The package ships TEST FIXTURES
only (`makeEchoProvider`, `makeFailingProvider`, `makeSlowProvider`) —
never production providers. The fabric's gateway NEVER makes a real
provider call; tests use the in-memory fixtures (no network, no real
keys).

## Determinism

The fabric's logic is pure composition over the registry + router +
gateway seams — no `Date.now` of its own, no `Math.random`, no
network. The gateway's per-provider timeout is the only wall-clock
touch (a `setTimeout` race, overridable per-invocation); the
transform-operation controller uses the injected `now: () => number`
seam (the same pattern as the persistence composition root).

## Scope note (drift rules)

This package owns the fabric's src + tests + the BYOM seam. It does
NOT modify frozen packages (`@wfx/domain`, `@wfx/recommendation`,
`@wfx/experience`). It depends on `@wfx/domain` for TYPES only
(`import type` — the frozen `ModelTask`, `ModelProvider`, `ModelPolicy`)
and `@wfx/recommendation` for the merged OS validator
(`validateRecommendationContext`, `validateRecommendationModel`).
