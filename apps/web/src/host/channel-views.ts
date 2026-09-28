/**
 * @wfx/app-web — R36 — THE CHANNEL ENTITY + THE CHANNEL PAGE VIEW MODELS.
 *
 * THE DERIVATION LAW (the survey's row 17, honestly bound): a CHANNEL =
 * a catalog source's creator identity. Every field derives from the
 * source's OWN declared truth — the sources model's `SourceInfo` (the
 * same seam the R33-C channel-slot identity reads) + the channel's items
 * as the runtime's own search transport surfaces them. NOTHING is
 * fabricated:
 *
 * - HANDLE: the slugified stable connector id (`channelHandleOf` — the
 *   pure href law; never a fabricated "@name" form).
 * - DISPLAY NAME: the sources model's own `displayName` (the N29/R33-C
 *   seam), the connector id as the honest fallback.
 * - AVATAR: the honest MONOGRAM (the corpus 80px channel-avatar slot on
 *   this host — no source declares a channel photo; the same stand-in
 *   the watch channel row, the search result avatar, and the rail
 *   subscriptions carry). Where a source ever declares channel artwork
 *   the derivation extends — until then the monogram is the typed truth.
 * - BANNER: the typed-ABSENCE strip by default; a derived-art fallback
 *   ONLY from the source's own artwork (the channel's items' real
 *   source-authorized thumbnails — the `contentArtworkOf` seam). NEVER
 *   a fabricated image.
 * - DESCRIPTION / LINKS: the source declares neither on this host —
 *   typed absence (the R28 law verbatim: the honest named state, never
 *   a dead imitation and never invented copy).
 * - JOIN DATE: the source's own connected-since truth (`authorizedAt`)
 *   when the sources model declares one — rendered as "Connected since
 *   <date>" (the honest phrasing for a source-connection date, never a
 *   fabricated YouTube "Joined" claim); typed absence otherwise.
 * - SUBSCRIBER COUNT: NEVER fabricated. No reachable seam declares a
 *   channel's subscriber count (the sources model carries none; the
 *   service's channel-summary projection is not surfaced through the
 *   ServerPort) — the count slot renders the typed-absence state. The
 *   user's OWN subscription truth (the stored Subscriptions list, the
 *   connector-scoped read) is the real datum the page shows beside it.
 *
 * THE ITEM DERIVATION (the honest channel feed): the channel's items are
 * the hits the runtime's REAL search transport answers for the app's own
 * documented discovery seeds (`TRENDING_QUERY`/`FOR_YOU_QUERY`/
 * `SHORTS_SEED_QUERY` — the same composition the home view renders),
 * UNIONed, deduped by canonical id, and scoped to the channel's
 * connectorId. Every card is a hit the transport really answered —
 * never a fabricated catalog row. The per-item `publishedAt`/`viewCount`
 * read the source's own item METADATA (validated; absent when the source
 * declares none) and power the Videos tab's sort options HONESTLY (the
 * SearchFilters law: an option without real backing is absent, never
 * dead).
 *
 * Server-side only (the host seam) — the surfaces render these views;
 * the client Subscribe/Bell islands are their own components.
 */

import type {
  ContinueWatchingEntry,
  SearchHit,
} from "@wfx/client-runtime";
import type { EntertainmentItem, LibraryEntry, SearchResult } from "@wfx/domain";
import type { SourceInfo } from "@wfx/client-runtime";
import { isShortFormCandidate } from "@wfx/experience";

import type { WebRuntimeHost } from "@/host/web-host";
import {
  FOR_YOU_QUERY,
  SHORTS_SEED_QUERY,
  TRENDING_QUERY,
  cardFromHit,
  joinedItemByExternalRef,
  joinedItemOf,
} from "@/host/view-models";
import type {
  ArtworkView,
  CardView,
  WatchlistEntryView,
} from "@/host/view-models";
import { SUBSCRIPTIONS_LIST } from "@/components/player/subscription-list";
import { channelHandleOf } from "@/app/href";

