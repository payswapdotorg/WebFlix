/**
 * @wfx/client-runtime — the feed-mode control store tests (R21-A).
 *
 * The shared control contract laws: closed vocabulary (typed throw),
 * honest availability (adapter-reported, never guessed), typed refusals
 * with recovery hints (never silent), report-only availability updates
 * (a selected mode is never silently reverted), subscribe semantics, and
 * the runtime wiring (`runtime.feedMode` — ADD-ONLY).
 */

import { describe, expect, it } from "bun:test";

import {
  DEFAULT_FEED_MODE,
  DEFAULT_FEED_MODE_AVAILABILITY,
  FEED_MODES,
  createRuntime,
  createFeedModeStore,
  effectiveFeedModeAvailability,
  isFeedMode,
  makeWebCapabilities,
  InMemoryServerPort,
} from "../src/index";

describe("the feed-mode control store (the shared contract laws)", () => {
  it("defaults to 'For you' with the honest default availability", () => {
    const store = createFeedModeStore();
    expect(store.get()).toBe(DEFAULT_FEED_MODE);
    expect(store.get()).toBe("foryou");
    expect(store.availability()).toEqual(DEFAULT_FEED_MODE_AVAILABILITY);
  });

  it("sets an available mode and notifies subscribers (deterministic order)", () => {
    const store = createFeedModeStore();
    store.setAvailability({ following: true, byof: false });
    const seen: string[] = [];
    store.subscribe((mode) => seen.push(mode));
    expect(store.set("following")).toMatchObject({ ok: true, mode: "following" });
    expect(store.get()).toBe("following");
    expect(seen).toEqual(["following"]);
    // Setting the SAME mode is a no-op (no duplicate notification).
    expect(store.set("following")).toMatchObject({ ok: true });
    expect(seen).toEqual(["following"]);
  });

  it("a non-vocabulary mode is caller misuse — the typed throw", () => {
    const store = createFeedModeStore();
    expect(() => store.set("for-you" as never)).toThrow(/feedMode\.set: expected one of/);
    expect(() => store.set(42 as never)).toThrow(/invalid-input/);
  });

  it("setting an UNAVAILABLE mode answers the typed refusal WITH its recovery hint", () => {
    const store = createFeedModeStore();
    // No following, no BYOF: all non-default modes are honestly unavailable.
    const refused = store.set("byof");
    expect(refused).toMatchObject({ ok: false, failure: { kind: "unavailable", mode: "byof" } });
    if (!refused.ok) {
      expect(refused.failure.detail).toContain("imported feed");
      expect(refused.failure.recoveryHint).toContain("Bring your feed");
    }
    const refusedFollowing = store.set("following");
    expect(refusedFollowing).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
    if (!refusedFollowing.ok) {
      expect(refusedFollowing.failure.recoveryHint.length).toBeGreaterThan(0);
    }
    const refusedHybrid = store.set("hybrid");
    expect(refusedHybrid).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
    // The refusal is never silent: the selection did not change.
    expect(store.get()).toBe("foryou");
  });

  it("availability updates are REPORT-ONLY: a selected mode is never silently reverted", () => {
    const store = createFeedModeStore();
    store.setAvailability({ following: false, byof: true });
    expect(store.set("byof")).toMatchObject({ ok: true, mode: "byof" });
    // The import is disconnected — the truth changes, the selection stays.
    store.setAvailability({ following: false, byof: false });
    expect(store.get()).toBe("byof");
    // But re-selecting it now refuses honestly.
    expect(store.set("byof")).toMatchObject({ ok: false });
    // And the store can move back to an available mode.
    expect(store.set("foryou")).toMatchObject({ ok: true, mode: "foryou" });
  });

  it("'For you' is ALWAYS available (the default orientation never refuses)", () => {
    const store = createFeedModeStore();
    store.setAvailability({ following: false, byof: false });
    expect(store.set("foryou")).toMatchObject({ ok: true, mode: "foryou" });
  });

  it("effective availability derives Hybrid from any non-default source (pure)", () => {
    expect(effectiveFeedModeAvailability({ following: false, byof: false })).toEqual({
      foryou: true,
      following: false,
      byof: false,
      hybrid: false,
    });
    expect(effectiveFeedModeAvailability({ following: true, byof: false })).toEqual({
      foryou: true,
      following: true,
      byof: false,
      hybrid: true,
    });
    expect(effectiveFeedModeAvailability({ following: false, byof: true })).toEqual({
      foryou: true,
      following: false,
      byof: true,
      hybrid: true,
    });
  });

  it("setAvailability validates its input (typed throw on garbage)", () => {
    const store = createFeedModeStore();
    expect(() => store.setAvailability({ following: "yes" } as never)).toThrow(
      /feedMode\.setAvailability: expected/,
    );
    expect(() => store.setAvailability(null as never)).toThrow(
      /feedMode\.setAvailability: expected/,
    );
  });

  it("the closed vocabulary membership guard", () => {
    expect(FEED_MODES).toEqual(["foryou", "following", "byof", "hybrid"]);
    for (const mode of FEED_MODES) {
      expect(isFeedMode(mode)).toBe(true);
    }
    expect(isFeedMode("trending")).toBe(false);
  });
});

describe("the runtime wiring (ADD-ONLY — runtime.feedMode)", () => {
  it("createRuntime exposes the feed-mode operations over the real runtime", () => {
    const runtime = createRuntime(
      makeWebCapabilities(),
      new InMemoryServerPort(),
      {
        context: { userId: "wfx-anonymous", sessionId: "s-1", locale: "en" },
        clock: { now: () => 0 },
        ids: { next: () => "00000000000000000000000001" },
      },
    );
    expect(runtime.feedMode.get()).toBe("foryou");
    expect(runtime.feedMode.set("byof")).toMatchObject({ ok: false });
    runtime.feedMode.setAvailability({ following: false, byof: true });
    expect(runtime.feedMode.set("byof")).toMatchObject({ ok: true, mode: "byof" });
    expect(runtime.feedMode.availability()).toEqual({ following: false, byof: true });
  });
});
