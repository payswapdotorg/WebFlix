/**
 * @wfx/app-api — the intelligence READ host (R26-W4).
 *
 * The service-side read composition the `/experience/intelligence`
 * route binds: the TWO read modes of the frozen wire contract
 * (`@wfx/model-fabric`'s `read-transport.ts` — ONE contract, never
 * forked), answered over the derived-artifact store:
 *
 * - `searchByMeaning(query)` — search by meaning + moment search over
 *   every DERIVED artifact set (the store's derived set joined with the
 *   catalog's realization rows);
 * - `itemArtifacts(externalRef)` — one item's derived artifacts + the
 *   legal-audio truth.
 *
 * EVERY answer is the typed `IntelligenceReadOutcome` — served reads
 * carry real derived artifacts with their honest provenance; not-served
 * answers carry the honest reason (the per-item no-derived-artifacts
 * truth, including the pipeline's recorded failure sentence). Never a
 * fabricated result, never an approximation (the R26-W1 transport law
 * this lane serves).
 *
 * THE SEARCH SEMANTICS mirror the dev-fixture transport's reference
 * (apps/web/src/host/intelligence-fixture-transport.ts — the read
 * semantics W1 froze for the lane; dev and service must NOT drift):
 * - meaning rows require BOTH embeddings (the R23-H search-by-meaning
 *   prerequisite — `transcript-text-embedding` +
 *   `semantic-video-embedding`), scored by the honest scorer over the
 *   index entries;
 * - moment rows require transcript + searchable moments, scored over
 *   the moment's own text (the honest lexical ground);
 * - `meaningSearchAvailable` carries the prerequisite truth (whether
 *   ANY indexed title's meaning-search prerequisites are met);
 * - the provenance is every matched item's build provenance (the
 *   contributing models — R23-H's ownership law, never an authority).
 *
 * Determinism: no clock, no randomness — the reads are pure functions
 * of the store + catalog state.
 */

import type {
  IntelligenceItemRead,
  IntelligenceReadOutcome,
  IntelligenceSearchRead,
  IntelligenceSearchResultRow,
  IntelligenceMomentResultRow,
  ArtifactModelMetadata,
} from "@wfx/model-fabric";
import {
  PostgresMediaIntelligenceStore,
  PersistenceError,
  classifyDriverError,
  type DbClient,
} from "@wfx/persistence";

import { EXPERIENCE_SERVICE_CONNECTOR_ID } from "./fan-out";

// ---------------------------------------------------------------------------
// The catalog join (the derived set's realization rows)
// ---------------------------------------------------------------------------

/** One derived item's catalog join (what the search rows carry). */
interface DerivedItemJoin {
  readonly itemId: string;
  readonly externalRef: string;
  readonly connectorId: string;
  readonly title: string;
}

interface JoinRow {
  item_id: string;
  external_ref: string;
  connector_id: string;
  canonical_title: string | null;
}

// ---------------------------------------------------------------------------
// The honest scorer (the fixture transport's reference semantics)
// ---------------------------------------------------------------------------

/** The stopword set the scorer drops (the fixture reference's set). */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or",
  "is", "are", "was", "were", "it", "its", "this", "that", "with", "about",
  "where", "when", "how", "what", "show", "me", "part", "find",
]);

/** Tokenize text for the scorer (lowercased terms). */
function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * The coverage scorer — the fraction of query terms present in the entry
 * text (prefix-tolerant), the same deterministic math the dev-fixture
 * transport scores its index with (the reference semantics; dev and
 * service must not drift).
 */
function coverageScore(queryTerms: readonly string[], text: string): number {
  if (queryTerms.length === 0) return 0;
  const textTokens = new Set(tokenize(text));
  let matched = 0;
  for (const term of queryTerms) {
    for (const token of textTokens) {
      if (token === term || token.startsWith(term) || term.startsWith(token)) {
        matched += 1;
        break;
      }
    }
  }
  return matched / queryTerms.length;
}

/** The minimum coverage a result needs (the reference threshold). */
const MATCH_THRESHOLD = 0.34;

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

/** Constructor options — every seam injectable, all deterministic in tests. */
export interface IntelligenceHostOptions {
  readonly db: DbClient;
  readonly store: PostgresMediaIntelligenceStore;
}

