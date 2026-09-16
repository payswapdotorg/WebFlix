/**
 * @wfx/persistence — the transactional event outbox (WFX-052).
 *
 * Frozen architecture: "Jobs: transactional outbox + durable workers
 * initially." This is the durable half for DOMAIN EVENTS (frozen
 * `EntertainmentEvent` + `EventEnvelope`):
 *
 * - WRITE SIDE: `enqueueEvent(tx, envelope, nowMs)` inserts the envelope
 *   row INSIDE the caller's transaction. Every adapter that changes state
 *   and should announce it (e.g. `writeLibrary` add, `executeAction`
 *   save/like) calls this in the SAME `db.begin` block as the state change
 *   — the event and the state commit together or not at all. That is the
 *   atomicity the pattern exists for. `PostgresEventSink.emit` (the
 *   `EventSink` port) is the standalone single-statement form: one insert,
 *   one implicit transaction, still atomic.
 *
 * - RELAY SIDE: `drainEventOutbox(db, { deliver, now, … })` claims up to
 *   `limit` due pending rows with `FOR UPDATE SKIP LOCKED` (concurrent
 *   relays never double-claim within a claim), flips them to `in-flight`,
 *   invokes `deliver(envelope)` once each, and records the outcome:
 *   delivered, rescheduled with deterministic exponential backoff, or
 *   failed after `maxAttempts`.
 *
 * DELIVERY SEMANTICS: AT-LEAST-ONCE, honestly. A relay crash between the
 *   claim and the mark-delivered leaves rows `in-flight`; after the
 *   operator-configured staleness window, `requeueStaleInFlight` returns
 *   them to `pending` and they are delivered AGAIN. Consumers of drained
 *   envelopes MUST be idempotent (the envelope's canonical `wfxevt_` id is
 *   the natural dedupe key downstream). Exactly-once is not claimed and
 *   not faked.
 *
 * Event identity: the outbox row id IS the canonical event id. Envelope
 *   ids are minted by the composition root (injected `IdGen` — the same
 *   seam `@wfx/experience` uses), so tests are deterministic
 *   (SequentialIdGen) and production is unique (crypto ULID generator).
 */

import {
  EVENT_ID_PREFIX,
  SCHEMA_VERSION,
  type EventEnvelope,
  type EntertainmentEvent,
  validateEntertainmentEvent,
} from "@wfx/domain";

import type { Clock, EventSink, IdGen } from "@wfx/experience";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient, type SqlClient } from "./sql";

/** Outbox row statuses (closed set — CHECK constraint in migration 0006). */
export type EventOutboxStatus = "pending" | "in-flight" | "delivered" | "failed";

/** One outbox row as the relay sees it. */
export interface EventOutboxRow {
  readonly id: string;
  readonly userId: string;
  readonly itemId: string;
  readonly eventType: string;
  readonly envelope: EventEnvelope;
  /**
   * R02: the profile the event is attributed to at INGEST (the emitting
   * session's active profile). NULL = legacy/anonymous ingest — the relay
   * resolves the user's effective profile at delivery time.
   */
  readonly profileId: string | null;
  readonly status: EventOutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly createdAt: string;
  readonly claimedAt: string | null;
  readonly deliveredAt: string | null;
  readonly lastError: string | null;
}

/** Options for the event sink. */
export interface PostgresEventSinkOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/**
 * The `EventSink` port implementation: validate the frozen event, wrap it
 * in a canonical `EventEnvelope` (envelope minting belongs to the
 * composition root — the ports doc says so), and insert it into the outbox
 * as its own single-statement transaction.
 *
 * Throws (propagates to the use-case caller — a lost watch-state event is
 * never a silent success): `PersistenceError` kind "invalid-input" for a
 * malformed event; the classified driver family for SQL failures.
 */
export class PostgresEventSink implements EventSink {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: PostgresEventSinkOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
  }

  async emit(event: EntertainmentEvent): Promise<void> {
    const envelope = buildEnvelope(event, this.ids);
    await enqueueEvent(this.db, envelope, this.clock.now());
  }

  /**
   * R02: emit with PROFILE ATTRIBUTION — the outbox row records the
   * profile the event belongs to (the emitting session's active profile),
   * so the relay folds it into THAT profile's watch history instead of
   * the default-profile fallback. Additive: `emit` (the frozen `EventSink`
   * seam) keeps its exact semantics.
   */
  async emitForProfile(event: EntertainmentEvent, profileId: string): Promise<void> {
    const envelope = buildEnvelope(event, this.ids);
    await enqueueEvent(this.db, envelope, this.clock.now(), profileId);
  }
}

