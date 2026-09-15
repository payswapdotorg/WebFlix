/**
 * @wfx/connectors — the YouTube connector's quota truth (WFX-054).
 *
 * The YouTube Data API v3 meters EVERY call in quota units against a
 * per-project daily quota (default 10,000 units, resetting at midnight
 * Pacific Time — verified provider documentation). This module is the
 * single source of that truth for the connector: every api.ts function
 * carries its cost here, the extended search surface reports the cost of
 * the page it fetched, and the WFX-053 degradation contract applies when
 * the budget is exhausted (typed `quota-exceeded` SUSPENSION — see
 * errors.ts).
 *
 * Cost table (documented per-call costs for exactly the endpoints this
 * connector uses):
 *
 * | Call                      | Cost (units) |
 * |---------------------------|--------------|
 * | search.list               | 100          |
 * | videos.list               | 1            |
 * | channels.list             | 1            |
 * | playlists.list            | 1            |
 * | playlistItems.list        | 1            |
 * | playlistItems.insert      | 50           |
 * | playlistItems.delete      | 50           |
 * | videos.rate               | 50           |
 *
 * Consequences the connector's design honors:
 * - search is the EXPENSIVE primitive (100 units ⇒ ~100 searches/day on the
 *   default quota); metadata/resolve share one 1-unit videos.list call
 *   shape and are cheap;
 * - one search PAGE is one search.list call — pagination is explicit and
 *   caller-driven (deterministic pageToken round-trip), never a fan-out;
 * - mutations (rate, playlist item insert/delete) cost 50 units each —
 *   the connector performs no speculative or duplicate mutations.
 */

/** The documented per-call quota costs, keyed by API call name. */
export const YOUTUBE_QUOTA_COSTS = {
  "search.list": 100,
  "videos.list": 1,
  "channels.list": 1,
  "playlists.list": 1,
  "playlistItems.list": 1,
  "playlistItems.insert": 50,
  "playlistItems.delete": 50,
  "videos.rate": 50,
} as const;

/** The API call names (the key type of YOUTUBE_QUOTA_COSTS). */
export type YouTubeQuotaCostKey = keyof typeof YOUTUBE_QUOTA_COSTS;

/**
 * The default daily quota for a Google Cloud project with the YouTube Data
 * API v3 enabled: 10,000 units per day (documents the provider contract;
 * the connector never assumes more).
 */
export const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;

/** The documented quota reset boundary: midnight Pacific Time, daily. */
export const YOUTUBE_QUOTA_RESET_BOUNDARY = "midnight Pacific Time";

/** Read the documented cost of one API call (compile-time checked key). */
export function quotaCostOf(call: YouTubeQuotaCostKey): number {
  return YOUTUBE_QUOTA_COSTS[call];
}
