import { describe, expect, it } from "bun:test";

import type {
  EntertainmentEvent,
  EntertainmentItem,
  PlaybackRealization,
  PlaybackSession,
} from "@wfx/domain";

import {
  ExperienceError,
  FIXTURE_OCCURRED_AT,
  FIXTURE_CONNECTOR_ID,
  FIXTURE_CLOCK_START_MS,
  getLibrary,
  makeFixturePorts,
  removeFromLibrary,
  saveToLibrary,
  type ConnectorPort,
  type ExperienceContext,
  type Ports,
} from "../src/index";

const CTX: ExperienceContext = { userId: "user-1", sessionId: "sess-1", locale: "en", region: "EU" };

/** A port that declares libraryRead but does NOT expose readLibrary(). */
function portWithoutReadMethod(): Ports {
  const base = makeFixturePorts();
  const connector: ConnectorPort = {
    descriptor: () => base.connector.descriptor(), // declares libraryRead
    search: () => Promise.resolve([]),
    metadata: () => Promise.resolve(null),
    resolve: () => Promise.resolve([]),
    executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
    // readLibrary deliberately omitted
  };
  return { connector, events: base.events, clock: base.clock, ids: base.ids };
}

/** A port that declares libraryWrite but does NOT expose writeLibrary(). */
function portWithoutWriteMethod(): Ports {
  const base = makeFixturePorts();
  const connector: ConnectorPort = {
    descriptor: () => base.connector.descriptor(), // declares libraryWrite
    search: () => Promise.resolve([]),
    metadata: () => Promise.resolve(null),
    resolve: () => Promise.resolve([]),
    executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
    // writeLibrary deliberately omitted
  };
  return { connector, events: base.events, clock: base.clock, ids: base.ids };
}

describe("getLibrary (WFX-005)", () => {
  it("reads the seeded connector-side library through the port", async () => {
    const ports = makeFixturePorts();
    const result = await getLibrary(ports, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((entry) => entry.externalRef)).toEqual(["fake:movie-1", "fake:short-1"]);
    expect(result.value[0]?.connectorId).toBe(FIXTURE_CONNECTOR_ID);
    expect(result.value[0]?.addedAt).toBe(FIXTURE_OCCURRED_AT);
  });

  it("answers typed unsupported when the connector does not declare libraryRead", async () => {
    const ports = makeFixturePorts({
      capabilities: ["catalogSearch", "metadata", "playEmbed", "libraryWrite", "like"],
    });
    const result = await getLibrary(ports, CTX);
    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryRead",
      detail: expect.stringContaining("does not declare 'libraryRead'"),
    });
  });

  it("answers typed unsupported when the capability is declared but the method is missing", async () => {
    const result = await getLibrary(portWithoutReadMethod(), CTX);
    expect(result).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryRead",
      detail: expect.stringContaining("does not expose readLibrary()"),
    });
  });

  it("answers typed port-failed when readLibrary rejects", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        readLibrary: () => Promise.reject(new Error("library exploded")),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await getLibrary(ports, CTX);
    expect(result).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "readLibrary",
      detail: expect.stringContaining("library exploded"),
    });
  });

  it("drops malformed entries instead of fabricating or crashing", async () => {
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        readLibrary: () =>
          Promise.resolve([
            { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:good-1", title: "Good" },
            { connectorId: "", externalRef: "fake:bad-1", title: "Bad" }, // malformed
            "not-an-entry" as unknown as never,
          ]),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await getLibrary(ports, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.externalRef).toBe("fake:good-1");
  });
});

