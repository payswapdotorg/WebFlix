/**
 * @wfx/experience — Media Surface fixtures (WFX-025, Lane C).
 *
 * TEST FIXTURES ONLY — never a production source (product invariant 10: no
 * hidden mocks; "Capability truth" in docs/architecture/product-boundaries.md).
 *
 * Everything here is DETERMINISTIC: literal constants, no randomness, no
 * `Date.now()`, no `crypto`. The decision instant is the same frozen date the
 * WFX-005 fixtures use (2026-09-13T00:00:00.000Z), expiry constants are
 * fixed offsets around it, item ids are hand-numbered canonical ULID bodies,
 * and the devices come from the WFX-025 matrix profiles verbatim. Two callers
 * consuming these fixtures observe byte-identical data.
 */

import type { DeviceCapabilities, EntertainmentItem } from "@wfx/domain";

import type { SurfacePermissions, SurfaceRealization, SurfaceRequest } from "./request";
import {
  SURFACE_DESKTOP_FULL_DEVICE,
  SURFACE_KIOSK_BROWSER_ONLY_DEVICE,
  SURFACE_MOBILE_RESTRICTED_DEVICE,
  SURFACE_TV_NATIVE_DEVICE,
} from "./matrix";

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------

/** Stable connector id of the surface fixture source. */
export const SURFACE_SOURCE_CONNECTOR_ID = "surface-fixture-source";

/**
 * The one decision instant the surface fixtures use — the frozen-architecture
 * date, identical to the WFX-005 `FIXTURE_OCCURRED_AT`.
 */
export const SURFACE_NOW = "2026-09-13T00:00:00.000Z";

/** Strictly before `SURFACE_NOW` — realizations with this expiry are expired. */
export const SURFACE_EXPIRED_AT = "2026-09-12T23:59:59.999Z";

/** Exactly `SURFACE_NOW` — the safe-side boundary: expiring AT now is expired. */
export const SURFACE_EXPIRING_AT_NOW = "2026-09-13T00:00:00.000Z";

/** Safely after `SURFACE_NOW` — realizations with this expiry are usable. */
export const SURFACE_VALID_UNTIL = "2027-09-13T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Items across all canonical types
// ---------------------------------------------------------------------------

/** Fixture item: a movie. */
export const SURFACE_ITEM_MOVIE: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000001",
  canonicalType: "movie",
  canonicalTitle: "Surface Fixture Movie",
  durationMs: 7_200_000,
  orientation: "horizontal",
};

/** Fixture item: a series. */
export const SURFACE_ITEM_SERIES: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000002",
  canonicalType: "series",
  canonicalTitle: "Surface Fixture Series",
  orientation: "horizontal",
};

/** Fixture item: an episode. */
export const SURFACE_ITEM_EPISODE: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000003",
  canonicalType: "episode",
  canonicalTitle: "Surface Fixture Episode",
  durationMs: 2_400_000,
  orientation: "horizontal",
};

/** Fixture item: a video. */
export const SURFACE_ITEM_VIDEO: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000004",
  canonicalType: "video",
  canonicalTitle: "Surface Fixture Video",
  durationMs: 1_800_000,
  orientation: "horizontal",
};

/** Fixture item: a short. */
export const SURFACE_ITEM_SHORT: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000005",
  canonicalType: "short",
  canonicalTitle: "Surface Fixture Short",
  durationMs: 45_000,
  orientation: "vertical",
};

/** Fixture item: a post. */
export const SURFACE_ITEM_POST: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000006",
  canonicalType: "post",
  canonicalTitle: "Surface Fixture Post",
  orientation: "square",
};

/** Fixture item: an audio. */
export const SURFACE_ITEM_AUDIO: EntertainmentItem = {
  id: "wfxitm_00000000000000000000000007",
  canonicalType: "audio",
  canonicalTitle: "Surface Fixture Audio",
  durationMs: 3_600_000,
};

