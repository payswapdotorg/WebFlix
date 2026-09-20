/**
 * @wfx/client-runtime — the capability discovery matrix tests (R21-A).
 *
 * The frozen structural laws of the matrix (every violation = a lead
 * rejection per the R21 plan):
 *
 * - the capability-id vocabulary is CLOSED and matches the matrix rows
 *   one-to-one (no orphan ids, no untyped rows);
 * - EVERY row carries at least one CONTEXTUAL entry (Settings is never
 *   the only discovery path — the frozen UX law);
 * - EVERY row carries a RECOVERY path with non-empty state/action/detail
 *   (every accepted capability has a next-action path);
 * - EVERY row names its detailed management destination (Settings area);
 * - PLATFORM TRUTH notes exist only where Web/Desktop honestly differ,
 *   and every note carries the truthful next step (unsupported is not
 *   undiscoverable);
 * - every J34 task is covered by ≥1 row; every row's j34Task (when set)
 *   is a real task id;
 * - the feed-mode vocabulary is closed and BYOF's label names
 *   source-native order (an imported feed is never mislabeled);
 * - the stale-completion-copy law: the markers catch the observed R21
 *   defect family and leave honest state copy alone.
 */

import { describe, expect, it } from "bun:test";

import {
  CAPABILITY_SURFACE_MATRIX,
  DISCOVERABLE_CAPABILITY_IDS,
  FEED_MODES,
  FEED_MODE_LABELS,
  J34_TASKS,
  PRIMARY_NAVIGATION_SURFACES,
  PRODUCT_SURFACE_IDS,
  STALE_COMPLETION_MARKERS,
  capabilitiesForJ34Task,
  capabilitySurfaceOf,
  isDiscoverableCapabilityId,
  isFeedMode,
  isJ34TaskId,
  isPrimaryNavigationSurface,
  isProductSurfaceId,
  isStaleCompletionCopy,
} from "../src/index";

describe("the capability-id vocabulary is closed and one-to-one with the matrix", () => {
  it("every declared id has exactly one matrix row (no orphans, no duplicates)", () => {
    expect(DISCOVERABLE_CAPABILITY_IDS).toHaveLength(CAPABILITY_SURFACE_MATRIX.length);
    const seen = new Set<string>();
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      expect(seen.has(row.capability)).toBe(false);
      seen.add(row.capability);
      expect(DISCOVERABLE_CAPABILITY_IDS).toContain(row.capability);
    }
    for (const id of DISCOVERABLE_CAPABILITY_IDS) {
      expect(seen.has(id)).toBe(true);
    }
  });

  it("membership guards accept the vocabulary and reject garbage", () => {
    expect(isDiscoverableCapabilityId("identity-session")).toBe(true);
    expect(isDiscoverableCapabilityId("identity-session-x")).toBe(false);
    expect(isDiscoverableCapabilityId(42)).toBe(false);
  });

  it("capabilitySurfaceOf answers the row; an unknown id throws (closed vocabulary)", () => {
    expect(capabilitySurfaceOf("model-policy").productLabel).toContain("Model");
    expect(() => capabilitySurfaceOf("not-a-capability" as never)).toThrow(/no matrix row/);
  });
});

describe("every capability carries a normal discovery affordance AND a recovery path", () => {
  it("every row has a primary discovery control on a real product surface", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      expect(isProductSurfaceId(row.primaryDiscovery.surface)).toBe(true);
      expect(row.primaryDiscovery.control.trim().length).toBeGreaterThan(0);
    }
  });

  it("every row has at least one CONTEXTUAL entry (Settings is never the only path)", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      expect(row.contextualEntries.length).toBeGreaterThan(0);
      for (const entry of row.contextualEntries) {
        expect(isProductSurfaceId(entry.surface)).toBe(true);
        expect(entry.control.trim().length).toBeGreaterThan(0);
        expect(entry.moment.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every row names its detailed management destination in Settings", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      expect(row.management.surface).toBe("settings");
      expect(
        ["profile", "sources", "feeds", "recommendation", "model", "playback", "general"],
      ).toContain(row.management.area);
    }
  });

  it("every row carries a recovery path with non-empty state, action, and detail", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      expect(row.recovery.state.trim().length).toBeGreaterThan(0);
      expect(row.recovery.action.trim().length).toBeGreaterThan(0);
      expect(row.recovery.detail.trim().length).toBeGreaterThan(0);
    }
  });

  it("product labels speak product concepts, never architecture jargon", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      // The label must not leak connector/protocol/lane vocabulary.
      expect(/connector|protocol|transport|lane|R\d{1,2}\b/i.test(row.productLabel)).toBe(false);
    }
  });
});

describe("platform truth notes (Web/Desktop differ only where capability truth requires)", () => {
  it("every note carries the divergence reason AND the truthful next step", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      if (row.platformTruth === null) continue;
      expect(["web", "desktop"]).toContain(row.platformTruth.platform);
      expect(row.platformTruth.reason.trim().length).toBeGreaterThan(0);
      expect(row.platformTruth.nextStep.trim().length).toBeGreaterThan(0);
    }
  });

  it("the native-only capabilities (offline, acquisition, playback, local models) carry their notes", () => {
    for (const id of ["native-offline", "acquisition-recovery", "playback-fallback", "model-policy"] as const) {
      expect(capabilitySurfaceOf(id).platformTruth).not.toBeNull();
    }
    // Pure-semantic capabilities carry NO note (a divergence without a
    // note is a parity defect).
    for (const id of ["identity-session", "feed-mode", "explicit-intent", "recommendation-feedback"] as const) {
      expect(capabilitySurfaceOf(id).platformTruth).toBeNull();
    }
  });
});

