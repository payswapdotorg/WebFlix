/**
 * @wfx/persistence — the durable action outbox (R15).
 *
 * The SQL-backed implementation of `@wfx/actions`' `ActionOutboxStore`
 * contract — the SAME state machine the in-memory `ActionOutbox` enforces
 * (enqueue/due/beginAttempt/scheduleRetry/markDelivered/markUnsupported/
 * markConflict/markFailed), over migration 0011's `action_outbox` table:
 *
 * - LOCAL-FIRST RECORDING: `enqueue` is ONE transaction — the outbox row
 *   AND its `action_audit` row commit together or not at all (torn-write
 *   tolerance by construction: a durable outbox row never exists without
 *   its audit row). The audit row is the local event record that exists
 *   BEFORE any sync attempt; the dispatcher runs only after this
 *   transaction resolves (ordering test-enforced — see
 *   tests/action-outbox.test.ts).
 * - IDEMPOTENCY: `id` is the deterministic `wfxout_<key>` digest and
 *   `idempotency_key` is UNIQUE — INSERT … ON CONFLICT DO NOTHING plus a
 *   read-back answers the typed duplicate/conflict distinction with the
 *   SAME difference strings as the in-memory store (the shared
 *   `outboxContentDifferences` helper); the stored record is never
 *   modified, never duplicated.
 * - CRASH-SAFE CLAIM: `beginAttempt` is one guarded UPDATE
 *   (`status = 'pending'` OR stale `in-flight`), stamping `claimed_at` —
 *   a live worker's claim is never stolen, a crashed worker's is
 *   reclaimable after the staleness window (at-least-once, the documented
 *   delivery semantic; the provider-side dedupe key is the record's
 *   idempotency key). `due(now)` selects due pending rows plus stale
 *   in-flight rows only.
 * - HONEST STATES: `delivered` requires the provider's `confirmed`
 *   receipt (the migration's CHECK constraint enforces it at rest too);
 *   terminal statuses are guarded by the same closed transition graph —
 *   a guarded UPDATE that affects zero rows reads the current row back
 *   and throws the typed `OutboxStateError` (the dispatcher catches that
 *   one race and audits it as superseded).
 *
 * Error channels: caller misuse (malformed entry, malformed options)
 * throws the CONTRACT's typed `ActionSyncError` (the same channel the
 * in-memory store uses); SQL failures classify through `classifyDriverError`
 * into the 052 typed taxonomy (the degradation family propagates for the
 * route layer to map per its degradation law).
 */

import {
  ActionSyncError,
  OutboxStateError,
  idempotencyKeyFor,
  assertValidOutboxEntry,
  outboxContentDifferences,
  type ActionOutboxStore,
  type EnqueueResult,
  type OutboxEntry,
  type OutboxFailureCause,
  type OutboxRecord,
  type OutboxStatus,
} from "@wfx/actions";
import type { ActionReceipt, UserAction } from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient, type SqlClient } from "./sql";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Constructor options for {@link PostgresActionOutbox}. */
export interface PostgresActionOutboxOptions {
  readonly db: DbClient;
  /** Stamps `enqueued_at`, the initial `next_attempt_at`, and `claimed_at`. */
  readonly clock: Clock;
  /** Mints the `action_audit` row ids (`wfxacta_` + ULID body). */
  readonly ids: IdGen;
  /** Max rows one `due()` claim query returns (default 20 — bounded ticks). */
  readonly dueLimit?: number;
  /** Max rows `all()` returns, in enqueue order (default 500 — bounded reconcile). */
  readonly allLimit?: number;
  /**
   * How long an `in-flight` claim may age before a crashed worker's record
   * becomes reclaimable (default 10 minutes — the event-outbox relay's
   * staleness window).
   */
  readonly staleInFlightMs?: number;
}

/** The audit-id prefix (this module's canonical identity scheme). */
export const ACTION_AUDIT_ID_PREFIX = "wfxacta_";

