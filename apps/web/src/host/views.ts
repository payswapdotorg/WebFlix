/**
 * @wfx/app-web — the experience view pipelines (WFX-051).
 *
 * The data layer of every experience surface: pure PROJECTIONS of frozen
 * use-case output into plain serializable view models for the React tree.
 * No feed logic, ranking, or capability rules are reimplemented here —
 * eligibility, card assembly, capability truth, playback precedence, and
 * session creation all live in the merged use-cases; this module maps
 * their output to view data and joins identities (`host/canon.ts`) and
 * recorded watch state (`host/watch-state.ts`).
 *
 * Surfaces served:
 * - HOME: hero (resume-or-start), continue-watching row (recorded events
 *   → frozen fold → resume affordance), "For you" + "Trending" rows, and
 *   the shorts rail entry.
 * - SEARCH: query → feed page → results grid (typed empty state).
 * - WATCH: the long-form browse surface (all watch rows).
 * - DETAIL: connector metadata + capabilities + related cards + resume.
 * - PLAYER: a started playback session with the resolved Media Surface
 *   mode (embed iframe / browser panel / external handoff — never fake
 *   playback) plus the up-next queue.
 * - SHORTS: the projected OS short page (see host/shorts.ts).
 *
 * Honesty laws (mirror the frozen plain surface):
 * - A failed or empty feed is an EMPTY view — never fabricated cards.
 * - Playback failures are the typed Experience failure taxonomy, passed
 *   through to typed views — never a fake success.
 * - The detail page answers `null` when the source has no metadata for a
 *   ref — the honest not-found, never a guessed card.
 */

import type {
  ActionReceipt,
  EntertainmentItem,
  PlaybackMode,
  PlaybackSession,
  SourceItem,
} from "@wfx/domain";
import type { ClientStartResult, ExperienceFailure } from "../shared/runtime";
import type { WebClient } from "../main";
import type { ExperienceHost } from "./experience";
import { EXPERIENCE_CONTEXT, FOR_YOU_QUERY, SHORTS_QUERY, TRENDING_QUERY } from "./experience";
import { canonicalItemId, joinFeedCards } from "./canon";
import { recordedWatchStates } from "./watch-state";
import { classifyResumeAffordance, type FeedCard, type FeedSurface } from "@wfx/experience";

// ---------------------------------------------------------------------------
// Card views (plain serializable data for the React tree)
// ---------------------------------------------------------------------------

/**
 * One content card view: the projected feed card with the joined canonical
 * identity and the capability-honest affordance flags the UI renders
 * (presence ONLY — the source's declared truth, never a guess).
 */
export interface CardView {
  /** The JOINED canonical item id (stable per process — host/canon.ts). */
  readonly itemId: string;
  /** Canonical title (fallback: the source's external ref, honestly). */
  readonly title: string;
  /** Canonical type (movie / series / episode / video / ...). */
  readonly canonicalType: string;
  /** Duration in milliseconds when the source reported one. */
  readonly durationMs?: number;
  /** Source availability as the connector reported it. */
  readonly availability: string;
  /** The connector that sourced this card. */
  readonly connectorId: string;
  /** The connector-side external reference (stable content identity). */
  readonly externalRef: string;
  /** Per-item capabilities the connector declared for this content. */
  readonly capabilities: readonly string[];
  /** True iff any play capability is declared (embed/browser/external/native). */
  readonly playable: boolean;
  /** True iff the source declares `like` for this content. */
  readonly canLike: boolean;
  /** True iff the source declares `save` for this content. */
  readonly canSave: boolean;
  /** True iff the source declares `follow` for this content. */
  readonly canFollow: boolean;
}

/** Project one (already identity-joined) feed card into the view shape. */
function projectCard(card: FeedCard): CardView {
  const capabilities = card.realization.capabilities;
  return {
    itemId: card.item.id,
    title: card.item.canonicalTitle ?? card.realization.externalRef,
    canonicalType: card.item.canonicalType,
    ...(card.item.durationMs !== undefined ? { durationMs: card.item.durationMs } : {}),
    availability: card.realization.availability,
    connectorId: card.realization.connectorId,
    externalRef: card.realization.externalRef,
    capabilities: [...capabilities],
    playable: capabilities.some((cap) => cap.startsWith("play")),
    canLike: capabilities.includes("like"),
    canSave: capabilities.includes("save"),
    canFollow: capabilities.includes("follow"),
  };
}

