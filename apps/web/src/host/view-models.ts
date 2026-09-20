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
  PlaybackState,
  SearchHit,
  SearchModel,
} from "@wfx/client-runtime";
import type { PlaybackRealization, SourceItem, UserAction } from "@wfx/domain";
import { buildExternalReturnContext, isOfficialEmbed } from "@wfx/experience";

import { WebClock } from "@/platform/lifecycle";

import type { WebRuntimeHost } from "./web-host";
import { canonicalIdFor } from "./web-host";
import { fixtureAcquisitionDiagnostics, reportAcquisitionFixtures } from "./acquisition-fixtures";

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
}

const itemJoin = new Map<string, JoinedItem>();

/** Learn the join from the runtime's own search/shorts hits (idempotent). */
function learnHits(hits: readonly SearchHit[]): void {
  for (const hit of hits) {
    const existing = itemJoin.get(hit.canonicalItemId);
    const joined: JoinedItem = {
      itemId: hit.canonicalItemId,
      connectorId: hit.result.connectorId,
      externalRef: hit.result.externalRef,
      title: hit.result.title,
      canonicalType: hit.result.canonicalType ?? "video",
      ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
    };
    // First-sight display data wins (stability); the join never rewrites.
    if (existing === undefined) itemJoin.set(hit.canonicalItemId, joined);
  }
}

/** Learn one explicitly-known item (deep-link joins mint through the host seam). */
function learnJoinedItem(connectorId: string, externalRef: string, title: string, canonicalType: string, durationMs?: number): string {
  const itemId = canonicalIdFor(connectorId, externalRef);
  if (!itemJoin.has(itemId)) {
    itemJoin.set(itemId, {
      itemId,
      connectorId,
      externalRef,
      title,
      canonicalType,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }
  return itemId;
}

/** The joined identity of one canonical item (null when this process never saw it). */
export function joinedItemOf(itemId: string): JoinedItem | null {
  return itemJoin.get(itemId) ?? null;
}

// ---------------------------------------------------------------------------
// Card views
// ---------------------------------------------------------------------------

/** One content card view (identity + type + duration — no fabricated claims). */
export interface CardView {
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly connectorId: string;
  readonly externalRef: string;
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
  return {
    itemId: hit.canonicalItemId,
    title: hit.result.title,
    canonicalType: hit.result.canonicalType ?? "video",
    ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
    connectorId: hit.result.connectorId,
    externalRef: hit.result.externalRef,
  };
}

/** Project a model's hits into cards (order preserved; the join learned). */
export function cardsFromModel(model: SearchModel): readonly CardView[] {
  learnHits(model.hits);
  return model.hits.map((hit) => ({
    itemId: hit.canonicalItemId,
    title: hit.result.title,
    canonicalType: hit.result.canonicalType ?? "video",
    ...(hit.result.durationMs !== undefined ? { durationMs: hit.result.durationMs } : {}),
    connectorId: hit.result.connectorId,
    externalRef: hit.result.externalRef,
  }));
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
}

/**
 * The home seed queries — TYPED STOPGAPS (the same law the legacy host
 * kept): the frozen R01 home model owns Continue Watching; the browse
 * rows are the adapter's deterministic seed composition until the
 * service-side ranked feed lands. The Personalize control (R21-D)
 * shapes the session's intent + policy on top of these rows.
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

/** Load the home view from the runtime (Continue Watching + seeded rows). */
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
        reason: "Composed for your session — what your connected sources surface for you right now. Shape it with Personalize.",
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
  };
}

// ---------------------------------------------------------------------------
// Watch browse view
// ---------------------------------------------------------------------------

/** The watch browse view model (the long-form rows, statuses verbatim). */
export interface WatchBrowseView {
  readonly mode: "fixtures" | "service";
  readonly rows: readonly RowView[];
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
        reason: "Composed for your session — what your connected sources surface for you right now. Shape it with Personalize.",
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
}

