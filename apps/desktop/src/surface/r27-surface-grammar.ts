/**
 * @wfx/app-desktop — THE R27 SURFACE GRAMMAR (the corpus surfaces,
 * projected — W3's surfaces lane).
 *
 * THE LAW (docs/parity-lab/reference/app-shell.md + watch-geometry.md):
 * the Desktop surfaces render the corpus ANATOMY natively — the shell
 * (56px masthead, 240/72 rail, honest destinations), the browse feed
 * (chip bar + responsive card grid over the R26 discovery rows), the
 * watch page (the measured two-column: h1 20/700, owner-left +
 * actions-right 40px pills, raised description panel with the expander,
 * related compact cards), the search page (the row-card grammar), and
 * the library rows — all in the same card/panel/pill vocabulary.
 *
 * THE HONEST MAPPING LAWS:
 * - The rail renders ONLY destinations that truthfully exist
 *   (app-shell.md's WebFlix mapping): Home, Shorts, Library, History,
 *   Settings. YouTube's Subscriptions/Explore/More-from rows have no
 *   honest WebFlix surface yet — OMITTED, recorded in DIVERGENCES
 *   (never a dead destination).
 * - The watch actions row renders only backed actions: the segmented
 *   Feedback pill (the runtime's recommendation-feedback vocabulary),
 *   Share (the OS share sheet's truthful canShare), Save (the Library
 *   watchlist write). No fabricated like counts — the feedback pill
 *   carries the real vocabulary.
 * - THE R26-W3 PEER JOURNEY STAYS FIRST-CLASS, restyled INTO the
 *   grammar: Where-to-watch reads as the natural viewing-source choice
 *   (the same groups, the same frozen vocabulary, now rendered as the
 *   watch page's way-to-watch panel); the honest lifecycle
 *   (Preparing → Buffering-with-verified-fraction → Playing →
 *   completing → Ready offline / Failed) renders INSIDE the player
 *   chrome as the stage state, protocol-free labels verbatim.
 *
 * WHAT THIS MODULE IS NOT: product policy (the underlying surfaces own
 * every decision), a data source (pure projections of the existing view
 * models), or a renderer (the webview renders; this projects).
 */

import type { ClientRuntime } from "@wfx/client-runtime";
import type { AcquisitionStatusView } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";

import type {
  DesktopBrowseView,
  DesktopDiscoveryRowView,
  DesktopItemDetailView,
  DesktopSearchView,
} from "./item-detail-surface";
import type { ContinueWatchingEntry, LibraryModel } from "@wfx/client-runtime";
import {
  peerCatalogArtworkOf,
  peerCatalogByItemId,
  type PeerCatalogEntry,
} from "../platform/peer-catalog";
import {
  r27ArtworkViewOf,
  r27ChipsOf,
  r27DurationLabelOf,
  r27FeedCardOf,
  r27RelatedCardOf,
  r27SearchRowOf,
  type R27ArtworkView,
  type R27ChipView,
  type R27FeedCardView,
  type R27RelatedCardView,
  type R27SearchRowView,
} from "./r27-card-grammar";
import type { R27ThemeName } from "./r27-parity-tokens";

// ---------------------------------------------------------------------------
// THE SHELL (the masthead + the rail)
// ---------------------------------------------------------------------------

/** One rail destination (only truthful surfaces render). */
export interface R27RailItemView {
  readonly id: string;
  readonly label: string;
  /** The destination's runtime surface (the webview routes on this). */
  readonly destination: "home" | "shorts" | "library" | "history" | "settings";
  /** Whether the runtime truthfully serves this destination. */
  readonly available: boolean;
  /** The honest note when the destination is truthfully bound. */
  readonly detail: string;
}

/** The shell view (the masthead + the labeled rail groups). */
export interface R27ShellView {
  readonly topbar: {
    readonly guideLabel: string;
    /** WebFlix's OWN wordmark (the honest-identity law). */
    readonly wordmark: string;
    readonly search: {
      readonly placeholder: string;
      /** The mic affordance — honestly absent (no speech transport bound). */
      readonly mic: null;
    };
    readonly right: readonly {
      readonly id: string;
      readonly label: string;
      readonly detail: string;
    }[];
  };
  readonly rail: readonly {
    readonly heading: string | null;
    readonly items: readonly R27RailItemView[];
  }[];
  /** The active theme (dark default; the toggle's honest seam). */
  readonly theme: R27ThemeName;
}

/**
 * Project the shell view over the runtime + capabilities. The rail's
 * destinations are the HONEST WebFlix mapping (app-shell.md); the
 * topbar's right cluster carries the truthful BYOF/account entries.
 */
