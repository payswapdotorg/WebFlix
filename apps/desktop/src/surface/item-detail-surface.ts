/**
 * @wfx/app-desktop — the ITEM DETAIL surface (R26-W3, the peer-watch
 * product journey: the Desktop parity of the Web's content-detail
 * surface, with the authorized peer copy as a first-class way to watch).
 *
 * THE PRODUCT LAW THIS SURFACE PROJECTS (the takeover packet's lane 1 +
 * the R23-E + R24-C laws): the Desktop experience must make the peer
 * realization feel like CHOOSING HOW TO WATCH, side by side with the
 * provider embed — never "Download this torrent" when actual playback is
 * available, never a separate product grammar from the Web:
 *
 * ```text
 * Where to watch
 *   ↓
 * Authorized peer copy
 *   ↓
 * Select file
 *   ↓
 * Verified playable ranges
 *   ↓
 * Playback
 *   ↓
 * Seek
 *   ↓
 * Background completion
 *   ↓
 * Integrity verification
 *   ↓
 * Ready offline
 *   ↓
 * Library
 * ```
 *
 * WHAT THIS SURFACE COMPOSES (zero new product policy — the projection
 * law): the RUNTIME's search/home reads (the server catalog), the peer
 * CATALOG's authorized rows (the Desktop-owned catalog surface — real
 * lawfully-shareable films), the R23-E WHERE-TO-WATCH surface (the
 * frozen grouping + the primary play decision), the R14 ACQUISITION
 * surface (the protocol-free lifecycle), the R23-C PLAY FLOW (the
 * binding's typed outcome), and the runtime's LIBRARY read. The views
 * mirror the WEB's DetailView/WhereToWatch grammar (the same sentences,
 * the same group order, the same access truths) — Desktop parity is
 * structural, not aspirational.
 *
 * DISCOVERABILITY (the corrective core): the browse/search rows INCLUDE
 * the authorized peer catalog's titles through the SAME card grammar the
 * server rows use — a fresh user finds them through the NORMAL product
 * journey (browse/search → item → Where to watch → Authorized peer copy
 * → play), never through an engineering path.
 */

import type { ContentArtwork, PlaybackMode } from "@wfx/domain";
import type {
  ClientRuntime,
  ContinueWatchingEntry,
  LibraryModel,
  PlaybackController,
  ServerPort,
} from "@wfx/client-runtime";
import { TORRENT_REALIZATION_VIEW } from "@wfx/client-runtime";

import type { DesktopAcquisitionSurface } from "./acquisition-surface";
import type { DesktopWhereToWatchSurface, DesktopWhereToWatchView } from "./where-to-watch-surface";
import type {
  DesktopPeerCopyPlayOutcome,
  DesktopTorrentFileCandidate,
  DesktopTorrentPlaybackBinding,
} from "../platform/torrent-playback";
import {
  peerCatalogArtworkOf,
  peerCatalogByItemId,
  peerCatalogSearch,
  type PeerCatalogLicense,
} from "../platform/peer-catalog";

// ---------------------------------------------------------------------------
// The discovery row (the browse/search card grammar — the Web's CardView parity)
// ---------------------------------------------------------------------------

/** One discovery row (the card grammar every browse/search row carries). */
export interface DesktopDiscoveryRowView {
  /** The canonical item id (the one identity every surface keys on). */
  readonly itemId: string;
  readonly title: string;
  readonly creators: readonly string[];
  readonly canonicalType: string;
  /** The published duration (display truth; absent when the source carries none). */
  readonly durationMs?: number;
  /**
   * The REAL source artwork (Worker 1's R26-W1 contract) when the row's
   * source carries one — null renders the typed placeholder (never a
   * generated replacement).
   */
  readonly artwork: ContentArtwork | null;
  /**
   * The row's origin (typed, never a second grammar): a server-catalog
   * row or an authorized-peer-copy row — the card rendering is identical.
   */
  readonly origin: "server-catalog" | "authorized-peer-copy";
  /** Present on peer rows: the lawful basis the entry's provenance carries. */
  readonly licenseLabel?: string;
}

/** The browse view (Home's discovery composition on the Desktop). */
export interface DesktopBrowseView {
  /** The runtime's Continue Watching fold (the shared Home section). */
  readonly continueWatching: readonly ContinueWatchingEntry[];
  /** The authorized peer catalog's rows (the Desktop's lawful-shareable films). */
  readonly peerRows: readonly DesktopDiscoveryRowView[];
  /**
   * The honest server-catalog truth for the browse surface (the note that
   * names where the server rows live — never a fabricated empty section).
   */
  readonly serverCatalogNote: string;
}

