/**
 * @wfx/experience — the Watch Feed presenter (WFX-027, Lane C).
 *
 * `createWatchFeedPresenter(deps)` returns the view-model builder
 * `build(feedPage, context): WatchFeedView` — the assembly that turns an OS
 * watch page (the WFX-021 `FeedPage`, passed as the structural
 * `WatchFeedPage` mirror — see view.ts) plus the session context into
 * presentable Watch Feed data. Framework-neutral core; the react binding is
 * the documented wiring in react.ts (react types are not available in this
 * package and the dispatch forbids new dependencies — the WFX-026 note
 * pattern, same as WFX-029).
 *
 * Presenter policy (typed, deterministic):
 *
 * - ROW ORDER: continue-watching first (resume beats everything), then
 *   episodic rows, then topic rows (`WATCH_FEED_ROW_ORDER`).
 * - CONTINUE ROW: the WFX-029 event-folded watch states with status
 *   in-progress/skipped (skipped = skipped-but-resumable — the WFX-029 law),
 *   ordered by last-watched recency desc, itemId codepoint asc tie-break.
 *   A state whose canonical item cannot be joined is NEVER fabricated into
 *   a card: its id lands in `unresolvedItemIds` (typed transparency).
 * - RESUME BADGE THRESHOLDS: the affordance badge follows the resume band —
 *   `resume` for >5% and <95% watched (the [5%, 95%) band), `restart` below
 *   5%, `next` at >= 95% or completed (classifyResumeAffordance, resume.ts).
 * - EPISODIC ROWS: one per series discoverable from the page cards (or the
 *   context items) with injected `RelationsPort` relations; entries are the
 *   attention-bounded binge chain with "New season" markers. A series with
 *   NO relations gets no row (honest absence). Episodic rows are ordered by
 *   the series' most recent watch activity desc, then page position asc,
 *   then seriesId codepoint asc.
 * - TOPIC ROWS: page cards grouped under the documented `topic` feature
 *   convention; ordered by their first entry's feed position, topic
 *   codepoint asc tie-break. Cards without the feature join no topic row.
 * - HERO: the most recent resumable entry (`kind: "resume"`), else the
 *   first watch-form card that is not itself resumable (`kind: "start"`).
 * - PLACEHOLDER STATES (typed): `loading` (the page has not loaded), `error`
 *   (the page failed — `errorDetail`), `empty` (a loaded page with no hero
 *   and no rows), `ready` (everything else).
 * - A11Y ON EVERY ENTRY: every entry of every row and the hero carries a
 *   non-empty `A11yLabel` (title, position description, action label).
 * - TRANSPARENCY: page cards not represented in any row or the hero are
 *   listed in `unplacedCardIds` — nothing is silently dropped.
 *
 * Purity: `build` is a pure function of the deps + arguments (no clock, no
 * randomness, no mutation of the inputs). The watch states are derived on
 * every call through the merged WFX-029 fold (`deriveWatchHistory`).
 *
 * Error channel: malformed caller input (context, page, or a malformed
 * `RelationsPort` answer) throws the typed `ExperienceError`. A short-page
 * input is caller misuse for a WATCH presenter (surface is session context,
 * and this presenter was built for the watch session) — typed throw, never
 * a silent reinterpretation.
 */

import type {
  EntertainmentEvent,
  EntertainmentItem,
  PlaybackMode,
  PlaybackSession,
  PlaybackRealization,
} from "@wfx/domain";
import {
  ATTENTION_MODES,
  AVAILABILITIES,
  CANONICAL_TYPES,
  isRecord,
  previewValue,
} from "@wfx/domain";

