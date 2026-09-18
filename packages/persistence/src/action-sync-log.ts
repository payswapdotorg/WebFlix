/**
 * @wfx/persistence — the persisted action sync log (R15).
 *
 * The SQL-backed implementation of `@wfx/actions`' `SyncAuditLog` contract:
 * every dispatcher transition is appended as one `action_sync_log` row
 * (migration 0011) — the durable audit trail behind the in-memory `SyncLog`.
 * The dispatcher treats both identically (the one-interface law); the
 * durable implementation exists so the audit trail SURVIVES the process.
 *
 * Honesty laws: `cause` strings come from the closed describe*
 * vocabularies (`describeSyncCause` / `describeConnectorError`) — never
 * credentials, never tokens, never secrets (the privacy law); entries are
 * returned in append order (`seq`); nothing is ever mutated or deleted.
 */

import type { SyncAuditLog, SyncLogEntry } from "@wfx/actions";

import { classifyDriverError } from "./classify";
import { toIsoTimestamp, type DbClient } from "./sql";

/** Constructor options for {@link PostgresSyncLog}. */
export interface PostgresSyncLogOptions {
  readonly db: DbClient;
  /** Max rows `entries()` returns (default 500, append order — bounded reads). */
  readonly limit?: number;
}

interface LogSqlRow {
  seq: string | number;
  recorded_at: unknown;
  record_id: string;
  idempotency_key: string;
  from_status: string;
  to_status: string;
  attempt: number;
  cause: string;
}

function mapLogRow(row: LogSqlRow): SyncLogEntry {
  return {
    timestamp: toIsoTimestamp(row.recorded_at),
    recordId: row.record_id,
    idempotencyKey: row.idempotency_key,
    from: row.from_status as SyncLogEntry["from"],
    to: row.to_status as SyncLogEntry["to"],
    attempt: Number(row.attempt),
    cause: row.cause,
  };
}

/**
 * The persisted sync audit log. Stateless over the `DbClient` seam — every
 * method is one statement; safe to construct per composition.
 */
export class PostgresSyncLog implements SyncAuditLog {
  private readonly db: DbClient;
  private readonly limit: number;

  constructor(options: PostgresSyncLogOptions) {
    if (options === null || typeof options !== "object" || options.db === null || typeof options.db !== "object") {
      throw new Error("PostgresSyncLog: options.db must be a DbClient");
    }
    this.db = options.db;
    this.limit = options.limit ?? 500;
  }

  /** Append one audited transition (persisted; never mutated). */
  async append(entry: SyncLogEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO action_sync_log
           (recorded_at, record_id, idempotency_key, from_status, to_status, attempt, cause)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.timestamp,
          entry.recordId,
          entry.idempotencyKey,
          entry.from,
          entry.to,
          entry.attempt,
          entry.cause,
        ],
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionSyncLog.append");
    }
  }

  /** Entries in append order, bounded by the configured limit. */
  async entries(): Promise<readonly SyncLogEntry[]> {
    try {
      const rows = await this.db.query<LogSqlRow>(
        `SELECT seq, recorded_at, record_id, idempotency_key, from_status, to_status, attempt, cause
         FROM action_sync_log ORDER BY seq LIMIT $1`,
        [this.limit],
      );
      return rows.map(mapLogRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionSyncLog.entries");
    }
  }

  /** One record's entries, in append order. */
  async forRecord(recordId: string): Promise<readonly SyncLogEntry[]> {
    try {
      const rows = await this.db.query<LogSqlRow>(
        `SELECT seq, recorded_at, record_id, idempotency_key, from_status, to_status, attempt, cause
         FROM action_sync_log WHERE record_id = $1 ORDER BY seq`,
        [recordId],
      );
      return rows.map(mapLogRow);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionSyncLog.forRecord");
    }
  }

  /** Total number of persisted entries. */
  async size(): Promise<number> {
    try {
      const rows = await this.db.query<{ count: string | number }>(
        `SELECT count(*) AS count FROM action_sync_log`,
      );
      return Number(rows[0]?.count ?? 0);
    } catch (thrown) {
      throw classifyDriverError(thrown, "actionSyncLog.size");
    }
  }
}