describe("the J34 task coverage (the meta-journey binds to matrix rows)", () => {
  it("every J34 task is covered by at least one matrix row", () => {
    expect(J34_TASKS).toHaveLength(12);
    for (const task of J34_TASKS) {
      expect(capabilitiesForJ34Task(task).length).toBeGreaterThan(0);
    }
  });

  it("every row's j34Task binding is a real task id", () => {
    for (const row of CAPABILITY_SURFACE_MATRIX) {
      if (row.j34Task === null) continue;
      expect(isJ34TaskId(row.j34Task)).toBe(true);
      expect(capabilitiesForJ34Task(row.j34Task)).toContain(row);
    }
  });

  it("the dispatch's affected concepts all have matrix rows", () => {
    // identity/session; source/feed mode; intent/recommendation policy;
    // model policy; realization/source selection; AI operations;
    // acquisition/offline state — the R21-A seam list.
    for (const id of [
      "identity-session",
      "connected-sources",
      "feed-mode",
      "following-byof",
      "explicit-intent",
      "recommendation-policy",
      "recommendation-feedback",
      "model-policy",
      "realization-choice",
      "playback-fallback",
      "ai-transformations",
      "native-offline",
      "acquisition-recovery",
    ] as const) {
      expect(DISCOVERABLE_CAPABILITY_IDS).toContain(id);
    }
  });
});

describe("the feed-mode vocabulary", () => {
  it("is the closed four-mode union with labels", () => {
    expect(FEED_MODES).toEqual(["foryou", "following", "byof", "hybrid"]);
    expect(isFeedMode("foryou")).toBe(true);
    expect(isFeedMode("for-you")).toBe(false);
    expect(isFeedMode(null)).toBe(false);
    for (const mode of FEED_MODES) {
      expect(FEED_MODE_LABELS[mode].length).toBeGreaterThan(0);
    }
  });

  it("the BYOF label names the imported feed (source-native order — never WebFlix-ranked)", () => {
    expect(FEED_MODE_LABELS.byof).toContain("imported");
    expect(FEED_MODE_LABELS.byof.toLowerCase()).not.toContain("for you");
  });
});

describe("the stale-completion-copy law (J35's sweep primitive)", () => {
  it("catches the observed R21 defect family verbatim", () => {
    // The exact stale strings the production simulation observed.
    expect(isStaleCompletionCopy("Sign-in and profiles arrive with the identity lane (R02)")).toBe(true);
    expect(isStaleCompletionCopy("Model controls arrive with the model lane (R06)")).toBe(true);
    expect(
      isStaleCompletionCopy("Source management arrives with the source-management lane (R03)."),
    ).toBe(true);
    expect(
      isStaleCompletionCopy("Browse composed for your session (seeded until personal ranking ships — R05)."),
    ).toBe(true);
    expect(isStaleCompletionCopy("the server-transport FeedPort arrives with the R20 API lane")).toBe(true);
    expect(isStaleCompletionCopy("These endpoints land with R04 (history) and R05 (intents/policy)")).toBe(true);
  });

  it("leaves honest current-state copy alone", () => {
    expect(isStaleCompletionCopy("You are browsing in an anonymous session.")).toBe(false);
    expect(isStaleCompletionCopy("This title isn't playable here — try the next way to watch.")).toBe(false);
    expect(isStaleCompletionCopy("Available offline in the Desktop app.")).toBe(false);
    expect(isStaleCompletionCopy("The stored sign-in expired — reconnect to restore this source.")).toBe(false);
  });

  it("the marker list is non-empty and every marker is a RegExp", () => {
    expect(STALE_COMPLETION_MARKERS.length).toBeGreaterThan(0);
    for (const marker of STALE_COMPLETION_MARKERS) {
      expect(marker instanceof RegExp).toBe(true);
    }
  });
});

describe("the frozen primary navigation vocabulary (no second navigation system)", () => {
  it("is exactly the six frozen surfaces; product surfaces add only item + player", () => {
    expect(PRIMARY_NAVIGATION_SURFACES).toEqual([
      "home",
      "watch",
      "shorts",
      "search",
      "library",
      "settings",
    ]);
    expect(isPrimaryNavigationSurface("settings")).toBe(true);
    expect(isPrimaryNavigationSurface("player")).toBe(false);
    expect(isPrimaryNavigationSurface("dashboard")).toBe(false);
    expect(PRODUCT_SURFACE_IDS).toEqual([
      "home",
      "watch",
      "shorts",
      "search",
      "item",
      "library",
      "settings",
      "player",
    ]);
    expect(isProductSurfaceId("item")).toBe(true);
    expect(isProductSurfaceId("player")).toBe(true);
    expect(isProductSurfaceId("architecture-dashboard")).toBe(false);
  });
});