// ---------------------------------------------------------------------------
// The typed-absence family (the R28 law verbatim)
// ---------------------------------------------------------------------------

/**
 * One honestly-absent field: the named state + the honest sentence that
 * says WHY it is absent (the frozen vocabulary — never a silent blank,
 * never a fabricated value in its place).
 */
export interface AbsentTruth {
  readonly kind: "absent";
  readonly note: string;
}

/** One declared field (the source's own truth, carried verbatim). */
export interface DeclaredText {
  readonly kind: "declared";
  readonly text: string;
}

/** One declared instant (ISO 8601, the source's own field). */
export interface DeclaredDate {
  readonly kind: "declared";
  readonly iso: string;
}

/** The channel banner's typed states (absent, or the source's own art). */
export type ChannelBanner =
  | AbsentTruth
  | { readonly kind: "derived-art"; readonly artwork: ArtworkView; readonly note: string };

// ---------------------------------------------------------------------------
// The channel identity
// ---------------------------------------------------------------------------

/** A channel's honest identity (every field per the derivation law). */
export interface ChannelIdentity {
  /** The source's stable connector id (the identity the sources model declares). */
  readonly connectorId: string;
  /** The slugified stable handle (`channelHandleOf`). */
  readonly handle: string;
  /** The sources model's own displayName (the R33-C seam); the connector id fallback. */
  readonly displayName: string;
  /** The honest monogram avatar (this host's sources declare no channel photo). */
  readonly avatar: {
    readonly kind: "monogram";
    readonly mark: string;
    readonly note: string;
  };
  /** The banner: typed absence, or derived art from the source's own artwork only. */
  readonly banner: ChannelBanner;
  /** The description: only where the source declares one; typed absence otherwise. */
  readonly description: DeclaredText | AbsentTruth;
  /** The channel links: no source declares any on this host — typed absence. */
  readonly links: AbsentTruth;
  /** The source's own connected-since truth when declared; typed absence otherwise. */
  readonly connectedSince: DeclaredDate | AbsentTruth;
  /**
   * The subscriber count: NEVER fabricated. Only a source-declared count
   * can occupy this slot (none is reachable through the ServerPort
   * today) — the typed absence otherwise.
   */
  readonly subscriberCount: { readonly kind: "declared"; readonly count: number } | AbsentTruth;
  /**
   * The verified badge: source-declared only. No source on this host
   * declares a verification claim — the honest absence (never a
   * fabricated checkmark).
   */
  readonly verifiedBadge: AbsentTruth;
}

/** The sources-model row the channel identity derives from. */
export type ChannelSourceRow = SourceInfo;

// ---------------------------------------------------------------------------
// The channel item view (the channel's own items, with the sort truths)
// ---------------------------------------------------------------------------

/** One channel item: the card grammar + the declared sort truths. */
export interface ChannelItemView {
  readonly card: CardView;
  /** The source-declared publish instant (validated ISO) when carried in item metadata. */
  readonly publishedAt: string | null;
  /** The source-declared popularity metric (views) when carried in item metadata. */
  readonly viewCount: number | null;
  /** The orientation the search hit carried (the short-form eligibility's input). */
  readonly orientation: SearchResult["orientation"];
  /** The continue-watching truth when the session's watch fold knows this item. */
  readonly resume: { readonly resumePositionMs: number; readonly completionRatio: number | null } | null;
}

// ---------------------------------------------------------------------------
// The channel page view
// ---------------------------------------------------------------------------

/** The channel page's tab vocabulary (the YouTube grammar, honestly bound). */
export type ChannelTab = "home" | "videos" | "shorts" | "playlists" | "about";

/** Every value of {@link ChannelTab} (the tab bar's own set). */
export const CHANNEL_TABS: readonly ChannelTab[] = [
  "home",
  "videos",
  "shorts",
  "playlists",
  "about",
] as const;

