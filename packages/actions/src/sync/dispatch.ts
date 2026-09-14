/**
 * @wfx/actions — the sync dispatcher / durable worker (WFX-022, Lane B).
 *
 * `SyncDispatcher.tick(now)` drains the outbox's due records against the
 * WFX-012 `ConnectorRegistry`:
 *
 * 1. CAPABILITY GATE (before any attempt is burned): if the connector's
 *    descriptor does not declare the action's own capability
 *    (`UserAction.type` is a member of the frozen `Capability` union), the
 *    record settles `unsupported` (terminal, reason stored) and the driver
 *    is never called — capability honesty, per the product boundary
 *    ("Outbound sync is attempted only through supported official
 *    capabilities").
 * 2. ATTEMPT: the record is claimed (`pending` → `in-flight`, attempts++),
 *    then routed through the injected driver seam (drivers.ts) — never
 *    direct network I/O.
 * 3. RESULT MAPPING (the SDK convention):
 *    - ok + receipt `confirmed`     → `delivered` (terminal, receipt stored).
 *    - ok + receipt `local-only`    → `conflict` (terminal — the source
 *      recorded the action without external confirmation; resolution is
 *      caller policy, see reconcile.ts).
 *    - ok + receipt `unsupported`   → `unsupported` (terminal, receipt kept
 *      in the cause).
 *    - ok + receipt `failed`        → retryable (source-side failure; the
 *      source may succeed on a later attempt).
 *    - error `unsupported`          → `unsupported` (terminal — the belt-and-
 *      braces path: the gate passed but the connector still answers typed
 *      unsupported, e.g. per-item).
 *    - error `transport`/`unauthorized` → retryable (transient transport, or
 *      credential state that may change once the user signs in).
 *    - error `invalid-input`        → `failed` (terminal — retrying identical
 *      bytes can never succeed).
 *    - driver THREW or returned a malformed receipt → typed failure (throw:
 *      retryable — a crash may be transient; malformed receipt: terminal —
 *      an adapter contract violation). A driver bug never crashes the loop.
 * 4. RETRIES: deterministic exponential backoff, `base × 2^attempts`
 *    (attempts = the count AFTER the increment), capped at `maxDelayMs`.
 *    At the attempts cap (default 5) the record settles `failed` with an
 *    `exhausted` cause that preserves the last underlying error.
 * 5. AUDIT: every transition appends a `SyncLog` entry — timestamped at the
 *    tick's effective time, old-state → new-state, cause, attempt count.
 *
 * Routing gaps (connector not registered, no driver wired) are typed
 * retryable `wiring` failures bounded by the attempts cap — never silent
 * drops, never fake success.
 *
 * Time discipline: `tick(now?)` uses the explicit argument when provided
 * and the injected `Clock` otherwise; ALL timestamps of a tick (audit log,
 * `nextAttemptAt`, `deliveredAt`) derive from that one effective now — no
 * hidden wall clock, real timers, or randomness anywhere.
 *
 * Error channels: caller misuse (malformed options/now) throws the typed
 * `ActionSyncError`; outbox invariant violations throw `OutboxStateError`
 * (programmer channel — loud, never faked); everything source-side is a
 * typed record outcome.
 */

import type { ActionReceipt, ConnectorContext } from "@wfx/domain";
import { isIso8601, isRecord, previewValue } from "@wfx/domain";
import type { ConnectorError, ConnectorRegistry, ConnectorResult } from "@wfx/connectors";
import { describeConnectorError } from "@wfx/connectors";

import { ActionSyncError } from "./outbox";
import type {
  ActionOutbox,
  Clock,
  OutboxFailureCause,
  OutboxRecord,
  OutboxStatus,
} from "./outbox";
import type { SyncActionRequest, SyncDriver } from "./drivers";

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * The retry policy: exponential backoff `base × 2^attempts` (attempts =
 * failed-attempt count after increment), capped at `maxDelayMs`; a record
 * settles `failed` with an `exhausted` cause once `maxAttempts` is reached.
 */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/** Default policy: 5 attempts, 1s base doubling up to a 60s cap. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

/**
 * The deterministic backoff delay after the `attempts`-th failed attempt:
 * `min(base × 2^attempts, maxDelayMs)`.
 */
