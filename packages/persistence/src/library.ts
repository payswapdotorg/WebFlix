/**
 * @wfx/persistence — the user library store (WFX-052).
 *
 * The durable side of the frozen `LibraryEntry` contract for a user's
 * WebFlix-local library (migration 0003): keyed by
 * (user_id, connector_id, external_ref). This is the "All social actions
 * are first recorded locally" law's storage.
 *
 * The transactional-outbox wiring lives in the ConnectorPort adapter
 * (src/catalog-connector.ts): a library ADD commits together with its
 * `"save"` event in ONE transaction. This module is the raw store the
 * adapter (and the future service lane) composes.
 */

import type { LibraryEntry, LibraryCommand } from "@wfx/domain";

import { classifyDriverError } from "./classify";
import { epochMsToIso, toIsoTimestamp, type DbClient, type SqlClient } from "./sql";
import type { Clock } from "@wfx/experience";

/** A library entry as persisted (the frozen shape, ISO timestamps). */
export type PersistedLibraryEntry = LibraryEntry;

interface LibrarySqlRow {
  user_id: string;
  connector_id: string;
  external_ref: string;
  title: string;
  added_at: unknown;
  metadata: unknown;
}

function mapEntry(row: LibrarySqlRow, connectorId: string): PersistedLibraryEntry {
  const entry: LibraryEntry = {
    connectorId,
    externalRef: row.external_ref,
    title: row.title,
    addedAt: toIsoTimestamp(row.added_at),
  };
  const metadata = row.metadata ?? undefined;
  if (metadata !== undefined) entry.metadata = metadata as Record<string, unknown>;
  return entry;
}

/** Options: the client + the injected clock (added_at stamping). */
export interface LibraryStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
}

/**
 * The user library store. `addWithin` / `removeWithin` take the CALLER'S
 * transaction handle — the transactional-outbox seam; `add` / `remove` /
 * `list` are the standalone forms.
 */
export class PostgresLibraryStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(options: LibraryStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  /** Insert-or-replace one entry INSIDE a caller transaction (outbox seam). */
  async addWithin(
    tx: SqlClient,
    input: { userId: string; command: LibraryCommand; connectorId: string },
  ): Promise<PersistedLibraryEntry> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await tx.query<LibrarySqlRow>(
        `INSERT INTO library_entries (user_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (user_id, connector_id, external_ref) DO UPDATE SET
           title = EXCLUDED.title,
           added_at = EXCLUDED.added_at,
           metadata = EXCLUDED.metadata
         RETURNING *`,
        [
          input.userId,
          input.connectorId,
          input.command.externalRef,
          input.command.title ?? input.command.externalRef,
          nowIso,
          input.command.metadata === undefined ? null : JSON.stringify(input.command.metadata),
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("addWithin: no row returned");
      return mapEntry(row, input.connectorId);
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.addWithin");
    }
  }

  /** Remove one entry INSIDE a caller transaction. Returns true when a row was removed. */
  async removeWithin(
    tx: SqlClient,
    input: { userId: string; connectorId: string; externalRef: string },
  ): Promise<boolean> {
    try {
      const rows = await tx.query<{ external_ref: string }>(
        `DELETE FROM library_entries
         WHERE user_id = $1 AND connector_id = $2 AND external_ref = $3
         RETURNING external_ref`,
        [input.userId, input.connectorId, input.externalRef],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.removeWithin");
    }
  }

  /** The user's library for `connectorId`, deterministic (added_at, ref) order. */
  async list(
    userId: string,
    connectorId: string,
    limit = 200,
  ): Promise<readonly PersistedLibraryEntry[]> {
    try {
      const rows = await this.db.query<LibrarySqlRow>(
        `SELECT * FROM library_entries
         WHERE user_id = $1 AND connector_id = $2
         ORDER BY added_at, external_ref
         LIMIT $3`,
        [userId, connectorId, limit],
      );
      return rows.map((row) => mapEntry(row, connectorId));
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.list");
    }
  }

  /** Does the user hold one entry? (existence check, not a read) */
  async has(userId: string, connectorId: string, externalRef: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ external_ref: string }>(
        `SELECT external_ref FROM library_entries
         WHERE user_id = $1 AND connector_id = $2 AND external_ref = $3`,
        [userId, connectorId, externalRef],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.has");
    }
  }
}