/** All fixture items — one per canonical type, fixed order. */
export const SURFACE_ITEMS: readonly EntertainmentItem[] = [
  SURFACE_ITEM_MOVIE,
  SURFACE_ITEM_SERIES,
  SURFACE_ITEM_EPISODE,
  SURFACE_ITEM_VIDEO,
  SURFACE_ITEM_SHORT,
  SURFACE_ITEM_POST,
  SURFACE_ITEM_AUDIO,
];

// ---------------------------------------------------------------------------
// Realizations in all four modes (+ exclusion variants)
// ---------------------------------------------------------------------------

/** Viable native realization (no media demands — decodable everywhere native is declared). */
export const SURFACE_REALIZATION_NATIVE: SurfaceRealization = {
  mode: "native",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  capabilities: ["playNative"],
};

/** Viable native realization carrying the `hevc` media demand. */
export const SURFACE_REALIZATION_NATIVE_HEVC: SurfaceRealization = {
  mode: "native",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  capabilities: ["playNative", "hevc"],
};

/** Native realization with a demand no fixture device can decode (`vvc`). */
export const SURFACE_REALIZATION_NATIVE_UNDECODABLE: SurfaceRealization = {
  mode: "native",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  capabilities: ["playNative", "vvc"],
};

/** Expired native realization (strictly before SURFACE_NOW). */
export const SURFACE_REALIZATION_NATIVE_EXPIRED: SurfaceRealization = {
  mode: "native",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  capabilities: ["playNative"],
  expiresAt: SURFACE_EXPIRED_AT,
};

/** Native realization expiring exactly at the decision instant (safe-side: expired). */
export const SURFACE_REALIZATION_NATIVE_EXPIRING_AT_NOW: SurfaceRealization = {
  mode: "native",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  capabilities: ["playNative"],
  expiresAt: SURFACE_EXPIRING_AT_NOW,
};

/** Native realization explicitly claiming `unavailable`. */
export const SURFACE_REALIZATION_NATIVE_UNAVAILABLE: SurfaceRealization = {
  mode: "native",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  capabilities: ["playNative"],
  availability: "unavailable",
};

/** Viable embed realization (official provider player contract). */
export const SURFACE_REALIZATION_EMBED: SurfaceRealization = {
  mode: "embed",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/embed/movie-1",
  capabilities: ["playEmbed"],
};

/** Expired embed realization. */
export const SURFACE_REALIZATION_EMBED_EXPIRED: SurfaceRealization = {
  mode: "embed",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/embed/movie-1",
  capabilities: ["playEmbed"],
  expiresAt: SURFACE_EXPIRED_AT,
};

/** Embed realization explicitly claiming `unknown` availability. */
export const SURFACE_REALIZATION_EMBED_UNKNOWN: SurfaceRealization = {
  mode: "embed",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/embed/movie-1",
  capabilities: ["playEmbed"],
  availability: "unknown",
};

/** Viable browser realization (in-app browser surface). */
export const SURFACE_REALIZATION_BROWSER: SurfaceRealization = {
  mode: "browser",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/watch/movie-1",
  capabilities: ["playBrowser"],
};

/** Expired browser realization. */
export const SURFACE_REALIZATION_BROWSER_EXPIRED: SurfaceRealization = {
  mode: "browser",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/watch/movie-1",
  capabilities: ["playBrowser"],
  expiresAt: SURFACE_EXPIRED_AT,
};

/** Browser realization explicitly claiming `unavailable`. */
export const SURFACE_REALIZATION_BROWSER_UNAVAILABLE: SurfaceRealization = {
  mode: "browser",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/watch/movie-1",
  capabilities: ["playBrowser"],
  availability: "unavailable",
};

/** Viable external realization (OS handoff). */
export const SURFACE_REALIZATION_EXTERNAL: SurfaceRealization = {
  mode: "external",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/open/movie-1",
  capabilities: ["playExternal"],
};

