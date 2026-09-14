/**
 * @wfx/model-fabric — result envelope, error taxonomy, and trace vocabulary
 * (WFX-030, Lane A).
 *
 * This module EXTENDS the frozen Model Fabric contracts
 * (`ModelTask`, `ModelProvider`, `ModelPolicy` — imported from `@wfx/domain`,
 * never redefined here) with the fabric's operational vocabulary:
 *
 * - `FabricResult<T>`   — the envelope every gateway invocation returns.
 * - `FabricError`       — the closed error union (never thrown across the
 *                         gateway boundary, never swallowed, never converted
 *                         into fake success).
 * - `InvocationTrace`   — per-invocation observability record.
 *
 * Deliberate, lead-visible extension to the task shape: the failure branch of
 * `FabricResult` carries an OPTIONAL `trace`. The packet specifies
 * `{ ok: false; error: FabricError }` and simultaneously requires "timeouts
 * and provider failures must surface as typed errors WITH the trace — never
 * swallowed"; a failure without its trace would violate the second rule. The
 * field is purely additive (the branch stays discriminated by `ok`/`error`
 * exactly as specified, and `{ ok: false; error }` remains assignable to the
 * packet shape). The trace is ABSENT only when no provider was ever invoked
 * (no-provider / policy / all-cost-skipped failures); provider failures and
 * timeouts always carry it.
 */

import { generateUlid } from "@wfx/domain";
import type { ModelPolicy, ModelTask } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Runtime vocabularies (mirrors of the frozen unions)
// ---------------------------------------------------------------------------
// `satisfies` rejects values outside the frozen unions; the `Covers`
// assertions below fail compilation when a frozen union gains a member these
// tables miss, so vocabulary drift is a compile error (domain precedent).

/** Compile-time check that `Values` covers every member of the frozen `Union`. */
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? unknown
  : never;

/** Every frozen ModelTask, in frozen-contract order. */
export const MODEL_TASKS = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
] as const satisfies readonly ModelTask[];
const _modelTasksCover: Covers<ModelTask, typeof MODEL_TASKS> = null;

/** Runtime guard for the frozen `ModelTask` union. */
export function isModelTask(x: unknown): x is ModelTask {
  return typeof x === "string" && (MODEL_TASKS as readonly string[]).includes(x);
}

/** Every frozen ModelPolicy privacy mode, in frozen-contract order. */
export const MODEL_POLICY_PRIVACIES = [
  "local-only",
  "trusted-cloud",
  "any-cloud",
] as const satisfies readonly ModelPolicy["privacy"][];
const _policyPrivaciesCover: Covers<ModelPolicy["privacy"], typeof MODEL_POLICY_PRIVACIES> = null;

