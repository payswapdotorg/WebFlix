/**
 * @wfx/app-web — the R07 view pipelines: RUNTIME STATE → view models.
 *
 * Pure projections of the shared client runtime's state into the plain
 * serializable view models the React tree renders. NO product logic lives
 * here: navigation, watch state, library semantics, action states, and
 * playback decisions are the runtime's; this module maps them, joins the
 * per-process source identity (the canonical seam — see
 * `host/web-host.ts`), and preserves the runtime's typed section statuses
 * verbatim (an error section renders as an error, never as a fake empty
 * one — the honesty law).
 *
 * HONESTY LAWS (mirrored from the runtime's models):
 * - A section whose model status is `error` carries the typed failure into
 *   the view — the surface renders the error state with the detail.
 * - Cards never fabricate capability or availability claims the source did
 *   not make: search cards carry identity + type + duration only;
 *   capability truth renders on the DETAIL surface (real metadata).
 * - The item join is the adapter's per-process map — an item the process
 *   has never rendered has no source ref, and its continue-watching card
 *   renders WITHOUT a fabricated link (the honest unlinked state).
 */

import type {
  AcquisitionDiagnosticsView,
  AcquisitionStatusView,
  ContinueWatchingEntry,
  ModelSectionStatus,
  PlaybackController,
  PlaybackState,
  SearchHit,
  SearchModel,
} from "@wfx/client-runtime";
import type { PlaybackRealization, PlaybackSession, SourceItem, UserAction } from "@wfx/domain";
import { buildExternalReturnContext, isOfficialEmbed } from "@wfx/experience";
import { canUsePlaybackMode } from "@wfx/client-runtime";
import { contentArtworkOf } from "@wfx/domain";
import type {
  ContentArtwork,
  ContentArtworkResolution,
} from "@wfx/domain";
import { isTorrentRealizationDeclaration } from "@wfx/client-runtime";
import type { TorrentRealizationDeclaration } from "@wfx/client-runtime";

import { WebClock } from "@/platform/lifecycle";

import type { WebRuntimeHost } from "./web-host";
import { progressScopeTruthOf, viewerKindOf } from "./anonymous-truth";
import type { ProgressScopeTruth } from "./anonymous-truth";
import { torrentRealizationOf } from "./torrent-realizations";
import { loadItemIntelligence, loadLiveAsrRoute, searchByMeaning } from "./intelligence";
import { loadRealtimeRouteView, type RealtimeRouteView } from "./realtime/realtime-route";
import type {
  ItemIntelligenceView,
  LiveAsrRouteView,
  SemanticSearchView,
} from "./intelligence";
import { WEB_BROWSER_TORRENT_IMPLEMENTATION } from "@/platform/browser-torrent-environment";
import { canonicalIdFor } from "./web-host";
import { sessionQueue, type QueueEntry } from "./queue";
import { recordPlaybackSession, type ClientPlaybackIntent } from "./playback-bridge";
import { fixtureAcquisitionDiagnostics, reportAcquisitionFixtures } from "./acquisition-fixtures";
import {
  loadAiTrayView,
  loadWhereToWatchView,
} from "./decision-views";
import type { AiTrayView, WhereToWatchView } from "./decision-views";

// ---------------------------------------------------------------------------
// The per-process item join (canonical id ⇄ source identity + display)
// ---------------------------------------------------------------------------

/** The joined source identity of one canonical item. */
export interface JoinedItem {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  /**
   * R26-W1 — the item's REAL SOURCE ARTWORK when the content row carried
   * one (the connector's source-authorized thumbnail/poster URL, carried
   * through the typed `ContentArtwork` contract). Absent when the source
   * serves no artwork (the placeholder fallback renders — never a
   * generated image replacing an available source thumbnail).
   */
  readonly artwork?: ContentArtwork;
  /**
   * R26-W1 — the item's DECLARED authorized peer copy when the content
   * row carried one (the R23-C `TorrentRealizationDeclaration`,
   * validated). Absent when no row declared one — the honest absence
   * (the Where-to-watch peer entry never renders without a declaration).
   */
  readonly peerRealization?: TorrentRealizationDeclaration;
}

const itemJoin = new Map<string, JoinedItem>();

/** The item's source-artwork resolution over a content row (the typed carrier). */
function artworkOfCarrier(
  row: {
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title?: string;
    readonly orientation?: "horizontal" | "vertical" | "square" | "unknown";
    readonly metadata?: Record<string, unknown>;
  },
): ContentArtwork | undefined {
  const resolution = contentArtworkOf(row);
  return resolution.kind === "source-artwork" ? resolution.artwork : undefined;
}

/** Learn the join from the runtime's own search/shorts hits (idempotent). */
function learnHits(hits: readonly SearchHit[]): void {
  for (const hit of hits) {
    const existing = itemJoin.get(hit.canonicalItemId);
    const artwork = artworkOfCarrier(hit.result);
    const peer = peerRealizationOfCarrier(hit.result);
    const joined: JoinedItem = {
      itemId: hit.canonicalItemId,
      connectorId: hit.result.connectorId,
      externalRef: hit.result.externalRef,
      title: hit.result.title,
      canonicalType: hit.result.canonicalType ?? "video",
      ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
      // R26-W1 — learn the REAL source artwork + the declared authorized
      // peer copy the content row carries (first sight wins, the same
      // display-data law as the title).
      ...(artwork !== undefined ? { artwork } : {}),
      ...(peer !== undefined ? { peerRealization: peer } : {}),
    };
    // First-sight display data wins (stability); the join never rewrites.
    if (existing === undefined) itemJoin.set(hit.canonicalItemId, joined);
  }
}

/**
 * R26-W1 — the well-known metadata key a content row may carry an
 * authorized peer-copy declaration under (the R23-C
 * `TorrentRealizationDeclaration`, validated by its structural guard —
 * never trusted blindly). The connector/service is the declaration
 * boundary, exactly as it is for artwork: a row that declares nothing
 * carries nothing (the honest absence).
 */
export const PEER_REALIZATION_METADATA_KEY = "torrentRealization" as const;

/** The row's declared peer realization (validated; undefined when none). */
function peerRealizationOfCarrier(
  row: { readonly metadata?: Record<string, unknown> },
): TorrentRealizationDeclaration | undefined {
  const raw = row.metadata?.[PEER_REALIZATION_METADATA_KEY];
  return isTorrentRealizationDeclaration(raw) ? raw : undefined;
}

/** Learn one explicitly-known item (deep-link joins mint through the host seam). */
function learnJoinedItem(
  carrier: {
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType?: string;
    readonly durationMs?: number;
    readonly orientation?: "horizontal" | "vertical" | "square" | "unknown";
    readonly metadata?: Record<string, unknown>;
  },
): string {
  const { connectorId, externalRef, title } = carrier;
  const canonicalType = carrier.canonicalType ?? "video";
  const itemId = canonicalIdFor(connectorId, externalRef);
  if (!itemJoin.has(itemId)) {
    const artwork = artworkOfCarrier(carrier);
    const peer = peerRealizationOfCarrier(carrier);
    itemJoin.set(itemId, {
      itemId,
      connectorId,
      externalRef,
      title,
      canonicalType,
      ...(carrier.durationMs !== undefined ? { durationMs: carrier.durationMs } : {}),
      // R26-W1 — the real source artwork + the authorized peer-copy
      // declaration the content row carries (first sight wins — the
      // same display-data law).
      ...(artwork !== undefined ? { artwork } : {}),
      ...(peer !== undefined ? { peerRealization: peer } : {}),
    });
  }
  return itemId;
}

/** The joined identity of one canonical item (null when this process never saw it). */
export function joinedItemOf(itemId: string): JoinedItem | null {
  return itemJoin.get(itemId) ?? null;
}

/**
 * R26-W1 — the joined identity of one item BY its source identity (the
 * peer-realization read's lookup: the content rows carry declarations
 * keyed by external ref). Null when this process never saw the row.
 */
export function joinedItemByExternalRef(
  connectorId: string,
  externalRef: string,
): JoinedItem | null {
  for (const joined of itemJoin.values()) {
    if (joined.connectorId === connectorId && joined.externalRef === externalRef) {
      return joined;
    }
  }
  return null;
}

/**
 * R26-W1 — the joined identity by external ref ACROSS connectors (the
 * unscoped deep-link fallback: one canonical item may be joined through
 * any source). Null when no connector's row was observed.
 */
export function joinedItemByExternalRefAny(externalRef: string): JoinedItem | null {
  for (const joined of itemJoin.values()) {
    if (joined.externalRef === externalRef) {
      return joined;
    }
  }
  return null;
}

