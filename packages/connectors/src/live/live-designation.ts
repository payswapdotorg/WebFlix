/**
 * @wfx/connectors — R37 — THE LIVE DESIGNATION (the live-item truth at
 * the connector layer).
 *
 * THE LIVE-DESIGNATION LAW (the R37 dispatch, frozen): an item is LIVE,
 * or is an ARCHIVED LIVE VOD, because its CONNECTOR METADATA says so —
 * the surfaces derive, never guess. The domain graph is untouched
 * (read-only for this lane); the designation rides the EXISTING
 * `metadata` bag both shared item shapes carry
 * (`SearchResult` / `SourceItem` — packages/domain
 * src/contracts/extensions.ts), exactly the way the R36 channel surfaces
 * read the item-declared `publishedAt`/`viewCount` keys
 * (apps/web/src/host/channel-views.ts — validated before use, absent →
 * the honest typed absence) and the way `contentArtworkOf` binds the
 * well-known `thumbnailUrl` key (the artwork contract's own precedent:
 * the connector is the authorization boundary; this module validates
 * shape and carries the source's truth verbatim, never fabricating a
 * live state, a viewer figure, or an instant).
 *
 * THE METADATA VOCABULARY (all keys optional; every value validated —
 * a malformed value degrades to the honest absence, never a crash, the
 * R36 `declaredInstantOf` law):
 *
 * - `liveState`            — `"live"` | `"archived-live-vod"`. Absent
 *   (or any other value) → NOT LIVE (an item that declares nothing is
 *   an ordinary catalog item — never guessed into a live rail).
 * - `liveStartedAt`        — the source-declared ISO instant the live
 *   broadcast started (live items and archived VODs both carry it).
 * - `liveEndedAt`           — the source-declared ISO instant the live
 *   broadcast ended (archived-live-vods; the ended fact of record).
 * - `liveViewerCount`      — the source's own REPORTED concurrent
 *   viewer count (live items). An integer ≥ 0, exactly the validated
 *   read the channel surfaces apply to `viewCount`. THE HONEST-
 *   TRANSPORT LAW (R28, binding): a viewer count renders only where a
 *   source-declared figure exists — the typed absence otherwise, never
 *   a fabricated number.
 *
 * Pure types + pure projection (the artwork-contract discipline): no
 * fetching, no clock, no environment. The fixtures boot's live-reporting
 * source double (apps/web/src/host/byof/byof-fixtures.ts — the R37
 * delimited section) carries the SAME vocabulary; the surfaces consume
 * both through THIS one derivation.
 */

// ---------------------------------------------------------------------------
// The metadata keys (the well-known vocabulary — one law, every source)
// ---------------------------------------------------------------------------

/** The item's source-declared live state (absent ⇒ not live). */
export const LIVE_STATE_METADATA_KEY = "liveState";

/** The source-declared ISO instant the live broadcast started. */
export const LIVE_STARTED_AT_METADATA_KEY = "liveStartedAt";

/** The source-declared ISO instant the live broadcast ended. */
export const LIVE_ENDED_AT_METADATA_KEY = "liveEndedAt";

/** The source's own reported concurrent viewer count (live items). */
export const LIVE_VIEWER_COUNT_METADATA_KEY = "liveViewerCount";

// ---------------------------------------------------------------------------
// The designation (the typed truth the surfaces render)
// ---------------------------------------------------------------------------

/**
 * The honest badge vocabulary of a chat author. `member` is the source's
 * own paid-membership badge (a real membership claim the source carries),
 * `moderator` the source-declared chat moderator, `verified-creator` the
 * channel's own verified identity. A source that declares none renders
 * no badge — the typed absence, never a fabricated badge (the honest-
 * transport law).
 */
export type LiveChatAuthorBadge = "member" | "moderator" | "verified-creator";

/** Every badge value (the closed vocabulary — validation's truth set). */
export const LIVE_CHAT_AUTHOR_BADGES: readonly LiveChatAuthorBadge[] = [
  "member",
  "moderator",
  "verified-creator",
];