/** Runtime guard for the frozen `ModelPolicy["privacy"]` union. */
export function isModelPolicyPrivacy(x: unknown): x is ModelPolicy["privacy"] {
  return (
    typeof x === "string" && (MODEL_POLICY_PRIVACIES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// FabricError — the closed error union of the gateway
// ---------------------------------------------------------------------------

/**
 * The closed error vocabulary of the Model Fabric gateway. Exactly the six
 * kinds required by the WFX-030 packet:
 *
 * - `no-provider`     — the route plan is empty: no registered provider can
 *                       serve the task under the policy.
 * - `policy`          — the caller's policy is unusable (task mismatch,
 *                       malformed privacy, invalid cost ceiling, malformed
 *                       fallback list, invalid timeout override).
 * - `privacy`         — a local-only policy would send input to a cloud
 *                       provider; the gateway refuses (defense in depth).
 * - `cost`            — every candidate provider was skipped because
 *                       attempting it would exceed the policy budget.
 * - `provider-error`  — a provider invocation failed (rejection or sync
 *                       throw); if fallbacks remain, the next one is tried.
 * - `timeout`         — a provider did not answer within its per-provider
 *                       deadline; if fallbacks remain, the next one is tried.
 */
export type FabricError =
  | NoProviderError
  | PolicyError
  | PrivacyError
  | CostError
  | ProviderError
  | TimeoutError;

/** The route plan resolved to zero providers for the task. */
export interface NoProviderError {
  kind: "no-provider";
  task: ModelTask;
}

/** The caller's policy is malformed or does not apply to this task. */
export interface PolicyError {
  kind: "policy";
  detail: string;
}

/** A privacy boundary would be crossed; the gateway refused to invoke. */
export interface PrivacyError {
  kind: "privacy";
  detail: string;
}

/** Every candidate was cost-skipped before any attempt was made. */
export interface CostError {
  kind: "cost";
  budget: number;
  spent: number;
}

/** A provider invocation failed (rejected or threw). */
export interface ProviderError {
  kind: "provider-error";
  providerId: string;
  detail: string;
}

/** A provider invocation exceeded its per-provider deadline. */
export interface TimeoutError {
  kind: "timeout";
  providerId: string;
  /** The enforced per-provider timeout threshold, in milliseconds. */
  ms: number;
}

/** The closed set of FabricError kinds, in taxonomy order. */
export const FABRIC_ERROR_KINDS = [
  "no-provider",
  "policy",
  "privacy",
  "cost",
  "provider-error",
  "timeout",
] as const satisfies readonly FabricError["kind"][];

const _fabricErrorKindsCover: Covers<FabricError["kind"], typeof FABRIC_ERROR_KINDS> = null;

// ---------------------------------------------------------------------------
// Error constructors (exactOptionalPropertyTypes-safe: never `field: undefined`)
// ---------------------------------------------------------------------------

/** Construct a `no-provider` error for a task with an empty route plan. */
export function noProvider(task: ModelTask): NoProviderError {
  return { kind: "no-provider", task };
}

/** Construct a `policy` error describing the malformed or mismatched policy. */
export function policyError(detail: string): PolicyError {
  return { kind: "policy", detail };
}

/** Construct a `privacy` error describing the refused boundary crossing. */
export function privacyError(detail: string): PrivacyError {
  return { kind: "privacy", detail };
}

/** Construct a `cost` error: `budget` is the ceiling, `spent` what was incurred. */
export function costError(budget: number, spent: number): CostError {
  return { kind: "cost", budget, spent };
}

/** Construct a `provider-error` for a failed provider invocation. */
export function providerError(providerId: string, detail: string): ProviderError {
  return { kind: "provider-error", providerId, detail };
}

/** Construct a `timeout` error for a provider that missed its deadline. */
export function timeoutError(providerId: string, ms: number): TimeoutError {
  return { kind: "timeout", providerId, ms };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Narrow a `FabricError` to the `no-provider` variant. */
export function isNoProvider(error: FabricError): error is NoProviderError {
  return error.kind === "no-provider";
}

/** Narrow a `FabricError` to the `policy` variant. */
export function isPolicyError(error: FabricError): error is PolicyError {
  return error.kind === "policy";
}

/** Narrow a `FabricError` to the `privacy` variant. */
export function isPrivacyError(error: FabricError): error is PrivacyError {
  return error.kind === "privacy";
}

/** Narrow a `FabricError` to the `cost` variant. */
export function isCostError(error: FabricError): error is CostError {
  return error.kind === "cost";
}

/** Narrow a `FabricError` to the `provider-error` variant. */
export function isProviderError(error: FabricError): error is ProviderError {
  return error.kind === "provider-error";
}

/** Narrow a `FabricError` to the `timeout` variant. */
export function isTimeoutError(error: FabricError): error is TimeoutError {
  return error.kind === "timeout";
}

/** Runtime-shape validation for values claimed to be a `FabricError`. */
export function isFabricError(x: unknown): x is FabricError {
  if (!isRecord(x) || typeof x.kind !== "string") return false;
  switch (x.kind) {
    case "no-provider":
      return isModelTask(x.task);
    case "policy":
    case "privacy":
      return typeof x.detail === "string";
    case "cost":
      return typeof x.budget === "number" && typeof x.spent === "number";
    case "provider-error":
      return typeof x.providerId === "string" && typeof x.detail === "string";
    case "timeout":
      return typeof x.providerId === "string" && typeof x.ms === "number";
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// InvocationTrace
// ---------------------------------------------------------------------------

/**
 * The observability record of one gateway invocation.
 *
 * - `invocationId` — unique per invocation (`wfxinv_` + 26-char Crockford
 *   Base32 ULID body; sortable, monotonic within the process). Two
 *   invocations never share an id.
 * - `taskId` — the `ModelTask` the invocation targeted. The frozen vocabulary
 *   has no per-task instance ids, so the task kind IS the task identifier.
 * - `providerId` — the provider that produced the terminal outcome: the
 *   successful provider on success, the LAST attempted provider on failure.
 * - `startedAt` — full ISO 8601 datetime string (UTC, `Z` offset), domain
 *   `isIso8601`-compatible.
 * - `durationMs` — wall-clock duration of the whole invocation, including
 *   failed attempts and waits.
 * - `cost` — present iff at least one ATTEMPTED provider declared a cost for
 *   the task; the sum of declared costs across all attempted providers
 *   (undeclared costs contribute 0). Cost-skipped providers never contribute.
 * - `fallbacks` — the ordered ids of providers that were ATTEMPTED and failed
 *   before the terminal provider. Never includes the terminal provider,
 *   unregistered plan entries, or cost-skipped providers (they never ran).
 */
export interface InvocationTrace {
  invocationId: string;
  taskId: ModelTask;
  providerId: string;
  startedAt: string;
  durationMs: number;
  cost?: number;
  fallbacks: string[];
}

/** Prefix of fabric invocation ids: `wfxinv_` + 26-char ULID body. */
export const INVOCATION_ID_PREFIX = "wfxinv_";

/** 26-char Crockford Base32 ULID body (same scheme as the domain id module). */
const ULID_BODY_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Mint a fresh, unique invocation id. */
export function newInvocationId(): string {
  return `${INVOCATION_ID_PREFIX}${generateUlid()}`;
}

/** Structural check: `wfxinv_` followed by a valid 26-char ULID body. */
export function isInvocationId(x: unknown): x is string {
  return (
    typeof x === "string" &&
    x.startsWith(INVOCATION_ID_PREFIX) &&
    ULID_BODY_RE.test(x.slice(INVOCATION_ID_PREFIX.length))
  );
}

// ---------------------------------------------------------------------------
// FabricResult
// ---------------------------------------------------------------------------

/** The success branch of {@link FabricResult}. */
export type FabricSuccess<T> = Extract<FabricResult<T>, { ok: true }>;

/** The failure branch of {@link FabricResult} (trace present iff a provider ran). */
export type FabricFailure<T> = Extract<FabricResult<T>, { ok: false }>;

/**
 * The result envelope of every gateway invocation. Success carries the value
 * plus the trace; failure carries a typed `FabricError` plus — when at least
 * one provider was actually invoked — the trace of those attempts.
 */
export type FabricResult<T> =
  | { ok: true; value: T; trace: InvocationTrace }
  | { ok: false; error: FabricError; trace?: InvocationTrace };

/** Narrow a `FabricResult` to its success branch. */
export function isOk<T>(result: FabricResult<T>): result is FabricSuccess<T> {
  return result.ok;
}

/** Narrow a `FabricResult` to its failure branch. */
export function isErr<T>(result: FabricResult<T>): result is FabricFailure<T> {
  return !result.ok;
}

// ---------------------------------------------------------------------------
// Human-readable summaries
// ---------------------------------------------------------------------------

/**
 * Render a one-line, human-readable summary of a typed fabric error. Always
 * names the kind so a degraded rendering is never mistaken for success
 * (connectors `describeConnectorError` precedent).
 */
export function describeFabricError(error: FabricError): string {
  switch (error.kind) {
    case "no-provider":
      return `no-provider: no registered provider can serve task '${error.task}' under this policy`;
    case "policy":
      return `policy: ${error.detail}`;
    case "privacy":
      return `privacy: ${error.detail}`;
    case "cost":
      return `cost: budget ${error.budget} exceeded with ${error.spent} already spent — every provider was skipped`;
    case "provider-error":
      return `provider-error: provider '${error.providerId}' failed: ${error.detail}`;
    case "timeout":
      return `timeout: provider '${error.providerId}' exceeded its ${error.ms}ms deadline`;
  }
}
