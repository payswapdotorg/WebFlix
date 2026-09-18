/**
 * @wfx/actions — the transactional action outbox (WFX-022, Lane B).
 *
 * The outbox is the local source of truth for every user action (like /
 * save / follow / comment / download / transform) that must be mirrored to
 * an external source. It follows the frozen architecture's jobs law
 * ("Jobs: transactional outbox + durable workers initially") and the
 * product boundary ("All social actions are first recorded locally.
 * Outbound sync is attempted only through supported official capabilities."):
 * an action is RECORDED FIRST, and outbound synchronization is attempted
 * afterwards by the durable worker (`SyncDispatcher`, dispatch.ts).
 *
 * This implementation is PURE and IN-MEMORY, but its interface is exactly
 * the interface a durable store would implement: `enqueue` (the transaction
 * boundary), `due(now)` (the worker's claim query), and a closed set of
 * transition methods the dispatcher drives (`beginAttempt`, `scheduleRetry`,
 * `markDelivered`, `markUnsupported`, `markConflict`, `markFailed`). A
 * SQL-backed store implements the same methods with row locks and the same
 * state machine.
 *
 * Determinism laws (no drift):
 * - No randomness, no hidden clock: the ONLY time source is the injected
 *   `Clock`; `due(now)` is a pure function of its argument.
 * - Record ids and idempotency keys are DETERMINISTIC hashes of the entry's
 *   identity (same precedent as @wfx/recommendation's synthetic
 *   realization ids): the same entry always yields the same id and key.
 *
 * Idempotency law: the idempotency key is a hash over (userId, connectorId,
 * action verb, target externalRef, clientRequestToken). Enqueuing the SAME
 * entry twice returns the EXISTING record with a typed `duplicate` marker —
 * the action is never double-executed. Enqueuing an entry with the same key
 * but DIFFERENT content (payload / locale / region) returns the existing
 * record with a typed `conflict` marker and the field differences — the
 * store never silently overwrites. Both paths leave the stored record
 * untouched.
 *
 * Error-channel policy (mirrors @wfx/connectors result.ts):
 * - CALLER misuse (malformed entry, malformed constructor options, malformed
 *   `now`) throws the typed `ActionSyncError` — the invalid-input channel.
 * - DISPATCHER-side invariant violations (unknown record id, illegal state
 *   transition, receipt/status precondition) throw the typed
 *   `OutboxStateError` — the programmer-error channel, kept loud rather than
 *   faked; they are unreachable in a correctly wired dispatcher.
 */

import type { ActionReceipt, Capability, UserAction } from "@wfx/domain";
import type { ConnectorError } from "@wfx/connectors";
import { isRecord, previewValue } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Environment seams
// ---------------------------------------------------------------------------

/**
 * Time source. `now()` returns epoch milliseconds. No `Date.now()` call
 * exists in this package outside the injected clock (same seam as
 * @wfx/experience's ports).
 */
export interface Clock {
  now(): number;
}

// ---------------------------------------------------------------------------
// Statuses and failure causes
// ---------------------------------------------------------------------------

/**
 * The closed outbox state machine:
 * - `pending`     — recorded, waiting for its next dispatch window.
 * - `in-flight`   — a dispatch attempt is executing (also the recovery
 *                   marker a durable store uses after a worker crash).
 * - `delivered`   — the source confirmed the action (receipt stored).
 * - `failed`      — terminal failure (non-retryable error, or retries
 *                   exhausted); the typed cause is stored.
 * - `unsupported` — terminal: the source cannot perform this action
 *                   (capability gate or typed unsupported answer); never
 *                   faked as success, never retried.
 * - `conflict`    — terminal: the source answered with a state that is
 *                   neither confirmation nor failure (today: a `local-only`
 *                   receipt — recorded at the source without external
 *                   confirmation). Resolution is caller policy (reconcile).
 */
export type OutboxStatus =
  | "pending"
  | "in-flight"
  | "delivered"
  | "failed"
  | "unsupported"
  | "conflict";

/** Every outbox status, in union order. */
export const OUTBOX_STATUSES: readonly OutboxStatus[] = [
  "pending",
  "in-flight",
  "delivered",
  "failed",
  "unsupported",
  "conflict",
];

/** Statuses a record can never leave (the dispatcher's terminal answers). */
export const TERMINAL_OUTBOX_STATUSES: readonly OutboxStatus[] = [
  "delivered",
  "failed",
  "unsupported",
  "conflict",
];

