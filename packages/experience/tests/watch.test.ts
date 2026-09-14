/**
 * @wfx/experience — Watch Feed tests (WFX-027, Lane C).
 *
 * Coverage required by the dispatch packet:
 * - View assembly: OS FeedPage → WatchFeedView golden output (hero,
 *   continue row order, episodic rows).
 * - Continuity: mid-series history → correct next episode + resume; finished
 *   series → "start next season"/"complete" markers; empty history → pilot.
 * - Binge-chain visibility bounded by attention mode (mindful < immersive).
 * - Controls: capability-honest descriptor (native realization ⇒ full set;
 *   embed-limited ⇒ typed-absent tracks).
 * - Resume thresholds: <5% watched = start-fresh; 5–95% = resume; >=95% =
 *   next-episode.
 * - Explainability: every row has a non-empty reason.
 * - Accessibility labels present on every entry.
 *
 * The OS page fixtures are the documented STRUCTURAL MIRROR of the WFX-021
 * `FeedPage` (see src/watch/view.ts): every field is copied verbatim from
 * packages/recommendation/src/os/types.ts, so a real OS page is assignable to
 * these fixtures. `@wfx/recommendation` is not a declared dependency of this
 * package (dependency honesty, see the view-model doc) and therefore cannot
 * be imported here.
 */

import { describe, expect, it } from "bun:test";
import type {
  DeviceCapabilities,
  EntertainmentEvent,
  EntertainmentItem,
  PlaybackRealization,
  PlaybackSession,
} from "@wfx/domain";
import { DESKTOP_NATIVE, validateEntertainmentEvent } from "@wfx/domain";

import {
  BINGE_CHAIN_VISIBILITY,
  ExperienceError,
  computeContinuity,
  bingeChainVisibility,
  buildPlaybackControlSet,
  classifyResumeAffordance,
  createWatchFeedPresenter,
  deriveWatchHistory,
  planResume,
  watchFeedElementTree,
  RESUME_MAX_RATIO,
  RESUME_MIN_RATIO,
  type A11yLabel,
  type PlaybackControlInput,
  type RelationsPort,
  type ResumeHistory,
  type SeriesRelations,
  type SurfaceResolution,
  type WatchFeedCard,
  type WatchFeedContext,
  type WatchFeedPage,
  type WatchState,
} from "../src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

const USER = "user-1";
const SESSION = "session-1";
const STAMP_AT = "2026-09-13T12:00:00.000Z";

/** Canonical item id: `wfxitm_` + zero-padded 26-char body (valid ULID grammar). */
function itemId(n: number): string {
  return `wfxitm_${String(n).padStart(26, "0")}`;
}

const IT = {
  movie: itemId(1),
  series: itemId(2),
  s1e1: itemId(3),
  s1e2: itemId(4),
  s1e3: itemId(5),
  s2e1: itemId(6),
  s2e2: itemId(7),
  s2e3: itemId(8),
  spaceVideo: itemId(9),
  historyVideo: itemId(10),
  plainVideo: itemId(11),
  lonelyState: itemId(12),
  series2: itemId(13),
} as const;

const EP_DURATION_MS = 2_400_000;
const MOVIE_DURATION_MS = 7_200_000;

const ITEMS: EntertainmentItem[] = [
  { id: IT.movie, canonicalType: "movie", canonicalTitle: "Asteroid Drift", durationMs: MOVIE_DURATION_MS, orientation: "horizontal" },
  { id: IT.series, canonicalType: "series", canonicalTitle: "Harbor Lights", orientation: "horizontal" },
  { id: IT.s1e1, canonicalType: "episode", canonicalTitle: "Pilot", durationMs: EP_DURATION_MS },
  { id: IT.s1e2, canonicalType: "episode", canonicalTitle: "The Dock", durationMs: EP_DURATION_MS },
  { id: IT.s1e3, canonicalType: "episode", canonicalTitle: "The Storm", durationMs: EP_DURATION_MS },
  { id: IT.s2e1, canonicalType: "episode", canonicalTitle: "New Tide", durationMs: EP_DURATION_MS },
  { id: IT.s2e2, canonicalType: "episode", canonicalTitle: "Undertow", durationMs: EP_DURATION_MS },
  { id: IT.s2e3, canonicalType: "episode", canonicalTitle: "Beacon", durationMs: EP_DURATION_MS },
  { id: IT.spaceVideo, canonicalType: "video", canonicalTitle: "Kurzgesagt Space", durationMs: 900_000, orientation: "horizontal" },
  { id: IT.historyVideo, canonicalType: "video", canonicalTitle: "History Basics", durationMs: 1_200_000, orientation: "horizontal" },
  { id: IT.plainVideo, canonicalType: "video", canonicalTitle: "Plain Video", durationMs: 1_500_000, orientation: "horizontal" },
  { id: IT.series2, canonicalType: "series", canonicalTitle: "Desert Rain", orientation: "horizontal" },
];

function itemById(id: string): EntertainmentItem {
  const found = ITEMS.find((item) => item.id === id);
  if (found === undefined) throw new Error(`fixture item ${id} missing`);
  return found;
}

/** One frozen watch-state event. */
function ev(
  itemIdOf: string,
  type: EntertainmentEvent["type"],
  at: string,
  payload?: Record<string, unknown>,
): EntertainmentEvent {
  return {
    userId: USER,
    itemId: itemIdOf,
    type,
    occurredAt: at,
    sessionId: SESSION,
    ...(payload !== undefined ? { payload } : {}),
  };
}

/** One well-formed playback session. */
function session(
  n: number,
  itemIdOf: string,
  positionMs: number,
  createdAt: string,
): PlaybackSession {
  return {
    id: `wfxpses_${String(n).padStart(26, "0")}`,
    userId: USER,
    itemId: itemIdOf,
    realization: {
      mode: "native",
      connectorId: "fake-source",
      externalRef: `fake:${itemIdOf}`,
      capabilities: ["playNative"],
    },
    resumePositionMs: positionMs,
    createdAt,
  };
}

