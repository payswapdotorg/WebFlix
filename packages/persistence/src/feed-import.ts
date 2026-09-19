/**
 * @wfx/persistence — the BYOF feed import store (R20-A/R20-C, Worker 1).
 *
 * The durable side of Bring Your Own Feed over migration 0012: feed import
 * transactions (preview → confirmed → complete/failed/reauthorization),
 * preview staging, and the IDEMPOTENT feed records with full provenance.
 *
 * Laws this adapter enforces (docs/architecture/byof-architecture.md):
 *
 * - THE IDEMPOTENT IMPORT LAW is structural: `feed_records` carries a
 *   UNIQUE (profile_id, import_key) where `import_key` is the deterministic
 *   domain key (`feedImportKey` over profile/connector/relationship/
 *   container/external item). A re-import UPSERTS the same row. Confirming
 *   the same preview twice is a no-op; importing the same playlist through
 *   a second import is a no-op on the row count.
 * - PREVIEW TRUTH: staged rows are promoted verbatim at confirm — confirm
 *   NEVER re-fetches (the user confirmed what they saw). Staging itself is
 *   duplicate-proof (PK (import_id, import_key)).
 * - THE SURVIVAL LAW: no method of this store deletes feed records on a
 *   failing source. Sync failures fold to `stale`/`reauthorization-required`
 *   (records kept); only `deleteFeedRecords` removes rows — the EXPLICIT
 *   user-deletion path — and it never touches library/history/intents.
 * - THE SEPARATION LAW (structural): this adapter writes ONLY
 *   feed_imports/feed_preview_items/feed_records. WebFlix-local actions
 *   (library_entries, watch_history, user_intents, recommendation_*) are
 *   other tables' truth — importing a concentrated feed cannot touch them
 *   (pinned by tests).
 * - MODE TRUTH: `readFeed(mode)` answers exactly what the store owns:
 *   `byof`/`hybrid` → the imported records in source-native order;
 *   `following` → the follow-graph subset; `webflix` → [] (imported
 *   source-native records are NEVER re-labeled WebFlix-ranked content —
 *   the WebFlix feed is the Recommendation OS's).
 *
 * Every failure is classified (`classifyDriverError` → typed
 * `PersistenceError`); untrusted input is validated by the domain feed
 * validators before any write.
 */

import type {
  FeedImport,
  FeedImportMethod,
  FeedImportPreview,
  FeedRecord,
  FeedRelationship,
  FeedSyncState,
} from "@wfx/domain";
import {
  FEED_RELATIONSHIPS,
  FOLLOWING_RELATIONSHIPS,
  feedImportKey,
  isIso8601,
  validateConnectorFeedItem,
} from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { toIsoTimestamp, type DbClient, type SqlClient } from "./sql";

/** The canonical feed-record id prefix (the WFX-002 lane-prefix scheme). */
export const FEED_RECORD_ID_PREFIX = "wfxfeed_";

/** The canonical feed-import id prefix. */
export const FEED_IMPORT_ID_PREFIX = "wfximp_";

// ---------------------------------------------------------------------------
// Row shapes (the frozen entities + the store columns)
// ---------------------------------------------------------------------------

/** The persisted `FeedImport` (frozen fields + store bookkeeping). */
export interface PersistedFeedImport extends FeedImport {
  readonly userId: string;
  readonly profileId: string;
  readonly sourceRef?: string;
  /** The request's relationship filter (R20-C migration 0013): the sync scope. `undefined` = the route's full set. */
  readonly relationships?: readonly FeedRelationship[];
  readonly continuousSync: boolean;
  readonly itemCount: number;
  readonly lastSyncedAt?: string;
  /** The import-level freshness truth (live/snapshot/stale/...). */
  readonly syncState: FeedSyncState;
}

/** The persisted `FeedRecord` (frozen fields + the store's external identity columns). */
export interface PersistedFeedRecord extends FeedRecord {
  readonly importId: string;
  readonly importKey: string;
  readonly externalRef: string;
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
}

