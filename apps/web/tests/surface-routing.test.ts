/**
 * R07 surface-routing tests (bun:test).
 *
 * Proves the adapter's navigation-state ⇄ route mapping:
 * - EVERY product surface of the runtime's state machine has a real route
 *   (the completeness law — all seven surfaces);
 * - state → href and route → state round-trip (with payloads);
 * - invalid route payloads are answered typed (a non-canonical item id, an
 *   empty query, a bad section) — never a guessed state;
 * - the player/offline routes are presentation routes (no navigation
 *   state — the runtime's playback owns the player);
 * - `syncNavigationToRoute` applies the DEEP-LINK law: reset replaces the
 *   state with no fabricated past; an invalid route resets to home and
 *   reports the reason.
 *
 * Deterministic: the fixture-booted runtime, no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { NavigationState } from "@wfx/client-runtime";

import {
  deriveNavigationState,
  itemDetailHref,
  navigationStateToHref,
  playerHref,
  SURFACE_ROUTES,
  surfaceHref,
  syncNavigationToRoute,
} from "../src/app/routing";
import { getWebRuntimeHost } from "../src/host/web-host";
import { resetWebHostProcessState } from "../src/host/testing";
import { withEnv } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
});

async function runtime() {
  return (await getWebRuntimeHost()).runtime;
}

describe("R07 routing — the completeness law (every surface has a route)", () => {
  it("all seven surfaces map to distinct routes", () => {
    expect(Object.keys(SURFACE_ROUTES).sort()).toEqual(
      ["home", "watch", "shorts", "search", "item", "library", "settings"].sort(),
    );
    const routes = new Set(Object.values(SURFACE_ROUTES));
    expect(routes.size).toBe(7);
    expect(SURFACE_ROUTES.home).toBe("/");
  });

  it("surfaceHref mirrors the route table", () => {
    for (const surface of Object.keys(SURFACE_ROUTES) as (keyof typeof SURFACE_ROUTES)[]) {
      expect(surfaceHref(surface)).toBe(SURFACE_ROUTES[surface]);
    }
  });
});

describe("R07 routing — state ⇄ href round-trips", () => {
  const ITEM_ID = "wfxitm_00000000000000000000000001";

  it("unparameterized surfaces round-trip", () => {
    for (const surface of ["home", "watch", "shorts"] as const) {
      const state: NavigationState = { surface };
      expect(deriveNavigationState(SURFACE_ROUTES[surface], {})).toEqual({ ok: true, state });
    }
  });

  it("search round-trips with its query", () => {
    const state: NavigationState = { surface: "search", query: "neon rain" };
    const href = navigationStateToHref(state);
    expect(href).toBe(`/search?q=${encodeURIComponent("neon rain")}`);
    expect(deriveNavigationState("/search", { q: "neon rain" })).toEqual({ ok: true, state });
  });

  it("item round-trips with its canonical id", () => {
    const state: NavigationState = { surface: "item", itemId: ITEM_ID };
    const href = navigationStateToHref(state);
    expect(href).toBe(`/item?id=${encodeURIComponent(ITEM_ID)}`);
    expect(deriveNavigationState("/item", { id: ITEM_ID })).toEqual({ ok: true, state });
  });

  it("library/settings round-trip with their sections", () => {
    expect(deriveNavigationState("/library", {})).toEqual({
      ok: true,
      state: { surface: "library" },
    });
    expect(deriveNavigationState("/library", { section: "history" })).toEqual({
      ok: true,
      state: { surface: "library", section: "history" },
    });
    expect(deriveNavigationState("/settings", { section: "sources" })).toEqual({
      ok: true,
      state: { surface: "settings", section: "sources" },
    });
    expect(navigationStateToHref({ surface: "settings", section: "model" })).toBe(
      "/settings?section=model",
    );
  });

  it("the href builders carry the adapter data (item detail + player)", () => {
    const detail = itemDetailHref({
      itemId: ITEM_ID,
      connectorId: "conn-1",
      externalRef: "ref-1",
      title: "Neon Rain",
      canonicalType: "short",
      durationMs: 45_000,
    });
    expect(detail).toContain("id=wfxitm_");
    expect(detail).toContain("connector=conn-1");
    expect(detail).toContain("ref=ref-1");
    expect(detail).toContain("duration=45000");

    const play = playerHref(
      {
        itemId: ITEM_ID,
        connectorId: "conn-1",
        externalRef: "ref-1",
        title: "Neon Rain",
        canonicalType: "short",
      },
      12_000,
    );
    expect(play.startsWith("/player?")).toBe(true);
    expect(play).toContain("resume=12000");
  });
});

describe("R07 routing — invalid payloads are typed, never guessed", () => {
  it("an empty search query is invalid (the state machine's own law)", () => {
    expect(deriveNavigationState("/search", { q: "   " })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("non-empty query"),
    });
  });

  it("a non-canonical item id is invalid", () => {
    expect(deriveNavigationState("/item", { id: "not-an-id" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("wfxitm_"),
    });
  });

  it("a deep link without an id but with connector+ref joins through the canonical seam", () => {
    const derived = deriveNavigationState("/item", { connector: "conn-1", ref: "ref-9" });
    expect(derived.ok).toBe(true);
    if (derived.ok) {
      expect(derived.state.surface).toBe("item");
      expect((derived.state as { itemId: string }).itemId.startsWith("wfxitm_")).toBe(true);
    }
  });

  it("bad sections are invalid", () => {
    expect(deriveNavigationState("/library", { section: "favorites" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("watchlist | history"),
    });
    expect(deriveNavigationState("/settings", { section: "privacy" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("sources | model | general"),
    });
  });

  it("unknown routes and presentation routes are typed", () => {
    expect(deriveNavigationState("/nope", {})).toMatchObject({ ok: false });
    expect(deriveNavigationState("/player", {})).toMatchObject({ ok: false, reason: "presentation-route" });
    expect(deriveNavigationState("/offline", {})).toMatchObject({ ok: false, reason: "presentation-route" });
  });
});

describe("R07 routing — the deep-link law (syncNavigationToRoute)", () => {
  it("resets the runtime navigation to the route's state (no fabricated past)", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const clientRuntime = await runtime();
      // Fabricate some history first (as if in-session navigation happened).
      clientRuntime.navigation.navigate({ surface: "watch" });
      clientRuntime.navigation.navigate({ surface: "shorts" });
      expect(clientRuntime.navigation.canGoBack()).toBe(true);

      const { state, invalidReason } = syncNavigationToRoute(clientRuntime, "/search", { q: "rain" });
      expect(invalidReason).toBeNull();
      expect(state).toEqual({ surface: "search", query: "rain" });
      // The deep-link law: the back-stack is GONE (reset clears it).
      expect(clientRuntime.navigation.canGoBack()).toBe(false);
    });
  });

  it("an invalid route resets to home and reports the typed reason", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const clientRuntime = await runtime();
      const { state, invalidReason } = syncNavigationToRoute(clientRuntime, "/item", { id: "garbage" });
      expect(invalidReason).toContain("wfxitm_");
      expect(state).toEqual({ surface: "home" });
      expect(clientRuntime.navigation.current()).toEqual({ surface: "home" });
    });
  });

  it("presentation routes keep the current navigation state", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const clientRuntime = await runtime();
      clientRuntime.navigation.navigate({ surface: "watch" });
      const { state, invalidReason } = syncNavigationToRoute(clientRuntime, "/player", {});
      expect(invalidReason).toBeNull();
      expect(state).toEqual({ surface: "watch" });
    });
  });
});
