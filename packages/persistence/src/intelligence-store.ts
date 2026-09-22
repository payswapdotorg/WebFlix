/**
 * @wfx/persistence — the media-intelligence derived-artifact store (R26-W4).
 *
 * Migration 0014's `media_intelligence_artifacts` table: the durable side
 * of the R23-F artifact contracts (`@wfx/model-fabric`'s
 * `MediaIntelligenceArtifacts` — the typed shapes ride verbatim as jsonb;
 * the WRITER validates against the frozen shapes before saving, so drift
 * is rejected upstream and never coerced here).
 *
 * ONE row per canonical item id, carrying:
 * - the artifact set (every present artifact with its honest provenance;
 *   absent artifacts are ABSENT — never fabricated placeholders);
 * - the R23-G legal-audio truth (whether an audio stream is lawfully
 *   reachable for the item — fail-closed, recorded by the pipeline);
 * - the honest derivation lifecycle: `derived` (an artifact set exists —
 *   partial sets are HONEST partial, never padded to fake completeness)
 *   or `derivation-failed` (the pipeline ran and recorded its honest
 *   failure sentence);
 * - the per-stage outcome record (the prerequisite truth: which stages
 *   derived, which were skipped for missing prerequisites, which failed);
 * - the derivation timestamps.
 *
 * LAWS:
 * - HONEST LIFECYCLE: a read for an item with no row answers null (never
 *   derived yet); a `derivation-failed` row answers ITS truth (the
 *   recorded sentence) — the caller maps both to the typed not-served
 *   `no-derived-artifacts` outcome, never a fabricated empty set presented
 *   as derived;
 * - STRUCTURAL GUARDS at the boundary: the artifacts' own `itemId` must
 *   equal the row key (the frozen validation's same-item law) — a
 *   mismatch is the typed `invalid-input` failure, never a silent fix;
 * - deep shape validation belongs to the WRITER (the derivation pipeline
 *   validates with `@wfx/model-fabric`'s own validator before saving) —
 *   this store persists, it does not re-derive contract semantics;
 * - SQL failures are classified (`classifyDriverError`) — raw driver
 *   errors never escape.
 *
 * Determinism: no clock reads beyond the injected `Clock` seam; the
 * timestamps come from the caller's composition root.
 */

import type { MediaIntelligenceArtifacts } from "@wfx/model-fabric";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock } from "@wfx/experience";

// ---------------------------------------------------------------------------
// The persisted shapes
// ---------------------------------------------------------------------------

/**
 * One pipeline stage's honest outcome record (the prerequisite truth the
 * route's answers derive from). Stages are the frozen R23-F chain names;
 * a stage that could not run says WHY — never a silent skip.
 */
export interface IntelligenceStageOutcomeRecord {
  /** The frozen pipeline stage this outcome belongs to. */
  readonly stage: string;
  /** What happened: derived / skipped for a missing prerequisite / failed. */
  readonly outcome: "derived" | "skipped-prerequisite-missing" | "failed";
  /** The one-sentence truth (the honest reason for non-derived stages). */
  readonly detail: string;
  /** The model-fabric provider id the stage routed to, when it ran. */
  readonly modelId?: string;
}

/** The lifecycle truth of one item's derivation. */
export type IntelligenceDerivationStatus = "derived" | "derivation-failed";

/** One persisted derived-artifact row (the store's read model). */
export interface PersistedIntelligenceArtifacts {
  /** The canonical item the artifacts belong to (the row key). */
  readonly itemId: string;
  /** The R23-F artifact set (present artifacts with honest provenance). */
  readonly artifacts: MediaIntelligenceArtifacts;
  /** The R23-G legal-audio truth (fail-closed). */
  readonly audioStreamLegallyAvailable: boolean;
  /** The lifecycle truth. */
  readonly derivationStatus: IntelligenceDerivationStatus;
  /** The one-sentence derivation truth (the honest failure when failed). */
  readonly derivationDetail: string;
  /** The per-stage outcome record (the prerequisite truth). */
  readonly stageOutcomes: readonly IntelligenceStageOutcomeRecord[];
  /** When the artifact set was derived (full ISO 8601, UTC). */
  readonly derivedAt: string;
  /** When the row was last written. */
  readonly updatedAt: string;
}

/** Constructor dependencies — all injected, all deterministic in tests. */
export interface MediaIntelligenceStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
}

