# @wfx/model-fabric — the provider-neutral model gateway + the R06 control surface

The Model Fabric is the provider-neutral lane every model invocation and AI
media transformation routes through: registry → router → gateway, with the
BYOM (bring-your-own-model) adapter family, the first-party model adapter,
the typed transformation task set, and (R06) the CONTROL SURFACE — the
model/BYOM/local policy, the privacy/cost/fallback enforcement, and the
EXPLICIT transformation operation state machine.

## Public surface (import from `@wfx/model-fabric` only — the lane law)

| Module | What it owns |
|---|---|
| `types.ts` | `FabricResult` envelope, the closed `FabricError` union (no-provider / policy / privacy / cost / provider-error / timeout), `InvocationTrace` + invocation ids, runtime vocabularies. |
| `registry.ts` | `ModelFabricRegistry` — providers register with `privacy: local \| cloud`, capabilities (frozen `ModelTask`s), and declared `costPerOperation(task)`. |
| `router.ts` | `ModelRouter.route(task, policy)` — the ordered plan `[preferred? + fallbacks]` filtered by CAPABILITY, PRIVACY (local-only excludes cloud), and DECLARED COST. |
| `fabric.ts` | `ModelFabric.invoke()` — the gateway: ordered attempts, per-provider timeout, fallback on provider-error/timeout, budget skip, PRIVACY DEFENSE IN DEPTH (a local-only plan containing a cloud provider is refused typed BEFORE any attempt), full trace on success AND failure. |
| `policy.ts` (R06) | `validateModelPolicyInput` (TOTAL validation against the FROZEN `ModelPolicy` contract), `resolveEffectiveModelPolicy` (the BYOM REPLACEMENT law + fail-closed defaults), `buildModelProviderCatalog` (per-task capability truth + honest local support). |
| `transform/tasks.ts` | The eight typed transformation descriptors (transcript / translation / subtitle / summary / speech / transcribe / dubbing / commentary) with deterministic cost+duration estimators. |
| `transform/permissions.ts` | The permission authority: unauthorized media ALWAYS denied; DRM ALWAYS denied; task license flags (transcript/translation/dubbing/commentary) required. |
| `transform/pipeline.ts` | `runTransformation` — validate → permission FIRST → cost pre-flight → route through the fabric → realize (subtitle composition) → receipt; optional `onProgress` reporting at the observed boundaries. |
| `transform/operations.ts` (R06) | The EXPLICIT operation state machine (`queued → running → succeeded \| failed \| cancelled`), the pure transition function, the durable store seam, and `TransformOperationEngine` (submit / run / cancel). |
| `transform/fakes.ts` | TEST FIXTURE providers — never production. |
| `wfx-model/` | The first-party model adapter (local by construction, `recommendation`+`ranking`, typed zero cost) + the replaceability contract. |
| `byom/` | The BYOM seam: redaction (pseudonymization + payload minimization), output validation, policy enforcement (clamps/caps/cost gate), the frozen-model adapter, the fabric wrapper. |
| `testing.ts` | Echo/failing/slow provider doubles — TEST FIXTURES only. |

NO real model providers ship in this package: the fabric routes to
REGISTERED providers; concrete cloud/local providers arrive in later work
items. Production today registers only the first-party model provider
(recommendation/ranking, local). Transformation providers in production
will answer the fabric's typed `no-provider` failure until real providers
land — the honest state, never a fixture presented as capability.

## The R06 control surface

### Enforcement points (privacy / cost / fallback)

Layered, fail-closed, and TESTED (see `tests/privacy.test.ts`):

1. **ROUTER (planning)** — a `local-only` policy excludes every cloud
   provider from the plan; a provider whose declared cost exceeds
   `maxCostPerOperation` is excluded. An empty plan is legal — routing
   never invents providers.
2. **GATEWAY (defense in depth)** — before ANY attempt, a local-only plan
   containing a cloud provider (a broken/injected planner) is refused with
   the typed `privacy` error; NOTHING runs, not even the local providers.
   During attempts, the budget re-check skips providers whose attempt
   would exceed the ceiling; all-skipped answers the typed `cost` error
   naming the ceiling (`budget`) and what was `spent`.
3. **FALLBACK CHAIN** — `[preferred? + fallbacks]` honored in order,
   deduplicated; the first success wins with the failed chain recorded in
   the trace; exhaustion surfaces the LAST failure with the full chain —
   never a fake success.
4. **THE DOUBLED PRIVACY LAW** — the gateway has NO credential surface at
   all: `invoke(task, input, policy?, context?)` passes providers ONLY the
   caller's input (pinned by tests that scan every provider-received input
   for credential-material field names — keys never enter model prompts).
   BYOM keys flow only to the provider TRANSPORT lane (the persistence
   binding store's `loadBinding`), and `byom/redaction.ts` guards BYOM
   prompts (pseudonymized identifiers, minimized payloads, auditable
   reports that never echo values).

### The effective-policy resolution (BYOM replacement)

`resolveEffectiveModelPolicy(task, { stored?, byomBindings, registry,
firstPartyProviderId })` computes the policy the gateway is invoked with:

- A BYOM binding for the task REPLACES the first-party preferred route
  (the replacability law) when it is registered and privacy-compatible.
- A `cloud` binding under a `local-only` policy is INELIGIBLE — the
  policy never bends for BYOM (the resolver reports it honestly).
- Absent a stored policy: fail-closed `local-only` with the first-party
  default + every registered LOCAL provider for the task in reach ("local
  model where supported"); cloud providers are NEVER defaulted in.
- The stored cost ceiling is preserved; the stored chain is honored in
  order (deduplicated; unregistered ids dropped).

### The explicit transformation operations

`TransformOperationEngine` (over the durable store seam) is the
architecture's law — AI capabilities as EXPLICIT user actions with progress
and results:

- `submit(owner, { kind, input, options })` — validate the kind + input
  (field-path problems), check PERMISSIONS FIRST (a denial answers the
  typed verdict and NO operation record exists — the J20 constrained
  truth), then persist the queued snapshot with the routing directive
  resolved from the STORED policy (a transform never bypasses the user's
  privacy/cost constraints).
- `run(id)` — queued → running → (succeeded | failed); progress reports
  land where the fabric emits them (the pipeline boundaries); a run that
  completes after a CANCEL discards its result (cancelled is terminal).
- `cancel(id)` — the user's undo from queued AND running; terminal states
  answer the typed invalid-state refusal.
- The state HISTORY is append-only (insert-only events; guarded transitions
  answer the typed `conflict` on a state mismatch — never a silent
  overwrite).

## Determinism + purity laws

`src/` performs no I/O and imports no node builtins (browser-safe pure
TypeScript — the redaction module's SHA-256 is hand-rolled FIPS 180-4 for
exactly this reason). Every module takes injected seams (clock, ids,
registry, transports); the deterministic tests use the fabric's testing
doubles with fixed clocks and sequential ids — NO network, and no test
fixture that looks like a real credential.