/** The channel-tab label (the corpus tab names). */
export function channelTabLabel(tab: ChannelTab): string {
  switch (tab) {
    case "home":
      return "Home";
    case "videos":
      return "Videos";
    case "shorts":
      return "Shorts";
    case "playlists":
      return "Playlists";
    case "about":
      return "About";
  }
}

/** The Videos tab's sort vocabulary (only the options with real backing render). */
export type ChannelSort = "latest" | "popular" | "oldest";

/** The typed outcome of resolving a channel by handle. */
export type ChannelResolution =
  | { readonly ok: true; readonly source: SourceInfo }
  | { readonly ok: false; readonly reason: "not-found" };

/** The channel page view (the surface renders this). */
export interface ChannelView {
  readonly mode: "fixtures" | "service";
  readonly identity: ChannelIdentity;
  readonly tab: ChannelTab;
  /** The channel-search filter (the in-channel `?q=` — null when none). */
  readonly query: string | null;
  /** The Videos tab's applied sort (null = the channel's own feed order). */
  readonly sort: ChannelSort | null;
  /** The tab's items (already filtered by the query and sorted per `sort`). */
  readonly items: readonly ChannelItemView[];
  /** The honest sort availability (the SearchFilters law — absent options never render). */
  readonly sortAvailability: {
    readonly latest: boolean;
    readonly oldest: boolean;
    readonly popular: boolean;
    readonly note: string;
  };
  /** The user's own subscription truth (the connector-scoped Subscriptions read). */
  readonly subscribed: boolean;
  /** The channel's subscribed entries (the unsubscribe write's targets — full source identities). */
  readonly subscribedTargets: readonly {
    readonly itemId: string;
    readonly title: string;
    readonly connectorId: string;
    readonly externalRef: string;
  }[];
  /** The channel's representative item (the Subscribe write's item identity). */
  readonly representative: {
    readonly itemId: string;
    readonly title: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly canonicalType: string;
  } | null;
  /** The library's named lists holding this channel's items (the Playlists tab). */
  readonly playlists: readonly {
    readonly name: string;
    readonly entries: readonly WatchlistEntryView[];
  }[];
  /** The honest About stats (derived from the channel's own item set — real counts). */
  readonly stats: {
    readonly videoCount: number;
    readonly shortsCount: number;
    readonly playlistCount: number;
    readonly subscribedHere: boolean;
  };
}

/** The typed not-found view the route renders when no source owns the handle. */
export interface ChannelNotFoundView {
  readonly mode: "fixtures" | "service";
  readonly handle: string;
}

// ---------------------------------------------------------------------------
// The directory (the catalog's real source set)
// ---------------------------------------------------------------------------

/**
 * The channel directory: the sources model's own rows (the catalog's
 * real source set), each with its derived handle. A failing sources
 * read answers the EMPTY directory (the connector-scoped surfaces keep
 * their connector-id fallback identity — never a fabricated channel).
 */
export async function loadChannelDirectory(
  host: WebRuntimeHost,
): Promise<readonly SourceInfo[]> {
  try {
    const sources = await host.runtime.sources.refresh();
    return sources.sources;
  } catch {
    return [];
  }
}

/**
 * Resolve one channel by its HANDLE (the route's input): the directory
 * row whose derived handle matches (case-insensitive). The typed
 * not-found answers honestly — never a guessed channel.
 */
export async function resolveChannelByHandle(
  host: WebRuntimeHost,
  handle: string,
): Promise<ChannelResolution> {
  const directory = await loadChannelDirectory(host);
  const wanted = handle.trim().toLowerCase();
  const source = directory.find(
    (row) => channelHandleOf(row.connectorId).toLowerCase() === wanted,
  );
  if (source === undefined) return { ok: false, reason: "not-found" };
  return { ok: true, source };
}

