/**
 * @wfx/app-web — R38-B — THE STUDIO VIEW LOADERS (the server-side
 * composition over R36's read surfaces).
 *
 * THE COMPOSITION LAW (the task packet): the studio's reads go "through
 * the same resolution seams, never around them." Every studio view is
 * composed over R36's OWN public read seam — `loadChannelView`
 * (apps/web/src/host/channel-views.ts:571 — the identity derivation, the
 * discovery-derived channel feed, the connector-scoped subscription
 * truth, the derived stats) — imported READ-ONLY (R36's files are
 * untouched; the channel page and the studio render the SAME truth).
 * The per-item server-side analytics truths read the runtime's own
 * seams: the watch fold (`getHome().continueWatching` — the same seam
 * the channel Home tab joins, channel-views.ts:651–679) and the library
 * (`runtime.library()` — the same seam the channel playlists read,
 * channel-views.ts:700–735).
 *
 * THE STUDIO'S CHANNEL BINDING: the studio manages the catalog's own
 * channel — the channel R36's page renders (the packet: "Depends on:
 * R36 (the channel the studio customizes + the content list hangs
 * on)"). `/studio?channel=<handle>` selects the channel; the default is
 * the directory's FIRST source (the sources model's own connectorId
 * sort — deterministic). A handle no source owns answers the typed
 * not-found view — never a guessed channel (the ChannelNotFound law).
 *
 * Server-side only (the host seam): the surfaces render these views;
 * the client islands load the local truths (the studio stores) after
 * mount — the CommentsSection hydration law.
 */

import type { ChannelView } from "@/host/channel-views";
import { isChannelShort, loadChannelDirectory, loadChannelView } from "@/host/channel-views";
import { channelHandleOf } from "@/app/href";
import type { WebRuntimeHost } from "@/host/web-host";

// ---------------------------------------------------------------------------
// The view shapes (plain + serializable — the client islands' props)
// ---------------------------------------------------------------------------

/** One of the channel's items (the published set — the card grammar's own truths). */
export interface StudioItemSummary {
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly connectorId: string;
  readonly externalRef: string;
  /** The source-declared publish instant when carried (typed absence otherwise). */
  readonly publishedAt: string | null;
  /** The source-declared view count when carried (typed absence otherwise). */
  readonly viewCount: number | null;
  /** Whether the short-form eligibility makes this a short (the R36 split law). */
  readonly isShort: boolean;
  /** The session's watch-fold truth for this item (the user's own viewing). */
  readonly resume: {
    readonly positionMs: number;
    readonly completionRatio: number | null;
  } | null;
}

/** The studio chrome's channel identity (the R36 derivation, projected). */
export interface StudioChannelIdentityView {
  readonly connectorId: string;
  readonly handle: string;
  readonly displayName: string;
  /** The honest monogram (the R36 avatar derivation). */
  readonly avatarMark: string;
  readonly avatarNote: string;
  /** The banner's base truth: the absence sentence, or the derived art's URL + note. */
  readonly banner:
    | { readonly state: "absent"; readonly note: string }
    | { readonly state: "derived-art"; readonly url: string; readonly note: string };
  /** The description's base truth (the declared text or the absence sentence). */
  readonly description: string;
  /** Whether the base description is the source's own declared text (vs the absence). */
  readonly descriptionDeclared: boolean;
}

/** The studio channel view (the chrome + the published set + the stats). */
export interface StudioChannelView {
  readonly mode: "fixtures" | "service";
  readonly identity: StudioChannelIdentityView;
  readonly items: readonly StudioItemSummary[];
  readonly stats: {
    readonly videoCount: number;
    readonly shortsCount: number;
    readonly playlistCount: number;
  };
  readonly subscribed: boolean;
}

/** The typed not-found view (a handle no source owns). */
export interface StudioChannelNotFoundView {
  readonly mode: "fixtures" | "service";
  readonly handle: string;
}

/** The channel resolution's typed outcome. */
export type StudioChannelResolution =
  | { readonly ok: true; readonly view: StudioChannelView }
  | { readonly ok: false; readonly view: StudioChannelNotFoundView };

/** The library saves' server truth for one item (the named lists holding it). */
export interface StudioItemSavesView {
  readonly listNames: readonly string[];
}

/** The per-item server-side analytics truths (the local wallet's server half). */
export interface StudioAnalyticsServerTruth {
  /** The channel view (the panels' scope). */
  readonly channel: StudioChannelView;
  /** Per-item library saves (the runtime's own library read, scoped to the channel's items). */
  readonly saves: Readonly<Record<string, StudioItemSavesView>>;
}

// ---------------------------------------------------------------------------
// The loaders
// ---------------------------------------------------------------------------

