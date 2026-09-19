/**
 * R20-G — the Desktop BYOF feed surface (the shared-semantics projection).
 *
 * The Desktop envelope's binding of the frozen shared feed runtime,
 * proven against the shell simulator + the FeedPort double (REAL domain
 * semantics):
 *
 * - MODE TRUTH (the shared law, never forked): `webflix` answers EMPTY
 *   imported records with the order semantics `webflix-ranked` + the
 *   honest note (imported source-native records are never re-labeled);
 *   `byof`/`hybrid` answer the source-native order; `following` answers
 *   the follow-graph subset.
 * - SNAPSHOT-NEVER-LIVE: a one-time file import lands `snapshot`
 *   freshness; only a continuously-synced route lands `live`.
 * - PROVENANCE SURVIVAL: every projected record carries its full
 *   provenance (connector, method, capturedAt, sourceOrder, relationship,
 *   syncState) — the order is DATA, and a failing sync never erases it.
 * - CACHE TRUTH (the richer Desktop envelope): the cached view carries
 *   its own savedAt/capturedAt age labels and is never confused with
 *   the live port read; clearing evicts; a malformed cache is a miss.
 * - UNBOUND TRUTH: without the feed block, every operation answers the
 *   typed verdict — never a silent empty feed (the boot test proves
 *   both compositions through `createDesktopApp`).
 */

import { describe, expect, it } from "bun:test";

import { SimEngineProcess, SimShell } from "./shell-simulator";
import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { createFeedPortDouble, testExportArtifact } from "./feed-port-double";
import type { DesktopFeedCacheEntry } from "../src/platform/feed-cache";

const PROFILE = "wfxusr_r20g2_test:main";
const USER = "wfxusr_r20g2_test";
const BASE = new URL("https://experience.webflix.invalid/api");
const CONTEXT = { userId: "wfx-desktop-user", sessionId: "wfx-desktop-session", locale: "en" };

/** Boot the full desktop app with the feed block bound (the composition root). */
function bootWithFeed(double: ReturnType<typeof createFeedPortDouble>, shell: SimShell) {
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({
      apiBase: BASE,
      context: CONTEXT,
      fetchImpl: (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.reject(new TypeError("offline test boot: no scripted responses")),
    }),
    session: {
      context: CONTEXT,
      clock: { now: () => Date.UTC(2026, 8, 19, 14, 0, 0) },
      ids: { next: () => "000001" },
    },
    engine: {
      config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
      process: new SimEngineProcess(),
    },
    feed: { port: double.port },
  });
  return app;
}

/** Import both captures (the playlist + the follow graph). */
async function importFeed(app: ReturnType<typeof bootWithFeed>, shell: SimShell) {
  await importThroughSurface(app.feed, shell, PLAYLIST_EXPORT, { continuousSync: false, sourceRef: "PL_r20g2" });
  await importThroughSurface(app.feed, shell, FOLLOW_EXPORT, { continuousSync: false });
}

/** Import one file through a picked shell (the confirmed precondition). */
async function importThroughSurface(
  surface: ReturnType<typeof bootWithFeed>["feed"],
  shell: SimShell,
  artifact: Uint8Array,
  input: { continuousSync: boolean; sourceRef?: string },
) {
  shell.scriptFile("/home/user/exports/feed.json", artifact);
  shell.nextFilePickOutcome = { picked: true, path: "/home/user/exports/feed.json" };
  const preview = await surface.importFromFile({
    connectorId: "youtube",
    method: "user-file",
    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
  });
  expect(preview.outcome).toBe("preview");
  if (preview.outcome !== "preview") throw new Error("unreachable");
  const confirmed = await surface.confirmImport(preview.preview.importId);
  expect(confirmed.status).toBe("complete");
  return preview.preview.importId;
}

const PLAYLIST_EXPORT = testExportArtifact({
  continuousSync: false,
  sourceRef: "PL_r20g2",
  items: [
    { externalRef: "vidA", relationship: "playlist" as const, sourceOrder: 0, title: "Alpha" },
    { externalRef: "vidB", relationship: "playlist" as const, sourceOrder: 1, title: "Beta" },
  ],
});

/** The follow-graph capture (no container — the domain key law: follows address the subscription graph itself). */
const FOLLOW_EXPORT = testExportArtifact({
  continuousSync: false,
  items: [{ externalRef: "chan1", relationship: "follow" as const, sourceOrder: 0 }],
});

const CONTINUOUS_EXPORT = testExportArtifact({
  continuousSync: true,
  sourceRef: "PL_r20g2_live",
  items: [
    { externalRef: "vidA", relationship: "playlist" as const, sourceOrder: 0, title: "Alpha" },
  ],
});