/**
 * The typed cause stored on a record when it fails, is unsupported,
 * conflicts, or is scheduled for retry. Every terminal record carries one;
 * silence is not an outcome.
 *
 * - `unsupported-capability` — the connector's descriptor does not declare
 *   the action's own capability (the dispatcher's pre-flight gate).
 * - `connector-error`        — the SDK's closed error vocabulary, verbatim.
 * - `receipt`                — a receipt-driven terminal/conflict/retry
 *   outcome; the receipt is kept as evidence.
 * - `driver`                 — the sync driver violated its contract
 *   (threw, or returned a malformed receipt).
 * - `exhausted`              — the attempts cap was reached; the last
 *   underlying cause is preserved.
 * - `wiring`                 — the record could not be routed (connector not
 *   registered, or no driver wired); retryable and bounded by the cap.
 */
export type OutboxFailureCause =
  | { kind: "unsupported-capability"; capability: Capability; detail: string }
  | { kind: "connector-error"; error: ConnectorError }
  | { kind: "receipt"; receipt: ActionReceipt }
  | { kind: "driver"; detail: string }
  | { kind: "exhausted"; attempts: number; lastCause: string }
  | { kind: "wiring"; detail: string };

// ---------------------------------------------------------------------------
// Entries and records
// ---------------------------------------------------------------------------

/**
 * A user action to record in the outbox. The identity fields (userId,
 * connectorId, action verb, externalRef, clientRequestToken) feed the
 * idempotency key; `locale`/`region` rebuild the frozen `ConnectorContext`
 * at dispatch time; `payload` is the action's optional argument;
 * `profileId` (R15) is the R02-style profile attribution — the profile the
 * action belongs to (a session's active profile); `undefined` = anonymous
 * (the persistence layer resolves the default-profile fallback per store).
 */
export interface OutboxEntry {
  readonly userId: string;
  readonly connectorId: string;
  readonly action: UserAction["type"];
  readonly externalRef: string;
  readonly clientRequestToken: string;
  readonly payload?: Record<string, unknown>;
  readonly locale: string;
  readonly region?: string;
  /** R15: profile attribution (the recording session's active profile). */
  readonly profileId?: string;
}

/** The closed `UserAction.type` vocabulary (runtime mirror of the frozen union). */
export const SYNC_ACTION_VERBS: readonly UserAction["type"][] = [
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
] as const satisfies readonly UserAction["type"][];

/**
 * One outbox record — the durable shape of a pending or settled action.
 * Records handed out by the store are deep-frozen snapshots: mutating a
 * record (or the payload structures handed over at enqueue time) after the
 * fact is unsupported.
 */
export interface OutboxRecord {
  /** Deterministic id: `wfxout_` + the idempotency key digest. */
  readonly id: string;
  /** The idempotency key (hash of the entry identity). */
  readonly idempotencyKey: IdempotencyKey;
  readonly userId: string;
  readonly connectorId: string;
  /** The frozen `UserAction` rebuilt from the entry (verb, ref, payload). */
  readonly action: UserAction;
  readonly clientRequestToken: string;
  readonly locale: string;
  readonly region?: string;
  /** R15: profile attribution (the recording session's active profile). */
  readonly profileId?: string;
  readonly status: OutboxStatus;
  /** How many dispatch attempts have been burned (driver-level or routing). */
  readonly attempts: number;
  /** ISO timestamp: when the next dispatch attempt may run. */
  readonly nextAttemptAt: string;
  /** ISO timestamp: when the record was enqueued. */
  readonly enqueuedAt: string;
  /** The source's confirming receipt — present iff status is `delivered`. */
  readonly receipt?: ActionReceipt;
  /** The typed cause of the latest failure/terminal answer, when there is one. */
  readonly lastCause?: OutboxFailureCause;
  /** ISO timestamp of delivery — present iff status is `delivered`. */
  readonly deliveredAt?: string;
}

/**
 * The typed outcome of `enqueue`:
 * - `enqueued` — a fresh record was created.
 * - `duplicate` — the SAME entry (identical identity AND content) was
 *   already enqueued; the existing record is returned untouched.
 * - `conflict` — the same idempotency KEY arrived with DIFFERENT content
 *   (payload/locale/region); the existing record is returned untouched and
 *   the exact differences are listed. Never a silent overwrite.
 */