/** Project a page of joined cards. */
function projectCards(cards: readonly FeedCard[]): CardView[] {
  return cards.map(projectCard);
}

// ---------------------------------------------------------------------------
// Continue watching (recorded events → frozen fold → resume affordance)
// ---------------------------------------------------------------------------

/** One continue-watching entry: the card view plus its derived resume state. */
export interface ContinueEntryView {
  readonly card: CardView;
  /** Last known position in milliseconds. */
  readonly resumePositionMs: number;
  /** position/duration clamped to [0, 1]; null when duration is unknown. */
  readonly completionRatio: number | null;
  /** The band-derived affordance: resume / restart / next. */
  readonly affordance: "resume" | "restart" | "next";
  /** ISO timestamp of the last watch evidence. */
  readonly lastWatchedAt: string;
}

/**
 * Derive the continue-watching entries for the home/detail surfaces: the
 * frozen WFX-029 fold over the recorded events (durations supplied by the
 * current feed's items), joined onto the given cards by canonical item id.
 * States whose item is not in `cards` are skipped (the join is honest —
 * no card is fabricated for content the current feed does not carry).
 * Only in-progress/skipped states continue (completed content does not).
 */
export function continueEntries(
  host: ExperienceHost,
  cards: readonly CardView[],
): ContinueEntryView[] {
  const items: EntertainmentItem[] = [];
  const byItemId = new Map<string, CardView>();
  for (const card of cards) {
    byItemId.set(card.itemId, card);
    items.push({
      id: card.itemId,
      canonicalType: card.canonicalType as EntertainmentItem["canonicalType"],
      canonicalTitle: card.title,
      ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
    });
  }
  const states = recordedWatchStates(EXPERIENCE_CONTEXT.userId, items);
  const entries: ContinueEntryView[] = [];
  for (const state of states) {
    if (state.status === "completed") continue;
    const card = byItemId.get(state.itemId);
    if (card === undefined) continue;
    entries.push({
      card,
      resumePositionMs: state.lastPositionMs,
      completionRatio: state.completionRatio,
      affordance: classifyResumeAffordance(state),
      lastWatchedAt: state.lastWatchedAt,
    });
  }
  // Most recently watched first (the presenter's recency law).
  entries.sort((a, b) =>
    a.lastWatchedAt === b.lastWatchedAt
      ? (a.card.itemId < b.card.itemId ? -1 : 1)
      : a.lastWatchedAt < b.lastWatchedAt
        ? 1
        : -1,
  );
  return entries;
}

// ---------------------------------------------------------------------------
// Feed loading (all reads through the runtime façade)
// ---------------------------------------------------------------------------

/** One named content row. */
export interface RowView {
  /** Deterministic row identity. */
  readonly id: string;
  /** Human-readable row header. */
  readonly title: string;
  /** NON-EMPTY honest reason (why this row exists — the row-model law). */
  readonly reason: string;
  readonly cards: readonly CardView[];
}

/** Load one feed page through the runtime and project it (empty on failure). */
async function loadCards(
  client: WebClient,
  surface: FeedSurface,
  query: string,
): Promise<FeedCard[]> {
  const page = await client.runtime.getFeed(EXPERIENCE_CONTEXT, surface, query);
  return joinFeedCards(page.cards);
}

/**
 * Load one feed page and project it into card views (joined identities,
 * capability-honest flags). The player's up-next queue and any other
 * card-list consumer compose through this — one law, no ad-hoc projections.
 */
export async function loadCardViews(
  host: ExperienceHost,
  surface: FeedSurface,
  query: string,
): Promise<CardView[]> {
  return projectCards(await loadCards(host.client, surface, query));
}

/** The home surface view model. */
export interface HomeView {
  readonly mode: "fixtures" | "service";
  /** The hero: the newest resumable entry, else the first For-you card. */
  readonly hero: { kind: "resume" | "start"; card: CardView; resumePositionMs: number; completionRatio: number | null } | null;
  /** Continue-watching entries (recorded watch state; may be empty — honest). */
  readonly continueEntries: readonly ContinueEntryView[];
  readonly forYou: readonly CardView[];
  readonly trending: readonly CardView[];
  /** The shorts rail cards (short-form; entry into the vertical feed). */
  readonly shorts: readonly CardView[];
}