/** One staged preview item (what `confirmImport` promotes verbatim). */
export interface StageFeedItemInput {
  readonly externalRef: string;
  readonly relationship: FeedRelationship;
  readonly sourceRef?: string;
  readonly sourceOrder: number;
  readonly capturedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
  /** The canonical item the composition resolved for this external ref. */
  readonly entertainmentItemId: string;
}

/** Options for `startPreview` (the import transaction + its staged capture). */
export interface StartPreviewInput {
  readonly userId: string;
  readonly profileId: string;
  readonly connectorId: string;
  readonly method: FeedImportMethod;
  readonly continuousSync: boolean;
  readonly sourceRef?: string;
  /** The request's relationship filter — the scope a later sync reconciles (R20-C). */
  readonly relationships?: readonly FeedRelationship[];
  readonly capturedAt: string;
  readonly items: readonly StageFeedItemInput[];
}

/** One ready-to-write record row (the reconciliation applier's payload). */
export interface FeedRecordWriteInput {
  readonly key: string;
  readonly externalRef: string;
  readonly relationship: FeedRelationship;
  readonly sourceRef?: string;
  readonly sourceOrder: number;
  readonly capturedAt: string;
  readonly sourceUpdatedAt?: string;
  readonly title?: string;
  readonly metadata?: Record<string, unknown>;
  readonly entertainmentItemId: string;
}

/** The scope for reading existing records (the reconcile engine's input). */
export interface FeedRecordScope {
  readonly profileId: string;
  readonly connectorId: string;
  readonly relationships?: readonly FeedRelationship[];
  readonly sourceRef?: string;
}

/** The outcome of applying one reconciliation (honest counts). */
export interface ApplyReconciliationOutcome {
  readonly import: PersistedFeedImport;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly kept: number;
}

/** The read modes of the frozen `FeedPort.readFeed` vocabulary. */
export type FeedReadMode = "webflix" | "following" | "byof" | "hybrid";

// ---------------------------------------------------------------------------
// SQL rows
// ---------------------------------------------------------------------------

interface ImportSqlRow {
  id: string;
  user_id: string;
  profile_id: string;
  connector_id: string;
  method: string;
  status: string;
  sync_state: string;
  continuous_sync: unknown;
  source_ref: string | null;
  relationships: unknown;
  item_count: number;
  started_at: unknown;
  completed_at: unknown | null;
  last_synced_at: unknown | null;
  error: string | null;
}

interface RecordSqlRow {
  id: string;
  user_id: string;
  profile_id: string;
  import_id: string;
  import_key: string;
  connector_id: string;
  import_method: string;
  relationship: string;
  source_ref: string | null;
  external_ref: string;
  source_order: number;
  captured_at: unknown;
  sync_state: string;
  imported_at: unknown;
  source_updated_at: unknown | null;
  title: string | null;
  metadata: unknown;
  entertainment_item_id: string;
}

interface PreviewItemSqlRow {
  import_id: string;
  import_key: string;
  position: number;
  external_ref: string;
  relationship: string;
  source_ref: string | null;
  source_order: number;
  captured_at: unknown;
  source_updated_at: unknown | null;
  title: string | null;
  metadata: unknown;
  canonical_item_id: string;
  record_id: string;
}

/** Parse the stored `relationships` jsonb (null / malformed ⇒ absent, the pre-0013 full-set reading). */
function mapRelationships(value: unknown): readonly FeedRelationship[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: FeedRelationship[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && (FEED_RELATIONSHIPS as readonly string[]).includes(entry)) {
      out.push(entry as FeedRelationship);
    }
  }
  return out;
}

function mapImport(row: ImportSqlRow): PersistedFeedImport {
  const relationships = mapRelationships(row.relationships);
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    connectorId: row.connector_id,
    method: row.method as FeedImportMethod,
    status: row.status as PersistedFeedImport["status"],
    syncState: row.sync_state as FeedSyncState,
    continuousSync: row.continuous_sync === true,
    ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
    ...(relationships !== undefined ? { relationships } : {}),
    itemCount: Number(row.item_count),
    startedAt: toIsoTimestamp(row.started_at),
    ...(row.completed_at !== null ? { completedAt: toIsoTimestamp(row.completed_at) } : {}),
    ...(row.last_synced_at !== null ? { lastSyncedAt: toIsoTimestamp(row.last_synced_at) } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
  };
}