export function backoffDelayMs(policy: RetryPolicy, attempts: number): number {
  const raw = policy.baseDelayMs * 2 ** attempts;
  return Math.min(raw, policy.maxDelayMs);
}

// ---------------------------------------------------------------------------
// SyncLog — the audit trail
// ---------------------------------------------------------------------------

/** One audited state transition of one outbox record. */
export interface SyncLogEntry {
  /** ISO timestamp of the tick that performed the transition. */
  readonly timestamp: string;
  readonly recordId: string;
  readonly idempotencyKey: string;
  /** The record's status BEFORE the transition. */
  readonly from: OutboxStatus;
  /** The record's status AFTER the transition. */
  readonly to: OutboxStatus;
  /** The attempt count recorded with the transition. */
  readonly attempt: number;
  /** Deterministic, human-readable cause of the transition. */
  readonly cause: string;
}

/**
 * The append-only audit trail of every dispatcher transition. Entries are
 * frozen on append; `entries()` returns the chronological sequence.
 */
export class SyncLog {
  private readonly entries_: SyncLogEntry[] = [];

  /** Append one audited transition (frozen snapshot). */
  append(entry: SyncLogEntry): void {
    this.entries_.push(
      Object.freeze({
        ...entry,
      }),
    );
  }

  /** Every entry, in append order. */
  entries(): readonly SyncLogEntry[] {
    return [...this.entries_];
  }

  /** The entries of one record, in append order. */
  forRecord(recordId: string): SyncLogEntry[] {
    return this.entries_.filter((entry) => entry.recordId === recordId);
  }

  /** Number of entries. */
  size(): number {
    return this.entries_.length;
  }
}

// ---------------------------------------------------------------------------
// Tick reports
// ---------------------------------------------------------------------------

/** The per-record outcome of one tick (net transition of the record). */
export interface TickRecordOutcome {
  readonly recordId: string;
  readonly idempotencyKey: string;
  /** Status at tick start. */
  readonly from: OutboxStatus;
  /** Status after the tick. */
  readonly to: OutboxStatus;
  readonly attempt: number;
  readonly cause: string;
}

/** The summary of one `tick` run. */
export interface TickReport {
  /** ISO timestamp of the tick's effective now. */
  readonly now: string;
  /** How many records claimed a dispatch window. */
  readonly dueCount: number;
  /** One outcome per processed record, in due order. */
  readonly outcomes: readonly TickRecordOutcome[];
}

// ---------------------------------------------------------------------------
// Cause rendering (single source of truth for cause strings)
// ---------------------------------------------------------------------------

/**
 * Render a typed outbox failure cause as a deterministic one-line string
 * (used verbatim in `SyncLog` entries and tick outcomes).
 */
export function describeSyncCause(cause: OutboxFailureCause): string {
  switch (cause.kind) {
    case "unsupported-capability":
      return cause.detail;
    case "connector-error":
      return describeConnectorError(cause.error);
    case "receipt":
      return cause.receipt.detail === undefined
        ? `receipt status '${cause.receipt.status}'`
        : `receipt status '${cause.receipt.status}': ${cause.receipt.detail}`;
    case "driver":
      return cause.detail;
    case "exhausted":
      return `exhausted after ${cause.attempts} attempts; last error: ${cause.lastCause}`;
    case "wiring":
      return cause.detail;
  }
}

// ---------------------------------------------------------------------------
// Receipt validation (the driver's answer is never trusted blindly)
// ---------------------------------------------------------------------------

const RECEIPT_STATUSES: ReadonlySet<string> = new Set([
  "confirmed",
  "local-only",
  "unsupported",
  "failed",
]);

