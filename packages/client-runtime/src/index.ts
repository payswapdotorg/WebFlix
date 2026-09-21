/**
 * @wfx/client-runtime — public entry (R01, remediation freeze).
 *
 * The Shared Client Runtime of the frozen layering law:
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)
 *
 * Pure TypeScript, UI-framework-agnostic (NO React), no direct fetching
 * (adapters inject the `ServerPort`), no wall clock, no randomness (the
 * clock/id seams), no provider SDK calls. The runtime owns navigation,
 * presentation state, playback commands, watch state, library semantics,
 * action state, intent submission, and error-state semantics; platform
 * adapters own lifecycle, storage, browser embedding, native media,
 * notifications, background work, and sharing through
 * `@wfx/platform-contracts` ports.
 *
 * Public surface (import ONLY from "@wfx/client-runtime" — the lane checker
 * forbids deep paths):
 * - `createRuntime`           — the single public entry
 * - `server-port.ts`          — `ServerPort`, `ServerResult`, `ServerFailure`,
 *                               `RuntimeContext`
 * - `errors.ts`               — the `RuntimeError` taxonomy + recovery hints
 * - `navigation.ts`           — the navigation state machine
 * - `playback.ts`             — playback command semantics + capability-filtered
 *                               resolution (frozen precedence)
 * - `watch-state.ts`          — session watch-state fold + at-least-once outbox
 * - `library.ts`              — canonical-keyed library semantics
 * - `actions.ts`              — action state (requested/confirmed/unsupported/failed)
 * - `intent.ts`               — intent submission + attention-mode policy
 * - `models.ts`               — the read models (home/search/shorts/library)
 * - `sources.ts`              — R03: the source-state store (source
 *                               management's observed model)
 * - `acquisition.ts`          — R14: the native acquisition UX seam — the
 *                               frozen lifecycle vocabulary's transition
 *                               law, the protocol-free facts intake, the
 *                               pure mapper to the honest status views
 *                               (Available/Preparing/Buffering/Playing/
 *                               Completing/Ready offline/Failed), the
 *                               typed failure causes (recoverable vs
 *                               fatal), the protocol leak guard, and the
 *                               gated advanced-diagnostics view type
 * - `registry.ts`             — the canonical item registry
 * - `runtime-seams.ts`        — the clock/id seams
 * - `surface-resolution.ts`  — R09: the Media Surface resolution seam (the
 *                               injectable wiring of the frozen resolver)
 * - `discoverability.ts`     — R21-A: the typed capability discovery
 *                               matrix (capability → contextual entry +
 *                               recovery path), the frozen primary-nav +
 *                               feed-mode + J34-task vocabularies, and
 *                               the stale-completion-copy sweep law
 * - `feed-mode.ts`           — R21-A: the feed-mode control store (the
 *                               shared For you / Following / imported /
 *                               Blend presentation state with honest
 *                               availability truth + typed recovery hints)
 * - `source-catalog.ts`      — R22-A: the first-connect source catalog —
 *                               the typed chooser read model (the seven
 *                               state truths, the real connector id + the
 *                               typed connect action + the user-vocabulary
 *                               connection method, the anonymous sign-in
 *                               prerequisite, the honest unsupported truth)
 * - `anonymous-viewing.ts`   — R23-A: the anonymous viewing capability
 *                               MATRIX — the typed three-way auth-class
 *                               distinction (anonymous read/play /
 *                               webflix-account mutation+sync /
 *                               provider-authorized playback), the frozen
 *                               capability rows with user vocabulary, the
 *                               per-capability access resolution (open /
 *                               typed sign-in prerequisite / typed provider
 *                               authorization prerequisite — never a wall),
 *                               and the machine-checkable no-login-wall law
 *                               (J37's forbidden invariant)
 * - `anonymous-playback-boundary.ts` — R23-B: the anonymous playback
 *                               boundary — the per-CAPABILITY authorization
 *                               decision table (anonymous + public =>
 *                               playback may start; provider authorization
 *                               independent of the WebFlix account BY
 *                               CONSTRUCTION — the table never reads the
 *                               viewer), the playback no-login-wall law
 *                               (no playback decision may ever route to a
 *                               WebFlix login), the read-path surface guard,
 *                               the observed-source access-class/
 *                               authorization folds, and the session-scoped
 *                               progress law (anonymous progress is never
 *                               durable identity until authentication)
 * - `torrent-realization.ts` — R23-C: the first-class torrent
 *                               realization contract — the transport-kind
 *                               declaration (torrent as a realization
 *                               SOURCE KIND, never a PlaybackMode —
 *                               compile-time-guarded), the rung-satisfaction
 *                               model preserving the Media Surface
 *                               precedence (Desktop native rung / Web
 *                               browser rung where truly supported / the
 *                               honest Desktop next step / the
 *                               authorization gate), the frozen user
 *                               vocabulary ("Where to watch -> Authorized
 *                               peer copy", never merely "Offline copy" —
 *                               machine-checked), and the nine-dimension
 *                               first-class parity contract
 * - `account-creation.ts`    — R22-B: the account-creation journey —
 *                               the typed register command + shared
 *                               validation (the service's own rules), the
 *                               typed failure vocabulary with recovery
 *                               next actions, the auto-login session views
 *                               (secret-free; the one-time token passes
 *                               through ONCE), and the journey state
 *                               machine over the EXISTING auth transport
 * - `byom-management.ts`     — R22-C: the BYOM management view — the
 *                               UI-ready shared model over the EXISTING
 *                               runtime operations (binding summary,
 *                               supported task capabilities, privacy mode,
 *                               availability, add/bind + remove/unbind
 *                               actions, the derived verify/usable truth,
 *                               typed errors/recovery) + the bind-command
 *                               validation + the machine-checked secret law
 * - `parity-taxonomy.ts`     — R24-A: the shared YouTube-parity taxonomy —
 *                               the typed 17-field feature-inventory schema
 *                               + the COMPLETE frozen matrix (the plan's
 *                               entire R24-C pairing matrix + the frozen
 *                               lab inventory's reference rows + all 14
 *                               R24-B WebFlix-only extensions = 65 rows,
 *                               every row classified) + the no-"to be
 *                               considered" machine guard + the plan-coverage
 *                               contracts + the lab view derivations
 * - `playback-telemetry.ts` — R24-E: the shared playback-performance
 *                               telemetry contract — the typed metric
 *                               vocabulary (the plan's nine primary metrics
 *                               + realization-switch time), the frozen hard
 *                               thresholds (TTFF p50/p75/p95 deltas,
 *                               startup-failure + first-60s-rebuffer pp),
 *                               the startup instrumentation marker pairs,
 *                               the benchmark record shape (cold/warm cache
 *                               passes, device/browser/network profile
 *                               fields, the same-content law), the
 *                               raw-observation retention shapes, and the
 *                               comparability-checked threshold evaluation
 * - `capability-placement.ts` — the R24 feature capability matrix +
 *                               placement contracts — the shared read model
 *                               joining parity classification with
 *                               contextual placement truth for every
 *                               capability (the lab's UX/UI review
 *                               checklist, typed), with the R24-B laws 1-6
 *                               as machine-checkable contracts
 * - `interaction-policy.ts`  — R24-E/R24-C: the interaction-policy seams —
 *                               the two-lane playback startup law (essential
 *                               vs deferred work; playback NEVER waits on
 *                               recommendation/AI enrichment, by
 *                               construction), the readiness-gates start
 *                               decision, the enrichment-boundary view,
 *                               attention-policy-aware autoplay (the frozen
 *                               policy table; anonymous-identical, ends-only)
 *                               + the aggregate parity-regression invariants
 * - `secret-guard.ts`        — R22: the client read-model secret guard
 *                               (the machine check — secret material never
 *                               appears in a client read model after
 *                               submission)
 * - `testing.ts`              — ⚠️ TEST DOUBLES — production code never imports it
 */

// The runtime surface (production).
export * from "./errors";
export * from "./server-port";
export * from "./runtime-seams";
export * from "./navigation";
export * from "./sources";
export * from "./acquisition";
export * from "./playback";
export * from "./surface-resolution";
export * from "./watch-state";
export * from "./library";
export * from "./actions";
export * from "./intent";
export * from "./models";
export * from "./registry";
export * from "./discoverability";
export * from "./feed-mode";
export * from "./model-controls";
export * from "./control-views";
export * from "./source-catalog";
export * from "./anonymous-viewing";
export * from "./anonymous-playback-boundary";
export * from "./torrent-realization";
export * from "./parity-taxonomy";
export * from "./playback-telemetry";
export * from "./capability-placement";
export * from "./interaction-policy";
export * from "./account-creation";
export * from "./secret-guard";
export * from "./byom-management";
export { createRuntime, type ClientRuntime, type RuntimeSession, type RuntimeOptions } from "./runtime";

// Test doubles — clearly marked, testing-only (see testing.ts module doc).
export * from "./testing";
