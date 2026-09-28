/**
 * @wfx/app-web — R37 — THE LIVE VIEW MODELS (the /live browse + the
 * watch live mode's server-side truth).
 *
 * THE DERIVATION LAW (the R37 dispatch): an item is live, or is an
 * archived live VOD, because its CONNECTOR METADATA says so — every view
 * here derives through `liveDesignationOf` (the connector layer's ONE
 * derivation), never guessing. Two sources feed the derivation, both
 * honest:
 *
 * 1. THE SEARCH-DERIVED LIVE TRUTH (the general law): the runtime's own
 *    search transport over the discovery seeds (the same composition the
 *    home view renders), filtered to hits whose connector metadata
 *    declares a live designation. A real live-reporting connector feeds
 *    this path; on both boots today it answers zero — the honest empty
 *    answer, disclosed, never a fabricated rail.
 * 2. THE FIXTURES-BOOT LIVE ENTRIES (fixtures mode ONLY — the loud dev
 *    double of a live-reporting source): the committed live fixture
 *    entries (host/byof/byof-fixtures.ts's delimited R37 section),
 *    loaded through a DYNAMIC IMPORT so the service graph never
 *    statically reaches the fixtures closure (the byof-host closure
 *    law). Service mode renders the honest typed absence — a fixture is
 *    never silently presented as production capability (invariant 10).
 *
 * THE HONEST-TRANSPORT LAW (R28, binding): the viewer counts rendered
 * here are the SOURCE-REPORTED figures the entries carry (the double's
 * committed numbers); where an entry declares none, the typed-absence
 * state renders — never a fabricated count. The live-chat bridge status
 * (its globalThis record) pre-declares the chat truth: a boot without
 * the bridge renders the honest bridge-unavailable state.
 *
 * Server-side only (the channel-views.ts pattern — pure derivations +
 * typed states; the surfaces render, they never re-derive).
 */

import type { WebRuntimeHost } from "@/host/web-host";
import { FOR_YOU_QUERY, TRENDING_QUERY, cardFromHit } from "@/host/view-models";
import { readLiveChatBridgeStatus } from "@/host/livechat/livechat-bridge-state";
import { liveDesignationOf, type LiveChatLog, type LiveDesignation } from "@wfx/connectors";
import { channelHandleOf } from "@/app/href";

// ---------------------------------------------------------------------------
// The typed-absence family (the R28 law, the channel-views precedent)
// ---------------------------------------------------------------------------

/** One honestly-absent field: the named state + the honest sentence. */
export interface LiveAbsentTruth {
  readonly kind: "absent";
  readonly note: string;
}

/** A declared figure (the source's own report). */
export interface LiveDeclaredData {
  readonly kind: "declared";
  readonly value: number;
  /** The honest provenance sentence (whose report this figure is). */
  readonly provenance: string;
}

/** The viewer-count slot's typed states (declared with provenance, or absent). */
export type LiveViewerCountView = LiveDeclaredData | LiveAbsentTruth;

// ---------------------------------------------------------------------------
// The /live browse view
// ---------------------------------------------------------------------------

/** One live rail card (the /live browse's own lockup). */
export interface LiveCardView {
  /** The play destination (the /watch live-mode href — the content-destination grammar). */
  readonly watchHref: string;
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  /** The item's declared duration (archived VODs; absent for a live edge). */
  readonly durationMs?: number;
  /** The live designation (the connector-layer derivation — the one truth). */
  readonly designation: LiveDesignation;
  /** The viewer-count slot (the source-reported figure or the typed absence). */
  readonly viewerCount: LiveViewerCountView;
}

/** The /live browse view (the rail's honest truth). */
export interface LiveBrowseView {
  readonly mode: "fixtures" | "service";
  /** The currently-live items (the rail's primary row). */
  readonly liveCards: readonly LiveCardView[];
  /** The archived live VODs (the replay row). */
  readonly archivedCards: readonly LiveCardView[];
  /**
   * The search-derived live truth's count (the general path's honest
   * answer — zero on both boots today; disclosed, never hidden).
   */
  readonly searchDerivedLiveCount: number;
  /** The loud fixtures disclosure (fixtures mode only; null in service mode). */
  readonly fixturesBadge: string | null;
  /** The service-mode honest state (null in fixtures mode). */
  readonly serviceState: LiveAbsentTruth | null;
  /** The live-chat bridge's serving truth (pre-declared for the watch page). */
  readonly chatBridge: {
    readonly running: boolean;
    readonly port: number | null;
    readonly provider: { readonly id: string; readonly detail: string } | null;
  };
  /** The sources model's display names (the R33-C seam — the channel slots). */
  readonly sourceNames: Readonly<Record<string, string>>;
}