describe("saveToLibrary / removeFromLibrary (WFX-005)", () => {
  it("saves through writeLibrary with an op:add LibraryCommand", async () => {
    const ports = makeFixturePorts();
    const receipt = await saveToLibrary(ports, CTX, {
      externalRef: "fake:video-1",
      title: "Deep Field Diary",
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.value.status).toBe("confirmed");

    const library = await getLibrary(ports, CTX);
    expect(library.ok && library.value.map((entry) => entry.externalRef)).toContain("fake:video-1");
    const saved = ports.connector.libraryEntries().find((entry) => entry.externalRef === "fake:video-1");
    expect(saved?.title).toBe("Deep Field Diary");
    expect(saved?.addedAt).toBe(FIXTURE_OCCURRED_AT);
  });

  it("carries optional title and metadata through the command", async () => {
    const ports = makeFixturePorts();
    await saveToLibrary(ports, CTX, {
      externalRef: "fake:video-3",
      title: "Desert Rain Doc",
      metadata: { addedFrom: "feed-card" },
    });
    const saved = ports.connector.libraryEntries().find((entry) => entry.externalRef === "fake:video-3");
    expect(saved?.metadata).toEqual({ addedFrom: "feed-card" });
  });

  it("removes through writeLibrary with an op:remove LibraryCommand", async () => {
    const ports = makeFixturePorts();
    const receipt = await removeFromLibrary(ports, CTX, { externalRef: "fake:short-1" });
    expect(receipt.ok && receipt.value.status).toBe("confirmed");
    const library = await getLibrary(ports, CTX);
    expect(library.ok && library.value.map((entry) => entry.externalRef)).toEqual(["fake:movie-1"]);
  });

  it("answers typed unsupported without libraryWrite (capability or method)", async () => {
    const noCap = makeFixturePorts({ capabilities: ["catalogSearch", "metadata", "libraryRead"] });
    const byCap = await saveToLibrary(noCap, CTX, { externalRef: "fake:movie-1" });
    expect(byCap).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryWrite",
      detail: expect.stringContaining("does not declare 'libraryWrite'"),
    });
    const byMethod = await removeFromLibrary(portWithoutWriteMethod(), CTX, { externalRef: "fake:movie-1" });
    expect(byMethod).toEqual({
      ok: false,
      reason: "unsupported",
      capability: "libraryWrite",
      detail: expect.stringContaining("does not expose writeLibrary()"),
    });
  });

  it("answers typed port-failed when writeLibrary rejects or returns garbage", async () => {
    const base = makeFixturePorts();
    const rejecting: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        writeLibrary: () => Promise.reject(new Error("write exploded")),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const rejected = await saveToLibrary(rejecting, CTX, { externalRef: "fake:movie-1" });
    expect(rejected).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "writeLibrary",
      detail: expect.stringContaining("write exploded"),
    });

    const garbage: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        writeLibrary: () => Promise.resolve("ok?" as unknown as never),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const malformed = await removeFromLibrary(garbage, CTX, { externalRef: "fake:movie-1" });
    expect(malformed).toEqual({
      ok: false,
      reason: "port-failed",
      operation: "writeLibrary",
      detail: expect.stringContaining("expected an ActionReceipt"),
    });
  });

  it("throws the typed ExperienceError for malformed inputs", async () => {
    const ports = makeFixturePorts();
    await expect(saveToLibrary(ports, CTX, { externalRef: "  " })).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      saveToLibrary(ports, CTX, { externalRef: "fake:movie-1", title: 7 as unknown as string }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(
      saveToLibrary(ports, CTX, { externalRef: "fake:movie-1", metadata: "nope" as unknown as Record<string, unknown> }),
    ).rejects.toBeInstanceOf(ExperienceError);
    await expect(removeFromLibrary(ports, CTX, { externalRef: "" })).rejects.toBeInstanceOf(ExperienceError);
  });

  it("returns the source's own receipt when the connector declines at runtime", async () => {
    // The fixture declares libraryWrite; a port whose writeLibrary answers a
    // "local-only" receipt is still ok:true — the receipt is the source's answer.
    const base = makeFixturePorts();
    const ports: Ports = {
      connector: {
        descriptor: () => base.connector.descriptor(),
        search: () => Promise.resolve([]),
        metadata: () => Promise.resolve(null),
        resolve: () => Promise.resolve([]),
        executeAction: () => Promise.resolve({ status: "failed", occurredAt: FIXTURE_OCCURRED_AT }),
        writeLibrary: () =>
          Promise.resolve({ status: "local-only", detail: "queued locally", occurredAt: FIXTURE_OCCURRED_AT }),
      },
      events: base.events,
      clock: base.clock,
      ids: base.ids,
    };
    const result = await saveToLibrary(ports, CTX, { externalRef: "fake:movie-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("local-only");
    expect(result.value.detail).toBe("queued locally");
  });
});

// ===========================================================================
// WFX-029 — library/history client (appended; the WFX-005 suites above are
// untouched). Deterministic fixtures only: fixed ISO timestamps, canonical
// item ids, no randomness, no wall clock.
// ===========================================================================

import {
  DEFAULT_LIST_NAME,
  LIBRARY_OUTBOX_STATUSES,
  LIBRARY_SECTION_ORDER,
  createLibraryPresenter,
  deriveWatchHistory,
  mergeLibraryViews,
  planLibraryCommand,
  type ConnectorLibraryEntry,
  type DownloadCompletionInput,
  type LibraryCommandPlan,
  type LibraryIntent,
  type LibraryPresenterDeps,
  type LibrarySection,
  type MoveToListLibraryIntent,
  type RemoveLibraryIntent,
  type SaveLibraryIntent,
  type WatchHistoryInput,
  type WatchState,
} from "../src/index";

// --- deterministic fixtures -------------------------------------------------

const WFX029_USER = "user-1";
const WFX029_SESSION = "sess-1";

const ITEM_MOVIE: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000001",
  canonicalTitle: "Asteroid Drift",
  canonicalType: "movie",
  durationMs: 7_200_000, // 120 minutes
  orientation: "horizontal",
};
const ITEM_SHORT: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000002",
  canonicalTitle: "Neon Rain",
  canonicalType: "short",
  durationMs: 45_000,
  orientation: "vertical",
};
const ITEM_DOC: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000003",
  canonicalTitle: "Desert Rain Doc",
  canonicalType: "video",
  durationMs: 2_400_000,
  orientation: "horizontal",
};

/** ISO timestamp at BASE + minutes (deterministic). */
function at(minutes: number): string {
  return new Date(FIXTURE_CLOCK_START_MS + minutes * 60_000).toISOString();
}

function ev(
  type: EntertainmentEvent["type"],
  itemId: string,
  occurredAt: string,
  payload?: Record<string, unknown>,
): EntertainmentEvent {
  const event: EntertainmentEvent = {
    userId: WFX029_USER,
    itemId,
    type,
    occurredAt,
    sessionId: WFX029_SESSION,
  };
  if (payload !== undefined) event.payload = payload;
  return event;
}

