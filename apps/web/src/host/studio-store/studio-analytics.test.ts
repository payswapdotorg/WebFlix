/**
 * R38-B — THE STUDIO ANALYTICS LANE TESTS (the honest backing map —
 * apps/web/src/host/studio-store/studio-analytics.ts).
 *
 * Proves the HONEST-ANALYTICS LAW (the task packet, binding): "every
 * metric without honest backing renders the TYPED ABSENCE state —
 * never a fabricated chart, never a seeded number, never a fake axis."
 *
 * - REACH: impressions are ALWAYS the typed absence (no impression
 *   transport exists on this host — the absence is structural, never a
 *   number); your own view is the watch-fold truth (real when present,
 *   the honest "not watched by you yet" absence otherwise);
 * - ENGAGEMENT: the comments count / your reaction / your saves are
 *   the real local truths (the same records the watch surface and the
 *   library render);
 * - AUDIENCE: the subscriber count and demographics are ALWAYS typed
 *   absences (the R36 law — never fabricated); your own subscription
 *   truth is the real datum;
 * - THE CHANNEL AGGREGATES: the sums of the real per-video truths —
 *   and ONLY those (every other channel metric is an absence).
 */

import { describe, expect, it } from "bun:test";

import {
  ANALYTICS_ABSENCE_NOTES,
  channelAnalyticsOf,
  videoAnalyticsRowOf,
  type LocalItemTruths,
} from "./studio-analytics";
import type { StudioChannelView, StudioItemSummary } from "./studio-views";

/** One item summary (the view's own shape, constructed for the law). */
function itemOf(overrides: Partial<StudioItemSummary> = {}): StudioItemSummary {
  return {
    itemId: "wfxitm_00000000000000000000000001",
    title: "Deep Field Diary",
    canonicalType: "video",
    durationMs: 1_800_000,
    connectorId: "fake-source",
    externalRef: "fake:video-1",
    publishedAt: null,
    viewCount: null,
    isShort: false,
    resume: null,
    ...overrides,
  };
}

/** One channel view (the minimal shape the composition consumes). */
function channelOf(items: readonly StudioItemSummary[], subscribed: boolean): StudioChannelView {
  return {
    mode: "fixtures",
    identity: {
      connectorId: "fake-source",
      handle: "fake-source",
      displayName: "Fake Source (TEST FIXTURE — never production)",
      avatarMark: "F",
      avatarNote: "the monogram note",
      banner: { state: "absent", note: "the banner absence note" },
      description: "the description absence note",
      descriptionDeclared: false,
    },
    items,
    stats: { videoCount: items.filter((i) => !i.isShort).length, shortsCount: items.filter((i) => i.isShort).length, playlistCount: 0 },
    subscribed,
  };
}

const NO_LOCAL: LocalItemTruths = { commentsCount: 0, yourReaction: null };

describe("R38-B analytics — REACH (the honest backing map)", () => {
  it("renders impressions as the STRUCTURAL typed absence (never a number, on any input)", () => {
    const row = videoAnalyticsRowOf(itemOf(), NO_LOCAL, undefined);
    expect(row.reach.impressions.kind).toBe("absent");
    expect(row.reach.impressions.note).toBe(ANALYTICS_ABSENCE_NOTES.impressions);
    // Even an item WITH a source-declared viewCount renders the absence:
    // no transport counts THIS host's impressions (the declared count is
    // the source's own datum, not an impression transport).
    const declared = videoAnalyticsRowOf(itemOf({ viewCount: 1234 }), NO_LOCAL, undefined);
    expect(declared.reach.impressions.kind).toBe("absent");
  });

  it("renders your own view as the watch-fold truth (real when present, the honest absence otherwise)", () => {
    const watched = videoAnalyticsRowOf(
      itemOf({ resume: { positionMs: 900_000, completionRatio: 0.5 } }),
      NO_LOCAL,
      undefined,
    );
    expect(watched.reach.yourView.kind).toBe("real");
    if (watched.reach.yourView.kind === "real") {
      expect(watched.reach.yourView.value.completionRatio).toBe(0.5);
    }
    const notWatched = videoAnalyticsRowOf(itemOf(), NO_LOCAL, undefined);
    expect(notWatched.reach.yourView.kind).toBe("absent");
    expect(notWatched.reach.yourView.note).toBe(ANALYTICS_ABSENCE_NOTES.yourViewNone);
  });
});

