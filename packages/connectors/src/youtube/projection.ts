/**
 * @wfx/connectors — YouTube → WebFlix projections (WFX-054, Lane B).
 *
 * PURE functions: documented API shapes (./api.ts) in, frozen contract
 * shapes out (SearchResult / SourceItem / PlaybackRealization /
 * LibraryEntry). No network, no clock, no randomness — the deterministic
 * heart of the connector, unit-tested against the recorded fixtures.
 *
 * Honesty laws implemented here:
 * - PlaybackMode precedence (frozen Media Surface): embed BEFORE external;
 *   native/browser are NEVER produced (the descriptor declares neither).
 *   A video that is not embeddable gets external handoff ONLY — never a
 *   faked embed; a video blocked for the caller's region gets NO
 *   realization (ok-empty, the frozen miss path); a deleted/private video
 *   is a typed not-found (metadata → null, resolve → []).
 * - canonicalType: videos are "video"; a VERTICAL orientation (from
 *   thumbnail dimensions — the only public signal) projects as "short",
 *   with the signal recorded in metadata (metadata.shortsSignal) so the
 *   heuristic is visible, not silent. Search results (no dimensions
 *   available in that response) honestly stay "video" + orientation
 *   "unknown".
 * - durationMs: parsed from the documented ISO-8601 contentDetails.duration
 *   (see parseIso8601DurationMs for the edge cases). Live/upcoming streams
 *   have no fixed duration — durationMs is OMITTED, never guessed from P0D.
 * - Cache-friendliness: every projected item carries the response `etag`
 *   in metadata (YouTube's documented conditional-request token) plus the
 *   raw fields a client needs to build If-None-Match requests.
 */

import type {
  Capability,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
} from "@wfx/domain";

import type {
  YouTubeChannelItem,
  YouTubePlaylistItem,
  YouTubeSearchItem,
  YouTubeThumbnails,
  YouTubeVideoItem,
} from "./api";
import { YOUTUBE_CONNECTOR_ID } from "./descriptor";

// ---------------------------------------------------------------------------
// ISO-8601 duration parsing (contentDetails.duration)
// ---------------------------------------------------------------------------

/**
 * The full ISO-8601 duration grammar YouTube's responses use:
 * P[nY][nW][nD][T[nH][nM][n[.n]S]] — years/weeks/days before the T, H/M/S
 * after. Fractional seconds round to whole milliseconds.
 */
const ISO_8601_DURATION =
  /^P(?=\d|T\d)(\d+Y)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(?:\.\d+)?S)?)?$/;

const UNIT_MS: ReadonlyArray<[RegExp, number]> = [
  [/^(\d+)Y$/, 365 * 24 * 60 * 60 * 1000], // year (approximation — YouTube never emits it)
  [/^(\d+)W$/, 7 * 24 * 60 * 60 * 1000],
  [/^(\d+)D$/, 24 * 60 * 60 * 1000],
  [/^(\d+)H$/, 60 * 60 * 1000],
  [/^(\d+)M$/, 60 * 1000],
  [/^(\d+(?:\.\d+)?)S$/, 1000],
];

/**
 * Parse an ISO-8601 duration into milliseconds.
 *
 * Edge cases (all covered by tests):
 * - "PT1H2M3S" → 3_723_000; "PT58S" → 58_000; "PT0S" → 0
 * - "P1DT2H3M4.5S" → the day carries into the total; fractional seconds
 *   round to milliseconds
 * - "P0D" → 0 (what YouTube returns for LIVE streams — callers decide
 *   whether 0 means "live", see liveBroadcastContent)
 * - "P", "PT", "1H30M" (no P), "PT1H30" (unitless), "" → null (NOT a
 *   throw: an unparseable duration is an honest unknown, never a crash)
 */
export function parseIso8601DurationMs(input: string): number | null {
  if (typeof input !== "string" || input.length === 0) return null;
  const match = ISO_8601_DURATION.exec(input);
  if (match === null) return null;
  let totalMs = 0;
  let matched = false;
  for (const raw of match.slice(1)) {
    if (raw === undefined) continue;
    const unit = UNIT_MS.find(([pattern]) => pattern.test(raw));
    if (unit === undefined) continue;
    const amount = Number.parseFloat((unit[0] as RegExp).exec(raw)?.[1] ?? "0");
    if (!Number.isFinite(amount)) continue;
    totalMs += amount * unit[1];
    matched = true;
  }
  // "P" alone / "PT" alone cannot match the lookahead, but stay defensive:
  // a zero-length duration with no matched units is not a parse.
  return matched ? Math.round(totalMs) : null;
}