/**
 * Load the home view. Rows are the typed seed queries (WFX-055 owns the
 * real composition); the hero and continue row derive from recorded watch
 * state (resume beats everything — the watch-feed law).
 */
export async function loadHomeView(host: ExperienceHost): Promise<HomeView> {
  const [forYouCards, trendingCards, shortsCards] = await Promise.all([
    loadCards(host.client, "watch", FOR_YOU_QUERY),
    loadCards(host.client, "watch", TRENDING_QUERY),
    loadCards(host.client, "short", SHORTS_QUERY),
  ]);
  const forYou = projectCards(forYouCards);
  const trending = projectCards(trendingCards);
  const shorts = projectCards(shortsCards);

  // The join pool for continue states: every card the home carries.
  const pool = [...forYou, ...trending, ...shorts];
  const cont = continueEntries(host, pool);

  // Hero: the newest resumable entry (resume beats everything), else the
  // first For-you card that is not already the resume hero (start).
  const resumeEntry = cont.find((entry) => entry.affordance !== "restart") ?? null;
  if (resumeEntry !== null) {
    return {
      mode: host.mode,
      hero: {
        kind: "resume",
        card: resumeEntry.card,
        resumePositionMs: resumeEntry.resumePositionMs,
        completionRatio: resumeEntry.completionRatio,
      },
      continueEntries: cont,
      forYou,
      trending,
      shorts,
    };
  }
  const startCard = forYou[0] ?? trending[0] ?? null;
  return {
    mode: host.mode,
    hero: startCard === null ? null : { kind: "start", card: startCard, resumePositionMs: 0, completionRatio: null },
    continueEntries: cont,
    forYou,
    trending,
    shorts,
  };
}

/** The search surface view model. */
export interface SearchView {
  readonly mode: "fixtures" | "service";
  /** The trimmed query (empty ⇒ the typed empty-query state). */
  readonly query: string;
  /** Result cards (joined identities), in source order. */
  readonly results: readonly CardView[];
}

/** Load the search view for one query (both surfaces browsed: watch + short). */
export async function loadSearchView(host: ExperienceHost, rawQuery: string): Promise<SearchView> {
  const query = rawQuery.trim();
  if (query.length === 0) {
    return { mode: host.mode, query, results: [] };
  }
  const [watchCards, shortCards] = await Promise.all([
    loadCards(host.client, "watch", query),
    loadCards(host.client, "short", query),
  ]);
  // Watch results first (the primary surface), then shorts not already shown.
  const results = projectCards([...watchCards, ...shortCards]);
  const seen = new Set<string>();
  const deduped = results.filter((card) => {
    if (seen.has(card.itemId)) return false;
    seen.add(card.itemId);
    return true;
  });
  return { mode: host.mode, query, results: deduped };
}

/** The long-form watch browse view (every watch row, no hero emphasis). */
export interface WatchBrowseView {
  readonly mode: "fixtures" | "service";
  readonly continueEntries: readonly ContinueEntryView[];
  readonly rows: readonly RowView[];
}

/** Load the watch browse surface (the WFX-027 long-form browse view). */
export async function loadWatchBrowseView(host: ExperienceHost): Promise<WatchBrowseView> {
  const [forYouCards, trendingCards] = await Promise.all([
    loadCards(host.client, "watch", FOR_YOU_QUERY),
    loadCards(host.client, "watch", TRENDING_QUERY),
  ]);
  const forYou = projectCards(forYouCards);
  const trending = projectCards(trendingCards);
  const pool = [...forYou, ...trending];
  const rows: RowView[] = [];
  const seenForYou = new Set(forYou.map((card) => card.itemId));
  if (forYou.length > 0) {
    rows.push({
      id: "for-you",
      title: "For you",
      reason: "Browse composed for your session (seeded until personal ranking ships).",
      cards: forYou,
    });
  }
  if (trending.length > 0) {
    rows.push({
      id: "trending",
      title: "Trending on your sources",
      reason: "What your connected sources surface broadly right now.",
      cards: trending.filter((card) => !seenForYou.has(card.itemId)),
    });
  }
  return { mode: host.mode, continueEntries: continueEntries(host, pool), rows };
}

