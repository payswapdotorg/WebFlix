/**
 * @wfx/app-web — the media-intelligence read models (R23-F/G/H
 * consumption, Worker 2's lane).
 *
 * THE LAWS THIS MODULE BINDS:
 *
 * - R23-H's OWNERSHIP law: models generate SIGNALS; the Recommendation
 *   OS owns user policy and authorization. Every search-by-meaning /
 *   moment result carries its contributing models as PROVENANCE —
 *   never as an authority.
 * - R23-H's PREREQUISITE law: availability derives from the artifact
 *   set's HONEST coverage (`discoveryFeatureAvailability`) — a feature
 *   whose prerequisites are missing answers the typed
 *   `prerequisites-missing` state naming exactly what is absent, never
 *   a silent downgrade.
 * - R23-G's ROUTE law: the live-ASR route decision is
 *   `routeAsr`/`liveAsrReadiness` verbatim (the legal-audio gate; R2T2
 *   for live, MOSS/Whisper for batch, the provider policy choice when
 *   set; batch models are never silently substituted into the live
 *   lane).
 * - THE ANONYMOUS AI BOUNDARY (R23-K): these reads are LOW-COST/LOCAL —
 *   they serve anonymous viewers with typed states, never a login wall.
 *
 * DATA TRUTH: the artifact sets are the DEV fixtures feed (loudly
 * badged) in fixtures mode; SERVICE mode has no transport-exposed
 * intelligence data yet, so every read answers the honest empty state.
 */

import {
  discoveryFeatureAvailabilityView,
  liveAsrReadiness,
  routeAsr,
} from "@wfx/model-fabric";
import type { MediaIntelligenceArtifacts } from "@wfx/model-fabric";
import type { DiscoveryFeatureKind } from "@wfx/model-fabric";

import type { WebRuntimeHost } from "./web-host";
import { INTELLIGENCE_FIXTURE_ROWS, intelligenceFixtureOf } from "./intelligence-fixtures";

// ---------------------------------------------------------------------------
// The id learning (per module instance — the dev-server split reality)
// ---------------------------------------------------------------------------

/** Learn each fixture row's canonical id + patch the artifact item ids. */
export async function learnIntelligenceIds(host: WebRuntimeHost): Promise<void> {
  if (host.mode !== "fixtures") return;
  for (const row of INTELLIGENCE_FIXTURE_ROWS) {
    if (row.itemId !== null) continue;
    const model = await host.runtime.search({ query: row.title });
    const hit = model.hits.find((entry) => entry.result.title === row.title);
    if (hit === undefined) continue;
    row.itemId = hit.canonicalItemId;
    row.connectorId = hit.result.connectorId;
    // The artifact set's own itemId + the semantic index's itemId must
    // carry the canonical id (the frozen validation requires them to
    // agree — the per-boot canonical id is minted by the registry).
    (row.artifacts as { itemId: string }).itemId = hit.canonicalItemId;
    if (row.artifacts.semanticIndex !== undefined) {
      (row.artifacts.semanticIndex as { itemId: string }).itemId = hit.canonicalItemId;
    }
  }
}

/** The per-boot artifact set of one external ref (null when none). */
export function intelligenceArtifactsOf(
  host: WebRuntimeHost,
  externalRef: string,
): MediaIntelligenceArtifacts | null {
  if (host.mode !== "fixtures") return null;
  const row = intelligenceFixtureOf(externalRef);
  if (row === null || row.itemId === null) return null;
  return row.artifacts;
}

// ---------------------------------------------------------------------------
// The provenance view (honest model truth on every AI surface)
// ---------------------------------------------------------------------------

/** One contributing model's provenance sentence. */
export interface ProvenanceSentenceView {
  readonly stage: string;
  readonly modelId: string;
  readonly confidence: number;
  readonly sentence: string;
}

/** The provenance sentences of one artifact set (build provenance). */
export function provenanceSentencesOf(
  artifacts: MediaIntelligenceArtifacts,
): readonly ProvenanceSentenceView[] {
  const index = artifacts.semanticIndex;
  if (index === undefined) return [];
  return index.buildProvenance.map((entry) => ({
    stage: entry.stage,
    modelId: entry.modelId,
    confidence: entry.confidence,
    sentence: `${entry.stage} by ${entry.modelId} at ${Math.round(entry.confidence * 100)}% confidence.`,
  }));
}

// ---------------------------------------------------------------------------
// The item intelligence view (transcript / chapters / moments / features)
// ---------------------------------------------------------------------------

/** One transcript segment view. */
export interface TranscriptSegmentView {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly speakerLabel: string | null;
  readonly language: string;
}