export function r27ShellView(
  runtime: ClientRuntime,
  _capabilities: PlatformCapabilities,
  theme: R27ThemeName = "dark",
): R27ShellView {
  // Shorts truth: the runtime's own shorts feed read exists on this
  // composition (the destination renders; its content answers the read).
  const shortsAvailable = typeof runtime.shorts === "function";
  return {
    topbar: {
      guideLabel: "Guide",
      wordmark: "WebFlix",
      search: {
        placeholder: "Search",
        mic: null, // no speech transport is bound on this surface — honestly absent
      },
      right: [
        {
          id: "byof",
          label: "Bring your feed",
          detail: "Import a feed from a connected source — the Desktop file-import flow.",
        },
        {
          id: "account",
          label: "Account",
          detail: "The sign-in and settings entry — the session's honest state.",
        },
      ],
    },
    rail: [
      {
        heading: null,
        items: [
          {
            id: "home",
            label: "Home",
            destination: "home",
            available: true,
            detail: "The runtime's Home read — Continue Watching and discovery.",
          },
          {
            id: "shorts",
            label: "Shorts",
            destination: "shorts",
            available: shortsAvailable,
            detail: "The Shorts feed read — the vertical surface.",
          },
          {
            id: "library",
            label: "Library",
            destination: "library",
            available: true,
            detail: "Your saved titles and history — the Library read.",
          },
          {
            id: "history",
            label: "History",
            destination: "history",
            available: true,
            detail: "The watch-state fold — what you watched and where you stopped.",
          },
        ],
      },
      {
        heading: "Settings",
        items: [
          {
            id: "settings",
            label: "Settings",
            destination: "settings",
            available: true,
            detail: "Sources, models, and the session's own settings surfaces.",
          },
        ],
      },
    ],
    theme,
  };
}

// ---------------------------------------------------------------------------
// THE BROWSE FEED (chip bar + the responsive card grid)
// ---------------------------------------------------------------------------

/** The browse feed view (the corpus home grammar). */
export interface R27BrowseFeedView {
  /** The chip bar's facets (derived from the rows' real canonical types). */
  readonly chips: readonly R27ChipView[];
  /** The Continue Watching section (rendered only with real entries). */
  readonly continueWatching: readonly R27FeedCardView[];
  /** The discovery grid's cards (the peer catalog's real rows). */
  readonly grid: readonly R27FeedCardView[];
  /** The honest server-catalog note (the browse surface's own truth). */
  readonly serverCatalogNote: string;
  /** The skeletons while the read is in flight (the loading state). */
  readonly loading: boolean;
}

/**
 * Project the browse view into the feed grammar: the chip facets over the
 * peer rows, the Continue Watching cards (with the peer catalog's real
 * artwork where the entry is a peer title — an honest lookup, never a
 * fabrication), and the discovery grid.
 */
export function r27BrowseFeedView(
  browse: DesktopBrowseView,
  options?: { readonly loading?: boolean; readonly theme?: R27ThemeName },
): R27BrowseFeedView {
  const rows = browse.peerRows;
  const continueWatching: R27FeedCardView[] = browse.continueWatching.map(
    (entry: ContinueWatchingEntry) => {
      // The honest artwork lookup: a continue-watching entry that IS a
      // peer title carries the catalog's real artwork; anything else
      // renders the typed placeholder (never a fake image).
      const peerEntry = peerCatalogByItemId(entry.itemId);
      const artwork = peerEntry !== null ? peerCatalogArtworkOf(peerEntry) : null;
      const row: DesktopDiscoveryRowView = {
        itemId: entry.itemId,
        title: entry.title,
        creators: peerEntry !== null ? [...peerEntry.creators] : [],
        canonicalType: peerEntry !== null ? peerEntry.canonicalType : "video",
        ...(peerEntry !== null ? { durationMs: peerEntry.durationMs } : {}),
        artwork,
        origin: peerEntry !== null ? "authorized-peer-copy" : "server-catalog",
        ...(peerEntry !== null ? { licenseLabel: peerEntry.license.label } : {}),
      };
      return r27FeedCardOf(row, {
        completionRatio: entry.completionRatio,
        positionMs: entry.positionMs,
        ...(peerEntry !== null ? { durationMs: peerEntry.durationMs } : {}),
      });
    },
  );
  return {
    chips: r27ChipsOf(rows),
    continueWatching,
    grid: rows.map((row) => r27FeedCardOf(row)),
    serverCatalogNote: browse.serverCatalogNote,
    loading: options?.loading === true,
  };
}

// ---------------------------------------------------------------------------
// THE WATCH PAGE (the measured two-column anatomy)
// ---------------------------------------------------------------------------

