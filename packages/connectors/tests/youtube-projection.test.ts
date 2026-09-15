/**
 * WFX-054 — YouTube projection tests: the PURE API-shape → frozen-contract
 * mapping. Duration parsing edge cases, counts, thumbnails/orientation,
 * availability truth, PlaybackMode precedence (the honest embeddability
 * mapping), channel summaries, and playlist-item projections.
 */

import { describe, expect, it } from "bun:test";

import {
  FIXTURE_CHANNEL,
  FIXTURE_CHANNEL_ID,
  FIXTURE_PLAYLIST_ITEMS_LIKED,
  FIXTURE_SEARCH_PAGE_1,
  FIXTURE_SEARCH_PAGE_2,
  FIXTURE_VIDEOS_DELETED,
  FIXTURE_VIDEOS_DOCUMENTARY,
  FIXTURE_VIDEOS_LIVE,
  FIXTURE_VIDEOS_NOT_EMBEDDABLE,
  FIXTURE_VIDEOS_PRIVATE,
  FIXTURE_VIDEOS_REGION_BLOCKED,
  FIXTURE_VIDEOS_SHORT,
  FIXTURE_VIDEO_IDS,
  orientationFromThumbnail,
  parseIso8601DurationMs,
  parseYouTubeCount,
  pickThumbnail,
  projectChannel,
  projectPlaylistItems,
  projectRealizations,
  projectSearchResults,
  projectVideoToSourceItem,
  regionRestrictionFor,
  videoAvailability,
  videoItemCapabilities,
  YOUTUBE_CONNECTOR_ID,
} from "../src/index";

function firstVideo(fixture: typeof FIXTURE_VIDEOS_DOCUMENTARY) {
  const video = fixture.items[0];
  if (video === undefined) throw new Error("fixture must carry one video");
  return video;
}

describe("parseIso8601DurationMs (contentDetails.duration)", () => {
  it("parses the documented grammar exactly", () => {
    expect(parseIso8601DurationMs("PT1H2M3S")).toBe(3_723_000);
    expect(parseIso8601DurationMs("PT58S")).toBe(58_000);
    expect(parseIso8601DurationMs("PT0S")).toBe(0);
    expect(parseIso8601DurationMs("P0D")).toBe(0); // live streams
    expect(parseIso8601DurationMs("PT45S")).toBe(45_000);
    expect(parseIso8601DurationMs("P1DT2H3M4.5S")).toBe(
      24 * 3600 * 1000 + 2 * 3600 * 1000 + 3 * 60 * 1000 + 4500,
    );
    expect(parseIso8601DurationMs("PT4M1S")).toBe(241_000);
    expect(parseIso8601DurationMs("PT1M")).toBe(60_000);
    expect(parseIso8601DurationMs("P2W")).toBe(14 * 24 * 3600 * 1000);
    expect(parseIso8601DurationMs("PT0.5S")).toBe(500);
  });

  it("returns null (never throws) for malformed durations — honest unknowns", () => {
    for (const bad of ["", "P", "PT", "1H30M", "PT1H30", "PT1H2M3S4X", "P1S", "garbage"]) {
      expect(parseIso8601DurationMs(bad)).toBeNull();
    }
  });

  it("rounds fractional seconds to whole milliseconds", () => {
    expect(parseIso8601DurationMs("PT1.234S")).toBe(1234);
    expect(parseIso8601DurationMs("PT1.2345S")).toBe(1235); // rounds half up
  });
});

describe("parseYouTubeCount (string statistics)", () => {
  it("parses decimal strings, tolerating stray commas", () => {
    expect(parseYouTubeCount("1234567")).toBe(1_234_567);
    expect(parseYouTubeCount("42")).toBe(42);
    expect(parseYouTubeCount("1,234,567")).toBe(1_234_567);
    expect(parseYouTubeCount("0")).toBe(0);
  });

  it("returns undefined for absent/non-numeric/negative values", () => {
    expect(parseYouTubeCount(undefined)).toBeUndefined();
    expect(parseYouTubeCount("")).toBeUndefined();
    expect(parseYouTubeCount("abc")).toBeUndefined();
    expect(parseYouTubeCount("-5")).toBeUndefined();
  });
});