function sess(
  id: string,
  itemId: string,
  resumePositionMs: number,
  createdAt: string,
): PlaybackSession {
  return {
    id,
    userId: WFX029_USER,
    itemId,
    realization: {
      mode: "native",
      connectorId: FIXTURE_CONNECTOR_ID,
      capabilities: ["playNative"],
    },
    resumePositionMs,
    createdAt,
  };
}

const BADGES: readonly PlaybackRealization[] = [
  {
    mode: "embed",
    connectorId: FIXTURE_CONNECTOR_ID,
    externalRef: "fake:movie-1",
    capabilities: ["playEmbed"],
  },
];

function savedEntry(
  item: EntertainmentItem,
  externalRef: string,
  overrides?: Partial<ConnectorLibraryEntry>,
): ConnectorLibraryEntry {
  const base: ConnectorLibraryEntry = {
    connectorId: FIXTURE_CONNECTOR_ID,
    displayName: "Fake Source",
    entry: {
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef,
      title: item.canonicalTitle ?? externalRef,
      addedAt: at(0),
    },
    item,
    sync: { kind: "synced", lastSyncedAt: at(0) },
  };
  return { ...base, ...overrides };
}

function watchInput(state: WatchState, item: EntertainmentItem): WatchHistoryInput {
  return {
    state,
    item,
    realizations: BADGES,
    displayNames: { [FIXTURE_CONNECTOR_ID]: "Fake Source" },
  };
}

function completionInput(
  id: string,
  item: EntertainmentItem,
  completedMinutes: number,
): DownloadCompletionInput {
  return {
    completion: {
      id,
      itemId: item.id,
      connectorId: FIXTURE_CONNECTOR_ID,
      completedAt: at(completedMinutes),
      fileSizeBytes: 1_048_576,
      localPath: `/downloads/${id}.mkv`,
    },
    item,
    displayName: "Fake Source",
  };
}

// --- history derivation ------------------------------------------------------

