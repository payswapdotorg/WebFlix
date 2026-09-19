/**
 * @wfx/connectors — the YouTube connector, the FIRST REAL provider connector
 * (WFX-054, Lane B).
 *
 * `YouTubeConnector extends BaseConnector` (the WFX-003 SDK) over the typed
 * API client (./api.ts), the pure projections (./projection.ts), the OAuth
 * flow functions (./oauth.ts), and the credential seam (./credentials.ts):
 *
 * - SEARCH    → search.list (type=video) projected to SearchResults; the
 *               SDK surface returns page 1 deterministically, and the
 *               extended `searchYouTubePage` exposes the provider's
 *               pageToken round-trip for deterministic caller-driven
 *               pagination (one page = one 100-unit call, never a fan-out).
 * - METADATA  → videos.list (snippet,contentDetails,status,statistics)
 *               projected to a rich SourceItem (ISO-8601 duration parsing,
 *               counts, thumbnails, ETag passthrough); channels.list powers
 *               the extended `channelSummary` enrichment surface.
 * - RESOLVE   → honest embeddability: status.embeddable ⇒ the documented
 *               iframe embed URL (mode "embed"), else the youtube.com watch
 *               URL (mode "external") — the frozen Media Surface precedence,
 *               never a faked native/browser mode. Deleted/private/region-
 *               blocked-for-caller videos resolve to [] (typed miss).
 * - ACTIONS   → like/unlike via videos.rate (rating like|dislike|none —
 *               `none` REMOVES the rating, the documented "unlike");
 *               save-to-playlist via playlistItems.insert (default Watch
 *               Later, "WL"); writeLibrary remove via playlistItems.list
 *               (videoId filter) + playlistItems.delete. follow/comment/
 *               download/transform are NOT DECLARED — the SDK capability
 *               gate answers them with typed `unsupported` results before
 *               any hook runs (restated defensively below, reference-
 *               connector style).
 * - LIBRARY   → readLibrary = playlistItems.list on "LL" (the user's liked
 *               videos — an OFFICIAL, documented surface). WATCH HISTORY is
 *               NOT offered: YouTube exposes no official watch-history API,
 *               and this connector does not scrape. WebFlix watch state is
 *               the platform's LOCAL watch history (WFX-052 persistence) —
 *               a documented, honest split.
 *
 * AUTH MODEL (the documented dual-auth contract):
 * - User-scoped operations (like, save, library read/write) REQUIRE an
 *   OAuth2 access token; an API key never suffices → typed `unauthorized`.
 * - Public-data operations (search, metadata, resolve) accept the OAuth
 *   token (preferred) OR the project API key.
 * - Expired tokens are ROTATED through refreshYouTubeToken when the OAuth
 *   client config is wired; a successful refresh is stored back through the
 *   credential source (rotation honored — a new refresh token replaces the
 *   old set atomically), and concurrent operations for the same user share
 *   ONE in-flight refresh (single-flight). A `refresh-rejected` outcome
 *   (revoked/expired refresh token) CLEARS the stored credentials — the
 *   documented recovery is re-authorization, and the call answers typed
 *   `unauthorized` (never a fake success with a dead token).
 *
 * Every failure is classified (./errors.ts) before it reaches the SDK's
 * closed ConnectorError vocabulary; the provider kind code rides in the
 * detail (`youtube:quota-exceeded: …`) so hosts can surface degraded modes
 * from receipts alone.
 */