/** One `action_audit` row (the local-first event record). */
export interface ActionAuditRow {
  readonly id: string;
  readonly userId: string;
  readonly profileId: string | null;
  readonly connectorId: string;
  readonly actionType: UserAction["type"];
  readonly externalRef: string;
  readonly clientRequestToken: string;
  readonly outboxRecordId: string;
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface OutboxSqlRow {
  id: string;
  idempotency_key: string;
  user_id: string;
  profile_id: unknown | null;
  connector_id: string;
  action_type: string;
  external_ref: string;
  client_request_token: string;
  payload: unknown;
  locale: string;
  region: unknown | null;
  status: string;
  attempts: number;
  next_attempt_at: unknown;
  enqueued_at: unknown;
  claimed_at: unknown | null;
  delivered_at: unknown | null;
  receipt: unknown;
  last_cause: unknown;
}

/** The closed failure-cause kinds (the read-side shape check). */
const CAUSE_KINDS: ReadonlySet<string> = new Set([
  "unsupported-capability",
  "connector-error",
  "receipt",
  "driver",
  "exhausted",
  "wiring",
]);

/**
 * Read a stored `last_cause` JSON value back as the typed
 * `OutboxFailureCause`. Rows are written by this store; a value that fails
 * the shape check (database corruption) is surfaced honestly as a typed
 * `driver` cause naming the corruption — never fabricated as success.
 */
function readCause(value: unknown): OutboxFailureCause | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || !CAUSE_KINDS.has(String((value as { kind?: unknown }).kind))) {
    return {
      kind: "driver",
      detail: `stored cause failed validation: ${JSON.stringify(value)}`,
    };
  }
  return value as OutboxFailureCause;
}

/** Map one SQL row to the frozen `OutboxRecord` snapshot. */
function mapRow(row: OutboxSqlRow): OutboxRecord {
  const action: UserAction = {
    type: row.action_type as UserAction["type"],
    connectorId: row.connector_id,
    externalRef: row.external_ref,
    ...(row.payload !== null && row.payload !== undefined
      ? { payload: row.payload as Record<string, unknown> }
      : {}),
  };
  const record: OutboxRecord = {
    id: row.id,
    idempotencyKey: row.idempotency_key as OutboxRecord["idempotencyKey"],
    userId: row.user_id,
    connectorId: row.connector_id,
    action,
    clientRequestToken: row.client_request_token,
    locale: row.locale,
    ...(row.region !== null && row.region !== undefined ? { region: String(row.region) } : {}),
    ...(row.profile_id !== null && row.profile_id !== undefined
      ? { profileId: String(row.profile_id) }
      : {}),
    status: row.status as OutboxStatus,
    attempts: Number(row.attempts),
    nextAttemptAt: toIsoTimestamp(row.next_attempt_at),
    enqueuedAt: toIsoTimestamp(row.enqueued_at),
    ...(() => {
      const cause = readCause(row.last_cause);
      return cause !== undefined ? { lastCause: cause } : {};
    })(),
    ...(row.receipt !== null && row.receipt !== undefined
      ? { receipt: row.receipt as ActionReceipt }
      : {}),
    ...(row.delivered_at !== null && row.delivered_at !== undefined
      ? { deliveredAt: toIsoTimestamp(row.delivered_at) }
      : {}),
  };
  return record;
}

const OUTBOX_COLUMNS =
  "id, idempotency_key, user_id, profile_id, connector_id, action_type, external_ref, " +
  "client_request_token, payload, locale, region, status, attempts, next_attempt_at, " +
  "enqueued_at, claimed_at, delivered_at, receipt, last_cause";

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * The durable action outbox: one SQL implementation of the
 * `@wfx/actions` store contract (see the module docs for the durability
 * laws). Created once per service boot; every method is one statement or
 * one transaction against the `DbClient` seam (PGlite in tests, postgres.js
 * in production — the same SQL both sides).
 */