/** The /watch live-mode href (the content-destination param grammar). */
export function liveWatchHref(target: {
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
}): string {
  const params = new URLSearchParams({
    connector: target.connectorId,
    ref: target.externalRef,
    title: target.title,
    type: target.canonicalType,
  });
  return `/watch?${params.toString()}`;
}

/** The fixtures-boot live section (the dynamic-import closure law — the byof-host precedent). */
interface LiveFixturesModule {
  readonly LIVE_FIXTURE_CONNECTOR_ID: string;
  readonly LIVE_FIXTURE_ENTRIES: readonly {
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: "video";
    readonly durationMs?: number;
    readonly metadata: Record<string, unknown>;
  }[];
  liveFixtureDesignationOf(entry: { readonly metadata: Record<string, unknown> }): LiveDesignation;
  readonly LIVE_FIXTURES_BADGE: string;
}

/** The extended watch view's fixture reader (the entry + the committed log). */
interface LiveFixturesWatchModule extends LiveFixturesModule {
  liveFixtureEntryOf(externalRef: string): {
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: "video";
    readonly durationMs?: number;
    readonly realizations: readonly { readonly mode: string; readonly url?: string }[];
    readonly chatLog?: unknown;
    readonly metadata: Record<string, unknown>;
  } | null;
  liveFixtureChatLogOf(externalRef: string): LiveChatLog | null;
}

/** The viewer-count view of one live designation (the honest slot derivation). */
function viewerCountViewOf(designation: LiveDesignation): LiveViewerCountView {
  if (designation.kind === "live" && designation.viewerCount !== null) {
    return {
      kind: "declared",
      value: designation.viewerCount,
      provenance: "the source's reported concurrent viewers",
    };
  }
  return {
    kind: "absent",
    note: "This source reports no viewer count — WebFlix never fabricates one.",
  };
}

/** One rail card over a card + designation (pure). */
function liveCardOf(
  card: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: string;
    readonly durationMs?: number;
  },
  designation: LiveDesignation,
): LiveCardView {
  return {
    watchHref: liveWatchHref({
      connectorId: card.connectorId,
      externalRef: card.externalRef,
      title: card.title,
      canonicalType: card.canonicalType,
    }),
    itemId: card.itemId,
    connectorId: card.connectorId,
    externalRef: card.externalRef,
    title: card.title,
    ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    designation,
    viewerCount: viewerCountViewOf(designation),
  };
}

