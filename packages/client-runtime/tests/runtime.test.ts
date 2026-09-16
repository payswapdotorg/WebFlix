/**
 * @wfx/client-runtime — createRuntime integration tests (R01).
 *
 * The construction law (capability truth at boot), the read models' honest
 * degradation (never fake empties), and the runtime surface end-to-end.
 */

import { describe, expect, it } from "bun:test";
import type { SearchResult } from "@wfx/domain";

import {
  ACTION_STATE_STATUSES,
  FixedClock,
  InMemoryServerPort,
  LIBRARY_SYNC_STATES,
  PLAYBACK_PHASES,
  RUNTIME_ERROR_KINDS,
  SESSION_WATCH_STATUSES,
  SETTINGS_SECTIONS,
  SURFACE_IDS,
  TERMINAL_ACTION_STATUSES,
  TERMINAL_PLAYBACK_PHASES,
  SequentialIdGen,
  createRuntime,
  makeDesktopCapabilities,
  makeMobileCapabilities,
  makeWebCapabilities,
  type RuntimeSession,
} from "../src/index";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const ITEM_A = "wfxitm_00000000000000000000000001";

function session(overrides?: Partial<RuntimeSession>): RuntimeSession {
  return {
    context: { userId: "user-1", sessionId: "sess-1", locale: "en" },
    clock: new FixedClock(T0),
    ids: new SequentialIdGen(), // UNIQUE per event — the idempotency key
    ...overrides,
  };
}

function webRuntime(server = new InMemoryServerPort()) {
  const runtime = createRuntime(makeWebCapabilities(), server, session());
  return { runtime, server };
}

const HIT: SearchResult = {
  connectorId: "test-source",
  externalRef: "ref-1",
  title: "Cozy Movie",
  canonicalType: "movie",
  durationMs: 120_000,
};

describe("the construction law (capability truth at boot)", () => {
  it("boots on coherent web/desktop/mobile bundles", () => {
    expect(() => createRuntime(makeWebCapabilities(), new InMemoryServerPort(), session())).not.toThrow();
    expect(() => createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), session())).not.toThrow();
    expect(() => createRuntime(makeMobileCapabilities(), new InMemoryServerPort(), session())).not.toThrow();
  });

  it("NEVER boots on a lying adapter (declared-contained browser host, no port)", () => {
    const web = makeWebCapabilities();
    const lying = { ...web, ports: { ...web.ports, nativeMedia: {} } } as typeof web;
    expect(() => createRuntime(lying as never, new InMemoryServerPort(), session())).toThrow(
      /incoherent/,
    );
  });

  it("rejects malformed session bundles with the typed error", () => {
    expect(() =>
      createRuntime(makeWebCapabilities(), new InMemoryServerPort(), {
        ...session(),
        context: { userId: "", sessionId: "s", locale: "en" },
      }),
    ).toThrow(/context\.userId/);
    expect(() =>
      createRuntime(makeWebCapabilities(), new InMemoryServerPort(), {
        ...session(),
        clock: undefined as never,
      }),
    ).toThrow(/session\.clock/);
    expect(() =>
      createRuntime(makeWebCapabilities(), new InMemoryServerPort(), {
        ...session(),
        ids: undefined as never,
      }),
    ).toThrow(/session\.ids/);
  });

  it("exposes the platform kind + the truthful capability bundle", () => {
    const { runtime } = webRuntime();
    expect(runtime.platform).toBe("web");
    expect(runtime.capabilities.nativeMedia).toBe("none"); // Web truth
    expect(runtime.capabilities.descriptor.limitations?.nativeMedia).toBeDefined();
  });
});

describe("search — honest degradation in the model (never a fake empty)", () => {
  it("a successful search registers canonical ids and returns ready hits", async () => {
    const { runtime, server } = webRuntime();
    server.scriptSearch("cozy", { ok: true, value: [HIT] });
    const model = await runtime.search({ query: "cozy" });
    expect(model.status.state).toBe("ready");
    expect(model.hits).toHaveLength(1);
    expect(model.hits[0]?.canonicalItemId.startsWith("wfxitm_")).toBe(true);
    // The same hit resolves to the SAME canonical id (registry stability).
    const again = await runtime.search({ query: "cozy" });
    expect(again.hits[0]?.canonicalItemId).toBe(model.hits[0]?.canonicalItemId);
  });

  it("a network failure is an ERROR SECTION — not an empty success", async () => {
    const { runtime, server } = webRuntime();
    server.scriptSearch("broken", { ok: false, failure: { kind: "network", detail: "offline" } });
    const model = await runtime.search({ query: "broken" });
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("network");
    expect(model.status.error?.detail).toBe("offline");
    expect(model.hits).toEqual([]);
  });

  it("an unauthorized failure names re-authentication (a missing credential is never silent success)", async () => {
    const { runtime, server } = webRuntime();
    server.scriptSearch("private", { ok: false, failure: { kind: "unauthorized", detail: "401" } });
    const model = await runtime.search({ query: "private" });
    expect(model.status.state).toBe("error");
    expect(model.status.error?.kind).toBe("unauthorized");
  });

  it("malformed hits are skipped (a broken hit is never a card)", async () => {
    const { runtime, server } = webRuntime();
    server.scriptSearch("mixed", {
      ok: true,
      value: [HIT, { connectorId: "", externalRef: "x", title: "broken" } as SearchResult],
    });
    const model = await runtime.search({ query: "mixed" });
    expect(model.hits).toHaveLength(1);
  });

  it("empty queries throw the typed invalid-input error; shorts allow the curated empty query", async () => {
    const { runtime } = webRuntime();
    await expect(runtime.search({ query: "  " })).rejects.toMatchObject({ kind: "invalid-input" });
    const shorts = await runtime.shorts();
    expect(shorts.status.state).toBe("ready");
    expect(shorts.query).toBe("");
  });
});

