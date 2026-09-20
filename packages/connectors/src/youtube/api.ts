/**
 * @wfx/connectors — the typed YouTube Data API v3 client (WFX-054, Lane B).
 *
 * Pure functions over the injected `YouTubeHttpTransport` — no global state,
 * no hidden fetch, no provider SDK. Each function:
 *
 * 1. builds the documented request (endpoint, parts, params — see the
 *    per-function docs for why each part is requested);
 * 2. authenticates with an OAuth access token when present, ELSE the
 *    project API key (the documented dual-auth model for public data);
 * 3. validates the response against the DOCUMENTED API shape (typed
 *    `malformed-response` on drift — never trusted blindly, never faked);
 * 4. throws the classified `YouTubeApiError` on failure (the closed
 *    taxonomy from ./errors.ts; the connector maps it onto the SDK's
 *    ConnectorError vocabulary).
 *
 * Quota truth lives in ./quota.ts — every function's cost is named there
 * and repeated in its doc comment. Endpoint root:
 * https://www.googleapis.com/youtube/v3
 */

import { isRecord } from "@wfx/domain";

import {
  classifyYouTubeHttpStatus,
  classifyYouTubeTransportFailure,
  youTubeMalformedResponse,
} from "./errors";
import type { YouTubeHttpTransport, YouTubeHttpReply } from "./http";

/** The documented YouTube Data API v3 endpoint root. */
export const YOUTUBE_API_ROOT = "https://www.googleapis.com/youtube/v3";

/** Per-call authentication: OAuth access token (preferred) or API key. */
export interface YouTubeCallAuth {
  readonly accessToken?: string;
  readonly apiKey?: string;
}

// ---------------------------------------------------------------------------
// Documented response shapes (the subset the connector consumes)
// ---------------------------------------------------------------------------

/** A thumbnail entry: url plus optional dimensions. */
export interface YouTubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export type YouTubeThumbnails = Record<string, YouTubeThumbnail>;

/** search.list item (part=snippet; type=video enforced by the connector). */
export interface YouTubeSearchItem {
  kind: "youtube#searchResult";
  etag: string;
  id: { kind: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    channelTitle: string;
    thumbnails: YouTubeThumbnails;
    liveBroadcastContent?: string;
    publishTime?: string;
  };
}

/** search.list response (one page). */
export interface YouTubeSearchListResponse {
  kind: "youtube#searchListResponse";
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: { totalResults?: number; resultsPerPage?: number };
  items: YouTubeSearchItem[];
}

/** videos.list item with the parts the connector requests. */
export interface YouTubeVideoItem {
  kind: "youtube#video";
  etag: string;
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    channelTitle: string;
    thumbnails: YouTubeThumbnails;
    categoryId?: string;
    liveBroadcastContent?: string;
    tags?: string[];
  };
  contentDetails: {
    duration: string;
    dimension?: string;
    definition?: string;
    caption?: string;
    licensedContent?: boolean;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    projection?: string;
  };
  status: {
    uploadStatus?: string;
    privacyStatus?: "public" | "private" | "unlisted";
    license?: string;
    embeddable: boolean;
    publicStatsViewable?: boolean;
    madeForKids?: boolean;
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    dislikeCount?: string;
    favoriteCount?: string;
    commentCount?: string;
  };
}

/** videos.list response. */
export interface YouTubeVideoListResponse {
  kind: "youtube#videoListResponse";
  etag: string;
  items: YouTubeVideoItem[];
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
}

/** channels.list item (snippet, statistics, contentDetails). */
export interface YouTubeChannelItem {
  kind: "youtube#channel";
  etag: string;
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    publishedAt?: string;
    thumbnails: YouTubeThumbnails;
    country?: string;
  };
  statistics: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  contentDetails: {
    relatedPlaylists: { likes?: string; uploads?: string };
  };
}

/** channels.list response. */
export interface YouTubeChannelListResponse {
  kind: "youtube#channelListResponse";
  etag: string;
  items: YouTubeChannelItem[];
}

/** playlistItems.list item (snippet + contentDetails). */
export interface YouTubePlaylistItem {
  kind: "youtube#playlistItem";
  etag: string;
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    channelTitle: string;
    playlistId: string;
    position: number;
    resourceId: { kind: string; videoId: string };
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails: {
    videoId: string;
    videoPublishedAt?: string;
  };
}

/** playlistItems.list response (one page). */
export interface YouTubePlaylistItemListResponse {
  kind: "youtube#playlistItemListResponse";
  etag: string;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items: YouTubePlaylistItem[];
}

/** playlistItems.insert response (the created item). */
export interface YouTubePlaylistItemInsertResponse {
  kind: "youtube#playlistItem";
  etag: string;
  id: string;
  snippet: YouTubePlaylistItem["snippet"];
  contentDetails: YouTubePlaylistItem["contentDetails"];
}