// ---------------------------------------------------------------------------
// Detail surface (connector metadata through the port)
// ---------------------------------------------------------------------------

/** The detail view model: source metadata + capabilities + related cards. */
export interface DetailView {
  readonly mode: "fixtures" | "service";
  /** The canonical item id (joined) this detail page presents. */
  readonly itemId: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
  readonly availability: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly capabilities: readonly string[];
  readonly playable: boolean;
  readonly canLike: boolean;
  readonly canSave: boolean;
  readonly canFollow: boolean;
  /** Related cards ("more to explore" — same browse pool, minus this item). */
  readonly related: readonly CardView[];
  /** The resume state when one is recorded (else null — honest absence). */
  readonly resume: { resumePositionMs: number; affordance: "resume" | "restart" | "next"; completionRatio: number | null } | null;
}

/**
 * Load the detail view for one source ref: the connector's metadata (the
 * single-item read of the transport contract) plus the related browse
 * pool. Returns null when the source has no metadata for the ref — the
 * honest not-found (no card is fabricated from a bare ref).
 */
export async function loadDetailView(
  host: ExperienceHost,
  connectorId: string,
  externalRef: string,
): Promise<DetailView | null> {
  const metadata: SourceItem | null = await host.client.runtime.ports.connector.metadata(
    EXPERIENCE_CONTEXT,
    externalRef,
  );
  if (metadata === null || metadata.externalRef !== externalRef) return null;

  const itemId = canonicalItemId({ connectorId, externalRef });
  const capabilities = metadata.capabilities;
  const relatedCards = await loadCards(host.client, "watch", TRENDING_QUERY);
  const related = projectCards(relatedCards).filter((card) => card.itemId !== itemId);

  const item: EntertainmentItem = {
    id: itemId,
    canonicalType: (metadata.canonicalType ?? "video") as EntertainmentItem["canonicalType"],
    canonicalTitle: metadata.title,
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
  };
  const states = recordedWatchStates(EXPERIENCE_CONTEXT.userId, [item]);
  const state = states.find((entry) => entry.itemId === itemId && entry.status !== "completed");
  const resume =
    state === undefined
      ? null
      : {
          resumePositionMs: state.lastPositionMs,
          affordance: classifyResumeAffordance(state),
          completionRatio: state.completionRatio,
        };

  return {
    mode: host.mode,
    itemId,
    title: metadata.title,
    canonicalType: metadata.canonicalType ?? "video",
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    availability: metadata.availability,
    connectorId: metadata.connectorId,
    externalRef: metadata.externalRef,
    capabilities: [...capabilities],
    playable: capabilities.some((cap) => cap.startsWith("play")),
    canLike: capabilities.includes("like"),
    canSave: capabilities.includes("save"),
    canFollow: capabilities.includes("follow"),
    related,
    resume,
  };
}

// ---------------------------------------------------------------------------
// Player surface (a REAL started session + the resolved Media Surface mode)
// ---------------------------------------------------------------------------

/** The up-next queue entry. */
export interface QueueEntryView {
  readonly card: CardView;
}

/** The typed player view: the started session OR the typed failure. */
export type PlayerView =
  | {
      readonly kind: "playing";
      readonly mode: "fixtures" | "service";
      readonly itemId: string;
      readonly title: string;
      readonly canonicalType: string;
      readonly connectorId: string;
      readonly externalRef: string;
      /** The resolved Media Surface mode (embed/browser/external). */
      readonly surfaceMode: PlaybackMode;
      /** The realization URL when the chosen mode carries one (embed/browser). */
      readonly surfaceUrl: string | null;
      /** The playback session id (progress/complete/skip correlation). */
      readonly sessionId: string;
      /** Where playback resumes from (0 or the recorded position). */
      readonly resumePositionMs: number;
      /** The full precedence audit (why this platform plays it this way). */
      readonly precedenceTrace: readonly string[];
      /**
       * Like/save availability — the CONNECTOR-LEVEL declared truth (the
       * same fallback law the feed use-case uses when an item carries no
       * metadata). Per-item truth lives on cards and the detail surface.
       */
      readonly canLike: boolean;
      readonly canSave: boolean;
      readonly queue: readonly QueueEntryView[];
    }
  | {
      readonly kind: "failed";
      readonly mode: "fixtures" | "service";
      readonly title: string;
      readonly connectorId: string;
      readonly externalRef: string;
      readonly failure: ExperienceFailure;
      readonly queue: readonly QueueEntryView[];
    };