/** Load the search view for one query (canonical-joined results). */
export async function loadSearchView(host: WebRuntimeHost, rawQuery: string): Promise<SearchView> {
  const query = rawQuery.trim();
  const model = await host.runtime.search({ query });
  return {
    mode: host.mode,
    query,
    status: statusView(model.status),
    cards: cardsFromModel(model),
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
  // The deep-link join learns the item's display data (first sight wins).
  learnJoinedItem(input.connectorId, input.externalRef, metadata.title, metadata.canonicalType ?? "video", metadata.durationMs);
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

/** The player view model: the runtime session + the resolved surface mode. */
export interface PlayerView {
  readonly mode: "fixtures" | "service";
  readonly kind: "session";
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly connectorId: string;
  readonly externalRef: string;
  /** The runtime's playback session id (event correlation). */
  readonly sessionId: string;
  /** The chosen realization's mode + URL (embed/browser carry URLs; external may not). */
  readonly surfaceMode: PlaybackRealization["mode"];
  readonly surfaceUrl: string | null;
  /** The realization's declared capabilities (the source's truth). */
  readonly realizationCapabilities: readonly string[];
  readonly resumePositionMs: number;
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
   * continuation (item + position at handoff) so the journey can return to
   * the same place. Present iff the external rung won.
   */
  readonly externalReturn: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly positionMs: number;
    readonly handedOffAt: string;
  } | null;
}

/** Load the player view: resolve + prepare one playback session through the runtime. */
export async function loadPlayerView(
  host: WebRuntimeHost,
  input: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: string;
    readonly durationMs?: number;
    readonly resumePositionMs?: number;
  },
): Promise<PlayerView> {
  learnJoinedItem(input.connectorId, input.externalRef, input.title, input.canonicalType, input.durationMs);
  try {
    const session = await host.runtime.resolvePlayback({
      itemId: input.itemId,
      externalRef: input.externalRef,
      // R17: attribute the resolve to its source — the honest unavailable
      // dead end names the missing source (never a source-less error).
      connectorId: input.connectorId,
      ...(input.resumePositionMs !== undefined && input.resumePositionMs > 0
        ? { resumePositionMs: input.resumePositionMs }
        : {}),
    });
    const controller = host.runtime.playback.controller(session.id);
    if (controller === undefined) {
      return {
        mode: host.mode,
        kind: "session",
        itemId: input.itemId,
        title: input.title,
        canonicalType: input.canonicalType,
        connectorId: input.connectorId,
        externalRef: input.externalRef,
        sessionId: session.id,
        surfaceMode: session.realization.mode,
        surfaceUrl: session.realization.url ?? null,
        realizationCapabilities: [...session.realization.capabilities],
        resumePositionMs: session.resumePositionMs,
        phase: "failed",
        skippedForCapability: [],
        browserSurface: null,
        failure: { kind: "not-found", detail: "the runtime does not know this playback session" },
        precedenceTrace: [],
        embedAttestation: null,
        externalReturn: null,
      };
    }
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
    return {
      mode: host.mode,
      kind: "session",
      itemId: input.itemId,
      title: input.title,
      canonicalType: input.canonicalType,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      sessionId: session.id,
      surfaceMode: session.realization.mode,
      surfaceUrl: session.realization.url ?? null,
      realizationCapabilities: [...session.realization.capabilities],
      resumePositionMs: session.resumePositionMs,
      phase: state.phase,
      skippedForCapability: prepared.ok
        ? []
        : [{ mode: session.realization.mode, reason: prepared.detail }],
      browserSurface,
      failure: prepared.ok ? null : { kind: "unavailable", detail: prepared.detail },
      precedenceTrace: [...state.precedenceTrace ?? []],
      embedAttestation,
      externalReturn,
    };
  } catch (thrown) {
    // resolvePlayback throws the typed RuntimeError for resolution failures
    // (unresolvable/unsupported/network...) — carried verbatim, never faked.
    const kind = (thrown as { kind?: unknown }).kind;
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      mode: host.mode,
      kind: "session",
      itemId: input.itemId,
      title: input.title,
      canonicalType: input.canonicalType,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      sessionId: "none",
      surfaceMode: "external",
      surfaceUrl: null,
      realizationCapabilities: [],
      resumePositionMs: 0,
      phase: "failed",
      skippedForCapability: [],
      browserSurface: null,
      failure: { kind: typeof kind === "string" ? kind : "unavailable", detail },
      precedenceTrace: [],
      embedAttestation: null,
      externalReturn: null,
    };
  }
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
  return {
    mode: host.mode,
    watchlist: {
      status:
        model.watchlist.status.state === "ready"
          ? { state: "ready" }
          : { state: "error", errorDetail: model.watchlist.status.errorDetail ?? "the watchlist read failed" },
      entries: model.watchlist.entries.map((entry) => ({
        itemId: entry.itemId,
        title: entry.title,
        listName: entry.listName,
        sync: entry.sync,
        savedAt: entry.savedAt,
        ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
        joined: joinedItemOf(entry.itemId),
      })),
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