function mapRecord(row: RecordSqlRow): PersistedFeedRecord {
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    importId: row.import_id,
    importKey: row.import_key,
    externalRef: row.external_ref,
    entertainmentItemId: row.entertainment_item_id,
    importedAt: toIsoTimestamp(row.imported_at),
    ...(row.title !== null ? { title: row.title } : {}),
    ...(row.source_updated_at !== null
      ? { sourceUpdatedAt: toIsoTimestamp(row.source_updated_at) }
      : {}),
    ...(row.metadata !== null && row.metadata !== undefined
      ? { metadata: row.metadata as Record<string, unknown> }
      : {}),
    provenance: {
      connectorId: row.connector_id,
      importMethod: row.import_method as FeedImportMethod,
      ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
      capturedAt: toIsoTimestamp(row.captured_at),
      syncState: row.sync_state as FeedSyncState,
      sourceOrder: Number(row.source_order),
      relationship: row.relationship as FeedRelationship,
    },
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Options for the store (the injected seams — repo determinism law). */
export interface FeedImportStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/** Validation helper: stage items must be well-formed before any write. */
function assertValidStageItems(items: readonly StageFeedItemInput[]): void {
  const problems: string[] = [];
  items.forEach((item, index) => {
    const own = validateConnectorFeedItem(item);
    for (const problem of own.errors) {
      problems.push(`items[${index}].${problem.replace(/^item\./, "")}`);
    }
    if (!isIso8601(item.capturedAt)) {
      problems.push(`items[${index}].capturedAt: expected a full ISO 8601 timestamp`);
    }
    if (typeof item.entertainmentItemId !== "string" || item.entertainmentItemId.length === 0) {
      problems.push(`items[${index}].entertainmentItemId: expected a non-empty string`);
    }
  });
  if (problems.length > 0) {
    throw new PersistenceError("invalid-input", problems.join("; "), {
      operation: "startPreview",
    });
  }
}

/**
 * The BYOF feed import store. All methods are plain parameterized SQL over
 * the `DbClient` seam; multi-row operations run in one transaction
 * (`db.begin`) so an import is atomic — all-or-neither.
 */
export class PostgresFeedImportStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: FeedImportStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  /**
   * Start one import transaction: insert the `feed_imports` row (status
   * `preview`) and stage the captured items verbatim. The capture's
   * `capturedAt` is the snapshot truth the preview and the eventual records
   * both carry. Staging is duplicate-proof (PK (import_id, import_key)) —
   * an intra-capture duplicate upserts nothing.
   */
  async startPreview(input: StartPreviewInput): Promise<PersistedFeedImport> {
    assertValidStageItems(input.items);
    const importId = `${FEED_IMPORT_ID_PREFIX}${this.ids.next()}`;
    const startedAt = this.nowIso();
    try {
      return await this.db.begin(async (tx) => {
        await tx.query(
          `INSERT INTO feed_imports
             (id, user_id, profile_id, connector_id, method, status, sync_state,
              continuous_sync, source_ref, relationships, item_count, started_at)
           VALUES ($1, $2, $3, $4, $5, 'preview', 'snapshot', $6, $7, $8::jsonb, $9, $10)`,
          [
            importId,
            input.userId,
            input.profileId,
            input.connectorId,
            input.method,
            input.continuousSync,
            input.sourceRef ?? null,
            JSON.stringify(input.relationships ?? null),
            input.items.length,
            startedAt,
          ],
        );
        for (const item of input.items) {
          const key = feedImportKey({
            profileId: input.profileId,
            connectorId: input.connectorId,
            relationship: item.relationship,
            sourceRef: item.sourceRef,
            externalRef: item.externalRef,
          });
          await tx.query(
            `INSERT INTO feed_preview_items
               (import_id, import_key, position, external_ref, relationship, source_ref,
                source_order, captured_at, source_updated_at, title, metadata, canonical_item_id, record_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
             ON CONFLICT (import_id, import_key) DO NOTHING`,
            [
              importId,
              key,
              item.sourceOrder,
              item.externalRef,
              item.relationship,
              item.sourceRef ?? null,
              item.sourceOrder,
              item.capturedAt,
              item.sourceUpdatedAt ?? null,
              item.title ?? null,
              JSON.stringify(item.metadata ?? {}),
              item.entertainmentItemId,
              `${FEED_RECORD_ID_PREFIX}${this.ids.next()}`,
            ],
          );
        }
        const rows = await tx.query<ImportSqlRow>(`SELECT * FROM feed_imports WHERE id = $1`, [
          importId,
        ]);
        const row = rows[0];
        if (row === undefined) throw new Error("startPreview: no row returned");
        return mapImport(row);
      });
    } catch (thrown) {
      throw classifyDriverError(thrown, "startPreview");
    }
  }

  /**
   * Read one preview: the import + the frozen `FeedImportPreview`
   * (item count, per-relationship counts, the capture's freshness, and the
   * sample records the user is confirming). `null` when the import is
   * unknown.
   */
  async readPreview(importId: string): Promise<FeedImportPreview | null> {
    const imports = await this.getImport(importId);
    if (imports === null) return null;
    let staged: PreviewItemSqlRow[];
    try {
      staged = await this.db.query<PreviewItemSqlRow>(
        `SELECT * FROM feed_preview_items WHERE import_id = $1 ORDER BY position`,
        [importId],
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "readPreview");
    }
    const relationshipCounts: Record<string, number> = {};
    for (const row of staged) {
      relationshipCounts[row.relationship] = (relationshipCounts[row.relationship] ?? 0) + 1;
    }
    const sample: FeedRecord[] = staged.slice(0, 20).map((row) => ({
      id: row.record_id,
      userId: imports.userId,
      profileId: imports.profileId,
      entertainmentItemId: row.canonical_item_id,
      provenance: {
        connectorId: imports.connectorId,
        importMethod: imports.method,
        ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
        capturedAt: toIsoTimestamp(row.captured_at),
        syncState: imports.syncState,
        sourceOrder: Number(row.source_order),
        relationship: row.relationship as FeedRelationship,
      },
      importedAt: imports.startedAt,
      ...(row.source_updated_at !== null
        ? { sourceUpdatedAt: toIsoTimestamp(row.source_updated_at) }
        : {}),
    }));
    return {
      importId,
      connectorId: imports.connectorId,
      method: imports.method,
      itemCount: staged.length,
      relationshipCounts,
      freshness: imports.syncState,
      sample,
    };
  }

  // -------------------------------------------------------------------------
  // Failed capture audit (R20-C)
  // -------------------------------------------------------------------------

  /**
   * Record one FAILED capture attempt as its own import transaction row —
   * the honest audit trail (R20-C): an import the user attempted that never
   * reached a preview because the capture itself failed.
   *
   * Status truth: `reauthorization-required` when the failure was the
   * user's missing grant (the surface's recovery path); `failed` for
   * transport/provider failures. `itemCount` is 0 — nothing was staged, and
   * NOTHING is deleted (the survival law: this row-creating path only
   * ever ADDS the attempt record).
   *
   * Not for `unsupported`/`invalid-input` verdicts: those are static
   * request/capability truth the caller could have known before attempting
   * — recording them as import transactions would be noise, not audit.
   */
  async recordFailedImport(input: {
    readonly userId: string;
    readonly profileId: string;
    readonly connectorId: string;
    readonly method: FeedImportMethod;
    readonly sourceRef?: string;
    readonly relationships?: readonly FeedRelationship[];
    readonly syncState: FeedSyncState;
    readonly error: string;
  }): Promise<PersistedFeedImport> {
    const importId = `${FEED_IMPORT_ID_PREFIX}${this.ids.next()}`;
    const status: PersistedFeedImport["status"] =
      input.syncState === "reauthorization-required" ? "reauthorization-required" : "failed";
    try {
      const rows = await this.db.query<ImportSqlRow>(
        `INSERT INTO feed_imports
           (id, user_id, profile_id, connector_id, method, status, sync_state,
            continuous_sync, source_ref, relationships, item_count, started_at, completed_at, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9::jsonb, 0, $10, $10, $11)
         RETURNING *`,
        [
          importId,
          input.userId,
          input.profileId,
          input.connectorId,
          input.method,
          status,
          input.syncState,
          input.sourceRef ?? null,
          JSON.stringify(input.relationships ?? null),
          this.nowIso(),
          input.error,
        ],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("recordFailedImport: no row returned");
      return mapImport(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "recordFailedImport");
    }
  }

  // -------------------------------------------------------------------------
  // Confirm
  // -------------------------------------------------------------------------

  /**
   * Confirm one preview: promote the staged rows into `feed_records`
   * (idempotent upsert by import key), stamp the import `complete` with the
   * folded sync state, and set `last_synced_at` to the capture time.
   *
   * Confirming is IDEMPOTENT: a second confirm of the same import re-applies
   * the same staged rows onto the same keys — no duplicates, no count drift.
   * A capture whose route supports continuous sync lands `live`; a one-time
   * capture lands `snapshot` (never presented as live).
   */
  async confirmImport(
    importId: string,
    options: { syncState?: FeedSyncState } = {},
  ): Promise<PersistedFeedImport> {
    const existing = await this.getImport(importId);
    if (existing === null) {
      throw new PersistenceError(
        "invalid-input",
        `confirmImport: feed import '${importId}' is unknown`,
        { operation: "confirmImport" },
      );
    }
    if (existing.status === "failed" || existing.status === "reauthorization-required") {
      // These imports never staged a capture: confirming one would promote
      // NOTHING and stamp a 0-item "complete" — a fabricated success. (A
      // re-confirm of an already-'complete' import stays allowed: it
      // re-applies the same staged rows onto the same keys — the R20-A
      // idempotence law.)
      throw new PersistenceError(
        "invalid-input",
        `confirmImport: feed import '${importId}' is '${existing.status}' — it never staged a preview to confirm`,
        { operation: "confirmImport" },
      );
    }
    const syncState = options.syncState ?? (existing.continuousSync ? "live" : "snapshot");
    const completedAt = this.nowIso();
    try {
      return await this.db.begin(async (tx) => {
        const staged = await tx.query<PreviewItemSqlRow>(
          `SELECT * FROM feed_preview_items WHERE import_id = $1 ORDER BY position`,
          [importId],
        );
        for (const row of staged) {
          await upsertRecordRow(tx, {
            id: row.record_id,
            userId: existing.userId,
            profileId: existing.profileId,
            importId,
            importKey: row.import_key,
            connectorId: existing.connectorId,
            importMethod: existing.method,
            relationship: row.relationship as FeedRelationship,
            ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
            externalRef: row.external_ref,
            sourceOrder: Number(row.source_order),
            capturedAt: toIsoTimestamp(row.captured_at),
            syncState,
            importedAt: completedAt,
            ...(row.source_updated_at !== null
              ? { sourceUpdatedAt: toIsoTimestamp(row.source_updated_at) }
              : {}),
            ...(row.title !== null ? { title: row.title } : {}),
            ...(row.metadata !== null && row.metadata !== undefined
              ? { metadata: row.metadata as Record<string, unknown> }
              : {}),
            entertainmentItemId: row.canonical_item_id,
          });
        }
        const rows = await tx.query<ImportSqlRow>(
          `UPDATE feed_imports
             SET status = 'complete', completed_at = $2, last_synced_at = $3,
                 sync_state = $4, item_count = $5
           WHERE id = $1
           RETURNING *`,
          [importId, completedAt, this.nowIso(), syncState, staged.length],
        );
        const updated = rows[0];
        if (updated === undefined) throw new Error("confirmImport: no row returned");
        return mapImport(updated);
      });
    } catch (thrown) {
      throw classifyDriverError(thrown, "confirmImport");
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** One import by id (null when unknown). */
  async getImport(importId: string): Promise<PersistedFeedImport | null> {
    try {
      const rows = await this.db.query<ImportSqlRow>(`SELECT * FROM feed_imports WHERE id = $1`, [
        importId,
      ]);
      const row = rows[0];
      return row === undefined ? null : mapImport(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "getImport");
    }
  }

  /** The imports of one profile (newest first). */
  async listImports(profileId: string): Promise<readonly PersistedFeedImport[]> {
    try {
      const rows = await this.db.query<ImportSqlRow>(
        `SELECT * FROM feed_imports WHERE profile_id = $1 ORDER BY started_at DESC, id`,
        [profileId],
      );
      return rows.map(mapImport);
    } catch (thrown) {
      throw classifyDriverError(thrown, "listImports");
    }
  }

  /**
   * Read the feed records of one profile under a feed mode:
   * - `byof`/`hybrid` — every imported record, grouped per source container
   *   in SOURCE-NATIVE order (the order is data with provenance);
   * - `following` — the follow-graph subset (follow/subscription);
   * - `webflix` — EMPTY: the store never re-labels imported source-native
   *   records as WebFlix-ranked content (the WebFlix feed is the
   *   Recommendation OS's — the mode-truth law).
   */
  async readFeed(profileId: string, mode: FeedReadMode): Promise<readonly PersistedFeedRecord[]> {
    if (mode === "webflix") return [];
    try {
      const relationshipFilter =
        mode === "following" ? `AND relationship = ANY($2::text[])` : "";
      const params: unknown[] = mode === "following" ? [profileId, [...FOLLOWING_RELATIONSHIPS]] : [profileId];
      const rows = await this.db.query<RecordSqlRow>(
        `SELECT * FROM feed_records
           WHERE profile_id = $1 ${relationshipFilter}
           ORDER BY source_ref ASC NULLS FIRST, relationship ASC, source_order ASC, imported_at ASC`,
        params,
      );
      return rows.map(mapRecord);
    } catch (thrown) {
      throw classifyDriverError(thrown, "readFeed");
    }
  }

  /** The records inside a scope (the reconciliation engine's existing-side input). */
  async readRecordsInScope(scope: FeedRecordScope): Promise<readonly PersistedFeedRecord[]> {
    try {
      const clauses: string[] = ["profile_id = $1", "connector_id = $2"];
      const params: unknown[] = [scope.profileId, scope.connectorId];
      if (scope.relationships !== undefined) {
        clauses.push(`relationship = ANY($${params.length + 1}::text[])`);
        params.push([...scope.relationships]);
      }
      if (scope.sourceRef !== undefined) {
        if (scope.sourceRef === "") {
          // The domain key's canonical "no container" component: follows
          // (the subscription graph itself) are stored with source_ref NULL.
          clauses.push(`source_ref IS NULL`);
        } else {
          params.push(scope.sourceRef);
          clauses.push(`source_ref = $${params.length}`);
        }
      }
      const rows = await this.db.query<RecordSqlRow>(
        `SELECT * FROM feed_records WHERE ${clauses.join(" AND ")}
           ORDER BY source_ref ASC NULLS FIRST, relationship ASC, source_order ASC`,
        params,
      );
      return rows.map(mapRecord);
    } catch (thrown) {
      throw classifyDriverError(thrown, "readRecordsInScope");
    }
  }

  // -------------------------------------------------------------------------
  // Reconciliation application
  // -------------------------------------------------------------------------

  /**
   * Apply one reconciliation plan: upsert the add/update rows (idempotent
   * by import key), delete the removed rows, and stamp the import with the
   * outcome. The counts come from the CALLER's plan (the engine's honest
   * diff) — the store verifies nothing about them beyond applying the rows;
   * the report is the engine + this application's joint truth.
   */
  async applyReconciliation(
    importId: string,
    input: {
      upserts: readonly FeedRecordWriteInput[];
      removeKeys: readonly string[];
      counts: { added: number; updated: number; removed: number; kept: number };
      syncState: FeedSyncState;
      capturedAt: string;
    },
  ): Promise<ApplyReconciliationOutcome> {
    const existing = await this.getImport(importId);
    if (existing === null) {
      throw new PersistenceError(
        "invalid-input",
        `applyReconciliation: feed import '${importId}' is unknown`,
        { operation: "applyReconciliation" },
      );
    }
    const appliedAt = this.nowIso();
    try {
      const updated = await this.db.begin(async (tx) => {
        for (const row of input.upserts) {
          await upsertRecordRow(tx, {
            id: `${FEED_RECORD_ID_PREFIX}${this.ids.next()}`,
            userId: existing.userId,
            profileId: existing.profileId,
            importId,
            importKey: row.key,
            connectorId: existing.connectorId,
            importMethod: existing.method,
            relationship: row.relationship,
            sourceRef: row.sourceRef,
            externalRef: row.externalRef,
            sourceOrder: row.sourceOrder,
            capturedAt: row.capturedAt,
            syncState: input.syncState,
            importedAt: appliedAt,
            sourceUpdatedAt: row.sourceUpdatedAt,
            title: row.title,
            metadata: row.metadata,
            entertainmentItemId: row.entertainmentItemId,
          });
        }
        for (const key of input.removeKeys) {
          await tx.query(
            `DELETE FROM feed_records WHERE profile_id = $1 AND import_key = $2`,
            [existing.profileId, key],
          );
        }
        const total = await tx.query<{ count: unknown }>(
          `SELECT COUNT(*)::int AS count FROM feed_records WHERE profile_id = $1 AND connector_id = $2`,
          [existing.profileId, existing.connectorId],
        );
        const rows = await tx.query<ImportSqlRow>(
          `UPDATE feed_imports
             SET status = 'complete', completed_at = $2, last_synced_at = $3,
                 sync_state = $4, item_count = $5
           WHERE id = $1
           RETURNING *`,
          [
            importId,
            appliedAt,
            input.capturedAt,
            input.syncState,
            Number((total[0] as { count: number } | undefined)?.count ?? 0),
          ],
        );
        const row = rows[0];
        if (row === undefined) throw new Error("applyReconciliation: no row returned");
        return mapImport(row);
      });
      return {
        import: updated,
        added: input.counts.added,
        updated: input.counts.updated,
        removed: input.counts.removed,
        kept: input.counts.kept,
      };
    } catch (thrown) {
      throw classifyDriverError(thrown, "applyReconciliation");
    }
  }

  // -------------------------------------------------------------------------
  // Honest state transitions (survival law)
  // -------------------------------------------------------------------------

  /**
   * Fold a sync outcome onto the import and its records — the honest
   * state machine (never a deletion):
   * - `reauthorization-required` also moves the import STATUS so the
   *   surface shows the recovery path;
   * - `stale`/`degraded` record the error and keep every record;
   * - `live`/`snapshot` clear the error and stamp `last_synced_at`.
   */
  async markSyncOutcome(
    importId: string,
    input: {
      syncState: FeedSyncState;
      error?: string;
      at?: string;
    },
  ): Promise<PersistedFeedImport> {
    const existing = await this.getImport(importId);
    if (existing === null) {
      throw new PersistenceError(
        "invalid-input",
        `markSyncOutcome: feed import '${importId}' is unknown`,
        { operation: "markSyncOutcome" },
      );
    }
    const at = input.at ?? this.nowIso();
    const status: PersistedFeedImport["status"] =
      input.syncState === "reauthorization-required" ? "reauthorization-required" : existing.status;
    const stampsSynced = input.syncState === "live" || input.syncState === "snapshot";
    try {
      const updated = await this.db.begin(async (tx) => {
        const rows = stampsSynced
          ? await tx.query<ImportSqlRow>(
              `UPDATE feed_imports
                 SET sync_state = $2, status = $3, error = $4, last_synced_at = $5
               WHERE id = $1
               RETURNING *`,
              [importId, input.syncState, status, input.error ?? null, at],
            )
          : await tx.query<ImportSqlRow>(
              `UPDATE feed_imports
                 SET sync_state = $2, status = $3, error = $4
               WHERE id = $1
               RETURNING *`,
              [importId, input.syncState, status, input.error ?? null],
            );
        const row = rows[0];
        if (row === undefined) throw new Error("markSyncOutcome: no row returned");
        await tx.query(
          `UPDATE feed_records SET sync_state = $2 WHERE import_id = $1`,
          [importId, input.syncState],
        );
        return mapImport(row);
      });
      return updated;
    } catch (thrown) {
      throw classifyDriverError(thrown, "markSyncOutcome");
    }
  }

  // -------------------------------------------------------------------------
  // The explicit deletion path
  // -------------------------------------------------------------------------

  /**
   * DELETE imported feed records — the EXPLICIT user-deletion path ONLY
   * (J33: "disconnect/re-authorize without deleting WebFlix-local
   * library/history"; a disconnect marks state, it never calls this).
   * Returns the number of rows removed. Never touches any other table.
   */
  async deleteFeedRecords(
    profileId: string,
    scope: { connectorId?: string; importId?: string },
  ): Promise<number> {
    const clauses: string[] = ["profile_id = $1"];
    const params: unknown[] = [profileId];
    if (scope.connectorId !== undefined) {
      params.push(scope.connectorId);
      clauses.push(`connector_id = $${params.length}`);
    }
    if (scope.importId !== undefined) {
      params.push(scope.importId);
      clauses.push(`import_id = $${params.length}`);
    }
    try {
      const rows = await this.db.query<{ count: unknown }>(
        `WITH deleted AS (DELETE FROM feed_records WHERE ${clauses.join(" AND ")} RETURNING 1)
         SELECT COUNT(*)::int AS count FROM deleted`,
        params,
      );
      return Number((rows[0] as { count: number } | undefined)?.count ?? 0);
    } catch (thrown) {
      throw classifyDriverError(thrown, "deleteFeedRecords");
    }
  }
}

// ---------------------------------------------------------------------------
// The idempotent upsert (shared by confirm + apply)
// ---------------------------------------------------------------------------

interface RecordUpsertRow {
  id: string;
  userId: string;
  profileId: string;
  importId: string;
  importKey: string;
  connectorId: string;
  importMethod: FeedImportMethod;
  relationship: FeedRelationship;
  /** Widened for exactOptionalPropertyTypes callers; `?? null` at the SQL seam. */
  sourceRef?: string | undefined;
  externalRef: string;
  sourceOrder: number;
  capturedAt: string;
  syncState: FeedSyncState;
  importedAt: string;
  sourceUpdatedAt?: string | undefined;
  title?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  entertainmentItemId: string;
}

/**
 * Upsert one feed record by (profile_id, import_key) — THE idempotent
 * import law made structural. The EXISTING row's identity (`id`) is kept on
 * conflict (stable record identity across re-imports); provenance refreshes
 * to the newest capture (captured_at, source_order, sync_state,
 * source_updated_at, title, metadata, import_method, import_id).
 */
async function upsertRecordRow(tx: SqlClient, row: RecordUpsertRow): Promise<void> {
  await tx.query(
    `INSERT INTO feed_records
       (id, user_id, profile_id, import_id, import_key, connector_id, import_method,
        relationship, source_ref, external_ref, source_order, captured_at, sync_state,
        imported_at, source_updated_at, title, metadata, entertainment_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
     ON CONFLICT (profile_id, import_key) DO UPDATE SET
       import_id = EXCLUDED.import_id,
       import_method = EXCLUDED.import_method,
       source_ref = EXCLUDED.source_ref,
       source_order = EXCLUDED.source_order,
       captured_at = EXCLUDED.captured_at,
       sync_state = EXCLUDED.sync_state,
       source_updated_at = EXCLUDED.source_updated_at,
       title = EXCLUDED.title,
       metadata = EXCLUDED.metadata,
       entertainment_item_id = EXCLUDED.entertainment_item_id`,
    [
      row.id,
      row.userId,
      row.profileId,
      row.importId,
      row.importKey,
      row.connectorId,
      row.importMethod,
      row.relationship,
      row.sourceRef ?? null,
      row.externalRef,
      row.sourceOrder,
      row.capturedAt,
      row.syncState,
      row.importedAt,
      row.sourceUpdatedAt ?? null,
      row.title ?? null,
      JSON.stringify(row.metadata ?? {}),
      row.entertainmentItemId,
    ],
  );
}