export class PostgresActionOutbox implements ActionOutboxStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;
  private readonly dueLimit: number;
  private readonly allLimit: number;
  private readonly staleInFlightMs: number;

  constructor(options: PostgresActionOutboxOptions) {
    if (options === null || typeof options !== "object") {
      throw new PersistenceError("invalid-input", "options: expected a PostgresActionOutboxOptions object", {
        operation: "PostgresActionOutbox",
      });
    }
    const problems: string[] = [];
    if (options.db === null || typeof options.db !== "object") {
      problems.push("options.db: expected a DbClient");
    }
    if (options.clock === null || typeof options.clock?.now !== "function") {
      problems.push("options.clock: expected a Clock (now(): number)");
    }
    if (options.ids === null || typeof options.ids?.next !== "function") {
      problems.push("options.ids: expected an IdGen (next(): string)");
    }
    if (options.dueLimit !== undefined && (!Number.isInteger(options.dueLimit) || options.dueLimit < 1)) {
      problems.push("options.dueLimit: expected an integer >= 1 when present");
    }
    if (options.allLimit !== undefined && (!Number.isInteger(options.allLimit) || options.allLimit < 1)) {
      problems.push("options.allLimit: expected an integer >= 1 when present");
    }
    if (
      options.staleInFlightMs !== undefined &&
      (!Number.isFinite(options.staleInFlightMs) || options.staleInFlightMs < 0)
    ) {
      problems.push("options.staleInFlightMs: expected a finite non-negative number when present");
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "PostgresActionOutbox",
      });
    }
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
    this.dueLimit = options.dueLimit ?? 20;
    this.allLimit = options.allLimit ?? 500;
    this.staleInFlightMs = options.staleInFlightMs ?? 10 * 60_000;
  }

  // --- the transaction boundary (the local-first recording law) -------------

  /**
   * Record one user action: ONE transaction inserts the outbox row AND its
   * `action_audit` row (both, or neither). A re-enqueue of the SAME identity
   * answers the typed `duplicate` (identical content) or `conflict`
   * (different content, differences listed) WITHOUT writing anything.
   */
  async enqueue(entry: OutboxEntry): Promise<EnqueueResult> {
    assertValidOutboxEntry(entry);
    const key = idempotencyKeyFor(entry);
    const id = `wfxout_${key}`;
    const nowIso = epochMsToIso(this.clock.now());

    try {
      return await this.db.begin(async (tx: SqlClient): Promise<EnqueueResult> => {
        const inserted = await tx.query<OutboxSqlRow>(
          `INSERT INTO action_outbox
             (id, idempotency_key, user_id, profile_id, connector_id, action_type, external_ref,
              client_request_token, payload, locale, region, status, attempts, next_attempt_at,
              enqueued_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, 'pending', 0, $12, $12)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING ${OUTBOX_COLUMNS}`,
          [
            id,
            key,
            entry.userId,
            entry.profileId ?? null,
            entry.connectorId,
            entry.action,
            entry.externalRef,
            entry.clientRequestToken,
            entry.payload === undefined ? null : JSON.stringify(entry.payload),
            entry.locale,
            entry.region ?? null,
            nowIso,
          ],
        );
        if (inserted.length > 0) {
          // The local event record — the SAME transaction as the outbox row.
          // Written BEFORE any sync attempt can observe the record.
          await tx.query(
            `INSERT INTO action_audit
               (id, user_id, profile_id, connector_id, action_type, external_ref,
                client_request_token, outbox_record_id, recorded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              `${ACTION_AUDIT_ID_PREFIX}${this.ids.next()}`,
              entry.userId,
              entry.profileId ?? null,
              entry.connectorId,
              entry.action,
              entry.externalRef,
              entry.clientRequestToken,
              id,
              nowIso,
            ],
          );
          return { outcome: "enqueued", record: mapRow(inserted[0]!) };
        }

        // The identity already exists: answer the typed distinction, write nothing.
        const existing = await tx.query<OutboxSqlRow>(
          `SELECT ${OUTBOX_COLUMNS} FROM action_outbox WHERE idempotency_key = $1`,
          [key],
        );
        const row = existing[0];
        if (row === undefined) {
          // Unreachable: the conflict proves the row exists (same transaction).
          throw new OutboxStateError(`idempotency key maps to unknown record id '${id}'`);
        }
        const record = mapRow(row);
        const differences = outboxContentDifferences(record, entry);
        if (differences.length === 0) {
          return { outcome: "duplicate", record };
        }
        return { outcome: "conflict", record, differences };
      });
    } catch (thrown) {
      if (thrown instanceof OutboxStateError || thrown instanceof ActionSyncError) throw thrown;
      throw classifyDriverError(thrown, "actionOutbox.enqueue");
    }
  }

  // --- the claim query --------------------------------------------------------

  /** Due rows: past-due pending, plus stale in-flight (crash recovery). */
  async due(now: number): Promise<readonly OutboxRecord[]> {
    if (!Number.isFinite(now)) {
      throw new ActionSyncError(`now: expected a finite epoch-milliseconds number, got ${String(now)}`);
    }
    const nowIso = epochMsToIso(now);
    const staleIso = epochMsToIso(now - this.staleInFlightMs);
    try {
      const rows = await this.db.query<OutboxSqlRow>(
        `SELECT ${OUTBOX_COLUMNS} FROM action_outbox
          WHERE (status = 'pending' AND next_attempt_at <= $1)
             OR (status = 'in-flight' AND claimed_at <= $2)
          ORDER BY next_attempt_at, id
          LIMIT $3`,
        [nowIso, staleIso, this.dueLimit],
      );
      return rows.map(mapRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionOutbox.due");
    }
  }

  async get(id: string): Promise<OutboxRecord | undefined> {
    try {
      const rows = await this.db.query<OutboxSqlRow>(
        `SELECT ${OUTBOX_COLUMNS} FROM action_outbox WHERE id = $1`,
        [id],
      );
      return rows[0] === undefined ? undefined : mapRow(rows[0]);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionOutbox.get");
    }
  }

  async getByIdempotencyKey(key: string): Promise<OutboxRecord | undefined> {
    try {
      const rows = await this.db.query<OutboxSqlRow>(
        `SELECT ${OUTBOX_COLUMNS} FROM action_outbox WHERE idempotency_key = $1`,
        [key],
      );
      return rows[0] === undefined ? undefined : mapRow(rows[0]);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionOutbox.getByIdempotencyKey");
    }
  }

  async all(): Promise<readonly OutboxRecord[]> {
    try {
      const rows = await this.db.query<OutboxSqlRow>(
        `SELECT ${OUTBOX_COLUMNS} FROM action_outbox ORDER BY enqueued_at, id LIMIT $1`,
        [this.allLimit],
      );
      return rows.map(mapRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionOutbox.all");
    }
  }

  // --- the dispatcher's write surface (guarded, atomic) -----------------------

  async beginAttempt(id: string): Promise<OutboxRecord> {
    const nowIso = epochMsToIso(this.clock.now());
    const staleIso = epochMsToIso(this.clock.now() - this.staleInFlightMs);
    return this.transition(id, "beginAttempt", ["pending", "in-flight"], {
      set: [
        { fragment: "status = 'in-flight'" },
        { fragment: "attempts = attempts + 1" },
        { fragment: "claimed_at = ?", param: nowIso },
      ],
      // A LIVE worker's claim is never stolen: only a stale in-flight claim
      // is reclaimable (crash recovery).
      extraGuard: {
        fragment: "(status = 'pending' OR (status = 'in-flight' AND claimed_at <= ?))",
        params: [staleIso],
      },
    });
  }

  async scheduleRetry(
    id: string,
    cause: OutboxFailureCause,
    delayMs: number,
    now: number,
  ): Promise<OutboxRecord> {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new ActionSyncError(
        `delayMs: expected a finite non-negative number of milliseconds, got ${String(delayMs)}`,
      );
    }
    return this.transition(id, "scheduleRetry", ["in-flight"], {
      set: [
        { fragment: "status = 'pending'" },
        { fragment: "next_attempt_at = ?", param: epochMsToIso(now + delayMs) },
        { fragment: "last_cause = ?::jsonb", param: JSON.stringify(cause) },
      ],
    });
  }

  async markDelivered(id: string, receipt: ActionReceipt, now: number): Promise<OutboxRecord> {
    if (receipt.status !== "confirmed") {
      throw new OutboxStateError(
        `markDelivered requires a 'confirmed' receipt, got '${receipt.status}'`,
      );
    }
    return this.transition(id, "markDelivered", ["in-flight"], {
      set: [
        { fragment: "status = 'delivered'" },
        { fragment: "receipt = ?::jsonb", param: JSON.stringify(receipt) },
        { fragment: "delivered_at = ?", param: epochMsToIso(now) },
      ],
    });
  }

  async markUnsupported(id: string, cause: OutboxFailureCause): Promise<OutboxRecord> {
    if (cause.kind === "receipt" && cause.receipt.status !== "unsupported") {
      throw new OutboxStateError(
        `markUnsupported receipt cause must carry an 'unsupported' receipt, got '${cause.receipt.status}'`,
      );
    }
    return this.transition(id, "markUnsupported", ["pending", "in-flight"], {
      set: [
        { fragment: "status = 'unsupported'" },
        { fragment: "last_cause = ?::jsonb", param: JSON.stringify(cause) },
      ],
    });
  }

  async markConflict(id: string, cause: OutboxFailureCause): Promise<OutboxRecord> {
    if (cause.kind === "receipt" && cause.receipt.status !== "local-only") {
      throw new OutboxStateError(
        `markConflict receipt cause must carry a 'local-only' receipt, got '${cause.receipt.status}'`,
      );
    }
    return this.transition(id, "markConflict", ["in-flight"], {
      set: [
        { fragment: "status = 'conflict'" },
        { fragment: "last_cause = ?::jsonb", param: JSON.stringify(cause) },
      ],
    });
  }

  async markFailed(id: string, cause: OutboxFailureCause): Promise<OutboxRecord> {
    return this.transition(id, "markFailed", ["pending", "in-flight"], {
      set: [
        { fragment: "status = 'failed'" },
        { fragment: "last_cause = ?::jsonb", param: JSON.stringify(cause) },
      ],
    });
  }

  // --- the audit read side -----------------------------------------------------

  /** The user's local action-audit rows, newest first (the local-first record). */
  async auditForUser(userId: string, limit = 50): Promise<readonly ActionAuditRow[]> {
    try {
      const rows = await this.db.query<{
        id: string;
        user_id: string;
        profile_id: unknown | null;
        connector_id: string;
        action_type: string;
        external_ref: string;
        client_request_token: string;
        outbox_record_id: string;
        recorded_at: unknown;
      }>(
        `SELECT id, user_id, profile_id, connector_id, action_type, external_ref,
                client_request_token, outbox_record_id, recorded_at
         FROM action_audit WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT $2`,
        [userId, limit],
      );
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        profileId: row.profile_id === null ? null : String(row.profile_id),
        connectorId: row.connector_id,
        actionType: row.action_type as ActionAuditRow["actionType"],
        externalRef: row.external_ref,
        clientRequestToken: row.client_request_token,
        outboxRecordId: row.outbox_record_id,
        recordedAt: toIsoTimestamp(row.recorded_at),
      }));
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionOutbox.auditForUser");
    }
  }

  /**
   * The user's outbox rows with the honest sync states, newest first (the
   * J10 readback surface). Profile-scoped: session records under the active
   * profile, anonymous records under NULL attribution — plus optional
   * connector/action/ref filters.
   */
  async syncStatesForUser(
    userId: string,
    options: {
      readonly profileId?: string | null;
      readonly connectorId?: string;
      readonly actionType?: UserAction["type"];
      readonly externalRef?: string;
      readonly limit?: number;
    } = {},
  ): Promise<readonly OutboxRecord[]> {
    const limit = options.limit ?? 25;
    const filters: string[] = ["user_id = $1"];
    const params: unknown[] = [userId];
    if (options.profileId !== undefined) {
      params.push(options.profileId);
      filters.push(`profile_id ${options.profileId === null ? "IS NULL" : `= $${params.length}`}`);
    }
    if (options.connectorId !== undefined) {
      params.push(options.connectorId);
      filters.push(`connector_id = $${params.length}`);
    }
    if (options.actionType !== undefined) {
      params.push(options.actionType);
      filters.push(`action_type = $${params.length}`);
    }
    if (options.externalRef !== undefined) {
      params.push(options.externalRef);
      filters.push(`external_ref = $${params.length}`);
    }
    params.push(limit);
    try {
      const rows = await this.db.query<OutboxSqlRow>(
        `SELECT ${OUTBOX_COLUMNS} FROM action_outbox WHERE ${filters.join(" AND ")}
          ORDER BY enqueued_at DESC, id DESC LIMIT $${params.length}`,
        params,
      );
      return rows.map(mapRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionOutbox.syncStatesForUser");
    }
  }

  // --- internals -----------------------------------------------------------

  /** One `?`-placeholder SET fragment (the placeholder is assigned in order). */
  private static buildSetFragments(
    entries: readonly TransitionSetEntry[],
    params: unknown[],
  ): string {
    return entries
      .map((entry) => {
        if (entry.param === undefined) return entry.fragment;
        params.push(entry.param);
        return entry.fragment.replace("?", `$${params.length}`);
      })
      .join(", ");
  }

  /**
   * One guarded transition: `UPDATE … WHERE id AND status IN (allowed)`
   * RETURNING the updated row. Zero rows ⇒ the record was superseded by a
   * concurrent worker (or is unknown) — read the current row back and throw
   * the typed `OutboxStateError` with the same message shape the in-memory
   * store produces; the dispatcher catches this one race and audits it.
   */
  private async transition(
    id: string,
    operation: string,
    allowed: readonly OutboxStatus[],
    fields: {
      readonly set: readonly TransitionSetEntry[];
      readonly extraGuard?: { readonly fragment: string; readonly params: readonly unknown[] };
    },
  ): Promise<OutboxRecord> {
    const params: unknown[] = [id];
    const setSql = PostgresActionOutbox.buildSetFragments(fields.set, params);
    const statusPlaceholders = allowed
      .map((status) => {
        params.push(status);
        return `$${params.length}`;
      })
      .join(", ");
    let guardSql = `status IN (${statusPlaceholders})`;
    if (fields.extraGuard !== undefined) {
      const guardFragments = fields.extraGuard.fragment.split("?");
      guardSql += ` AND ${guardFragments
        .map((part, index) => {
          if (index === guardFragments.length - 1) return part;
          const param = fields.extraGuard!.params[index];
          if (param === undefined) throw new Error("transition guard placeholder mismatch");
          params.push(param);
          return `${part}$${params.length}`;
        })
        .join("")}`;
    }
    try {
      const rows = await this.db.query<OutboxSqlRow>(
        `UPDATE action_outbox SET ${setSql} WHERE id = $1 AND ${guardSql}
         RETURNING ${OUTBOX_COLUMNS}`,
        params,
      );
      if (rows.length > 0) return mapRow(rows[0]!);
      // Zero rows: read the current state for the honest typed error.
      const current = await this.get(id);
      if (current === undefined) {
        throw new OutboxStateError(`${operation}: unknown outbox record id '${id}'`);
      }
      if (fields.extraGuard !== undefined && allowed.includes(current.status)) {
        // The status was allowed but the claim guard rejected it: a LIVE
        // worker owns this record's claim (not stale yet).
        throw new OutboxStateError(
          `${operation}: record '${id}' is 'in-flight' with a live claim (not stale yet) — a concurrent worker owns it`,
        );
      }
      throw new OutboxStateError(
        `${operation}: cannot transition a record in status '${current.status}' (allowed from: ${allowed.join(" | ")})`,
      );
    } catch (thrown) {
      if (thrown instanceof OutboxStateError || thrown instanceof ActionSyncError) throw thrown;
      throw classifyDriverError(thrown, `actionOutbox.${operation}`);
    }
  }
}

/** One SET fragment: a literal (no `param`) or one `?` placeholder. */
interface TransitionSetEntry {
  readonly fragment: string;
  readonly param?: unknown;
}