/** One action pill in the watch page's actions row (40px, radius 20). */
export interface R27ActionPillView {
  readonly id: string;
  readonly label: string;
  /** Whether the pill renders in the segmented (like/dislike-style) group. */
  readonly segmented: boolean;
  /** The honest backing sentence (the affordance's own truth). */
  readonly detail: string;
}

/** The where-to-watch panel row (the viewing-source choice, in-grammar). */
export interface R27WayToWatchRowView {
  readonly kind: "webflix-source" | "authorized-peer-copy" | "provider-realization";
  readonly groupLabel: string;
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  /** The honest state chip (e.g. the lifecycle label while acquiring). */
  readonly stateLabel: string | null;
  readonly usable: boolean;
}

/** The player stage's honest state (the lifecycle inside the chrome). */
export interface R27StageStateView {
  readonly kind:
    | "idle"
    | "available"
    | "preparing"
    | "buffering"
    | "playing"
    | "completing"
    | "ready-offline"
    | "failed";
  /** The protocol-free label (the acquisition view's own, verbatim). */
  readonly label: string;
  /** The honest one-sentence detail. */
  readonly detail: string;
  /** The truthful progress fraction; null = honestly unknown. */
  readonly progress: number | null;
}

/** The watch page view (the measured two-column anatomy). */
export interface R27WatchPageView {
  readonly itemId: string;
  /** The h1 (20/700/28). */
  readonly title: string;
  /** The owner row (LEFT: avatar 40, name, meta). */
  readonly owner: {
    readonly name: string;
    readonly meta: string;
    readonly avatar: R27ArtworkView;
  };
  /** The actions row (RIGHT: 40px pills, radius 20, right-aligned). */
  readonly actions: readonly R27ActionPillView[];
  /** The description panel (raised, radius 12, 2-line + expander). */
  readonly description: {
    readonly text: string;
    readonly collapsed: boolean;
    readonly moreLabel: string;
  };
  /** Where to watch — the viewing-source choice panel (in-grammar). */
  readonly waysToWatch: readonly R27WayToWatchRowView[];
  /** The primary play decision (the frozen R23-E truth). */
  readonly primaryPlay: { readonly label: string; readonly detail: string };
  /** The player stage's honest state (the lifecycle inside the chrome). */
  readonly stage: R27StageStateView;
  /** The resume truth (the watch-state fold, honest). */
  readonly resume: { readonly positionLabel: string | null; readonly status: string } | null;
  /** The related sidebar (chips + compact cards). */
  readonly related: {
    readonly chips: readonly R27ChipView[];
    readonly cards: readonly R27RelatedCardView[];
  };
}

/**
 * Project the item detail view into the watch-page grammar. The where-
 * to-watch groups flatten into way-to-watch rows (the same frozen
 * vocabulary, the same order); the acquisition lifecycle maps onto the
 * stage state VERBATIM (the protocol-free labels, the truthful progress).
 */
