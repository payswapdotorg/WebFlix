/**
 * @wfx/persistence — the user library store (WFX-052; R02 profile scoping).
 *
 * The durable side of the frozen `LibraryEntry` contract for the user's
 * WebFlix-local library (migrations 0003 + 0007), now PROFILE-SCOPED: the
 * key is `(COALESCE(profile_id, 'user:' || user_id), connector_id,
 * external_ref)` — the effective-profile key migration 0007 indexes. This
 * is the "All social actions are first recorded locally" law's storage.
 *
 * The LEGACY API (userId-keyed `addWithin`/`removeWithin`/`list`/`has`)
 * resolves the user's effective profile key first — the default-profile
 * fallback (materializing the default profile for registered users on
 * first use; the legacy pseudo bucket otherwise) — so pre-R02 callers
 * keep bit-for-bit behavior while profile-aware callers pass `profileId`
 * explicitly (`addWithinForProfile`/`removeWithinForProfile`/
 * `listForProfile`/`hasForProfile`).
 *
 * The transactional-outbox wiring lives in the ConnectorPort adapter
 * (src/catalog-connector.ts): a library ADD commits together with its
 * `"save"` event in ONE transaction. This module is the raw store the
 * adapter (and the future service lane) composes.
 */

import type { LibraryEntry, LibraryCommand } from "@wfx/domain";

import { classifyDriverError } from "./classify";
import { epochMsToIso, toIsoTimestamp, type DbClient, type SqlClient } from "./sql";
import { PostgresProfileService, legacyProfileKey } from "./profiles";
import type { Clock, IdGen } from "@wfx/experience";

/** A library entry as persisted (the frozen shape, ISO timestamps). */
export type PersistedLibraryEntry = LibraryEntry;

interface LibrarySqlRow {
  user_id: string;
  profile_id: unknown | null;
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

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

/** Options: the client + the injected clock (added_at stamping) + the
 * optional id seam (profile materialization for registered users). */
export interface LibraryStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  /** R02: pass in any path that may resolve a REGISTERED user's profile. */
  readonly ids?: IdGen;
}

/**
 * The user library store. `addWithin` / `removeWithin` take the CALLER'S
 * transaction handle — the transactional-outbox seam; `add` / `remove` /
 * `list` are the standalone forms. R02: every operation keys on the
 * effective profile (passed explicitly, or resolved from the user id by
 * the legacy forms).
 */
export class PostgresLibraryStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly profiles: PostgresProfileService;

  constructor(options: LibraryStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.profiles = new PostgresProfileService({
      db: options.db,
      ...(options.ids !== undefined ? { ids: options.ids } : {}),
      clock: options.clock,
    });
  }

  /** Insert-or-replace one entry INSIDE a caller transaction (outbox seam). */
  async addWithin(
    tx: SqlClient,
    input: { userId: string; command: LibraryCommand; connectorId: string; profileId?: string },
  ): Promise<PersistedLibraryEntry> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await tx.query<LibrarySqlRow>(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (${EFFECTIVE_PROFILE}, connector_id, external_ref) DO UPDATE SET
           title = EXCLUDED.title,
           added_at = EXCLUDED.added_at,
           metadata = EXCLUDED.metadata,
           profile_id = EXCLUDED.profile_id
         RETURNING *`,
        [
          input.userId,
          input.profileId ?? null,
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
    input: { userId: string; connectorId: string; externalRef: string; profileId?: string },
  ): Promise<boolean> {
    try {
      const rows = await tx.query<{ external_ref: string }>(
        `DELETE FROM library_entries
         WHERE ${EFFECTIVE_PROFILE} = $1 AND connector_id = $2 AND external_ref = $3
         RETURNING external_ref`,
        [input.profileId ?? legacyProfileKey(input.userId), input.connectorId, input.externalRef],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.removeWithin");
    }
  }

  /** The user's library for `connectorId` (effective-profile resolved), deterministic (added_at, ref) order. */
  async list(
    userId: string,
    connectorId: string,
    limit = 200,
  ): Promise<readonly PersistedLibraryEntry[]> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.listForProfile(profileId, connectorId, limit);
  }

  /** R02: one PROFILE's library for `connectorId`, deterministic order. */
  async listForProfile(
    profileId: string,
    connectorId: string,
    limit = 200,
  ): Promise<readonly PersistedLibraryEntry[]> {
    try {
      const rows = await this.db.query<LibrarySqlRow>(
        `SELECT * FROM library_entries
         WHERE ${EFFECTIVE_PROFILE} = $1 AND connector_id = $2
         ORDER BY added_at, external_ref
         LIMIT $3`,
        [profileId, connectorId, limit],
      );
      return rows.map((row) => mapEntry(row, connectorId));
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.listForProfile");
    }
  }

  /** Does the user hold one entry? (existence check — effective profile). */
  async has(userId: string, connectorId: string, externalRef: string): Promise<boolean> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.hasForProfile(profileId, connectorId, externalRef);
  }

  /** R02: does one PROFILE hold one entry? */
  async hasForProfile(
    profileId: string,
    connectorId: string,
    externalRef: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db.query<{ external_ref: string }>(
        `SELECT external_ref FROM library_entries
         WHERE ${EFFECTIVE_PROFILE} = $1 AND connector_id = $2 AND external_ref = $3`,
        [profileId, connectorId, externalRef],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.hasForProfile");
    }
  }
}