/** Load the /live browse view (the derivation over the two honest sources). */
export async function loadLiveBrowseView(host: WebRuntimeHost): Promise<LiveBrowseView> {
  // 1. THE SEARCH-DERIVED LIVE TRUTH (the general law — the real path a
  //    live-reporting connector feeds; its honest answer today is zero).
  const [forYouModel, trendingModel] = await Promise.all([
    host.runtime.search({ query: FOR_YOU_QUERY }),
    host.runtime.search({ query: TRENDING_QUERY }),
  ]);
  const seenIds = new Set<string>();
  const searchDerivedLive: LiveCardView[] = [];
  for (const hit of [...forYouModel.hits, ...trendingModel.hits]) {
    if (seenIds.has(hit.canonicalItemId)) continue;
    seenIds.add(hit.canonicalItemId);
    // The designation derives from the hit's OWN connector metadata (the
    // bag the shared SearchResult carries) — never guessed.
    const designation = liveDesignationOf(hit.result);
    if (designation.kind === "not-live") continue;
    searchDerivedLive.push(liveCardOf(cardFromHit(hit), designation));
  }

  // 2. The bridge status (the watch page's chat truth, pre-declared).
  const bridge = readLiveChatBridgeStatus();
  // The sources model's display names (the R33-C seam — the channel slots).
  const sourceNames = await sourceNamesOf(host);

  // 3. THE FIXTURES-BOOT LIVE ENTRIES (fixtures mode only — the dynamic
  //    import keeps the closure law; service mode renders the honest state).
  if (host.mode === "fixtures") {
    const fixtures = (await import("@/host/byof/byof-fixtures")) as unknown as LiveFixturesModule;
    const liveCards: LiveCardView[] = [];
    const archivedCards: LiveCardView[] = [];
    for (const entry of fixtures.LIVE_FIXTURE_ENTRIES) {
      const designation = fixtures.liveFixtureDesignationOf(entry);
      if (designation.kind === "not-live") continue;
      const card = liveCardOf(
        {
          itemId: `${fixtures.LIVE_FIXTURE_CONNECTOR_ID}:${entry.externalRef}`,
          connectorId: fixtures.LIVE_FIXTURE_CONNECTOR_ID,
          externalRef: entry.externalRef,
          title: entry.title,
          canonicalType: entry.canonicalType,
          ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
        },
        designation,
      );
      if (designation.kind === "live") liveCards.push(card);
      else archivedCards.push(card);
    }
    return {
      mode: host.mode,
      liveCards: [...liveCards, ...searchDerivedLive.filter((card) => card.designation.kind === "live")],
      archivedCards,
      searchDerivedLiveCount: searchDerivedLive.length,
      fixturesBadge: fixtures.LIVE_FIXTURES_BADGE,
      serviceState: null,
      chatBridge: {
        running: bridge.running,
        port: bridge.port,
        provider: bridge.provider,
      },
      sourceNames,
    };
  }

  // Service mode: the honest typed state (never a fabricated rail).
  return {
    mode: host.mode,
    liveCards: searchDerivedLive.filter((card) => card.designation.kind === "live"),
    archivedCards: searchDerivedLive.filter((card) => card.designation.kind === "archived-live-vod"),
    searchDerivedLiveCount: searchDerivedLive.length,
    fixturesBadge: null,
    serviceState: {
      kind: "absent",
      note: "No connected source declares live items through this boot's transport — the rail populates when a source reports live broadcasts.",
    },
    chatBridge: {
      running: bridge.running,
      port: bridge.port,
      provider: bridge.provider,
    },
    sourceNames,
  };
}

// ---------------------------------------------------------------------------
// The watch live-mode view
// ---------------------------------------------------------------------------

/** The watch live mode's view (the composition's server truth). */
export type LiveWatchView =
  | {
      readonly kind: "live";
      readonly mode: "fixtures" | "service";
      readonly itemId: string;
      readonly connectorId: string;
      readonly externalRef: string;
      readonly title: string;
      /** The contained embed realization's URL (the presentation law's input). */
      readonly embedUrl: string;
      readonly startedAt: string | null;
      readonly viewerCount: LiveViewerCountView;
      /** The chat column's truth: the bridge is serving (the URL the island connects to). */
      readonly chatBridge: {
        readonly running: boolean;
        readonly wsUrl: string;
        readonly provider: { readonly id: string; readonly detail: string } | null;
      };
      /** The channel row's identity (the sources model's displayName; the connector id fallback). */
      readonly channelName: string;
      readonly channelHref: string;
      /** The loud fixtures disclosure (fixtures mode only). */
      readonly fixturesBadge: string | null;
    }
  | {
      readonly kind: "archived-live-vod";
      readonly mode: "fixtures" | "service";
      readonly itemId: string;
      readonly connectorId: string;
      readonly externalRef: string;
      readonly title: string;
      readonly embedUrl: string;
      readonly durationMs: number | null;
      readonly startedAt: string | null;
      readonly endedAt: string | null;
      /** The committed chat log (validated at the boundary; null = the honest typed absence). */
      readonly chatLog: LiveChatLog | null;
      readonly chatLogState: LiveAbsentTruth | null;
      readonly channelName: string;
      readonly channelHref: string;
      readonly fixturesBadge: string | null;
    }
  | {
      readonly kind: "not-live";
      readonly title: string;
      readonly playerHref: string | null;
      readonly note: string;
    }
  | { readonly kind: "not-found"; readonly note: string };

/** The watch live-mode input (the route's item params — the /item grammar). */
export interface LiveWatchInput {
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title?: string;
  readonly canonicalType?: string;
}

/**
 * Load the watch live-mode view. THE DESIGNATION LAW: the view derives
 * through the connector-layer derivation over the item's metadata (the
 * fixtures' live entries on the fixtures boot); a non-live item answers
 * the honest `not-live` state with the ONE-CLICK player link (the
 * no-dead-end law); an unknown ref answers the honest `not-found`.
 */