describe("getHome — continue watching from the session fold", () => {
  it("lists resumable items (in-progress + skipped), excludes completed", async () => {
    const { runtime } = webRuntime();
    await runtime.updateWatchState({ kind: "progress", itemId: ITEM_A, positionMs: 30_000 });
    const home = await runtime.getHome();
    expect(home.continueWatching.status.state).toBe("ready");
    expect(home.continueWatching.entries).toHaveLength(1);
    expect(home.continueWatching.entries[0]?.itemId).toBe(ITEM_A);
    expect(home.continueWatching.entries[0]?.positionMs).toBe(30_000);
    await runtime.updateWatchState({ kind: "complete", itemId: ITEM_A, positionMs: 120_000 });
    const after = await runtime.getHome();
    expect(after.continueWatching.entries).toHaveLength(0);
  });

  it("honors section inclusion", async () => {
    const { runtime } = webRuntime();
    const home = await runtime.getHome({ includeContinueWatching: false });
    expect(home.continueWatching.entries).toEqual([]);
  });
});

describe("the runtime surface — sketch methods + operations", () => {
  it("setIntent + setRecommendationPolicy work through the runtime (validated)", async () => {
    const { runtime } = webRuntime();
    await runtime.setIntent({ objective: "cozy-tonight", scope: "session" });
    expect(runtime.intents.intents()).toHaveLength(1);
    await runtime.setRecommendationPolicy({ attentionMode: "immersive" });
    expect(runtime.intents.policy().attentionMode).toBe("immersive");
    await expect(
      runtime.setIntent({ objective: "x", scope: "temporary" }),
    ).rejects.toMatchObject({ kind: "invalid-input" });
    await expect(
      runtime.setRecommendationPolicy({ attentionMode: "chaotic" as never }),
    ).rejects.toMatchObject({ kind: "invalid-input" });
  });

  it("updateWatchState delivers through the port and surfaces delivery failures", async () => {
    const { runtime, server } = webRuntime();
    await runtime.updateWatchState({ kind: "progress", itemId: ITEM_A, positionMs: 1_000 });
    expect(server.emittedEvents).toHaveLength(1);
    server.failNextEmits({ kind: "network", detail: "offline" });
    await expect(
      runtime.updateWatchState({ kind: "progress", itemId: ITEM_A, positionMs: 2_000 }),
    ).rejects.toMatchObject({ kind: "network" });
    expect(runtime.watchState.pendingEventCount()).toBe(1);
    const report = await runtime.retryPendingWatchEvents();
    expect(report.delivered).toBe(1);
    expect(report.remaining).toBe(0);
  });

  it("library writes work through the runtime (canonical-keyed)", async () => {
    const { runtime, server } = webRuntime();
    server.scriptSearch("cozy", { ok: true, value: [HIT] });
    const search = await runtime.search({ query: "cozy" });
    const itemId = search.hits[0]?.canonicalItemId ?? "";
    const saved = await runtime.libraryOps.save({ itemId });
    expect(saved.ok).toBe(true);
    const model = await runtime.library();
    expect(model.watchlist.entries).toHaveLength(1);
    expect(model.watchlist.entries[0]?.title).toBe("Cozy Movie");
  });

  it("navigation is owned by the runtime (initial state, legal transitions)", () => {
    const { runtime } = webRuntime();
    expect(runtime.navigation.current()).toEqual({ surface: "home" });
    const result = runtime.navigation.navigate({ surface: "shorts" });
    expect(result.ok).toBe(true);
    expect(runtime.navigation.current()).toEqual({ surface: "shorts" });
  });

  it("dispatchAction surfaces honest action states through the runtime", async () => {
    const { runtime } = webRuntime();
    const state = await runtime.dispatchAction({
      type: "download",
      connectorId: "test-source",
      externalRef: "ref-1",
    });
    expect(state.status).toBe("unsupported"); // web truth — never success
    expect(state.capabilityGate).toBe("native-acquisition");
  });
});

describe("closed vocabulary mirrors (the runtime-side frozen vocabularies)", () => {
  it("exports the vocabulary sets verbatim", () => {
    expect(SURFACE_IDS).toEqual(["home", "watch", "shorts", "search", "item", "library", "settings"]);
    expect(SETTINGS_SECTIONS).toEqual(["sources", "model", "general"]);
    expect(ACTION_STATE_STATUSES).toEqual([
      "requested",
      "confirmed-locally",
      "confirmed-by-provider",
      "unsupported",
      "failed",
    ]);
    expect(TERMINAL_ACTION_STATUSES).toEqual([
      "confirmed-locally",
      "confirmed-by-provider",
      "unsupported",
      "failed",
    ]);
    expect(PLAYBACK_PHASES).toEqual([
      "resolving",
      "prepared",
      "preparing",
      "buffering",
      "playing",
      "paused",
      "degraded",
      "stopped",
      "failed",
      "unresolvable",
    ]);
    expect(TERMINAL_PLAYBACK_PHASES).toEqual(["stopped", "failed", "unresolvable"]);
    expect(SESSION_WATCH_STATUSES).toEqual(["in-progress", "completed", "skipped"]);
    expect(LIBRARY_SYNC_STATES).toEqual(["synced", "pending", "failed", "unsupported", "conflict"]);
    expect(RUNTIME_ERROR_KINDS).toEqual([
      "invalid-input",
      "network",
      "unauthorized",
      "unavailable",
      "unsupported-capability",
      "degraded",
      "not-found",
    ]);
  });
});
