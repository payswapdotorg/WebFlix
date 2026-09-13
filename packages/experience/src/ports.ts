/**
 * @wfx/experience — source-neutral ports, the dependency-inversion seams of
 * the Experience API (WFX-005, Lane C).
 *
 * The Experience Core never calls provider SDKs directly (frozen architecture,
 * "Experience Core" boundary). Every external effect it needs is an injected
 * PORT assembled in this module:
 *
 * - `ConnectorPort` — the narrow slice of source access the Experience API
 *   uses: `search`, `metadata`, `resolve`, `executeAction`, and the optional
 *   `readLibrary` / `writeLibrary`. It is structurally the frozen
 *   `SourceConnector` surface, so a real connector is assignable to the port;
 *   the compile-time assertion at the bottom of this module proves it (the
 *   same pattern as `packages/domain/src/intent/infer.ts`).
 * - `EventSink` — where frozen `EntertainmentEvent`s go. Envelope and session
 *   identity are handled by the caller (see the EventSink doc below).
 * - `Clock` — `now(): number`. No `Date.now()` call exists in this package
 *   outside the injected clock.
 * - `IdGen` — `next(): string`. No `Math.random()` / `crypto.randomUUID()`
 *   exists in this package; the fixture generator is a deterministic counter.
 *
 * Error-channel law (mirrors the WFX-003 `ConnectorResult` convention, without
 * importing it — this package may not depend on @wfx/connectors):
 *
 * - Capability-unsupported operations are TYPED RESULTS —
 *   `{ ok: false, reason: "unsupported", capability, detail }` — never a
 *   thrown crash, never an empty fake success ("Capability truth",
 *   docs/architecture/product-boundaries.md).
 * - Runtime conditions that are not the caller's fault (unknown playback
 *   session, no resolvable realization, a port that rejects and thereby
 *   violates the frozen plain surface) are also typed results.
 * - Invalid CALLER input (malformed ctx / request / intent / report /
 *   action) throws the typed `ExperienceError` — the same programmer-error
 *   channel the domain uses for misuse (`IntentError` in @wfx/domain). It is
 *   never a generic `Error`.
 */

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  ConnectorDescriptor,
  EntertainmentEvent,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceConnector,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { isIso8601, isRecord, previewValue } from "@wfx/domain";

// ---------------------------------------------------------------------------
// ConnectorPort — the source seam
// ---------------------------------------------------------------------------

/**
 * The narrow slice of source access the Experience API needs.
 *
 * This is the frozen `SourceConnector` shape verbatim (a deliberate
 * dependency inversion: the Experience Core depends on the PORT it declared,
 * and any real connector satisfies it structurally — see the assertion at
 * the bottom of this module). Optional library methods are optional here
 * too; capability+method presence is checked per use-case.
 */
export interface ConnectorPort {
  descriptor(): ConnectorDescriptor;
  search(ctx: ConnectorContext, query: string): Promise<SearchResult[]>;
  metadata(ctx: ConnectorContext, ref: string): Promise<SourceItem | null>;
  resolve(ctx: ConnectorContext, ref: string): Promise<PlaybackRealization[]>;
  executeAction(ctx: ConnectorContext, action: UserAction): Promise<ActionReceipt>;
  readLibrary?(ctx: ConnectorContext): Promise<LibraryEntry[]>;
  writeLibrary?(ctx: ConnectorContext, command: LibraryCommand): Promise<ActionReceipt>;
}

/**
 * Compile-time proof that every frozen `SourceConnector` satisfies the port
 * (a real connector IS a ConnectorPort). If the frozen contract ever changes
 * in a way that breaks this, compilation of this package fails.
 */
type AssertSatisfiesConnectorPort<T extends ConnectorPort> = T;
type _SourceConnectorSatisfiesConnectorPort = AssertSatisfiesConnectorPort<SourceConnector>;

// ---------------------------------------------------------------------------
// EventSink, Clock, IdGen — the environment seams
// ---------------------------------------------------------------------------

/**
 * Where watch-state events go. `emit` may be synchronous (`void`) or
 * asynchronous (`Promise<void>`); use-cases always await it.
 *
 * Envelope and session identity are handled by the caller or a wrapper:
 * this shell fills the frozen event's `sessionId` from the
 * `ExperienceContext` and stamps `occurredAt` from the injected Clock; a
 * wrapper sink (composition root) owns envelope minting (`wfxevt_` ids,
 * `EventEnvelope` from @wfx/domain) and delivery.
 *
 * A sink that throws/rejects propagates the failure to the use-case caller —
 * a lost watch-state event must never be a silent success.
 */
export interface EventSink {
  emit(event: EntertainmentEvent): Promise<void> | void;
}

/** Time source. `now()` returns epoch milliseconds. */
export interface Clock {
  now(): number;
}

/**
 * Identifier source. `next()` returns a FRESH, UNIQUE, 26-character
 * Crockford Base32 ULID body (the canonical body format of @wfx/domain's
 * `ids.ts` — first char in `[0-7]`). The experience layer composes canonical
 * IDs by prefixing bodies with the domain's canonical prefixes
 * (`wfxitm_`, `wfxsrc_`, `wfxpses_`). Deterministic implementations (such as
 * the sequential fixture generator) keep the whole shell reproducible.
 */