/**
 * The intelligence read host: answers the wire contract's two read modes
 * over the derived-artifact store. The ROUTE is a thin binding over
 * this host (params + identity + the typed HTTP envelope).
 */
export class IntelligenceHost {
  private readonly db: DbClient;
  private readonly store: PostgresMediaIntelligenceStore;

  constructor(options: IntelligenceHostOptions) {
    this.db = options.db;
    this.store = options.store;
  }

  /**
   * Search by meaning + moments over the derived index (the `?q=` read).
   * The read ALWAYS serves (a typed served envelope over the store's
   * truth — the honest arrays when nothing matches, the honest
   * prerequisite flag when no indexed title meets the meaning-search
   * prerequisites).
   */
  async searchByMeaning(query: string): Promise<IntelligenceReadOutcome<IntelligenceSearchRead>> {
    const derived = await this.store.derivedSet();
    const joins = await this.derivedJoins(derived.map((row) => row.itemId));
    const byItemId = new Map(joins.map((join) => [join.itemId, join]));

    const queryTerms = tokenize(query);
    const meaning: IntelligenceSearchResultRow[] = [];
    const moments: IntelligenceMomentResultRow[] = [];
    const provenance: ArtifactModelMetadata[] = [];
    let meaningSearchAvailable = false;

    for (const row of derived) {
      const join = byItemId.get(row.itemId);
      if (join === undefined) continue; // the item left the catalog — not indexed
      const artifacts = row.artifacts;
      const index = artifacts.semanticIndex;
      if (index === undefined || index.entries.length === 0) continue;

      // The R23-H prerequisite truth for THIS item (the reference gates):
      // search-by-meaning needs BOTH embeddings; moment search needs
      // transcript + moments.
      const hasBothEmbeddings =
        artifacts.videoEmbedding !== undefined && artifacts.textEmbedding !== undefined;
      const hasMoments =
        artifacts.transcript !== undefined && artifacts.searchableMoments !== undefined;

      if (hasBothEmbeddings) {
        meaningSearchAvailable = true;
        let best: { text: string; score: number } | null = null;
        for (const entry of index.entries) {
          const score = coverageScore(queryTerms, entry.text);
          if (score >= MATCH_THRESHOLD && (best === null || score > best.score)) {
            best = { text: entry.text, score };
          }
        }
        if (best !== null) {
          meaning.push({
            itemId: row.itemId,
            connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
            externalRef: join.externalRef,
            title: join.title,
            matchedText: best.text,
            score: Math.round(best.score * 100) / 100,
          });
        }
      }

      if (hasMoments) {
        for (const moment of artifacts.searchableMoments.moments) {
          const descriptionScore = coverageScore(queryTerms, moment.description);
          const matchedScore =
            moment.matchedText !== undefined ? coverageScore(queryTerms, moment.matchedText) : 0;
          const score = Math.max(descriptionScore, matchedScore);
          if (score >= MATCH_THRESHOLD) {
            moments.push({
              itemId: row.itemId,
              connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID,
              externalRef: join.externalRef,
              title: join.title,
              startMs: moment.startMs,
              endMs: moment.endMs,
              description: moment.description,
              matchedText: moment.matchedText ?? null,
              score: Math.round(score * 100) / 100,
            });
          }
        }
      }

      if (meaning.some((entry) => entry.itemId === row.itemId) ||
          moments.some((entry) => entry.itemId === row.itemId)) {
        for (const sentence of index.buildProvenance) {
          if (
            !provenance.some(
              (existing) => existing.modelId === sentence.modelId && existing.stage === sentence.stage,
            )
          ) {
            provenance.push(sentence);
          }
        }
      }
    }

    meaning.sort((a, b) => b.score - a.score);
    moments.sort((a, b) => b.score - a.score || a.startMs - b.startMs);
    return {
      kind: "served",
      value: { meaning, moments, provenance, meaningSearchAvailable },
    };
  }