/**
 * Parse a YouTube count field (viewCount, likeCount, subscriberCount, …).
 * The API returns decimal strings; commas are tolerated defensively.
 * Absent or non-numeric → undefined (an honest unknown).
 */
export function parseYouTubeCount(input: string | undefined): number | undefined {
  if (typeof input !== "string" || input.length === 0) return undefined;
  const parsed = Number.parseInt(input.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

/** Thumbnail size preference (largest first). */
const THUMBNAIL_PREFERENCE = ["maxres", "standard", "high", "medium", "default"] as const;

/** Pick the best available thumbnail (largest documented size first). */
export function pickThumbnail(
  thumbnails: YouTubeThumbnails,
): { url: string; width?: number; height?: number } | undefined {
  for (const name of THUMBNAIL_PREFERENCE) {
    const entry = thumbnails[name];
    if (entry !== undefined && entry.url.length > 0) return entry;
  }
  return undefined;
}

/** Derive orientation from thumbnail dimensions (the only public signal). */
export function orientationFromThumbnail(
  thumbnail: { width?: number; height?: number } | undefined,
): "horizontal" | "vertical" | "unknown" {
  if (
    thumbnail === undefined ||
    typeof thumbnail.width !== "number" ||
    typeof thumbnail.height !== "number" ||
    thumbnail.width <= 0 ||
    thumbnail.height <= 0
  ) {
    return "unknown";
  }
  return thumbnail.height > thumbnail.width ? "vertical" : "horizontal";
}

// ---------------------------------------------------------------------------
// Search projection
// ---------------------------------------------------------------------------

/** Map one search.list item to a SearchResult (1-based rank added by the caller). */
function searchResultFromItem(item: YouTubeSearchItem, rank: number): SearchResult | null {
  const videoId = item.id.videoId;
  // type=video is requested; a non-video row that slips through is SKIPPED
  // (honest) rather than mis-projected as an item.
  if (videoId === undefined || videoId.length === 0) return null;
  const thumbnail = pickThumbnail(item.snippet.thumbnails);
  const result: SearchResult = {
    connectorId: YOUTUBE_CONNECTOR_ID,
    externalRef: videoId,
    title: item.snippet.title,
    canonicalType: "video",
    orientation: "unknown", // search.list carries no dimensions — honest unknown
    metadata: {
      rank,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail.url } : {}),
      ...(item.snippet.liveBroadcastContent !== undefined
        ? { liveBroadcastContent: item.snippet.liveBroadcastContent }
        : {}),
    },
  };
  return result;
}

/**
 * Project a search.list response page into SearchResults (relevance order,
 * rank = 1-based position, non-video rows skipped — they cannot occur with
 * type=video but are never mis-projected if they do).
 */
