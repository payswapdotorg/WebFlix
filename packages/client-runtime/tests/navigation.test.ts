/**
 * @wfx/client-runtime — navigation state machine tests (R01).
 *
 * The typed-state/transition/back-stack laws (see src/navigation.ts).
 */

import { describe, expect, it } from "bun:test";

import {
  INITIAL_NAVIGATION_STATE,
  MAX_NAVIGATION_HISTORY,
  NAVIGATION_TRANSITIONS,
  SURFACE_IDS,
  assertValidNavigationState,
  createNavigationStore,
  isLegalSurfaceTransition,
  navigationStatesEqual,
  type NavigationState,
} from "../src/index";

const ITEM_A = "wfxitm_00000000000000000000000001";
const ITEM_B = "wfxitm_00000000000000000000000002";

describe("navigation state machine — the transition table", () => {
  it("the table is exhaustive: every surface appears as a source", () => {
    for (const surface of SURFACE_IDS) {
      expect(NAVIGATION_TRANSITIONS[surface]).toBeDefined();
    }
  });

  it("settings and library cannot re-enter themselves (destination surfaces)", () => {
    expect(isLegalSurfaceTransition("settings", "settings")).toBe(false);
    expect(isLegalSurfaceTransition("library", "library")).toBe(false);
  });

  it("home/watch/shorts/search/item can reach every legal neighbor", () => {
    expect(isLegalSurfaceTransition("home", "watch")).toBe(true);
    expect(isLegalSurfaceTransition("home", "shorts")).toBe(true);
    expect(isLegalSurfaceTransition("watch", "item")).toBe(true);
    expect(isLegalSurfaceTransition("shorts", "search")).toBe(true);
    expect(isLegalSurfaceTransition("search", "item")).toBe(true);
    expect(isLegalSurfaceTransition("item", "item")).toBe(true);
    expect(isLegalSurfaceTransition("settings", "home")).toBe(true);
    expect(isLegalSurfaceTransition("library", "item")).toBe(true);
  });
});

describe("navigation state machine — navigate", () => {
  it("starts at home with no history", () => {
    const nav = createNavigationStore();
    expect(nav.current()).toEqual({ surface: "home" });
    expect(nav.canGoBack()).toBe(false);
    expect(nav.history()).toEqual([]);
  });

  it("pushes legal transitions onto the back-stack", () => {
    const nav = createNavigationStore();
    const result = nav.navigate({ surface: "search", query: "cozy comedy" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toEqual({ surface: "search", query: "cozy comedy" });
      expect(result.previous).toEqual({ surface: "home" });
      expect(result.changed).toBe(true);
    }
    expect(nav.canGoBack()).toBe(true);
    expect(nav.history()).toEqual([{ surface: "home" }]);
  });

  it("rejects illegal transitions with the typed reason", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "settings", section: "sources" });
    const result = nav.navigate({ surface: "settings", section: "model" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("illegal-transition");
      expect(result.detail).toContain("'settings' -> 'settings'");
    }
    // The state is unchanged.
    expect(nav.current()).toEqual({ surface: "settings", section: "sources" });
  });

  it("rejects invalid targets: item without a canonical id, search without a query", () => {
    const nav = createNavigationStore();
    const badItem = nav.navigate({ surface: "item", itemId: "garbage" });
    expect(badItem.ok).toBe(false);
    if (!badItem.ok) {
      expect(badItem.reason).toBe("invalid-target");
      expect(badItem.detail).toContain("canonical wfxitm_");
    }
    const badSearch = nav.navigate({ surface: "search", query: "   " });
    expect(badSearch.ok).toBe(false);
    if (!badSearch.ok) expect(badSearch.reason).toBe("invalid-target");
  });

  it("unparameterized self-transitions are honest no-ops (no stack push)", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "watch" });
    const before = nav.history().length;
    const result = nav.navigate({ surface: "watch" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(nav.history().length).toBe(before);
  });

  it("search self-transition REFINES (replaces the top, no push)", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "search", query: "cozy" });
    const result = nav.navigate({ surface: "search", query: "cozy comedy" });
    expect(result.ok).toBe(true);
    expect(nav.current()).toEqual({ surface: "search", query: "cozy comedy" });
    // home -> search(cozy) pushed home; the refinement added nothing.
    expect(nav.history()).toEqual([{ surface: "home" }]);
  });

  it("item self-transition CHAINS (a different item pushes; the same no-ops)", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "item", itemId: ITEM_A });
    const same = nav.navigate({ surface: "item", itemId: ITEM_A });
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.changed).toBe(false);
    const chained = nav.navigate({ surface: "item", itemId: ITEM_B });
    expect(chained.ok).toBe(true);
    if (chained.ok) expect(chained.changed).toBe(true);
    expect(nav.current()).toEqual({ surface: "item", itemId: ITEM_B });
    expect(nav.history().length).toBe(2); // home + item A
  });
});