// ---------------------------------------------------------------------------
// Transport plumbing (shared)
// ---------------------------------------------------------------------------

async function callApi(
  transport: YouTubeHttpTransport,
  request: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    query: Record<string, string>;
    auth: YouTubeCallAuth;
    body?: string;
  },
): Promise<YouTubeHttpReply> {
  const query = new URLSearchParams(request.query);
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.auth.accessToken !== undefined && request.auth.accessToken.length > 0) {
    headers["authorization"] = `Bearer ${request.auth.accessToken}`;
  } else if (request.auth.apiKey !== undefined && request.auth.apiKey.length > 0) {
    query.set("key", request.auth.apiKey);
  } else {
    throw youTubeMalformedResponse(
      "no authentication available: pass an accessToken or apiKey for every YouTube API call",
    );
  }
  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const url = `${YOUTUBE_API_ROOT}${request.path}?${query.toString()}`;
  let reply: YouTubeHttpReply;
  try {
    reply = await transport.request({
      method: request.method,
      url,
      headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
    });
  } catch (thrown) {
    throw classifyYouTubeTransportFailure(thrown);
  }
  if (reply.status < 200 || reply.status >= 300) {
    throw classifyYouTubeHttpStatus(reply.status, reply.bodyText);
  }
  return reply;
}

/** Parse a JSON API body, throwing the typed malformed-response error on drift. */
function parseJsonBody(reply: YouTubeHttpReply, what: string): unknown {
  try {
    return JSON.parse(reply.bodyText);
  } catch {
    throw youTubeMalformedResponse(`${what} response is not JSON`);
  }
}

function expectRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw youTubeMalformedResponse(`${what} is not an object`);
  }
  return value;
}

function expectStringArray(value: unknown, _what: string): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseThumbnails(value: unknown): YouTubeThumbnails {
  if (!isRecord(value)) return {};
  const out: YouTubeThumbnails = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;
    const url = entry["url"];
    if (typeof url !== "string" || url.length === 0) continue;
    const width = entry["width"];
    const height = entry["height"];
    const thumbnail: YouTubeThumbnail =
      typeof width === "number" && typeof height === "number"
        ? { url, width, height }
        : { url };
    out[name] = thumbnail;
  }
  return out;
}

// ---------------------------------------------------------------------------
// search.list — 100 quota units
// ---------------------------------------------------------------------------

export interface YouTubeSearchParams {
  /** The search query (q). */
  readonly q: string;
  /** Page token for deterministic pagination (from a previous page). */
  readonly pageToken?: string;
  /** Results per page (1–50; default 25). */
  readonly maxResults?: number;
  /** ISO 3166-1 alpha-2 region hint (from ConnectorContext.region). */
  readonly regionCode?: string;
  /** BCP-47 language hint (from ConnectorContext.locale). */
  readonly relevanceLanguage?: string;
}

/**
 * search.list — 100 quota units per call (the expensive primitive).
 *
 * The connector always sets `type=video` + `part=snippet`:
 * - type=video keeps every result projectable to a frozen EntertainmentItem
 *   (channels/playlists are not entertainment items — channel data is
 *   surfaced separately via channels.list);
 * - part=snippet is all search projections consume (title, channel,
 *   thumbnails, publishedAt). Durations/orientations are deliberately NOT
 *   fetched here (that would be one extra videos.list call per result —
 *   metadata does that on demand, for 1 unit).
 */
export async function youtubeSearchList(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: YouTubeSearchParams,
): Promise<YouTubeSearchListResponse> {
  const query: Record<string, string> = {
    part: "snippet",
    type: "video",
    maxResults: String(Math.min(Math.max(params.maxResults ?? 25, 1), 50)),
    q: params.q,
  };
  if (params.pageToken !== undefined && params.pageToken.length > 0) {
    query["pageToken"] = params.pageToken;
  }
  if (params.regionCode !== undefined && params.regionCode.length > 0) {
    query["regionCode"] = params.regionCode;
  }
  if (params.relevanceLanguage !== undefined && params.relevanceLanguage.length > 0) {
    query["relevanceLanguage"] = params.relevanceLanguage;
  }
  const reply = await callApi(transport, { method: "GET", path: "/search", query, auth });
  return parseSearchListResponse(parseJsonBody(reply, "search.list"));
}