export async function loadLiveWatchView(
  host: WebRuntimeHost,
  input: LiveWatchInput,
): Promise<LiveWatchView> {
  const bridge = readLiveChatBridgeStatus();

  // The channel identity (the sources model's own displayName — the same
  // seam every channel slot reads; the connector id fallback).
  const sourceNames = await sourceNamesOf(host);
  const channelName = sourceNames[input.connectorId] ?? input.connectorId;
  const channelHref = `/channel/${channelHandleOf(input.connectorId)}`;

  if (host.mode === "fixtures") {
    const fixtures = (await import("@/host/byof/byof-fixtures")) as unknown as LiveFixturesWatchModule;
    const entry =
      input.connectorId === fixtures.LIVE_FIXTURE_CONNECTOR_ID
        ? fixtures.liveFixtureEntryOf(input.externalRef)
        : null;
    if (entry === null) {
      return {
        kind: "not-found",
        note: `No live watch page exists for '${input.connectorId}/${input.externalRef}' — WebFlix does not fabricate watch pages.`,
      };
    }
    const designation = fixtures.liveFixtureDesignationOf(entry);
    if (designation.kind === "not-live") {
      return {
        kind: "not-live",
        title: entry.title,
        playerHref: playerHrefOf(input.connectorId, input.externalRef, entry.title, entry.canonicalType),
        note: "This item is not live — it is an ordinary catalog item. The player is the way to watch it.",
      };
    }
    // The contained embed realization (the presentation law's input — the
    // fixture embed URL, the reserved-TLD determinism law).
    const embed = entry.realizations.find(
      (realization) => realization.mode === "embed" && typeof realization.url === "string",
    );
    const embedUrl = embed !== undefined && typeof embed.url === "string" ? embed.url : "";
    const itemId = `${input.connectorId}:${input.externalRef}`;
    if (designation.kind === "live") {
      return {
        kind: "live",
        mode: host.mode,
        itemId,
        connectorId: input.connectorId,
        externalRef: input.externalRef,
        title: entry.title,
        embedUrl,
        startedAt: designation.startedAt,
        viewerCount: viewerCountViewOf(designation),
        chatBridge: {
          running: bridge.running,
          wsUrl: bridge.running && bridge.port !== null ? `ws://localhost:${bridge.port}` : "",
          provider: bridge.provider,
        },
        channelName,
        channelHref,
        fixturesBadge: fixtures.LIVE_FIXTURES_BADGE,
      };
    }
    const chatLog = fixtures.liveFixtureChatLogOf(input.externalRef);
    return {
      kind: "archived-live-vod",
      mode: host.mode,
      itemId,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      title: entry.title,
      embedUrl,
      durationMs: entry.durationMs ?? null,
      startedAt: designation.startedAt,
      endedAt: designation.endedAt,
      chatLog,
      chatLogState:
        chatLog === null
          ? {
              kind: "absent",
              note: "The archived chat log for this broadcast could not be read — the replay renders nothing rather than a partial log.",
            }
          : null,
      channelName,
      channelHref,
      fixturesBadge: fixtures.LIVE_FIXTURES_BADGE,
    };
  }

  // Service mode: the honest typed absence (a fixture is never presented
  // as production capability — invariant 10).
  return {
    kind: "not-found",
    note: "No live watch page is reachable on this boot's transport — the live catalog seam lands with a live-reporting source.",
  };
}

/** The one-click player href (the no-dead-end law's link for the not-live state). */
function playerHrefOf(
  connectorId: string,
  externalRef: string,
  title: string,
  canonicalType: string,
): string {
  const params = new URLSearchParams({
    connector: connectorId,
    ref: externalRef,
    title,
    type: canonicalType,
  });
  return `/player?${params.toString()}`;
}

/** The sources model's display names (the R33-C seam — the same read the home view performs). */
async function sourceNamesOf(host: WebRuntimeHost): Promise<Readonly<Record<string, string>>> {
  try {
    const sources = await host.runtime.sources.refresh();
    const names: Record<string, string> = {};
    for (const source of sources.sources) {
      if (typeof source.displayName === "string" && source.displayName.trim().length > 0) {
        names[source.connectorId] = source.displayName;
      }
    }
    return names;
  } catch {
    return {};
  }
}