/** One chapter/scene view. */
export interface ChapterView {
  readonly kind: "chapter" | "scene";
  readonly startMs: number;
  readonly endMs: number;
  readonly title: string | null;
  readonly summary: string | null;
}

/** One searchable moment view (with its jump path). */
export interface MomentView {
  readonly startMs: number;
  readonly endMs: number;
  readonly description: string;
}

/** The item's intelligence view (the J39 surfaces render this). */
export interface ItemIntelligenceView {
  readonly status: "ready" | "unavailable" | "prerequisites-missing";
  /** Present when unavailable: the honest one-sentence truth. */
  readonly detail?: string;
  readonly transcript?: readonly TranscriptSegmentView[];
  readonly transcriptLanguage?: string;
  readonly chapters?: readonly ChapterView[];
  readonly moments?: readonly MomentView[];
  /** The R23-H discovery features' availability (the honest per-feature truth). */
  readonly features: Readonly<Partial<Record<DiscoveryFeatureKind, { available: boolean; missing: readonly string[] }>>>;
  /** The honest provenance (every contributing model, named). */
  readonly provenance: readonly ProvenanceSentenceView[];
  /** R23-G's legal-audio truth for this item (the live-speech gate). */
  readonly audioStreamLegallyAvailable: boolean;
}

/** The typed unavailable view (no data / the honest absence). */
function unavailableIntelligence(detail: string): ItemIntelligenceView {
  return {
    status: "unavailable",
    detail,
    features: {},
    provenance: [],
    audioStreamLegallyAvailable: false,
  };
}

/** Build the item intelligence view from one artifact set (pure). */
export function intelligenceViewFromArtifacts(
  artifacts: MediaIntelligenceArtifacts,
  audioStreamLegallyAvailable: boolean,
): ItemIntelligenceView {
  const availability = discoveryFeatureAvailabilityView(artifacts);
  const featureRows: readonly (readonly [
    DiscoveryFeatureKind,
    { available: boolean; missing: readonly string[] },
  ])[] = Object.entries(availability).map(([kind, view]) => [
    kind as DiscoveryFeatureKind,
    view.kind === "available"
      ? { available: true, missing: [] }
      : { available: false, missing: [...view.missing] },
  ]);
  const features: ItemIntelligenceView["features"] = Object.fromEntries(featureRows);
  return {
    status: "ready",
    ...(artifacts.transcript !== undefined
      ? {
          transcript: artifacts.transcript.segments.map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
            speakerLabel: segment.speakerLabel ?? null,
            language: segment.language,
          })),
          transcriptLanguage: artifacts.transcript.language,
        }
      : {}),
    ...(artifacts.chaptersScenes !== undefined
      ? {
          chapters: artifacts.chaptersScenes.units.map((unit) => ({
            kind: unit.kind,
            startMs: unit.startMs,
            endMs: unit.endMs,
            title: unit.title ?? null,
            summary: unit.summary ?? null,
          })),
        }
      : {}),
    ...(artifacts.searchableMoments !== undefined
      ? {
          moments: artifacts.searchableMoments.moments.map((moment) => ({
            startMs: moment.startMs,
            endMs: moment.endMs,
            description: moment.description,
          })),
        }
      : {}),
    features,
    provenance: provenanceSentencesOf(artifacts),
    audioStreamLegallyAvailable,
  };
}

/** Load one item's intelligence view (the honest per-mode truth). */
export async function loadItemIntelligence(
  host: WebRuntimeHost,
  externalRef: string,
): Promise<ItemIntelligenceView> {
  await learnIntelligenceIds(host);
  const row = host.mode === "fixtures" ? intelligenceFixtureOf(externalRef) : null;
  if (row === null || row.itemId === null) {
    return unavailableIntelligence(
      host.mode === "fixtures"
        ? "This title has no derived intelligence on this host yet — transcript, chapters, and moment search stay off honestly rather than approximated."
        : "Semantic intelligence is not served by this transport yet — the reads stay off honestly rather than approximated.",
    );
  }
  return intelligenceViewFromArtifacts(row.artifacts, row.audioStreamLegallyAvailable);
}

// ---------------------------------------------------------------------------
// Search by meaning + moment search (the R23-H surfaces)
// ---------------------------------------------------------------------------

/** One moment search result (the jump-to-timestamp truth). */
export interface MomentResultView {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly description: string;
  readonly matchedText: string | null;
  readonly score: number;
}

/** One title-level semantic result. */
export interface MeaningResultView {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  /** The best-matching index entry's text (why this title matched). */
  readonly matchedText: string;
  readonly score: number;
}