/** Expired external realization. */
export const SURFACE_REALIZATION_EXTERNAL_EXPIRED: SurfaceRealization = {
  mode: "external",
  connectorId: SURFACE_SOURCE_CONNECTOR_ID,
  externalRef: "surface:movie-1",
  url: "https://surface.invalid/open/movie-1",
  capabilities: ["playExternal"],
  expiresAt: SURFACE_EXPIRED_AT,
};

/** All four viable mode realizations in frozen precedence order. */
export const SURFACE_REALIZATION_ALL_MODES: readonly SurfaceRealization[] = [
  SURFACE_REALIZATION_NATIVE,
  SURFACE_REALIZATION_EMBED,
  SURFACE_REALIZATION_BROWSER,
  SURFACE_REALIZATION_EXTERNAL,
];

/**
 * The same four viable realizations in REVERSED order — precedence must pick
 * native regardless of the caller's array order.
 */
export const SURFACE_REALIZATION_ALL_MODES_REVERSED: readonly SurfaceRealization[] = [
  SURFACE_REALIZATION_EXTERNAL,
  SURFACE_REALIZATION_BROWSER,
  SURFACE_REALIZATION_EMBED,
  SURFACE_REALIZATION_NATIVE,
];

// ---------------------------------------------------------------------------
// Devices from the matrix profiles (single source of truth: matrix.ts)
// ---------------------------------------------------------------------------

/** The four matrix-profile devices, in profile order (tv, desktop, mobile, kiosk). */
export const SURFACE_DEVICES: readonly Readonly<DeviceCapabilities>[] = [
  SURFACE_TV_NATIVE_DEVICE,
  SURFACE_DESKTOP_FULL_DEVICE,
  SURFACE_MOBILE_RESTRICTED_DEVICE,
  SURFACE_KIOSK_BROWSER_ONLY_DEVICE,
];

// ---------------------------------------------------------------------------
// Permission sets
// ---------------------------------------------------------------------------

/** Permissive permissions: every mode allowed (explicit all-true form). */
export const SURFACE_PERMISSIONS_PERMISSIVE: SurfacePermissions = {
  nativePermitted: true,
  browserAllowed: true,
  externalAllowed: true,
};

/** Browser-blocked permissions: only the in-app browser surface is restricted. */
export const SURFACE_PERMISSIONS_BROWSER_BLOCKED: SurfacePermissions = {
  nativePermitted: true,
  browserAllowed: false,
  externalAllowed: true,
};

/** All-restricted permissions: native, browser, and external all restricted. */
export const SURFACE_PERMISSIONS_ALL_RESTRICTED: SurfacePermissions = {
  nativePermitted: false,
  browserAllowed: false,
  externalAllowed: false,
};

/**
 * Permissive permissions plus a provider hint preferring embed — proves hints
 * are carried but NEVER override the frozen precedence (native still wins).
 */
export const SURFACE_PERMISSIONS_WITH_HINTS: SurfacePermissions = {
  nativePermitted: true,
  browserAllowed: true,
  externalAllowed: true,
  providerHints: {
    preferredMode: "embed",
    restrictionNote: "provider prefers the official embed player",
  },
};

// ---------------------------------------------------------------------------
// Ready-made requests
// ---------------------------------------------------------------------------

/**
 * The canonical happy-path request: the movie item, all four viable mode
 * realizations, the desktop-full device, permissive permissions, at the
 * fixture instant. Resolves to native.
 */
export const SURFACE_REQUEST_ALL_MODES_DESKTOP: SurfaceRequest = {
  item: SURFACE_ITEM_MOVIE,
  realizations: SURFACE_REALIZATION_ALL_MODES.map((realization) => ({ ...realization })),
  device: SURFACE_DESKTOP_FULL_DEVICE,
  permissions: SURFACE_PERMISSIONS_PERMISSIVE,
  now: SURFACE_NOW,
};