describe("thumbnails + orientation", () => {
  it("prefers the largest documented size", () => {
    const thumbnails = {
      default: { url: "https://example/default.jpg", width: 120, height: 90 },
      medium: { url: "https://example/mq.jpg", width: 320, height: 180 },
      maxres: { url: "https://example/max.jpg", width: 1280, height: 720 },
    };
    expect(pickThumbnail(thumbnails)?.url).toBe("https://example/max.jpg");
    expect(pickThumbnail({}) ).toBeUndefined();
  });

  it("derives orientation from dimensions (the only public signal)", () => {
    expect(orientationFromThumbnail({ width: 1280, height: 720 })).toBe("horizontal");
    expect(orientationFromThumbnail({ width: 1080, height: 1920 })).toBe("vertical");
    expect(orientationFromThumbnail({ width: 100, height: 100 })).toBe("horizontal");
    expect(orientationFromThumbnail(undefined)).toBe("unknown");
    expect(orientationFromThumbnail({ width: 0, height: 100 })).toBe("unknown");
    expect(orientationFromThumbnail({ width: 100 })).toBe("unknown");
  });
});

describe("projectSearchResults", () => {
  it("projects relevance order with 1-based ranks and honest unknowns", () => {
    const results = projectSearchResults(FIXTURE_SEARCH_PAGE_1);
    expect(results).toHaveLength(3);
    expect(results[0]?.externalRef).toBe(FIXTURE_VIDEO_IDS.documentary);
    expect(results[0]?.metadata?.["rank"]).toBe(1);
    expect(results[2]?.metadata?.["rank"]).toBe(3);
    for (const result of results) {
      expect(result.connectorId).toBe(YOUTUBE_CONNECTOR_ID);
      expect(result.canonicalType).toBe("video");
      expect(result.orientation).toBe("unknown"); // no dimensions in search.list
      expect(typeof result.title).toBe("string");
    }
    expect(results[0]?.metadata?.["channelId"]).toBe(FIXTURE_CHANNEL_ID);
    expect(results[0]?.metadata?.["thumbnailUrl"]).toContain("i.ytimg.com");
  });

  it("keeps rank numbering across skips (a non-video row is skipped, never mis-projected)", () => {
    const withChannelRow = {
      ...FIXTURE_SEARCH_PAGE_1,
      items: [
        ...FIXTURE_SEARCH_PAGE_1.items,
        {
          kind: "youtube#searchResult" as const,
          etag: "e",
          id: { kind: "youtube#channel", channelId: "UC-something" },
          snippet: FIXTURE_SEARCH_PAGE_1.items[0]?.snippet as never,
        },
      ],
    };
    const results = projectSearchResults(withChannelRow);
    expect(results).toHaveLength(3);
    expect(results[2]?.metadata?.["rank"]).toBe(3);
  });

  it("projects page 2 identically (deterministic pagination shape)", () => {
    const results = projectSearchResults(FIXTURE_SEARCH_PAGE_2);
    expect(results).toHaveLength(2);
    expect(results[0]?.externalRef).toBe(FIXTURE_VIDEO_IDS.regionBlocked);
    expect(results[1]?.metadata?.["rank"]).toBe(2);
    expect(results[1]?.metadata?.["liveBroadcastContent"]).toBe("live");
  });
});

describe("regionRestrictionFor + videoAvailability (per-item truth)", () => {
  it("unrestricted videos are available everywhere", () => {
    const video = firstVideo(FIXTURE_VIDEOS_DOCUMENTARY);
    expect(regionRestrictionFor(video, undefined)).toBe("unrestricted");
    expect(regionRestrictionFor(video, "DE")).toBe("unrestricted");
    expect(videoAvailability(video, "DE")).toBe("available");
    expect(videoAvailability(video, undefined)).toBe("available");
  });

  it("blocked-list semantics: blocked in listed regions, allowed elsewhere", () => {
    const video = firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED);
    expect(regionRestrictionFor(video, "DE")).toBe("blocked");
    expect(regionRestrictionFor(video, "FR")).toBe("blocked");
    expect(regionRestrictionFor(video, "US")).toBe("allowed");
    expect(videoAvailability(video, "DE")).toBe("unavailable");
    expect(videoAvailability(video, "US")).toBe("available");
    // Unknown caller region + a restriction present = honest unknown.
    expect(regionRestrictionFor(video, undefined)).toBe("restricted-unknown");
    expect(videoAvailability(video, undefined)).toBe("unknown");
  });

  it("allowed-list semantics: allowed ONLY in listed regions", () => {
    const video = firstVideo({
      ...FIXTURE_VIDEOS_REGION_BLOCKED,
      items: [
        {
          ...firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED),
          contentDetails: {
            ...firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED).contentDetails,
            regionRestriction: { allowed: ["US", "CA"] },
          },
        },
      ],
    });
    expect(regionRestrictionFor(video, "US")).toBe("allowed");
    expect(regionRestrictionFor(video, "DE")).toBe("blocked");
    expect(videoAvailability(video, "DE")).toBe("unavailable");
  });

  it("private and deleted videos are unavailable", () => {
    expect(videoAvailability(firstVideo(FIXTURE_VIDEOS_PRIVATE), undefined)).toBe(
      "unavailable",
    );
    expect(videoAvailability(firstVideo(FIXTURE_VIDEOS_DELETED), undefined)).toBe(
      "unavailable",
    );
  });
});