/** The semantic search view (the honest per-mode + per-feature truth). */
export interface SemanticSearchView {
  readonly status: "ready" | "unavailable";
  readonly detail?: string;
  readonly meaning: readonly MeaningResultView[];
  readonly moments: readonly MomentResultView[];
  /** The honest provenance of the matched signals (contributing models). */
  readonly provenance: readonly ProvenanceSentenceView[];
  /** Whether search-by-meaning ran (its prerequisite truth per item). */
  readonly meaningSearchAvailable: boolean;
}

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

/**
 * Search by meaning + moments over the fixture intelligence index (the
 * R23-H surfaces' read). Anonymous-friendly by construction (a low-cost
 * local read — the R23-K boundary).
 */
export async function searchByMeaning(
  host: WebRuntimeHost,
  query: string,
): Promise<SemanticSearchView> {
  await learnIntelligenceIds(host);
  if (host.mode !== "fixtures") {
    return {
      status: "unavailable",
      detail:
        "Semantic search is not served by this transport yet — it stays off honestly rather than approximated.",
      meaning: [],
      moments: [],
      provenance: [],
      meaningSearchAvailable: false,
    };
  }
  const queryTerms = tokenize(query);
  const meaning: MeaningResultView[] = [];
  const moments: MomentResultView[] = [];
  const provenance: ProvenanceSentenceView[] = [];
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
      for (const sentence of provenanceSentencesOf(artifacts)) {
        if (!provenance.some((p) => p.modelId === sentence.modelId && p.stage === sentence.stage)) {
          provenance.push(sentence);
        }
      }
    }
  }

  meaning.sort((a, b) => b.score - a.score);
  moments.sort((a, b) => b.score - a.score || a.startMs - b.startMs);
  return {
    status: "ready",
    meaning,
    moments,
    provenance,
    meaningSearchAvailable,
  };
}

// ---------------------------------------------------------------------------
// The live-ASR route view (R23-G — the live captions/voice surface)
// ---------------------------------------------------------------------------

/** The live-speech route view (the frozen R23-G derivations, verbatim). */
export interface LiveAsrRouteView {
  /** The legal-audio gate's typed readiness for this item. */
  readonly readiness:
    | { kind: "ready" }
    | { kind: "audio-not-legally-available"; detail: string };
  /** The route decision (present when the audio gate is ready). */
  readonly route:
    | { kind: "r2t2-live-low-latency"; providerId: string; detail: string }
    | { kind: "provider-policy-choice"; providerId: string; detail: string }
    | { kind: "no-live-route-registered"; detail: string; recovery: string }
    | null;
  /** The frozen R2T2 envelope facts (the latency truth, rendered). */
  readonly envelope: { readonly chunkRangeMs: string; readonly averageLatencyMs: string };
}

/**
 * Load the live-ASR route view for one item: the legal-audio gate, then
 * the route decision over the CURRENT registration truth (the runtime's
 * provider registry — the R23-J registered open models included).
 */
export async function loadLiveAsrRoute(
  host: WebRuntimeHost,
  externalRef: string,
): Promise<LiveAsrRouteView> {
  await learnIntelligenceIds(host);
  const row = host.mode === "fixtures" ? intelligenceFixtureOf(externalRef) : null;
  const audioLegallyAvailable = row?.audioStreamLegallyAvailable ?? false;
  const readiness = liveAsrReadiness({
    audioStreamLegallyAvailable: audioLegallyAvailable,
  });
  if (readiness.kind !== "ready") {
    return {
      readiness: { kind: "audio-not-legally-available", detail: readiness.detail },
      route: null,
      envelope: {
        chunkRangeMs: "80 ms–2 s",
        averageLatencyMs: "~200–600 ms",
      },
    };
  }
  // The registration truth: the runtime's CURRENT provider registry.
  const providers = await host.runtime.modelControls.refreshProviders();
  const availableProviderIds =
    providers.status.state === "ready" ? providers.providers.map((provider) => provider.id) : [];
  // The caller's model-policy preference for speech (the alternative
  // policy choice the R23-G routing preserves).
  const policy = await host.runtime.modelControls
    .refreshPolicy("speechToText")
    .catch(() => null);
  const route = routeAsr({
    workload: "live-streaming",
    availableProviderIds,
    ...(policy?.policy?.preferredProvider !== undefined
      ? { preferredProviderId: policy.policy.preferredProvider }
      : {}),
  });
  return {
    readiness: { kind: "ready" },
    route: {
      kind: route.kind,
      providerId: "providerId" in route ? route.providerId : "",
      detail: route.detail,
      ...("recovery" in route ? { recovery: route.recovery } : {}),
    },
    envelope: {
      chunkRangeMs: "80 ms–2 s",
      averageLatencyMs: "~200–600 ms",
    },
  } as LiveAsrRouteView;
}