  /**
   * One item's derived artifacts + legal-audio truth (the `?item=` read).
   * The honest lifecycle answers:
   * - no store row (never derived) → the typed no-derived-artifacts truth;
   * - a `derivation-failed` row → the typed no-derived-artifacts truth
   *   carrying the pipeline's recorded honest failure sentence;
   * - a derived row → the served read (the artifact set verbatim —
   *   partial sets stay honestly partial).
   */
  async itemArtifacts(externalRef: string): Promise<IntelligenceReadOutcome<IntelligenceItemRead>> {
    const itemId = await this.itemIdOfRef(externalRef);
    if (itemId === null) {
      return noDerivedArtifacts(
        "This title has no derived intelligence on this service yet — transcript, chapters, and moment search stay off honestly rather than approximated.",
        `The derived-artifact pipeline (R23-F) has not produced an artifact set for external ref '${externalRef}' — the reference has no catalog realization here.`,
      );
    }
    const row = await this.store.artifactsOf(itemId);
    if (row === null) {
      return noDerivedArtifacts(
        "This title has no derived intelligence on this service yet — transcript, chapters, and moment search stay off honestly rather than approximated.",
        `The derived-artifact pipeline (R23-F) has not produced an artifact set for this item yet (derivation is bounded per boot — WFX_INTELLIGENCE_DERIVATION_LIMIT).`,
      );
    }
    if (row.derivationStatus === "derivation-failed") {
      return noDerivedArtifacts(
        `This title's derivation did not complete: ${row.derivationDetail}`,
        `The derived-artifact pipeline recorded an honest failure for this item — the artifact set was rejected (never coerced); the recorded stage truths are in the service diagnostics.`,
      );
    }
    return {
      kind: "served",
      value: {
        artifacts: row.artifacts,
        audioStreamLegallyAvailable: row.audioStreamLegallyAvailable,
      },
    };
  }

  // --- internals --------------------------------------------------------------

  /** Resolve a store row set's catalog joins (deterministic order). */
  private async derivedJoins(itemIds: readonly string[]): Promise<readonly DerivedItemJoin[]> {
    if (itemIds.length === 0) return [];
    const params = itemIds.map((_, index) => `$${index + 1}`).join(", ");
    let rows: JoinRow[];
    try {
      rows = await this.db.query<JoinRow>(
        `SELECT i.id AS item_id, r.external_ref, r.connector_id, i.canonical_title
           FROM entertainment_items i
           JOIN source_realizations r ON r.entertainment_item_id = i.id
          WHERE i.id IN (${params})
          ORDER BY i.id, r.connector_id`,
        [...itemIds],
      );
    } catch (thrown) {
      throw classifyForIntelligence(thrown, "intelligence.derivedJoins");
    }
    const seen = new Set<string>();
    const joins: DerivedItemJoin[] = [];
    for (const row of rows) {
      if (seen.has(row.item_id)) continue; // one realization per item (first wins)
      seen.add(row.item_id);
      joins.push({
        itemId: row.item_id,
        externalRef: row.external_ref,
        connectorId: row.connector_id,
        title: row.canonical_title ?? row.external_ref,
      });
    }
    return joins;
  }

  /** The canonical item id of one external ref (null when no realization). */
  private async itemIdOfRef(externalRef: string): Promise<string | null> {
    let rows: Array<{ item_id: string }>;
    try {
      rows = await this.db.query<{ item_id: string }>(
        `SELECT r.entertainment_item_id AS item_id
           FROM source_realizations r
          WHERE r.external_ref = $1
          ORDER BY r.connector_id
          LIMIT 1`,
        [externalRef],
      );
    } catch (thrown) {
      throw classifyForIntelligence(thrown, "intelligence.itemIdOfRef");
    }
    return rows[0]?.item_id ?? null;
  }
}

/** Classify a driver error for the intelligence reads (already-classified errors pass through). */
function classifyForIntelligence(thrown: unknown, operation: string): unknown {
  if (thrown instanceof PersistenceError) return thrown;
  return classifyDriverError(thrown, operation);
}

/** The typed no-derived-artifacts not-served outcome (the honest per-item truth). */
function noDerivedArtifacts(
  detail: string,
  dependency: string,
): IntelligenceReadOutcome<never> {
  return {
    kind: "not-served",
    reason: "no-derived-artifacts",
    detail,
    dependency,
    nextAction: {
      label: "Title search and the AI action tray still work",
      href: "/search",
      detail:
        "Search by title serves every item; per-title AI actions (transcription, translation) run through the AI tray on the item page.",
    },
  };
}