// ---------------------------------------------------------------------------
// The item derivation (the honest channel feed)
// ---------------------------------------------------------------------------

/**
 * The discovery seed queries the channel's items derive from — the SAME
 * documented composition the home view renders (the app's own discovery
 * seeds; the union covers each source's surfaced items, deduped by the
 * canonical id). Every channel card is a hit the REAL search transport
 * answered for one of these seeds — never a fabricated catalog row.
 *
 * (A FUNCTION, not a module-init constant: this module and view-models
 * import each other — the seeds are read at CALL time, after both
 * modules have evaluated; a const would capture view-models' partially
 * initialized exports.)
 */
export function channelItemQueries(): readonly string[] {
  return [TRENDING_QUERY, FOR_YOU_QUERY, SHORTS_SEED_QUERY];
}

/** The item metadata keys the source's own declared sort truths ride (validated before use). */
const PUBLISHED_AT_METADATA_KEY = "publishedAt";
const VIEW_COUNT_METADATA_KEY = "viewCount";

/** Validate a source-declared publish instant (honest: unparseable ⇒ null). */
function declaredInstantOf(row: SearchResult): string | null {
  const raw = row.metadata?.[PUBLISHED_AT_METADATA_KEY];
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? raw : null;
}

/** Validate a source-declared popularity metric (honest: non-finite ⇒ null). */
function declaredViewCountOf(row: SearchResult): number | null {
  const raw = row.metadata?.[VIEW_COUNT_METADATA_KEY];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

/**
 * The channel's items: the discovery-seed hits scoped to the channel's
 * connectorId, deduped by canonical id (first sight wins — the join's
 * own display-data law). The seed order is the channel's own feed order
 * (the order the source's transport surfaces its content — the honest
 * default ordering; the sort options' availability derives from the
 * items' OWN declared truths).
 */
export async function channelItemsOf(
  host: WebRuntimeHost,
  connectorId: string,
): Promise<readonly ChannelItemView[]> {
  const models = await Promise.all(
    channelItemQueries().map((query) => host.runtime.search({ query })),
  );
  const seen = new Set<string>();
  const items: ChannelItemView[] = [];
  for (const model of models) {
    for (const hit of model.hits) {
      if (hit.result.connectorId !== connectorId) continue;
      if (seen.has(hit.canonicalItemId)) continue;
      seen.add(hit.canonicalItemId);
      items.push(channelItemOfHit(hit));
    }
  }
  return items;
}

/** Project one hit into the channel item view (the card grammar + the declared sort truths). */
function channelItemOfHit(hit: SearchHit): ChannelItemView {
  return {
    card: cardFromHit(hit),
    publishedAt: declaredInstantOf(hit.result),
    viewCount: declaredViewCountOf(hit.result),
    orientation: hit.result.orientation,
    resume: null,
  };
}

/** The short-form eligibility over the channel item view (the same law the shorts feed uses). */
export function isChannelShort(item: ChannelItemView): boolean {
  const candidate = {
    id: item.card.itemId,
    canonicalType: item.card.canonicalType,
    ...(item.card.durationMs !== undefined ? { durationMs: item.card.durationMs } : {}),
    ...(item.orientation !== undefined ? { orientation: item.orientation } : {}),
  } as EntertainmentItem;
  return isShortFormCandidate(candidate);
}

// ---------------------------------------------------------------------------
// The identity derivation
// ---------------------------------------------------------------------------

/** The monogram mark (the honest avatar law — the name's own first mark). */
function monogramMarkOf(name: string): string {
  return name.length > 0 ? name[0]!.toUpperCase() : "W";
}

/**
 * Derive the channel IDENTITY from the source's own declared truth (the
 * derivation law — every absent field carries its honest sentence).
 */
export function channelIdentityOf(
  source: SourceInfo,
  items: readonly ChannelItemView[],
): ChannelIdentity {
  const handle = channelHandleOf(source.connectorId);
  const displayName =
    typeof source.displayName === "string" && source.displayName.trim().length > 0
      ? source.displayName
      : source.connectorId;
  // The banner: derived art ONLY from the source's own artwork (the
  // channel's items' real source-authorized thumbnails — the first
  // artwork the channel's own feed carries). No artwork ⇒ the typed
  // absence strip.
  const artworkItem = items.find((item) => item.card.artwork !== undefined);
  const banner: ChannelBanner =
    artworkItem !== undefined && artworkItem.card.artwork !== undefined
      ? {
          kind: "derived-art",
          artwork: artworkItem.card.artwork,
          note: `Banner derived from this source's own artwork (the ${artworkItem.card.title} thumbnail) — the source declares no channel banner.`,
        }
      : {
          kind: "absent",
          note: "This source declares no channel banner — WebFlix does not fabricate one.",
        };
  // The connected-since truth: the source's own authorizedAt (the
  // authorization grant instant) — the honest phrasing names what it is.
  const connectedSince: DeclaredDate | AbsentTruth =
    typeof source.authorizedAt === "string" && source.authorizedAt.length > 0
      ? { kind: "declared", iso: source.authorizedAt }
      : {
          kind: "absent",
          note: "This source declares no connection date — WebFlix does not fabricate a join date.",
        };
  return {
    connectorId: source.connectorId,
    handle,
    displayName,
    avatar: {
      kind: "monogram",
      mark: monogramMarkOf(displayName),
      note: "This host's sources declare no channel photo — the honest monogram (the same stand-in every channel slot carries).",
    },
    banner,
    description: {
      kind: "absent",
      note: "This source declares no channel description — WebFlix does not write one for it.",
    },
    links: {
      kind: "absent",
      note: "This source declares no channel links — WebFlix does not fabricate any.",
    },
    connectedSince,
    subscriberCount: {
      kind: "absent",
      note: "This source declares no subscriber count — WebFlix never fabricates one.",
    },
    verifiedBadge: {
      kind: "absent",
      note: "This source declares no verification claim — WebFlix does not fabricate a badge.",
    },
  };
}

// ---------------------------------------------------------------------------
// The subscription truth (the connector-scoped read of the ONE list)
// ---------------------------------------------------------------------------

/**
 * The stored-library row's list name (the engine's own save writes
 * `metadata.list`; the default watchlist carries none) — the same read
 * the player shell's reload-durability seam performs.
 */
function storedRowListOf(entry: LibraryEntry): string {
  const list = (entry.metadata as Record<string, unknown> | undefined)?.list;
  return typeof list === "string" && list.length > 0 ? list : "Saved";
}

/** One subscribed entry's full source identity (the unsubscribe write's target). */
export interface SubscribedTarget {
  readonly itemId: string;
  readonly title: string;
  readonly connectorId: string;
  readonly externalRef: string;
}

/** The channel's subscription truth: the stored + local Subscriptions rows for this connector. */
async function channelSubscriptionTruth(
  host: WebRuntimeHost,
  connectorId: string,
): Promise<{ subscribed: boolean; targets: readonly SubscribedTarget[] }> {
  const targets = new Map<string, SubscribedTarget>();
  // THE STORED TRUTH FIRST (the player shell's own law): the stored rows
  // match BY SOURCE KEY (connectorId + externalRef — the durable
  // cross-load key), resolved into this session's joined item identity
  // through the join's own reverse scan. NEVER through a freshly-minted
  // adapter id (the per-process canonical seam cannot cross a fresh
  // load's module graph — the R30 reload-durability lesson applied to
  // the channel surface). A failing read degrades to the local fold,
  // never a fabricated claim.
  let storedLibrary: readonly LibraryEntry[] | null = null;
  try {
    const storedRead = await host.serverPort.readProfileLibrary();
    if (storedRead.ok) storedLibrary = storedRead.value;
  } catch {
    storedLibrary = null;
  }
  if (storedLibrary !== null) {
    for (const entry of storedLibrary) {
      if (entry.connectorId !== connectorId) continue;
      if (storedRowListOf(entry) !== SUBSCRIPTIONS_LIST) continue;
      const joined = joinedItemByExternalRef(entry.connectorId, entry.externalRef);
      if (joined !== null) {
        targets.set(joined.itemId, {
          itemId: joined.itemId,
          title: joined.title,
          connectorId: joined.connectorId,
          externalRef: joined.externalRef,
        });
      }
    }
  }
  // The LOCAL fold (the session's own writes — the same truth the rail
  // subscriptions and the Library read; the write paths keep it current).
  await host.runtime.libraryOps.hydrate();
  for (const entry of host.runtime.libraryOps.entries()) {
    if (entry.listName !== SUBSCRIPTIONS_LIST) continue;
    const joined = joinedItemOf(entry.itemId);
    if (joined === null || joined.connectorId !== connectorId) continue;
    if (!targets.has(joined.itemId)) {
      targets.set(joined.itemId, {
        itemId: joined.itemId,
        title: joined.title,
        connectorId: joined.connectorId,
        externalRef: joined.externalRef,
      });
    }
  }
  return { subscribed: targets.size > 0, targets: [...targets.values()] };
}

// ---------------------------------------------------------------------------
// The channel page view
// ---------------------------------------------------------------------------

/** The channel page's own URL builder (the tab + the in-channel query + the sort). */
export function channelPageHref(
  handle: string,
  params: { readonly tab?: ChannelTab; readonly query?: string; readonly sort?: ChannelSort } = {},
): string {
  const search = new URLSearchParams();
  if (params.tab !== undefined && params.tab !== "home") search.set("tab", params.tab);
  if (params.query !== undefined && params.query.trim().length > 0) search.set("q", params.query.trim());
  if (params.sort !== undefined) search.set("sort", params.sort);
  const query = search.toString();
  return query.length > 0 ? `/channel/${handle}?${query}` : `/channel/${handle}`;
}

/**
 * Load the channel page view: the identity (the derivation law), the
 * tab's items (the honest channel feed), the subscription truth (the
 * connector-scoped read of the ONE Subscriptions list), the channel's
 * playlists (the library's named lists holding this channel's items),
 * and the About stats (derived from the channel's own item set).
 */
export async function loadChannelView(
  host: WebRuntimeHost,
  handle: string,
  params: {
    readonly tab?: ChannelTab;
    readonly query?: string;
    readonly sort?: ChannelSort;
  } = {},
): Promise<ChannelView | ChannelNotFoundView> {
  const resolution = await resolveChannelByHandle(host, handle);
  if (!resolution.ok) {
    return { mode: host.mode, handle };
  }
  const source = resolution.source;
  const tab = params.tab ?? "home";
  const query = params.query !== undefined && params.query.trim().length > 0 ? params.query.trim() : null;
  const sort = params.sort ?? null;
  const allItems = await channelItemsOf(host, source.connectorId);
  const identity = channelIdentityOf(source, allItems);

  // The in-channel search filter: the title containment law (the same
  // normalization the transport's own search applies — lowercase
  // containment; never a fabricated match).
  const filtered = query === null
    ? allItems
    : allItems.filter((item) => item.card.title.toLowerCase().includes(query.toLowerCase()));

  // The tab's item set.
  let items: readonly ChannelItemView[];
  switch (tab) {
    case "shorts":
      items = filtered.filter(isChannelShort);
      break;
    case "videos":
      items = filtered.filter((item) => !isChannelShort(item));
      break;
    default:
      items = filtered;
      break;
  }

  // The sort availability (the SearchFilters law): Latest/Oldest need a
  // declared publish instant; Popular needs a declared popularity
  // metric. Absent options never render — the note names the truth.
  const withDates = items.filter((item) => item.publishedAt !== null);
  const withViews = items.filter((item) => item.viewCount !== null);
  const sortAvailability = {
    latest: withDates.length > 0,
    oldest: withDates.length > 0,
    popular: withViews.length > 0,
    note:
      withDates.length === 0 && withViews.length === 0
        ? "This source declares no publish dates or view counts for these items — the channel's own feed order is shown, and sort options appear only when the source declares the data they sort by."
        : withDates.length === 0
          ? "This source declares no publish dates for these items — the date sorts are honestly absent (never a guessed order)."
          : withViews.length === 0
            ? "This source declares no view counts for these items — the Popular sort is honestly absent (never a guessed ranking)."
            : "",
  };
  // The applied sort (honest: an unbacked sort falls back to the feed
  // order — the note above already names why).
  const effectiveSort: ChannelSort | null =
    sort !== null && ((sort === "popular" && sortAvailability.popular) || (sort !== "popular" && sortAvailability.latest))
      ? sort
      : null;
  if (effectiveSort !== null && tab === "videos") {
    const sorted = [...items];
    if (effectiveSort === "latest") {
      sorted.sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
    } else if (effectiveSort === "oldest") {
      sorted.sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
    } else {
      sorted.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    }
    items = sorted;
  }

  // The Home tab's continue-watching truth: the session's own watch
  // fold (the same seam the home view reads) joined to the channel's
  // items — the known items surface FIRST with their resume affordances.
  if (tab === "home") {
    let continueEntries: readonly ContinueWatchingEntry[] = [];
    try {
      const homeModel = await host.runtime.getHome();
      continueEntries = homeModel.continueWatching.entries;
    } catch {
      continueEntries = [];
    }
    const resumeByItem = new Map<string, ContinueWatchingEntry>();
    for (const entry of continueEntries) resumeByItem.set(entry.itemId, entry);
    items = items.map((item) => {
      const entry = resumeByItem.get(item.card.itemId);
      return entry === undefined
        ? item
        : {
            ...item,
            resume: {
              resumePositionMs: entry.positionMs,
              completionRatio: entry.completionRatio,
            },
          };
    });
    // Continue-watching first (the library's own knowledge), the feed
    // order preserved within each group.
    items = [
      ...items.filter((item) => item.resume !== null),
      ...items.filter((item) => item.resume === null),
    ];
  }

  // The subscription truth (the connector-scoped read of the ONE list).
  const subscription = await channelSubscriptionTruth(host, source.connectorId);

  // The representative item (the Subscribe write's item identity): the
  // first item of the channel's own feed order — the item the source
  // itself surfaces first (a real, honest choice — never a fabricated
  // channel row).
  const firstItem = allItems[0];
  const representative =
    firstItem !== undefined
      ? {
          itemId: firstItem.card.itemId,
          title: firstItem.card.title,
          connectorId: firstItem.card.connectorId,
          externalRef: firstItem.card.externalRef,
          canonicalType: firstItem.card.canonicalType,
        }
      : null;

  // The channel's playlists: the library's NAMED lists (the same
  // grouping the Library page renders — the default "Saved" list stays
  // the Watchlist), each scoped to the entries that belong to THIS
  // channel. An empty scoped set is the typed-empty state.
  const playlists: {
    readonly name: string;
    readonly entries: readonly WatchlistEntryView[];
  }[] = [];
  try {
    const libraryModel = await host.runtime.library();
    const byList = new Map<string, WatchlistEntryView[]>();
    for (const entry of libraryModel.watchlist.entries) {
      if (entry.listName === "Saved") continue;
      const view: WatchlistEntryView = {
        itemId: entry.itemId,
        title: entry.title,
        listName: entry.listName,
        sync: entry.sync,
        savedAt: entry.savedAt,
        joined: joinedItemOf(entry.itemId),
      };
      const bucket = byList.get(entry.listName);
      if (bucket === undefined) byList.set(entry.listName, [view]);
      else bucket.push(view);
    }
    for (const [name, entries] of byList) {
      const scoped = entries.filter(
        (entry) => entry.joined !== null && entry.joined.connectorId === source.connectorId,
      );
      if (scoped.length > 0) playlists.push({ name, entries: scoped });
    }
    playlists.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // A failing library read renders the typed-empty playlist set — the
    // surface names the failure honestly through the empty state.
  }

  return {
    mode: host.mode,
    identity,
    tab,
    query,
    sort: effectiveSort,
    items,
    sortAvailability,
    subscribed: subscription.subscribed,
    subscribedTargets: subscription.targets,
    representative,
    playlists,
    stats: {
      videoCount: allItems.filter((item) => !isChannelShort(item)).length,
      shortsCount: allItems.filter(isChannelShort).length,
      playlistCount: playlists.length,
      subscribedHere: subscription.subscribed,
    },
  };
}

// ---------------------------------------------------------------------------
// The search surface's channel results (the survey's row 18)
// ---------------------------------------------------------------------------

/** One channel result card's view (the search surface's row). */
export interface ChannelResultView {
  readonly identity: ChannelIdentity;
  /** The channel's representative item (the inline Subscribe write's identity). */
  readonly representative: {
    readonly itemId: string;
    readonly title: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly canonicalType: string;
  } | null;
  /** The user's own subscription truth for this channel. */
  readonly subscribed: boolean;
  /** The honest description snippet: only the source's own declared truth. */
  readonly snippet: string;
}

/**
 * THE CHANNEL MATCHING LAW: a channel matches a query when the query's
 * normalized tokens match the DISPLAY NAME or the HANDLE (the
 * containment law over the source's own identity — the same
 * normalization the item search applies). The match set is the catalog's
 * REAL source set (the sources model's rows) — never a fabricated
 * channel; no matches ⇒ the section is honestly absent.
 */
export function channelMatchesQuery(
  source: SourceInfo,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return false;
  const displayName = source.displayName.toLowerCase();
  const handle = channelHandleOf(source.connectorId).toLowerCase();
  const connectorId = source.connectorId.toLowerCase();
  return displayName.includes(needle) || handle.includes(needle) || connectorId.includes(needle);
}

/**
 * The search surface's channel results: the matched channels (the
 * display-name/handle match over the catalog's real source set), each
 * with the representative item (the inline Subscribe's write identity —
 * derived through the SAME discovery composition the channel page uses)
 * and the user's own subscription truth. ONLY matched channels pay the
 * item-derivation cost (the honest bound).
 */
export async function channelResultsFor(
  host: WebRuntimeHost,
  query: string,
): Promise<readonly ChannelResultView[]> {
  const directory = await loadChannelDirectory(host);
  const matched = directory.filter((source) => channelMatchesQuery(source, query));
  if (matched.length === 0) return [];
  const results: ChannelResultView[] = [];
  for (const source of matched) {
    const items = await channelItemsOf(host, source.connectorId);
    const identity = channelIdentityOf(source, items);
    const firstItem = items[0];
    const subscription = await channelSubscriptionTruth(host, source.connectorId);
    results.push({
      identity,
      representative:
        firstItem !== undefined
          ? {
              itemId: firstItem.card.itemId,
              title: firstItem.card.title,
              connectorId: firstItem.card.connectorId,
              externalRef: firstItem.card.externalRef,
              canonicalType: firstItem.card.canonicalType,
            }
          : null,
      subscribed: subscription.subscribed,
      // The description snippet: the identity's own honest state — the
      // declared text when the source carries one, the honest absence
      // sentence otherwise (never invented copy).
      snippet:
        identity.description.kind === "declared"
          ? identity.description.text
          : identity.description.note,
    });
  }
  return results;
}