/**
 * Start the player surface: a REAL playback session through the runtime
 * (port resolution → device gate → session + "start" event). The resolved
 * Media Surface mode decides the rendering: embed ⇒ iframe, browser ⇒ the
 * web-surface panel, external ⇒ the visible handoff — never fake playback.
 * The up-next queue is supplied by the ROUTE from a real feed load (never
 * fabricated here).
 */
export async function startPlayerView(
  host: ExperienceHost,
  input: {
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: string;
    readonly durationMs?: number;
    readonly resumePositionMs?: number;
    readonly queue: readonly CardView[];
  },
): Promise<PlayerView> {
  const itemId = canonicalItemId({
    connectorId: input.connectorId,
    externalRef: input.externalRef,
  });
  const item: EntertainmentItem = {
    id: itemId,
    canonicalType: input.canonicalType as EntertainmentItem["canonicalType"],
    canonicalTitle: input.title,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };

  const started: ClientStartResult = await host.client.runtime.startPlayback(EXPERIENCE_CONTEXT, {
    item,
    externalRef: input.externalRef,
    ...(input.resumePositionMs !== undefined && input.resumePositionMs > 0
      ? { resumePositionMs: input.resumePositionMs }
      : {}),
  });

  const queue: QueueEntryView[] = input.queue
    .filter((card) => card.itemId !== itemId)
    .map((card) => ({ card }));

  if (!started.ok) {
    return {
      kind: "failed",
      mode: host.mode,
      title: input.title,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      failure: started,
      queue,
    };
  }
  const session: PlaybackSession = started.value;
  // Connector-level declared truth for the like/save controls (see the
  // PlayerView doc — the same no-metadata fallback law the feed uses).
  const declared = host.client.runtime.ports.connector.descriptor().capabilities;
  return {
    kind: "playing",
    mode: host.mode,
    itemId,
    title: input.title,
    canonicalType: input.canonicalType,
    connectorId: input.connectorId,
    externalRef: input.externalRef,
    surfaceMode: started.mode,
    surfaceUrl: session.realization.url ?? null,
    sessionId: session.id,
    resumePositionMs: session.resumePositionMs,
    precedenceTrace: [...started.precedenceTrace],
    canLike: declared.includes("like"),
    canSave: declared.includes("save"),
    queue,
  };
}

// ---------------------------------------------------------------------------
// Actions (like/save through the runtime — receipts are the truth)
// ---------------------------------------------------------------------------

/** The client-facing action request (validated server-side). */
export interface ActionRequestBody {
  readonly type: "like" | "save";
  readonly connectorId: string;
  readonly externalRef: string;
  /** REQUIRED for like/save — the engagement event mirror needs it. */
  readonly itemId: string;
}

/** Run one action through the runtime and return the receipt verbatim. */
export async function runAction(
  host: ExperienceHost,
  body: ActionRequestBody,
): Promise<{ ok: true; receipt: ActionReceipt } | { ok: false; error: string }> {
  if (body.type !== "like" && body.type !== "save") {
    return { ok: false, error: "type: expected 'like' or 'save'" };
  }
  if (typeof body.connectorId !== "string" || body.connectorId.length === 0) {
    return { ok: false, error: "connectorId: expected a non-empty string" };
  }
  if (typeof body.externalRef !== "string" || body.externalRef.length === 0) {
    return { ok: false, error: "externalRef: expected a non-empty string" };
  }
  if (typeof body.itemId !== "string" || !body.itemId.startsWith("wfxitm_")) {
    return { ok: false, error: "itemId: required for like/save (canonical item identity)" };
  }
  const result = await host.client.runtime.actions(EXPERIENCE_CONTEXT, {
    type: body.type,
    connectorId: body.connectorId,
    externalRef: body.externalRef,
    itemId: body.itemId,
  });
  if (!result.ok) {
    // The typed Experience failure taxonomy — passed through verbatim.
    return { ok: false, error: `${result.reason}: ${result.detail}` };
  }
  return { ok: true, receipt: result.value };
}
