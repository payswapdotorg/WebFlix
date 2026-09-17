/**
 * @wfx/persistence — history removals + exclusions (R04, the event-sink law).
 *
 * THE EVENT-SINK LAW (R04 spec §2): the recorded events are the immutable
 * truth; the history read model is their PROJECTION. Removal and exclusion
 * NEVER falsify recorded events — they are projection-side filters. The
 * event_outbox is NEVER touched by this module.
 *
 * Two durable projections (one row per (effective profile, canonical item)):
 *
 * - `history_removals`: the user explicitly removed an item from their
 *   history (`DELETE /experience/history/:itemId`). The history READ MODEL
 *   (watch_history projection + Continue Watching) filters these out; a
 *   re-watch — a new watch-state event arriving through the relay's fold —
 *   DELETES the removal row (the item re-materializes in history).
 *
 * - `history_exclusions`: the user excluded an item from history-derived
 *   surfaces (`POST /experience/history/exclusions`) — Continue Watching,
 *   recommendations' already-watched signals. These stay excluded until
 *   the user explicitly removes the exclusion
 *   (`DELETE /experience/history/exclusions/:itemId`). A re-watch does NOT
 *   clear an exclusion (the user's explicit choice persists).
 *
 * Profile scoping mirrors migration 0007's effective-profile key:
 * `(COALESCE(profile_id, 'user:' || user_id), item_id)`.
 *
 * Determinism: clock + ids are injected seams; no Date.now, no crypto.
 */

import { classifyDriverError } from "./classify";
import { epochMsToIso, type DbClient, type SqlClient } from "./sql";
import type { Clock } from "@wfx/experience";

/** The migration-0007 effective-profile key expression (single source). */
const EFFECTIVE_PROFILE = `COALESCE(profile_id, 'user:' || user_id)`;

/** One row of the history_removals projection. */
export interface HistoryRemovalRow {
  readonly profileId: string | null;
  readonly userId: string;
  readonly itemId: string;
  readonly removedAt: string;
}

/** One row of the history_exclusions projection. */
export interface HistoryExclusionRow {
  readonly profileId: string | null;
  readonly userId: string;
  readonly itemId: string;
  readonly excludedAt: string;
}

interface RemovalSqlRow {
  profile_id: string | null;
  user_id: string;
  item_id: string;
  removed_at: unknown;
}

interface ExclusionSqlRow {
  profile_id: string | null;
  user_id: string;
  item_id: string;
  excluded_at: unknown;
}

function mapRemoval(row: RemovalSqlRow): HistoryRemovalRow {
  return {
    profileId: row.profile_id,
    userId: row.user_id,
    itemId: row.item_id,
    removedAt: String(row.removed_at),
  };
}

function mapExclusion(row: ExclusionSqlRow): HistoryExclusionRow {
  return {
    profileId: row.profile_id,
    userId: row.user_id,
    itemId: row.item_id,
    excludedAt: String(row.excluded_at),
  };
}

/** Constructor dependencies. */
export interface HistoryProjectionStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
}

// ---------------------------------------------------------------------------
// Removals
// ---------------------------------------------------------------------------

/**
 * The history-removal store: profile-scoped records of items the user
 * explicitly removed from history. Idempotent: re-adding the same
 * (profile, item) is a no-op (the `removed_at` keeps the earliest). A re-watch
 * DELETES the removal row (the {@link clearRemoval} method — called by the
 * relay fold when a new watch event arrives).
 */
export class PostgresHistoryRemovalStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(options: HistoryProjectionStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  /** Add a removal row (idempotent — keeps earliest removed_at). */
  async add(
    input: { userId: string; itemId: string; profileId?: string },
  ): Promise<HistoryRemovalRow> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<RemovalSqlRow>(
        `INSERT INTO history_removals (profile_id, user_id, item_id, removed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
           removed_at = history_removals.removed_at
         RETURNING *`,
        [input.profileId ?? null, input.userId, input.itemId, nowIso],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("historyRemovals.add: no row returned");
      return mapRemoval(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyRemovals.add");
    }
  }

  /** Add a removal row INSIDE a caller transaction (the outbox seam). */
  async addWithin(
    tx: SqlClient,
    input: { userId: string; itemId: string; profileId?: string },
  ): Promise<HistoryRemovalRow> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await tx.query<RemovalSqlRow>(
        `INSERT INTO history_removals (profile_id, user_id, item_id, removed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
           removed_at = history_removals.removed_at
         RETURNING *`,
        [input.profileId ?? null, input.userId, input.itemId, nowIso],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("historyRemovals.addWithin: no row returned");
      return mapRemoval(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyRemovals.addWithin");
    }
  }

  /** Is one (profile, item) removed? (the read-model filter check). */
  async isRemoved(
    profileId: string,
    itemId: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db.query<{ item_id: string }>(
        `SELECT item_id FROM history_removals WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2`,
        [profileId, itemId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyRemovals.isRemoved");
    }
  }

  /** List ALL removed item ids for one profile (the read-model filter). */
  async listRemoved(profileId: string): Promise<readonly string[]> {
    try {
      const rows = await this.db.query<{ item_id: string }>(
        `SELECT item_id FROM history_removals WHERE ${EFFECTIVE_PROFILE} = $1`,
        [profileId],
      );
      return rows.map((r) => r.item_id);
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyRemovals.listRemoved");
    }
  }

  /**
   * Clear a removal row (re-materialize the item in history). Called by the
   * relay fold when a NEW watch-state event arrives for an item — a re-watch
   * re-materializes the item in history.
   */
  async clearRemoval(
    profileId: string,
    itemId: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db.query<{ item_id: string }>(
        `DELETE FROM history_removals WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2 RETURNING item_id`,
        [profileId, itemId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyRemovals.clearRemoval");
    }
  }

  /** Clear a removal row INSIDE a caller transaction (the outbox seam). */
  async clearRemovalWithin(
    tx: SqlClient,
    profileId: string,
    itemId: string,
  ): Promise<boolean> {
    try {
      const rows = await tx.query<{ item_id: string }>(
        `DELETE FROM history_removals WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2 RETURNING item_id`,
        [profileId, itemId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyRemovals.clearRemovalWithin");
    }
  }
}

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

/**
 * The history-exclusion store: profile-scoped records of items the user
 * excluded from history-derived surfaces (Continue Watching,
 * already-watched signals). Stays excluded until explicitly removed.
 */
export class PostgresHistoryExclusionStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(options: HistoryProjectionStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  /** Add an exclusion row (idempotent — keeps earliest excluded_at). */
  async add(
    input: { userId: string; itemId: string; profileId?: string },
  ): Promise<HistoryExclusionRow> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<ExclusionSqlRow>(
        `INSERT INTO history_exclusions (profile_id, user_id, item_id, excluded_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
           excluded_at = history_exclusions.excluded_at
         RETURNING *`,
        [input.profileId ?? null, input.userId, input.itemId, nowIso],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("historyExclusions.add: no row returned");
      return mapExclusion(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyExclusions.add");
    }
  }

  /** Add an exclusion row INSIDE a caller transaction (the outbox seam). */
  async addWithin(
    tx: SqlClient,
    input: { userId: string; itemId: string; profileId?: string },
  ): Promise<HistoryExclusionRow> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await tx.query<ExclusionSqlRow>(
        `INSERT INTO history_exclusions (profile_id, user_id, item_id, excluded_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
           excluded_at = history_exclusions.excluded_at
         RETURNING *`,
        [input.profileId ?? null, input.userId, input.itemId, nowIso],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("historyExclusions.addWithin: no row returned");
      return mapExclusion(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyExclusions.addWithin");
    }
  }

  /** Is one (profile, item) excluded? */
  async isExcluded(
    profileId: string,
    itemId: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db.query<{ item_id: string }>(
        `SELECT item_id FROM history_exclusions WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2`,
        [profileId, itemId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyExclusions.isExcluded");
    }
  }

  /** List ALL excluded item ids for one profile (the read-model filter). */
  async listExcluded(profileId: string): Promise<readonly string[]> {
    try {
      const rows = await this.db.query<{ item_id: string }>(
        `SELECT item_id FROM history_exclusions WHERE ${EFFECTIVE_PROFILE} = $1`,
        [profileId],
      );
      return rows.map((r) => r.item_id);
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyExclusions.listExcluded");
    }
  }

  /** Remove an exclusion row (re-include the item in history-derived surfaces). */
  async removeExclusion(profileId: string, itemId: string): Promise<boolean> {
    try {
      const rows = await this.db.query<{ item_id: string }>(
        `DELETE FROM history_exclusions WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2 RETURNING item_id`,
        [profileId, itemId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyExclusions.removeExclusion");
    }
  }

  /** Remove an exclusion row INSIDE a caller transaction. */
  async removeExclusionWithin(
    tx: SqlClient,
    profileId: string,
    itemId: string,
  ): Promise<boolean> {
    try {
      const rows = await tx.query<{ item_id: string }>(
        `DELETE FROM history_exclusions WHERE ${EFFECTIVE_PROFILE} = $1 AND item_id = $2 RETURNING item_id`,
        [profileId, itemId],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "historyExclusions.removeExclusionWithin");
    }
  }
}