/** The search view (the merged server + peer search surface). */
export interface DesktopSearchView {
  readonly query: string;
  /** The server-catalog hits (the runtime's own search — canonical-joined). */
  readonly serverRows: readonly DesktopDiscoveryRowView[];
  /** The honest server-search status (typed error carries its detail). */
  readonly serverStatus: "ready" | "error";
  readonly serverErrorDetail?: string;
  /** The authorized peer catalog's hits (the same card grammar). */
  readonly peerRows: readonly DesktopDiscoveryRowView[];
}

// ---------------------------------------------------------------------------
// The item detail view (the Web's DetailView grammar, Desktop-composed)
// ---------------------------------------------------------------------------

/** The item detail view — the content decision hub. */
export interface DesktopItemDetailView {
  readonly itemId: string;
  readonly title: string;
  readonly creators: readonly string[];
  readonly year?: number;
  readonly synopsis: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  /** The REAL artwork resolution (the artwork truth + the honest fallback reason). */
  readonly artwork: {
    readonly view: ContentArtwork | null;
    readonly fallbackReason: string | null;
  };
  readonly origin: "server-catalog" | "authorized-peer-copy";
  /** The Where-to-watch view (the frozen R23-E grouping + the primary play decision). */
  readonly whereToWatch: DesktopWhereToWatchView;
  /** The runtime's folded watch state (the resume truth). */
  readonly watch: { readonly status: string; readonly positionMs: number } | null;
  /** Present on peer rows: the entry's lawful-basis license (progressive disclosure). */
  readonly license?: PeerCatalogLicense;
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopItemDetailSurface}. */
export interface DesktopItemDetailSurfaceOptions {
  /** The shared client runtime (search/home/watch-state reads + playback). */
  readonly runtime: ClientRuntime;
  /** The frozen `WFX_API_BASE` transport (the provider-realization resolve read). */
  readonly server: ServerPort;
  /** The R23-E Where-to-watch surface (the decision hub + the play flow). */
  readonly whereToWatch: DesktopWhereToWatchSurface;
  /** The R23-C torrent playback binding (the play flow + the file choice). */
  readonly torrentPlayback: DesktopTorrentPlaybackBinding;
  /** The R14 acquisition surface (the lifecycle views). */
  readonly acquisition: DesktopAcquisitionSurface;
}

/** The Desktop item detail surface (the peer-watch product journey). */
export interface DesktopItemDetailSurface {
  /**
   * THE BROWSE VIEW (Home): the runtime's Continue Watching + the
   * authorized peer catalog's rows — the discovery surface a fresh user
   * sees (the normal product journey's first step).
   */
  browse(): Promise<DesktopBrowseView>;
  /**
   * THE SEARCH VIEW: the runtime's server search + the peer catalog's
   * search, MERGED into one result surface (the same card grammar; the
   * typed server error renders honestly when the transport fails).
   */
  search(query: string): Promise<DesktopSearchView>;
  /**
   * THE ITEM DETAIL VIEW (the content decision hub): the canonical
   * identity + artwork + Where-to-watch (the provider ways resolved from
   * the server when the item carries a source ref; the authorized peer
   * copy when the composition offers one) + the resume truth. The input
   * carries the row's display data (the same carrier law the Web's
   * detail load consumes; the peer rows derive their own).
   */
  item(input: {
    readonly itemId: string;
    /** The row's display title (server rows carry it; peer rows derive it). */
    readonly title?: string;
    /** The item's source identity (server rows); absent for peer-catalog rows. */
    readonly connectorId?: string;
    readonly externalRef?: string;
    readonly canonicalType?: string;
    readonly durationMs?: number;
  }): Promise<DesktopItemDetailView>;
  /**
   * THE PRIMARY PLAY ACTION through the authorized peer copy (the J38
   * walk's start): the R23-C binding's typed play flow.
   */
  playPeerCopy(
    itemId: string,
    options?: { readonly fileIndexes?: readonly number[]; readonly resumePositionMs?: number },
  ): Promise<DesktopPeerCopyPlayOutcome>;
  /**
   * The file-choice candidates of a live ingestion (the J22 step's view —
   * null before metadata resolves).
   */
  peerCopyFileChoice(ingestionId: string): readonly DesktopTorrentFileCandidate[] | null;
  /**
   * One item's honest acquisition lifecycle (protocol-free: Available →
   * Preparing → Buffering → Playing → Completing → Ready offline / Failed).
   */
  acquisitionState(itemId: string): ReturnType<DesktopAcquisitionSurface["acquisitionView"]>;
  /**
   * The playback controller of a started peer-copy session (the runtime's
   * own seek/pause/resume/stop laws — the same semantics every
   * realization uses).
   */
  playbackController(playbackSessionId: string): PlaybackController | undefined;
  /**
   * The LIBRARY truth (the verified peer copies + the runtime's saves —
   * the journey's landing).
   */
  library(): Promise<LibraryModel>;
}