describe("R38-B analytics — ENGAGEMENT (the real local wallet)", () => {
  it("carries the real comments count, your own reaction, and your library saves", () => {
    const row = videoAnalyticsRowOf(
      itemOf(),
      { commentsCount: 3, yourReaction: "like" },
      { listNames: ["Saved", "Rewatch list"] },
    );
    expect(row.engagement.comments.kind === "real" && row.engagement.comments.value).toBe(3);
    expect(row.engagement.yourReaction.kind === "real" && row.engagement.yourReaction.value).toBe("like");
    expect(row.engagement.saves.kind === "real" && row.engagement.saves.value).toEqual(["Saved", "Rewatch list"]);
  });

  it("renders the honest absences when no local truth exists (never a zero-count fabrication)", () => {
    const row = videoAnalyticsRowOf(itemOf(), NO_LOCAL, undefined);
    // Comments stay REAL (the honest zero — the store's own truth).
    expect(row.engagement.comments.kind === "real" && row.engagement.comments.value).toBe(0);
    expect(row.engagement.yourReaction.kind).toBe("absent");
    expect(row.engagement.saves.kind).toBe("absent");
  });
});

describe("R38-B analytics — AUDIENCE (the R36 law verbatim)", () => {
  it("renders the subscriber count and demographics as the structural absences", () => {
    const view = channelOf([itemOf()], true);
    const panel = channelAnalyticsOf(view, {}, {});
    expect(panel.audience.subscribers.kind).toBe("absent");
    expect(panel.audience.subscribers.note).toBe(ANALYTICS_ABSENCE_NOTES.subscribers);
    expect(panel.audience.demographics.kind).toBe("absent");
    expect(panel.audience.demographics.note).toBe(ANALYTICS_ABSENCE_NOTES.demographics);
  });

  it("carries your own subscription truth (the one real audience datum)", () => {
    const subscribed = channelAnalyticsOf(channelOf([itemOf()], true), {}, {});
    expect(subscribed.audience.youSubscribed.kind === "real" && subscribed.audience.youSubscribed.value).toBe(true);
    const notSubscribed = channelAnalyticsOf(channelOf([itemOf()], false), {}, {});
    expect(notSubscribed.audience.youSubscribed.kind === "real" && notSubscribed.audience.youSubscribed.value).toBe(false);
  });
});

describe("R38-B analytics — the channel aggregates (sums of the real truths only)", () => {
  it("sums the real per-video truths across the channel", () => {
    const items = [
      itemOf({ itemId: "wfxitm_00000000000000000000000001", resume: { positionMs: 1, completionRatio: null } }),
      itemOf({ itemId: "wfxitm_00000000000000000000000002" }),
      itemOf({ itemId: "wfxitm_00000000000000000000000003", resume: { positionMs: 2, completionRatio: 0.1 } }),
    ];
    const locals: Record<string, LocalItemTruths> = {
      "wfxitm_00000000000000000000000001": { commentsCount: 2, yourReaction: "like" },
      "wfxitm_00000000000000000000000002": { commentsCount: 1, yourReaction: null },
      "wfxitm_00000000000000000000000003": { commentsCount: 0, yourReaction: "dislike" },
    };
    const saves = {
      "wfxitm_00000000000000000000000002": { listNames: ["Saved"] },
    };
    const panel = channelAnalyticsOf(channelOf(items, false), locals, saves);
    expect(panel.totalComments.value).toBe(3);
    expect(panel.yourReactions.value).toBe(2);
    expect(panel.yourSaves.value).toBe(1);
    expect(panel.yourViews.value).toBe(2);
  });

  it("renders the honest zeros on an untouched record (never seeded numbers)", () => {
    const panel = channelAnalyticsOf(channelOf([itemOf()], false), {}, {});
    expect(panel.totalComments.value).toBe(0);
    expect(panel.yourReactions.value).toBe(0);
    expect(panel.yourSaves.value).toBe(0);
    expect(panel.yourViews.value).toBe(0);
  });
});