/**
 * R26-W1 — the learned-join SNAPSHOT (the capability-availability
 * derivation's empirical read): every item this process has observed,
 * with its source-artwork presence. Readonly projection of the join's
 * display data; an empty snapshot is honest (a boot that has served no
 * content rows yet observes nothing — never a fabricated observation).
 */
export function joinedItemsSnapshot(): readonly {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly artwork?: { readonly url: string };
}[] {
  return [...itemJoin.values()].map((joined) => ({
    itemId: joined.itemId,
    connectorId: joined.connectorId,
    externalRef: joined.externalRef,
    ...(joined.artwork !== undefined ? { artwork: { url: joined.artwork.url } } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Card views
// ---------------------------------------------------------------------------

/**
 * R26-W1 — the card's ARTWORK VIEW: the REAL source artwork the content
 * row carried, projected into the plain serializable shape the card
 * surfaces render (Worker 2's lane renders the `<img>` from this;
 * absent ⇒ the placeholder fallback renders — never a fabricated
 * image, never a generated replacement for a source thumbnail).
 */
export interface ArtworkView {
  /** The source-authorized artwork URL (absolute http/https, verbatim). */
  readonly url: string;
  /** The honest aspect ratio (width/height) when the source carries the signal. */
  readonly aspectRatio?: number;
  /** The accessibility alt text (the title + the source identity). */
  readonly altText: string;
  /** The honest fallback sentence (what renders if the URL fails to load). */
  readonly fallbackDetail: string;
  /** The connector the artwork is authorized by (the provenance truth). */
  readonly connectorId: string;
}

/** Project the artwork resolution into the card view (pure). */
function artworkViewOf(
  resolution: ContentArtworkResolution,
  title: string,
): ArtworkView | undefined {
  if (resolution.kind !== "source-artwork") return undefined;
  const artwork = resolution.artwork;
  return {
    url: artwork.url,
    ...(artwork.aspectRatio !== undefined ? { aspectRatio: artwork.aspectRatio } : {}),
    altText: `${title} — artwork served by ${artwork.provenance.connectorId}`,
    fallbackDetail: artwork.fallback.detail,
    connectorId: artwork.provenance.connectorId,
  };
}

/**
 * R26-W2 — project an ALREADY-RESOLVED source artwork (the learned join's
 * `ContentArtwork`) into the plain card view shape (pure). The continue
 * cards and the hero consume this — the SAME projection grammar the hit
 * path uses, one source of truth.
 */
export function artworkViewOfContent(
  artwork: ContentArtwork,
  title: string,
): ArtworkView {
  return {
    url: artwork.url,
    ...(artwork.aspectRatio !== undefined ? { aspectRatio: artwork.aspectRatio } : {}),
    altText: `${title} — artwork served by ${artwork.provenance.connectorId}`,
    fallbackDetail: artwork.fallback.detail,
    connectorId: artwork.provenance.connectorId,
  };
}

/** One content card view (identity + type + duration — no fabricated claims). */
export interface CardView {
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly connectorId: string;
  readonly externalRef: string;
  /**
   * R26-W1 — the item's REAL SOURCE ARTWORK when the content row carried
   * one (the connector's source-authorized thumbnail/poster). Absent when
   * the source serves no artwork — the card renders the placeholder
   * fallback, never a generated replacement (the real-artwork law).
   */
  readonly artwork?: ArtworkView;
}

/** The view status of one model section (the runtime's status, verbatim). */
export interface SectionStatusView {
  readonly state: "ready" | "error";
  readonly error?: { readonly kind: string; readonly detail: string };
}

function statusView(status: ModelSectionStatus): SectionStatusView {
  if (status.state === "ready") return { state: "ready" };
  return { state: "error", error: status.error ?? { kind: "unavailable", detail: "the section failed" } };
}

/** Project one runtime hit into a card view (learning the join). */
export function cardFromHit(hit: SearchHit): CardView {
  learnHits([hit]);
  const artwork = artworkViewOf(contentArtworkOf(hit.result), hit.result.title);
  return {
    itemId: hit.canonicalItemId,
    title: hit.result.title,
    canonicalType: hit.result.canonicalType ?? "video",
    ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
    connectorId: hit.result.connectorId,
    externalRef: hit.result.externalRef,
    ...(artwork !== undefined ? { artwork } : {}),
  };
}

/** Project a model's hits into cards (order preserved; the join learned). */
export function cardsFromModel(model: SearchModel): readonly CardView[] {
  learnHits(model.hits);
  return model.hits.map((hit) => {
    const artwork = artworkViewOf(contentArtworkOf(hit.result), hit.result.title);
    return {
      itemId: hit.canonicalItemId,
      title: hit.result.title,
      canonicalType: hit.result.canonicalType ?? "video",
      ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
      connectorId: hit.result.connectorId,
      externalRef: hit.result.externalRef,
      ...(artwork !== undefined ? { artwork } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Home view
// ---------------------------------------------------------------------------

/** One continue-watching card: the runtime entry + the joined source identity. */
export interface ContinueCardView {
  readonly itemId: string;
  readonly title: string;
  readonly positionMs: number;
  readonly completionRatio: number | null;
  readonly status: ContinueWatchingEntry["status"];
  /** The source identity when this process knows it (null ⇒ the honest unlinked card). */
  readonly joined: JoinedItem | null;
}

/** One named content row with its typed status. */
export interface RowView {
  readonly id: string;
  readonly title: string;
  /** NON-EMPTY honest reason (why this row exists). */
  readonly reason: string;
  readonly status: SectionStatusView;
  readonly cards: readonly CardView[];
}

/** The home view model: Continue Watching + the browse rows + the shorts rail. */
export interface HomeView {
  readonly mode: "fixtures" | "service";
  readonly continueWatching: {
    readonly status: SectionStatusView;
    readonly entries: readonly ContinueCardView[];
  };
  readonly rows: readonly RowView[];
  readonly shortsRail: {
    readonly status: SectionStatusView;
    readonly cards: readonly CardView[];
  };
  /** R24-W2 \u2014 the cards' action context (queue/save/share + the preview policy). */
  readonly cardActions: CardActionContext;
}

/**
 * The home browse queries — the deterministic discovery seeds the frozen
 * R01 home model composes its rows from (Continue Watching is the
 * runtime's own; the rows are the service's search composition — R05's
 * intent/policy state rides the same transport the Personalize controls
 * write). No stale "seeded until R05" language survives: R05 is an
 * accepted lane; the copy names what the rows are and where the
 * personalization controls live (the R21-D Personalize control).
 */
export const FOR_YOU_QUERY = "rain";
export const TRENDING_QUERY = "a";
export const SHORTS_SEED_QUERY = "n";

function continueCards(entries: readonly ContinueWatchingEntry[]): ContinueCardView[] {
  return entries.map((entry) => ({
    itemId: entry.itemId,
    title: entry.title,
    positionMs: entry.positionMs,
    completionRatio: entry.completionRatio,
    status: entry.status,
    joined: joinedItemOf(entry.itemId),
  }));
}

/**
 * R24-W2 \u2014 the card action context: the per-surface context the cards'
 * quiet action row + policy-gated preview consume (the attention mode
 * from the runtime's OWN policy read \u2014 the same seam the Personalize
 * control renders \u2014 and the watchlist membership truth). Computed
 * server-side per surface render; never a second policy.
 */
export interface CardActionContext {
  /** The session's attention mode (the preview policy derivation). */
  readonly attentionMode: "mindful" | "balanced" | "immersive" | "custom";
  /** The canonical item ids already in the watchlist (the save truth). */
  readonly savedItemIds: readonly string[];
}

/** Read the card action context from the runtime (pure in-process reads). */
export function cardActionContextOf(host: WebRuntimeHost): CardActionContext {
  return {
    attentionMode: host.runtime.intents.policy().attentionMode,
    savedItemIds: host.runtime.libraryOps.entries().map((entry) => entry.itemId),
  };
}

/** Load the home view from the runtime (Continue Watching + the discovery rows). */
export async function loadHomeView(host: WebRuntimeHost): Promise<HomeView> {
  const runtime = host.runtime;
  const [homeModel, forYouModel, trendingModel, shortsModel] = await Promise.all([
    runtime.getHome(),
    runtime.search({ query: FOR_YOU_QUERY }),
    runtime.search({ query: TRENDING_QUERY }),
    runtime.shorts({ query: SHORTS_SEED_QUERY }),
  ]);
  // The rows/cards project FIRST (they learn the item join the continue
  // cards then resolve their source identities through).
  const forYouCards = cardsFromModel(forYouModel);
  const trendingCards = cardsFromModel(trendingModel);
  const shortsCards = cardsFromModel(shortsModel);
  return {
    mode: host.mode,
    continueWatching: {
      status: statusView(homeModel.continueWatching.status),
      entries: continueCards(homeModel.continueWatching.entries),
    },
    rows: [
      {
        id: "for-you",
        title: "For you",
        reason: "Your discovery feed for this session — set your intent and attention mode from the Personalize control.",
        status: statusView(forYouModel.status),
        cards: forYouCards,
      },
      {
        id: "trending",
        title: "Trending on your sources",
        reason: "What your connected sources surface broadly right now.",
        status: statusView(trendingModel.status),
        cards: trendingCards,
      },
    ],
    shortsRail: {
      status: statusView(shortsModel.status),
      cards: shortsCards,
    },
    cardActions: cardActionContextOf(host),
  };
}

// ---------------------------------------------------------------------------
// Watch browse view
// ---------------------------------------------------------------------------

/** The watch browse view model (the long-form rows, statuses verbatim). */
export interface WatchBrowseView {
  readonly mode: "fixtures" | "service";
  readonly rows: readonly RowView[];
  /** R24-W2 \u2014 the cards' action context (queue/save/share + the preview policy). */
  readonly cardActions: CardActionContext;
}

/** Load the long-form watch browse view from the runtime. */
export async function loadWatchBrowseView(host: WebRuntimeHost): Promise<WatchBrowseView> {
  const runtime = host.runtime;
  const [forYouModel, trendingModel] = await Promise.all([
    runtime.search({ query: FOR_YOU_QUERY }),
    runtime.search({ query: TRENDING_QUERY }),
  ]);
  const forYouCards = cardsFromModel(forYouModel);
  const seenForYou = new Set(forYouCards.map((card) => card.itemId));
  return {
    mode: host.mode,
    rows: [
      {
        id: "for-you",
        title: "For you",
        reason: "Your discovery feed for this session — set your intent and attention mode from the Personalize control.",
        status: statusView(forYouModel.status),
        cards: forYouCards,
      },
      {
        id: "trending",
        title: "Trending on your sources",
        reason: "What your connected sources surface broadly right now.",
        status: statusView(trendingModel.status),
        cards: cardsFromModel(trendingModel).filter((card) => !seenForYou.has(card.itemId)),
      },
    ],
    cardActions: cardActionContextOf(host),
  };
}

// ---------------------------------------------------------------------------
// Search view
// ---------------------------------------------------------------------------

/** The search view model (the typed query + results with statuses). */
export interface SearchView {
  readonly mode: "fixtures" | "service";
  readonly query: string;
  readonly status: SectionStatusView;
  readonly cards: readonly CardView[];
  /**
   * R26-W2 — the honest token-composition disclosure: non-null iff the
   * phrase query answered zero and the results shown are the per-token
   * real matches (the literal-phrase gap's recovery — the sentence names
   * exactly what matched, never presenting token matches as phrase
   * matches).
   */
  readonly resultsNote: string | null;
  /** R21-E — per-card availability summaries ("where can I watch this?"). */
  readonly availability: ReadonlyMap<string, string>;
  /**
   * R23-H — the semantic search section (search by meaning + moments
   * over the item intelligence index, with honest provenance). The
   * honest unavailable state when the host serves none.
   */
  readonly semantic: SemanticSearchView;
  /** R24-W2 \u2014 the cards' action context (queue/save/share + the preview policy). */
  readonly cardActions: CardActionContext;
}

/** The compact availability summary of one result card (R21-E, pure). */
export function cardAvailabilitySummary(usableCount: number, offered: number): string {
  if (usableCount === 0) {
    return "No way to play here yet";
  }
  if (usableCount === 1) {
    return offered > 1 ? "1 way to play here — more on details" : "1 way to play here";
  }
  return `${usableCount} ways to play here`;
}

/**
 * R26-W2 — the search query's TOKENS (the tokenized-phrase recovery's
 * input): lowercase, split on non-alphanumeric runs, first-seen-deduped,
 * bounded to the first four (the recovery's cost stays bounded — a
 * garbage-length query never fans out into dozens of transport calls).
 */
function searchTokensOf(query: string): readonly string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
  return [...new Set(tokens)].slice(0, 4);
}

/**
 * R26-W2 — the token-composition MERGE (the literal-phrase gap's honest
 * recovery): the production transport's title search matches a literal
 * SUBSTRING (the persistence catalog's LIKE law), so a query like "rainy
 * day lofi" answers zero even when a title carries all three words apart.
 * The recovery searches each token THROUGH THE SAME REAL TRANSPORT and
 * merges the real hits: titles matching MORE of the query's tokens rank
 * first (all-token matches before partial), each token model's own order
 * preserved within its rank; the composition dedupes by canonical item.
 * No result is fabricated — every card is a hit the transport really
 * answered for a token the user really typed.
 */
function mergeTokenHits(
  tokens: readonly string[],
  tokenCards: readonly (readonly CardView[])[],
  phraseCards: readonly CardView[],
): readonly CardView[] {
  const seen = new Set<string>(phraseCards.map((card) => card.itemId));
  // Rank: how many of the query's tokens the title itself contains
  // (word-boundary-insensitive — the transport's own containment law,
  // applied per token).
  const tokenOf = (value: string): readonly string[] =>
    value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((part) => part.length > 0);
  const ranked: { card: CardView; matchedTokens: number; order: number }[] = [];
  let order = 0;
  for (const cards of tokenCards) {
    for (const card of cards) {
      if (seen.has(card.itemId)) continue;
      seen.add(card.itemId);
      const titleTokens = new Set(tokenOf(card.title));
      let matched = 0;
      for (const token of tokens) {
        if (titleTokens.has(token)) matched += 1;
      }
      ranked.push({ card, matchedTokens: matched, order: order++ });
    }
  }
  ranked.sort((a, b) => b.matchedTokens - a.matchedTokens || a.order - b.order);
  return [...phraseCards, ...ranked.map((entry) => entry.card)];
}

/** Load the search view for one query (canonical-joined results). */
export async function loadSearchView(host: WebRuntimeHost, rawQuery: string): Promise<SearchView> {
  const query = rawQuery.trim();
  // The empty query is NOT a search (the state machine's invalid-target
  // law): the typed empty state answers WITHOUT asking the runtime —
  // the J05 known defect (an unguarded empty query threw the typed
  // invalid-input error into the error boundary), fixed here.
  if (query.length === 0) {
    return {
      mode: host.mode,
      query: "",
      status: { state: "ready" },
      cards: [],
      resultsNote: null,
      availability: new Map<string, string>(),
      semantic: {
        status: "unavailable",
        meaning: [],
        moments: [],
        provenance: [],
        meaningSearchAvailable: false,
      },
      cardActions: cardActionContextOf(host),
    };
  }
  // R23-H: the semantic search runs alongside the title search (search
  // by meaning + moments, with honest provenance — a low-cost local
  // read serving anonymous viewers too, the R23-K boundary).
  const semantic = await searchByMeaning(host, query);
  const model = await host.runtime.search({ query });
  let cards = cardsFromModel(model);
  let resultsNote: string | null = null;
  // R26-W2 — THE TOKENIZED-PHRASE RECOVERY (the production literal-phrase
  // gap): when the whole-phrase query answered ZERO cards and the query
  // carries multiple tokens, search each token through the SAME REAL
  // TRANSPORT and merge the honest hits (more matched tokens first). The
  // note names exactly what happened — never presenting token matches as
  // phrase matches. Single-token queries and non-empty phrase answers
  // keep the transport's own composition verbatim (fixture boots and
  // every already-working query are unchanged).
  const tokens = searchTokensOf(query);
  if (cards.length === 0 && tokens.length > 1) {
    const tokenModels = await Promise.all(
      tokens.map((token) => host.runtime.search({ query: token })),
    );
    const tokenCards = tokenModels.map((tokenModel) => cardsFromModel(tokenModel));
    const merged = mergeTokenHits(tokens, tokenCards, cards);
    if (merged.length > 0) {
      cards = merged;
      resultsNote = `No title contains the whole phrase “${query}” — these matches contain the words ${tokens
        .map((token) => `“${token}”`)
        .join(", ")} in any order.`;
    }
  }
  // R21-E: the compact availability summary per result (the matrix's
  // search contextual entry — answering "where can I watch this?" without
  // opening every page). Typed reads: a failed resolve answers the honest
  // absent summary (never a fabricated count), and the read is capped at
  // the first page of results (the summary is a hint, not a claim).
  const availability = new Map<string, string>();
  const capped = cards.slice(0, 12);
  await Promise.all(
    capped.map(async (card) => {
      const result = await host.serverPort.resolve(card.externalRef);
      if (!result.ok || !Array.isArray(result.value)) {
        availability.set(card.itemId, "Playback options on details");
        return;
      }
      const usable = result.value.filter((realization) =>
        canUsePlaybackMode(host.capabilities, realization.mode),
      );
      availability.set(card.itemId, cardAvailabilitySummary(usable.length, result.value.length));
    }),
  );
  for (const card of cards) {
    if (!availability.has(card.itemId)) {
      availability.set(card.itemId, "Playback options on details");
    }
  }
  return {
    mode: host.mode,
    query,
    status: statusView(model.status),
    cards,
    resultsNote,
    availability,
    semantic,
    cardActions: cardActionContextOf(host),
  };
}

// ---------------------------------------------------------------------------
// Shorts view
// ---------------------------------------------------------------------------

/** The shorts feed view model (the vertical stack's first page). */
export interface ShortsView {
  readonly mode: "fixtures" | "service";
  readonly status: SectionStatusView;
  readonly cards: readonly CardView[];
}

/** Load the shorts feed view from the runtime's shorts operation. */
export async function loadShortsView(host: WebRuntimeHost, query?: string): Promise<ShortsView> {
  // The seed query is the documented composition default (the frozen
  // transport has no dedicated shorts endpoint — see platform/server-port).
  const model = await host.runtime.shorts({ query: query ?? SHORTS_SEED_QUERY });
  return {
    mode: host.mode,
    status: statusView(model.status),
    cards: cardsFromModel(model),
  };
}

// ---------------------------------------------------------------------------
// Item detail view
// ---------------------------------------------------------------------------

/** The item detail view model (real source metadata + runtime resume state). */
export interface DetailView {
  readonly mode: "fixtures" | "service";
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly availability: SourceItem["availability"];
  readonly capabilities: readonly string[];
  readonly connectorId: string;
  readonly externalRef: string;
  /** The runtime's folded watch state (null when never watched — honest). */
  readonly watch: { readonly positionMs: number; readonly status: string; readonly completionRatio: number | null } | null;
  /** Related cards ("more to explore" — the trending pool, minus this item). */
  readonly related: readonly CardView[];
  /**
   * R14 — the native acquisition truth: the runtime's honest lifecycle
   * view (null when nothing is known — the panel renders the capability
   * truth) + the GATED advanced-diagnostics payload (protocol vocabulary;
   * fixtures mode provides the dev feed, service mode none yet).
   */
  readonly acquisition: {
    readonly view: AcquisitionStatusView | null;
    readonly diagnostics: AcquisitionDiagnosticsView | null;
  };
  /** R21-E — the Where-to-watch realization choice (the decision hub's). */
  readonly whereToWatch: WhereToWatchView;
  /** R21-E — the AI action tray's view (the model-class + input truth). */
  readonly aiTray: AiTrayView;
  /**
   * R23 (J39) — the item's derived intelligence view (transcript,
   * chapters, moments, per-feature availability, provenance) — the
   * honest unavailable state when the host has none.
   */
  readonly intelligence: ItemIntelligenceView;
  /**
   * R26-W1 — the item's REAL ARTWORK truth resolved from the LIVE source
   * metadata: the source-authorized artwork view when the source carries
   * one, or the honest fallback-only truth (the reason artwork is absent)
   * — never a generated replacement for an available source thumbnail.
   */
  readonly artwork: {
    readonly view: ArtworkView | null;
    /** The honest one-sentence reason when no source artwork exists. */
    readonly fallbackReason: string | null;
  };
  /** R24-W2 - whether the canonical item is already in the watchlist (the runtime's truth). */
  readonly watchlistSaved: boolean;
}

/**
 * R14 — the acquisition block of the detail view: the runtime's honest
 * lifecycle view for the item + the gated diagnostics payload (the
 * fixtures-mode dev feed in fixtures mode; none in service mode — the
 * honest absence, never a fabricated feed).
 */
function acquisitionBlockOf(
  host: WebRuntimeHost,
  itemId: string,
): { view: AcquisitionStatusView | null; diagnostics: AcquisitionDiagnosticsView | null } {
  // The per-render refresh (fixtures mode): re-read the shared drive state
  // and report the current facts into THIS runtime's store before reading
  // (the dev-server route modules carry their own runtime instances).
  if (host.mode === "fixtures") reportAcquisitionFixtures(host);
  return {
    view: host.runtime.acquisition.view(itemId),
    diagnostics:
      host.mode === "fixtures" ? fixtureAcquisitionDiagnostics(itemId) : null,
  };
}

/**
 * R24-W2 — the related/up-next projection (the trending pool minus this
 * item — the same composition the item hub's "More to explore" renders,
 * one source of truth for adjacent content). An enrichment read: NEVER
 * on the player's media critical path (the R24-E law).
 */
async function relatedCardsOf(host: WebRuntimeHost, itemId: string): Promise<readonly CardView[]> {
  const trending = await host.runtime.search({ query: TRENDING_QUERY });
  return cardsFromModel(trending).filter((card) => card.itemId !== itemId);
}

/** Load the detail view: the adapter's transport metadata read + runtime watch state. */
export async function loadDetailView(
  host: WebRuntimeHost,
  input: { readonly connectorId: string; readonly externalRef: string; readonly itemId: string },
): Promise<DetailView | null> {
  const result = await host.serverPort.metadata(input.externalRef);
  if (!result.ok) {
    // The typed failure is carried to the surface as the error status.
    throw new DetailLoadError(result.failure.kind, result.failure.detail);
  }
  const metadata = result.value;
  if (metadata === null) return null; // the honest not-found (no fabricated card)
  const itemId = input.itemId;
  // The deep-link join learns the item's display data (first sight wins —
  // the FULL metadata row, so the artwork + peer-declaration carriage the
  // source row carries is learned at the deep-link join too).
  learnJoinedItem({
    connectorId: metadata.connectorId,
    externalRef: metadata.externalRef,
    title: metadata.title,
    ...(metadata.canonicalType !== undefined ? { canonicalType: metadata.canonicalType } : {}),
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    ...(metadata.orientation !== undefined ? { orientation: metadata.orientation } : {}),
    ...(metadata.metadata !== undefined ? { metadata: metadata.metadata } : {}),
  });
  // R26-W1 — the item's REAL artwork truth from the LIVE source metadata
  // (the connector's source-authorized thumbnail; the honest fallback
  // reason when the source serves none).
  const artworkResolution = contentArtworkOf(metadata);
  const artworkView = artworkViewOf(artworkResolution, metadata.title) ?? null;
  const artworkFallbackReason =
    artworkResolution.kind === "fallback-only" ? artworkResolution.reason : null;
  const trending = await host.runtime.search({ query: TRENDING_QUERY });
  const watchState = host.runtime.watchState.get(itemId) ?? null;
  return {
    mode: host.mode,
    itemId,
    title: metadata.title,
    canonicalType: metadata.canonicalType ?? "video",
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    availability: metadata.availability,
    capabilities: [...metadata.capabilities],
    connectorId: metadata.connectorId,
    externalRef: metadata.externalRef,
    watch:
      watchState === null
        ? null
        : {
            positionMs: watchState.lastPositionMs,
            status: watchState.status,
            completionRatio: watchState.completionRatio,
          },
    related: cardsFromModel(trending).filter((card) => card.itemId !== itemId),
    acquisition: acquisitionBlockOf(host, itemId),
    // R24-W2 - the watchlist membership truth (the runtime's own read).
    watchlistSaved: host.runtime.libraryOps.entries().some((entry) => entry.itemId === itemId),
    // R21-E: the decision hub's capability views load alongside (a typed
    // failure in either answers its own honest section state — the page
    // renders, never a blank).
    whereToWatch: await loadWhereToWatchView(host, {
      itemId,
      connectorId: metadata.connectorId,
      externalRef: metadata.externalRef,
      title: metadata.title,
      canonicalType: metadata.canonicalType ?? "video",
      ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    }),
    aiTray: await loadAiTrayView(host, {
      connectorId: metadata.connectorId,
      externalRef: metadata.externalRef,
      title: metadata.title,
      ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    }),
    // R23 (J39): the item's derived intelligence (the transcript /
    // chapters / moments surface + the honest unavailable state).
    intelligence: await loadItemIntelligence(host, metadata.externalRef),
    // R26-W1 — the item's real artwork truth (view when served; the honest
    // fallback reason when the source carries no artwork).
    artwork: {
      view: artworkView,
      fallbackReason: artworkFallbackReason,
    },
  };
}

/** The typed detail-load failure (the transport's typed channel surfaced). */
export class DetailLoadError extends Error {
  readonly kind: string;
  constructor(kind: string, detail: string) {
    super(`detail load failed (${kind}): ${detail}`);
    this.name = "DetailLoadError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Player view
// ---------------------------------------------------------------------------

/**
 * The player SHELL view (R24-E): the media-critical fields the page
 * renders FIRST — the media path (the resolved session + engaged
 * surface + phase truth), the startup-critical Where-to-watch row (the
 * taxonomy's own classification), the session truths (progress scope,
 * queue, attention mode, watchlist), and the peer-copy rung decision.
 * The page awaits ONLY this before its first flush: the nonessential
 * enrichments (the AI tray, the intelligence artifacts, the live-ASR
 * route, the related projection) stream in behind it (see
 * {@link PlayerEnrichments}) — the R24-E startup architecture law,
 * enforced structurally: playback NEVER waits on the deferred lane.
 */
export interface PlayerShellView {
  readonly mode: "fixtures" | "service";
  readonly kind: "session";
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly connectorId: string;
  readonly externalRef: string;
  /** The runtime's playback session id (event correlation). */
  readonly sessionId: string;
  /**
   * R26-W2 — the CLIENT-CARRIED playback intent (the exact resolve input
   * this shell used, serialized for the chrome): the production
   * multi-instance law. The chrome sends it with every /api/playback
   * command so a cold invocation re-resolves the SAME session through the
   * frozen path instead of answering the typed not-found (the reproduced
   * production failure). Null where no runtime session backs the surface
   * (the peer-copy branch — its session is the adapter's own, not the
   * runtime's).
   */
  readonly sessionIntent: ClientPlaybackIntent | null;
  /** The chosen realization's mode + URL (embed/browser carry URLs; external may not). */
  readonly surfaceMode: PlaybackRealization["mode"];
  readonly surfaceUrl: string | null;
  /** The realization's declared capabilities (the source's truth). */
  readonly realizationCapabilities: readonly string[];
  readonly resumePositionMs: number;
  /**
   * R24-E — the canonical duration (ms) the surfaces carry (the input's
   * duration truth — the play hrefs' own parameter); null when unknown
   * (the scrub bar stays honest). The transcript-derived refinement is
   * the intelligence artifact's own truth (the deferred lane).
   */
  readonly durationMs: number | null;
  /** The runtime's truthful playback phase at render time. */
  readonly phase: PlaybackState["phase"];
  /** The realizations the platform CANNOT play, named (capability honesty). */
  readonly skippedForCapability: readonly { readonly mode: string; readonly reason: string }[];
  /** The contained-surface session (browser AND embed rungs; the rendered mount's iframe). */
  readonly browserSurface: { readonly id: string; readonly url: string } | null;
  /** The honest failure when the session could not start (never a fake stage). */
  readonly failure: { readonly kind: string; readonly detail: string } | null;
  /**
   * R09: the Media Surface precedence trace — one line per rung in frozen
   * precedence order. The answer NAMES what was chosen and why (present
   * when the runtime resolved through the injected surface seam).
   */
  readonly precedenceTrace: readonly string[];
  /**
   * R09: the chosen embed realization's official-embed attestation truth
   * (`"official"` when the provider attested their embeddable player,
   * `"unofficial"` when the realization carries no marker; `null` for
   * non-embed modes — never fabricated).
   */
  readonly embedAttestation: "official" | "unofficial" | null;
  /**
   * R09 (J09): the external handoff's RETURN CONTEXT — the durable
   * continuation (item + position at handoff) so the journey can return
   * to the same place. Present iff the external rung won.
   */
  readonly externalReturn: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly positionMs: number;
    readonly handedOffAt: string;
  } | null;
  /** R21-E — the Where-to-watch view (the player's source switch row). */
  readonly whereToWatch: WhereToWatchView;
  /**
   * R23 web-A — the progress-scope truth of THIS surface's session
   * binding (anonymous sessions keep progress session-local with
   * sign-in offered as the optional upgrade — never a playback wall).
   */
  readonly progressScope: ProgressScopeTruth;
  /**
   * R23 web-A — the typed PROVIDER-authorization truth, present iff
   * playback failed on the source's OWN authorization (the R23-B
   * boundary's distinct truth — the reconnect path is the source's,
   * never a WebFlix login).
   */
  readonly providerAuthorization: {
    readonly connectorId: string;
    readonly sentence: string;
    readonly reconnectHref: string;
  } | null;
  /**
   * R23-E — the authorized peer copy (the first-class torrent
   * realization), present iff this player view plays through the peer
   * copy (`&realization=torrent`). The provider fields above carry the
   * typed not-applicable truths for this render (the peer copy path
   * never consults a provider realization).
   */
  readonly torrent: TorrentPlayerView | null;
  /** R24-W2 — the session queue's honest initial state (the rail's own). */
  readonly queue: { readonly entries: readonly QueueEntry[]; readonly autoplay: boolean };
  /** R24-W2 — the session's attention mode (the autoplay/preview policy derivation). */
  readonly attentionMode: "mindful" | "balanced" | "immersive" | "custom";
  /** R24-W2 — whether the canonical item is already in the watchlist (the runtime's truth). */
  readonly watchlistSaved: boolean;
}

/**
 * The player's NONESSENTIAL enrichments (R24-E's deferred lane): the AI
 * action tray, the derived intelligence artifacts, the live-ASR route,
 * and the related/up-next projection. These render as they resolve —
 * streamed behind the shell — and NEVER block the first frame (the
 * startup architecture law; the page starts this work only after the
 * media path resolved, and flushes the shell without awaiting it).
 */
export interface PlayerEnrichments {
  /** R21-E — the AI action tray's view (the same tray as the item hub). */
  readonly aiTray: AiTrayView;
  /** R23 (J39) — the item's derived intelligence view (the parity surface). */
  readonly intelligence: ItemIntelligenceView;
  /** R23-G — the live-ASR route view (the live captions surface's truth). */
  readonly liveAsr: LiveAsrRouteView;
  /**
   * R25-W2 — the realtime translation route view (the Translate
   * control's honest capability truth: the bridge/provider/legal-audio
   * gates + the provider's languages + the anonymous truth; the
   * realization-level restriction composes at the surface).
   */
  readonly realtime: RealtimeRouteView;
  /**
   * R24-W2 — the related/up-next projection (the trending pool minus
   * this item — the same card grammar the item hub's "More to explore"
   * renders). The Up-next rail composes it with the session queue.
   */
  readonly related: readonly CardView[];
}

/** The complete composed player view (the shell + the enrichments). */
export interface PlayerView extends PlayerShellView, PlayerEnrichments {}

/**
 * R23-E — the authorized peer copy's PLAYER view: the first-class
 * torrent realization through the browser rung (WebTorrent/WebRTC) with
 * the acquisition lifecycle (protocol-free states), the honest rung
 * truth when this adapter cannot play it (the Desktop next step — the
 * SAME CANONICAL ITEM, never a dead unavailable), and the nine-dimension
 * parity surfaces the provider stage renders (Where-to-watch switch, AI
 * tray, feedback, actions — the same canonical identity).
 */
export interface TorrentPlayerView {
  /** The frozen primary label ("Authorized peer copy"). */
  readonly label: string;
  /** The frozen one-sentence detail. */
  readonly detail: string;
  /**
   * The R23-C rung outcome for THIS adapter, verbatim (the full union —
   * the Desktop keeps the native rung in the shared vocabulary; the web
   * adapter's platform truth answers browser/desktop-next/gate only).
   */
  readonly rungKind: "satisfies-native-rung" | "satisfies-browser-rung" | "desktop-next-step" | "requires-authorization";
  /** The rung's honest one-sentence truth. */
  readonly rungDetail: string;
  /** The honest Desktop next step (present iff the rung is desktop-next-step). */
  readonly desktopNextStep: { readonly label: string; readonly detail: string } | null;
  /** The acquisition lifecycle view (the runtime store's protocol-free fold). */
  readonly acquisition: {
    readonly view: AcquisitionStatusView | null;
    readonly diagnostics: AcquisitionDiagnosticsView | null;
  };
  /** The wired browser adapter's identity (inspectable, never a silent claim). */
  readonly implementation: string;
}

/** The player view's input (the shared shape of the shell + enrichment loaders). */
export interface PlayerViewInput {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly resumePositionMs?: number;
  /** R21-E: the preferred realization mode (the Where-to-watch switch). */
  readonly preferredMode?: PlaybackRealization["mode"];
  /**
   * R23-E: the preferred realization TRANSPORT (the authorized peer
   * copy — the first-class torrent realization; a transport kind,
   * never a playback mode).
   */
  readonly preferredRealization?: "torrent";
}

/**
 * Load the player SHELL (R24-E): the media path + the startup-critical
 * rows ONLY — the preferred-mode resolve, the playback session
 * resolution + surface preparation (or the authorized-peer-copy rung
 * decision), the resume/watch-state start, the Where-to-watch switch
 * row (the taxonomy's startup-critical classification), and the
 * session truths (progress scope, queue, attention mode, watchlist).
 *
 * The NONESSENTIAL enrichments (the AI tray, the intelligence
 * artifacts, the live-ASR route, the related projection) are NOT
 * loaded here — they ride the deferred lane (loadPlayerEnrichments),
 * which the page starts only AFTER this resolves and streams in behind
 * the shell (the R24-E startup architecture law, enforced
 * structurally: the shell's flush never waits on them).
 */
export async function loadPlayerViewShell(
  host: WebRuntimeHost,
  input: PlayerViewInput,
): Promise<PlayerShellView> {
  learnJoinedItem({
    connectorId: input.connectorId,
    externalRef: input.externalRef,
    title: input.title,
    canonicalType: input.canonicalType,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  });
  // R23 web-A: the session truth of THIS surface's binding — the
  // progress-scope sentence (session-local for anonymous sessions, with
  // sign-in as the optional upgrade) and the typed provider-authorization
  // truth when the resolve failed on the source's OWN authorization.
  const viewer = viewerKindOf(host.session.state);
  const progressScope = progressScopeTruthOf(viewer);
  // R26-W2 — the CLIENT-CARRIED playback intent (the multi-instance law):
  // the exact resolve input this shell hands the media path, serialized
  // into the view so the chrome can carry it with every command. The
  // torrent branch keeps null (its "session" is the adapter's own rung
  // decision, never a runtime session).
  const clientIntent: ClientPlaybackIntent = {
    itemId: input.itemId,
    externalRef: input.externalRef,
    connectorId: input.connectorId,
    ...(input.resumePositionMs !== undefined && input.resumePositionMs > 0
      ? { resumePositionMs: input.resumePositionMs }
      : {}),
    ...(input.preferredMode !== undefined ? { preferredMode: input.preferredMode } : {}),
    ...(input.preferredRealization !== undefined
      ? { preferredRealization: input.preferredRealization }
      : {}),
  };
  // R24-W2 — the attention mode (the autoplay/preview policy derivation;
  // the runtime's own policy read — the same seam the Personalize control
  // renders, never a second policy) + the watchlist membership truth.
  const attentionMode = host.runtime.intents.policy().attentionMode;
  const watchlistSaved = host.runtime.libraryOps
    .entries()
    .some((entry) => entry.itemId === input.itemId);
  const providerAuthorizationOf_ = (failureKind: string): PlayerView["providerAuthorization"] => {
    if (failureKind !== "unauthorized") return null;
    return {
      connectorId: input.connectorId,
      sentence: `This needs ${input.connectorId}'s own sign-in — that is the source's requirement, not a WebFlix account. Reconnect the source to keep watching.`,
      reconnectHref: "/settings?section=sources",
    };
  };

  // -------------------------------------------------------------------------
  // R24-E — THE MEDIA PATH LEADS (the startup architecture law).
  //
  // The frozen law: "resolve the canonical item and playback realization
  // without an unnecessary serial chain" + "do not wait for
  // recommendation or AI enrichment before playback". The audit found
  // this view serialized the where-to-watch/AI-tray/live-ASR/intelligence
  // reads BEFORE the playback resolution — the player's first paint
  // waited on enrichment work. The corrected order:
  //
  //   1. THE MEDIA PATH: the preferred-mode realization resolve, the
  //      playback session resolution + surface preparation (or the
  //      authorized-peer-copy rung decision — the local path);
  //   2. THE ENRICHMENTS (parallel, never blocking the media path):
  //      where-to-watch, the AI tray, the intelligence artifacts, the
  //      live-ASR route, the related/up-next projection — each degrades
  //      to its own honest section state (the page renders regardless).
  // -------------------------------------------------------------------------

  // R23-E — the authorized peer copy branch (the first-class torrent
  // realization): the player prefers the peer copy when asked
  // (`&realization=torrent`). The R23-C rung decision (verbatim) answers
  // the stage's truth: the BROWSER rung when this adapter can play it,
  // the honest Desktop next step when it cannot, the typed refusal if
  // the copy is not authorized (never offered by the surfaces; the
  // defensive truth). The provider playback resolution is SKIPPED for
  // this render — the peer copy path never consults a provider
  // realization.
  if (input.preferredRealization === "torrent") {
    const peerCopy = torrentRealizationOf(host, input.externalRef, input.connectorId);
    // The STARTUP-CRITICAL row (the taxonomy's own classification):
    // the Where-to-watch switch composes with the rung decision (the
    // play decision's own surface — R24-E's essential lane). The
    // nonessential enrichments ride the deferred lane
    // (loadPlayerEnrichments — streamed behind the shell, never
    // awaited here).
    const whereToWatch = await loadWhereToWatchView(host, {
      itemId: input.itemId,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      title: input.title,
      canonicalType: input.canonicalType,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    });
    if (peerCopy === null) {
      return {
        mode: host.mode,
        kind: "session",
        itemId: input.itemId,
        title: input.title,
        canonicalType: input.canonicalType,
        connectorId: input.connectorId,
        externalRef: input.externalRef,
        sessionId: "none",
        sessionIntent: null,
        surfaceMode: "browser",
        surfaceUrl: null,
        realizationCapabilities: [],
        resumePositionMs: 0,
        durationMs: input.durationMs ?? null,
        phase: "failed",
        skippedForCapability: [],
        browserSurface: null,
        failure: {
          kind: "not-found",
          detail:
            "no authorized peer copy is known for this title on this host — choose another way to watch below",
        },
        precedenceTrace: [],
        embedAttestation: null,
        externalReturn: null,
        whereToWatch,
        progressScope,
        providerAuthorization: null,
        torrent: null,
        queue: sessionQueue().state(),
        attentionMode,
        watchlistSaved,
      };
    }
    const rung = peerCopy.rung;
    const torrentView: TorrentPlayerView = {
      label: peerCopy.label,
      detail: peerCopy.detail,
      rungKind: rung.kind,
      rungDetail: rung.detail,
      desktopNextStep:
        rung.kind === "desktop-next-step" ? rung.nextStep : null,
      acquisition: acquisitionBlockOf(host, input.itemId),
      implementation: WEB_BROWSER_TORRENT_IMPLEMENTATION,
    };
    // The parity surfaces all render (Where-to-watch switch row, the AI
    // tray, the feedback controls, the actions) — the same canonical
    // identity, the same recovery vocabulary (the R23-C parity set).
    if (rung.kind === "satisfies-browser-rung") {
      // The telemetry parity: the peer-copy play applies the same
      // watch-state start command the provider path applies at play
      // time (the resume position carried; the same fold).
      await host.runtime
        .updateWatchState({
          kind: "start",
          itemId: input.itemId,
          ...(input.resumePositionMs !== undefined && input.resumePositionMs > 0
            ? { positionMs: input.resumePositionMs }
            : {}),
        })
        .catch(() => undefined);
    }
    return {
      mode: host.mode,
      kind: "session",
      itemId: input.itemId,
      title: input.title,
      canonicalType: input.canonicalType,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      sessionId: "wfx-peercopy",
      sessionIntent: null,
      surfaceMode: "browser",
      surfaceUrl: null,
      realizationCapabilities: [],
      resumePositionMs: input.resumePositionMs ?? 0,
      durationMs: input.durationMs ?? null,
      phase: rung.kind === "satisfies-browser-rung" ? "buffering" : "failed",
      skippedForCapability:
        rung.kind === "desktop-next-step"
          ? [{ mode: "browser", reason: rung.detail }]
          : [],
      browserSurface: null,
      failure:
        rung.kind === "requires-authorization"
          ? { kind: "unauthorized", detail: rung.detail }
          : null,
      precedenceTrace: [
        "authorized peer copy (torrent transport) — the browser rung via WebRTC-capable peers",
      ],
      embedAttestation: null,
      externalReturn: null,
      whereToWatch,
      progressScope,
      providerAuthorization: null,
      torrent: torrentView,
      queue: sessionQueue().state(),
      attentionMode,
      watchlistSaved,
    };
  }
  // R21-E: the Where-to-watch switch — resolve the preferred mode's
  // realization and hand it to the runtime (still capability-checked: an
  // unusable preference answers the typed capability failure, never a
  // fake stage). A mode nobody offers is NOT forced: the runtime's own
  // precedence answers, and the switch row names what IS offered.
  let preferredRealization: PlaybackRealization | undefined;
  if (input.preferredMode !== undefined) {
    const resolved = await host.serverPort.resolve(input.externalRef);
    if (resolved.ok && Array.isArray(resolved.value)) {
      preferredRealization = resolved.value.find(
        (realization) => realization.mode === input.preferredMode,
      );
    }
  }

  // THE MEDIA PATH (R24-E: FIRST — the playback resolution + the surface
  // engagement complete before any enrichment read runs). The typed
  // outcome carries every media field the view renders; the enrichments
  // compose AFTER (each degrading to its own honest section state).
  type ProviderMediaOutcome =
    | {
        kind: "session";
        session: PlaybackSession;
        state: ReturnType<PlaybackController["state"]>;
        browserSurface: { id: string; url: string } | null;
        embedAttestation: PlayerView["embedAttestation"];
        externalReturn: PlayerView["externalReturn"];
      }
    | { kind: "prepare-failed"; session: PlaybackSession; detail: string }
    | {
        kind: "no-controller";
        sessionId: string;
        surfaceMode: PlaybackRealization["mode"];
        surfaceUrl: string | null;
        realizationCapabilities: readonly string[];
        resumePositionMs: number;
      }
    | { kind: "resolve-failed"; failureKind: string; detail: string };
  let media: ProviderMediaOutcome;
  try {
    const session = await host.runtime.resolvePlayback({
      itemId: input.itemId,
      externalRef: input.externalRef,
      // R17: attribute the resolve to its source — the honest unavailable
      // dead end names the missing source (never a source-less error).
      connectorId: input.connectorId,
      ...(preferredRealization !== undefined ? { realization: preferredRealization } : {}),
      ...(input.resumePositionMs !== undefined && input.resumePositionMs > 0
        ? { resumePositionMs: input.resumePositionMs }
        : {}),
    });
    const controller = host.runtime.playback.controller(session.id);
    if (controller === undefined) {
      media = {
        kind: "no-controller",
        sessionId: session.id,
        surfaceMode: session.realization.mode,
        surfaceUrl: session.realization.url ?? null,
        realizationCapabilities: [...session.realization.capabilities],
        resumePositionMs: session.resumePositionMs,
      };
    } else {
      // Engage the surface for the resolved mode (embed/browser open the
      // contained surface — the rendered mount records it and the state
      // carries it; external resolves synchronously as the handoff signal).
      const prepared = await controller.prepare();
      const state = controller.state();
      // The session-scoped contained-surface view (the controller's own
      // engaged surface — never a process-global sniff).
      const browserSurface =
        state.containedSurface !== undefined
          ? { id: state.containedSurface.id, url: state.containedSurface.url }
          : null;
      // R09: the official-embed attestation of the chosen realization
      // (null for non-embed modes — never fabricated).
      const embedAttestation: PlayerView["embedAttestation"] =
        session.realization.mode === "embed"
          ? isOfficialEmbed(session.realization)
            ? "official"
            : "unofficial"
          : null;
      // R09 (J09): the external handoff's return context — the durable
      // continuation (item + position at handoff) so the journey can return.
      // The handoff instant is the adapter's real clock read (the same law
      // the web host's boot seams follow).
      const externalReturn: PlayerView["externalReturn"] =
        session.realization.mode === "external"
          ? buildExternalReturnContext(
              {
                itemId: input.itemId,
                connectorId: session.realization.connectorId,
                externalRef: session.realization.externalRef ?? input.externalRef,
                positionMs: session.resumePositionMs,
              },
              new Date(new WebClock().now()).toISOString(),
            )
          : null;
      media = prepared.ok
        ? { kind: "session", session, state, browserSurface, embedAttestation, externalReturn }
        : { kind: "prepare-failed", session, detail: prepared.detail };
      // R24-W2 — the playback session bridge: record the resolved
      // session's intent so the /api/playback route's module can re-resolve
      // the SAME intent when the dev server's split module graphs isolate
      // the page's runtime from the route's (the documented doctrine; the
      // single-bundle production boot takes the direct path).
      if (prepared.ok) {
        recordPlaybackSession({
          sessionId: session.id,
          itemId: input.itemId,
          externalRef: input.externalRef,
          connectorId: input.connectorId,
          ...(input.resumePositionMs !== undefined && input.resumePositionMs > 0
            ? { resumePositionMs: input.resumePositionMs }
            : {}),
          ...(input.preferredMode !== undefined ? { preferredMode: input.preferredMode } : {}),
          ...(input.preferredRealization !== undefined
            ? { preferredRealization: input.preferredRealization }
            : {}),
        });
      }
    }
  } catch (thrown) {
    // resolvePlayback throws the typed RuntimeError for resolution failures
    // (unresolvable/unsupported/network...) — carried verbatim, never faked.
    const kind = (thrown as { kind?: unknown }).kind;
    media = {
      kind: "resolve-failed",
      failureKind: typeof kind === "string" ? kind : "unavailable",
      detail: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }

  // THE STARTUP-CRITICAL ROW (R24-E's essential lane): the
  // Where-to-watch switch composes after the media path (the play
  // decision's own surface — the taxonomy's startup-critical
  // classification). The NONESSENTIAL enrichments (the AI tray, the
  // intelligence artifacts, the live-ASR route, the related/up-next
  // projection) are NOT loaded here: they ride the deferred lane
  // (loadPlayerEnrichments), which the page starts only after this
  // shell resolves and streams in behind it — never blocking the
  // player's startup.
  const whereToWatch = await loadWhereToWatchView(host, {
    itemId: input.itemId,
    connectorId: input.connectorId,
    externalRef: input.externalRef,
    title: input.title,
    canonicalType: input.canonicalType,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  });

  if (media.kind === "resolve-failed") {
    return {
      mode: host.mode,
      kind: "session",
      itemId: input.itemId,
      title: input.title,
      canonicalType: input.canonicalType,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      sessionId: "none",
      sessionIntent: clientIntent,
      surfaceMode: "external",
      surfaceUrl: null,
      realizationCapabilities: [],
      resumePositionMs: 0,
      durationMs: input.durationMs ?? null,
      phase: "failed",
      skippedForCapability: [],
      browserSurface: null,
      failure: { kind: media.failureKind, detail: media.detail },
      precedenceTrace: [],
      embedAttestation: null,
      externalReturn: null,
      whereToWatch,
      progressScope,
      providerAuthorization: providerAuthorizationOf_(media.failureKind),
      torrent: null,
      queue: sessionQueue().state(),
      attentionMode,
      watchlistSaved,
    };
  }
  if (media.kind === "no-controller") {
    return {
      mode: host.mode,
      kind: "session",
      itemId: input.itemId,
      title: input.title,
      canonicalType: input.canonicalType,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      sessionId: media.sessionId,
      sessionIntent: clientIntent,
      surfaceMode: media.surfaceMode,
      surfaceUrl: media.surfaceUrl,
      realizationCapabilities: [...media.realizationCapabilities],
      resumePositionMs: media.resumePositionMs,
      durationMs: input.durationMs ?? null,
      phase: "failed",
      skippedForCapability: [],
      browserSurface: null,
      failure: { kind: "not-found", detail: "the runtime does not know this playback session" },
      precedenceTrace: [],
      embedAttestation: null,
      externalReturn: null,
      whereToWatch,
      progressScope,
      providerAuthorization: providerAuthorizationOf_("not-found"),
      torrent: null,
      queue: sessionQueue().state(),
      attentionMode,
      watchlistSaved,
    };
  }
  if (media.kind === "prepare-failed") {
    return {
      mode: host.mode,
      kind: "session",
      itemId: input.itemId,
      title: input.title,
      canonicalType: input.canonicalType,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      sessionId: media.session.id,
      sessionIntent: clientIntent,
      surfaceMode: media.session.realization.mode,
      surfaceUrl: media.session.realization.url ?? null,
      realizationCapabilities: [...media.session.realization.capabilities],
      resumePositionMs: media.session.resumePositionMs,
      durationMs: input.durationMs ?? null,
      phase: "failed",
      skippedForCapability: [{ mode: media.session.realization.mode, reason: media.detail }],
      browserSurface: null,
      failure: { kind: "unavailable", detail: media.detail },
      precedenceTrace: [],
      embedAttestation: null,
      externalReturn: null,
      whereToWatch,
      progressScope,
      providerAuthorization: null,
      torrent: null,
      queue: sessionQueue().state(),
      attentionMode,
      watchlistSaved,
    };
  }
  return {
    mode: host.mode,
    kind: "session",
    itemId: input.itemId,
    title: input.title,
    canonicalType: input.canonicalType,
    connectorId: input.connectorId,
    externalRef: input.externalRef,
    sessionId: media.session.id,
    sessionIntent: clientIntent,
    surfaceMode: media.session.realization.mode,
    surfaceUrl: media.session.realization.url ?? null,
    realizationCapabilities: [...media.session.realization.capabilities],
    resumePositionMs: media.session.resumePositionMs,
    durationMs: input.durationMs ?? null,
    phase: media.state.phase,
    skippedForCapability: [],
    browserSurface: media.browserSurface,
    failure: null,
    precedenceTrace: [...(media.state.precedenceTrace ?? [])],
    embedAttestation: media.embedAttestation,
    externalReturn: media.externalReturn,
    whereToWatch,
    progressScope,
    providerAuthorization: null,
    torrent: null,
    queue: sessionQueue().state(),
    attentionMode,
    watchlistSaved,
  };
}

/**
 * Load the player's NONESSENTIAL enrichments (R24-E's deferred lane):
 * the AI action tray, the derived intelligence artifacts, the live-ASR
 * route, and the related/up-next projection. Each degrades to its own
 * honest section state — a typed failure in any of them answers its
 * own section, never a blank page and never a blocked player.
 *
 * THE START LAW: the page starts this work only AFTER the media path
 * resolved (the audit's order finding — the enrichment reads fire
 * after `resolvePlayback`/prepare), then streams the sections in as
 * they resolve (Suspense) WITHOUT awaiting them for the shell's flush:
 * playback never waits on the deferred lane.
 */
export async function loadPlayerEnrichments(
  host: WebRuntimeHost,
  input: PlayerViewInput,
): Promise<PlayerEnrichments> {
  const [aiTray, intelligence, liveAsr, realtime, related] = await Promise.all([
    loadAiTrayView(host, {
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      title: input.title,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    }),
    loadItemIntelligence(host, input.externalRef),
    loadLiveAsrRoute(host, input.externalRef),
    loadRealtimeRouteView({ externalRef: input.externalRef }),
    relatedCardsOf(host, input.itemId),
  ]);
  return { aiTray, intelligence, liveAsr, realtime, related };
}

/**
 * Load the COMPLETE composed player view (the shell + the enrichments):
 * the composed API for the consumers that await everything (the tests'
 * view-model assertions, the non-page surfaces). The PAGE uses the
 * split (loadPlayerViewShell awaited + loadPlayerEnrichments streamed)
 * — this composed path preserves the same order law (the shell's media
 * path resolves BEFORE any enrichment read fires).
 */
export async function loadPlayerView(
  host: WebRuntimeHost,
  input: PlayerViewInput,
): Promise<PlayerView> {
  const shell = await loadPlayerViewShell(host, input);
  // The deferred lane starts only AFTER the media path resolved (the
  // R24-E order law — the audit's original finding stays fixed in both
  // the split AND the composed path).
  const enrichments = await loadPlayerEnrichments(host, input);
  return { ...shell, ...enrichments };
}

// ---------------------------------------------------------------------------
// Library view
// ---------------------------------------------------------------------------

/** One watchlist entry view (the runtime's canonical-keyed entry). */
export interface WatchlistEntryView {
  readonly itemId: string;
  readonly title: string;
  readonly listName: string;
  readonly sync: string;
  readonly savedAt: string;
  readonly detail?: string;
  readonly joined: JoinedItem | null;
}

/** One history entry view (the watch fold + the joined identity). */
export interface HistoryEntryView {
  readonly itemId: string;
  readonly title: string;
  readonly positionMs: number;
  readonly completionRatio: number | null;
  readonly status: string;
  readonly lastWatchedAt: string;
  readonly joined: JoinedItem | null;
}

/**
 * R14 — one OFFLINE library entry view: a verified offline copy (the
 * runtime's `ready-offline` acquisition view — the R13 exposure composed
 * with the R04 canonical key; the fold guarantees ONE entry per canonical
 * identity, so this list can never duplicate rows).
 */
export interface OfflineReadyEntryView {
  readonly itemId: string;
  readonly title: string;
  /** `Ready offline` (the earned verdict — always this label here). */
  readonly label: string;
  /** Total verified size in bytes. */
  readonly sizeBytes: number;
  /** How many verified assets the exposure landed. */
  readonly assetCount: number;
  readonly joined: JoinedItem | null;
}

/** The library view model (all sections, statuses verbatim). */
export interface LibraryView {
  readonly mode: "fixtures" | "service";
  readonly watchlist: {
    readonly status: { readonly state: "ready" | "error"; readonly errorDetail?: string };
    readonly entries: readonly WatchlistEntryView[];
  };
  readonly history: {
    readonly status: { readonly state: "ready" | "error"; readonly errorDetail?: string };
    readonly entries: readonly HistoryEntryView[];
  };
  /** R14 — the verified offline copies (J26's Library section). */
  readonly offline: {
    readonly entries: readonly OfflineReadyEntryView[];
  };
  /**
   * R24-W2 — the playlists projection: the watchlist's NAMED lists
   * (the runtime's listName seam — the same canonical-keyed writes,
   * grouped by list; the default watchlist list stays the Watchlist
   * section above). One write path, two honest sections.
   */
  readonly playlists: {
    readonly lists: readonly {
      readonly name: string;
      readonly entries: readonly WatchlistEntryView[];
    }[];
  };
}

/** Load the library view from the runtime's library read model. */
export async function loadLibraryView(host: WebRuntimeHost): Promise<LibraryView> {
  const model = await host.runtime.library();
  // R14 — the verified offline copies: the runtime's ready-offline
  // acquisition views (the R13 exposure composed with the R04 canonical
  // keys — one entry per canonical identity by construction). Joined to
  // the item identity this process knows; the acquisition view's own
  // title is the honest fallback (never fabricated).
  if (host.mode === "fixtures") reportAcquisitionFixtures(host);
  const offlineEntries: OfflineReadyEntryView[] = host.runtime.acquisition
    .views()
    .filter((view) => view.state === "ready-offline")
    .map((view) => ({
      itemId: view.itemId,
      title: view.title ?? joinedItemOf(view.itemId)?.title ?? view.itemId,
      label: view.label,
      sizeBytes: view.offline?.sizeBytes ?? 0,
      assetCount: view.offline?.assetCount ?? 0,
      joined: joinedItemOf(view.itemId),
    }));
  // R24-W2 — the watchlist entry views (the playlists projection's source:
  // the same canonical-keyed entries, grouped by their list name).
  const watchlistEntries: WatchlistEntryView[] = model.watchlist.entries.map((entry) => ({
    itemId: entry.itemId,
    title: entry.title,
    listName: entry.listName,
    sync: entry.sync,
    savedAt: entry.savedAt,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    joined: joinedItemOf(entry.itemId),
  }));
  // The playlists: the NAMED lists (the default "Saved" list stays the
  // Watchlist section; every other list name renders as its own playlist).
  const playlistLists = new Map<string, WatchlistEntryView[]>();
  for (const entry of watchlistEntries) {
    if (entry.listName === "Saved") continue;
    const bucket = playlistLists.get(entry.listName);
    if (bucket === undefined) {
      playlistLists.set(entry.listName, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  return {
    mode: host.mode,
    watchlist: {
      status:
        model.watchlist.status.state === "ready"
          ? { state: "ready" }
          : { state: "error", errorDetail: model.watchlist.status.errorDetail ?? "the watchlist read failed" },
      entries: watchlistEntries,
    },
    history: {
      status:
        model.history.status.state === "ready"
          ? { state: "ready" }
          : { state: "error", errorDetail: model.history.status.errorDetail ?? "the history read failed" },
      entries: model.history.entries.map((entry) => ({
        itemId: entry.itemId,
        title: entry.title,
        positionMs: entry.watch.lastPositionMs,
        completionRatio: entry.watch.completionRatio,
        status: entry.watch.status,
        lastWatchedAt: entry.watch.lastWatchedAt,
        joined: joinedItemOf(entry.itemId),
      })),
    },
    offline: { entries: offlineEntries },
    playlists: {
      lists: [...playlistLists.entries()].map(([name, entries]) => ({ name, entries })),
    },
  };
}

/** Save one canonical item through the runtime (the library write law). */
export async function saveToWatchlist(
  host: WebRuntimeHost,
  itemId: string,
): Promise<{ ok: boolean; detail: string }> {
  const result = await host.runtime.libraryOps.save({ itemId });
  return result.ok
    ? { ok: true, detail: "Saved to your watchlist." }
    : { ok: false, detail: `${result.kind}: ${result.detail}` };
}

// ---------------------------------------------------------------------------
// Actions view helper
// ---------------------------------------------------------------------------

/**
 * Dispatch one user action through the runtime (like/save/follow) and map
 * the settled state verbatim — the `unsupported`/`failed` statuses are
 * carried AS-IS so the UI can render them as the truth they are (the
 * runtime's action-state law: unsupported is never rendered as success).
 */
export async function dispatchActionThroughRuntime(
  host: WebRuntimeHost,
  action: UserAction,
): Promise<
  | { readonly ok: true; readonly status: string; readonly detail?: string }
  | { readonly ok: false; readonly error: string }
> {
  try {
    const state = await host.runtime.dispatchAction(action);
    return {
      ok: true,
      status: state.status,
      ...(state.detail !== undefined ? { detail: state.detail } : {}),
    };
  } catch (thrown) {
    return {
      ok: false,
      error: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }
}

// ---------------------------------------------------------------------------
// TEST SEAM
// ---------------------------------------------------------------------------

/** TEST-ONLY: clear the item join (host/testing.ts consumes this). */
export function resetItemJoinForTests(): void {
  itemJoin.clear();
}