import { deriveWatchHistory, type WatchState } from "../library/history";
import type { RealizationBadge } from "../library/model";
import { ExperienceError } from "../ports";
import { isWatchFormCandidate } from "../use-cases/feed";
import {
  assertUsableSeriesRelations,
  computeContinuity,
  type AttentionMode,
  type RelationsPort,
  type SeriesContinuity,
} from "./continuity";
import { classifyResumeAffordance } from "./resume";
import {
  TOPIC_FEATURE_KEY,
  WATCH_FEED_ROW_ORDER,
  formatPositionMs,
  percentWatchedText,
  watchFeedTitle,
  type ContinueEntry,
  type ContinueWatchingRow,
  type EpisodicEntry,
  type EpisodicRow,
  type FeedRow,
  type TopicEntry,
  type TopicRow,
  type WatchFeedCard,
  type WatchFeedHero,
  type WatchFeedPage,
  type WatchFeedView,
} from "./view";

// ---------------------------------------------------------------------------
// Typed page-state input (loading / failed placeholders)
// ---------------------------------------------------------------------------

/** The load state of the OS watch page (typed placeholder input). */
export type WatchFeedPageState =
  | { kind: "loading" }
  | { kind: "failed"; detail: string }
  | { kind: "loaded"; page: WatchFeedPage };

// ---------------------------------------------------------------------------
// Context + deps
// ---------------------------------------------------------------------------

/**
 * The session context of one watch-feed build: identity, the attention mode
 * (frozen intent-graph policy vocabulary — it bounds binge-chain
 * visibility), and the WFX-029 fold inputs (events, sessions, items). All
 * optional arrays default to empty; the presenter derives the watch states
 * through the merged fold on every build.
 */
export interface WatchFeedContext {
  userId: string;
  sessionId: string;
  attentionMode: AttentionMode;
  events?: readonly EntertainmentEvent[];
  sessions?: readonly PlaybackSession[];
  items?: readonly EntertainmentItem[];
}

/** The presenter's dependency bundle (injected seams — never fetched). */
export interface WatchFeedPresenterDeps {
  /** The Entertainment-Graph relations seam (episodic rows). */
  relations: RelationsPort;
  /** connectorId → displayName for realization badges; missing names fall back to the connectorId. */
  displayNames?: Readonly<Record<string, string>>;
}