describe("R20-G — the Desktop BYOF feed surface", () => {
  it("MODE TRUTH: webflix answers empty imported records with the honest note (never re-labeled)", async () => {
    const shell = new SimShell();
    let counter = 0;
    const double = createFeedPortDouble({
      profileId: PROFILE,
      userId: USER,
      now: () => "2026-09-19T14:00:00.000Z",
      nextId: () => String(++counter).padStart(6, "0"),
    });
    const app = bootWithFeed(double, shell);
    await importFeed(app, shell);

    const view = await app.feed.feedView({ profileId: PROFILE, mode: "webflix" });
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.view.records).toEqual([]); // the mode-truth law
      expect(view.view.orderSemantics).toBe("webflix-ranked");
      expect(view.view.note).toContain("never re-labeled");
      expect(view.view.freshness).toEqual([]);
    }
  });

  it("MODE TRUTH: byof/hybrid answer the SOURCE-NATIVE order; following answers the follow subset", async () => {
    const shell = new SimShell();
    let counter = 0;
    const double = createFeedPortDouble({
      profileId: PROFILE,
      userId: USER,
      now: () => "2026-09-19T14:00:00.000Z",
      nextId: () => String(++counter).padStart(6, "0"),
    });
    const app = bootWithFeed(double, shell);
    await importFeed(app, shell);

    for (const mode of ["byof", "hybrid"] as const) {
      const view = await app.feed.feedView({ profileId: PROFILE, mode });
      expect(view.ok).toBe(true);
      if (!view.ok) continue;
      expect(view.view.orderSemantics).toBe("source-native"); // the order is DATA, never a rank
      expect(view.view.records).toHaveLength(3);
      // The source-native order: the follow graph (no container — NULLS
      // FIRST) before the playlist, each in the source's own order.
      const relations = view.view.records.map((record) => record.provenance.relationship);
      expect(relations).toEqual(["follow", "playlist", "playlist"]);
      const orders = view.view.records.map((record) => record.provenance.sourceOrder);
      expect(orders).toEqual([0, 0, 1]);
    }

    const following = await app.feed.feedView({ profileId: PROFILE, mode: "following" });
    expect(following.ok).toBe(true);
    if (following.ok) {
      expect(following.view.records).toHaveLength(1); // the follow-graph subset
      expect(following.view.records[0]?.provenance.relationship).toBe("follow");
      expect(following.view.orderSemantics).toBe("source-native");
    }
  });

  it("SNAPSHOT-NEVER-LIVE: a one-time file import lands snapshot; a continuous route lands live only through the sync", async () => {
    const shell = new SimShell();
    let counter = 0;
    const double = createFeedPortDouble({
      profileId: PROFILE,
      userId: USER,
      now: () => "2026-09-19T14:00:00.000Z",
      nextId: () => String(++counter).padStart(6, "0"),
    });
    const app = bootWithFeed(double, shell);

    // One-time route: snapshot.
    await importThroughSurface(app.feed, shell, PLAYLIST_EXPORT, { continuousSync: false, sourceRef: "PL_r20g2" });
    const oneTime = await app.feed.feedView({ profileId: PROFILE, mode: "byof" });
    expect(oneTime.ok).toBe(true);
    if (oneTime.ok) {
      expect(oneTime.view.freshness).toEqual(["snapshot"]); // never presented as live
      for (const record of oneTime.view.records) {
        expect(record.provenance.syncState).toBe("snapshot");
      }
    }

    // Continuous route: live (the sync state machine's grant).
    await importThroughSurface(app.feed, shell, CONTINUOUS_EXPORT, { continuousSync: true, sourceRef: "PL_r20g2_live" });
    const continuous = await app.feed.feedView({ profileId: PROFILE, mode: "byof" });
    expect(continuous.ok).toBe(true);
    if (continuous.ok) {
      expect(continuous.view.freshness).toContain("live");
    }
  });

  it("PROVENANCE SURVIVAL: every projected record carries its full provenance; a failed sync never erases the view", async () => {
    const shell = new SimShell();
    let counter = 0;
    const double = createFeedPortDouble({
      profileId: PROFILE,
      userId: USER,
      now: () => "2026-09-19T14:00:00.000Z",
      nextId: () => String(++counter).padStart(6, "0"),
    });
    const app = bootWithFeed(double, shell);
    const importId = await importThroughSurface(app.feed, shell, PLAYLIST_EXPORT, {
      continuousSync: false,
      sourceRef: "PL_r20g2",
    });

    const before = await app.feed.feedView({ profileId: PROFILE, mode: "byof" });
    expect(before.ok).toBe(true);

    // A failing sync (the source disappearing class): the records SURVIVE.
    double.scriptNextSyncFailure("transport");
    const outcome = await app.feed.runSync({ importId });
    expect(outcome.outcome).toBe("failed");

    const after = await app.feed.feedView({ profileId: PROFILE, mode: "byof" });
    expect(after.ok).toBe(true);
    if (after.ok && before.ok) {
      expect(after.view.records.map((record) => record.id)).toEqual(
        before.view.records.map((record) => record.id),
      );
    }

    // The provenance is fully projected (identity, order, capture, method).
    const record = after.ok ? after.view.records[0] : undefined;
    expect(record).toBeDefined();
    if (record) {
      expect(record.provenance.connectorId).toBe("youtube");
      expect(record.provenance.importMethod).toBe("user-file");
      expect(record.provenance.capturedAt).toBe("2026-09-19T14:00:00.000Z");
      expect(record.provenance.relationship).toBe("playlist");
      expect(record.provenance.sourceOrder).toBe(0);
      expect(record.entertainmentItemId).toBe("wfxitm_double_vidA");
    }
  });

  it("CACHE TRUTH: the cached view carries its age labels, never poses as live, and evicts explicitly", async () => {
    const shell = new SimShell();
    let counter = 0;
    const clock = { ms: Date.UTC(2026, 8, 19, 14, 0, 0) };
    const double = createFeedPortDouble({
      profileId: PROFILE,
      userId: USER,
      now: () => new Date(clock.ms).toISOString(),
      nextId: () => String(++counter).padStart(6, "0"),
    });
    const app = createDesktopApp({
      shell,
      server: createDesktopServerPort({
        apiBase: BASE,
        context: CONTEXT,
        fetchImpl: () => Promise.reject(new TypeError("offline test boot")),
      }),
      session: {
        context: CONTEXT,
        clock: { now: () => clock.ms },
        ids: { next: () => String(++counter).padStart(6, "0") },
      },
      engine: {
        config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
        process: new SimEngineProcess(),
      },
      feed: { port: double.port },
    });
    await importThroughSurface(app.feed, shell, PLAYLIST_EXPORT, { continuousSync: false, sourceRef: "PL_r20g2" });

    // No cache before the first refresh.
    expect(await app.feed.cachedFeedView({ profileId: PROFILE, mode: "byof" })).toBeNull();

    // Refresh: the port read + the cache write.
    clock.ms += 60_000;
    const refreshed = await app.feed.refreshFeedView({ profileId: PROFILE, mode: "byof" });
    expect(refreshed.ok).toBe(true);

    // The cache answers with its OWN age labels (savedAt = the refresh
    // clock; capturedAt = the feed's capture truth).
    const cached: DesktopFeedCacheEntry | null = await app.feed.cachedFeedView({
      profileId: PROFILE,
      mode: "byof",
    });
    expect(cached).not.toBeNull();
    if (cached !== null) {
      expect(cached.savedAt).toBe("2026-09-19T14:01:00.000Z"); // the adapter's write clock
      expect(cached.capturedAt).toBe("2026-09-19T14:00:00.000Z"); // the feed's capture truth
      expect(cached.records).toHaveLength(2); // the records verbatim
    }

    // The CACHE is per-mode (the webflix cache is a separate entry).
    const webflixCache = await app.feed.cachedFeedView({ profileId: PROFILE, mode: "webflix" });
    expect(webflixCache).toBeNull(); // never refreshed under that mode

    // Explicit eviction.
    await app.feed.clearCache(PROFILE);
    expect(await app.feed.cachedFeedView({ profileId: PROFILE, mode: "byof" })).toBeNull();
  });

  it("a malformed cache is an honest miss (never a fabricated view)", async () => {
    const shell = new SimShell();
    let counter = 0;
    const double = createFeedPortDouble({
      profileId: PROFILE,
      userId: USER,
      now: () => "2026-09-19T14:00:00.000Z",
      nextId: () => String(++counter).padStart(6, "0"),
    });
    const app = bootWithFeed(double, shell);
    await shell.kvSet("wfx-feed-cache/wfxusr_r20g2_test:main/byof", "{ not json");
    const cached = await app.feed.cachedFeedView({ profileId: PROFILE, mode: "byof" });
    expect(cached).toBeNull();
  });

  it("UNBOUND TRUTH: without the feed block every operation answers the typed verdict (never a silent empty feed)", async () => {
    const shell = new SimShell();
    const app = createDesktopApp({
      shell,
      server: createDesktopServerPort({
        apiBase: BASE,
        context: CONTEXT,
        fetchImpl: () => Promise.reject(new TypeError("offline test boot")),
      }),
      session: {
        context: CONTEXT,
        clock: { now: () => Date.UTC(2026, 8, 19, 14, 0, 0) },
        ids: { next: () => "000001" },
      },
      engine: {
        config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
        process: new SimEngineProcess(),
      },
    });

    expect(app.feed.bound).toBe(false);

    const capability = await app.feed.fileImportCapability();
    expect(capability.supported).toBe(false);

    const verdict = await app.feed.importFromFile({ connectorId: "youtube", method: "user-file" });
    expect(verdict.outcome).toBe("unsupported");

    const view = await app.feed.feedView({ profileId: PROFILE, mode: "byof" });
    expect(view.ok).toBe(false);
    if (!view.ok) {
      expect(view.code).toBe("unbound");
      expect(view.detail).toContain("not bound");
    }

    const sync = await app.feed.runSync({ importId: "wfximp_none" });
    expect(sync.outcome).toBe("unsupported");

    // The dialog never opened — the unbound surface touches no platform facility.
    expect(shell.pickRequests).toHaveLength(0);
  });
});