/** Runtime shape check for a value a driver claims is an `ActionReceipt`. */
function isUsableReceipt(value: unknown): value is ActionReceipt {
  if (!isRecord(value)) return false;
  if (typeof value.status !== "string" || !RECEIPT_STATUSES.has(value.status)) return false;
  if (typeof value.occurredAt !== "string" || !isIso8601(value.occurredAt)) return false;
  if (value.externalId !== undefined && typeof value.externalId !== "string") return false;
  if (value.detail !== undefined && typeof value.detail !== "string") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

/** ISO timestamp from explicit epoch milliseconds (deterministic). */
function isoOf(now: number): string {
  return new Date(now).toISOString();
}

/** Compact, safe description of a thrown value for typed failure details. */
function describeThrownValue(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  return previewValue(thrown);
}

/** Rebuild the frozen `ConnectorContext` from a record's locale/region. */
function contextFor(record: OutboxRecord): ConnectorContext {
  return record.region === undefined
    ? { userId: record.userId, locale: record.locale }
    : { userId: record.userId, locale: record.locale, region: record.region };
}

// ---------------------------------------------------------------------------
// SyncDispatcher
// ---------------------------------------------------------------------------

/** Constructor options for {@link SyncDispatcher}. */
export interface SyncDispatcherOptions {
  /** The outbox being drained (the transactional record store). */
  readonly outbox: ActionOutbox;
  /** The WFX-012 connector registry — the capability truth for routing. */
  readonly registry: ConnectorRegistry;
  /**
   * The driver seam: resolves the `SyncDriver` for a connector id, or
   * `undefined` when none is wired (a typed retryable wiring gap).
   */
  readonly resolveDriver: (connectorId: string) => SyncDriver | undefined;
  /** The default time source (used when `tick()` gets no explicit `now`). */
  readonly clock: Clock;
  /** Partial overrides of the default retry policy. */
  readonly retry?: Partial<RetryPolicy>;
  /** An externally owned audit log (defaults to a fresh `SyncLog`). */
  readonly log?: SyncLog;
}

/**
 * The durable worker: drains due outbox records, gates on capability,
 * executes through the injected driver seam, maps typed outcomes, retries
 * with deterministic exponential backoff, and audits every transition.
 */
export class SyncDispatcher {
  readonly log: SyncLog;
  readonly retryPolicy: RetryPolicy;

  private readonly outbox: ActionOutbox;
  private readonly registry: ConnectorRegistry;
  private readonly resolveDriver: (connectorId: string) => SyncDriver | undefined;
  private readonly clock: Clock;

  constructor(options: SyncDispatcherOptions) {
    if (!isRecord(options)) {
      throw new ActionSyncError("options: expected a SyncDispatcherOptions object");
    }
    const problems: string[] = [];
    if (!isRecord(options.outbox)) {
      problems.push("options.outbox: expected an ActionOutbox instance");
    }
    if (!isRecord(options.registry)) {
      problems.push("options.registry: expected a ConnectorRegistry instance");
    }
    if (typeof options.resolveDriver !== "function") {
      problems.push(
        "options.resolveDriver: expected a (connectorId: string) => SyncDriver | undefined function",
      );
    }
    if (!isRecord(options.clock) || typeof options.clock.now !== "function") {
      problems.push("options.clock: expected a Clock (now(): number)");
    }
    const retry: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...(options.retry ?? {}) };
    if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1) {
      problems.push(
        `options.retry.maxAttempts: expected an integer >= 1, got ${previewValue(retry.maxAttempts)}`,
      );
    }
    if (!Number.isFinite(retry.baseDelayMs) || retry.baseDelayMs <= 0) {
      problems.push(
        `options.retry.baseDelayMs: expected a finite positive number, got ${previewValue(retry.baseDelayMs)}`,
      );
    }
    if (!Number.isFinite(retry.maxDelayMs) || retry.maxDelayMs < retry.baseDelayMs) {
      problems.push(
        `options.retry.maxDelayMs: expected a finite number >= baseDelayMs (${retry.baseDelayMs}), got ${previewValue(retry.maxDelayMs)}`,
      );
    }
    if (options.log !== undefined && !isRecord(options.log)) {
      problems.push("options.log: expected a SyncLog instance when provided");
    }
    if (problems.length > 0) throw new ActionSyncError(problems);

    this.outbox = options.outbox;
    this.registry = options.registry;
    this.resolveDriver = options.resolveDriver;
    this.clock = options.clock;
    this.retryPolicy = retry;
    this.log = options.log ?? new SyncLog();
  }

  /**
   * Drain every due record once. `now` — the tick's effective time for due
   * selection, backoff base, and audit timestamps — defaults to the
   * injected clock. Returns the per-record outcomes; a driver-side failure
   * never aborts the loop (outbox invariant violations do — they are
   * programmer errors and stay loud).
   */
  async tick(now: number = this.clock.now()): Promise<TickReport> {
    if (!Number.isFinite(now)) {
      throw new ActionSyncError(
        `now: expected a finite epoch-milliseconds number, got ${previewValue(now)}`,
      );
    }
    const dueRecords = this.outbox.due(now);
    const outcomes: TickRecordOutcome[] = [];
    for (const record of dueRecords) {
      outcomes.push(await this.dispatchRecord(record, now));
    }
    return { now: isoOf(now), dueCount: dueRecords.length, outcomes };
  }

  // --- one record ------------------------------------------------------------

  private async dispatchRecord(
    record: OutboxRecord,
    now: number,
  ): Promise<TickRecordOutcome> {
    const from = record.status;
    const connector = this.registry.get(record.connectorId);

    // Capability gate — before any attempt is burned.
    if (
      connector !== undefined &&
      !connector.descriptor().capabilities.includes(record.action.type)
    ) {
      const cause: OutboxFailureCause = {
        kind: "unsupported-capability",
        capability: record.action.type,
        detail: `connector '${record.connectorId}' does not declare '${record.action.type}'`,
      };
      const updated = this.outbox.markUnsupported(record.id, cause);
      const text = describeSyncCause(cause);
      this.logTransition(now, from, updated, `capability gate: ${text}`);
      return this.finish(from, updated, `unsupported: ${text}`);
    }

    // Claim the record for this dispatch attempt.
    const inFlight = this.outbox.beginAttempt(record.id);
    this.logTransition(now, from, inFlight, `dispatch attempt ${inFlight.attempts}`);

    if (connector === undefined) {
      return this.retryOrExhaust(from, inFlight, {
        kind: "wiring",
        detail: `connector '${record.connectorId}' is not registered (no live instance)`,
      }, now);
    }

    const driver = this.resolveDriver(record.connectorId);
    if (driver === undefined) {
      return this.retryOrExhaust(from, inFlight, {
        kind: "wiring",
        detail: `no sync driver wired for connector '${record.connectorId}'`,
      }, now);
    }

    const request: SyncActionRequest = {
      idempotencyKey: inFlight.idempotencyKey,
      recordId: inFlight.id,
      userId: inFlight.userId,
      attempt: inFlight.attempts,
      ctx: contextFor(inFlight),
      action: inFlight.action,
    };

    let result: ConnectorResult<ActionReceipt>;
    try {
      result = await driver.execute(request);
    } catch (thrown) {
      return this.retryOrExhaust(from, inFlight, {
        kind: "driver",
        detail: `driver threw: ${describeThrownValue(thrown)}`,
      }, now);
    }
    return this.applyResult(from, inFlight, result, now);
  }

  /** Map a driver result (the SDK convention) onto the outbox state machine. */
  private applyResult(
    from: OutboxStatus,
    inFlight: OutboxRecord,
    result: ConnectorResult<ActionReceipt>,
    now: number,
  ): TickRecordOutcome {
    if (result.ok) {
      const receipt = result.value;
      if (!isUsableReceipt(receipt)) {
        const cause: OutboxFailureCause = {
          kind: "driver",
          detail: `driver returned a malformed ActionReceipt: ${previewValue(receipt)}`,
        };
        const updated = this.outbox.markFailed(inFlight.id, cause);
        const text = describeSyncCause(cause);
        this.logTransition(now, "in-flight", updated, text);
        return this.finish(from, updated, text);
      }
      switch (receipt.status) {
        case "confirmed": {
          const updated = this.outbox.markDelivered(inFlight.id, receipt, now);
          const text =
            receipt.externalId === undefined
              ? "receipt confirmed"
              : `receipt confirmed (externalId '${receipt.externalId}')`;
          this.logTransition(now, "in-flight", updated, text);
          return this.finish(from, updated, text);
        }
        case "local-only": {
          const cause: OutboxFailureCause = { kind: "receipt", receipt };
          const updated = this.outbox.markConflict(inFlight.id, cause);
          const text = describeSyncCause(cause);
          this.logTransition(now, "in-flight", updated, text);
          return this.finish(from, updated, text);
        }
        case "unsupported": {
          const cause: OutboxFailureCause = { kind: "receipt", receipt };
          const updated = this.outbox.markUnsupported(inFlight.id, cause);
          const text = describeSyncCause(cause);
          this.logTransition(now, "in-flight", updated, text);
          return this.finish(from, updated, text);
        }
        case "failed": {
          return this.retryOrExhaust(from, inFlight, { kind: "receipt", receipt }, now);
        }
      }
    }

    const error: ConnectorError = result.error;
    if (error.kind === "unsupported") {
      const cause: OutboxFailureCause = { kind: "connector-error", error };
      const updated = this.outbox.markUnsupported(inFlight.id, cause);
      const text = describeConnectorError(error);
      this.logTransition(now, "in-flight", updated, text);
      return this.finish(from, updated, text);
    }
    if (error.kind === "transport" || error.kind === "unauthorized") {
      return this.retryOrExhaust(from, inFlight, { kind: "connector-error", error }, now);
    }
    // invalid-input: retrying identical bytes can never succeed.
    const cause: OutboxFailureCause = { kind: "connector-error", error };
    const updated = this.outbox.markFailed(inFlight.id, cause);
    const text = describeConnectorError(error);
    this.logTransition(now, "in-flight", updated, text);
    return this.finish(from, updated, text);
  }

  /** Schedule the deterministic backoff retry, or settle exhausted at the cap. */
  private retryOrExhaust(
    from: OutboxStatus,
    inFlight: OutboxRecord,
    cause: OutboxFailureCause,
    now: number,
  ): TickRecordOutcome {
    const causeText = describeSyncCause(cause);
    if (inFlight.attempts >= this.retryPolicy.maxAttempts) {
      const exhausted: OutboxFailureCause = {
        kind: "exhausted",
        attempts: inFlight.attempts,
        lastCause: causeText,
      };
      const updated = this.outbox.markFailed(inFlight.id, exhausted);
      const text = describeSyncCause(exhausted);
      this.logTransition(now, "in-flight", updated, text);
      return this.finish(from, updated, text);
    }
    const delayMs = backoffDelayMs(this.retryPolicy, inFlight.attempts);
    const updated = this.outbox.scheduleRetry(inFlight.id, cause, delayMs, now);
    const text = `retryable failure (${causeText}); retry scheduled in ${delayMs}ms`;
    this.logTransition(now, "in-flight", updated, text);
    return this.finish(from, updated, text);
  }

  // --- plumbing ----------------------------------------------------------------

  private logTransition(
    now: number,
    from: OutboxStatus,
    after: OutboxRecord,
    cause: string,
  ): void {
    this.log.append({
      timestamp: isoOf(now),
      recordId: after.id,
      idempotencyKey: after.idempotencyKey,
      from,
      to: after.status,
      attempt: after.attempts,
      cause,
    });
  }

  private finish(from: OutboxStatus, updated: OutboxRecord, cause: string): TickRecordOutcome {
    return {
      recordId: updated.id,
      idempotencyKey: updated.idempotencyKey,
      from,
      to: updated.status,
      attempt: updated.attempts,
      cause,
    };
  }
}
