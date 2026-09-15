/**
 * @wfx/persistence — the Entertainment Graph tables adapter (WFX-052).
 *
 * Durable storage for the canonical content identity and its source
 * realizations (migrations 0002). Mirrors the in-memory
 * `EntertainmentGraph` (WFX-010) semantics the frozen architecture fixes:
 *
 * - "One content identity, many realizations": items keyed by canonical
 *   `wfxitm_` id; each realization row attaches to exactly one item.
 * - Realization identity is `(connectorId, externalRef)` — enforced
 *   UNIQUE. A re-report UPDATES the row and KEEPS the original `wfxsrc_`
 *   id (stable identity; the upsert never rewrites it).
 * - Item upsert is a merge-update: defined incoming scalars win,
 *   `created_at` keeps the earliest, `updated_at` the latest — the same
 *   deterministic, data-driven timestamp law the in-memory store applies
 *   (computed HERE from the passed values, no hidden clock).
 * - Reads are plain queries returning defensive plain objects; validation
 *   of untrusted input happens in `@wfx/domain` validators before writes
 *   (the adapters call them — malformed input is typed invalid-input, and
 *   the CHECK constraints are the second line of defense).
 *
 * The graph's creators/topics REGISTRIES (wfxcre_/wfxtop_ records) are not
 * part of WFX-052's table scope; the item's creators/topics REFERENCE
 * lists round-trip as jsonb so no knowledge is lost. Documented gap: the
 * registry tables + relationship edges land with the graph-persistence
 * consumer that actually needs them (a later wave extends this file).
 */

import {
  validateEntertainmentItem,
  validateSourceRealization,
  type PlaybackRealization,
  type SourceRealization,
} from "@wfx/domain";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { toIsoTimestamp, type DbClient } from "./sql";