export interface IdGen {
  next(): string;
}

/** The full bundle of injected ports every use-case operates on. */
export interface Ports {
  connector: ConnectorPort;
  events: EventSink;
  clock: Clock;
  ids: IdGen;
}

// ---------------------------------------------------------------------------
// ExperienceContext — the caller-supplied context
// ---------------------------------------------------------------------------

/**
 * The context of one experience session. Structurally a frozen
 * `ConnectorContext` (asserted below) plus the `sessionId` that fills the
 * `sessionId` field of every event this shell emits.
 */
export interface ExperienceContext {
  userId: string;
  sessionId: string;
  locale: string;
  region?: string;
}

type AssertSatisfiesConnectorContext<T extends ConnectorContext> = T;
type _ExperienceContextSatisfiesConnectorContext =
  AssertSatisfiesConnectorContext<ExperienceContext>;

// ---------------------------------------------------------------------------
// ExperienceResult — the typed result convention of the use-case layer
// ---------------------------------------------------------------------------

/**
 * The result envelope for use-case operations that can fail for reasons that
 * are NOT caller misuse (mirrors the WFX-003 `ConnectorResult` convention):
 *
 * - `unsupported` — the connector lacks the capability this operation needs.
 * - `not-found` — a referenced playback session is unknown to this store.
 * - `unresolvable` — no playback realization could be resolved.
 * - `port-failed` — the port rejected (or returned a malformed value), i.e.
 *   it violated the frozen plain surface contract; caught and typed here so
 *   use-cases never crash on a broken port.
 *
 * Caller misuse is NOT part of this union: it throws the typed
 * `ExperienceError` instead (see below).
 */
export type ExperienceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unsupported"; capability: Capability; detail: string }
  | { ok: false; reason: "not-found"; detail: string }
  | { ok: false; reason: "unresolvable"; detail: string }
  | { ok: false; reason: "port-failed"; operation: string; detail: string };

/**
 * Typed error thrown for INVALID CALLER INPUT (the misuse channel — the
 * same role `IntentError` plays in @wfx/domain). Never thrown for
 * source-side conditions; those are typed `ExperienceResult` failures.
 */
export class ExperienceError extends Error {
  readonly kind = "invalid-input" as const;
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details.map((entry) => String(entry));
    super(`invalid experience-api input: ${list.join("; ")}`);
    this.name = "ExperienceError";
    this.details = list;
  }
}

// ---------------------------------------------------------------------------
// Shared runtime helpers (used by every use-case)
// ---------------------------------------------------------------------------

/**
 * Validate the caller-supplied context. Throws `ExperienceError` with every
 * collected problem when it is malformed (untyped JS callers included).
 */
export function assertValidExperienceContext(ctx: ExperienceContext): void {
  if (!isRecord(ctx)) {
    throw new ExperienceError("ctx: expected an ExperienceContext object");
  }
  const problems: string[] = [];
  if (typeof ctx.userId !== "string" || ctx.userId.trim().length === 0) {
    problems.push(`ctx.userId: expected a non-empty string, got ${previewValue(ctx.userId)}`);
  }
  if (typeof ctx.sessionId !== "string" || ctx.sessionId.length === 0) {
    problems.push(`ctx.sessionId: expected a non-empty string, got ${previewValue(ctx.sessionId)}`);
  }
  if (typeof ctx.locale !== "string" || ctx.locale.trim().length === 0) {
    problems.push(`ctx.locale: expected a non-empty string, got ${previewValue(ctx.locale)}`);
  }
  if (ctx.region !== undefined && typeof ctx.region !== "string") {
    problems.push(`ctx.region: expected a string when present, got ${previewValue(ctx.region)}`);
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

/** The capability truth: does the port's connector declare `capability`? */
export function connectorHas(connector: ConnectorPort, capability: Capability): boolean {
  return connector.descriptor().capabilities.includes(capability);
}

/** Compact, safe description of a thrown value for typed failure details. */
export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  return previewValue(thrown);
}

const RECEIPT_STATUSES: ReadonlySet<string> = new Set([
  "confirmed",
  "local-only",
  "unsupported",
  "failed",
]);

/**
 * Runtime shape check for a value a port claims is a frozen `ActionReceipt`.
 * A malformed receipt is reported as a typed `port-failed` result by the
 * use-cases — never fabricated, never trusted blindly.
 */
export function isUsableReceipt(value: unknown): value is ActionReceipt {
  if (!isRecord(value)) return false;
  if (typeof value.status !== "string" || !RECEIPT_STATUSES.has(value.status)) return false;
  if (typeof value.occurredAt !== "string" || !isIso8601(value.occurredAt)) return false;
  if (value.externalId !== undefined && typeof value.externalId !== "string") return false;
  if (value.detail !== undefined && typeof value.detail !== "string") return false;
  return true;
}