// The golden timeline (ISO, explicit offset):
const T_MOVIE = "2026-09-13T09:00:00.000Z";
const T_S1E1_COMPLETE = "2026-09-13T10:00:00.000Z";
const T_S1E2_START = "2026-09-13T10:30:00.000Z";
const T_S1E2_PROGRESS = "2026-09-13T11:00:00.000Z";
const T_SESSION = "2026-09-13T11:30:00.000Z";

const GOLDEN_EVENTS: EntertainmentEvent[] = [
  ev(IT.movie, "progress", T_MOVIE, { positionMs: 1_440_000 }), // 20% of the movie
  ev(IT.s1e1, "complete", T_S1E1_COMPLETE, { positionMs: EP_DURATION_MS }),
  ev(IT.s1e2, "start", T_S1E2_START, { positionMs: 0 }),
  ev(IT.s1e2, "progress", T_S1E2_PROGRESS, { positionMs: 960_000 }), // 40% of the episode
];

const GOLDEN_SESSIONS: PlaybackSession[] = [
  session(1, IT.s1e2, 960_000, T_SESSION),
];

/** One OS-shaped feed card (the structural mirror of WFX-021's FeedCard). */
function card(
  position: number,
  itemIdOf: string,
  features: Record<string, number | string | boolean>,
  dominantObjective: string | null = null,
): WatchFeedCard {
  return {
    position,
    candidate: {
      itemId: itemIdOf,
      realization: {
        connectorId: "fake-source",
        externalRef: `fake:${itemIdOf}`,
        capabilities: ["playNative", "playEmbed"],
        availability: "available",
      },
      features,
    },
    modelScore: 1 - position * 0.1,
    confidence: 0.9,
    explanations: ["fixture explanation"],
    dominantObjective,
    positionReasons: [`fixture position ${position}`],
  };
}

const GOLDEN_PAGE: WatchFeedPage = {
  surface: "watch",
  userId: USER,
  sessionId: SESSION,
  cards: [
    card(0, IT.series, { canonicalType: "series", canonicalTitle: "Harbor Lights", orientation: "horizontal" }),
    card(1, IT.spaceVideo, { canonicalType: "video", canonicalTitle: "Kurzgesagt Space", durationMs: 900_000, orientation: "horizontal", topic: "space" }),
    card(2, IT.historyVideo, { canonicalType: "video", canonicalTitle: "History Basics", durationMs: 1_200_000, orientation: "horizontal", topic: "history" }, "documentaries"),
    card(3, IT.plainVideo, { canonicalType: "video", canonicalTitle: "Plain Video", durationMs: 1_500_000, orientation: "horizontal" }),
    card(4, IT.movie, { canonicalType: "movie", canonicalTitle: "Asteroid Drift", durationMs: MOVIE_DURATION_MS, orientation: "horizontal" }),
  ],
  trace: { model: { id: "fixture-model", version: "1" }, stages: [] },
};

const SERIES_EPISODES = [
  { item: itemById(IT.s1e1), season: 1, episode: 1 },
  { item: itemById(IT.s1e2), season: 1, episode: 2 },
  { item: itemById(IT.s1e3), season: 1, episode: 3 },
  { item: itemById(IT.s2e1), season: 2, episode: 1 },
  { item: itemById(IT.s2e2), season: 2, episode: 2 },
  { item: itemById(IT.s2e3), season: 2, episode: 3 },
];

function harborRelations(overrides?: Partial<SeriesRelations>): SeriesRelations {
  return {
    seriesId: IT.series,
    series: itemById(IT.series),
    episodes: SERIES_EPISODES.map((episode) => ({ ...episode })),
    ...overrides,
  };
}

/** A fake relations port answering from an in-memory map (null = unknown). */
function relationsPortOf(relations: readonly SeriesRelations[]): RelationsPort {
  const byId = new Map(relations.map((entry) => [entry.seriesId, entry]));
  return {
    seriesRelations(seriesId) {
      return byId.get(seriesId) ?? null;
    },
  };
}

const GOLDEN_DEPS = {
  relations: relationsPortOf([harborRelations()]),
  displayNames: { "fake-source": "Fake Source" },
};

const GOLDEN_CONTEXT: WatchFeedContext = {
  userId: USER,
  sessionId: SESSION,
  attentionMode: "balanced",
  events: GOLDEN_EVENTS,
  sessions: GOLDEN_SESSIONS,
  items: ITEMS,
};

/** One hand-built watch state (engine-level fixture). */
function state(
  itemIdOf: string,
  opts: { positionMs: number; ratio: number | null; at: string; status?: WatchState["status"] },
): WatchState {
  return {
    itemId: itemIdOf,
    lastPositionMs: opts.positionMs,
    completionRatio: opts.ratio,
    lastWatchedAt: opts.at,
    status: opts.status ?? "in-progress",
  };
}

/** A successful WFX-025 surface resolution fixture. */
function okResolution(itemIdOf: string): SurfaceResolution {
  return {
    ok: true,
    itemId: itemIdOf,
    chosen: {
      mode: "native",
      connectorId: "fake-source",
      externalRef: `fake:${itemIdOf}`,
      capabilities: ["playNative"],
    },
    mode: "native",
    precedenceTrace: ["native: accepted — fixture"],
  };
}

/** A resume history fixture. */
function resumeHistory(
  states: readonly WatchState[],
  sessions: readonly PlaybackSession[] = [],
  nextEpisodeOf?: Record<string, string>,
): ResumeHistory {
  return {
    stamp: { userId: USER, sessionId: SESSION, occurredAt: STAMP_AT },
    states,
    sessions,
    items: ITEMS,
    ...(nextEpisodeOf !== undefined ? { nextEpisodeOf } : {}),
  };
}

/** Run an action that must throw an `ExperienceError`; return it for assertions. */
function captureExperienceError(action: () => unknown): ExperienceError {
  try {
    action();
  } catch (thrown) {
    if (thrown instanceof ExperienceError) return thrown;
    throw new Error(`expected ExperienceError, got ${String(thrown)}`);
  }
  throw new Error("expected the call to throw an ExperienceError");
}