/** A canonical item as persisted (the frozen fields + graph bookkeeping). */
export interface PersistedItem {
  readonly id: string;
  readonly canonicalType: "movie" | "series" | "episode" | "video" | "short" | "post" | "audio";
  readonly canonicalTitle: string | null;
  readonly durationMs: number | null;
  readonly orientation: "horizontal" | "vertical" | "square" | "unknown" | null;
  readonly creators: readonly string[];
  readonly topics: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input accepted by `upsertItem` — frozen fields (optional where the contract
 *  is optional) + the graph's reference lists and timestamps. Optional fields
 *  are `undefined`-shaped (the domain validator's law), NOT `null` — SQL NULL
 *  is only ever the STORED representation. */
export interface ItemUpsertInput {
  readonly id: string;
  readonly canonicalType: PersistedItem["canonicalType"];
  readonly canonicalTitle?: string;
  readonly durationMs?: number;
  readonly orientation?: NonNullable<PersistedItem["orientation"]>;
  readonly creators: readonly string[];
  readonly topics: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A source realization as persisted, with its concrete playback answers. */
export interface PersistedRealization extends SourceRealization {
  /** The realization's playback answers (frozen PlaybackRealization list). */
  readonly playback: readonly PlaybackRealization[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input accepted by `upsertRealization`. */
export type RealizationUpsertInput = PersistedRealization;

interface ItemSqlRow {
  id: string;
  canonical_type: string;
  canonical_title: string | null;
  duration_ms: unknown;
  orientation: string | null;
  creators: unknown;
  topics: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface RealizationSqlRow {
  id: string;
  entertainment_item_id: string;
  connector_id: string;
  external_ref: string;
  capabilities: unknown;
  availability: string;
  playback: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function mapItem(row: ItemSqlRow): PersistedItem {
  return {
    id: row.id,
    canonicalType: row.canonical_type as PersistedItem["canonicalType"],
    canonicalTitle: row.canonical_title,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    orientation: (row.orientation ?? null) as PersistedItem["orientation"],
    creators: (row.creators ?? []) as string[],
    topics: (row.topics ?? []) as string[],
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function mapRealization(row: RealizationSqlRow): PersistedRealization {
  return {
    id: row.id,
    entertainmentItemId: row.entertainment_item_id,
    connectorId: row.connector_id,
    externalRef: row.external_ref,
    capabilities: (row.capabilities ?? []) as SourceRealization["capabilities"],
    availability: row.availability as PersistedRealization["availability"],
    playback: (row.playback ?? []) as PlaybackRealization[],
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** Deterministic merge timestamps: earliest createdAt, latest updatedAt. */
function mergedTimestamps(
  existing: { createdAt: string; updatedAt: string },
  incoming: { createdAt: string; updatedAt: string },
): { createdAt: string; updatedAt: string } {
  return {
    createdAt:
      Date.parse(incoming.createdAt) < Date.parse(existing.createdAt)
        ? incoming.createdAt
        : existing.createdAt,
    updatedAt:
      Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)
        ? incoming.updatedAt
        : existing.updatedAt,
  };
}

/** Validate item shape with the domain validator; map failures to typed errors. */
function assertValidItemInput(input: ItemUpsertInput): void {
  const base = validateEntertainmentItem(input);
  if (!base.ok) {
    throw new PersistenceError("invalid-input", `item: ${base.errors.join("; ")}`, {
      operation: "upsertItem",
    });
  }
}

/**
 * The Entertainment Graph tables adapter. All methods are plain SQL against
 * the `DbClient` seam; every failure is classified.
 */
export class PostgresGraphStore {
  private readonly db: DbClient;

  constructor(db: DbClient) {
    this.db = db;
  }

  /**
   * Insert or merge-update one canonical item. First sight inserts (input
   * timestamps kept verbatim); a re-upsert MERGES exactly like the in-memory
   * graph: defined incoming scalars win, OMITTED scalars keep the stored
   * value (COALESCE — the graph accumulates knowledge, it never forgets),
   * reference lists REPLACE (the caller passes the union it wants),
   * timestamps follow the earliest-created/latest-updated law. Returns the
   * row as stored.
   */
  async upsertItem(input: ItemUpsertInput): Promise<PersistedItem> {
    assertValidItemInput(input);
    const existingRows = await this.queryItems(`SELECT * FROM entertainment_items WHERE id = $1`, [
      input.id,
    ]);
    const existing = existingRows[0];

    const timestamps = existing
      ? mergedTimestamps(existing, input)
      : { createdAt: input.createdAt, updatedAt: input.updatedAt };

    try {
      const rows = await this.db.query<ItemSqlRow>(
        `INSERT INTO entertainment_items
           (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           canonical_type = EXCLUDED.canonical_type,
           canonical_title = COALESCE(EXCLUDED.canonical_title, entertainment_items.canonical_title),
           duration_ms = COALESCE(EXCLUDED.duration_ms, entertainment_items.duration_ms),
           orientation = COALESCE(EXCLUDED.orientation, entertainment_items.orientation),
           creators = EXCLUDED.creators,
           topics = EXCLUDED.topics,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.id,
          input.canonicalType,
          input.canonicalTitle ?? null,
          input.durationMs ?? null,
          input.orientation ?? null,
          JSON.stringify(input.creators),
          JSON.stringify(input.topics),
          timestamps.createdAt,
          timestamps.updatedAt,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("upsertItem: no row returned");
      return mapItem(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "upsertItem");
    }
  }

  /**
   * Insert or update one source realization keyed by
   * `(connectorId, externalRef)`. A re-report UPDATES capabilities /
   * availability / playback and KEEPS the original `wfxsrc_` id. The
   * referenced item must exist (the store never invents canonical
   * identities — FK violation is typed invalid-input).
   */
  async upsertRealization(input: RealizationUpsertInput): Promise<PersistedRealization> {
    const validated = validateSourceRealization(input);
    if (!validated.ok) {
      throw new PersistenceError("invalid-input", `realization: ${validated.errors.join("; ")}`, {
        operation: "upsertRealization",
      });
    }
    const nowIso = input.updatedAt;
    try {
      const rows = await this.db.query<RealizationSqlRow>(
        `INSERT INTO source_realizations
           (id, entertainment_item_id, connector_id, external_ref, capabilities, availability,
            playback, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9)
         ON CONFLICT (connector_id, external_ref) DO UPDATE SET
           entertainment_item_id = EXCLUDED.entertainment_item_id,
           capabilities = EXCLUDED.capabilities,
           availability = EXCLUDED.availability,
           playback = EXCLUDED.playback,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.id,
          input.entertainmentItemId,
          input.connectorId,
          input.externalRef,
          JSON.stringify(input.capabilities),
          input.availability,
          JSON.stringify(input.playback),
          input.createdAt,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("upsertRealization: no row returned");
      return mapRealization(row);
    } catch (thrown) {
      const foreignKey = /violates foreign key/i.test(String(thrown));
      if (foreignKey) {
        throw new PersistenceError(
          "invalid-input",
          `realization: entertainment item ${input.entertainmentItemId} does not exist — the store never invents canonical identities`,
          { operation: "upsertRealization", cause: thrown },
        );
      }
      throw classifyDriverError(thrown, "upsertRealization");
    }
  }

  /** One item by canonical id (null when unknown — a query, not an error). */
  async getItem(itemId: string): Promise<PersistedItem | null> {
    const rows = await this.queryItems(`SELECT * FROM entertainment_items WHERE id = $1`, [itemId]);
    return rows[0] ?? null;
  }

  /**
   * Case-insensitive substring search over `canonical_title` (the graph's
   * search law), deterministically ordered by (title, id). Items without a
   * title never match; an empty/blank needle is invalid input.
   */
  async searchItems(titleSubstring: string, limit = 50): Promise<readonly PersistedItem[]> {
    if (typeof titleSubstring !== "string" || titleSubstring.trim().length === 0) {
      throw new PersistenceError(
        "invalid-input",
        "titleSubstring: expected a non-empty string",
        { operation: "searchItems" },
      );
    }
    // Escape LIKE metacharacters: the needle is a literal substring.
    const needle = `%${titleSubstring.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    return this.queryItems(
      `SELECT * FROM entertainment_items
       WHERE canonical_title IS NOT NULL AND lower(canonical_title) LIKE lower($1)
       ORDER BY canonical_title, id
       LIMIT $2`,
      [needle, limit],
    );
  }

  /** All realizations of an item (insertion order = id order). Empty array for unknown items. */
  async realizationsOf(itemId: string): Promise<readonly PersistedRealization[]> {
    try {
      const rows = await this.db.query<RealizationSqlRow>(
        `SELECT * FROM source_realizations WHERE entertainment_item_id = $1 ORDER BY id`,
        [itemId],
      );
      return rows.map(mapRealization);
    } catch (thrown) {
      throw classifyDriverError(thrown, "realizationsOf");
    }
  }

  /** One realization by (connectorId, externalRef) identity (null when unknown). */
  async realizationByRef(
    connectorId: string,
    externalRef: string,
  ): Promise<PersistedRealization | null> {
    try {
      const rows = await this.db.query<RealizationSqlRow>(
        `SELECT * FROM source_realizations WHERE connector_id = $1 AND external_ref = $2`,
        [connectorId, externalRef],
      );
      const row = rows[0];
      return row === undefined ? null : mapRealization(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "realizationByRef");
    }
  }

  /** List items in deterministic (created_at, id) order (catalog walk). */
  async listItems(limit = 50, offset = 0): Promise<readonly PersistedItem[]> {
    return this.queryItems(
      `SELECT * FROM entertainment_items ORDER BY created_at, id LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
  }

  private async queryItems(sqlText: string, params: readonly unknown[]): Promise<PersistedItem[]> {
    try {
      const rows = await this.db.query<ItemSqlRow>(sqlText, params);
      return rows.map(mapItem);
    } catch (thrown) {
      throw classifyDriverError(thrown, "PostgresGraphStore.query");
    }
  }
}