import type {
  ActionReceipt,
  ConnectorContext,
  ConnectorFeedSnapshot,
  FeedImportRequest,
  FeedRelationship,
  LibraryCommand,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";

import { BaseConnector, type AsyncConnectorResultInput } from "../base";
import { assertOperational } from "../lifecycle";
import {
  errResult,
  transport,
  unauthorized,
  type ConnectorError,
  type ConnectorResult,
} from "../result";

import {
  youtubeChannelsList,
  youtubePlaylistItemsDelete,
  youtubePlaylistItemsInsert,
  youtubePlaylistItemsList,
  youtubePlaylistsList,
  youtubeSearchList,
  youtubeSubscriptionsList,
  youtubeVideosList,
  youtubeVideosRate,
  type YouTubeCallAuth,
  type YouTubeRating,
} from "./api";
import {
  projectChannel,
  projectPlaylistItems,
  projectRealizations,
  projectSearchResults,
  projectVideoToSourceItem,
  type YouTubeChannelSummary,
} from "./projection";
import {
  YOUTUBE_FEED_PLAYLISTS_MAX,
  YOUTUBE_FEED_PLAYLIST_ITEMS_MAX,
  YOUTUBE_FEED_RELATIONSHIPS,
  YOUTUBE_FEED_SUBSCRIPTIONS_MAX,
  projectPlaylistFeedItems,
  projectSpecialPlaylistItems,
  projectSubscriptions,
} from "./feed";
import {
  isYouTubeTokenExpired,
  refreshYouTubeToken,
  type YouTubeTokenSet,
} from "./oauth";
import type { YouTubeCredentialSource } from "./credentials";
import type { YouTubeHttpTransport } from "./http";
import { toConnectorError, YouTubeApiError } from "./errors";
import { quotaCostOf } from "./quota";
import { YOUTUBE_CONNECTOR_DESCRIPTOR, YOUTUBE_CONNECTOR_ID } from "./descriptor";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The connector's clock seam (structurally the platform `Clock`). */
export interface YouTubeClock {
  /** Epoch milliseconds. The ONLY time source the connector consults. */
  now(): number;
}

/** The special playlist ids YouTube documents (constants, not config). */
export const YOUTUBE_LIKED_PLAYLIST_ID = "LL" as const;
export const YOUTUBE_WATCH_LATER_PLAYLIST_ID = "WL" as const;

/** Default search page size (documented range 1–50). */
export const YOUTUBE_DEFAULT_SEARCH_PAGE_SIZE = 25;

export interface YouTubeConnectorOptions {
  /** The HTTP transport (production: createFetchYouTubeTransport). */
  readonly transport: YouTubeHttpTransport;
  /** Per-user token storage (production: PersistenceYouTubeCredentialSource). */
  readonly credentialSource: YouTubeCredentialSource;
  /** The clock seam — token expiry, receipt timestamps. */
  readonly clock: YouTubeClock;
  /**
   * The project API key (YOUTUBE_API_KEY): powers PUBLIC-data operations
   * for users who never connected their YouTube account. Optional — with
   * neither a token nor a key, public ops answer typed `unauthorized`.
   */
  readonly apiKey?: string;
  /**
   * The OAuth client credentials — REQUIRED for automatic token rotation
   * (refresh). Without them an expired token degrades honestly: public ops
   * fall back to the API key, user ops answer `unauthorized`.
   */
  readonly oauth?: { readonly clientId: string; readonly clientSecret: string };
  /**
   * The playlist `save`/writeLibrary target (default "WL", Watch Later).
   * A caller may also override per action via payload.playlistId.
   */
  readonly savePlaylistId?: string;
  /** Search page size (default 25; clamped to the documented 1–50). */
  readonly searchPageSize?: number;
}

/** Thrown when the connector is mis-wired at construction (programmer error). */
export class YouTubeConnectorConfigError extends Error {
  constructor(detail: string) {
    super(`invalid YouTube connector configuration: ${detail}`);
    this.name = "YouTubeConnectorConfigError";
  }
}

// ---------------------------------------------------------------------------
// Extended-surface payloads
// ---------------------------------------------------------------------------

/** One deterministic search page (the extended pagination surface). */
export interface YouTubeSearchPage {
  readonly results: SearchResult[];
  /** Present when more pages exist — round-trip verbatim into the next call. */
  readonly nextPageToken?: string;
  /** The quota units this page cost (search.list = 100). */
  readonly quotaUnits: number;
}

/** One deterministic liked-videos page (the extended library surface). */
export interface YouTubeLibraryPage {
  readonly entries: LibraryEntry[];
  readonly nextPageToken?: string;
  /** The quota units this page cost (playlistItems.list = 1). */
  readonly quotaUnits: number;
}

// ---------------------------------------------------------------------------
// Auth resolution (the dual-auth model + single-flight refresh)
// ---------------------------------------------------------------------------

/** The resolved auth for one operation. */
interface AuthResolution {
  readonly auth: YouTubeCallAuth;
  readonly tokens: YouTubeTokenSet | null;
}

/** Why a user-scoped call cannot proceed without OAuth. */
function oauthRequired(): ConnectorError {
  return unauthorized("youtube");
}

function storeError(detail: string): ConnectorError {
  return transport("youtube", `youtube:credential-store: ${detail}`);
}

/** Whether the public-data operations may use the project API key. */
function apiKeyAuth(options: YouTubeConnectorOptions): YouTubeCallAuth | null {
  return options.apiKey !== undefined && options.apiKey.length > 0
    ? { apiKey: options.apiKey }
    : null;
}

// ---------------------------------------------------------------------------
// The connector
// ---------------------------------------------------------------------------

/**
 * The YouTube connector (id `youtube`, auth `oauth`).
 *
 * Construct via `createYouTubeConnector(options)`; returned in the
 * `registered` lifecycle state — call `initialize()` before use (the SDK's
 * canonical FSM). The typed result surface (`searchResult`, `metadataResult`,
 * `resolveResult`, `executeActionResult`, `readLibraryResult`,
 * `writeLibraryResult`) is the primary API; the frozen plain surface
 * (`search`, `metadata`, …) degrades typed errors honestly per the SDK law.
 */
export class YouTubeConnector extends BaseConnector {
  private readonly options_: YouTubeConnectorOptions;
  private readonly savePlaylistId_: string;
  private readonly searchPageSize_: number;
  /** Single-flight refreshes: userId → the in-flight rotation promise. */
  private readonly refreshInFlight = new Map<string, Promise<YouTubeTokenSet | null>>();

  constructor(options: YouTubeConnectorOptions) {
    super(YOUTUBE_CONNECTOR_DESCRIPTOR);
    if (options.transport === null || options.transport === undefined) {
      throw new YouTubeConnectorConfigError("'transport' is required");
    }
    if (options.credentialSource === null || options.credentialSource === undefined) {
      throw new YouTubeConnectorConfigError("'credentialSource' is required");
    }
    if (options.clock === null || options.clock === undefined) {
      throw new YouTubeConnectorConfigError("'clock' is required");
    }
    if (
      options.oauth !== undefined &&
      (typeof options.oauth.clientId !== "string" ||
        options.oauth.clientId.trim().length === 0 ||
        typeof options.oauth.clientSecret !== "string" ||
        options.oauth.clientSecret.trim().length === 0)
    ) {
      throw new YouTubeConnectorConfigError(
        "'oauth' requires non-empty clientId + clientSecret (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)",
      );
    }
    if (options.savePlaylistId !== undefined && options.savePlaylistId.length === 0) {
      throw new YouTubeConnectorConfigError("'savePlaylistId' must be non-empty when present");
    }
    this.options_ = options;
    this.savePlaylistId_ = options.savePlaylistId ?? YOUTUBE_WATCH_LATER_PLAYLIST_ID;
    this.searchPageSize_ = options.searchPageSize ?? YOUTUBE_DEFAULT_SEARCH_PAGE_SIZE;
  }

  // --- auth resolution ------------------------------------------------------

  /**
   * Resolve the auth for a PUBLIC-data operation:
   * valid OAuth token (preferred) → refreshed token → API key → typed
   * `unauthorized`. Never fabricates an unauthenticated call.
   */
  private async resolvePublicAuth(
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<AuthResolution>> {
    const loaded = await this.loadTokens(ctx);
    if (!loaded.ok) return errResult(loaded.error);
    if (loaded.value !== null && !isYouTubeTokenExpired(loaded.value, this.now())) {
      return { ok: true, value: { auth: { accessToken: loaded.value.accessToken }, tokens: loaded.value } };
    }
    if (loaded.value !== null) {
      // Expired: rotate if possible (fall back to the API key honestly).
      const rotated = await this.rotateTokens(ctx, loaded.value);
      if (rotated.ok) {
        return { ok: true, value: { auth: { accessToken: rotated.value.accessToken }, tokens: rotated.value } };
      }
      const fallback = apiKeyAuth(this.options_);
      if (fallback !== null) return { ok: true, value: { auth: fallback, tokens: null } };
      return errResult(rotated.error);
    }
    const fallback = apiKeyAuth(this.options_);
    if (fallback !== null) return { ok: true, value: { auth: fallback, tokens: null } };
    return errResult(oauthRequired());
  }

  /**
   * Resolve the auth for a USER-scoped operation: a valid OAuth token is
   * REQUIRED (rotated when expired); an API key never suffices.
   */
  private async resolveUserAuth(
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<AuthResolution>> {
    const loaded = await this.loadTokens(ctx);
    if (!loaded.ok) return errResult(loaded.error);
    if (loaded.value === null) return errResult(oauthRequired());
    if (!isYouTubeTokenExpired(loaded.value, this.now())) {
      return { ok: true, value: { auth: { accessToken: loaded.value.accessToken }, tokens: loaded.value } };
    }
    const rotated = await this.rotateTokens(ctx, loaded.value);
    if (!rotated.ok) return errResult(rotated.error);
    return { ok: true, value: { auth: { accessToken: rotated.value.accessToken }, tokens: rotated.value } };
  }

  /** Load the user's token set through the credential seam (typed). */
  private async loadTokens(
    ctx: ConnectorContext,
  ): Promise<ConnectorResult<YouTubeTokenSet | null>> {
    let loaded;
    try {
      loaded = await this.options_.credentialSource.load(ctx.userId);
    } catch (thrown) {
      return errResult(
        storeError(`credential source threw: ${describeThrown(thrown)}`),
      );
    }
    if (!loaded.ok) return errResult(storeError(loaded.detail));
    return { ok: true, value: loaded.tokens };
  }

  /**
   * Rotate an expired token set (single-flight per user). Outcomes:
   * - ok + fresh set (stored back — rotation honored);
   * - ok + null (refresh-rejected: the stored set was CLEARED, re-authorization
   *   is the documented recovery → callers surface `unauthorized`);
   * - error (transport/malformed/store failure — the operation did not
   *   complete; nothing was cleared).
   */
  private async rotateTokens(
    ctx: ConnectorContext,
    expired: YouTubeTokenSet,
  ): Promise<ConnectorResult<YouTubeTokenSet>> {
    const oauth = this.options_.oauth;
    if (oauth === undefined || expired.refreshToken === undefined) {
      return errResult(oauthRequired());
    }
    // Share one in-flight refresh per user; a rejection (transport/malformed/
    // store failure during rotation) maps to a typed transport error naming
    // the refresh — never an uncaught throw through the SDK's settle() wrap.
    const onRejected = (thrown: unknown): ConnectorResult<YouTubeTokenSet> =>
      errResult(transport("youtube", `youtube:token-refresh: ${describeThrown(thrown)}`));
    const existing = this.refreshInFlight.get(ctx.userId);
    if (existing !== undefined) {
      return existing.then(settleRotation, onRejected);
    }
    const flight = this.performRefresh(ctx, oauth, expired);
    this.refreshInFlight.set(ctx.userId, flight);
    try {
      return await flight.then(settleRotation, onRejected);
    } finally {
      this.refreshInFlight.delete(ctx.userId);
    }
  }

  private async performRefresh(
    ctx: ConnectorContext,
    oauth: NonNullable<YouTubeConnectorOptions["oauth"]>,
    expired: YouTubeTokenSet,
  ): Promise<YouTubeTokenSet | null> {
    const refreshToken = expired.refreshToken;
    if (refreshToken === undefined) return null; // unreachable (guarded by caller)
    const result = await refreshYouTubeToken(
      oauth,
      this.options_.transport,
      refreshToken,
      this.now(),
    );
    if (!result.ok) {
      if (result.error.kind === "refresh-rejected") {
        // The refresh token is revoked/expired — clear the dead set (the
        // documented recovery is re-authorization) and answer unauthorized.
        await this.options_.credentialSource.clear(ctx.userId);
        return null;
      }
      // Transport/malformed: propagate as the typed provider failure.
      throw youTubeOAuthTransportFailure(result.error.detail);
    }
    await this.options_.credentialSource.store(ctx.userId, result.value);
    return result.value;
  }

  private now(): number {
    return this.options_.clock.now();
  }

  private receiptIso(): string {
    return new Date(this.now()).toISOString();
  }

  // --- SDK hooks: reads -------------------------------------------------------

  protected override onSearch(
    ctx: ConnectorContext,
    query: string,
  ): AsyncConnectorResultInput<SearchResult[]> {
    return (async () => {
      const resolution = await this.resolvePublicAuth(ctx);
      if (!resolution.ok) return resolution.error;
      try {
        const page = await this.fetchSearchPage(ctx, query, resolution.value.auth, undefined);
        return page.results;
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }
    })();
  }

  protected override onMetadata(
    ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<SourceItem | null> {
    return (async () => {
      const resolution = await this.resolvePublicAuth(ctx);
      if (!resolution.ok) return resolution.error;
      try {
        const response = await youtubeVideosList(this.options_.transport, resolution.value.auth, {
          ids: [ref],
        });
        const video = response.items[0];
        if (video === undefined) return null; // the documented empty-items miss
        if (video.status.uploadStatus === "deleted" || video.status.uploadStatus === "rejected") {
          return null; // the video is gone — typed not-found, never a zombie item
        }
        return projectVideoToSourceItem(video, ctx.region);
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }
    })();
  }

  protected override onResolve(
    ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<PlaybackRealization[]> {
    return (async () => {
      const resolution = await this.resolvePublicAuth(ctx);
      if (!resolution.ok) return resolution.error;
      try {
        const response = await youtubeVideosList(this.options_.transport, resolution.value.auth, {
          ids: [ref],
        });
        const video = response.items[0];
        if (video === undefined) return []; // typed miss
        return projectRealizations(video, ctx.region);
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }
    })();
  }

  // --- SDK hooks: actions -----------------------------------------------------

  protected override onExecuteAction(
    ctx: ConnectorContext,
    action: UserAction,
  ): AsyncConnectorResultInput<ActionReceipt> {
    return (async () => {
      switch (action.type) {
        case "like":
          return this.executeLike(ctx, action);
        case "save":
          return this.executeSave(ctx, action);
        default:
          // Unreachable in practice: the descriptor declares neither follow
          // nor comment/download/transform, so the SDK capability gate
          // answers `unsupported` before this hook runs. Restated
          // defensively (reference-connector law) so the honesty survives
          // even a future descriptor regression.
          return {
            kind: "unsupported" as const,
            capability: action.type,
            detail: `the YouTube connector implements like and save only (WFX-054 scope); '${action.type}' is not supported by this connector`,
          };
      }
    })();
  }

  /** like/unlike via videos.rate — 50 quota units. */
  private async executeLike(
    ctx: ConnectorContext,
    action: UserAction,
  ): Promise<ActionReceipt | ConnectorError> {
    const resolution = await this.resolveUserAuth(ctx);
    if (!resolution.ok) return resolution.error;

    const rating = action.payload?.["rating"];
    let value: YouTubeRating = "like";
    if (rating !== undefined) {
      if (rating !== "like" && rating !== "dislike" && rating !== "none") {
        return {
          kind: "invalid-input",
          detail: `youtube:bad-input: action.payload.rating must be 'like' | 'dislike' | 'none' ('none' removes the rating — the unlike), got '${String(rating)}'`,
        };
      }
      value = rating;
    }

    try {
      await youtubeVideosRate(this.options_.transport, resolution.value.auth, {
        videoId: action.externalRef,
        rating: value,
      });
    } catch (thrown) {
      return this.mapApiFailure(thrown);
    }
    return {
      status: "confirmed",
      detail: `rated '${value}' on YouTube (videos.rate; 'none' removes the rating)`,
      occurredAt: this.receiptIso(),
    };
  }

  /** save-to-playlist via playlistItems.insert — 50 quota units. */
  private async executeSave(
    ctx: ConnectorContext,
    action: UserAction,
  ): Promise<ActionReceipt | ConnectorError> {
    const resolution = await this.resolveUserAuth(ctx);
    if (!resolution.ok) return resolution.error;

    const playlistId = this.playlistIdForPayload(action.payload);

    let inserted;
    try {
      inserted = await youtubePlaylistItemsInsert(
        this.options_.transport,
        resolution.value.auth,
        { playlistId, videoId: action.externalRef },
      );
    } catch (thrown) {
      return this.mapApiFailure(thrown);
    }
    return {
      status: "confirmed",
      externalId: inserted.id,
      detail: `saved to YouTube playlist '${playlistId}' (playlistItems.insert)`,
      occurredAt: this.receiptIso(),
    };
  }

  // --- SDK hooks: library -----------------------------------------------------

  protected override onReadLibrary(
    ctx: ConnectorContext,
  ): AsyncConnectorResultInput<LibraryEntry[]> {
    return (async () => {
      const resolution = await this.resolveUserAuth(ctx);
      if (!resolution.ok) return resolution.error;
      try {
        const page = await youtubePlaylistItemsList(this.options_.transport, resolution.value.auth, {
          playlistId: YOUTUBE_LIKED_PLAYLIST_ID,
          maxResults: 50,
        });
        return projectPlaylistItems(page.items);
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }
    })();
  }

  protected override onWriteLibrary(
    ctx: ConnectorContext,
    command: LibraryCommand,
  ): AsyncConnectorResultInput<ActionReceipt> {
    return (async () => {
      const resolution = await this.resolveUserAuth(ctx);
      if (!resolution.ok) return resolution.error;

      if (command.op === "add") {
        let inserted;
        try {
          inserted = await youtubePlaylistItemsInsert(
            this.options_.transport,
            resolution.value.auth,
            {
              playlistId: this.savePlaylistId_,
              videoId: command.externalRef,
            },
          );
        } catch (thrown) {
          return this.mapApiFailure(thrown);
        }
        return {
          status: "confirmed",
          externalId: inserted.id,
          detail: `added to YouTube playlist '${this.savePlaylistId_}' (playlistItems.insert)`,
          occurredAt: this.receiptIso(),
        };
      }

      // remove: playlistItems are deleted BY PLAYLIST-ITEM ID — look the row
      // up first (playlistItems.list filtered by videoId; 1 unit), then
      // delete it (50 units).
      let row;
      try {
        const rows = await youtubePlaylistItemsList(
          this.options_.transport,
          resolution.value.auth,
          {
            playlistId: this.savePlaylistId_,
            videoId: command.externalRef,
            maxResults: 1,
          },
        );
        row = rows.items[0];
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }
      if (row === undefined) {
        // Idempotent remove: the postcondition (video not in the playlist)
        // already holds. Confirmed with an explicit no-op detail — never a
        // fabricated externalId.
        return {
          status: "confirmed",
          detail: `no '${this.savePlaylistId_}' row for this video — nothing to remove (idempotent)`,
          occurredAt: this.receiptIso(),
        };
      }
      try {
        await youtubePlaylistItemsDelete(this.options_.transport, resolution.value.auth, {
          playlistItemId: row.id,
        });
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }
      return {
        status: "confirmed",
        externalId: row.id,
        detail: `removed from YouTube playlist '${this.savePlaylistId_}' (playlistItems.delete)`,
        occurredAt: this.receiptIso(),
      };
    })();
  }

  // --- SDK hook: feed import (R20-B) ------------------------------------------

  /**
   * The authorized BYOF feed import over the documented user-scoped
   * endpoints (the FIRST REAL provider path — see ./feed.ts for the
   * route truth):
   *
   * - method: ONLY `api` is implemented. `official-export` / `user-file`
   *   (Google Takeout artifacts) and `snapshot` answer the typed
   *   `unsupported` verdict — parsing export files is not implemented, and
   *   a capability nobody wired is never faked.
   * - relationships: the documented route exposes follow (subscriptions),
   *   like ("LL"), watchlist ("WL"), and playlist (mine playlists + their
   *   items). Anything else — most notably `history` (the watch history is
   *   NOT served by the Data API; it exists only in the user's Takeout
   *   export) and `ranked-feed` (the home feed has no exportable API) —
   *   answers the typed `unsupported` verdict naming exactly what cannot
   *   be exposed and why. NO SILENT PARTIAL IMPORTS.
   * - auth: every endpoint is user-scoped (OAuth only) — no grant answers
   *   typed `unauthorized`, which the composition folds to
   *   `reauthorization-required`.
   * - bounded reads: ONE page per list (the SDK page law): subscriptions
   *   (≤50), "LL" (≤50), "WL" (≤50), mine playlists (≤25) + the FIRST page
   *   (≤50) of each playlist with itemCount > 0. Quota: 1 unit per call —
   *   the whole capture is a documented, bounded budget (see ./quota.ts).
   * - a `sourceRef` filter scopes the playlist route to ONE playlist id.
   *
   * The returned snapshot is a point-in-time CAPTURE: `syncState:
   * "snapshot"` (a capture is never presented as live) with
   * `continuousSync: true` (the route is re-readable — the import's
   * live/stale state is the sync state machine's verdict, not the
   * capture's self-label). `sourceRef` is set only for a single-container
   * (scoped playlist) capture.
   */
  protected override onImportFeed(
    ctx: ConnectorContext,
    request: FeedImportRequest,
  ): AsyncConnectorResultInput<ConnectorFeedSnapshot> {
    return (async () => {
      if (request.method !== "api") {
        return {
          kind: "unsupported" as const,
          capability: "feedImport" as const,
          detail:
            `the YouTube connector implements the authorized API import route only; ` +
            `method '${request.method}' (official exports / user files) is not implemented — ` +
            `no silent fallback, no fixture`,
        };
      }
      const requested = request.relationships ?? [...YOUTUBE_FEED_RELATIONSHIPS];
      const unsupported = requested.filter(
        (relationship) => !YOUTUBE_FEED_RELATIONSHIPS.includes(relationship),
      );
      if (unsupported.length > 0) {
        const history = unsupported.includes("history");
        return {
          kind: "unsupported" as const,
          capability: "feedImport" as const,
          detail:
            `the documented YouTube Data API v3 cannot expose: ${unsupported.join(", ")}` +
            (history
              ? ` (the watch history is available only through the user's Google Takeout export, which this connector does not parse)`
              : "") +
            ` — the importable relationships are: ${YOUTUBE_FEED_RELATIONSHIPS.join(", ")}`,
        };
      }

      const resolution = await this.resolveUserAuth(ctx);
      if (!resolution.ok) return resolution.error;
      const auth = resolution.value.auth;

      const items: ConnectorFeedSnapshot["items"][number][] = [];
      let quotaUnits = 0;
      let scopedPlaylist = false;
      try {
        if (requested.includes("follow")) {
          const subscriptions = await youtubeSubscriptionsList(
            this.options_.transport,
            auth,
            { maxResults: YOUTUBE_FEED_SUBSCRIPTIONS_MAX },
          );
          quotaUnits += 1;
          items.push(...projectSubscriptions(subscriptions));
        }
        if (requested.includes("like")) {
          const liked = await youtubePlaylistItemsList(this.options_.transport, auth, {
            playlistId: YOUTUBE_LIKED_PLAYLIST_ID,
            maxResults: YOUTUBE_FEED_PLAYLIST_ITEMS_MAX,
          });
          quotaUnits += 1;
          items.push(...projectSpecialPlaylistItems("LL", liked));
        }
        if (requested.includes("watchlist")) {
          const watchLater = await youtubePlaylistItemsList(this.options_.transport, auth, {
            playlistId: YOUTUBE_WATCH_LATER_PLAYLIST_ID,
            maxResults: YOUTUBE_FEED_PLAYLIST_ITEMS_MAX,
          });
          quotaUnits += 1;
          items.push(...projectSpecialPlaylistItems("WL", watchLater));
        }
        if (requested.includes("playlist")) {
          if (request.sourceRef !== undefined) {
            // Scoped playlist capture: exactly one container, first page.
            const page = await youtubePlaylistItemsList(this.options_.transport, auth, {
              playlistId: request.sourceRef,
              maxResults: YOUTUBE_FEED_PLAYLIST_ITEMS_MAX,
            });
            quotaUnits += 1;
            items.push(...projectPlaylistFeedItems(request.sourceRef, page));
            scopedPlaylist = true;
          } else {
            const playlists = await youtubePlaylistsList(this.options_.transport, auth, {
              maxResults: YOUTUBE_FEED_PLAYLISTS_MAX,
            });
            quotaUnits += 1;
            for (const playlist of playlists.items) {
              if (playlist.contentDetails.itemCount <= 0) continue;
              const page = await youtubePlaylistItemsList(this.options_.transport, auth, {
                playlistId: playlist.id,
                maxResults: YOUTUBE_FEED_PLAYLIST_ITEMS_MAX,
              });
              quotaUnits += 1;
              items.push(...projectPlaylistFeedItems(playlist.id, page));
            }
          }
        }
      } catch (thrown) {
        return this.mapApiFailure(thrown);
      }

      const snapshot: ConnectorFeedSnapshot = {
        connectorId: YOUTUBE_CONNECTOR_ID,
        method: "api",
        capturedAt: this.receiptIso(),
        continuousSync: true,
        orderSemantics: "source-native",
        syncState: "snapshot", // a capture is a snapshot — never presented as live
        items,
        ...(scopedPlaylist && request.sourceRef !== undefined
          ? { sourceRef: request.sourceRef }
          : {}),
        metadata: {
          quotaUnits,
          relationships: [...requested] as FeedRelationship[],
          pageDiscipline: "one page per list (documented bounds: 50 subscriptions, 50 LL, 50 WL, 25 playlists + 50 items per playlist)",
        },
      };
      return snapshot;
    })();
  }

  // --- extended surfaces (pagination, channels) --------------------------------

  /**
   * One deterministic search page: provider relevance order, the pageToken
   * round-tripped verbatim, and the page's quota cost reported (100 units).
   * The SDK's `searchResult` surface returns page 1 of this same shape.
   */
  async searchYouTubePage(
    ctx: ConnectorContext,
    query: string,
    pageToken?: string,
  ): Promise<ConnectorResult<YouTubeSearchPage>> {
    assertOperationalLocal(this);
    const resolution = await this.resolvePublicAuth(ctx);
    if (!resolution.ok) return errResult(resolution.error);
    try {
      const page = await this.fetchSearchPage(ctx, query, resolution.value.auth, pageToken);
      return { ok: true, value: page };
    } catch (thrown) {
      return errResult(this.mapApiFailure(thrown));
    }
  }

  private async fetchSearchPage(
    ctx: ConnectorContext,
    query: string,
    auth: YouTubeCallAuth,
    pageToken: string | undefined,
  ): Promise<YouTubeSearchPage> {
    const response = await youtubeSearchList(this.options_.transport, auth, {
      q: query,
      maxResults: this.searchPageSize_,
      ...(pageToken !== undefined && pageToken.length > 0 ? { pageToken } : {}),
      ...(ctx.region !== undefined && ctx.region.length > 0
        ? { regionCode: ctx.region }
        : {}),
      relevanceLanguage: ctx.locale,
    });
    return {
      results: projectSearchResults(response),
      ...(response.nextPageToken !== undefined
        ? { nextPageToken: response.nextPageToken }
        : {}),
      quotaUnits: quotaCostOf("search.list"),
    };
  }

  /**
   * One deterministic liked-videos page ("LL" — the official surface).
   * Watch history is NOT available officially; WebFlix watch state is the
   * platform's local 052 persistence (documented module-level).
   */
  async readLikedVideosPage(
    ctx: ConnectorContext,
    pageToken?: string,
  ): Promise<ConnectorResult<YouTubeLibraryPage>> {
    assertOperationalLocal(this);
    const resolution = await this.resolveUserAuth(ctx);
    if (!resolution.ok) return errResult(resolution.error);
    try {
      const response = await youtubePlaylistItemsList(
        this.options_.transport,
        resolution.value.auth,
        {
          playlistId: YOUTUBE_LIKED_PLAYLIST_ID,
          maxResults: 50,
          ...(pageToken !== undefined && pageToken.length > 0 ? { pageToken } : {}),
        },
      );
      return {
        ok: true,
        value: {
          entries: projectPlaylistItems(response.items),
          ...(response.nextPageToken !== undefined
            ? { nextPageToken: response.nextPageToken }
            : {}),
          quotaUnits: quotaCostOf("playlistItems.list"),
        },
      };
    } catch (thrown) {
      return errResult(this.mapApiFailure(thrown));
    }
  }

  /**
   * A channel summary (channels.list — the rich channel metadata projection;
   * a channel is NOT an EntertainmentItem, so this is an enrichment
   * surface, not a metadata() result). Unknown channel → ok-null.
   */
  async channelSummary(
    ctx: ConnectorContext,
    channelId: string,
  ): Promise<ConnectorResult<YouTubeChannelSummary | null>> {
    assertOperationalLocal(this);
    const resolution = await this.resolvePublicAuth(ctx);
    if (!resolution.ok) return errResult(resolution.error);
    try {
      const response = await youtubeChannelsList(this.options_.transport, resolution.value.auth, {
        id: channelId,
      });
      const channel = response.items[0];
      return { ok: true, value: channel === undefined ? null : projectChannel(channel) };
    } catch (thrown) {
      return errResult(this.mapApiFailure(thrown));
    }
  }

  // --- internals ----------------------------------------------------------------

  /** Resolve the playlist target for a save action (payload override). */
  private playlistIdForPayload(payload: Record<string, unknown> | undefined): string {
    const override = payload?.["playlistId"];
    if (typeof override === "string" && override.length > 0) return override;
    return this.savePlaylistId_;
  }

  /** Map a thrown, already-classified provider failure onto the SDK vocabulary. */
  private mapApiFailure(thrown: unknown): ConnectorError {
    if (thrown instanceof YouTubeApiError) return toConnectorError(thrown);
    // A non-YouTubeApiError throw here is a bug — the SDK's settle() wrapper
    // would catch it as a transport error; map it the same way ourselves so
    // the extended (non-hook) surfaces behave identically.
    return transport("youtube", `youtube:unexpected: ${describeThrown(thrown)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function describeThrown(thrown: unknown): string {
  return thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
}

/** settleRotation: map the in-flight refresh outcome to the typed result. */
function settleRotation(
  rotated: YouTubeTokenSet | null,
): ConnectorResult<YouTubeTokenSet> {
  return rotated === null ? errResult(oauthRequired()) : { ok: true, value: rotated };
}

/** The typed error for a refresh that failed on transport/malformed grounds. */
function youTubeOAuthTransportFailure(detail: string): Error {
  const error = new Error(detail);
  error.name = "YouTubeOAuthTransportFailure";
  return error;
}

/** Lifecycle assertion for the extended surfaces (mirrors the SDK gate). */
function assertOperationalLocal(connector: YouTubeConnector): void {
  assertOperational(connector.state());
}

/**
 * Create the YouTube connector (id `youtube`).
 *
 * Returned in the `registered` state — call `initialize()` before use. The
 * concrete class is returned so callers keep the extended surfaces
 * (searchYouTubePage, readLikedVideosPage, channelSummary) without casts;
 * a `YouTubeConnector` is assignable to the frozen `SourceConnector`
 * contract everywhere (e.g. `ConnectorRegistry.register`).
 */
export function createYouTubeConnector(options: YouTubeConnectorOptions): YouTubeConnector {
  return new YouTubeConnector(options);
}