export function projectSearchResults(
  response: { items: readonly YouTubeSearchItem[] },
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of response.items) {
    const projected = searchResultFromItem(item, results.length + 1);
    if (projected !== null) results.push(projected);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Video metadata projection
// ---------------------------------------------------------------------------

/** Whether the video's stream is ongoing/upcoming (no fixed duration). */
function isLiveLike(video: YouTubeVideoItem): boolean {
  const live = video.snippet.liveBroadcastContent;
  return live === "live" || live === "upcoming";
}

/**
 * Region restriction truth for a caller region (ISO 3166-1 alpha-2 from
 * ConnectorContext.region, or undefined when the caller gave none):
 * - "unrestricted" — no regionRestriction present
 * - "allowed" / "blocked" — the region is explicitly playable/not playable
 * - "restricted-unknown" — a restriction exists but the caller's region is
 *   unknown (we cannot judge playability — honesty, not a guess)
 */
export function regionRestrictionFor(
  video: YouTubeVideoItem,
  region: string | undefined,
): "unrestricted" | "allowed" | "blocked" | "restricted-unknown" {
  const restriction = video.contentDetails.regionRestriction;
  if (restriction === undefined) return "unrestricted";
  if (region === undefined || region.length === 0) return "restricted-unknown";
  if (restriction.allowed !== undefined) {
    return restriction.allowed.includes(region) ? "allowed" : "blocked";
  }
  if (restriction.blocked !== undefined) {
    return restriction.blocked.includes(region) ? "blocked" : "allowed";
  }
  return "restricted-unknown";
}

/**
 * Per-item availability truth:
 * - unavailable: deleted/rejected upload, private video, or a region
 *   restriction that blocks the caller's region
 * - unknown: a restriction exists but the caller's region is unknown
 * - available: everything else (public/unlisted and playable)
 */
export function videoAvailability(
  video: YouTubeVideoItem,
  region: string | undefined,
): "available" | "unknown" | "unavailable" {
  if (video.status.uploadStatus === "deleted" || video.status.uploadStatus === "rejected") {
    return "unavailable";
  }
  if (video.status.privacyStatus === "private") return "unavailable";
  const restriction = regionRestrictionFor(video, region);
  if (restriction === "blocked") return "unavailable";
  if (restriction === "restricted-unknown") return "unknown";
  return "available";
}

/**
 * Per-item capability truth: which DECLARED connector capabilities apply to
 * THIS video. playEmbed only when status.embeddable; playExternal always
 * (the watch URL exists for any video); like/save are per-item actions on
 * any video; availability is the informational truth. Playability-relevant
 * capabilities are dropped when the video is unavailable.
 */
export function videoItemCapabilities(
  video: YouTubeVideoItem,
  region: string | undefined,
): Capability[] {
  const available = videoAvailability(video, region) !== "unavailable";
  const capabilities: Capability[] = [];
  if (available && video.status.embeddable) capabilities.push("playEmbed");
  if (available) capabilities.push("playExternal");
  capabilities.push("like", "save");
  return capabilities;
}

/**
 * Project a videos.list item into a SourceItem.
 *
 * Enrichments recorded in metadata (cache-friendly, ETag passthrough):
 * etag, channelId/channelTitle, publishedAt, viewCount, likeCount,
 * thumbnailUrl, embeddable, liveBroadcastContent, categoryId, definition,
 * regionRestriction (verbatim), and durationRaw when the ISO-8601 duration
 * did not parse (the honest-unknown marker).
 */
export function projectVideoToSourceItem(
  video: YouTubeVideoItem,
  region: string | undefined,
): SourceItem {
  const thumbnail = pickThumbnail(video.snippet.thumbnails);
  const orientation = orientationFromThumbnail(thumbnail);
  const live = isLiveLike(video);
  const durationMs = parseIso8601DurationMs(video.contentDetails.duration);
  const viewCount = parseYouTubeCount(video.statistics.viewCount);
  const likeCount = parseYouTubeCount(video.statistics.likeCount);

  const metadata: Record<string, unknown> = {
    etag: video.etag,
    channelId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    publishedAt: video.snippet.publishedAt,
    embeddable: video.status.embeddable,
    ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail.url } : {}),
    ...(viewCount !== undefined ? { viewCount } : {}),
    ...(likeCount !== undefined ? { likeCount } : {}),
    ...(video.snippet.liveBroadcastContent !== undefined
      ? { liveBroadcastContent: video.snippet.liveBroadcastContent }
      : {}),
    ...(video.snippet.categoryId !== undefined
      ? { categoryId: video.snippet.categoryId }
      : {}),
    ...(video.contentDetails.definition !== undefined
      ? { definition: video.contentDetails.definition }
      : {}),
    ...(video.contentDetails.regionRestriction !== undefined
      ? { regionRestriction: video.contentDetails.regionRestriction }
      : {}),
  };
  if (durationMs === null && !live) {
    metadata["durationRaw"] = video.contentDetails.duration;
  }
  if (orientation === "vertical") {
    metadata["shortsSignal"] = "vertical-aspect";
  }

  const item: SourceItem = {
    connectorId: YOUTUBE_CONNECTOR_ID,
    externalRef: video.id,
    title: video.snippet.title,
    canonicalType: orientation === "vertical" ? "short" : "video",
    availability: videoAvailability(video, region),
    capabilities: videoItemCapabilities(video, region),
    orientation,
    metadata,
  };
  // durationMs: live/upcoming streams have none (P0D is "ongoing", not a
  // duration); a parsed duration is set; an unparseable one stays omitted.
  if (!live && durationMs !== null) {
    item.durationMs = durationMs;
  }
  return item;
}

// ---------------------------------------------------------------------------
// Playback realization projection
// ---------------------------------------------------------------------------