export function r27WatchPageView(
  item: DesktopItemDetailView,
  relatedRows: readonly DesktopDiscoveryRowView[],
  options?: { readonly sharingAvailable?: boolean },
): R27WatchPageView {
  const w2w = item.whereToWatch;

  // The ways-to-watch rows: every group's entries, in the frozen order,
  // rendered as the natural viewing-source choice.
  const ways: R27WayToWatchRowView[] = [];
  for (const group of w2w.groups) {
    for (const entry of group.entries) {
      ways.push({
        kind: entry.kind,
        groupLabel: group.label,
        label: entry.label,
        detail: entry.detail,
        selected: entry.kind === "authorized-peer-copy" && w2w.primary.selectedPeerCopy,
        stateLabel: entry.rung !== undefined ? entry.rung.kind : null,
        usable: entry.usable ?? entry.kind === "authorized-peer-copy",
      });
    }
  }

  // The stage state: the acquisition lifecycle mapped verbatim onto the
  // in-chrome state (the R26 honest lifecycle — first-class, restyled).
  const acquisition: AcquisitionStatusView | null = w2w.acquisition;
  const stage: R27StageStateView = acquisition === null
    ? {
      kind: "idle",
      label: "Ready to play",
      detail:
        "Nothing is being fetched right now — pressing play starts the way of watching you choose.",
      progress: null,
    }
    : {
      kind: acquisition.state,
      label: acquisition.label,
      detail: acquisition.detail,
      progress: acquisition.progress,
    };

  // The actions row: only backed actions (the honest mapping).
  const actions: R27ActionPillView[] = [
    {
      id: "feedback",
      label: "Feedback",
      segmented: true,
      detail:
        "The recommendation feedback you already know — More like this, Not interested, and the rest of the same vocabulary.",
    },
    {
      id: "share",
      label: "Share",
      segmented: false,
      detail:
        options?.sharingAvailable === false
          ? "Sharing is not available on this platform right now — the control never pretends otherwise."
          : "The OS share sheet carrying the canonical link — the Desktop platform's own share affordance.",
    },
    {
      id: "save",
      label: "Save",
      segmented: false,
      detail: "The Library's own watchlist write — the durable save, the same action everywhere.",
    },
  ];

  // The owner row: the first creator (or the title's identity) + the
  // honest meta (type · year · license when present).
  const ownerName = item.creators[0] ?? item.title;
  const ownerMetaParts: string[] = [];
  if (item.year !== undefined) ownerMetaParts.push(String(item.year));
  ownerMetaParts.push(item.canonicalType.length > 0 ? item.canonicalType : "title");
  if (item.license !== undefined) ownerMetaParts.push(item.license.label);

  const positionLabel =
    item.watch !== null && item.watch.positionMs > 0
      ? r27DurationLabelOf(item.watch.positionMs)
      : null;

  return {
    itemId: item.itemId,
    title: item.title,
    owner: {
      name: ownerName,
      meta: ownerMetaParts.join(" · "),
      avatar: r27ArtworkViewOf(
        item.artwork.view !== null && item.artwork.view.variant === "poster"
          ? item.artwork.view
          : null,
        ownerName,
      ),
    },
    actions,
    description: {
      text: item.synopsis.length > 0 ? item.synopsis : "No description was provided for this title.",
      collapsed: true,
      moreLabel: "…more",
    },
    waysToWatch: ways,
    primaryPlay: { label: w2w.primary.label, detail: w2w.primary.detail },
    stage,
    resume:
      item.watch !== null
        ? { positionLabel, status: item.watch.status }
        : null,
    related: {
      chips: r27ChipsOf(relatedRows),
      cards: relatedRows.map((row) => r27RelatedCardOf(row)),
    },
  };
}

// ---------------------------------------------------------------------------
// THE SEARCH PAGE (the row-card grammar)
// ---------------------------------------------------------------------------

/** The search page view (the row-card grammar + the honest statuses). */
export interface R27SearchPageView {
  readonly query: string;
  /** The merged result rows (server + peer — the same grammar). */
  readonly rows: readonly R27SearchRowView[];
  /** The honest server-search status (the typed error renders, never silence). */
  readonly serverStatus: "ready" | "error";
  readonly serverErrorDetail: string | null;
  /** The honest empty state (the same grammar, no fabricated results). */
  readonly emptyNote: string | null;
}

/**
 * Project the search view into the row-card grammar: the server rows and
 * the peer rows merged (the peer rows carry their real synopses — the
 * catalog's own text), the honest server status, and the honest empty
 * note when nothing matched.
 */
export function r27SearchPageView(search: DesktopSearchView): R27SearchPageView {
  const rows: R27SearchRowView[] = search.serverRows.map((row) => r27SearchRowOf(row, null));
  for (const row of search.peerRows) {
    const entry = peerCatalogByItemId(row.itemId);
    rows.push(r27SearchRowOf(row, entry !== null ? entry.synopsis : null));
  }
  const emptyNote =
    rows.length === 0 && search.serverStatus === "ready"
      ? "No results matched — try different words, or browse the authorized peer titles on Home."
      : null;
  return {
    query: search.query,
    rows,
    serverStatus: search.serverStatus,
    serverErrorDetail: search.serverErrorDetail ?? null,
    emptyNote,
  };
}

// ---------------------------------------------------------------------------
// THE LIBRARY PAGE (the rows/sections grammar)
// ---------------------------------------------------------------------------

/** One library row card (the same compact-card anatomy). */
export interface R27LibraryRowView {
  readonly itemId: string;
  readonly title: string;
  readonly metaLine: string;
  readonly durationLabel: string | null;
  readonly artwork: R27ArtworkView;
  /** The saved-at/watched-at honest label. */
  readonly timestampLabel: string | null;
  readonly ariaLabel: string;
}

/** The library page view (the sections grammar). */
export interface R27LibraryPageView {
  readonly watchlist: readonly R27LibraryRowView[];
  readonly history: readonly R27LibraryRowView[];
  /** The honest offline section (the verified peer copies — R13 truth). */
  readonly offlineNote: string;
}

/**
 * Project the library model into the rows grammar: the watchlist and
 * history rows with the honest peer artwork lookups, and the offline
 * note naming the verified-copies truth (the Library's Offline section
 * is the R13 verified-exposure verdict — rendered where it lives).
 */