describe("projectVideoToSourceItem (rich metadata)", () => {
  it("projects the documentary: duration, counts, ETag, thumbnails", () => {
    const item = projectVideoToSourceItem(firstVideo(FIXTURE_VIDEOS_DOCUMENTARY), undefined);
    expect(item.connectorId).toBe(YOUTUBE_CONNECTOR_ID);
    expect(item.externalRef).toBe(FIXTURE_VIDEO_IDS.documentary);
    expect(item.title).toBe("Desert Rain — A Night Documentary");
    expect(item.canonicalType).toBe("video");
    expect(item.orientation).toBe("horizontal");
    expect(item.availability).toBe("available");
    expect(item.durationMs).toBe(3_723_000);
    expect(item.metadata?.["viewCount"]).toBe(1_234_567);
    expect(item.metadata?.["likeCount"]).toBe(42);
    expect(item.metadata?.["etag"]).toBe("fixture-etag-video-docu");
    expect(item.metadata?.["embeddable"]).toBe(true);
    expect(item.metadata?.["thumbnailUrl"]).toContain("maxresdefault.jpg");
    expect(item.metadata?.["channelId"]).toBe(FIXTURE_CHANNEL_ID);
    expect(item.metadata?.["categoryId"]).toBe("27");
  });

  it("projects a vertical video as canonicalType short with a VISIBLE heuristic marker", () => {
    const item = projectVideoToSourceItem(firstVideo(FIXTURE_VIDEOS_SHORT), undefined);
    expect(item.canonicalType).toBe("short");
    expect(item.orientation).toBe("vertical");
    expect(item.durationMs).toBe(45_000);
    expect(item.metadata?.["shortsSignal"]).toBe("vertical-aspect");
  });

  it("omits durationMs for live/upcoming streams (P0D is ongoing, not a duration)", () => {
    const item = projectVideoToSourceItem(firstVideo(FIXTURE_VIDEOS_LIVE), undefined);
    expect(item.durationMs).toBeUndefined();
    expect(item.metadata?.["liveBroadcastContent"]).toBe("live");
    expect(item.metadata?.["durationRaw"]).toBeUndefined(); // live: no honest-unknown marker either
  });

  it("records durationRaw when a non-live duration fails to parse (honest unknown)", () => {
    const video = firstVideo({
      ...FIXTURE_VIDEOS_DOCUMENTARY,
      items: [
        {
          ...firstVideo(FIXTURE_VIDEOS_DOCUMENTARY),
          contentDetails: {
            ...firstVideo(FIXTURE_VIDEOS_DOCUMENTARY).contentDetails,
            duration: "PT1H30", // malformed — unitless minutes
          },
        },
      ],
    });
    const item = projectVideoToSourceItem(video, undefined);
    expect(item.durationMs).toBeUndefined();
    expect(item.metadata?.["durationRaw"]).toBe("PT1H30");
  });

  it("carries regionRestriction verbatim for cache-friendly client logic", () => {
    const item = projectVideoToSourceItem(firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED), "DE");
    expect(item.availability).toBe("unavailable");
    expect(item.metadata?.["regionRestriction"]).toEqual({ blocked: ["DE", "FR"] });
  });

  it("per-item capabilities: playEmbed only when embeddable AND available", () => {
    const embeddable = videoItemCapabilities(firstVideo(FIXTURE_VIDEOS_DOCUMENTARY), "US");
    expect(embeddable).toContain("playEmbed");
    expect(embeddable).toContain("playExternal");
    expect(embeddable).toContain("like");
    expect(embeddable).toContain("save");
    expect(embeddable).not.toContain("playNative");
    expect(embeddable).not.toContain("comment");

    const notEmbeddable = videoItemCapabilities(
      firstVideo(FIXTURE_VIDEOS_NOT_EMBEDDABLE),
      "US",
    );
    expect(notEmbeddable).not.toContain("playEmbed");
    expect(notEmbeddable).toContain("playExternal");

    const blocked = videoItemCapabilities(firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED), "DE");
    expect(blocked).not.toContain("playEmbed");
    expect(blocked).not.toContain("playExternal");
    expect(blocked).toContain("like"); // actions exist even for unplayable items
  });
});