export type EnqueueResult =
  | { outcome: "enqueued"; record: OutboxRecord }
  | { outcome: "duplicate"; record: OutboxRecord }
  | { outcome: "conflict"; record: OutboxRecord; differences: readonly string[] };

// ---------------------------------------------------------------------------
// Idempotency keys (deterministic, dependency-free)
// ---------------------------------------------------------------------------

/** Brand: a value produced by {@link idempotencyKeyFor}. */
export type IdempotencyKey = string & { readonly __wfxSyncKind: "IdempotencyKey" };

/** One round of 32-bit FNV-1a over `input`, seeded with `seed`. */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 128-bit deterministic hex digest of `key` (4 seeded FNV-1a rounds). */
function digestHex(key: string): string {
  let hex = "";
  for (let round = 0; round < 4; round += 1) {
    const hash = fnv1a32(`wfx-sync-v1:${round}:${key}`, 0x811c9dc5);
    hex += hash.toString(16).padStart(8, "0");
  }
  return hex;
}

/**
 * The idempotency key of an action identity: a deterministic hash over
 * (userId, connectorId, action verb, target externalRef,
 * clientRequestToken). The same identity always yields the same key;
 * different identities collide only with negligible 128-bit probability.
 */
export function idempotencyKeyFor(identity: {
  userId: string;
  connectorId: string;
  action: UserAction["type"];
  externalRef: string;
  clientRequestToken: string;
}): IdempotencyKey {
  const canonical = JSON.stringify([
    identity.userId,
    identity.connectorId,
    identity.action,
    identity.externalRef,
    identity.clientRequestToken,
  ]);
  return digestHex(canonical) as IdempotencyKey;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown for INVALID CALLER INPUT (the misuse channel — same role
 * `ExperienceError` plays in @wfx/experience). Never thrown for
 * source-side conditions; those are typed records.
 */
export class ActionSyncError extends Error {
  readonly kind = "invalid-input" as const;
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details.map((entry) => String(entry));
    super(`invalid action-sync input: ${list.join("; ")}`);
    this.name = "ActionSyncError";
    this.details = list;
  }
}

/**
 * Thrown for OUTBOX INVARIANT violations (the programmer channel):
 * an unknown record id, an illegal state transition, or a receipt/status
 * precondition. Unreachable in a correctly wired dispatcher — kept loud
 * rather than faked.
 */
export class OutboxStateError extends Error {
  readonly kind = "invariant" as const;