describe("deriveWatchHistory (WFX-029)", () => {
  it("golden fold: start → progress → complete", () => {
    const events = [
      ev("start", ITEM_MOVIE.id, at(0), { playbackSessionId: "s1" }),
      ev("progress", ITEM_MOVIE.id, at(10), { playbackSessionId: "s1", positionMs: 1_800_000 }),
      ev("complete", ITEM_MOVIE.id, at(120)),
    ];
    const sessions = [sess("s1", ITEM_MOVIE.id, 1_800_000, at(0))];
    const history = deriveWatchHistory(events, sessions, [ITEM_MOVIE]);
    expect(history).toEqual([
      {
        itemId: ITEM_MOVIE.id,
        lastPositionMs: 1_800_000,
        completionRatio: 1,
        lastWatchedAt: at(120),
        status: "completed",
      },
    ]);
  });

  it("golden fold: start → progress stays in progress with the ratio", () => {
    const events = [
      ev("start", ITEM_MOVIE.id, at(0), { playbackSessionId: "s1" }),
      ev("progress", ITEM_MOVIE.id, at(30), { playbackSessionId: "s1", positionMs: 1_800_000 }),
    ];
    const history = deriveWatchHistory(events, [], [ITEM_MOVIE]);
    expect(history).toEqual([
      {
        itemId: ITEM_MOVIE.id,
        lastPositionMs: 1_800_000,
        completionRatio: 0.25,
        lastWatchedAt: at(30),
        status: "in-progress",
      },
    ]);
  });

  it("golden fold: skip marks skipped-but-resumable and keeps the position", () => {
    const events = [
      ev("start", ITEM_SHORT.id, at(0), { playbackSessionId: "s1" }),
      ev("progress", ITEM_SHORT.id, at(1), { playbackSessionId: "s1", positionMs: 15_000 }),
      ev("skip", ITEM_SHORT.id, at(2)),
    ];
    const history = deriveWatchHistory(events, [], [ITEM_SHORT]);
    expect(history[0]?.status).toBe("skipped");
    expect(history[0]?.lastPositionMs).toBe(15_000);
    expect(history[0]?.completionRatio).toBe(1 / 3);
    expect(history[0]?.lastWatchedAt).toBe(at(2));
  });

  it("tolerates out-of-order input by occurredAt ordering", () => {
    const ordered = [
      ev("start", ITEM_MOVIE.id, at(0)),
      ev("progress", ITEM_MOVIE.id, at(30), { positionMs: 1_800_000 }),
      ev("complete", ITEM_MOVIE.id, at(120)),
    ];
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    expect(deriveWatchHistory(shuffled, [], [ITEM_MOVIE])).toEqual(
      deriveWatchHistory(ordered, [], [ITEM_MOVIE]),
    );
  });

  it("breaks occurredAt ties by sequence input index (documented determinism)", () => {
    const tie = at(10);
    const first = [
      ev("progress", ITEM_MOVIE.id, tie, { positionMs: 100 }),
      ev("progress", ITEM_MOVIE.id, tie, { positionMs: 200 }),
    ];
    const reversed = [first[1]!, first[0]!];
    expect(deriveWatchHistory(first, [])[0]?.lastPositionMs).toBe(200);
    expect(deriveWatchHistory(reversed, [])[0]?.lastPositionMs).toBe(100);
  });

  it("multi-session resume: a later session carries the position forward", () => {
    const events = [
      ev("start", ITEM_MOVIE.id, at(0), { playbackSessionId: "s1" }),
      ev("progress", ITEM_MOVIE.id, at(40), { playbackSessionId: "s1", positionMs: 2_880_000 }),
      ev("start", ITEM_MOVIE.id, at(60), { playbackSessionId: "s2" }),
      ev("progress", ITEM_MOVIE.id, at(70), { playbackSessionId: "s2", positionMs: 4_320_000 }),
    ];
    const sessions = [
      sess("s1", ITEM_MOVIE.id, 2_880_000, at(0)),
      sess("s2", ITEM_MOVIE.id, 4_320_000, at(60)),
    ];
    const history = deriveWatchHistory(events, sessions, [ITEM_MOVIE]);
    expect(history[0]?.lastPositionMs).toBe(4_320_000);
    expect(history[0]?.status).toBe("in-progress");
    expect(history[0]?.lastWatchedAt).toBe(at(70));
  });

  it("multi-session resume: a newer session without events supersedes the folded position", () => {
    const events = [
      ev("start", ITEM_MOVIE.id, at(0), { playbackSessionId: "s1" }),
      ev("progress", ITEM_MOVIE.id, at(40), { playbackSessionId: "s1", positionMs: 2_880_000 }),
    ];
    // s2 started AFTER the last event; its resume position is the newest truth.
    const sessions = [
      sess("s1", ITEM_MOVIE.id, 2_880_000, at(0)),
      sess("s2", ITEM_MOVIE.id, 4_320_000, at(60)),
    ];
    const history = deriveWatchHistory(events, sessions, [ITEM_MOVIE]);
    expect(history[0]?.lastPositionMs).toBe(4_320_000);
    expect(history[0]?.lastWatchedAt).toBe(at(60));
    expect(history[0]?.status).toBe("in-progress");
  });

  it("seeds an item with sessions but no watch events as in progress", () => {
    const history = deriveWatchHistory([], [sess("s1", ITEM_DOC.id, 600_000, at(5))], [ITEM_DOC]);
    expect(history).toEqual([
      {
        itemId: ITEM_DOC.id,
        lastPositionMs: 600_000,
        completionRatio: 0.25,
        lastWatchedAt: at(5),
        status: "in-progress",
      },
    ]);
  });

  it("answers completionRatio null when duration is unknown and clamps at 1 when position exceeds duration", () => {
    const unknown = deriveWatchHistory(
      [ev("progress", ITEM_MOVIE.id, at(10), { positionMs: 1_000 })],
      [],
    );
    expect(unknown[0]?.completionRatio).toBeNull();

    const over = deriveWatchHistory(
      [ev("progress", ITEM_SHORT.id, at(1), { positionMs: 60_000 })],
      [],
      [ITEM_SHORT],
    );
    expect(over[0]?.completionRatio).toBe(1);
    expect(over[0]?.status).toBe("in-progress");
  });

  it("ignores non-watch-state events and orders output most-recent first", () => {
    const events = [
      ev("impression", ITEM_SHORT.id, at(200)),
      ev("like", ITEM_SHORT.id, at(201)),
      ev("save", ITEM_MOVIE.id, at(202)),
      ev("start", ITEM_SHORT.id, at(1)),
      ev("start", ITEM_MOVIE.id, at(100)),
      ev("search", ITEM_DOC.id, at(203)),
    ];
    const history = deriveWatchHistory(events, []);
    expect(history.map((state) => state.itemId)).toEqual([ITEM_MOVIE.id, ITEM_SHORT.id]);
  });

  it("throws the typed ExperienceError for malformed events and sessions", () => {
    const badEvent = { userId: "user-1", itemId: "not-canonical", type: "start" };
    expect(() => deriveWatchHistory([badEvent as unknown as EntertainmentEvent], [])).toThrow(
      ExperienceError,
    );
    const badSession = { id: "", userId: "u", itemId: "i", resumePositionMs: -1, createdAt: "nope" };
    expect(() =>
      deriveWatchHistory([], [badSession as unknown as PlaybackSession]),
    ).toThrow(ExperienceError);
  });
});

// --- merge -------------------------------------------------------------------