interface ArtifactSqlRow {
  item_id: string;
  artifacts: unknown;
  audio_stream_legally_available: boolean;
  derivation_status: string;
  derivation_detail: string;
  stage_outcomes: unknown;
  derived_at: unknown;
  updated_at: unknown;
}

/** Structural check on a claimed stage-outcome record (drift is dropped, logged upstream). */
function mapStageOutcomes(raw: unknown): readonly IntelligenceStageOutcomeRecord[] {
  if (!Array.isArray(raw)) return [];
  const outcomes: IntelligenceStageOutcomeRecord[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.stage !== "string" || record.stage.length === 0) continue;
    if (
      record.outcome !== "derived" &&
      record.outcome !== "skipped-prerequisite-missing" &&
      record.outcome !== "failed"
    ) {
      continue;
    }
    if (typeof record.detail !== "string") continue;
    outcomes.push({
      stage: record.stage,
      outcome: record.outcome,
      detail: record.detail,
      ...(typeof record.modelId === "string" && record.modelId.length > 0
        ? { modelId: record.modelId }
        : {}),
    });
  }
  return outcomes;
}

function mapRow(row: ArtifactSqlRow): PersistedIntelligenceArtifacts {
  return {
    itemId: row.item_id,
    artifacts: row.artifacts as MediaIntelligenceArtifacts,
    audioStreamLegallyAvailable: row.audio_stream_legally_available,
    derivationStatus:
      row.derivation_status === "derivation-failed" ? "derivation-failed" : "derived",
    derivationDetail: row.derivation_detail,
    stageOutcomes: mapStageOutcomes(row.stage_outcomes),
    derivedAt: String(row.derived_at),
    updatedAt: String(row.updated_at),
  };
}

/** The input for saving a derived artifact set. */
export interface SaveDerivedArtifactsInput {
  readonly itemId: string;
  readonly artifacts: MediaIntelligenceArtifacts;
  readonly audioStreamLegallyAvailable: boolean;
  /** The per-stage outcome record (the prerequisite truth). */
  readonly stageOutcomes: readonly IntelligenceStageOutcomeRecord[];
  /** The one-sentence derivation truth (default: the honest derived sentence). */
  readonly derivationDetail?: string;
}

/** The input for recording an honest failed derivation. */
export interface RecordFailedDerivationInput {
  readonly itemId: string;
  /** The honest one-sentence failure truth (rendered by the typed not-served answer). */
  readonly detail: string;
  /** The per-stage outcome record (what ran, what did not, and why). */
  readonly stageOutcomes: readonly IntelligenceStageOutcomeRecord[];
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * The derived-artifact store: persistence for the R23-F artifact sets
 * keyed by canonical item id, with the honest lifecycle truths. The
 * EXPERIENCE API's intelligence route reads through this store; the
 * derivation pipeline writes through it.
 */
export class PostgresMediaIntelligenceStore {
  private readonly db: DbClient;
  private readonly clock: Clock;

  constructor(options: MediaIntelligenceStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
  }