function parseSearchListResponse(value: unknown): YouTubeSearchListResponse {
  const root = expectRecord(value, "search.list response");
  const kind = root["kind"];
  if (kind !== "youtube#searchListResponse") {
    throw youTubeMalformedResponse(
      `search.list response kind is '${String(kind)}', expected 'youtube#searchListResponse'`,
    );
  }
  const rawItems = root["items"];
  if (!Array.isArray(rawItems)) {
    throw youTubeMalformedResponse("search.list response has no 'items' array");
  }
  const items: YouTubeSearchItem[] = [];
  for (const raw of rawItems) {
    const item = expectRecord(raw, "search.list item");
    const id = expectRecord(item["id"], "search.list item.id");
    const snippet = expectRecord(item["snippet"], "search.list item.snippet");
    const title = snippet["title"];
    const channelId = snippet["channelId"];
    if (typeof title !== "string" || typeof channelId !== "string") {
      throw youTubeMalformedResponse("search.list item.snippet lacks title/channelId");
    }
    const publishedAt = snippet["publishedAt"];
    if (typeof publishedAt !== "string") {
      throw youTubeMalformedResponse("search.list item.snippet lacks publishedAt");
    }
    const parsedId: YouTubeSearchItem["id"] = {
      kind: typeof id["kind"] === "string" ? id["kind"] : "",
    };
    if (typeof id["videoId"] === "string") parsedId.videoId = id["videoId"];
    if (typeof id["channelId"] === "string") parsedId.channelId = id["channelId"];
    if (typeof id["playlistId"] === "string") parsedId.playlistId = id["playlistId"];
    const liveBroadcastContent = snippet["liveBroadcastContent"];
    const publishTime = snippet["publishTime"];
    items.push({
      kind: "youtube#searchResult",
      etag: typeof item["etag"] === "string" ? item["etag"] : "",
      id: parsedId,
      snippet: {
        publishedAt,
        channelId,
        title,
        description: typeof snippet["description"] === "string" ? snippet["description"] : "",
        channelTitle: typeof snippet["channelTitle"] === "string" ? snippet["channelTitle"] : "",
        thumbnails: parseThumbnails(snippet["thumbnails"]),
        ...(typeof liveBroadcastContent === "string"
          ? { liveBroadcastContent }
          : {}),
        ...(typeof publishTime === "string" ? { publishTime } : {}),
      },
    });
  }
  const nextPageToken = root["nextPageToken"];
  const prevPageToken = root["prevPageToken"];
  const pageInfo = expectRecord(root["pageInfo"], "search.list pageInfo");
  const totalResults = pageInfo["totalResults"];
  const resultsPerPage = pageInfo["resultsPerPage"];
  return {
    kind: "youtube#searchListResponse",
    etag: typeof root["etag"] === "string" ? root["etag"] : "",
    ...(typeof nextPageToken === "string" ? { nextPageToken } : {}),
    ...(typeof prevPageToken === "string" ? { prevPageToken } : {}),
    pageInfo: {
      ...(typeof totalResults === "number" ? { totalResults } : {}),
      ...(typeof resultsPerPage === "number" ? { resultsPerPage } : {}),
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// videos.list — 1 quota unit
// ---------------------------------------------------------------------------

export interface YouTubeVideosParams {
  /** Video ids (comma-joined into the documented id parameter). */
  readonly ids: readonly string[];
}

/**
 * videos.list — 1 quota unit per call (cheap; the metadata/resolve workhorse).
 *
 * Parts requested: snippet (titles/thumbnails), contentDetails (ISO-8601
 * duration, regionRestriction), status (embeddable, upload/privacy status —
 * THE embeddability truth), statistics (view/like counts).
 */
export async function youtubeVideosList(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: YouTubeVideosParams,
): Promise<YouTubeVideoListResponse> {
  const query: Record<string, string> = {
    part: "snippet,contentDetails,status,statistics",
    id: params.ids.join(","),
  };
  const reply = await callApi(transport, { method: "GET", path: "/videos", query, auth });
  return parseVideoListResponse(parseJsonBody(reply, "videos.list"));
}

function parseVideoListResponse(value: unknown): YouTubeVideoListResponse {
  const root = expectRecord(value, "videos.list response");
  const kind = root["kind"];
  if (kind !== "youtube#videoListResponse") {
    throw youTubeMalformedResponse(
      `videos.list response kind is '${String(kind)}', expected 'youtube#videoListResponse'`,
    );
  }
  const rawItems = root["items"];
  if (!Array.isArray(rawItems)) {
    throw youTubeMalformedResponse("videos.list response has no 'items' array");
  }
  const items: YouTubeVideoItem[] = [];
  for (const raw of rawItems) {
    const item = expectRecord(raw, "videos.list item");
    const id = item["id"];
    if (typeof id !== "string" || id.length === 0) {
      throw youTubeMalformedResponse("videos.list item lacks a non-empty 'id'");
    }
    const snippet = expectRecord(item["snippet"], "videos.list item.snippet");
    const title = snippet["title"];
    if (typeof title !== "string") {
      throw youTubeMalformedResponse("videos.list item.snippet lacks title");
    }
    const contentDetails = expectRecord(item["contentDetails"], "videos.list item.contentDetails");
    const duration = contentDetails["duration"];
    if (typeof duration !== "string") {
      throw youTubeMalformedResponse("videos.list item.contentDetails lacks duration");
    }
    const status = expectRecord(item["status"], "videos.list item.status");
    const embeddable = status["embeddable"];
    if (typeof embeddable !== "boolean") {
      throw youTubeMalformedResponse("videos.list item.status lacks the embeddable boolean");
    }
    const statistics = expectRecord(item["statistics"], "videos.list item.statistics");

    const regionRestrictionRaw = contentDetails["regionRestriction"];
    let regionRestriction: YouTubeVideoItem["contentDetails"]["regionRestriction"];
    if (isRecord(regionRestrictionRaw)) {
      const allowed = expectStringArray(regionRestrictionRaw["allowed"], "allowed");
      const blocked = expectStringArray(regionRestrictionRaw["blocked"], "blocked");
      regionRestriction = {
        ...(allowed !== undefined ? { allowed } : {}),
        ...(blocked !== undefined ? { blocked } : {}),
      };
    }

    const privacyStatus = status["privacyStatus"];
    const categoryId = snippet["categoryId"];
    const liveBroadcastContent = snippet["liveBroadcastContent"];
    const rawTags = snippet["tags"];
    items.push({
      kind: "youtube#video",
      etag: typeof item["etag"] === "string" ? item["etag"] : "",
      id,
      snippet: {
        publishedAt:
          typeof snippet["publishedAt"] === "string" ? snippet["publishedAt"] : "",
        channelId: typeof snippet["channelId"] === "string" ? snippet["channelId"] : "",
        title,
        description: typeof snippet["description"] === "string" ? snippet["description"] : "",
        channelTitle: typeof snippet["channelTitle"] === "string" ? snippet["channelTitle"] : "",
        thumbnails: parseThumbnails(snippet["thumbnails"]),
        ...(typeof categoryId === "string" ? { categoryId } : {}),
        ...(typeof liveBroadcastContent === "string" ? { liveBroadcastContent } : {}),
        ...(Array.isArray(rawTags)
          ? { tags: rawTags.filter((tag): tag is string => typeof tag === "string") }
          : {}),
      },
      contentDetails: {
        duration,
        ...(typeof contentDetails["dimension"] === "string"
          ? { dimension: contentDetails["dimension"] }
          : {}),
        ...(typeof contentDetails["definition"] === "string"
          ? { definition: contentDetails["definition"] }
          : {}),
        ...(typeof contentDetails["caption"] === "string" ? { caption: contentDetails["caption"] } : {}),
        ...(typeof contentDetails["licensedContent"] === "boolean"
          ? { licensedContent: contentDetails["licensedContent"] }
          : {}),
        ...(regionRestriction !== undefined ? { regionRestriction } : {}),
        ...(typeof contentDetails["projection"] === "string"
          ? { projection: contentDetails["projection"] }
          : {}),
      },
      status: {
        ...(typeof status["uploadStatus"] === "string" ? { uploadStatus: status["uploadStatus"] } : {}),
        ...(privacyStatus === "public" || privacyStatus === "private" || privacyStatus === "unlisted"
          ? { privacyStatus }
          : {}),
        ...(typeof status["license"] === "string" ? { license: status["license"] } : {}),
        embeddable,
        ...(typeof status["publicStatsViewable"] === "boolean"
          ? { publicStatsViewable: status["publicStatsViewable"] }
          : {}),
        ...(typeof status["madeForKids"] === "boolean" ? { madeForKids: status["madeForKids"] } : {}),
      },
      statistics: {
        ...(typeof statistics["viewCount"] === "string" ? { viewCount: statistics["viewCount"] } : {}),
        ...(typeof statistics["likeCount"] === "string" ? { likeCount: statistics["likeCount"] } : {}),
        ...(typeof statistics["dislikeCount"] === "string"
          ? { dislikeCount: statistics["dislikeCount"] }
          : {}),
        ...(typeof statistics["favoriteCount"] === "string"
          ? { favoriteCount: statistics["favoriteCount"] }
          : {}),
        ...(typeof statistics["commentCount"] === "string"
          ? { commentCount: statistics["commentCount"] }
          : {}),
      },
    });
  }
  return {
    kind: "youtube#videoListResponse",
    etag: typeof root["etag"] === "string" ? root["etag"] : "",
    items,
  };
}

// ---------------------------------------------------------------------------
// channels.list — 1 quota unit
// ---------------------------------------------------------------------------

/**
 * channels.list — 1 quota unit. Parts: snippet (identity/thumbnails),
 * statistics (subscriber/view/video counts), contentDetails
 * (relatedPlaylists: the user's likes/uploads playlist ids).
 */
export async function youtubeChannelsList(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { id?: string; mine?: boolean },
): Promise<YouTubeChannelListResponse> {
  const query: Record<string, string> = { part: "snippet,statistics,contentDetails" };
  if (params.id !== undefined) query["id"] = params.id;
  if (params.mine === true) query["mine"] = "true";
  const reply = await callApi(transport, { method: "GET", path: "/channels", query, auth });
  return parseChannelListResponse(parseJsonBody(reply, "channels.list"));
}

function parseChannelListResponse(value: unknown): YouTubeChannelListResponse {
  const root = expectRecord(value, "channels.list response");
  const kind = root["kind"];
  if (kind !== "youtube#channelListResponse") {
    throw youTubeMalformedResponse(
      `channels.list response kind is '${String(kind)}', expected 'youtube#channelListResponse'`,
    );
  }
  const rawItems = root["items"];
  if (!Array.isArray(rawItems)) {
    throw youTubeMalformedResponse("channels.list response has no 'items' array");
  }
  const items: YouTubeChannelItem[] = [];
  for (const raw of rawItems) {
    const item = expectRecord(raw, "channels.list item");
    const id = item["id"];
    if (typeof id !== "string" || id.length === 0) {
      throw youTubeMalformedResponse("channels.list item lacks a non-empty 'id'");
    }
    const snippet = expectRecord(item["snippet"], "channels.list item.snippet");
    const title = snippet["title"];
    if (typeof title !== "string") {
      throw youTubeMalformedResponse("channels.list item.snippet lacks title");
    }
    const statistics = expectRecord(item["statistics"], "channels.list item.statistics");
    const contentDetails = expectRecord(item["contentDetails"], "channels.list item.contentDetails");
    const related = expectRecord(
      contentDetails["relatedPlaylists"],
      "channels.list item.contentDetails.relatedPlaylists",
    );
    const customUrl = snippet["customUrl"];
    const publishedAt = snippet["publishedAt"];
    const country = snippet["country"];
    items.push({
      kind: "youtube#channel",
      etag: typeof item["etag"] === "string" ? item["etag"] : "",
      id,
      snippet: {
        title,
        description: typeof snippet["description"] === "string" ? snippet["description"] : "",
        ...(typeof customUrl === "string" ? { customUrl } : {}),
        ...(typeof publishedAt === "string" ? { publishedAt } : {}),
        thumbnails: parseThumbnails(snippet["thumbnails"]),
        ...(typeof country === "string" ? { country } : {}),
      },
      statistics: {
        ...(typeof statistics["viewCount"] === "string" ? { viewCount: statistics["viewCount"] } : {}),
        ...(typeof statistics["subscriberCount"] === "string"
          ? { subscriberCount: statistics["subscriberCount"] }
          : {}),
        ...(typeof statistics["hiddenSubscriberCount"] === "boolean"
          ? { hiddenSubscriberCount: statistics["hiddenSubscriberCount"] }
          : {}),
        ...(typeof statistics["videoCount"] === "string" ? { videoCount: statistics["videoCount"] } : {}),
      },
      contentDetails: {
        relatedPlaylists: {
          ...(typeof related["likes"] === "string" ? { likes: related["likes"] } : {}),
          ...(typeof related["uploads"] === "string" ? { uploads: related["uploads"] } : {}),
        },
      },
    });
  }
  return {
    kind: "youtube#channelListResponse",
    etag: typeof root["etag"] === "string" ? root["etag"] : "",
    items,
  };
}

// ---------------------------------------------------------------------------
// playlistItems.list — 1 quota unit
// ---------------------------------------------------------------------------

/**
 * playlistItems.list — 1 quota unit. Parts: snippet (titles, position,
 * resourceId.videoId), contentDetails (videoId, videoPublishedAt).
 *
 * The special playlist ids are documented constants: "LL" = the user's
 * liked videos, "WL" = Watch Later (both require OAuth for the owner).
 */
export async function youtubePlaylistItemsList(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { playlistId: string; maxResults?: number; pageToken?: string; videoId?: string },
): Promise<YouTubePlaylistItemListResponse> {
  const query: Record<string, string> = {
    part: "snippet,contentDetails",
    playlistId: params.playlistId,
    maxResults: String(Math.min(Math.max(params.maxResults ?? 50, 1), 50)),
  };
  if (params.pageToken !== undefined && params.pageToken.length > 0) {
    query["pageToken"] = params.pageToken;
  }
  if (params.videoId !== undefined && params.videoId.length > 0) {
    query["videoId"] = params.videoId;
  }
  const reply = await callApi(transport, {
    method: "GET",
    path: "/playlistItems",
    query,
    auth,
  });
  return parsePlaylistItemListResponse(parseJsonBody(reply, "playlistItems.list"));
}

function parsePlaylistItemEntry(raw: unknown): YouTubePlaylistItem {
  const item = expectRecord(raw, "playlistItems item");
  const id = item["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw youTubeMalformedResponse("playlistItems item lacks a non-empty 'id'");
  }
  const snippet = expectRecord(item["snippet"], "playlistItems item.snippet");
  const title = snippet["title"];
  const playlistId = snippet["playlistId"];
  const resourceId = expectRecord(snippet["resourceId"], "playlistItems item.snippet.resourceId");
  const videoId = resourceId["videoId"];
  if (typeof title !== "string" || typeof playlistId !== "string" || typeof videoId !== "string") {
    throw youTubeMalformedResponse("playlistItems item.snippet lacks title/playlistId/videoId");
  }
  const contentDetails = expectRecord(item["contentDetails"], "playlistItems item.contentDetails");
  const contentVideoId = contentDetails["videoId"];
  const videoPublishedAt = contentDetails["videoPublishedAt"];
  const position = snippet["position"];
  return {
    kind: "youtube#playlistItem",
    etag: typeof item["etag"] === "string" ? item["etag"] : "",
    id,
    snippet: {
      publishedAt: typeof snippet["publishedAt"] === "string" ? snippet["publishedAt"] : "",
      channelId: typeof snippet["channelId"] === "string" ? snippet["channelId"] : "",
      title,
      description: typeof snippet["description"] === "string" ? snippet["description"] : "",
      channelTitle: typeof snippet["channelTitle"] === "string" ? snippet["channelTitle"] : "",
      playlistId,
      position: typeof position === "number" ? position : 0,
      resourceId: {
        kind: typeof resourceId["kind"] === "string" ? resourceId["kind"] : "youtube#video",
        videoId,
      },
      ...(isRecord(snippet["thumbnails"])
        ? { thumbnails: parseThumbnails(snippet["thumbnails"]) }
        : {}),
    },
    contentDetails: {
      videoId: typeof contentVideoId === "string" ? contentVideoId : videoId,
      ...(typeof videoPublishedAt === "string" ? { videoPublishedAt } : {}),
    },
  };
}

function parsePlaylistItemListResponse(value: unknown): YouTubePlaylistItemListResponse {
  const root = expectRecord(value, "playlistItems.list response");
  const kind = root["kind"];
  if (kind !== "youtube#playlistItemListResponse") {
    throw youTubeMalformedResponse(
      `playlistItems.list response kind is '${String(kind)}', expected 'youtube#playlistItemListResponse'`,
    );
  }
  const rawItems = root["items"];
  if (!Array.isArray(rawItems)) {
    throw youTubeMalformedResponse("playlistItems.list response has no 'items' array");
  }
  const nextPageToken = root["nextPageToken"];
  return {
    kind: "youtube#playlistItemListResponse",
    etag: typeof root["etag"] === "string" ? root["etag"] : "",
    ...(typeof nextPageToken === "string" ? { nextPageToken } : {}),
    items: rawItems.map(parsePlaylistItemEntry),
  };
}

// ---------------------------------------------------------------------------
// playlistItems.insert — 50 quota units
// ---------------------------------------------------------------------------

/**
 * playlistItems.insert — 50 quota units. Adds a video to a playlist
 * (default: Watch Later, "WL") on behalf of the OAuth user.
 *
 * The documented body: { snippet: { playlistId, resourceId: { kind:
 * "youtube#video", videoId } } }. YouTube sets the item's title from the
 * video — a caller-supplied title is NOT forwarded (documented honestly).
 */
export async function youtubePlaylistItemsInsert(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { playlistId: string; videoId: string },
): Promise<YouTubePlaylistItemInsertResponse> {
  const body = JSON.stringify({
    snippet: {
      playlistId: params.playlistId,
      resourceId: { kind: "youtube#video", videoId: params.videoId },
    },
  });
  const query: Record<string, string> = { part: "snippet,contentDetails" };
  const reply = await callApi(transport, {
    method: "POST",
    path: "/playlistItems",
    query,
    auth,
    body,
  });
  const parsed = parsePlaylistItemEntry(parseJsonBody(reply, "playlistItems.insert"));
  return {
    kind: "youtube#playlistItem",
    etag: parsed.etag,
    id: parsed.id,
    snippet: parsed.snippet,
    contentDetails: parsed.contentDetails,
  };
}

// ---------------------------------------------------------------------------
// playlistItems.delete — 50 quota units
// ---------------------------------------------------------------------------

/**
 * playlistItems.delete — 50 quota units. Removes a playlist item BY ITS
 * PLAYLIST-ITEM ID (not the video id — the documented contract; the
 * connector looks the item id up first via playlistItems.list+videoId).
 * Succeeds with 204 No Content.
 */
export async function youtubePlaylistItemsDelete(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { playlistItemId: string },
): Promise<void> {
  const query: Record<string, string> = { id: params.playlistItemId };
  await callApi(transport, { method: "DELETE", path: "/playlistItems", query, auth });
}

// ---------------------------------------------------------------------------
// videos.rate — 50 quota units
// ---------------------------------------------------------------------------

/** The documented ratings for videos.rate. `none` REMOVES the rating. */
export type YouTubeRating = "like" | "dislike" | "none";

/**
 * videos.rate — 50 quota units. Rates a video as the OAuth user
 * (like / dislike / none). Succeeds with 204 No Content (no body).
 */
export async function youtubeVideosRate(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { videoId: string; rating: YouTubeRating },
): Promise<void> {
  const query: Record<string, string> = { id: params.videoId, rating: params.rating };
  await callApi(transport, { method: "POST", path: "/videos/rate", query, auth });
}

// ---------------------------------------------------------------------------
// subscriptions.list — 1 quota unit (R20-B, the BYOF follow graph)
// ---------------------------------------------------------------------------

/** subscriptions.list item (part=snippet) — the user's own subscriptions. */
export interface YouTubeSubscriptionItem {
  kind: "youtube#subscription";
  etag: string;
  id: string;
  snippet: {
    /** When the SUBSCRIPTION was added (the follow's source-native recency). */
    publishedAt: string;
    /** The channel's title as the subscription reports it. */
    title: string;
    description: string;
    /** The SUBSCRIBER's channel id (the authenticated user). */
    channelId: string;
    /** The followed channel — the feed item's external identity. */
    resourceId: { kind: string; channelId: string };
    thumbnails?: YouTubeThumbnails;
  };
}

/** subscriptions.list response (one page). */
export interface YouTubeSubscriptionListResponse {
  kind: "youtube#subscriptionListResponse";
  etag: string;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items: YouTubeSubscriptionItem[];
}

/**
 * subscriptions.list — 1 quota unit. `mine=true` (the authenticated user's
 * subscriptions) with part=snippet. OAuth ONLY: the documented parameter
 * requires an authorized token; an API key answers 401/403 honestly.
 *
 * SOURCE-NATIVE ORDER TRUTH: the documented response returns subscriptions
 * in reverse chronological order (most recently added first). The ARRAY
 * ORDER is the order truth — there is no position field — and the connector
 * projects `sourceOrder` as the array index.
 */
export async function youtubeSubscriptionsList(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { maxResults?: number; pageToken?: string } = {},
): Promise<YouTubeSubscriptionListResponse> {
  const query: Record<string, string> = {
    part: "snippet",
    mine: "true",
    maxResults: String(Math.min(Math.max(params.maxResults ?? 50, 1), 50)),
  };
  if (params.pageToken !== undefined && params.pageToken.length > 0) {
    query["pageToken"] = params.pageToken;
  }
  const reply = await callApi(transport, {
    method: "GET",
    path: "/subscriptions",
    query,
    auth,
  });
  return parseSubscriptionListResponse(parseJsonBody(reply, "subscriptions.list"));
}

function parseSubscriptionEntry(raw: unknown): YouTubeSubscriptionItem {
  const item = expectRecord(raw, "subscriptions item");
  const id = item["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw youTubeMalformedResponse("subscriptions item lacks a non-empty 'id'");
  }
  const snippet = expectRecord(item["snippet"], "subscriptions item.snippet");
  const publishedAt = snippet["publishedAt"];
  const title = snippet["title"];
  const description = snippet["description"];
  const channelId = snippet["channelId"];
  const resourceId = expectRecord(snippet["resourceId"], "subscriptions item.snippet.resourceId");
  const resourceChannelId = resourceId["channelId"];
  if (
    typeof publishedAt !== "string" ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof channelId !== "string" ||
    typeof resourceChannelId !== "string" ||
    resourceChannelId.length === 0
  ) {
    throw youTubeMalformedResponse(
      "subscriptions item.snippet lacks publishedAt/title/description/channelId/resourceId.channelId",
    );
  }
  return {
    kind: "youtube#subscription",
    etag: typeof item["etag"] === "string" ? item["etag"] : "",
    id,
    snippet: {
      publishedAt,
      title,
      description,
      channelId,
      resourceId: {
        kind: typeof resourceId["kind"] === "string" ? resourceId["kind"] : "youtube#channel",
        channelId: resourceChannelId,
      },
      ...(isRecord(snippet["thumbnails"])
        ? { thumbnails: parseThumbnails(snippet["thumbnails"]) }
        : {}),
    },
  };
}

function parseSubscriptionListResponse(value: unknown): YouTubeSubscriptionListResponse {
  const root = expectRecord(value, "subscriptions.list response");
  const kind = root["kind"];
  if (kind !== "youtube#subscriptionListResponse") {
    throw youTubeMalformedResponse(
      `subscriptions.list response kind is '${String(kind)}', expected 'youtube#subscriptionListResponse'`,
    );
  }
  const rawItems = root["items"];
  if (!Array.isArray(rawItems)) {
    throw youTubeMalformedResponse("subscriptions.list response has no 'items' array");
  }
  const nextPageToken = root["nextPageToken"];
  return {
    kind: "youtube#subscriptionListResponse",
    etag: typeof root["etag"] === "string" ? root["etag"] : "",
    ...(typeof nextPageToken === "string" ? { nextPageToken } : {}),
    items: rawItems.map(parseSubscriptionEntry),
  };
}

// ---------------------------------------------------------------------------
// playlists.list — 1 quota unit (R20-B, the BYOF playlist containers)
// ---------------------------------------------------------------------------

/** playlists.list item (part=snippet,contentDetails) — the user's own playlists. */
export interface YouTubePlaylistSummary {
  kind: "youtube#playlist";
  etag: string;
  id: string;
  snippet: {
    /** When the playlist was created. */
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    channelTitle: string;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails: {
    /** The number of items in the playlist (the bounded-fan-out truth). */
    itemCount: number;
  };
}

/** playlists.list response (one page). */
export interface YouTubePlaylistListResponse {
  kind: "youtube#playlistListResponse";
  etag: string;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items: YouTubePlaylistSummary[];
}

/**
 * playlists.list — 1 quota unit. `mine=true` with part=snippet,contentDetails
 * (contentDetails.itemCount powers the bounded import discipline). OAuth ONLY
 * for mine=true. The documented response returns playlists in reverse
 * chronological creation order (newest first) — the ARRAY ORDER is the
 * order truth, projected as `sourceOrder` by index.
 */
export async function youtubePlaylistsList(
  transport: YouTubeHttpTransport,
  auth: YouTubeCallAuth,
  params: { maxResults?: number; pageToken?: string } = {},
): Promise<YouTubePlaylistListResponse> {
  const query: Record<string, string> = {
    part: "snippet,contentDetails",
    mine: "true",
    maxResults: String(Math.min(Math.max(params.maxResults ?? 25, 1), 50)),
  };
  if (params.pageToken !== undefined && params.pageToken.length > 0) {
    query["pageToken"] = params.pageToken;
  }
  const reply = await callApi(transport, {
    method: "GET",
    path: "/playlists",
    query,
    auth,
  });
  return parsePlaylistListResponse(parseJsonBody(reply, "playlists.list"));
}

function parsePlaylistEntry(raw: unknown): YouTubePlaylistSummary {
  const item = expectRecord(raw, "playlists item");
  const id = item["id"];
  if (typeof id !== "string" || id.length === 0) {
    throw youTubeMalformedResponse("playlists item lacks a non-empty 'id'");
  }
  const snippet = expectRecord(item["snippet"], "playlists item.snippet");
  const publishedAt = snippet["publishedAt"];
  const channelId = snippet["channelId"];
  const title = snippet["title"];
  const description = snippet["description"];
  const channelTitle = snippet["channelTitle"];
  if (
    typeof publishedAt !== "string" ||
    typeof channelId !== "string" ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof channelTitle !== "string"
  ) {
    throw youTubeMalformedResponse(
      "playlists item.snippet lacks publishedAt/channelId/title/description/channelTitle",
    );
  }
  const contentDetails = expectRecord(item["contentDetails"], "playlists item.contentDetails");
  const itemCount = contentDetails["itemCount"];
  if (typeof itemCount !== "number") {
    throw youTubeMalformedResponse("playlists item.contentDetails lacks a numeric 'itemCount'");
  }
  return {
    kind: "youtube#playlist",
    etag: typeof item["etag"] === "string" ? item["etag"] : "",
    id,
    snippet: {
      publishedAt,
      channelId,
      title,
      description,
      channelTitle,
      ...(isRecord(snippet["thumbnails"])
        ? { thumbnails: parseThumbnails(snippet["thumbnails"]) }
        : {}),
    },
    contentDetails: { itemCount },
  };
}

function parsePlaylistListResponse(value: unknown): YouTubePlaylistListResponse {
  const root = expectRecord(value, "playlists.list response");
  const kind = root["kind"];
  if (kind !== "youtube#playlistListResponse") {
    throw youTubeMalformedResponse(
      `playlists.list response kind is '${String(kind)}', expected 'youtube#playlistListResponse'`,
    );
  }
  const rawItems = root["items"];
  if (!Array.isArray(rawItems)) {
    throw youTubeMalformedResponse("playlists.list response has no 'items' array");
  }
  const nextPageToken = root["nextPageToken"];
  return {
    kind: "youtube#playlistListResponse",
    etag: typeof root["etag"] === "string" ? root["etag"] : "",
    ...(typeof nextPageToken === "string" ? { nextPageToken } : {}),
    items: rawItems.map(parsePlaylistEntry),
  };
}
