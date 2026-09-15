/**
 * @wfx/connectors — the YouTube connector's descriptor (WFX-054, Lane B).
 *
 * The FIRST REAL provider connector: YouTube, over the documented YouTube
 * Data API v3 + Google OAuth2 contracts. No scraping, no provider-control
 * bypasses — every capability below is implemented against an officially
 * documented endpoint, and every NOT-declared capability is answered with
 * the SDK's typed `unsupported` result naming it.
 *
 * The capability set (capability truth, docs/architecture/
 * product-boundaries.md: "Connectors must declare actual capabilities"):
 *
 * DECLARED (implemented against documented endpoints):
 * - catalogSearch  — search.list (type=video, part=snippet); 100 quota
 *                    units per call (see quota.ts).
 * - metadata       — videos.list (snippet, contentDetails, status,
 *                    statistics) + channels.list for channel summaries;
 *                    1 unit per call.
 * - playEmbed      — the documented iframe embed pattern
 *                    (https://www.youtube.com/embed/{videoId}) for videos
 *                    whose status.embeddable is true.
 * - playExternal   — the youtube.com watch URL handoff
 *                    (https://www.youtube.com/watch?v={videoId}).
 * - availability   — per-item truth from status.uploadStatus /
 *                    privacyStatus / contentDetails.regionRestriction.
 * - libraryRead    — playlistItems.list on the liked-videos playlist
 *                    (playlistId=LL, OAuth only); 1 unit.
 * - libraryWrite   — playlistItems.insert (add) / playlistItems.list +
 *                    playlistItems.delete (remove) against the Watch Later
 *                    playlist (WL) by default or a caller-named playlist;
 *                    50 units per mutating call.
 * - like           — videos.rate with rating like | dislike | none
 *                    (none removes the rating — the "unlike"); OAuth with
 *                    the `youtube` write scope; 50 units.
 * - save           — the `save` user action maps to the same
 *                    playlistItems machinery as libraryWrite (the frozen
 *                    UserAction surface for save-to-playlist); 50 units.
 *
 * NOT DECLARED (honest absences — each is answered with a typed
 * `unsupported` result that names the capability):
 * - identity     — the OAuth flow authenticates the user, but this
 *                  connector performs no identity/profile read (no
 *                  userinfo call). Surfacing Google identity is a future,
 *                  separately-reviewed decision.
 * - playNative   — YouTube streams no native media to us (and the ToS
 *                  forbids stream extraction); never fabricated.
 * - playBrowser  — we produce exactly two realizations (embed, external).
 *                  A browser/webview handoff would be the same watch URL
 *                  as `playExternal`; declaring a third mode we do not
 *                  distinctly implement would be dishonest.
 * - follow       — subscriptions.insert/delete exist officially, but are
 *                  OUT OF WFX-054 SCOPE (packet: like/save only). The
 *                  capability is not declared until it is implemented.
 * - comment      — WFX-054 scope decision (packet): the connector stays
 *                  like/save-only; posting comments on the user's behalf
 *                  is not implemented, so it is not declared.
 * - download     — no official API; stream extraction is against YouTube
 *                  ToS. Never declared, never implemented.
 * - transform    — no official API for editing/remixing user content.
 *                  Never declared, never implemented.
 *
 * `auth: "oauth"` — user-scoped operations (like, save, library) require
 * an OAuth2 access token obtained through the authorization-code flow in
 * ./oauth.ts. Public-data operations (search, metadata, resolve) accept
 * EITHER an OAuth token OR the project API key (YOUTUBE_API_KEY).
 */

import type { Capability, ConnectorDescriptor } from "@wfx/domain";

import { defineAuthFlow, type AuthFlow } from "../auth/flows";
import { defineDescriptor } from "../descriptor";

/** Stable id of the YouTube connector (frozen kebab-case id convention). */
export const YOUTUBE_CONNECTOR_ID = "youtube";

/**
 * The exact capability set of the YouTube connector (see module docs for
 * the per-capability endpoint mapping and the honest-absence rationale).
 * Order mirrors the frozen `Capability` union (see descriptor.ts in the SDK
 * root).
 */
export const YOUTUBE_CONNECTOR_CAPABILITIES: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playEmbed",
  "playExternal",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
] as const;

/**
 * The validated, deep-frozen descriptor of the YouTube connector.
 *
 * Constructed through the SDK's public `defineDescriptor` (strict validation
 * + freeze) — the same golden path the reference connector demonstrates.
 */
export const YOUTUBE_CONNECTOR_DESCRIPTOR: ConnectorDescriptor = defineDescriptor({
  id: YOUTUBE_CONNECTOR_ID,
  version: "0.1.0",
  displayName: "YouTube",
  capabilities: [...YOUTUBE_CONNECTOR_CAPABILITIES],
  auth: "oauth",
});

// ---------------------------------------------------------------------------
// Auth flow details (the WFX-012 ConnectorAuthService wiring shape)
// ---------------------------------------------------------------------------

/**
 * The OAuth scopes the YouTube connector requests, in request order:
 * - `youtube.readonly` — read the user's liked videos / playlists
 *   (libraryRead) and their channel data.
 * - `youtube`          — write actions (rate a video, modify playlists)
 *   required by like / save / libraryWrite.
 *
 * Space-separated in the authorization URL per the Google OAuth2 contract.
 */
export const YOUTUBE_OAUTH_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube",
] as const;

/**
 * Auth flow details for the WFX-012 `ConnectorAuthService`, keyed by
 * connector id:
 *
 * ```ts
 * const service = new ConnectorAuthService({
 *   registry,
 *   flows: { [YOUTUBE_CONNECTOR_ID]: youtubeAuthFlowDetails() },
 * });
 * ```
 *
 * The template names the Google authorization endpoint's shape (the
 * `{clientId}` placeholder satisfies the flow validator's template rule).
 * The AUTHORITATIVE URL builder is `buildYouTubeAuthorizationUrl` in
 * ./oauth.ts — it fills every documented parameter exactly; hosts use this
 * flow descriptor for beginAuth UX, and the builder for the real redirect.
 */
export function youtubeAuthFlowDetails(): AuthFlow {
  return defineAuthFlow({
    kind: "oauth",
    authorizationUrlTemplate:
      "https://accounts.google.com/o/oauth2/v2/auth?client_id={clientId}&response_type=code",
    scopes: [...YOUTUBE_OAUTH_SCOPES],
    tokenRefresh: true,
  });
}
