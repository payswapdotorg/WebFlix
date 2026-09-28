/**
 * R37 — the LIVE DESIGNATION tests (the connector-layer derivation law:
 * an item is live because its connector metadata says so; the surfaces
 * derive, never guess — these tests prove the derivation and every
 * honest-degradation path).
 */

import { describe, expect, it } from "bun:test";

import {
  LIVE_STATE_METADATA_KEY,
  LIVE_STARTED_AT_METADATA_KEY,
  LIVE_ENDED_AT_METADATA_KEY,
  LIVE_VIEWER_COUNT_METADATA_KEY,
  liveDesignationOf,
  liveViewerCountIsDeclared,
  NOT_LIVE_DESIGNATION,
  liveChatBadgeLabel,
  liveChatBadgeTone,
} from "../src/live/live-designation";

describe("R37 liveDesignationOf — the connector-metadata derivation", () => {
  it("derives 'not-live' from an item with no metadata (the ordinary catalog item)", () => {
    expect(liveDesignationOf({})).toEqual({ kind: "not-live" });
  });

  it("derives 'not-live' from an empty metadata bag", () => {
    expect(liveDesignationOf({ metadata: {} })).toEqual({ kind: "not-live" });
  });

  it("derives 'not-live' from an unknown liveState value (never a guess into the live surfaces)", () => {
    const designation = liveDesignationOf({
      metadata: { [LIVE_STATE_METADATA_KEY]: "premiere" },
    });
    expect(designation).toEqual({ kind: "not-live" });
  });

  it("derives 'live' with the source-declared figures when the metadata says so", () => {
    const designation = liveDesignationOf({
      metadata: {
        [LIVE_STATE_METADATA_KEY]: "live",
        [LIVE_STARTED_AT_METADATA_KEY]: "2026-09-28T18:00:00.000Z",
        [LIVE_VIEWER_COUNT_METADATA_KEY]: 1247,
      },
    });
    expect(designation).toEqual({
      kind: "live",
      startedAt: "2026-09-28T18:00:00.000Z",
      viewerCount: 1247,
    });
  });

  it("derives 'live' with the typed absences when the source declares no figures", () => {
    const designation = liveDesignationOf({
      metadata: { [LIVE_STATE_METADATA_KEY]: "live" },
    });
    expect(designation).toEqual({ kind: "live", startedAt: null, viewerCount: null });
    expect(liveViewerCountIsDeclared(designation)).toBe(false);
  });

  it("derives the honest viewer-count absence for a malformed figure (never a fabricated number)", () => {
    for (const malformed of [-3, Number.NaN, "many", null]) {
      const designation = liveDesignationOf({
        metadata: {
          [LIVE_STATE_METADATA_KEY]: "live",
          [LIVE_VIEWER_COUNT_METADATA_KEY]: malformed,
        },
      });
      expect(designation.kind).toBe("live");
      if (designation.kind === "live") {
        expect(designation.viewerCount).toBeNull();
        expect(liveViewerCountIsDeclared(designation)).toBe(false);
      }
    }
  });

  it("floors a fractional viewer figure to the integer the source reported", () => {
    const designation = liveDesignationOf({
      metadata: {
        [LIVE_STATE_METADATA_KEY]: "live",
        [LIVE_VIEWER_COUNT_METADATA_KEY]: 1200.9,
      },
    });
    expect(designation).toEqual({ kind: "live", startedAt: null, viewerCount: 1200 });
  });

  it("derives the honest startedAt absence for a malformed instant", () => {
    const designation = liveDesignationOf({
      metadata: {
        [LIVE_STATE_METADATA_KEY]: "live",
        [LIVE_STARTED_AT_METADATA_KEY]: "not-an-instant",
      },
    });
    expect(designation).toEqual({ kind: "live", startedAt: null, viewerCount: null });
  });

  it("derives 'archived-live-vod' with the ended fact of record", () => {
    const designation = liveDesignationOf({
      metadata: {
        [LIVE_STATE_METADATA_KEY]: "archived-live-vod",
        [LIVE_STARTED_AT_METADATA_KEY]: "2026-09-27T09:00:00.000Z",
        [LIVE_ENDED_AT_METADATA_KEY]: "2026-09-27T09:13:00.000Z",
      },
    });
    expect(designation).toEqual({
      kind: "archived-live-vod",
      startedAt: "2026-09-27T09:00:00.000Z",
      endedAt: "2026-09-27T09:13:00.000Z",
    });
  });

  it("an archived-live-vod never carries a live viewer count (the ended stream's honest shape)", () => {
    const designation = liveDesignationOf({
      metadata: {
        [LIVE_STATE_METADATA_KEY]: "archived-live-vod",
        [LIVE_VIEWER_COUNT_METADATA_KEY]: 999,
      },
    });
    expect(designation).toEqual({ kind: "archived-live-vod", startedAt: null, endedAt: null });
    expect(liveViewerCountIsDeclared(designation)).toBe(false);
  });

  it("exposes the shared not-live constant (the ordinary item's truth)", () => {
    expect(NOT_LIVE_DESIGNATION).toEqual({ kind: "not-live" });
  });
});

describe("R37 the badge vocabulary (the closed set + the labels)", () => {
  it("labels every badge (color is never alone — the label always pairs)", () => {
    expect(liveChatBadgeLabel("member")).toBe("Member");
    expect(liveChatBadgeLabel("moderator")).toBe("Moderator");
    expect(liveChatBadgeLabel("verified-creator")).toBe("Verified");
  });

  it("tones every badge (the design-language families)", () => {
    expect(liveChatBadgeTone("member")).toBe("member");
    expect(liveChatBadgeTone("moderator")).toBe("moderator");
    expect(liveChatBadgeTone("verified-creator")).toBe("verified");
  });
});