/**
 * The live designation of one item, derived from its connector metadata.
 *
 * - `live` — the source declares the item is CURRENTLY broadcasting.
 *   `startedAt`/`viewerCount` carry the source-declared figures when
 *   they exist (each may be the typed `null` — the honest absence).
 * - `archived-live-vod` — the source declares the item is the ARCHIVE
 *   of a live broadcast that ended (the chat replay's truth).
 * - `not-live` — the item declares no live state (the ordinary catalog
 *   item; the live surfaces never guess it into them).
 */
export type LiveDesignation =
  | {
      readonly kind: "live";
      readonly startedAt: string | null;
      /** The source-reported concurrent viewers (the typed absence when not declared). */
      readonly viewerCount: number | null;
    }
  | {
      readonly kind: "archived-live-vod";
      readonly startedAt: string | null;
      readonly endedAt: string | null;
    }
  | { readonly kind: "not-live" };

/** The not-live designation (the ordinary item's truth). */
export const NOT_LIVE_DESIGNATION: LiveDesignation = { kind: "not-live" };

// ---------------------------------------------------------------------------
// The validated field reads (the honest-degradation laws)
// ---------------------------------------------------------------------------

/** The row shape every live-designation read accepts (the shared item shapes satisfy it structurally). */
export interface LiveDesignationRow {
  readonly metadata?: Record<string, unknown>;
}

/**
 * Read one source-declared ISO instant (validated — `Date.parse` finite),
 * or `null` when the source declares none / the value is malformed (the
 * honest absence, the channel-views `declaredInstantOf` law verbatim).
 */
function declaredInstantOf(row: LiveDesignationRow, key: string): string | null {
  const raw = row.metadata?.[key];
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? raw : null;
}

/**
 * Read the source-declared concurrent-viewer figure (a validated integer
 * ≥ 0 — exactly the `viewCount` read the channel surfaces apply), or
 * `null` when absent/malformed. NEVER fabricated.
 */
function declaredViewerCountOf(row: LiveDesignationRow): number | null {
  const raw = row.metadata?.[LIVE_VIEWER_COUNT_METADATA_KEY];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.floor(raw);
}

/**
 * Derive the item's live designation from its connector metadata (the
 * one derivation every live surface consumes — the rail, the watch live
 * mode, the search-derived truth). Pure; malformed values degrade to
 * the honest absence, never a throw.
 */
export function liveDesignationOf(row: LiveDesignationRow): LiveDesignation {
  const state = row.metadata?.[LIVE_STATE_METADATA_KEY];
  if (state === "live") {
    return {
      kind: "live",
      startedAt: declaredInstantOf(row, LIVE_STARTED_AT_METADATA_KEY),
      viewerCount: declaredViewerCountOf(row),
    };
  }
  if (state === "archived-live-vod") {
    return {
      kind: "archived-live-vod",
      startedAt: declaredInstantOf(row, LIVE_STARTED_AT_METADATA_KEY),
      endedAt: declaredInstantOf(row, LIVE_ENDED_AT_METADATA_KEY),
    };
  }
  // Absent, malformed, or an unknown value: the ordinary item. An item is
  // never guessed into the live surfaces — the designation law.
  return NOT_LIVE_DESIGNATION;
}

/**
 * Whether the designation's source-declared viewer count exists (the
 * render-side honesty gate: `true` ⇒ the figure may render; `false` ⇒ the
 * typed-absence state renders — never a fabricated number).
 */
export function liveViewerCountIsDeclared(designation: LiveDesignation): boolean {
  return designation.kind === "live" && designation.viewerCount !== null;
}

/** The badge's display label (the closed vocabulary's own rendering). */
export function liveChatBadgeLabel(badge: LiveChatAuthorBadge): string {
  switch (badge) {
    case "member":
      return "Member";
    case "moderator":
      return "Moderator";
    case "verified-creator":
      return "Verified";
  }
}

/**
 * The badge's presentation tone (the design-language family the surfaces
 * bind — color always PAIRED with the label text, never alone).
 */
export function liveChatBadgeTone(badge: LiveChatAuthorBadge): "member" | "moderator" | "verified" {
  switch (badge) {
    case "member":
      return "member";
    case "moderator":
      return "moderator";
    case "verified-creator":
      return "verified";
  }
}