// ---------------------------------------------------------------------------
// View assembly — the golden output
// ---------------------------------------------------------------------------

describe("createWatchFeedPresenter — view assembly (golden output)", () => {
  const presenter = createWatchFeedPresenter(GOLDEN_DEPS);
  const view = presenter.build(GOLDEN_PAGE, GOLDEN_CONTEXT);

  it("produces a ready watch-surface view", () => {
    expect(view.surface).toBe("watch");
    expect(view.state).toBe("ready");
  });

  it("hero is the most recent resumable watch (the 40%-watched episode)", () => {
    expect(view.hero).toBeDefined();
    const hero = view.hero!;
    expect(hero.kind).toBe("resume");
    expect(hero.item.id).toBe(IT.s1e2);
    expect(hero.resumePositionMs).toBe(960_000);
    expect(hero.completionRatio).toBe(0.4);
    expect(hero.realizationBadge?.label).toBe("Fake Source (native)");
    expect(hero.continuity?.seriesId).toBe(IT.series);
    expect(hero.continuity?.cursor.nextEpisodeId).toBe(IT.s1e2);
    expect(hero.reason.length).toBeGreaterThan(0);
  });

  it("rows follow the ordering policy: continue → episodic → topic", () => {
    expect(view.rows.map((row) => row.kind)).toEqual(["continue", "episodic", "topic", "topic"]);
  });

  it("continue row is ordered by last-watched recency (episode 40% now, movie 20% earlier)", () => {
    const row = view.rows[0];
    expect(row?.kind).toBe("continue");
    if (row?.kind !== "continue") return;
    expect(row.rowId).toBe("continue");
    expect(row.title).toBe("Continue watching");
    expect(row.reason.length).toBeGreaterThan(0);
    expect(row.entries.map((entry) => entry.item.id)).toEqual([IT.s1e2, IT.movie]);
    const episode = row.entries[0]!;
    expect(episode.resumePositionMs).toBe(960_000);
    expect(episode.completionRatio).toBe(0.4);
    expect(episode.affordance).toBe("resume");
    expect(episode.realizationBadge).toEqual({
      connectorId: "fake-source",
      mode: "native",
      externalRef: `fake:${IT.s1e2}`,
      label: "Fake Source (native)",
    });
    const movie = row.entries[1]!;
    expect(movie.completionRatio).toBe(0.2);
    expect(movie.affordance).toBe("resume");
    expect(movie.realizationBadge?.label).toBe("Fake Source (native)"); // card-derived badge
  });

  it("the completed episode is not continue material (skipped-but-resumable stays)", () => {
    const row = view.rows[0];
    if (row?.kind !== "continue") throw new Error("expected continue row");
    expect(row.entries.some((entry) => entry.item.id === IT.s1e1)).toBe(false);
  });

  it("episodic row shows the continuity cursor and the balanced binge chain", () => {
    const row = view.rows[1];
    expect(row?.kind).toBe("episodic");
    if (row?.kind !== "episodic") return;
    expect(row.rowId).toBe(`episodic:${IT.series}`);
    expect(row.title).toBe("Harbor Lights");
    expect(row.seriesId).toBe(IT.series);
    expect(row.status).toBe("in-progress");
    expect(row.cursor).toEqual({
      seriesId: IT.series,
      nextEpisodeId: IT.s1e2,
      resumePositionMs: 960_000,
    });
    expect(row.entries.map((entry) => entry.item.id)).toEqual([IT.s1e2, IT.s1e3]);
    expect(row.entries[0]?.isNext).toBe(true);
    expect(row.entries[0]?.chainIndex).toBe(0);
    expect(row.entries[1]?.isNext).toBe(false);
    expect(row.entries[1]?.chainIndex).toBe(1);
    expect(row.reason).toContain("resume S1E2");
  });

  it("topic rows group the documented topic feature, intent-explained when the OS matched one", () => {
    const spaceRow = view.rows[2];
    const historyRow = view.rows[3];
    expect(spaceRow?.kind).toBe("topic");
    expect(historyRow?.kind).toBe("topic");
    if (spaceRow?.kind !== "topic" || historyRow?.kind !== "topic") return;
    expect(spaceRow.topic).toBe("space");
    expect(spaceRow.entries.map((entry) => entry.item.id)).toEqual([IT.spaceVideo]);
    expect(spaceRow.reason).toBe('Topic "space" — grouped from your watch feed');
    expect(historyRow.topic).toBe("history");
    expect(historyRow.entries.map((entry) => entry.item.id)).toEqual([IT.historyVideo]);
    expect(historyRow.reason).toBe(
      'Topic "history" — continues your session intent "documentaries"',
    );
  });

  it("transparency: nothing placed is hidden and nothing hidden is placed", () => {
    expect(view.unresolvedItemIds).toEqual([]);
    // The plain topic-less, state-less video is the only unplaced card; the
    // series card is represented by its episodic row.
    expect(view.unplacedCardIds).toEqual([IT.plainVideo]);
  });

  it("is deterministic: two builds of the same inputs are deep-equal", () => {
    const again = createWatchFeedPresenter(GOLDEN_DEPS).build(GOLDEN_PAGE, GOLDEN_CONTEXT);
    expect(again).toEqual(view);
  });

  it("derives the states through the merged WFX-029 fold (composition proof)", () => {
    const states = deriveWatchHistory(GOLDEN_EVENTS, GOLDEN_SESSIONS, ITEMS);
    const byId = new Map(states.map((entry) => [entry.itemId, entry]));
    expect(byId.get(IT.s1e2)?.completionRatio).toBe(0.4);
    expect(byId.get(IT.s1e1)?.status).toBe("completed");
    expect(byId.get(IT.movie)?.status).toBe("in-progress");
  });
});

// ---------------------------------------------------------------------------
// Presenter — placeholder states, hero fallback, honesty edges
// ---------------------------------------------------------------------------