describe("mergeLibraryViews (WFX-029)", () => {
  const watchInProgress: WatchState = {
    itemId: ITEM_MOVIE.id,
    lastPositionMs: 1_800_000,
    completionRatio: 0.25,
    lastWatchedAt: at(30),
    status: "in-progress",
  };

  it("merges the same canonical item from multiple sources into ONE union row", () => {
    const merged = mergeLibraryViews(
      [savedEntry(ITEM_MOVIE, "fake:movie-1", { entry: { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:movie-1", title: "Asteroid Drift", addedAt: at(0), metadata: { list: "Sci-Fi" } } })],
      [watchInput(watchInProgress, ITEM_MOVIE)],
      [completionInput("dl-1", ITEM_MOVIE, 45)],
    );
    expect(merged.rows).toHaveLength(1);
    const row = merged.rows[0]!;
    expect(row.itemId).toBe(ITEM_MOVIE.id);
    expect(row.title).toBe("Asteroid Drift");
    expect(row.saved?.sources).toHaveLength(1);
    expect(row.watch?.status).toBe("in-progress");
    expect(row.downloads).toHaveLength(1);
    // Source icons + realization badges union across the three sources.
    expect(row.sources).toEqual([{ connectorId: FIXTURE_CONNECTOR_ID, displayName: "Fake Source" }]);
    expect(row.realizations.map((badge) => badge.mode)).toEqual(["embed", "native"]);
    // last-touched = max(addedAt, lastWatchedAt, completedAt) = the download.
    expect(row.lastTouchedAt).toBe(at(45));
  });

  it("derives realization-badge modes from SourceRealization capabilities by the frozen precedence", () => {
    const merged = mergeLibraryViews(
      [
        savedEntry(ITEM_DOC, "fake:video-3", {
          realizations: [
            {
              id: "wfxsrc_00000000000000000000000009",
              entertainmentItemId: ITEM_DOC.id,
              connectorId: FIXTURE_CONNECTOR_ID,
              externalRef: "fake:video-3",
              capabilities: ["playBrowser", "playExternal"],
              availability: "available",
            },
          ],
        }),
      ],
      [],
      [],
    );
    const badges = merged.rows[0]?.realizations ?? [];
    expect(badges).toHaveLength(1); // browser beats external by precedence
    expect(badges[0]?.mode).toBe("browser");
    expect(badges[0]?.label).toBe("Fake Source (browser)");
  });

  it("surfaces a typed ConflictRow (with suggestions) when remote says removed and local watch state exists", () => {
    const removedEntry = savedEntry(ITEM_MOVIE, "fake:movie-1", {
      sync: { kind: "removed-remotely", observedAt: at(50) },
    });
    const merged = mergeLibraryViews([removedEntry], [watchInput(watchInProgress, ITEM_MOVIE)], []);
    // Never silently dropped: the row survives AND a conflict row is typed.
    expect(merged.rows).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
    const conflict = merged.conflicts[0]!;
    expect(conflict.kind).toBe("conflict");
    expect(conflict.rowId).toBe(`conflict:${ITEM_MOVIE.id}`);
    expect(conflict.observedAt).toBe(at(50));
    expect(conflict.detail).toContain("Removed at Fake Source");
    expect(conflict.suggestions.map((s) => s.action)).toEqual([
      "keep-local",
      "re-save",
      "dismiss",
    ]);
    expect(conflict.a11y.label).toContain("Library conflict");
  });

  it("omits a stale removed-remotely entry with NO local watch state (no conflict, no row)", () => {
    const removedEntry = savedEntry(ITEM_SHORT, "fake:short-1", {
      sync: { kind: "removed-remotely", observedAt: at(50) },
    });
    const merged = mergeLibraryViews([removedEntry], [], []);
    expect(merged.rows).toHaveLength(0);
    expect(merged.conflicts).toHaveLength(0);
  });

  it("resolves the title from the canonical item, falling back to the entry title, then the id", () => {
    const titled: EntertainmentItem = { id: ITEM_DOC.id, canonicalType: "video" };
    const withEntryTitle = mergeLibraryViews(
      [savedEntry(titled, "fake:video-3", { entry: { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:video-3", title: "Connector Title", addedAt: at(0) } })],
      [],
      [],
    );
    expect(withEntryTitle.rows[0]?.title).toBe("Connector Title");

    // No entry titles at all (a watch-only row) and no canonical title:
    // the honest title is the canonical id — never fabricated.
    const watchOnlyState: WatchState = {
      itemId: titled.id,
      lastPositionMs: 600_000,
      completionRatio: 0.25,
      lastWatchedAt: at(5),
      status: "in-progress",
    };
    const idFallback = mergeLibraryViews([], [watchInput(watchOnlyState, titled)], []);
    expect(idFallback.rows[0]?.title).toBe(ITEM_DOC.id);
  });

  it("throws the typed ExperienceError for identity incoherence", () => {
    const mismatched = savedEntry(ITEM_MOVIE, "fake:movie-1", {
      entry: { connectorId: "other-source", externalRef: "fake:movie-1", title: "X" },
    });
    expect(() => mergeLibraryViews([mismatched], [], [])).toThrow(ExperienceError);

    const duplicateCompletions = [completionInput("dl-1", ITEM_SHORT, 1), completionInput("dl-1", ITEM_SHORT, 2)];
    expect(() => mergeLibraryViews([], [], duplicateCompletions)).toThrow(ExperienceError);
  });
});

// --- presenter ---------------------------------------------------------------

describe("createLibraryPresenter (WFX-029)", () => {
  const watchInProgress: WatchState = {
    itemId: ITEM_MOVIE.id,
    lastPositionMs: 1_800_000,
    completionRatio: 0.25,
    lastWatchedAt: at(30),
    status: "in-progress",
  };
  const watchSkipped: WatchState = {
    itemId: ITEM_SHORT.id,
    lastPositionMs: 15_000,
    completionRatio: 1 / 3,
    lastWatchedAt: at(10),
    status: "skipped",
  };
  const watchCompleted: WatchState = {
    itemId: ITEM_DOC.id,
    lastPositionMs: 2_400_000,
    completionRatio: 1,
    lastWatchedAt: at(80),
    status: "completed",
  };

  function loadedDeps(
    entries: readonly ConnectorLibraryEntry[],
    history: readonly WatchHistoryInput[],
    completions: readonly DownloadCompletionInput[],
  ): LibraryPresenterDeps {
    return {
      connectorEntries: { kind: "loaded", data: entries },
      watchHistory: { kind: "loaded", data: history },
      completions: { kind: "loaded", data: completions },
    };
  }

  it("orders sections Continue → Saved → Downloads → Finished", () => {
    const presentation = createLibraryPresenter(
      loadedDeps(
        [savedEntry(ITEM_MOVIE, "fake:movie-1", { entry: { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:movie-1", title: "Asteroid Drift", addedAt: at(0), metadata: { list: "Sci-Fi" } } })],
        [
          watchInput(watchInProgress, ITEM_MOVIE),
          watchInput(watchCompleted, ITEM_DOC),
          watchInput(watchSkipped, ITEM_SHORT),
        ],
        [completionInput("dl-1", ITEM_SHORT, 45)],
      ),
    ).present();
    expect(presentation.state).toBe("ready");
    expect(presentation.view?.sections.map((section) => section.kind)).toEqual([
      ...LIBRARY_SECTION_ORDER,
    ]);
  });

  it("suppresses empty sections and answers the typed empty state when everything is loaded and bare", () => {
    const presentation = createLibraryPresenter(loadedDeps([], [], [])).present();
    expect(presentation.state).toBe("empty");
    expect(presentation.view?.sections).toEqual([]);
    expect(presentation.view?.conflicts).toEqual([]);

    // Loaded but only a continue candidate: every other section suppresses.
    const one = createLibraryPresenter(
      loadedDeps([], [watchInput(watchInProgress, ITEM_MOVIE)], []),
    ).present();
    expect(one.view?.sections.map((section) => section.kind)).toEqual(["continue"]);
  });

  it("types the loading placeholder: no data, nothing failed", () => {
    const presentation = createLibraryPresenter({
      connectorEntries: { kind: "loading" },
      watchHistory: { kind: "loading" },
      completions: { kind: "loading" },
    }).present();
    expect(presentation.state).toBe("loading");
    expect(presentation.view).toBeUndefined();
  });

  it("types the error placeholder: every source failed, with the failure list", () => {
    const presentation = createLibraryPresenter({
      connectorEntries: { kind: "failed", detail: "library read failed" },
      watchHistory: { kind: "failed", detail: "event store down" },
      completions: { kind: "failed", detail: "download registry down" },
    }).present();
    expect(presentation.state).toBe("error");
    expect(presentation.view).toBeUndefined();
    expect(presentation.failures).toEqual([
      { source: "connector-entries", detail: "library read failed" },
      { source: "watch-history", detail: "event store down" },
      { source: "completions", detail: "download registry down" },
    ]);
  });

  it("types the partial state: loaded sources render while a failed source carries its section error", () => {
    const presentation = createLibraryPresenter({
      connectorEntries: { kind: "failed", detail: "library read failed" },
      watchHistory: { kind: "loaded", data: [watchInput(watchInProgress, ITEM_MOVIE)] },
      completions: { kind: "loaded", data: [] },
    }).present();
    expect(presentation.state).toBe("partial");
    const sections = presentation.view?.sections ?? [];
    expect(sections.map((section) => section.kind)).toEqual(["continue", "saved"]);
    const saved = sections.find((section) => section.kind === "saved");
    expect(saved?.status).toEqual({ state: "error", errorDetail: "library read failed" });
    expect(saved?.kind === "saved" ? saved.groups : []).toEqual([]);
    expect(presentation.failures).toEqual([
      { source: "connector-entries", detail: "library read failed" },
    ]);
  });

  it("groups Saved rows by user lists (metadata.list / metadata.lists / default)", () => {
    const presentation = createLibraryPresenter(
      loadedDeps(
        [
          savedEntry(ITEM_MOVIE, "fake:movie-1", {
            entry: {
              connectorId: FIXTURE_CONNECTOR_ID,
              externalRef: "fake:movie-1",
              title: "Asteroid Drift",
              addedAt: at(0),
              metadata: { list: "Sci-Fi" },
            },
          }),
          savedEntry(ITEM_DOC, "fake:video-3", {
            entry: {
              connectorId: FIXTURE_CONNECTOR_ID,
              externalRef: "fake:video-3",
              title: "Desert Rain Doc",
              addedAt: at(1),
              metadata: { lists: ["Docs", "Watch again"] },
            },
          }),
          savedEntry(ITEM_SHORT, "fake:short-1", {
            entry: { connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:short-1", title: "Neon Rain", addedAt: at(2) },
          }),
        ],
        [],
        [],
      ),
    ).present();
    const saved = presentation.view?.sections.find((section) => section.kind === "saved");
    const groupNames =
      saved && saved.kind === "saved" ? saved.groups.map((group) => group.listName) : [];
    // Codepoint order: "Docs" < "Saved" < "Sci-Fi" < "Watch again".
    expect(groupNames).toEqual(["Docs", DEFAULT_LIST_NAME, "Sci-Fi", "Watch again"]);
    const defaultGroup = saved && saved.kind === "saved" ? saved.groups.find((g) => g.listName === DEFAULT_LIST_NAME) : undefined;
    expect(defaultGroup?.rows.map((row) => row.itemId)).toEqual([ITEM_SHORT.id]);
  });

  it("includes skipped-but-resumable watches as Continue rows and unions finished signals", () => {
    const presentation = createLibraryPresenter(
      loadedDeps(
        [],
        [watchInput(watchSkipped, ITEM_SHORT), watchInput(watchCompleted, ITEM_DOC)],
        [completionInput("dl-9", ITEM_DOC, 90)],
      ),
    ).present();
    const sections = presentation.view?.sections ?? [];
    expect(sections.map((s) => s.kind)).toEqual(["continue", "downloads", "finished"]);
    const continueSection = sections[0];
    if (continueSection?.kind === "continue") {
      expect(continueSection.rows[0]?.watchStatus).toBe("skipped");
      expect(continueSection.rows[0]?.a11y.progress).toBe("33% watched");
    } else {
      throw new Error("expected the first section to be the continue section");
    }
    const finished = sections.find((s) => s.kind === "finished");
    const finishedRow = finished && finished.kind === "finished" ? finished.rows[0] : undefined;
    expect(finishedRow?.finishedVia).toEqual(["watched", "downloaded"]);
    expect(finishedRow?.finishedAt).toBe(at(90));
  });

  it("carries non-empty a11y labels on EVERY row of EVERY section and on conflict rows", () => {
    const presentation = createLibraryPresenter(
      loadedDeps(
        [
          savedEntry(ITEM_MOVIE, "fake:movie-1", {
            sync: { kind: "removed-remotely", observedAt: at(50) },
            entry: {
              connectorId: FIXTURE_CONNECTOR_ID,
              externalRef: "fake:movie-1",
              title: "Asteroid Drift",
              addedAt: at(0),
              metadata: { list: "Sci-Fi" },
            },
          }),
        ],
        [watchInput(watchInProgress, ITEM_MOVIE), watchInput(watchCompleted, ITEM_DOC)],
        [completionInput("dl-1", ITEM_SHORT, 45)],
      ),
    ).present();
    expect((presentation.view?.conflicts ?? []).length).toBeGreaterThan(0);
    const sections: readonly LibrarySection[] = presentation.view?.sections ?? [];
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const rows =
        section.kind === "saved"
          ? section.groups.flatMap((group) => group.rows)
          : section.rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.a11y.label.length).toBeGreaterThan(0);
        expect(row.a11y.description.length).toBeGreaterThan(0);
      }
    }
    for (const conflict of presentation.view?.conflicts ?? []) {
      expect(conflict.a11y.label.length).toBeGreaterThan(0);
      expect(conflict.a11y.description.length).toBeGreaterThan(0);
    }
  });
});

// --- command planning --------------------------------------------------------

describe("planLibraryCommand (WFX-029)", () => {
  const saveIntent: SaveLibraryIntent = {
    kind: "save",
    userId: WFX029_USER,
    connectorId: FIXTURE_CONNECTOR_ID,
    externalRef: "fake:movie-1",
    title: "Asteroid Drift",
    listName: "Sci-Fi",
    locale: "en",
    clientRequestToken: "token-1",
  };
  const removeIntent: RemoveLibraryIntent = {
    kind: "remove",
    userId: WFX029_USER,
    connectorId: FIXTURE_CONNECTOR_ID,
    externalRef: "fake:movie-1",
    locale: "en",
    clientRequestToken: "token-2",
  };
  const moveIntent: MoveToListLibraryIntent = {
    kind: "move-to-list",
    userId: WFX029_USER,
    connectorId: FIXTURE_CONNECTOR_ID,
    externalRef: "fake:movie-1",
    fromList: "Sci-Fi",
    toList: "Docs",
    locale: "en",
    clientRequestToken: "token-3",
  };

  it("plans a save: WFX-005 use-case call, outbox preview, optimistic show-saved", () => {
    const plan = planLibraryCommand(saveIntent);
    expect(plan.useCase.useCase).toBe("saveToLibrary");
    expect(plan.useCase.input).toEqual({
      externalRef: "fake:movie-1",
      title: "Asteroid Drift",
      metadata: { list: "Sci-Fi" },
    });
    expect(plan.useCase.command).toEqual({
      op: "add",
      externalRef: "fake:movie-1",
      title: "Asteroid Drift",
      metadata: { list: "Sci-Fi" },
    });
    expect(plan.outbox.entry).toEqual({
      userId: WFX029_USER,
      connectorId: FIXTURE_CONNECTOR_ID,
      action: "save",
      externalRef: "fake:movie-1",
      clientRequestToken: "token-1",
      locale: "en",
      payload: { libraryCommand: plan.useCase.command },
    });
    expect(plan.outbox.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
    expect(plan.outbox.recordId).toBe(`wfxout_${plan.outbox.idempotencyKey}`);
    expect(plan.optimistic).toEqual({
      kind: "show-saved",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:movie-1",
      listName: "Sci-Fi",
    });
  });

  it("plans a remove: removeFromLibrary, hide-saved optimism, restore rollback", () => {
    const plan = planLibraryCommand(removeIntent);
    expect(plan.useCase.useCase).toBe("removeFromLibrary");
    expect(plan.useCase.command).toEqual({ op: "remove", externalRef: "fake:movie-1" });
    expect(plan.outbox.entry.payload).toEqual({
      libraryCommand: { op: "remove", externalRef: "fake:movie-1" },
    });
    expect(plan.optimistic).toEqual({
      kind: "hide-saved",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:movie-1",
    });
    expect(plan.rollback.failed).toEqual({
      action: "revert",
      revert: { kind: "restore-saved", connectorId: FIXTURE_CONNECTOR_ID, externalRef: "fake:movie-1" },
      consequence: expect.stringContaining("restored"),
      suggestions: expect.any(Array),
    });
  });

  it("plans a move-to-list as ONE upsert add carrying the target list", () => {
    const plan = planLibraryCommand(moveIntent);
    expect(plan.useCase.useCase).toBe("saveToLibrary");
    expect(plan.useCase.command.op).toBe("add");
    expect(plan.useCase.command.metadata).toEqual({ list: "Docs" });
    expect(plan.optimistic).toEqual({
      kind: "move-list",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:movie-1",
      fromList: "Sci-Fi",
      toList: "Docs",
    });
    expect(plan.rollback.conflict.revert).toEqual({
      kind: "move-list",
      connectorId: FIXTURE_CONNECTOR_ID,
      externalRef: "fake:movie-1",
      fromList: "Docs",
      toList: "Sci-Fi",
    });
  });

  it("plans a rollback outcome for EVERY mirrored outbox status", () => {
    for (const intent of [saveIntent, removeIntent, moveIntent] as LibraryIntent[]) {
      const plan = planLibraryCommand(intent);
      for (const status of LIBRARY_OUTBOX_STATUSES) {
        const outcome = plan.rollback[status];
        expect(outcome).toBeDefined();
        expect(outcome.consequence.length).toBeGreaterThan(0);
        expect(["hold", "commit", "revert"]).toContain(outcome.action);
        if (outcome.action === "revert") expect(outcome.revert).toBeDefined();
      }
      // Non-terminal states hold; delivered commits; terminal bad states revert.
      expect(plan.rollback.pending.action).toBe("hold");
      expect(plan.rollback["in-flight"].action).toBe("hold");
      expect(plan.rollback.delivered.action).toBe("commit");
      expect(plan.rollback.failed.action).toBe("revert");
      expect(plan.rollback.unsupported.action).toBe("revert");
      expect(plan.rollback.conflict.action).toBe("revert");
    }
  });

  it("idempotency-key preview: stable for identical intents, distinct for distinct tokens", () => {
    const first = planLibraryCommand(saveIntent);
    const again = planLibraryCommand({ ...saveIntent });
    expect(again.outbox.idempotencyKey).toBe(first.outbox.idempotencyKey);
    expect(again.outbox.recordId).toBe(first.outbox.recordId);

    const differentToken = planLibraryCommand({ ...saveIntent, clientRequestToken: "token-9" });
    expect(differentToken.outbox.idempotencyKey).not.toBe(first.outbox.idempotencyKey);
  });

  it("documents the same-token save/remove key collision (typed content conflict, never silent)", () => {
    // The frozen UserAction union has no unsave verb: save and remove mirror
    // with verb "save"; with the SAME clientRequestToken the identity (and
    // therefore the key) collides — the real outbox answers a typed content
    // conflict. The plan surfaces the collision instead of hiding it.
    const save = planLibraryCommand(saveIntent);
    const remove = planLibraryCommand({ ...removeIntent, clientRequestToken: "token-1" });
    expect(remove.outbox.idempotencyKey).toBe(save.outbox.idempotencyKey);
  });

  it("performs NO mutation: the caller's intent (and its metadata) are untouched", () => {
    const intent: SaveLibraryIntent = {
      ...saveIntent,
      metadata: { note: "hand-written", list: "Sci-Fi" },
      listName: "Rewatch",
    };
    const snapshot = JSON.parse(JSON.stringify(intent)) as SaveLibraryIntent;
    const plan: LibraryCommandPlan = planLibraryCommand(intent);
    expect(intent).toEqual(snapshot);
    // The plan's metadata is a copy: the target list is written into it
    // without touching the caller's object.
    expect(plan.useCase.command.metadata).toEqual({ note: "hand-written", list: "Rewatch" });
    expect(intent.metadata?.list).toBe("Sci-Fi");
  });

  it("throws the typed ExperienceError for malformed intents", () => {
    expect(() => planLibraryCommand({ ...saveIntent, externalRef: "  " })).toThrow(ExperienceError);
    expect(() => planLibraryCommand({ ...saveIntent, clientRequestToken: "" })).toThrow(
      ExperienceError,
    );
    expect(() =>
      planLibraryCommand({ ...moveIntent, toList: " " } as MoveToListLibraryIntent),
    ).toThrow(ExperienceError);
    expect(() =>
      planLibraryCommand({ ...saveIntent, kind: "steal" } as unknown as LibraryIntent),
    ).toThrow(ExperienceError);
  });
});
