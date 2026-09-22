/**
 * @wfx/app-web — the DEV-FIXTURE intelligence read transport (R26-W1).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * The fixture boot's {@link IntelligenceReadTransport} binding: the
 * deterministic dev semantic index (the `MediaIntelligenceArtifacts`
 * fixture rows) + the deterministic lexical scorer that is the honest
 * double of the embedding-space nearest-neighbor the production
 * semantic index serves (labeled by provenance — never presented as a
 * model result). This module exists ONLY behind the fixtures-mode host
 * binding (`host/intelligence.ts`); in service mode NOTHING here runs
 * (a fixture is never silently presented as production capability —
 * invariant 10).
 *
 * R26-W1's structural fix: the scoring + row access that used to live
 * inline in `host/intelligence.ts` behind a `host.mode === "fixtures"`
 * gate now lives behind the CANONICAL TRANSPORT CONTRACT
 * (`@wfx/model-fabric`'s `IntelligenceReadTransport`) — the host reads
 * become mode-agnostic (they bind whatever transport the boot wired).
 */

import type {
  IntelligenceItemRead,
  IntelligenceReadOutcome,
  IntelligenceReadTransport,
  IntelligenceSearchRead,
  IntelligenceTransportReadiness,
} from "@wfx/model-fabric";

import {
  INTELLIGENCE_FIXTURE_ROWS,
  intelligenceFixtureOf,
} from "./intelligence-fixtures";

// ---------------------------------------------------------------------------
// The deterministic lexical scorer (the fixture double — unchanged math)
// ---------------------------------------------------------------------------

/** The stopword set the deterministic scorer drops (fixture-only scoring). */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or",
  "is", "are", "was", "were", "it", "its", "this", "that", "with", "about",
  "where", "when", "how", "what", "show", "me", "part", "find",
]);

/** Tokenize text for the deterministic fixture scorer (lowercased terms). */
function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * The deterministic fixture scorer: the fraction of query terms present
 * in the entry text (coverage), a lexical double of the embedding-space
 * nearest-neighbor the production semantic index serves (honestly
 * labeled by the provenance — never presented as a model result).
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

/** The minimum coverage a result needs (an honest threshold, not a hair-trigger). */
const MATCH_THRESHOLD = 0.34;

// ---------------------------------------------------------------------------
// The fixture transport (the IntelligenceReadTransport binding)
// ---------------------------------------------------------------------------

/** The honest transport identity (rendered in diagnostics/provenance). */
export const FIXTURE_INTELLIGENCE_TRANSPORT_ID = "dev-fixture-index" as const;

/**
 * The fixture-boot intelligence read transport. `readiness` answers the
 * honest serving truth (a fixture says fixture — invariant 10); the
 * reads serve the fixture rows' typed artifact sets with the honest
 * per-item absence for rows that never joined.
 */
export function createFixtureIntelligenceReadTransport(
  options: {
    /**
     * The id-learning read the fixture transport needs: rows learn their
     * canonical ids through the runtime's registry (`learnIntelligenceIds`
     * — the per-boot join the fixture rows require). Called lazily by
     * every read (idempotent, cheap after the first).
     */
    readonly learnIds: () => Promise<void>;
  } = { learnIds: async () => {} },
): IntelligenceReadTransport {
  const readiness: IntelligenceTransportReadiness = {
    kind: "serving",
    transport: FIXTURE_INTELLIGENCE_TRANSPORT_ID,
    detail:
      "The deterministic dev fixture index (loudly a fixture — the dev-only boot's lexical double of the semantic index; never a production transport).",
  };

  const search = async (
    query: string,
  ): Promise<IntelligenceReadOutcome<IntelligenceSearchRead>> => {
    await options.learnIds();
    const queryTerms = tokenize(query);
    const meaning: IntelligenceSearchRead["meaning"][number][] = [];
    const moments: IntelligenceSearchRead["moments"][number][] = [];
    const provenance: IntelligenceSearchRead["provenance"][number][] = [];
    let meaningSearchAvailable = false;

    for (const row of INTELLIGENCE_FIXTURE_ROWS) {
      if (row.itemId === null) continue;
      const artifacts = row.artifacts;
      const index = artifacts.semanticIndex;
      if (index === undefined || index.entries.length === 0) continue;

      // The R23-H prerequisite truth for THIS item:
      // - search-by-meaning needs BOTH embeddings (video + text);
      // - moment-search needs transcript + moments.
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
            connectorId: row.connectorId ?? "",
            externalRef: row.externalRef,
            title: row.title,
            matchedText: best.text,
            score: Math.round(best.score * 100) / 100,
          });
        }
      }

      if (hasMoments) {
        for (const moment of artifacts.searchableMoments.moments) {
          const descriptionScore = coverageScore(queryTerms, moment.description);
          const matchedScore = moment.matchedText !== undefined
            ? coverageScore(queryTerms, moment.matchedText)
            : 0;
          const score = Math.max(descriptionScore, matchedScore);
          if (score >= MATCH_THRESHOLD) {
            moments.push({
              itemId: row.itemId,
              connectorId: row.connectorId ?? "",
              externalRef: row.externalRef,
              title: row.title,
              startMs: moment.startMs,
              endMs: moment.endMs,
              description: moment.description,
              matchedText: moment.matchedText ?? null,
              score: Math.round(score * 100) / 100,
            });
          }
        }
      }

      if (meaning.length > 0 || moments.some((m) => m.itemId === row.itemId)) {
        for (const sentence of index.buildProvenance) {
          if (
            !provenance.some(
              (p) => p.modelId === sentence.modelId && p.stage === sentence.stage,
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
  };

  const item = async (
    externalRef: string,
  ): Promise<IntelligenceReadOutcome<IntelligenceItemRead>> => {
    await options.learnIds();
    const row = intelligenceFixtureOf(externalRef);
    if (row === null || row.itemId === null) {
      return {
        kind: "not-served",
        reason: "no-derived-artifacts",
        detail:
          "This title has no derived intelligence on this host yet — transcript, chapters, and moment search stay off honestly rather than approximated.",
        dependency:
          "The derived-artifact pipeline (R23-F) has not produced an artifact set for this item on this host.",
      };
    }
    return {
      kind: "served",
      value: {
        artifacts: row.artifacts,
        audioStreamLegallyAvailable: row.audioStreamLegallyAvailable,
      },
    };
  };

  return {
    transportId: FIXTURE_INTELLIGENCE_TRANSPORT_ID,
    readiness: () => readiness,
    searchByMeaning: search,
    itemArtifacts: item,
  };
}