describe("createWatchFeedPresenter — placeholder states and honesty edges", () => {
  const presenter = createWatchFeedPresenter(GOLDEN_DEPS);

  it("loading page state renders the typed loading placeholder", () => {
    const view = presenter.build({ kind: "loading" }, GOLDEN_CONTEXT);
    expect(view.state).toBe("loading");
    expect(view.rows).toEqual([]);
    expect(view.hero).toBeUndefined();
    expect(view.unplacedCardIds).toEqual([]);
  });

  it("failed page state renders the typed error placeholder with the detail", () => {
    const view = presenter.build({ kind: "failed", detail: "the OS pipeline failed" }, GOLDEN_CONTEXT);
    expect(view.state).toBe("error");
    expect(view.errorDetail).toBe("the OS pipeline failed");
    expect(view.rows).toEqual([]);
  });

  it("loaded-empty wrapper and a card-less page render the typed empty state", () => {
    const emptyPage: WatchFeedPage = { surface: "watch", userId: USER, sessionId: SESSION, cards: [] };
    const view = presenter.build({ kind: "loaded", page: emptyPage }, {
      userId: USER,
      sessionId: SESSION,
      attentionMode: "balanced",
    });
    expect(view.state).toBe("empty");
    expect(view.rows).toEqual([]);
    expect(view.hero).toBeUndefined();
  });

  it("a short-surface page is caller misuse for a WATCH presenter (typed throw)", () => {
    const shortPage = { ...GOLDEN_PAGE, surface: "short" } as unknown as WatchFeedPage;
    const error = captureExperienceError(() =>
      presenter.build(shortPage, GOLDEN_CONTEXT),
    );
    expect(error.details.some((detail) => detail.includes("watch"))).toBe(true);
  });

  it("with no watch state the hero is the start kind: the top watch-form card, with pilot continuity", () => {
    const view = presenter.build(GOLDEN_PAGE, {
      userId: USER,
      sessionId: SESSION,
      attentionMode: "balanced",
    });
    expect(view.state).toBe("ready");
    const hero = view.hero!;
    expect(hero.kind).toBe("start");
    expect(hero.item.id).toBe(IT.series); // first watch-form card of the page
    expect(hero.resumePositionMs).toBe(0);
    expect(hero.continuity?.status).toBe("pilot");
    expect(hero.reason).toContain("top of your watch feed");
    // No continue row without watch states.
    expect(view.rows.some((row) => row.kind === "continue")).toBe(false);
  });

  it("a watch state with no joinable item is named, never fabricated into a card", () => {
    const lonelyEvents: EntertainmentEvent[] = [
      ev(IT.lonelyState, "progress", T_S1E2_PROGRESS, { positionMs: 500_000 }),
    ];
    const view = presenter.build(GOLDEN_PAGE, {
      ...GOLDEN_CONTEXT,
      events: lonelyEvents,
      sessions: [],
    });
    expect(view.unresolvedItemIds).toEqual([IT.lonelyState]);
    const continueRow = view.rows.find((row) => row.kind === "continue");
    expect(continueRow).toBeUndefined();
  });

  it("a series with no relations gets no episodic row (honest absence) and its card is unplaced", () => {
    const view = createWatchFeedPresenter({ relations: relationsPortOf([]) }).build(
      GOLDEN_PAGE,
      GOLDEN_CONTEXT,
    );
    expect(view.rows.some((row) => row.kind === "episodic")).toBe(false);
    expect(view.unplacedCardIds).toContain(IT.series);
  });

  it("a malformed relations-port answer is a typed throw, never a broken row", () => {
    const broken: RelationsPort = {
      seriesRelations: () => ({ seriesId: IT.series, episodes: "nope" }) as unknown as SeriesRelations,
    };
    const error = captureExperienceError(() =>
      createWatchFeedPresenter({ relations: broken }).build(GOLDEN_PAGE, GOLDEN_CONTEXT),
    );
    expect(error.details.some((detail) => detail.includes("episodes"))).toBe(true);
  });

  it("unwatched series from the context items also earn episodic rows (host join is authoritative)", () => {
    const view = presenter.build(GOLDEN_PAGE, {
      ...GOLDEN_CONTEXT,
      events: [],
      sessions: [],
      items: [...ITEMS],
    });
    // No series2 card on the page, but the context item introduces it — no
    // relations for it though, so still no row (honest absence).
    expect(view.rows.filter((row) => row.kind === "episodic")).toHaveLength(1);
  });

  it("malformed context is a typed throw", () => {
    const error = captureExperienceError(() =>
      presenter.build(GOLDEN_PAGE, {
        userId: "",
        sessionId: SESSION,
        attentionMode: "balanced",
      }),
    );
    expect(error.details.some((detail) => detail.includes("userId"))).toBe(true);
    const badMode = captureExperienceError(() =>
      presenter.build(GOLDEN_PAGE, {
        userId: USER,
        sessionId: SESSION,
        attentionMode: "hyperfocus" as WatchFeedContext["attentionMode"],
      }),
    );
    expect(badMode.details.some((detail) => detail.includes("attentionMode"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Continuity — the episodic engine
// ---------------------------------------------------------------------------

describe("computeContinuity — mid-series, finished, complete, pilot", () => {
  const relations = harborRelations();

  it("mid-series history resumes the in-progress episode with the next-episode chain", () => {
    const history = [
      state(IT.s1e1, { positionMs: EP_DURATION_MS, ratio: 1, at: T_S1E1_COMPLETE, status: "completed" }),
      state(IT.s1e2, { positionMs: 1_080_000, ratio: 0.45, at: T_S1E2_PROGRESS }),
    ];
    const continuity = computeContinuity({ relations, history, attentionMode: "balanced" });
    expect(continuity.status).toBe("in-progress");
    expect(continuity.nextEpisodeId).toBe(IT.s1e2);
    expect(continuity.resumeEpisodeId).toBe(IT.s1e2);
    expect(continuity.resumePositionMs).toBe(1_080_000);
    expect(continuity.anchorEpisodeId).toBe(IT.s1e2);
    expect(continuity.cursor).toEqual({
      seriesId: IT.series,
      nextEpisodeId: IT.s1e2,
      resumePositionMs: 1_080_000,
    });
    expect(continuity.bingeChain).toEqual([IT.s1e2, IT.s1e3]);
    expect(continuity.resumePoints).toEqual({ [IT.s1e1]: EP_DURATION_MS, [IT.s1e2]: 1_080_000 });
    expect(continuity.reason).toContain("45% watched");
  });

  it("a finished season yields the 'new season' marker targeting the next season's first episode", () => {
    const history = [
      state(IT.s1e1, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T10:00:00.000Z", status: "completed" }),
      state(IT.s1e2, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T10:40:00.000Z", status: "completed" }),
      state(IT.s1e3, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T11:20:00.000Z", status: "completed" }),
    ];
    const continuity = computeContinuity({ relations, history, attentionMode: "balanced" });
    expect(continuity.status).toBe("new-season");
    expect(continuity.nextEpisodeId).toBe(IT.s2e1);
    expect(continuity.newSeason).toEqual({ fromSeason: 1, toSeason: 2 });
    expect(continuity.bingeChain).toEqual([IT.s2e1, IT.s2e2]);
    expect(continuity.reason).toContain("season 1 complete; start season 2");
  });

  it("a fully watched series is complete: no next episode, no chain", () => {
    const history = [
      state(IT.s1e1, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T10:00:00.000Z", status: "completed" }),
      state(IT.s1e2, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T10:40:00.000Z", status: "completed" }),
      state(IT.s1e3, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T11:20:00.000Z", status: "completed" }),
      state(IT.s2e1, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T12:00:00.000Z", status: "completed" }),
      state(IT.s2e2, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T12:40:00.000Z", status: "completed" }),
      state(IT.s2e3, { positionMs: EP_DURATION_MS, ratio: 1, at: "2026-09-13T13:20:00.000Z", status: "completed" }),
    ];
    const continuity = computeContinuity({ relations, history, attentionMode: "balanced" });
    expect(continuity.status).toBe("complete");
    expect(continuity.nextEpisodeId).toBeNull();
    expect(continuity.bingeChain).toEqual([]);
    expect(continuity.cursor.nextEpisodeId).toBeNull();
    expect(continuity.reason).toContain("series complete");
  });

  it("empty history starts the pilot", () => {
    const continuity = computeContinuity({ relations, history: [], attentionMode: "balanced" });
    expect(continuity.status).toBe("pilot");
    expect(continuity.nextEpisodeId).toBe(IT.s1e1);
    expect(continuity.resumePositionMs).toBe(0);
    expect(continuity.anchorEpisodeId).toBeNull();
    expect(continuity.bingeChain).toEqual([IT.s1e1, IT.s1e2]);
    expect(continuity.reason).toContain("start with the pilot (S1E1)");
  });

  it("an episode at >=95% (not yet completed) counts as finished and advances", () => {
    const history = [
      state(IT.s1e2, { positionMs: 2_300_000, ratio: RESUME_MAX_RATIO, at: T_S1E2_PROGRESS }),
    ];
    const continuity = computeContinuity({ relations, history, attentionMode: "balanced" });
    expect(continuity.status).toBe("in-progress");
    expect(continuity.nextEpisodeId).toBe(IT.s1e3);
    expect(continuity.resumePositionMs).toBe(0);
  });

  it("a declared successor edge WINS over the canonical order (graph truth)", () => {
    const edged = harborRelations({
      episodes: SERIES_EPISODES.map((episode) =>
        episode.item.id === IT.s1e2 ? { ...episode, nextEpisodeId: IT.s2e2 } : { ...episode },
      ),
    });
    const inProgress = computeContinuity({
      relations: edged,
      history: [state(IT.s1e2, { positionMs: 600_000, ratio: 0.25, at: T_S1E2_PROGRESS })],
      attentionMode: "balanced",
    });
    expect(inProgress.bingeChain).toEqual([IT.s1e2, IT.s2e2]); // edge, not S1E3

    const finished = computeContinuity({
      relations: edged,
      history: [state(IT.s1e2, { positionMs: EP_DURATION_MS, ratio: 1, at: T_S1E2_PROGRESS, status: "completed" })],
      attentionMode: "balanced",
    });
    expect(finished.nextEpisodeId).toBe(IT.s2e2);
    expect(finished.status).toBe("new-season");
    expect(finished.newSeason).toEqual({ fromSeason: 1, toSeason: 2 });
  });

  it("an edge pointing outside the series is ignored (canonical fallback applies)", () => {
    const outside = harborRelations({
      episodes: SERIES_EPISODES.map((episode) =>
        episode.item.id === IT.s1e1 ? { ...episode, nextEpisodeId: itemId(99) } : { ...episode },
      ),
    });
    const continuity = computeContinuity({
      relations: outside,
      history: [state(IT.s1e1, { positionMs: EP_DURATION_MS, ratio: 1, at: T_S1E1_COMPLETE, status: "completed" })],
      attentionMode: "balanced",
    });
    expect(continuity.nextEpisodeId).toBe(IT.s1e2); // canonical successor
    expect(continuity.status).toBe("in-progress");
  });

  it("a series with zero episodes is honestly empty", () => {
    const continuity = computeContinuity({
      relations: { seriesId: IT.series, series: itemById(IT.series), episodes: [] },
      history: [],
      attentionMode: "balanced",
    });
    expect(continuity.status).toBe("empty");
    expect(continuity.nextEpisodeId).toBeNull();
  });

  it("every status carries a non-empty reason; malformed input is a typed throw", () => {
    for (const attentionMode of ["mindful", "balanced", "immersive", "custom"] as const) {
      const continuity = computeContinuity({ relations, history: [], attentionMode });
      expect(continuity.reason.length).toBeGreaterThan(0);
    }
    const error = captureExperienceError(() =>
      computeContinuity({ relations, history: [], attentionMode: "hyperfocus" as never }),
    );
    expect(error.details.some((detail) => detail.includes("attentionMode"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Binge-chain visibility (attention-bounded)
// ---------------------------------------------------------------------------

describe("binge-chain visibility — bounded by the attention mode", () => {
  it("the documented constants: mindful < balanced < immersive; custom is the balanced default", () => {
    expect(bingeChainVisibility("mindful")).toBe(1);
    expect(bingeChainVisibility("balanced")).toBe(2);
    expect(bingeChainVisibility("immersive")).toBe(4);
    expect(bingeChainVisibility("custom")).toBe(2);
    expect(bingeChainVisibility("mindful")).toBeLessThan(bingeChainVisibility("immersive"));
    expect(BINGE_CHAIN_VISIBILITY).toEqual({ mindful: 1, balanced: 2, immersive: 4, custom: 2 });
  });

  it("the engine bounds the chain: mindful 1, balanced 2, immersive 4 (pilot start)", () => {
    const relations = harborRelations();
    const mindful = computeContinuity({ relations, history: [], attentionMode: "mindful" });
    const balanced = computeContinuity({ relations, history: [], attentionMode: "balanced" });
    const immersive = computeContinuity({ relations, history: [], attentionMode: "immersive" });
    expect(mindful.bingeChain).toEqual([IT.s1e1]);
    expect(balanced.bingeChain).toEqual([IT.s1e1, IT.s1e2]);
    expect(immersive.bingeChain).toEqual([IT.s1e1, IT.s1e2, IT.s1e3, IT.s2e1]);
    expect(mindful.bingeChain.length).toBeLessThan(immersive.bingeChain.length);
  });

  it("the chain never exceeds the remaining episodes", () => {
    const twoLeft = harborRelations({
      episodes: SERIES_EPISODES.filter((episode) => episode.item.id === IT.s2e2 || episode.item.id === IT.s2e3),
    });
    const continuity = computeContinuity({
      relations: twoLeft,
      history: [],
      attentionMode: "immersive",
    });
    expect(continuity.bingeChain).toEqual([IT.s2e2, IT.s2e3]); // only 2 exist
  });
});

// ---------------------------------------------------------------------------
// Controls — capability-honest descriptors
// ---------------------------------------------------------------------------

describe("buildPlaybackControlSet — capability honesty", () => {
  const fullDeclaration = {
    qualityTiers: [
      { id: "720p", label: "HD", heightPx: 720, codec: "h264" },
      { id: "1080p", label: "Full HD", heightPx: 1080, codec: "h264" },
      { id: "2160p", label: "Ultra HD", heightPx: 2160, codec: "hevc" },
    ],
    audioTracks: [
      { id: "en-orig", language: "en", label: "English (original)", kind: "original" },
      { id: "es-dub", language: "es", label: "Español (doblado)", kind: "dubbed" },
    ],
    subtitleTracks: [
      { id: "en-subs", language: "en", label: "English", kind: "subtitles" },
      { id: "es-sdh", language: "es", label: "Español (SDH)", kind: "sdh" },
    ],
  } satisfies import("../src/index").RealizationControlDeclaration;

  const nativeRealization: PlaybackRealization = {
    mode: "native",
    connectorId: "fake-source",
    externalRef: "fake:movie-1",
    capabilities: ["playNative", "h264", "hevc"],
  };

  function input(overrides?: Partial<PlaybackControlInput>): PlaybackControlInput {
    return {
      realization: nativeRealization,
      device: DESKTOP_NATIVE,
      declaration: fullDeclaration,
      ...overrides,
    };
  }

  it("native realization on a capable device composes the FULL declared set", () => {
    const set = buildPlaybackControlSet(input());
    expect(set.mode).toBe("native");
    expect(set.quality).toEqual({
      available: true,
      options: fullDeclaration.qualityTiers,
      excluded: [],
    });
    expect(set.audio).toEqual({ available: true, options: fullDeclaration.audioTracks, excluded: [] });
    expect(set.subtitles).toEqual({
      available: true,
      options: fullDeclaration.subtitleTracks,
      excluded: [],
    });
  });

  it("a tier whose codec the device cannot decode is excluded WITH a reason", () => {
    const noAv1: DeviceCapabilities = {
      ...DESKTOP_NATIVE,
      codecs: ["h264", "hevc", "vp9", "aac", "opus"],
    };
    const set = buildPlaybackControlSet(
      input({
        device: noAv1,
        declaration: {
          ...fullDeclaration,
          qualityTiers: [
            ...fullDeclaration.qualityTiers,
            { id: "av1-1080p", label: "AV1 FHD", heightPx: 1080, codec: "av1" },
          ],
        },
      }),
    );
    expect(set.quality.available).toBe(true);
    if (!set.quality.available) return;
    expect(set.quality.options.map((tier) => tier.id)).toEqual(["720p", "1080p", "2160p"]);
    expect(set.quality.excluded).toHaveLength(1);
    expect(set.quality.excluded[0]?.id).toBe("av1-1080p");
    expect(set.quality.excluded[0]?.reason).toContain("not decodable");
  });

  it("embed-limited realizations are TYPED-ABSENT for quality, audio, and subtitles", () => {
    const set = buildPlaybackControlSet(
      input({
        realization: {
          mode: "embed",
          connectorId: "fake-source",
          externalRef: "fake:movie-1",
          url: "https://fixture.invalid/embed/fake:movie-1",
          capabilities: ["playEmbed"],
        },
      }),
    );
    expect(set.mode).toBe("embed");
    expect(set.quality.available).toBe(false);
    expect(set.audio.available).toBe(false);
    expect(set.subtitles.available).toBe(false);
    for (const control of [set.quality, set.audio, set.subtitles]) {
      if (control.available) throw new Error("expected typed-absent");
      expect(control.reason).toContain("does not fabricate control");
    }
  });

  it("browser and external modes are typed-absent too (provider-owned pipelines)", () => {
    for (const mode of ["browser", "external"] as const) {
      const set = buildPlaybackControlSet(
        input({
          realization: {
            mode,
            connectorId: "fake-source",
            externalRef: "fake:movie-1",
            capabilities: [`play${mode === "browser" ? "Browser" : "External"}`],
          },
        }),
      );
      expect(set.quality.available).toBe(false);
      expect(set.audio.available).toBe(false);
      expect(set.subtitles.available).toBe(false);
    }
  });

  it("a native realization with an empty declaration is an honest absence, not an empty success", () => {
    const set = buildPlaybackControlSet(input({ declaration: {} }));
    expect(set.quality).toEqual({ available: false, reason: "no quality tiers declared by the realization" });
    expect(set.audio).toEqual({ available: false, reason: "no audio tracks declared by the realization" });
    expect(set.subtitles).toEqual({ available: false, reason: "no subtitle tracks declared by the realization" });
  });

  it("a device that cannot realize native playback gets fully absent controls with the device reason", () => {
    const set = buildPlaybackControlSet(
      input({
        device: { ...DESKTOP_NATIVE, playbackModes: ["embed", "browser", "external"] },
      }),
    );
    expect(set.quality.available).toBe(false);
    if (set.quality.available) return;
    expect(set.quality.reason).toContain("device cannot realize native playback");
    expect(set.audio.available).toBe(false);
    expect(set.subtitles.available).toBe(false);
  });

  it("malformed declarations are typed throws with field detail", () => {
    const error = captureExperienceError(() =>
      buildPlaybackControlSet(
        input({
          declaration: {
            qualityTiers: [{ id: "", label: "Broken", heightPx: 0 }],
          },
        }),
      ),
    );
    expect(error.details.some((detail) => detail.includes("qualityTiers"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resume — thresholds and typed events
// ---------------------------------------------------------------------------

describe("planResume — the resume band (<5% / 5–95% / >=95%)", () => {
  const movieItem = itemById(IT.movie);
  const episodeItem = itemById(IT.s1e2);
  const movieSession = session(7, IT.movie, 1_440_000, T_SESSION);
  const adjacency = { [IT.s1e2]: IT.s1e3 };

  it("<5% watched plans a start-fresh from position 0", () => {
    const result = planResume(
      movieItem,
      resumeHistory([state(IT.movie, { positionMs: 288_000, ratio: 0.04, at: T_MOVIE })]),
      okResolution(IT.movie),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("start-fresh");
    expect(result.plan.itemId).toBe(IT.movie);
    expect(result.plan.resumePositionMs).toBe(0);
    expect(result.plan.reason).toContain("under 5% watched");
  });

  it("5% watched (band start, inclusive) resumes — continue-session when a session exists", () => {
    const result = planResume(
      movieItem,
      resumeHistory(
        [state(IT.movie, { positionMs: 360_000, ratio: RESUME_MIN_RATIO, at: T_MOVIE })],
        [movieSession],
      ),
      okResolution(IT.movie),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("continue-session");
    expect(result.plan.resumePositionMs).toBe(360_000);
    expect(result.plan.session?.id).toBe(movieSession.id);
  });

  it("94.9% watched still resumes (band end exclusive)", () => {
    const result = planResume(
      movieItem,
      resumeHistory(
        [state(IT.movie, { positionMs: 6_832_800, ratio: 0.949, at: T_MOVIE })],
        [movieSession],
      ),
      okResolution(IT.movie),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("continue-session");
  });

  it("95% watched advances to the DECLARED next episode", () => {
    const result = planResume(
      episodeItem,
      resumeHistory(
        [state(IT.s1e2, { positionMs: 2_280_000, ratio: RESUME_MAX_RATIO, at: T_S1E2_PROGRESS })],
        [],
        adjacency,
      ),
      okResolution(IT.s1e2),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("next-episode");
    expect(result.plan.itemId).toBe(IT.s1e3);
    expect(result.plan.resumePositionMs).toBe(0);
    expect(result.plan.reason).toContain("95% watched");
  });

  it("a completed item with no declared successor plans a fresh re-watch", () => {
    const result = planResume(
      movieItem,
      resumeHistory(
        [state(IT.movie, { positionMs: MOVIE_DURATION_MS, ratio: 1, at: T_MOVIE, status: "completed" })],
        [],
      ),
      okResolution(IT.movie),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("start-fresh");
    expect(result.plan.resumePositionMs).toBe(0);
    expect(result.plan.reason).toContain("re-watch");
  });

  it("a resumable item with NO session starts a fresh session AT the resume position", () => {
    const result = planResume(
      movieItem,
      resumeHistory([state(IT.movie, { positionMs: 1_440_000, ratio: 0.2, at: T_MOVIE })]),
      okResolution(IT.movie),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("start-fresh");
    expect(result.plan.resumePositionMs).toBe(1_440_000);
    expect(result.plan.reason).toContain("NEW playback session");
  });

  it("no watch state at all plans a plain start-fresh", () => {
    const result = planResume(movieItem, resumeHistory([]), okResolution(IT.movie));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("start-fresh");
    expect(result.plan.resumePositionMs).toBe(0);
  });

  it("emits the exact frozen WFX-005 start event (typed, not fired)", () => {
    const continueResult = planResume(
      movieItem,
      resumeHistory(
        [state(IT.movie, { positionMs: 1_440_000, ratio: 0.2, at: T_MOVIE })],
        [movieSession],
      ),
      okResolution(IT.movie),
    );
    expect(continueResult.ok).toBe(true);
    if (!continueResult.ok) return;
    const event = continueResult.plan.event;
    expect(validateEntertainmentEvent(event).ok).toBe(true);
    expect(event.type).toBe("start");
    expect(event.userId).toBe(USER);
    expect(event.sessionId).toBe(SESSION);
    expect(event.occurredAt).toBe(STAMP_AT);
    expect(event.itemId).toBe(IT.movie);
    expect(event.payload).toEqual({ playbackSessionId: movieSession.id });

    const freshResult = planResume(movieItem, resumeHistory([]), okResolution(IT.movie));
    expect(freshResult.ok).toBe(true);
    if (!freshResult.ok) return;
    expect(freshResult.plan.event.type).toBe("start");
    expect(freshResult.plan.event.payload).toBeUndefined(); // the app layer's WFX-005 start stamps the fresh id
    expect(validateEntertainmentEvent(freshResult.plan.event).ok).toBe(true);
  });

  it("the plan carries the WFX-025 realization handoff", () => {
    const result = planResume(movieItem, resumeHistory([]), okResolution(IT.movie));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.mode).toBe("native");
    expect(result.plan.realization.connectorId).toBe("fake-source");
  });

  it("an unresolvable surface resolution is the typed unresolvable result (reasons verbatim)", () => {
    const reasons = ["native: rejected — no native realization present", "embed: rejected — no embed realization present"];
    const result = planResume(movieItem, resumeHistory([]), {
      ok: false,
      kind: "unresolvable",
      reasons,
    });
    expect(result).toEqual({ ok: false, reason: "unresolvable", details: reasons });
  });

  it("a resolution for a different item is caller misuse (typed throw)", () => {
    const error = captureExperienceError(() =>
      planResume(movieItem, resumeHistory([]), okResolution(IT.s1e2)),
    );
    expect(error.details.some((detail) => detail.includes("different item"))).toBe(true);
  });
});

describe("classifyResumeAffordance — the band classification", () => {
  it("completed → next; band membership; unknown ratio uses position evidence", () => {
    expect(classifyResumeAffordance(state(IT.movie, { positionMs: 1, ratio: 1, at: T_MOVIE, status: "completed" }))).toBe("next");
    expect(classifyResumeAffordance(state(IT.movie, { positionMs: 1_440_000, ratio: 0.2, at: T_MOVIE }))).toBe("resume");
    expect(classifyResumeAffordance(state(IT.movie, { positionMs: 2_280_000, ratio: RESUME_MAX_RATIO, at: T_MOVIE }))).toBe("next");
    expect(classifyResumeAffordance(state(IT.movie, { positionMs: 288_000, ratio: 0.04, at: T_MOVIE }))).toBe("restart");
    expect(classifyResumeAffordance(state(IT.movie, { positionMs: 500_000, ratio: null, at: T_MOVIE }))).toBe("resume");
    expect(classifyResumeAffordance(state(IT.movie, { positionMs: 0, ratio: null, at: T_MOVIE }))).toBe("restart");
  });
});

// ---------------------------------------------------------------------------
// Explainability + accessibility (the packet's cross-cutting laws)
// ---------------------------------------------------------------------------

describe("WatchFeedView — explainability and accessibility laws", () => {
  const presenter = createWatchFeedPresenter(GOLDEN_DEPS);
  const view = presenter.build(GOLDEN_PAGE, GOLDEN_CONTEXT);

  it("EVERY row carries a non-empty reason (explainability)", () => {
    expect(view.rows.length).toBeGreaterThan(0);
    for (const row of view.rows) {
      expect(typeof row.reason).toBe("string");
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  it("EVERY entry of every row carries a complete A11yLabel (title, position, action)", () => {
    for (const row of view.rows) {
      const entries: readonly { a11y: A11yLabel }[] =
        row.kind === "continue"
          ? row.entries
          : row.kind === "episodic"
            ? row.entries
            : row.entries;
      for (const entry of entries) {
        expect(entry.a11y.title.length).toBeGreaterThan(0);
        expect(entry.a11y.position.length).toBeGreaterThan(0);
        expect(entry.a11y.action.length).toBeGreaterThan(0);
      }
    }
  });

  it("the hero carries a complete A11yLabel and a non-empty reason", () => {
    const hero = view.hero!;
    expect(hero.a11y.title.length).toBeGreaterThan(0);
    expect(hero.a11y.position.length).toBeGreaterThan(0);
    expect(hero.a11y.action.length).toBeGreaterThan(0);
    expect(hero.reason.length).toBeGreaterThan(0);
  });

  it("episodic entries announce their season/episode position and binge-chain depth", () => {
    const row = view.rows.find((entry) => entry.kind === "episodic");
    if (row?.kind !== "episodic") throw new Error("expected episodic row");
    expect(row.entries[0]?.a11y.position).toContain("Season 1 episode 2");
    expect(row.entries[1]?.a11y.position).toContain("1 ahead in the binge chain");
  });
});

// ---------------------------------------------------------------------------
// The React wiring (documented; framework-neutral element tree)
// ---------------------------------------------------------------------------

describe("watchFeedElementTree — the documented React wiring seam", () => {
  const presenter = createWatchFeedPresenter(GOLDEN_DEPS);

  it("placeholder views map to typed placeholder elements", () => {
    const loading = watchFeedElementTree(presenter.build({ kind: "loading" }, GOLDEN_CONTEXT));
    expect(loading).toEqual([{ type: "placeholder", key: "watch-feed-loading", state: "loading" }]);
    const failed = watchFeedElementTree(
      presenter.build({ kind: "failed", detail: "boom" }, GOLDEN_CONTEXT),
    );
    expect(failed).toEqual([
      { type: "placeholder", key: "watch-feed-error", state: "error", detail: "boom" },
    ]);
  });

  it("a ready view maps to hero + row headers + cards with unique keys and verbatim a11y", () => {
    const view = presenter.build(GOLDEN_PAGE, GOLDEN_CONTEXT);
    const tree = watchFeedElementTree(view);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0]?.type).toBe("hero");

    const keys = new Set<string>();
    const walk = (elements: readonly unknown[]): void => {
      for (const element of elements) {
        if (!element || typeof element !== "object") continue;
        const node = element as { type?: string; key?: string; children?: unknown[]; a11y?: A11yLabel };
        if (node.type === "hero" || node.type === "card") {
          expect(node.a11y).toBeDefined();
          expect(node.a11y!.title.length).toBeGreaterThan(0);
          expect(node.a11y!.position.length).toBeGreaterThan(0);
          expect(node.a11y!.action.length).toBeGreaterThan(0);
        }
        if (node.key !== undefined) {
          expect(keys.has(node.key)).toBe(false);
          keys.add(node.key);
        }
        if (node.children !== undefined) walk(node.children);
      }
    };
    walk(tree);

    const rowHeaders = tree.filter((element) => element.type === "row-header");
    expect(rowHeaders.map((element) => (element as { title: string }).title)).toEqual([
      "Continue watching",
      "Harbor Lights",
      "space",
      "history",
    ]);
  });
});