// ---------------------------------------------------------------------------
// The derivations (pure)
// ---------------------------------------------------------------------------

/** Project one peer-catalog entry as a discovery row (the card grammar). */
function peerCatalogRowOf(entry: ReturnType<typeof peerCatalogByItemId>): DesktopDiscoveryRowView {
  if (entry === null) throw new Error("peerCatalogRowOf: entry must not be null");
  return {
    itemId: entry.itemId,
    title: entry.title,
    creators: [...entry.creators],
    canonicalType: entry.canonicalType,
    durationMs: entry.durationMs,
    artwork: peerCatalogArtworkOf(entry),
    origin: "authorized-peer-copy",
    licenseLabel: entry.license.label,
  };
}

/** The server catalog's honest browse note (the browse view's truth). */
const SERVER_CATALOG_BROWSE_NOTE =
  "Search reaches your connected sources' catalogs — the authorized peer titles below are always browsable, with or without a source.";

// ---------------------------------------------------------------------------
// The surface (the composition of the existing laws — zero new policy)
// ---------------------------------------------------------------------------

/**
 * Project the Desktop item detail surface. Pure projection over the
 * runtime + the peer catalog + the R23-E/R14 surfaces: the browse/search
 * rows, the item decision hub, the play flow, the lifecycle, and the
 * library landing — the SAME product language the Web renders.
 */
export function createDesktopItemDetailSurface(
  options: DesktopItemDetailSurfaceOptions,
): DesktopItemDetailSurface {
  const { runtime, server, whereToWatch, torrentPlayback, acquisition } = options;

  return {
    async browse(): Promise<DesktopBrowseView> {
      const home = await runtime.getHome();
      return {
        continueWatching: [...home.continueWatching.entries],
        peerRows: peerCatalogSearch("").map(peerCatalogRowOf),
        serverCatalogNote: SERVER_CATALOG_BROWSE_NOTE,
      };
    },

    async search(query: string): Promise<DesktopSearchView> {
      const model = await runtime.search({ query });
      const serverRows: DesktopDiscoveryRowView[] =
        model.status.state === "ready"
          ? model.hits.map((hit) => ({
              itemId: hit.canonicalItemId,
              title: hit.result.title,
              creators: [],
              canonicalType: hit.result.canonicalType ?? "video",
              ...(hit.result.durationMs !== undefined
                ? { durationMs: hit.result.durationMs }
                : {}),
              artwork: null, // the server row's artwork rides the runtime's own join (no fabricated art)
              origin: "server-catalog" as const,
            }))
          : [];
      return {
        query,
        serverRows,
        serverStatus: model.status.state,
        ...(model.status.state === "error"
          ? { serverErrorDetail: model.status.error?.detail ?? "the search read did not complete" }
          : {}),
        peerRows: peerCatalogSearch(query).map(peerCatalogRowOf),
      };
    },

    async item(input: {
      readonly itemId: string;
      readonly title?: string;
      readonly connectorId?: string;
      readonly externalRef?: string;
      readonly canonicalType?: string;
      readonly durationMs?: number;
    }): Promise<DesktopItemDetailView> {
      const peerEntry = peerCatalogByItemId(input.itemId);
      // The provider ways: the server's own resolve read (the same read
      // the Web's Where-to-watch loads; absent for peer-only rows).
      let providerRealizations: readonly { mode: PlaybackMode; connectorId: string }[] = [];
      if (input.connectorId !== undefined && input.externalRef !== undefined) {
        const resolved = await server.resolve(input.externalRef);
        if (resolved.ok) {
          providerRealizations = resolved.value.map((realization) => ({
            mode: realization.mode,
            connectorId: realization.connectorId,
          }));
        }
      }
      const whereToWatchView = whereToWatch.whereToWatch({
        itemId: input.itemId,
        providerRealizations,
      });

      // The watch-state fold's resume truth (the shared position law).
      const watchState = runtime.watchState.get(input.itemId);
      const watch =
        watchState !== undefined
          ? { status: watchState.status, positionMs: watchState.lastPositionMs }
          : null;

      if (peerEntry !== null) {
        return {
          itemId: peerEntry.itemId,
          title: peerEntry.title,
          creators: [...peerEntry.creators],
          year: peerEntry.year,
          synopsis: peerEntry.synopsis,
          canonicalType: peerEntry.canonicalType,
          durationMs: peerEntry.durationMs,
          artwork: {
            view: peerCatalogArtworkOf(peerEntry),
            fallbackReason: null,
          },
          origin: "authorized-peer-copy",
          whereToWatch: whereToWatchView,
          watch,
          license: peerEntry.license,
        };
      }

      // A server-catalog row (or an unknown id): the caller's carrier data
      // is the display truth (the same carrier law the Web's detail load
      // consumes); the artwork honestly rides the server's own carriage
      // (null renders the typed placeholder — never a generated image).
      const title = input.title ?? input.itemId;
      return {
        itemId: input.itemId,
        title,
        creators: [],
        synopsis: "",
        canonicalType: input.canonicalType ?? "video",
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        artwork: {
          view: null,
          fallbackReason:
            "This source carries no artwork — the title's initial renders instead.",
        },
        origin: "server-catalog",
        whereToWatch: whereToWatchView,
        watch,
      };
    },

    async playPeerCopy(
      itemId: string,
      playOptions?: {
        readonly fileIndexes?: readonly number[];
        readonly resumePositionMs?: number;
      },
    ): Promise<DesktopPeerCopyPlayOutcome> {
      return torrentPlayback.playPeerCopy(itemId, playOptions);
    },

    peerCopyFileChoice(ingestionId: string): readonly DesktopTorrentFileCandidate[] | null {
      return torrentPlayback.fileChoice(ingestionId);
    },

    acquisitionState(itemId: string): ReturnType<DesktopAcquisitionSurface["acquisitionView"]> {
      return acquisition.acquisitionView(itemId);
    },

    playbackController(playbackSessionId: string): PlaybackController | undefined {
      return runtime.playback.controller(playbackSessionId);
    },

    async library(): Promise<LibraryModel> {
      return runtime.library();
    },
  };
}