/** Project R36's channel view into the studio's serializable view (pure). */
function projectChannelView(view: ChannelView): StudioChannelView {
  return {
    mode: view.mode,
    identity: {
      connectorId: view.identity.connectorId,
      handle: view.identity.handle,
      displayName: view.identity.displayName,
      avatarMark: view.identity.avatar.mark,
      avatarNote: view.identity.avatar.note,
      banner:
        view.identity.banner.kind === "derived-art"
          ? {
              state: "derived-art",
              url: view.identity.banner.artwork.url,
              note: view.identity.banner.note,
            }
          : { state: "absent", note: view.identity.banner.note },
      description:
        view.identity.description.kind === "declared"
          ? view.identity.description.text
          : view.identity.description.note,
      descriptionDeclared: view.identity.description.kind === "declared",
    },
    items: view.items.map((item) => ({
      itemId: item.card.itemId,
      title: item.card.title,
      canonicalType: item.card.canonicalType,
      ...(item.card.durationMs !== undefined ? { durationMs: item.card.durationMs } : {}),
      connectorId: item.card.connectorId,
      externalRef: item.card.externalRef,
      publishedAt: item.publishedAt,
      viewCount: item.viewCount,
      // The R36 short-form split's own law (the Videos/Shorts tab split).
      isShort: isChannelShort(item),
      resume:
        item.resume !== null
          ? {
              positionMs: item.resume.resumePositionMs,
              completionRatio: item.resume.completionRatio,
            }
          : null,
    })),
    stats: {
      videoCount: view.stats.videoCount,
      shortsCount: view.stats.shortsCount,
      playlistCount: view.stats.playlistCount,
    },
    subscribed: view.subscribed,
  };
}

// ---------------------------------------------------------------------------
// The loaders
// ---------------------------------------------------------------------------

/** Read the first value of one route param (first value when repeated). */
function firstParam(params: Record<string, string | string[] | undefined>, name: string): string {
  const raw = params[name];
  return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
}

/**
 * Resolve the studio's managed channel: the `?channel=` handle when the
 * directory owns it, else the directory's FIRST source (the sources
 * model's own order — deterministic). A named handle no source owns
 * answers the typed not-found view.
 */
export async function resolveStudioChannel(
  host: WebRuntimeHost,
  params: Record<string, string | string[] | undefined>,
): Promise<StudioChannelResolution> {
  const named = firstParam(params, "channel").trim();
  const directory = await loadChannelDirectory(host);
  if (directory.length === 0) {
    return {
      ok: false,
      view: { mode: host.mode, handle: named.length > 0 ? named : "—" },
    };
  }
  let handle = named;
  if (handle.length === 0) {
    // The default: the directory's first source, addressed by its OWN
    // derived handle (the pure href law — the connector id's slug).
    handle = channelHandleOf(directory[0]!.connectorId);
  }
  const view = await loadChannelView(host, handle);
  if (!("identity" in view)) {
    return { ok: false, view: { mode: view.mode, handle: view.handle } };
  }
  return { ok: true, view: projectChannelView(view) };
}

/**
 * Load the per-item server-side analytics truths: the channel view (the
 * panels' scope) + the library saves (the runtime's own read — the same
 * seam the channel playlists and the Library render).
 */
export async function loadStudioAnalyticsTruths(
  host: WebRuntimeHost,
  params: Record<string, string | string[] | undefined>,
): Promise<
  | { readonly ok: true; readonly truths: StudioAnalyticsServerTruth }
  | { readonly ok: false; readonly view: StudioChannelNotFoundView }
> {
  const resolution = await resolveStudioChannel(host, params);
  if (!resolution.ok) return { ok: false, view: resolution.view };
  let saves: Record<string, StudioItemSavesView> = {};
  try {
    const libraryModel = await host.runtime.library();
    const byItem = new Map<string, string[]>();
    for (const entry of libraryModel.watchlist.entries) {
      const lists = byItem.get(entry.itemId) ?? [];
      lists.push(entry.listName);
      byItem.set(entry.itemId, lists);
    }
    const scoped: Record<string, StudioItemSavesView> = {};
    for (const item of resolution.view.items) {
      const lists = byItem.get(item.itemId);
      if (lists !== undefined && lists.length > 0) {
        scoped[item.itemId] = { listNames: [...lists] };
      }
    }
    saves = scoped;
  } catch {
    // A failing library read renders the typed-empty saves set (the
    // channel playlists' own degradation law).
    saves = {};
  }
  return { ok: true, truths: { channel: resolution.view, saves } };
}

/**
 * Find one of the managed channel's items by canonical id (the details
 * editor's and the analytics picker's resolution — the channel's OWN
 * feed, never a second catalog).
 */
export function findStudioItem(
  view: StudioChannelView,
  itemId: string,
): StudioItemSummary | null {
  return view.items.find((item) => item.itemId === itemId) ?? null;
}
