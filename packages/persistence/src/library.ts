/**
 * @wfx/persistence — the user library store (WFX-052; R02 profile scoping;
 * R04 canonical-keyed with cross-source realization replacement).
 *
 * The durable side of the frozen `LibraryEntry` contract for the user's
 * WebFlix-local library (migrations 0003 + 0007 + 0009), now CANONICAL-KEYED:
 * the unique key is `(COALESCE(profile_id, 'user:' || user_id), item_id)` —
 * ONE row per (effective profile, canonical item id), NOT per realization.
 *
 * THE CANONICAL-KEY DISCIPLINE (R04 §1):
 * - A save from a NEW source for an EXISTING canonical item is a no-op on
 *   the LIST (one row per item) — the realization set in
 *   `metadata.realizations` GROWS; the PRIMARY realization reference
 *   (connector_id, external_ref) updates to the latest save (the user's most
 *   recent intent — the cross-source replacement law: a saved item never
 *   breaks when a source disappears IF another realization exists).
 * - The frozen `LibraryEntry` wire shape is unchanged: `connectorId` +
 *   `externalRef` + `title` + `addedAt` + `metadata?`. The canonical item id
 *   travels in `metadata.canonicalItemId` so the runtime's library read can
 *   ADOPT the server-sourced id (R04 §4 — durable canonical identity).
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
  item_id: string | null;
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
  // Carry the canonical item id through metadata (R04 §4 — the runtime's
  // library read adopts the server-sourced id). Merge any existing metadata
  // the row carries (the realization set, the list name, etc.) — never
  // fabricated; honest rows from before R04 have no canonicalItemId and the
  // runtime mints/reconciles per its own law.
  const rawMeta = row.metadata ?? undefined;
  let metadata: Record<string, unknown> | undefined;
  if (rawMeta !== undefined && rawMeta !== null) {
    metadata = rawMeta as Record<string, unknown>;
  }
  if (row.item_id !== null) {
    metadata = { ...(metadata ?? {}), canonicalItemId: row.item_id };
  }
  if (metadata !== undefined) entry.metadata = metadata;
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
 * the legacy forms). R04: the canonical-keyed upsert merges cross-source
 * realizations for the same (profile, item) into ONE row.
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

  /**
   * Insert-or-replace one entry INSIDE a caller transaction (outbox seam).
   *
   * R04 canonical-keyed: resolves the canonical item id from
   * source_realizations BEFORE the upsert (best-effort — when the
   * realization has no catalog row, the row inserts with a NULL item_id
   * under the realization-keyed unique index `library_entries_profile_key`
   * from migration 0007; the catalog connector's `requireItemIdForRef`
   * upstream strictly enforces the "never invent identities" law for the
   * production path). When item_id IS known, the upsert keys on
   * (effective_profile, item_id) — a second save of the same canonical
   * item from a DIFFERENT source is a no-op on the list count (one row)
   * with the realization set in metadata.realizations growing + the primary
   * realization reference updating to the latest save.
   *
   * Throws NEVER on an unknown realization (best-effort resolution); the
   * catalog connector's `requireItemIdForRef` is the strict gate.
   */
  async addWithin(
    tx: SqlClient,
    input: { userId: string; command: LibraryCommand; connectorId: string; profileId?: string },
  ): Promise<PersistedLibraryEntry> {
    const nowIso = epochMsToIso(this.clock.now());
    const title = input.command.title ?? input.command.externalRef;
    // Resolve the canonical item id INSIDE the caller's transaction (best-
    // effort — NULL when the realization has no catalog row; the row still
    // inserts under the realization-keyed fallback).
    const resolved = await resolveCanonicalItemId(tx, input.connectorId, input.command.externalRef);
    // Compose the metadata: caller metadata + the realization set entry.
    const callerMeta = input.command.metadata;
    const realizationEntry = {
      connectorId: input.connectorId,
      externalRef: input.command.externalRef,
      addedAt: nowIso,
    };
    // The merged metadata always carries the realization set entry; the
    // ON CONFLICT path re-merges with the existing array (canonical-keyed
    // case) — for the realization-keyed fallback, the metadata is the
    // caller's + the realization entry (no existing array to merge).
    const mergedMetadata = composeLibraryMetadata(callerMeta, realizationEntry);
    try {
      // Two paths based on whether item_id is known:
      // 1. KNOWN: canonical-keyed upsert (the R04 §1 law — second save of
      //    the same canonical item from a different source is a no-op on
      //    the list count; the realization set GROWS via jsonb
      //    concatenation on conflict — dedup happens at read time / in
      //    the runtime's library.read() via the registry).
      // 2. UNKNOWN: realization-keyed fallback (NULL item_id; the legacy
      //    pre-R04 behavior — re-saves of the same realization update the
      //    row; multiple NULL-item_id rows for DIFFERENT realizations
      //    coexist).
      const rows: LibrarySqlRow[] = resolved !== null
        ? await tx.query<LibrarySqlRow>(
            `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, item_id, title, added_at, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
             ON CONFLICT (${EFFECTIVE_PROFILE}, item_id) DO UPDATE SET
               connector_id = EXCLUDED.connector_id,
               external_ref = EXCLUDED.external_ref,
               title = EXCLUDED.title,
               added_at = EXCLUDED.added_at,
               metadata = jsonb_set(
                 COALESCE(library_entries.metadata, '{}'::jsonb)
                   - 'realizations'
                   || (EXCLUDED.metadata - 'realizations'),
                 '{realizations}',
                 COALESCE(library_entries.metadata->'realizations', '[]'::jsonb)
                   || COALESCE(EXCLUDED.metadata->'realizations', '[]'::jsonb)
               ),
               profile_id = EXCLUDED.profile_id
             RETURNING *`,
            [
              input.userId,
              input.profileId ?? null,
              input.connectorId,
              input.command.externalRef,
              resolved,
              title,
              nowIso,
              JSON.stringify(mergedMetadata),
            ],
          )
        : await tx.query<LibrarySqlRow>(
            `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, item_id, title, added_at, metadata)
             VALUES ($1, $2, $3, $4, NULL, $5, $6, $7::jsonb)
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
              title,
              nowIso,
              JSON.stringify(mergedMetadata),
            ],
          );
      const row = rows[0];
      if (row === undefined) throw new Error("addWithin: no row returned");
      return mapEntry(row, input.connectorId);
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.addWithin");
    }
  }

  /** Remove one entry INSIDE a caller transaction. Returns true when a row was removed.
   *
   * R04: removal keys on the (effective_profile, item_id) when the realization
   * resolves to a canonical item; the LEGACY form (no item_id) falls back to
   * (effective_profile, connector_id, external_ref) for the rows whose
   * realization has vanished. A removal of an UNKNOWN realization returns
   * false honestly. */
  async removeWithin(
    tx: SqlClient,
    input: { userId: string; connectorId: string; externalRef: string; profileId?: string },
  ): Promise<boolean> {
    const effectiveProfile = input.profileId ?? legacyProfileKey(input.userId);
    // Try canonical-keyed removal first (the common path post-0009).
    try {
      const rows = await tx.query<{ external_ref: string }>(
        `DELETE FROM library_entries
         WHERE ${EFFECTIVE_PROFILE} = $1
           AND item_id = (
             SELECT r.entertainment_item_id FROM source_realizations r
             WHERE r.connector_id = $2 AND r.external_ref = $3
           )
         RETURNING external_ref`,
        [effectiveProfile, input.connectorId, input.externalRef],
      );
      if (rows.length > 0) return true;
      // Fall back to the realization-keyed delete for legacy rows whose
      // realization vanished (item_id is NULL — the canonical lookup missed).
      const legacyRows = await tx.query<{ external_ref: string }>(
        `DELETE FROM library_entries
         WHERE ${EFFECTIVE_PROFILE} = $1 AND connector_id = $2 AND external_ref = $3
         RETURNING external_ref`,
        [effectiveProfile, input.connectorId, input.externalRef],
      );
      return legacyRows.length > 0;
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

  /** R02/R04: one PROFILE's library for `connectorId`, deterministic order. */
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

  /**
   * R04: ALL library entries for one PROFILE, regardless of the primary
   * realization's connector_id. The canonical-keyed library stores ONE row
   * per (profile, item); the primary `connector_id` updates to the latest
   * save (the cross-source replacement law). This read returns EVERY row
   * in the profile — used by the catalog connector's
   * `readLibraryForProfile` (the WebFlix-owned service library owns ALL
   * rows saved via the service, regardless of which realization source the
   * user saved from). Deterministic (added_at, external_ref) order.
   */
  async listAllForProfile(
    profileId: string,
    limit = 200,
  ): Promise<readonly PersistedLibraryEntry[]> {
    try {
      const rows = await this.db.query<LibrarySqlRow>(
        `SELECT * FROM library_entries
         WHERE ${EFFECTIVE_PROFILE} = $1
         ORDER BY added_at, external_ref
         LIMIT $2`,
        [profileId, limit],
      );
      // The wire shape's connectorId is the row's PRIMARY connector_id
      // (the latest save's source) — honest about which realization the
      // user most recently saved from.
      return rows.map((row) => mapEntry(row, row.connector_id));
    } catch (thrown) {
      throw classifyDriverError(thrown, "library.listAllForProfile");
    }
  }

  /** Does the user hold one entry? (existence check — effective profile). */
  async has(userId: string, connectorId: string, externalRef: string): Promise<boolean> {
    const profileId = await this.profiles.resolveEffectiveProfileKey(userId);
    return this.hasForProfile(profileId, connectorId, externalRef);
  }

  /** R02/R04: does one PROFILE hold one entry? */
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

// ---------------------------------------------------------------------------
// R04 — canonical-id resolution + metadata composition (internal helpers)
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical item id of one realization INSIDE the caller's
 * transaction. Returns null when the realization is unknown — the catalog
 * NEVER invents canonical identities (the conversion law's "a saved item
 * never breaks when a source disappears IF another realization exists" —
 * when the realization vanished, the row stays listed but cannot be re-saved).
 */
async function resolveCanonicalItemId(
  tx: SqlClient,
  connectorId: string,
  externalRef: string,
): Promise<string | null> {
  try {
    const rows = await tx.query<{ item_id: string }>(
      `SELECT r.entertainment_item_id AS item_id
       FROM source_realizations r
       WHERE r.connector_id = $1 AND r.external_ref = $2`,
      [connectorId, externalRef],
    );
    const row = rows[0];
    return row === undefined ? null : row.item_id;
  } catch (thrown) {
    throw classifyDriverError(thrown, "library.resolveCanonicalItemId");
  }
}

/**
 * Compose the metadata for one library upsert. Carries the caller metadata
 * (the list name, the connector attribution, etc.) PLUS the realization set
 * entry under `realizations`. The first save starts the array; the
 * `addWithin` ON CONFLICT path re-merges with the existing array.
 *
 * The canonicalItemId field is NOT written here — it is read-side only
 * (the read mapEntry injects it from the row's item_id column). The
 * canonical id is the row's `item_id` column itself; never duplicated in
 * metadata (single source of truth).
 */
function composeLibraryMetadata(
  caller: Record<string, unknown> | undefined,
  realizationEntry: { connectorId: string; externalRef: string; addedAt: string },
): Record<string, unknown> {
  const base: Record<string, unknown> = caller === undefined ? {} : { ...caller };
  // Seed the realization set with the current realization; the store's
  // ON CONFLICT path appends future realizations.
  if (!Array.isArray(base.realizations)) {
    base.realizations = [realizationEntry];
  } else {
    // Defensive: dedupe by (connectorId, externalRef) — a re-save of the
    // same realization updates the entry instead of duplicating it.
    const filtered = base.realizations.filter(
      (entry): entry is { connectorId: string; externalRef: string; addedAt: string } =>
        typeof entry === "object" && entry !== null &&
        typeof (entry as Record<string, unknown>).connectorId === "string" &&
        typeof (entry as Record<string, unknown>).externalRef === "string" &&
        !((entry as Record<string, unknown>).connectorId === realizationEntry.connectorId &&
          (entry as Record<string, unknown>).externalRef === realizationEntry.externalRef),
    );
    filtered.push(realizationEntry);
    base.realizations = filtered;
  }
  return base;
}