// ---------------------------------------------------------------------------
// The copy sweep (the stale-copy law over this surface's strings)
// ---------------------------------------------------------------------------

/**
 * Gather every user-facing copy string the views can project (the
 * stale-copy sweep primitive; tests assert every string passes
 * `isStaleCompletionCopy` — "downloaded"/"completed" claims are earned
 * states' vocabulary only).
 */
export function itemDetailCopyStrings(
  view: DesktopBrowseView | DesktopSearchView | DesktopItemDetailView,
): readonly string[] {
  const strings: string[] = [];
  if ("continueWatching" in view) {
    strings.push(view.serverCatalogNote);
    for (const row of view.peerRows) strings.push(row.title);
  } else if ("serverStatus" in view) {
    if (view.serverErrorDetail !== undefined) strings.push(view.serverErrorDetail);
  } else {
    strings.push(view.title, view.synopsis);
    if (view.artwork.fallbackReason !== null) strings.push(view.artwork.fallbackReason);
    if (view.license !== undefined) {
      strings.push(view.license.label, view.license.statement);
    }
    for (const group of view.whereToWatch.groups) {
      strings.push(group.label, group.detail);
      for (const entry of group.entries) {
        strings.push(entry.label, entry.detail);
        if (entry.unusableReason !== undefined) strings.push(entry.unusableReason);
      }
    }
    strings.push(view.whereToWatch.primary.label, view.whereToWatch.primary.detail);
    strings.push(view.whereToWatch.offlineAffordanceNote);
    if (view.whereToWatch.acquisition !== null) {
      strings.push(view.whereToWatch.acquisition.label, view.whereToWatch.acquisition.detail);
    }
  }
  return strings.filter((value) => typeof value === "string" && value.length > 0);
}

/**
 * THE FROZEN PEER-COPY VOCABULARY constant this surface's tests sweep
 * (the label law is the R23-C machine check — asserted by the
 * where-to-watch surface's own gates; carried here for the item views'
 * copy sweeps).
 */
export const PEER_COPY_PRIMARY_LABEL: string = TORRENT_REALIZATION_VIEW.label;