describe("projectRealizations (the honest PlaybackMode mapping)", () => {
  it("embeddable → [embed (iframe pattern), external (watch URL)] in frozen precedence order", () => {
    const realizations = projectRealizations(firstVideo(FIXTURE_VIDEOS_DOCUMENTARY), "US");
    expect(realizations).toHaveLength(2);
    expect(realizations[0]?.mode).toBe("embed");
    expect(realizations[0]?.url).toBe("https://www.youtube.com/embed/Wfx54Docu001");
    expect(realizations[0]?.capabilities).toEqual(["playEmbed"]);
    expect(realizations[1]?.mode).toBe("external");
    expect(realizations[1]?.url).toBe("https://www.youtube.com/watch?v=Wfx54Docu001");
    for (const realization of realizations) {
      expect(realization.connectorId).toBe(YOUTUBE_CONNECTOR_ID);
      expect(realization.externalRef).toBe(FIXTURE_VIDEO_IDS.documentary);
    }
  });

  it("NOT embeddable → external handoff ONLY (never a faked embed)", () => {
    const realizations = projectRealizations(firstVideo(FIXTURE_VIDEOS_NOT_EMBEDDABLE), "US");
    expect(realizations).toHaveLength(1);
    expect(realizations[0]?.mode).toBe("external");
  });

  it("region-blocked-for-caller → [] (the typed miss path)", () => {
    expect(projectRealizations(firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED), "DE")).toEqual([]);
    expect(projectRealizations(firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED), "FR")).toEqual([]);
  });

  it("region-restricted but caller allowed/unknown → realizations still produced", () => {
    expect(projectRealizations(firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED), "US")).toHaveLength(2);
    expect(projectRealizations(firstVideo(FIXTURE_VIDEOS_REGION_BLOCKED), undefined)).toHaveLength(2);
  });

  it("private/deleted → [] (typed not-found at the resolve surface)", () => {
    expect(projectRealizations(firstVideo(FIXTURE_VIDEOS_PRIVATE), undefined)).toEqual([]);
    expect(projectRealizations(firstVideo(FIXTURE_VIDEOS_DELETED), undefined)).toEqual([]);
  });

  it("never produces native or browser modes (undeclared = never fabricated)", () => {
    for (const fixture of [
      FIXTURE_VIDEOS_DOCUMENTARY,
      FIXTURE_VIDEOS_SHORT,
      FIXTURE_VIDEOS_LIVE,
      FIXTURE_VIDEOS_NOT_EMBEDDABLE,
    ]) {
      for (const realization of projectRealizations(firstVideo(fixture), "US")) {
        expect(realization.mode === "embed" || realization.mode === "external").toBe(true);
      }
    }
  });
});

describe("projectChannel (channel summary enrichment)", () => {
  it("projects the documented channel shape", () => {
    const channel = FIXTURE_CHANNEL.items[0];
    if (channel === undefined) throw new Error("unreachable");
    const summary = projectChannel(channel);
    expect(summary.channelId).toBe(FIXTURE_CHANNEL_ID);
    expect(summary.title).toBe("WebFlix Fixture Channel");
    expect(summary.customUrl).toBe("@webflixfixture");
    expect(summary.subscriberCount).toBe(25_000);
    expect(summary.videoCount).toBe(42);
    expect(summary.viewCount).toBe(1_000_000);
    expect(summary.uploadsPlaylistId).toBe("UU" + FIXTURE_CHANNEL_ID.slice(2));
    expect(summary.etag).toBe("fixture-etag-channel-item");
  });
});

describe("projectPlaylistItems (library projection)", () => {
  it("projects playlist rows with externalRef = VIDEO id and the item id in metadata", () => {
    const entries = projectPlaylistItems(FIXTURE_PLAYLIST_ITEMS_LIKED.items);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.connectorId).toBe(YOUTUBE_CONNECTOR_ID);
    expect(entries[0]?.externalRef).toBe(FIXTURE_VIDEO_IDS.documentary);
    expect(entries[0]?.title).toBe("Desert Rain — A Night Documentary");
    expect(entries[0]?.addedAt).toBe("2026-09-10T10:00:00Z");
    expect(entries[0]?.metadata?.["playlistItemId"]).toBe("FIXTURE_PLITEM_1");
    expect(entries[0]?.metadata?.["playlistId"]).toBe("LL");
    expect(entries[0]?.metadata?.["position"]).toBe(0);
    expect(entries[0]?.metadata?.["videoPublishedAt"]).toBe("2025-03-14T09:00:00Z");
  });
});