/** The presenter surface: `build` is pure over (deps, arguments). */
export interface WatchFeedPresenter {
  build(feedPage: WatchFeedPage | WatchFeedPageState, context: WatchFeedContext): WatchFeedView;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function assertUsableWatchFeedContext(context: WatchFeedContext): void {
  if (!isRecord(context)) {
    throw new ExperienceError("context: expected a WatchFeedContext object");
  }
  const problems: string[] = [];
  if (!isNonEmptyString(context.userId)) {
    problems.push(
      `context.userId: expected a non-empty string, got ${previewValue(context.userId)}`,
    );
  }
  if (!isNonEmptyString(context.sessionId)) {
    problems.push(
      `context.sessionId: expected a non-empty string, got ${previewValue(context.sessionId)}`,
    );
  }
  if (!isMemberOf(ATTENTION_MODES, context.attentionMode)) {
    problems.push(
      `context.attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}, got ${previewValue(context.attentionMode)}`,
    );
  }
  if (context.events !== undefined && !Array.isArray(context.events)) {
    problems.push(
      `context.events: expected an array of EntertainmentEvent when present, got ${previewValue(context.events)}`,
    );
  }
  if (context.sessions !== undefined && !Array.isArray(context.sessions)) {
    problems.push(
      `context.sessions: expected an array of PlaybackSession when present, got ${previewValue(context.sessions)}`,
    );
  }
  if (context.items !== undefined && !Array.isArray(context.items)) {
    problems.push(
      `context.items: expected an array of EntertainmentItem when present, got ${previewValue(context.items)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function cardProblems(card: unknown, prefix: string): string[] {
  if (!isRecord(card)) {
    return [`${prefix}: expected a WatchFeedCard object, got ${previewValue(card)}`];
  }
  const problems: string[] = [];
  if (typeof card.position !== "number" || !Number.isFinite(card.position) || card.position < 0) {
    problems.push(
      `${prefix}.position: expected a finite non-negative number, got ${previewValue(card.position)}`,
    );
  }
  if (!isRecord(card.candidate)) {
    problems.push(
      `${prefix}.candidate: expected an EntertainmentCandidate object, got ${previewValue(card.candidate)}`,
    );
  } else {
    if (!isNonEmptyString(card.candidate.itemId)) {
      problems.push(
        `${prefix}.candidate.itemId: expected a non-empty string, got ${previewValue(card.candidate.itemId)}`,
      );
    }
    if (!isRecord(card.candidate.features)) {
      problems.push(
        `${prefix}.candidate.features: expected a record of primitive feature values, got ${previewValue(card.candidate.features)}`,
      );
    }
    const realization = card.candidate.realization;
    if (!isRecord(realization)) {
      problems.push(
        `${prefix}.candidate.realization: expected an object, got ${previewValue(realization)}`,
      );
    } else {
      if (!isNonEmptyString(realization.connectorId)) {
        problems.push(
          `${prefix}.candidate.realization.connectorId: expected a non-empty string, got ${previewValue(realization.connectorId)}`,
        );
      }
      if (
        !Array.isArray(realization.capabilities) ||
        !realization.capabilities.every((cap) => typeof cap === "string")
      ) {
        problems.push(
          `${prefix}.candidate.realization.capabilities: expected an array of strings, got ${previewValue(realization.capabilities)}`,
        );
      }
      if (!isMemberOf(AVAILABILITIES, realization.availability)) {
        problems.push(
          `${prefix}.candidate.realization.availability: expected one of ${AVAILABILITIES.join(" | ")}, got ${previewValue(realization.availability)}`,
        );
      }
    }
  }
  if (card.modelScore !== null && !(typeof card.modelScore === "number" && Number.isFinite(card.modelScore))) {
    problems.push(
      `${prefix}.modelScore: expected a finite number or null, got ${previewValue(card.modelScore)}`,
    );
  }
  if (card.confidence !== null && !(typeof card.confidence === "number" && Number.isFinite(card.confidence))) {
    problems.push(
      `${prefix}.confidence: expected a finite number or null, got ${previewValue(card.confidence)}`,
    );
  }
  if (!Array.isArray(card.explanations) || !card.explanations.every((entry) => typeof entry === "string")) {
    problems.push(
      `${prefix}.explanations: expected an array of strings, got ${previewValue(card.explanations)}`,
    );
  }
  if (card.dominantObjective !== null && !isNonEmptyString(card.dominantObjective)) {
    problems.push(
      `${prefix}.dominantObjective: expected a non-empty string or null, got ${previewValue(card.dominantObjective)}`,
    );
  }
  if (
    !Array.isArray(card.positionReasons) ||
    !card.positionReasons.every((entry) => typeof entry === "string")
  ) {
    problems.push(
      `${prefix}.positionReasons: expected an array of strings, got ${previewValue(card.positionReasons)}`,
    );
  }
  return problems;
}

function assertUsableWatchFeedPage(page: WatchFeedPage): void {
  if (!isRecord(page)) {
    throw new ExperienceError("feedPage: expected a WatchFeedPage object");
  }
  const problems: string[] = [];
  if (page.surface !== "watch") {
    problems.push(
      `feedPage.surface: expected 'watch' (a WATCH presenter consumes the watch session's page — source never chooses feed mode), got ${previewValue(page.surface)}`,
    );
  }
  if (!isNonEmptyString(page.userId)) {
    problems.push(`feedPage.userId: expected a non-empty string, got ${previewValue(page.userId)}`);
  }
  if (!isNonEmptyString(page.sessionId)) {
    problems.push(
      `feedPage.sessionId: expected a non-empty string, got ${previewValue(page.sessionId)}`,
    );
  }
  if (!Array.isArray(page.cards)) {
    problems.push(
      `feedPage.cards: expected an array of WatchFeedCard, got ${previewValue(page.cards)}`,
    );
  } else {
    page.cards.forEach((card, index) => {
      problems.push(...cardProblems(card, `feedPage.cards[${index}]`));
    });
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Codepoint string comparison (locale-independent, deterministic). */
function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO epoch (NaN-safe: malformed timestamps sort last, never crash). */
function epochOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/** The capability that produces each playback mode (frozen precedence). */
const CAPABILITY_FOR_MODE: Readonly<Record<PlaybackMode, string>> = {
  native: "playNative",
  embed: "playEmbed",
  browser: "playBrowser",
  external: "playExternal",
};

const MODE_PRECEDENCE: readonly PlaybackMode[] = ["native", "embed", "browser", "external"];

/**
 * The best playback mode a candidate realization's capabilities admit, by
 * the frozen precedence order — undefined when the realization carries no
 * play capability (honestly badge-less, never guessed; the WFX-029 law).
 */
function preferredMode(capabilities: readonly string[]): PlaybackMode | undefined {
  for (const mode of MODE_PRECEDENCE) {
    if (capabilities.includes(CAPABILITY_FOR_MODE[mode])) return mode;
  }
  return undefined;
}

/**
 * Runtime guard for the frozen canonical-type vocabulary (a projected item
 * requires a REAL canonical type — never a fabricated one).
 */
function isCanonicalType(value: unknown): value is EntertainmentItem["canonicalType"] {
  return (
    typeof value === "string" && (CANONICAL_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Project a page candidate into a minimal canonical `EntertainmentItem` from
 * its OWN declared features (canonicalType required, canonicalTitle /
 * durationMs / orientation optional). A candidate without a usable
 * canonicalType projects to null — no card is ever fabricated (the WFX-005
 * law). Context items and relations episodes outrank projections (see the
 * item-index precedence in `build`).
 */
function projectCandidateItem(
  candidate: WatchFeedCard["candidate"],
): EntertainmentItem | null {
  const canonicalType = candidate.features["canonicalType"];
  if (!isCanonicalType(canonicalType)) return null;
  const item: EntertainmentItem = { id: candidate.itemId, canonicalType };
  const title = candidate.features["canonicalTitle"];
  if (typeof title === "string" && title.trim().length > 0) item.canonicalTitle = title;
  const durationMs = candidate.features["durationMs"];
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
    item.durationMs = durationMs;
  }
  const orientation = candidate.features["orientation"];
  if (
    orientation === "horizontal" ||
    orientation === "vertical" ||
    orientation === "square" ||
    orientation === "unknown"
  ) {
    item.orientation = orientation;
  }
  return item;
}

/** The newest session for one item (`createdAt` desc, later input index on ties). */
function newestSessionFor(
  sessions: readonly PlaybackSession[],
  itemId: string,
): PlaybackSession | undefined {
  let best: { session: PlaybackSession; createdAtMs: number; index: number } | undefined;
  sessions.forEach((session, index) => {
    if (session.itemId !== itemId) return;
    const createdAtMs = epochOf(session.createdAt);
    if (
      best === undefined ||
      createdAtMs > best.createdAtMs ||
      (createdAtMs === best.createdAtMs && index > best.index)
    ) {
      best = { session, createdAtMs, index };
    }
  });
  return best?.session;
}

/** The realization badge of a session realization (mode is declared on it). */
function sessionBadge(
  session: PlaybackSession,
  displayNames: Readonly<Record<string, string>> | undefined,
): RealizationBadge {
  const realization: PlaybackRealization = session.realization;
  const name = displayNames?.[realization.connectorId] ?? realization.connectorId;
  return {
    connectorId: realization.connectorId,
    mode: realization.mode,
    ...(realization.externalRef !== undefined ? { externalRef: realization.externalRef } : {}),
    label: `${name} (${realization.mode})`,
  };
}

/** The realization badge of a page card's candidate realization (mode from capabilities). */
function cardBadge(
  card: WatchFeedCard,
  displayNames: Readonly<Record<string, string>> | undefined,
): RealizationBadge | null {
  const mode = preferredMode(card.candidate.realization.capabilities ?? []);
  if (mode === undefined) return null;
  const connectorId = card.candidate.realization.connectorId;
  const name = displayNames?.[connectorId] ?? connectorId;
  return {
    connectorId,
    mode,
    ...(card.candidate.realization.externalRef !== undefined
      ? { externalRef: card.candidate.realization.externalRef }
      : {}),
    label: `${name} (${mode})`,
  };
}

// ---------------------------------------------------------------------------
// Entry assembly (a11y on every entry)
// ---------------------------------------------------------------------------

function continueEntryOf(
  state: WatchState,
  item: EntertainmentItem,
  badge: RealizationBadge | null,
): ContinueEntry {
  const title = watchFeedTitle(item);
  const affordance = classifyResumeAffordance(state);
  const ratioText = percentWatchedText(state.completionRatio);
  const positionText = ratioText ?? `position ${formatPositionMs(state.lastPositionMs)}`;
  const actionText =
    affordance === "resume"
      ? "Resume playback"
      : affordance === "restart"
        ? "Start over from the beginning"
        : "Play the next episode";
  return {
    item,
    title,
    resumePositionMs: Math.max(0, Math.floor(state.lastPositionMs)),
    completionRatio: state.completionRatio,
    affordance,
    realizationBadge: badge,
    lastWatchedAt: state.lastWatchedAt,
    a11y: {
      title: `Continue watching: ${title}`,
      position: `${positionText}; last watched ${state.lastWatchedAt}`,
      action: actionText,
    },
  };
}

// ---------------------------------------------------------------------------
// The presenter
// ---------------------------------------------------------------------------

/**
 * Build the Watch Feed presenter over the injected deps. `build` is pure: it
 * re-runs the fold + projection on every call and never mutates its inputs.
 * See the module doc for every policy.
 */
export function createWatchFeedPresenter(deps: WatchFeedPresenterDeps): WatchFeedPresenter {
  if (!isRecord(deps)) {
    throw new ExperienceError("deps: expected a WatchFeedPresenterDeps object");
  }
  if (!isRecord(deps.relations) || typeof deps.relations.seriesRelations !== "function") {
    throw new ExperienceError(
      `deps.relations: expected a RelationsPort with a seriesRelations function, got ${previewValue(deps.relations)}`,
    );
  }
  if (
    deps.displayNames !== undefined &&
    (!isRecord(deps.displayNames) ||
      !Object.entries(deps.displayNames).every(([, name]) => typeof name === "string"))
  ) {
    throw new ExperienceError(
      `deps.displayNames: expected a record of connectorId -> displayName when present, got ${previewValue(deps.displayNames)}`,
    );
  }

  return {
    build(feedPage, context) {
      assertUsableWatchFeedContext(context);

      // --- typed placeholder dispatch ---------------------------------------
      let page: WatchFeedPage;
      if (isRecord(feedPage) && (feedPage.kind === "loading" || feedPage.kind === "failed" || feedPage.kind === "loaded")) {
        if (feedPage.kind === "loading") {
          return {
            surface: "watch",
            state: "loading",
            rows: [],
            unresolvedItemIds: [],
            unplacedCardIds: [],
          };
        }
        if (feedPage.kind === "failed") {
          if (typeof feedPage.detail !== "string" || feedPage.detail.length === 0) {
            throw new ExperienceError(
              `feedPage.detail: expected a non-empty string for a failed page state, got ${previewValue(feedPage.detail)}`,
            );
          }
          return {
            surface: "watch",
            state: "error",
            rows: [],
            errorDetail: feedPage.detail,
            unresolvedItemIds: [],
            unplacedCardIds: [],
          };
        }
        page = feedPage.page;
      } else {
        page = feedPage;
      }
      assertUsableWatchFeedPage(page);

      // --- watch states (the merged WFX-029 fold — one derivation path) -----
      const events = context.events ?? [];
      const sessions = context.sessions ?? [];
      const contextItems = context.items ?? [];
      const watchStates = deriveWatchHistory(events, sessions, contextItems);
      const stateByItem = new Map<string, WatchState>(watchStates.map((state) => [state.itemId, state]));

      // --- the item index (context items > candidate projections) -----------
      const items = new Map<string, EntertainmentItem>();
      for (const item of contextItems) items.set(item.id, item);
      for (const card of page.cards) {
        if (items.has(card.candidate.itemId)) continue;
        const projected = projectCandidateItem(card.candidate);
        if (projected !== null) items.set(card.candidate.itemId, projected);
      }
      const itemOf = (id: string): EntertainmentItem | undefined => items.get(id);

      // The first page card per item (feed order).
      const cardByItem = new Map<string, WatchFeedCard>();
      for (const card of page.cards) {
        if (!cardByItem.has(card.candidate.itemId)) cardByItem.set(card.candidate.itemId, card);
      }

      // --- the continue row (recency order; unresolved states named) --------
      const unresolvedItemIds: string[] = [];
      const continueEntries: ContinueEntry[] = [];
      for (const state of watchStates) {
        if (state.status === "completed") continue; // completed is not continue material
        const item = itemOf(state.itemId);
        if (item === undefined) {
          unresolvedItemIds.push(state.itemId); // never a fabricated card
          continue;
        }
        const session = newestSessionFor(sessions, state.itemId);
        const badge =
          session !== undefined
            ? sessionBadge(session, deps.displayNames)
            : (cardByItem.get(state.itemId) !== undefined
                ? cardBadge(cardByItem.get(state.itemId)!, deps.displayNames)
                : null);
        continueEntries.push(continueEntryOf(state, item, badge));
      }
      continueEntries.sort(
        (a, b) =>
          epochOf(b.lastWatchedAt) - epochOf(a.lastWatchedAt) ||
          compareCodepoint(a.item.id, b.item.id),
      );

      // --- episodic rows (relations port + continuity engine) ----------------
      const seriesIds: string[] = [];
      const pushSeriesId = (id: string): void => {
        if (!seriesIds.includes(id)) seriesIds.push(id);
      };
      for (const card of page.cards) {
        if (itemOf(card.candidate.itemId)?.canonicalType === "series") {
          pushSeriesId(card.candidate.itemId);
        }
      }
      for (const item of contextItems) {
        if (item.canonicalType === "series") pushSeriesId(item.id);
      }

      const continuityBySeries = new Map<string, SeriesContinuity>();
      const continuityByEpisode = new Map<string, SeriesContinuity>();
      const episodicRowPlan: { row: EpisodicRow; activity: number; pagePosition: number }[] = [];
      for (const seriesId of seriesIds) {
        const relations = deps.relations.seriesRelations(seriesId);
        if (relations === null) continue; // honest absence: no relations, no row
        assertUsableSeriesRelations(relations); // malformed port answer ⇒ typed throw
        const continuity = computeContinuity({
          relations,
          history: watchStates,
          attentionMode: context.attentionMode,
        });
        continuityBySeries.set(seriesId, continuity);
        for (const episode of relations.episodes) {
          continuityByEpisode.set(episode.item.id, continuity);
        }

        const seriesItem = itemOf(seriesId);
        const seriesTitle =
          relations.series !== undefined
            ? watchFeedTitle(relations.series)
            : seriesItem !== undefined
              ? watchFeedTitle(seriesItem)
              : seriesId;

        const episodeById = new Map(relations.episodes.map((episode) => [episode.item.id, episode]));
        const entries: EpisodicEntry[] = [];
        let previousSeason: number | null =
          continuity.anchorEpisodeId !== null
            ? (episodeById.get(continuity.anchorEpisodeId)?.season ?? null)
            : null;
        for (const [chainIndex, episodeId] of continuity.bingeChain.entries()) {
          const episode = episodeById.get(episodeId);
          if (episode === undefined) continue; // defensive: chain ids come from relations
          const fromSeason = previousSeason;
          const crosses = fromSeason !== null && episode.season > fromSeason;
          entries.push({
            item: episode.item,
            title: watchFeedTitle(episode.item),
            season: episode.season,
            episode: episode.episode,
            chainIndex,
            ...(crosses && fromSeason !== null
              ? { newSeason: { fromSeason, toSeason: episode.season } }
              : {}),
            isNext: episodeId === continuity.nextEpisodeId,
            a11y: {
              title: `${seriesTitle}: S${episode.season}E${episode.episode} ${watchFeedTitle(episode.item)}`,
              position: `Season ${episode.season} episode ${episode.episode}${chainIndex > 0 ? `, ${chainIndex} ahead in the binge chain` : ""}`,
              action:
                episodeId === continuity.nextEpisodeId
                  ? "Play this episode next"
                  : "Queue from the binge chain",
            },
          });
          previousSeason = episode.season;
        }

        // The series' most recent watch activity (for row ordering).
        let activity = Number.NEGATIVE_INFINITY;
        for (const episode of relations.episodes) {
          const state = stateByItem.get(episode.item.id);
          if (state !== undefined) {
            const at = epochOf(state.lastWatchedAt);
            if (at > activity) activity = at;
          }
        }
        const pagePosition = page.cards.findIndex(
          (card) => card.candidate.itemId === seriesId,
        );

        episodicRowPlan.push({
          row: {
            kind: "episodic",
            rowId: `episodic:${seriesId}`,
            title: seriesTitle,
            reason: continuity.reason,
            seriesId,
            status: continuity.status,
            cursor: continuity.cursor,
            entries,
          },
          activity,
          pagePosition,
        });
      }
      // Row order: series watch activity desc, page position asc, seriesId codepoint asc.
      episodicRowPlan.sort(
        (a, b) =>
          b.activity - a.activity ||
          a.pagePosition - b.pagePosition ||
          compareCodepoint(a.row.seriesId, b.row.seriesId),
      );
      const episodicRows: EpisodicRow[] = episodicRowPlan.map((plan) => plan.row);

      // --- topic rows (the documented `topic` feature convention) ------------
      const topicGroups = new Map<string, { card: WatchFeedCard; item: EntertainmentItem }[]>();
      for (const card of page.cards) {
        const topic = card.candidate.features[TOPIC_FEATURE_KEY];
        if (typeof topic !== "string" || topic.trim().length === 0) continue; // typed-absent
        const item = itemOf(card.candidate.itemId);
        if (item === undefined) continue; // stays unplaced (no fabricated card)
        const key = topic.trim();
        const group = topicGroups.get(key) ?? [];
        group.push({ card, item });
        topicGroups.set(key, group);
      }
      const topicRows: TopicRow[] = [...topicGroups.entries()].map(([topic, group]) => {
        const objective = group[0]?.card.dominantObjective ?? null;
        return {
          kind: "topic",
          rowId: `topic:${topic}`,
          title: topic,
          reason:
            objective !== null
              ? `Topic "${topic}" — continues your session intent "${objective}"`
              : `Topic "${topic}" — grouped from your watch feed`,
          topic,
          entries: group.map<TopicEntry>(({ item }) => ({
            item,
            title: watchFeedTitle(item),
            a11y: {
              title: watchFeedTitle(item),
              position: `From your "${topic}" topic row`,
              action: `Open ${watchFeedTitle(item)}`,
            },
          })),
        };
      });
      topicRows.sort(
        (a, b) =>
          (cardByItem.get(a.entries[0]?.item.id ?? "")?.position ?? Number.POSITIVE_INFINITY) -
            (cardByItem.get(b.entries[0]?.item.id ?? "")?.position ?? Number.POSITIVE_INFINITY) ||
          compareCodepoint(a.topic, b.topic),
      );

      // --- the hero (resume-or-start) -----------------------------------------
      let hero: WatchFeedHero | undefined;
      const firstResume = continueEntries.find((entry) => entry.affordance === "resume");
      if (firstResume !== undefined) {
        const ratioText =
          percentWatchedText(firstResume.completionRatio) ??
          `at ${formatPositionMs(firstResume.resumePositionMs)}`;
        const heroContinuity =
          continuityByEpisode.get(firstResume.item.id) ??
          continuityBySeries.get(firstResume.item.id);
        hero = {
          kind: "resume",
          item: firstResume.item,
          title: firstResume.title,
          resumePositionMs: firstResume.resumePositionMs,
          completionRatio: firstResume.completionRatio,
          realizationBadge: firstResume.realizationBadge,
          ...(heroContinuity !== undefined ? { continuity: heroContinuity } : {}),
          a11y: {
            title: `Resume watching: ${firstResume.title}`,
            position: `${ratioText}; last watched ${firstResume.lastWatchedAt}`,
            action: "Resume playback",
          },
          reason: `"${firstResume.title}" — your most recent watch, ${ratioText}`,
        };
      } else {
        const startCard = page.cards.find((card) => {
          const item = itemOf(card.candidate.itemId);
          if (item === undefined) return false;
          if (!isWatchFormCandidate(item)) return false;
          const state = stateByItem.get(card.candidate.itemId);
          return state === undefined || state.status === "completed"; // fresh or re-watch
        });
        if (startCard !== undefined) {
          const item = itemOf(startCard.candidate.itemId)!;
          const heroContinuity =
            continuityBySeries.get(item.id) ?? continuityByEpisode.get(item.id);
          hero = {
            kind: "start",
            item,
            title: watchFeedTitle(item),
            resumePositionMs: 0,
            completionRatio: stateByItem.get(item.id)?.completionRatio ?? null,
            realizationBadge: cardBadge(startCard, deps.displayNames),
            ...(heroContinuity !== undefined ? { continuity: heroContinuity } : {}),
            a11y: {
              title: `Watch: ${watchFeedTitle(item)}`,
              position: "Not started — top of your watch feed",
              action: "Start playback",
            },
            reason:
              startCard.dominantObjective !== null
                ? `top of your watch feed — continues your session intent "${startCard.dominantObjective}"`
                : "top of your watch feed",
          };
        }
      }

      // --- transparency: what the row model could not place --------------------
      const placed = new Set<string>();
      if (hero !== undefined) placed.add(hero.item.id);
      for (const entry of continueEntries) placed.add(entry.item.id);
      for (const row of episodicRows) {
        placed.add(row.seriesId); // the episodic row REPRESENTS the series card
        for (const entry of row.entries) placed.add(entry.item.id);
      }
      for (const row of topicRows) {
        for (const entry of row.entries) placed.add(entry.item.id);
      }
      const unplacedSeen = new Set<string>();
      const unplacedCardIds: string[] = [];
      for (const card of page.cards) {
        const id = card.candidate.itemId;
        if (placed.has(id) || unplacedSeen.has(id)) continue;
        unplacedSeen.add(id);
        unplacedCardIds.push(id);
      }

      // --- rows in policy order (empty continue row suppressed) ----------------
      const continueRow: ContinueWatchingRow | undefined =
        continueEntries.length > 0
          ? {
              kind: "continue",
              rowId: "continue",
              title: "Continue watching",
              reason:
                "your in-progress and skipped watches, most recent first — resume beats everything",
              entries: continueEntries,
            }
          : undefined;
      const rowsByKind: Record<FeedRow["kind"], readonly FeedRow[]> = {
        continue: continueRow !== undefined ? [continueRow] : [],
        episodic: episodicRows,
        topic: topicRows,
      };
      const rows: FeedRow[] = WATCH_FEED_ROW_ORDER.flatMap((kind) => rowsByKind[kind]);

      const state = hero === undefined && rows.length === 0 ? "empty" : "ready";
      const view: WatchFeedView = {
        surface: "watch",
        state,
        ...(hero !== undefined ? { hero } : {}),
        rows,
        unresolvedItemIds,
        unplacedCardIds,
      };
      return view;
    },
  };
}
