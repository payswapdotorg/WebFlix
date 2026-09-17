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
 * - `registry.ts`             — the canonical item registry
 * - `runtime-seams.ts`        — the clock/id seams
 * - `testing.ts`              — ⚠️ TEST DOUBLES — production code never imports it
 */

// The runtime surface (production).
export * from "./errors";
export * from "./server-port";
export * from "./runtime-seams";
export * from "./navigation";
export * from "./sources";
export * from "./playback";
export * from "./watch-state";
export * from "./library";
export * from "./actions";
export * from "./intent";
export * from "./models";
export * from "./registry";
export { createRuntime, type ClientRuntime, type RuntimeSession } from "./runtime";

// Test doubles — clearly marked, testing-only (see testing.ts module doc).
export * from "./testing";