export function r27LibraryPageView(
  library: LibraryModel,
  nowMs: number,
): R27LibraryPageView {
  const watchlist: R27LibraryRowView[] = library.watchlist.entries.map((entry) => {
    const peerEntry = peerCatalogByItemId(entry.itemId);
    const title = peerEntry !== null ? peerEntry.title : entry.title;
    const artwork = peerEntry !== null ? peerCatalogArtworkOf(peerEntry) : null;
    const metaLine = peerEntry !== null ? r27LibraryMetaOf(peerEntry) : "Saved title";
    const durationLabel = r27DurationLabelOf(peerEntry?.durationMs);
    return {
      itemId: entry.itemId,
      title,
      metaLine,
      durationLabel,
      artwork: r27ArtworkViewOf(artwork, title),
      timestampLabel: r27AgeLabelOf(entry.savedAt, nowMs),
      ariaLabel: `${title} — ${metaLine}`,
    };
  });
  const history: R27LibraryRowView[] = library.history.entries.map((entry) => {
    const peerEntry = peerCatalogByItemId(entry.itemId);
    const title = peerEntry !== null ? peerEntry.title : entry.title;
    const artwork = peerEntry !== null ? peerCatalogArtworkOf(peerEntry) : null;
    const metaLine =
      peerEntry !== null
        ? r27LibraryMetaOf(peerEntry)
        : `Watched · ${r27DurationLabelOf(entry.watch.lastPositionMs) ?? "in progress"}`;
    return {
      itemId: entry.itemId,
      title,
      metaLine,
      durationLabel: r27DurationLabelOf(peerEntry?.durationMs),
      artwork: r27ArtworkViewOf(artwork, title),
      timestampLabel: r27AgeLabelOf(entry.watch.lastWatchedAt, nowMs),
      ariaLabel: `${title} — ${metaLine}`,
    };
  });
  return {
    watchlist,
    history,
    offlineNote:
      "Verified peer copies you can watch offline land here — each one earned by a completed, integrity-verified fetch.",
  };
}

/** The library row's meta line (type · license — the real facts). */
function r27LibraryMetaOf(entry: PeerCatalogEntry): string {
  return [entry.canonicalType, String(entry.year), entry.license.label].join(" · ");
}

/** The honest age label ("3 days ago") from a real timestamp. */
function r27AgeLabelOf(iso: string, nowMs: number): string | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const deltaMs = Math.max(0, nowMs - then);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// The sharing truth (the Share pill's honest backing)
// ---------------------------------------------------------------------------

/** The Share pill's truthful availability over the capability bundle. */
export function r27SharingAvailable(capabilities: PlatformCapabilities): boolean {
  return capabilities.sharing === true;
}

// ---------------------------------------------------------------------------
// The copy sweep (the stale-copy law over this surface's strings)
// ---------------------------------------------------------------------------

/**
 * Gather every user-facing copy string the grammar views project (the
 * stale-copy sweep primitive; tests assert every string passes
 * `isStaleCompletionCopy` — a completion claim is an EARNED state's own
 * vocabulary only).
 */
export function r27SurfaceCopyStrings(
  view: R27ShellView | R27BrowseFeedView | R27WatchPageView | R27SearchPageView | R27LibraryPageView,
): readonly string[] {
  const strings: string[] = [];
  if ("topbar" in view) {
    for (const group of view.rail) {
      for (const item of group.items) strings.push(item.label, item.detail);
    }
    for (const entry of view.topbar.right) strings.push(entry.label, entry.detail);
  } else if ("grid" in view) {
    strings.push(view.serverCatalogNote);
  } else if ("waysToWatch" in view) {
    strings.push(view.title, view.owner.name, view.description.text, view.description.moreLabel);
    strings.push(view.primaryPlay.label, view.primaryPlay.detail);
    strings.push(view.stage.label, view.stage.detail);
    for (const way of view.waysToWatch) strings.push(way.label, way.detail);
    for (const action of view.actions) strings.push(action.label, action.detail);
    for (const card of view.related.cards) strings.push(card.title);
  } else if ("rows" in view) {
    if (view.serverErrorDetail !== null) strings.push(view.serverErrorDetail);
    if (view.emptyNote !== null) strings.push(view.emptyNote);
    for (const row of view.rows) strings.push(row.title);
  } else {
    strings.push(view.offlineNote);
    for (const row of view.watchlist) strings.push(row.title, row.metaLine);
    for (const row of view.history) strings.push(row.title, row.metaLine);
  }
  return strings.filter((value) => typeof value === "string" && value.length > 0);
}