  /**
   * Save (UPSERT) one item's derived artifact set. The artifacts' own
   * `itemId` MUST equal the row key (the frozen same-item law) — a
   * mismatch is the typed `invalid-input` failure, never a silent fix.
   * Re-derivation replaces the set while keeping the row key (the
   * catalog-connector upsert law).
   */
  async saveDerivedArtifacts(input: SaveDerivedArtifactsInput): Promise<PersistedIntelligenceArtifacts> {
    if (typeof input.itemId !== "string" || input.itemId.length === 0) {
      throw new PersistenceError(
        "invalid-input",
        "itemId: expected a non-empty canonical item id",
        { operation: "intelligence.saveDerivedArtifacts" },
      );
    }
    if (
      typeof input.artifacts !== "object" ||
      input.artifacts === null ||
      input.artifacts.itemId !== input.itemId
    ) {
      throw new PersistenceError(
        "invalid-input",
        `artifacts.itemId: expected '${input.itemId}' (the same canonical item as the row key)`,
        { operation: "intelligence.saveDerivedArtifacts" },
      );
    }
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<ArtifactSqlRow>(
        `INSERT INTO media_intelligence_artifacts
           (item_id, artifacts, audio_stream_legally_available, derivation_status,
            derivation_detail, stage_outcomes, derived_at, updated_at)
         VALUES ($1, $2::jsonb, $3, 'derived', $4, $5::jsonb, $6, $6)
         ON CONFLICT (item_id) DO UPDATE SET
           artifacts = EXCLUDED.artifacts,
           audio_stream_legally_available = EXCLUDED.audio_stream_legally_available,
           derivation_status = 'derived',
           derivation_detail = EXCLUDED.derivation_detail,
           stage_outcomes = EXCLUDED.stage_outcomes,
           derived_at = EXCLUDED.derived_at,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.itemId,
          JSON.stringify(input.artifacts),
          input.audioStreamLegallyAvailable,
          input.derivationDetail ??
            "The derivation pipeline produced this artifact set (partial sets stay honestly partial).",
          JSON.stringify(input.stageOutcomes),
          toIsoTimestamp(nowIso),
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("saveDerivedArtifacts: no row returned");
      }
      return mapRow(row);
    } catch (thrown) {
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "intelligence.saveDerivedArtifacts");
    }
  }

  /**
   * Record one item's HONEST failed derivation: the pipeline ran, a
   * prerequisite was unavailable, and the typed truth is persisted — the
   * item's reads answer the recorded sentence, never a fake success. The
   * artifact set stays the honest empty set (absent artifacts absent).
   */
  async recordFailedDerivation(
    input: RecordFailedDerivationInput,
  ): Promise<PersistedIntelligenceArtifacts> {
    if (typeof input.itemId !== "string" || input.itemId.length === 0) {
      throw new PersistenceError(
        "invalid-input",
        "itemId: expected a non-empty canonical item id",
        { operation: "intelligence.recordFailedDerivation" },
      );
    }
    if (typeof input.detail !== "string" || input.detail.length === 0) {
      throw new PersistenceError(
        "invalid-input",
        "detail: expected a non-empty honest failure sentence",
        { operation: "intelligence.recordFailedDerivation" },
      );
    }
    const nowIso = epochMsToIso(this.clock.now());
    const emptySet: MediaIntelligenceArtifacts = { itemId: input.itemId };
    try {
      const rows = await this.db.query<ArtifactSqlRow>(
        `INSERT INTO media_intelligence_artifacts
           (item_id, artifacts, audio_stream_legally_available, derivation_status,
            derivation_detail, stage_outcomes, derived_at, updated_at)
         VALUES ($1, $2::jsonb, false, 'derivation-failed', $3, $4::jsonb, $5, $5)
         ON CONFLICT (item_id) DO UPDATE SET
           artifacts = EXCLUDED.artifacts,
           audio_stream_legally_available = false,
           derivation_status = 'derivation-failed',
           derivation_detail = EXCLUDED.derivation_detail,
           stage_outcomes = EXCLUDED.stage_outcomes,
           derived_at = EXCLUDED.derived_at,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.itemId,
          JSON.stringify(emptySet),
          input.detail,
          JSON.stringify(input.stageOutcomes),
          toIsoTimestamp(nowIso),
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("recordFailedDerivation: no row returned");
      }
      return mapRow(row);
    } catch (thrown) {
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "intelligence.recordFailedDerivation");
    }
  }

  /**
   * One item's persisted derivation row (null when the pipeline has not
   * produced one yet — the honest per-item absence).
   */
  async artifactsOf(itemId: string): Promise<PersistedIntelligenceArtifacts | null> {
    if (typeof itemId !== "string" || itemId.length === 0) return null;
    let rows: ArtifactSqlRow[];
    try {
      rows = await this.db.query<ArtifactSqlRow>(
        `SELECT * FROM media_intelligence_artifacts WHERE item_id = $1`,
        [itemId],
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "intelligence.artifactsOf");
    }
    const row = rows[0];
    return row === undefined ? null : mapRow(row);
  }

  /**
   * Every DERIVED row (the semantic index the search read serves over) —
   * `derivation-failed` rows are excluded (they are per-item truths, not
   * index content). Deterministic (item_id) order.
   */
  async derivedSet(): Promise<readonly PersistedIntelligenceArtifacts[]> {
    let rows: ArtifactSqlRow[];
    try {
      rows = await this.db.query<ArtifactSqlRow>(
        `SELECT * FROM media_intelligence_artifacts
          WHERE derivation_status = 'derived'
          ORDER BY item_id`,
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "intelligence.derivedSet");
    }
    return rows.map(mapRow);
  }
}
