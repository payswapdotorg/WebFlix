/**
 * @wfx/connectors — the YouTube connector barrel (WFX-054, Lane B).
 *
 * The FIRST REAL provider connector: YouTube over the documented Data API
 * v3 + Google OAuth2 contracts. No scraping, no provider-control bypasses;
 * every declared capability maps to an official endpoint, every undeclared
 * one answers with the SDK's typed `unsupported` result.
 *
 * Modules (read in this order to understand the connector):
 * - descriptor.ts   — the honest capability declaration + OAuth flow details
 * - http.ts         — the injectable HTTP seam (fetch/timeout vs scripted)
 * - errors.ts       — the typed failure taxonomy → SDK error vocabulary
 * - quota.ts        — the documented per-call quota cost table
 * - oauth.ts        — authorization-URL construction, code exchange,
 *                     refresh rotation, typed expiry
 * - credentials.ts  — token storage through WFX-052's AES-256-GCM
 *                     connector-account envelopes (the narrow seam + the
 *                     persistence-backed adapter + an in-memory test source)
 * - api.ts          — the typed Data API v3 client (search.list, videos.list,
 *                     channels.list, playlistItems.*, videos.rate)
 * - projection.ts   — pure API-shape → frozen-contract projections
 *                     (durations, counts, thumbnails, PlaybackMode truth)
 * - feed.ts         — R20-B: the BYOF route truth + API-shape → feed-item
 *                     projections (source-native order as data, never rank)
 * - fixtures.ts     — recorded-from-documentation test fixtures + the
 *                     scripted transport (deterministic, network-free)
 * - connector.ts    — `YouTubeConnector` (BaseConnector subclass) and
 *                     `createYouTubeConnector()`
 */

export * from "./descriptor";
export * from "./http";
export * from "./errors";
export * from "./quota";
export * from "./oauth";
export * from "./credentials";
export * from "./api";
export * from "./projection";
export * from "./feed";
export * from "./fixtures";
export * from "./connector";