  constructor(detail: string) {
    super(`outbox state violation: ${detail}`);
    this.name = "OutboxStateError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** ISO timestamp from explicit epoch milliseconds (deterministic). */
function isoOf(now: number): string {
  return new Date(now).toISOString();
}

/** Deterministically canonicalize a JSON-ish value (sorted object keys). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Recursively freeze plain objects/arrays (records are immutable snapshots). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) deepFreeze(item);
      Object.freeze(value);
    } else {
      for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
      Object.freeze(value);
    }
  }
  return value;
}

/** Build the frozen `UserAction` stored on a record from an entry. */
function actionFromEntry(entry: OutboxEntry): UserAction {
  return {
    type: entry.action,
    connectorId: entry.connectorId,
    externalRef: entry.externalRef,
    ...(entry.payload !== undefined ? { payload: { ...entry.payload } } : {}),
  };
}

/**
 * Field-level validation of one claimed `OutboxEntry`; throws the typed
 * `ActionSyncError` naming every problem. R15: shared with the SQL-backed
 * durable store so both implementations enforce the SAME input contract.
 */
export function assertValidOutboxEntry(entry: OutboxEntry): void {
  assertValidEntry(entry);
}

/** Field-level validation of one claimed `OutboxEntry`; throws `ActionSyncError`. */
function assertValidEntry(entry: OutboxEntry): void {
  if (!isRecord(entry)) {
    throw new ActionSyncError("entry: expected an OutboxEntry object");
  }
  const problems: string[] = [];
  if (typeof entry.userId !== "string" || entry.userId.trim().length === 0) {
    problems.push(`entry.userId: expected a non-empty string, got ${previewValue(entry.userId)}`);
  }
  if (typeof entry.connectorId !== "string" || entry.connectorId.trim().length === 0) {
    problems.push(
      `entry.connectorId: expected a non-empty string, got ${previewValue(entry.connectorId)}`,
    );
  }
  if (typeof entry.action !== "string" || !SYNC_ACTION_VERBS.includes(entry.action)) {
    problems.push(
      `entry.action: expected one of ${SYNC_ACTION_VERBS.join(" | ")}, got ${previewValue(entry.action)}`,
    );
  }
  if (typeof entry.externalRef !== "string" || entry.externalRef.trim().length === 0) {
    problems.push(
      `entry.externalRef: expected a non-empty string, got ${previewValue(entry.externalRef)}`,
    );
  }
  if (
    typeof entry.clientRequestToken !== "string" ||
    entry.clientRequestToken.trim().length === 0
  ) {
    problems.push(
      `entry.clientRequestToken: expected a non-empty string, got ${previewValue(entry.clientRequestToken)}`,
    );
  }
  if (typeof entry.locale !== "string" || entry.locale.trim().length === 0) {
    problems.push(`entry.locale: expected a non-empty string, got ${previewValue(entry.locale)}`);
  }
  if (entry.region !== undefined && typeof entry.region !== "string") {
    problems.push(`entry.region: expected a string when present, got ${previewValue(entry.region)}`);
  }
  if (entry.profileId !== undefined && (typeof entry.profileId !== "string" || entry.profileId.trim().length === 0)) {
    problems.push(
      `entry.profileId: expected a non-empty string when present, got ${previewValue(entry.profileId)}`,
    );
  }
  if (entry.payload !== undefined && !isRecord(entry.payload)) {
    problems.push(
      `entry.payload: expected an object when present, got ${previewValue(entry.payload)}`,
    );
  }
  if (problems.length > 0) throw new ActionSyncError(problems);
}

/**
 * Content differences between a stored record and a re-enqueued entry (the
 * identity fields are equal by construction — they are the key's input).
 * R15: shared with the SQL-backed durable store so both implementations
 * answer the SAME typed duplicate/conflict distinction.
 */
export function outboxContentDifferences(
  record: OutboxRecord,
  entry: OutboxEntry,
): readonly string[] {
  return contentDifferences(record, entry);
}

/**
 * Content differences between a stored record and a re-enqueued entry (the
 * identity fields are equal by construction — they are the key's input).
 */
function contentDifferences(record: OutboxRecord, entry: OutboxEntry): string[] {
  const differences: string[] = [];
  if (record.locale !== entry.locale) {
    differences.push(`locale: '${record.locale}' vs '${entry.locale}'`);
  }
  const recordRegion = record.region ?? "(absent)";
  const entryRegion = entry.region ?? "(absent)";
  if (recordRegion !== entryRegion) {
    differences.push(`region: '${recordRegion}' vs '${entryRegion}'`);
  }
  const recordProfile = record.profileId ?? "(absent)";
  const entryProfile = entry.profileId ?? "(absent)";
  if (recordProfile !== entryProfile) {
    differences.push(`profileId: '${recordProfile}' vs '${entryProfile}'`);
  }
  const recordPayload = record.action.payload ?? {};
  const entryPayload = entry.payload ?? {};
  const recordPayloadJson = canonicalJson(recordPayload);
  const entryPayloadJson = canonicalJson(entryPayload);
  if (recordPayloadJson !== entryPayloadJson) {
    differences.push(`payload: ${recordPayloadJson} vs ${entryPayloadJson}`);
  }
  return differences;
}

// ---------------------------------------------------------------------------
// ActionOutboxStore — the durable-store contract (R15)
// ---------------------------------------------------------------------------

/**
 * THE STORE CONTRACT (R15): the exact surface the in-memory `ActionOutbox`
 * and the SQL-backed durable store (`@wfx/persistence`'s
 * `PostgresActionOutbox`) both implement — one interface, two
 * interchangeable implementations, the same seam discipline as
 * `@wfx/persistence`'s `DbClient`.
 *
 * Every method is ASYNC: the durable store's answers cross SQL I/O, and a
 * synchronous interface could not be implemented honestly against it. The
 * in-memory store keeps its exact semantics under `async` signatures.
 *
 * State-machine laws (both implementations enforce them):
 * - `enqueue` is the transaction boundary: same idempotency key + identical
 *   content ⇒ typed `duplicate`; same key + different content ⇒ typed
 *   `conflict` (differences listed). The stored record is never modified,
 *   never duplicated. The DURABLE store additionally writes the action's
 *   local audit row INSIDE the same enqueue transaction — the local-first
 *   recording law (a durable outbox row never exists without its audit
 *   row).
 * - `due(now)` is the worker's claim query: `pending` records whose
 *   `nextAttemptAt` is past `now`, plus `in-flight` records past their
 *   claim-staleness window (crash recovery). The in-memory store treats
 *   every past-due `in-flight` record as due (single-process); the durable
 *   store uses its configured staleness window so a LIVE worker's claim is
 *   never stolen (multi-worker safety), only a crashed one's.
 * - transitions enforce the closed status graph; an illegal transition (or
 *   unknown record id) throws the typed `OutboxStateError` — the
 *   programmer-error channel, kept loud rather than faked. The durable
 *   store throws the SAME error when a guarded UPDATE affects zero rows
 *   (the record was superseded by a concurrent worker — the dispatcher
 *   catches this one race and audits it, see dispatch.ts).
 */
export interface ActionOutboxStore {
  /** Record one user action (the transaction boundary — see the interface docs). */
  enqueue(entry: OutboxEntry): Promise<EnqueueResult>;
  /**
   * The dispatch-window claim query: records a worker may attempt now.
   * Pure in `now`; ordered by `(nextAttemptAt, id)`; the durable store
   * bounds the result by its configured `dueLimit`.
   */
  due(now: number): Promise<readonly OutboxRecord[]>;
  /** The record stored under `id`, if any (a frozen snapshot). */
  get(id: string): Promise<OutboxRecord | undefined>;
  /** The record stored under the idempotency key, if any. */
  getByIdempotencyKey(key: string): Promise<OutboxRecord | undefined>;
  /**
   * All records, in enqueue order. The durable store bounds this by its
   * configured `allLimit` (newest first is NOT the order — enqueue order
   * is, matching the in-memory store).
   */
  all(): Promise<readonly OutboxRecord[]>;
  /** Claim a record for a dispatch attempt: pending/stale-in-flight → in-flight, attempts++. */
  beginAttempt(id: string): Promise<OutboxRecord>;
  /** Release a failed attempt back to pending with the deterministic backoff window. */
  scheduleRetry(
    id: string,
    cause: OutboxFailureCause,
    delayMs: number,
    now: number,
  ): Promise<OutboxRecord>;
  /** Settle as `delivered` (terminal) — requires a `confirmed` receipt. */
  markDelivered(id: string, receipt: ActionReceipt, now: number): Promise<OutboxRecord>;
  /** Settle as `unsupported` (terminal) — never a fabricated receipt. */
  markUnsupported(id: string, cause: OutboxFailureCause): Promise<OutboxRecord>;
  /** Settle as `conflict` (terminal) — a `local-only` receipt answer. */
  markConflict(id: string, cause: OutboxFailureCause): Promise<OutboxRecord>;
  /** Settle as `failed` (terminal) — the typed cause is stored. */
  markFailed(id: string, cause: OutboxFailureCause): Promise<OutboxRecord>;
}

// ---------------------------------------------------------------------------
// ActionOutbox
// ---------------------------------------------------------------------------

/** Constructor options for {@link ActionOutbox}. */
export interface ActionOutboxOptions {
  /** The time source stamping `enqueuedAt` / initial `nextAttemptAt`. */
  readonly clock: Clock;
}

/**
 * The transactional action outbox: records user actions once (idempotently)
 * and exposes the claim/transition surface a durable worker drives.
 *
 * The store owns the state machine and enforces it: transitions from
 * terminal statuses are rejected (`OutboxStateError`), `markDelivered`
 * accepts only `confirmed` receipts, `markConflict` only receipt-caused
 * conflicts carrying a `local-only` receipt, and `markUnsupported` never
 * stores a receipt whose status contradicts the terminal answer.
 *
 * R15: this class implements {@link ActionOutboxStore} — the SAME contract
 * the SQL-backed durable store implements; the dispatcher drives either
 * through the one interface. In-memory, `enqueue` is the transaction
 * boundary by construction; the durable store makes it a real SQL
 * transaction (outbox row + local audit row commit together).
 */
export class ActionOutbox implements ActionOutboxStore {
  private readonly clock: Clock;
  private readonly records = new Map<string, OutboxRecord>();
  private readonly idsByKey = new Map<IdempotencyKey, string>();

  constructor(options: ActionOutboxOptions) {
    if (!isRecord(options)) {
      throw new ActionSyncError("options: expected an ActionOutboxOptions object");
    }
    if (!isRecord(options.clock) || typeof options.clock.now !== "function") {
      throw new ActionSyncError(
        `options.clock: expected a Clock (now(): number), got ${previewValue(options.clock)}`,
      );
    }
    this.clock = options.clock;
  }

  /**
   * Record one user action. Stamps `enqueuedAt` and the initial
   * `nextAttemptAt` from the injected clock (`now`, i.e. immediately due),
   * `attempts: 0`, `status: "pending"`.
   *
   * Idempotency: a second enqueue with the SAME idempotency key returns the
   * existing record with the typed `duplicate` marker (identical content)
   * or the typed `conflict` marker (different content, differences listed).
   * The stored record is never modified or duplicated.
   */
  async enqueue(entry: OutboxEntry): Promise<EnqueueResult> {
    assertValidEntry(entry);
    const key = idempotencyKeyFor(entry);
    const existingId = this.idsByKey.get(key);
    if (existingId !== undefined) {
      const existing = this.records.get(existingId);
      if (existing === undefined) {
        // Unreachable: idsByKey only ever contains stored record ids.
        throw new OutboxStateError(`idempotency key maps to unknown record id '${existingId}'`);
      }
      const differences = contentDifferences(existing, entry);
      if (differences.length === 0) {
        return { outcome: "duplicate", record: existing };
      }
      return { outcome: "conflict", record: existing, differences };
    }

    const nowIso = isoOf(this.clock.now());
    const record: OutboxRecord = deepFreeze({
      id: `wfxout_${key}`,
      idempotencyKey: key,
      userId: entry.userId,
      connectorId: entry.connectorId,
      action: actionFromEntry(entry),
      clientRequestToken: entry.clientRequestToken,
      locale: entry.locale,
      ...(entry.region !== undefined ? { region: entry.region } : {}),
      ...(entry.profileId !== undefined ? { profileId: entry.profileId } : {}),
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: nowIso,
      enqueuedAt: nowIso,
    });
    this.records.set(record.id, record);
    this.idsByKey.set(key, record.id);
    return { outcome: "enqueued", record };
  }

  /**
   * Records claiming a dispatch window: `pending`/`in-flight` records whose
   * `nextAttemptAt` is past `now`. Pure in `now`; insertion-ordered.
   */
  async due(now: number): Promise<readonly OutboxRecord[]> {
    if (!Number.isFinite(now)) {
      throw new ActionSyncError(
        `now: expected a finite epoch-milliseconds number, got ${previewValue(now)}`,
      );
    }
    const nowIso = isoOf(now);
    const claimed: OutboxRecord[] = [];
    for (const record of this.records.values()) {
      if (
        (record.status === "pending" || record.status === "in-flight") &&
        record.nextAttemptAt <= nowIso
      ) {
        claimed.push(record);
      }
    }
    return claimed;
  }

  /** The record stored under `id`, if any. */
  async get(id: string): Promise<OutboxRecord | undefined> {
    return this.records.get(id);
  }

  /** The record stored under the idempotency key, if any. */
  async getByIdempotencyKey(key: string): Promise<OutboxRecord | undefined> {
    const id = this.idsByKey.get(key as IdempotencyKey);
    return id === undefined ? undefined : this.records.get(id);
  }

  /** All records, in enqueue order. */
  async all(): Promise<readonly OutboxRecord[]> {
    return [...this.records.values()];
  }

  // --- the dispatcher's write surface (the durable-store interface) --------

  /**
   * Claim a record for a dispatch attempt: `pending`/`in-flight` →
   * `in-flight`, `attempts` incremented. Also the crash-recovery claim for
   * records left `in-flight` by a dead worker. `nextAttemptAt` is left
   * untouched — the retry scheduler is the only writer of dispatch windows.
   */
  async beginAttempt(id: string): Promise<OutboxRecord> {
    return this.replace(id, "beginAttempt", (current) => {
      this.assertTransition(current, "beginAttempt", ["pending", "in-flight"]);
      return { ...current, status: "in-flight", attempts: current.attempts + 1 };
    });
  }

  /**
   * Release a failed attempt back to `pending`: `nextAttemptAt` is set to
   * `now + delayMs` (the dispatcher's deterministic backoff) and the typed
   * cause is recorded.
   */
  async scheduleRetry(
    id: string,
    cause: OutboxFailureCause,
    delayMs: number,
    now: number,
  ): Promise<OutboxRecord> {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new ActionSyncError(
        `delayMs: expected a finite non-negative number of milliseconds, got ${previewValue(delayMs)}`,
      );
    }
    return this.replace(id, "scheduleRetry", (current) => {
      this.assertTransition(current, "scheduleRetry", ["in-flight"]);
      return {
        ...current,
        status: "pending",
        nextAttemptAt: isoOf(now + delayMs),
        lastCause: cause,
      };
    });
  }

  /**
   * Settle a record as `delivered` (terminal). Requires a `confirmed`
   * receipt — the only honest evidence of external synchronization — and
   * stores it together with `deliveredAt`.
   */
  async markDelivered(id: string, receipt: ActionReceipt, now: number): Promise<OutboxRecord> {
    if (receipt.status !== "confirmed") {
      throw new OutboxStateError(
        `markDelivered requires a 'confirmed' receipt, got '${receipt.status}'`,
      );
    }
    return this.replace(id, "markDelivered", (current) => {
      this.assertTransition(current, "markDelivered", ["in-flight"]);
      return {
        ...current,
        status: "delivered",
        receipt: deepFreeze({ ...receipt }),
        deliveredAt: isoOf(now),
      };
    });
  }

  /**
   * Settle a record as `unsupported` (terminal): the source cannot perform
   * this action. Accepts a capability-gate cause, a typed connector error,
   * or a receipt whose own status is `unsupported` — never a fabricated one.
   * The settlement TIME is audited by the dispatcher's `SyncLog` entry, not
   * duplicated on the record.
   */
  async markUnsupported(id: string, cause: OutboxFailureCause): Promise<OutboxRecord> {
    if (cause.kind === "receipt" && cause.receipt.status !== "unsupported") {
      throw new OutboxStateError(
        `markUnsupported receipt cause must carry an 'unsupported' receipt, got '${cause.receipt.status}'`,
      );
    }
    return this.replace(id, "markUnsupported", (current) => {
      this.assertTransition(current, "markUnsupported", ["pending", "in-flight"]);
      return { ...current, status: "unsupported", lastCause: cause };
    });
  }

  /**
   * Settle a record as `conflict` (terminal): the source answered with a
   * state that is neither confirmation nor failure (a `local-only` receipt).
   * Resolution is caller policy — see reconcile.ts. The settlement time is
   * audited by the dispatcher's `SyncLog` entry.
   */
  async markConflict(id: string, cause: OutboxFailureCause): Promise<OutboxRecord> {
    if (cause.kind === "receipt" && cause.receipt.status !== "local-only") {
      throw new OutboxStateError(
        `markConflict receipt cause must carry a 'local-only' receipt, got '${cause.receipt.status}'`,
      );
    }
    return this.replace(id, "markConflict", (current) => {
      this.assertTransition(current, "markConflict", ["in-flight"]);
      return { ...current, status: "conflict", lastCause: cause };
    });
  }

  /**
   * Settle a record as `failed` (terminal): a non-retryable error, or
   * retries exhausted. The typed cause is stored — silence is not an
   * outcome. The settlement time is audited by the dispatcher's `SyncLog`
   * entry, not duplicated on the record.
   */
  async markFailed(id: string, cause: OutboxFailureCause): Promise<OutboxRecord> {
    return this.replace(id, "markFailed", (current) => {
      this.assertTransition(current, "markFailed", ["pending", "in-flight"]);
      return { ...current, status: "failed", lastCause: cause };
    });
  }

  // --- internals -------------------------------------------------------------

  private replace(
    id: string,
    operation: string,
    mutate: (current: OutboxRecord) => OutboxRecord,
  ): OutboxRecord {
    const current = this.records.get(id);
    if (current === undefined) {
      throw new OutboxStateError(`${operation}: unknown outbox record id '${id}'`);
    }
    const next = deepFreeze(mutate(current));
    this.records.set(id, next);
    return next;
  }

  private assertTransition(
    current: OutboxRecord,
    operation: string,
    allowed: readonly OutboxStatus[],
  ): void {
    if (!allowed.includes(current.status)) {
      throw new OutboxStateError(
        `${operation}: cannot transition a record in status '${current.status}' (allowed from: ${allowed.join(" | ")})`,
      );
    }
  }
}