/**
 * Validate a frozen `EntertainmentEvent` and wrap it in a canonical
 * `EventEnvelope` with a fresh `wfxevt_` id from the injected `IdGen`.
 * Exported for adapters that build envelopes before opening a transaction.
 */
export function buildEnvelope(event: EntertainmentEvent, ids: IdGen): EventEnvelope {
  const validated = validateEntertainmentEvent(event);
  if (!validated.ok) {
    throw new PersistenceError(
      "invalid-input",
      `EntertainmentEvent failed validation: ${validated.errors.join("; ")}`,
      { operation: "buildEnvelope" },
    );
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: `${EVENT_ID_PREFIX}${ids.next()}` as EventEnvelope["eventId"],
    occurredAt: validated.value.occurredAt,
    event: validated.value,
  };
}

/**
 * Insert an envelope row into `event_outbox` USING THE CALLER'S
 * transaction handle — the transactional-outbox write side. Call this
 * inside the same `db.begin` block as the state change it describes.
 * `profileId` (R02, optional): the profile the event is attributed to.
 */
export async function enqueueEvent(
  tx: SqlClient,
  envelope: EventEnvelope,
  nowMs: number,
  profileId?: string,
): Promise<void> {
  const nowIso = epochMsToIso(nowMs);
  try {
    await tx.query(
      `INSERT INTO event_outbox
         (id, user_id, item_id, event_type, envelope, status, attempts, next_attempt_at, created_at, profile_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, $6, $6, $7)`,
      [
        envelope.eventId,
        envelope.event.userId,
        envelope.event.itemId,
        envelope.event.type,
        JSON.stringify(envelope),
        nowIso,
        profileId ?? null,
      ],
    );
  } catch (thrown) {
    throw classifyDriverError(thrown, "enqueueEvent");
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface OutboxSqlRow {
  id: string;
  user_id: string;
  item_id: string;
  event_type: string;
  envelope: unknown;
  profile_id: unknown | null;
  status: string;
  attempts: number;
  next_attempt_at: unknown;
  created_at: unknown;
  claimed_at: unknown | null;
  delivered_at: unknown | null;
  last_error: unknown | null;
}

function mapRow(row: OutboxSqlRow): EventOutboxRow {
  return {
    id: row.id,
    userId: row.user_id,
    itemId: row.item_id,
    eventType: row.event_type,
    envelope: row.envelope as EventEnvelope,
    profileId:
      row.profile_id === null || row.profile_id === undefined
        ? null
        : String(row.profile_id),
    status: row.status as EventOutboxStatus,
    attempts: Number(row.attempts),
    nextAttemptAt: toIsoTimestamp(row.next_attempt_at),
    createdAt: toIsoTimestamp(row.created_at),
    claimedAt: row.claimed_at === null ? null : toIsoTimestamp(row.claimed_at),
    deliveredAt: row.delivered_at === null ? null : toIsoTimestamp(row.delivered_at),
    lastError: row.last_error === null ? null : String(row.last_error),
  };
}

// ---------------------------------------------------------------------------
// The relay
// ---------------------------------------------------------------------------

/** The delivery context handed to a deliverer alongside the envelope. */
export interface OutboxDeliveryContext {
  /** R02: the row's ingest-time profile attribution (null = legacy/anonymous). */
  readonly profileId: string | null;
}

/**
 * Deliverer invoked once per claimed envelope. Implementations may ignore
 * the R02 delivery context (a one-parameter function remains assignable —
 * the additive law).
 */
export type OutboxDeliverer = (
  envelope: EventEnvelope,
  context: OutboxDeliveryContext,
) => Promise<void>;

/** Options for `drainEventOutbox`. */
export interface DrainEventOutboxOptions {
  /** Called once per claimed envelope (at-least-once). */
  readonly deliver: OutboxDeliverer;
  /** Max rows claimed per drain call (default 20). */
  readonly limit?: number;
  /** Terminal failure threshold (default 5 attempts). */
  readonly maxAttempts?: number;
  /** Backoff base in ms (default 1000 → 1s, 2s, 4s, 8s, 16s… capped 5min). */
  readonly backoffBaseMs?: number;
  /** Backoff cap in ms (default 300_000). */
  readonly backoffCapMs?: number;
  /** The injected clock — REQUIRED (no hidden Date.now). */
  readonly now: number;
}

/** What one drain call did. */
export interface DrainEventOutboxResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly rescheduled: number;
  readonly failed: number;
}

/**
 * Deterministic exponential backoff for the Nth attempt (N >= 1):
 * `base * 2^(N-1)`, capped. Pure — tests assert exact values.
 */
export function backoffForAttempt(attempt: number, options: DrainEventOutboxOptions): number {
  const base = options.backoffBaseMs ?? 1_000;
  const cap = options.backoffCapMs ?? 300_000;
  const raw = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(raw, cap);
}

/**
 * Claim due pending rows and deliver them. One drain call claims at most
 * `limit` rows, delivers each via `deliver`, and records outcomes. See the
 * module docs for the at-least-once contract.
 */
export async function drainEventOutbox(
  db: DbClient,
  options: DrainEventOutboxOptions,
): Promise<DrainEventOutboxResult> {
  const limit = options.limit ?? 20;
  const maxAttempts = options.maxAttempts ?? 5;
  const nowIso = epochMsToIso(options.now);

  let claimedRows: OutboxSqlRow[];
  try {
    claimedRows = await db.query<OutboxSqlRow>(
      `UPDATE event_outbox SET
         status = 'in-flight',
         attempts = attempts + 1,
         claimed_at = $1,
         next_attempt_at = $1
       WHERE id IN (
         SELECT id FROM event_outbox
         WHERE status = 'pending' AND next_attempt_at <= $1
         ORDER BY next_attempt_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, user_id, item_id, event_type, envelope, profile_id, status, attempts,
                 next_attempt_at, created_at, claimed_at, delivered_at, last_error`,
      [nowIso, limit],
    );
  } catch (thrown) {
    throw classifyDriverError(thrown, "drainEventOutbox.claim");
  }

  let delivered = 0;
  let rescheduled = 0;
  let failed = 0;

  for (const sqlRow of claimedRows) {
    const row = mapRow(sqlRow);
    try {
      await options.deliver(row.envelope, { profileId: row.profileId });
    } catch (thrown) {
      const detail = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
      if (row.attempts >= maxAttempts) {
        await markOutboxRow(db, row.id, "failed", {
          lastError: detail,
          now: nowIso,
        });
        failed += 1;
      } else {
        const retryAt = epochMsToIso(
          options.now + backoffForAttempt(row.attempts, options),
        );
        await markOutboxRow(db, row.id, "pending", {
          lastError: detail,
          nextAttemptAt: retryAt,
          now: nowIso,
        });
        rescheduled += 1;
      }
      continue;
    }
    await markOutboxRow(db, row.id, "delivered", { deliveredAt: nowIso, now: nowIso });
    delivered += 1;
  }

  return { claimed: claimedRows.length, delivered, rescheduled, failed };
}

/** Write a terminal or intermediate status onto one outbox row. */
async function markOutboxRow(
  db: DbClient,
  id: string,
  status: EventOutboxStatus,
  fields: {
    lastError?: string;
    nextAttemptAt?: string;
    deliveredAt?: string;
    now: string;
  },
): Promise<void> {
  try {
    await db.query(
      `UPDATE event_outbox SET
         status = $2,
         last_error = COALESCE($3, last_error),
         next_attempt_at = COALESCE($4, next_attempt_at),
         delivered_at = COALESCE($5, delivered_at),
         claimed_at = $6
       WHERE id = $1`,
      [id, status, fields.lastError ?? null, fields.nextAttemptAt ?? null, fields.deliveredAt ?? null, fields.now],
    );
  } catch (thrown) {
    throw classifyDriverError(thrown, "drainEventOutbox.mark");
  }
}

/**
 * Recovery for relay crashes: rows stuck `in-flight` since before the
 * staleness cutoff go back to `pending` (they will be delivered AGAIN —
 * at-least-once). Returns the number of requeued rows.
 */
export async function requeueStaleInFlight(
  db: DbClient,
  options: { readonly now: number; readonly olderThanMs: number },
): Promise<number> {
  const nowIso = epochMsToIso(options.now);
  const cutoffIso = epochMsToIso(options.now - options.olderThanMs);
  try {
    const rows = await db.query<{ id: string }>(
      `UPDATE event_outbox SET status = 'pending', next_attempt_at = $1
       WHERE status = 'in-flight' AND claimed_at <= $2
       RETURNING id`,
      [nowIso, cutoffIso],
    );
    return rows.length;
  } catch (thrown) {
    throw classifyDriverError(thrown, "requeueStaleInFlight");
  }
}

/** Read outbox rows for one user, newest first (diagnostics/verification). */
export async function listOutboxRowsForUser(
  db: DbClient,
  userId: string,
  limit = 50,
): Promise<readonly EventOutboxRow[]> {
  try {
    const rows = await db.query<OutboxSqlRow>(
      `SELECT id, user_id, item_id, event_type, envelope, profile_id, status, attempts,
              next_attempt_at, created_at, claimed_at, delivered_at, last_error
       FROM event_outbox
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows.map(mapRow);
  } catch (thrown) {
    throw classifyDriverError(thrown, "listOutboxRowsForUser");
  }
}