/**
 * Project a videos.list item into playback realizations, ordered by the
 * frozen Media Surface precedence (embed before external; native/browser
 * are undeclared and therefore NEVER produced — no faked modes).
 *
 * - Region-blocked / deleted / private video → [] (the frozen ok-empty
 *   miss path — a typed not-found for the caller).
 * - Embeddable → [embed (iframe pattern), external (watch URL)].
 * - Not embeddable → [external] — the honest handoff, never a fake embed.
 */
export function projectRealizations(
  video: YouTubeVideoItem,
  region: string | undefined,
): PlaybackRealization[] {
  if (videoAvailability(video, region) === "unavailable") return [];
  const realizations: PlaybackRealization[] = [];
  if (video.status.embeddable) {
    realizations.push({
      mode: "embed",
      connectorId: YOUTUBE_CONNECTOR_ID,
      url: `https://www.youtube.com/embed/${video.id}`,
      externalRef: video.id,
      capabilities: ["playEmbed"],
    });
  }
  realizations.push({
    mode: "external",
    connectorId: YOUTUBE_CONNECTOR_ID,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    externalRef: video.id,
    capabilities: ["playExternal"],
  });
  return realizations;
}

// ---------------------------------------------------------------------------
// Channel projection (enrichment — a channel is NOT an EntertainmentItem)
// ---------------------------------------------------------------------------

/**
 * A channel summary — the honest shape for channel metadata: channels are
 * not projected into the frozen EntertainmentItem canonical types; they
 * enrich item metadata and power host-side channel surfaces.
 */
export interface YouTubeChannelSummary {
  readonly channelId: string;
  readonly title: string;
  readonly description: string;
  readonly customUrl?: string;
  readonly publishedAt?: string;
  readonly country?: string;
  readonly subscriberCount?: number;
  readonly videoCount?: number;
  readonly viewCount?: number;
  readonly thumbnailUrl?: string;
  readonly uploadsPlaylistId?: string;
  readonly etag: string;
}

/** Project a channels.list item into a channel summary. */
export function projectChannel(channel: YouTubeChannelItem): YouTubeChannelSummary {
  const thumbnail = pickThumbnail(channel.snippet.thumbnails);
  const subscriberCount = parseYouTubeCount(channel.statistics.subscriberCount);
  const videoCount = parseYouTubeCount(channel.statistics.videoCount);
  const viewCount = parseYouTubeCount(channel.statistics.viewCount);
  const summary: YouTubeChannelSummary = {
    channelId: channel.id,
    title: channel.snippet.title,
    description: channel.snippet.description,
    ...(channel.snippet.customUrl !== undefined ? { customUrl: channel.snippet.customUrl } : {}),
    ...(channel.snippet.publishedAt !== undefined
      ? { publishedAt: channel.snippet.publishedAt }
      : {}),
    ...(channel.snippet.country !== undefined ? { country: channel.snippet.country } : {}),
    ...(subscriberCount !== undefined ? { subscriberCount } : {}),
    ...(videoCount !== undefined ? { videoCount } : {}),
    ...(viewCount !== undefined ? { viewCount } : {}),
    ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail.url } : {}),
    ...(channel.contentDetails.relatedPlaylists.uploads !== undefined
      ? { uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads }
      : {}),
    etag: channel.etag,
  };
  return summary;
}

// ---------------------------------------------------------------------------
// Playlist-item (library) projection
// ---------------------------------------------------------------------------

/**
 * Project playlistItems.list rows into LibraryEntries (externalRef = the
 * VIDEO id — the connector's item universe; the playlistItem id rides in
 * metadata for later removal).
 */
export function projectPlaylistItems(
  items: readonly YouTubePlaylistItem[],
): LibraryEntry[] {
  return items.map((item) => {
    const thumbnail =
      item.snippet.thumbnails === undefined ? undefined : pickThumbnail(item.snippet.thumbnails);
    const entry: LibraryEntry = {
      connectorId: YOUTUBE_CONNECTOR_ID,
      externalRef: item.contentDetails.videoId,
      title: item.snippet.title,
      ...(item.snippet.publishedAt.length > 0 ? { addedAt: item.snippet.publishedAt } : {}),
      metadata: {
        playlistItemId: item.id,
        playlistId: item.snippet.playlistId,
        position: item.snippet.position,
        channelTitle: item.snippet.channelTitle,
        ...(thumbnail !== undefined ? { thumbnailUrl: thumbnail.url } : {}),
        ...(item.contentDetails.videoPublishedAt !== undefined
          ? { videoPublishedAt: item.contentDetails.videoPublishedAt }
          : {}),
      },
    };
    return entry;
  });
}