describe("navigation state machine — back + reset", () => {
  it("back pops history in order", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "watch" });
    nav.navigate({ surface: "search", query: "x" });
    const back1 = nav.back();
    expect(back1.ok).toBe(true);
    if (back1.ok) expect(back1.state).toEqual({ surface: "watch" });
    const back2 = nav.back();
    expect(back2.ok).toBe(true);
    if (back2.ok) expect(back2.state).toEqual({ surface: "home" });
  });

  it("back on an empty stack answers the typed no-history failure", () => {
    const nav = createNavigationStore();
    const result = nav.back();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-history");
      expect(result.detail).toContain("empty");
    }
  });

  it("reset clears the stack (a deep link has no fabricated past)", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "watch" });
    nav.navigate({ surface: "search", query: "x" });
    const result = nav.reset({ surface: "item", itemId: ITEM_A });
    expect(result.ok).toBe(true);
    expect(nav.current()).toEqual({ surface: "item", itemId: ITEM_A });
    expect(nav.canGoBack()).toBe(false);
    expect(nav.history()).toEqual([]);
  });

  it("reset() defaults to home", () => {
    const nav = createNavigationStore();
    nav.navigate({ surface: "watch" });
    nav.reset();
    expect(nav.current()).toEqual(INITIAL_NAVIGATION_STATE);
  });
});

describe("navigation state machine — bounded history + subscription", () => {
  it("the back-stack is bounded (overflow drops the OLDEST entry)", () => {
    const nav = createNavigationStore();
    for (let index = 0; index < MAX_NAVIGATION_HISTORY + 10; index += 1) {
      const query = `q${index}`;
      const target: NavigationState =
        index % 2 === 0 ? { surface: "search", query } : { surface: "watch" };
      nav.navigate(target);
    }
    expect(nav.history().length).toBe(MAX_NAVIGATION_HISTORY);
  });

  it("subscribers see (current, previous) pairs and can unsubscribe", () => {
    const nav = createNavigationStore();
    const seen: Array<{ state: NavigationState; previous: NavigationState | null }> = [];
    const unsubscribe = nav.subscribe((state, previous) => seen.push({ state, previous }));
    nav.navigate({ surface: "shorts" });
    nav.navigate({ surface: "home" });
    unsubscribe();
    nav.navigate({ surface: "watch" });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.state).toEqual({ surface: "shorts" });
    expect(seen[0]?.previous).toEqual({ surface: "home" });
    expect(seen[1]?.state).toEqual({ surface: "home" });
    expect(seen[1]?.previous).toEqual({ surface: "shorts" });
  });
});

describe("navigation state machine — validation (typed throws + honest results)", () => {
  it("STRUCTURAL violations throw the typed invalid-input error", () => {
    expect(() => assertValidNavigationState({ surface: "item", itemId: 42 } as unknown as NavigationState)).toThrow(
      /invalid-input/,
    );
    expect(() => assertValidNavigationState({ surface: "search", query: 7 } as unknown as NavigationState)).toThrow(
      /invalid-input/,
    );
    expect(() =>
      assertValidNavigationState({ surface: "library", section: 9 } as unknown as NavigationState),
    ).toThrow(/invalid-input/);
    expect(() => assertValidNavigationState({ surface: "void" } as unknown as NavigationState)).toThrow(
      /invalid-input/,
    );
    expect(() => assertValidNavigationState(null as unknown as NavigationState)).toThrow(/invalid-input/);
  });

  it("SEMANTIC violations answer invalid-target results (deep-link honesty)", () => {
    const nav = createNavigationStore();
    const badItem = nav.navigate({ surface: "item", itemId: "nope" });
    expect(badItem.ok).toBe(false);
    if (!badItem.ok) expect(badItem.reason).toBe("invalid-target");
    const emptyQuery = nav.navigate({ surface: "search", query: "" });
    expect(emptyQuery.ok).toBe(false);
    if (!emptyQuery.ok) expect(emptyQuery.reason).toBe("invalid-target");
    const badLibrary = nav.navigate({ surface: "library", section: "bogus" as never });
    expect(badLibrary.ok).toBe(false);
    if (!badLibrary.ok) expect(badLibrary.reason).toBe("invalid-target");
    const badSettings = nav.navigate({ surface: "settings", section: "bogus" as never });
    expect(badSettings.ok).toBe(false);
    if (!badSettings.ok) expect(badSettings.reason).toBe("invalid-target");
  });

  it("navigationStatesEqual compares surface + payload", () => {
    expect(navigationStatesEqual({ surface: "home" }, { surface: "home" })).toBe(true);
    expect(navigationStatesEqual({ surface: "home" }, { surface: "watch" })).toBe(false);
    expect(
      navigationStatesEqual({ surface: "item", itemId: ITEM_A }, { surface: "item", itemId: ITEM_A }),
    ).toBe(true);
    expect(
      navigationStatesEqual({ surface: "item", itemId: ITEM_A }, { surface: "item", itemId: ITEM_B }),
    ).toBe(false);
    expect(
      navigationStatesEqual({ surface: "search", query: "a" }, { surface: "search", query: "b" }),
    ).toBe(false);
  });

  it("navigate validates targets (typed throw on structurally malformed input)", () => {
    const nav = createNavigationStore();
    expect(() => nav.navigate(null as unknown as NavigationState)).toThrow(/invalid-input/);
  });
});
