/**
 * @wfx/experience — Media Surface request contracts (WFX-025, Lane C).
 *
 * The Media Surface resolver is the pure decision engine behind the frozen
 * playback-resolution flow (docs/architecture/webflix-frozen-architecture.md,
 * "Playback resolution"):
 *
 *   EntertainmentItem -> SourceRealization -> CapabilityResolution
 *     -> PlaybackSession -> MediaSurface
 *
 * `SurfaceRequest` is everything the resolver needs to pick ONE realization
 * mode for ONE playback request: the canonical item, the candidate
 * realizations, the device capabilities (WFX-002), the surface permissions,
 * and the decision instant. Everything is DATA — the resolver is pure,
 * synchronous, and deterministic; time enters ONLY through `now`, entropy
 * nowhere (no `Date.now()`, no `Math.random()` in this package).
 *
 * Error-channel law (mirrors `ports.ts`, the WFX-005 convention):
 * - A malformed REQUEST CONTAINER is caller misuse and throws the typed
 *   `ExperienceError` with every collected problem (`assertValidSurfaceRequest`).
 * - Per-realization problems (invalid shape, non-availability, expiry) are
 *   TYPED EXCLUSIONS with recorded reasons inside the resolution — never a
 *   crash, never a silent skip, never a fake success.
 */

import type {
  DeviceCapabilities,
  EntertainmentItem,
  PlaybackMode,
  PlaybackRealization,
} from "@wfx/domain";
import {
  PLAYBACK_MODES,
  isIso8601,
  isRecord,
  previewValue,
  validateEntertainmentItem,
} from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// SurfaceRealization — a playback realization with its availability claim
// ---------------------------------------------------------------------------

/**
 * A playback realization as the surface resolver accepts it.
 *
 * The frozen `PlaybackRealization` (docs/architecture/contracts.md, "Media
 * Surface") carries no availability field — but the graph's frozen
 * `SourceRealization` speaks availability, and connectors MAY attach the
 * claim to each realization they return (the WFX-002 validators accept extra
 * fields; structural typing is this repo's forward-compatibility law).
 *
 * Availability semantics (deliberate, lead-visible):
 * - `"available"` or ABSENT — the realization passes the availability gate.
 *   Absent means "no availability claim", NOT "unknown": treating a claim-less
 *   frozen realization as excluded would reject every realization produced by
 *   the frozen `SourceConnector.resolve()` surface, which cannot carry one.
 * - `"unknown"` / `"unavailable"` — excluded with a recorded reason.
 * - any other runtime value — degraded to `"unknown"` and excluded (a
 *   malformed claim is never trusted and never fabricated into availability).
 */
export interface SurfaceRealization extends PlaybackRealization {
  availability?: "available" | "unknown" | "unavailable";
}

/**
 * The effective availability of a realization plus a human-readable
 * description for exclusion reasons (see `SurfaceRealization` for semantics).
 */
export interface SurfaceAvailability {
  effective: "available" | "unknown" | "unavailable";
  description: string;
}

/**
 * Read a realization's availability claim defensively: absent/`"available"`
 * pass, `"unknown"`/`"unavailable"` are honored, anything else is degraded to
 * `"unknown"` (never trusted, never fabricated).
 */
export function surfaceAvailability(realization: SurfaceRealization): SurfaceAvailability {
  const claimed: unknown = isRecord(realization)
    ? (realization as { availability?: unknown }).availability
    : undefined;
  if (claimed === undefined || claimed === "available") {
    return { effective: "available", description: "available" };
  }
  if (claimed === "unknown" || claimed === "unavailable") {
    return { effective: claimed, description: `availability '${claimed}'` };
  }
  return {
    effective: "unknown",
    description: "malformed availability claim (treated as 'unknown')",
  };
}

// ---------------------------------------------------------------------------
// SurfacePermissions — the per-mode authorization record
// ---------------------------------------------------------------------------

/**
 * Advisory provider hints carried inside `SurfacePermissions`.
 *
 * Hints NEVER influence the decision: the frozen precedence
 * (Native -> Embed -> Browser -> External) is law, and a provider hint must
 * never override device capabilities or user permissions. The resolver reads
 * `preferredMode` only to append an explicit advisory line to the precedence
 * trace, so the audit shows the hint was seen and deliberately not followed.
 */
export interface SurfaceProviderHints {
  /** The provider's preferred playback mode — advisory only. */
  preferredMode?: PlaybackMode;
  /** Provider-stated context for restrictions (e.g. licensing notes). */
  restrictionNote?: string;
}

/**
 * Per-mode playback permissions — the request-side authorization record.
 *
 * Defaults are PERMISSIVE: every flag defaults to `true` and only an explicit
 * `false` restricts a mode ("defaults true except explicit restriction").
 *
 * - `nativePermitted` models the authorized-media boundary
 *   (docs/architecture/product-boundaries.md): native acquisition is for
 *   user-owned, licensed, public-domain, CC, or otherwise authorized media.
 *   It represents frozen precedence step 1, "WebFlix controls the media path".
 * - `browserAllowed` models frozen step 3, "in-app browser when provider web
 *   playback is permitted".
 * - `externalAllowed` models frozen step 4, "external handoff otherwise".
 * - Embed (frozen step 2, "official embed when the provider exposes a
 *   supported player contract") has NO permission flag: its gates are the
 *   device's embedding capability and the existence of an embed realization.
 */
export interface SurfacePermissions {
  /** Native playback permitted (authorized-media boundary). Default true. */
  nativePermitted?: boolean;
  /** In-app browser surface allowed. Default true. */
  browserAllowed?: boolean;
  /** External handoff allowed. Default true. */
  externalAllowed?: boolean;
  /** Advisory provider hints — never override the frozen precedence. */
  providerHints?: SurfaceProviderHints;
}

/** The per-mode permission flags (embed deliberately absent — see above). */
export type SurfacePermissionFlag = "nativePermitted" | "browserAllowed" | "externalAllowed";

/**
 * Whether a mode's permission allows playback. Pure default-true logic: only
 * an explicit `false` restricts.
 */
export function surfacePermissionAllows(
  permissions: SurfacePermissions,
  flag: SurfacePermissionFlag,
): boolean {
  return permissions[flag] !== false;
}

// ---------------------------------------------------------------------------
// SurfaceRequest
// ---------------------------------------------------------------------------

/**
 * One playback request for the Media Surface resolver. Pure data; the
 * decision instant is `now` (ISO 8601 with explicit offset) so expiry is
 * evaluated without any hidden clock.
 */
export interface SurfaceRequest {
  /** The canonical item to play (validated with the WFX-002 validator). */
  item: EntertainmentItem;
  /** Candidate realizations in caller order; per-element problems become typed exclusions. */
  realizations: readonly SurfaceRealization[];
  /** What the client device can actually do (WFX-002 `DeviceCapabilities`). */
  device: DeviceCapabilities;
  /** Per-mode permissions (default permissive). */
  permissions: SurfacePermissions;
  /** The decision instant — realization expiry is evaluated against it. */
  now: string;
}

// ---------------------------------------------------------------------------
// Request validation (caller misuse — typed throw, never a silent pass)
// ---------------------------------------------------------------------------

const MODE_STRINGS: readonly string[] = PLAYBACK_MODES;

function deviceProblems(device: unknown): string[] {
  if (!isRecord(device)) {
    return [`request.device: expected a DeviceCapabilities object, got ${previewValue(device)}`];
  }
  const problems: string[] = [];
  if (
    !Array.isArray(device.playbackModes) ||
    !device.playbackModes.every(
      (mode) => typeof mode === "string" && MODE_STRINGS.includes(mode),
    )
  ) {
    problems.push(
      `request.device.playbackModes: expected an array of PlaybackMode values (${PLAYBACK_MODES.join(" | ")}), got ${previewValue(device.playbackModes)}`,
    );
  }
  if (
    !Array.isArray(device.codecs) ||
    !device.codecs.every((codec) => typeof codec === "string" && codec.length > 0)
  ) {
    problems.push(
      `request.device.codecs: expected an array of non-empty codec strings, got ${previewValue(device.codecs)}`,
    );
  }
  if (typeof device.browser !== "boolean") {
    problems.push(
      `request.device.browser: expected a boolean, got ${previewValue(device.browser)}`,
    );
  }
  if (typeof device.backgroundPlayback !== "boolean") {
    problems.push(
      `request.device.backgroundPlayback: expected a boolean, got ${previewValue(device.backgroundPlayback)}`,
    );
  }
  if (typeof device.casting !== "boolean") {
    problems.push(
      `request.device.casting: expected a boolean, got ${previewValue(device.casting)}`,
    );
  }
  if (
    device.storageBytes !== undefined &&
    (typeof device.storageBytes !== "number" ||
      !Number.isFinite(device.storageBytes) ||
      device.storageBytes < 0)
  ) {
    problems.push(
      `request.device.storageBytes: expected a finite non-negative number when present, got ${previewValue(device.storageBytes)}`,
    );
  }
  return problems;
}

function permissionProblems(permissions: unknown): string[] {
  if (!isRecord(permissions)) {
    return [
      `request.permissions: expected a SurfacePermissions object, got ${previewValue(permissions)}`,
    ];
  }
  const problems: string[] = [];
  const flags: readonly SurfacePermissionFlag[] = [
    "nativePermitted",
    "browserAllowed",
    "externalAllowed",
  ];
  for (const flag of flags) {
    const value = permissions[flag];
    if (value !== undefined && typeof value !== "boolean") {
      problems.push(
        `request.permissions.${flag}: expected a boolean when present, got ${previewValue(value)}`,
      );
    }
  }
  const hints = permissions.providerHints;
  if (hints !== undefined) {
    if (!isRecord(hints)) {
      problems.push(
        `request.permissions.providerHints: expected a SurfaceProviderHints object when present, got ${previewValue(hints)}`,
      );
    } else {
      if (
        hints.preferredMode !== undefined &&
        !(typeof hints.preferredMode === "string" && MODE_STRINGS.includes(hints.preferredMode))
      ) {
        problems.push(
          `request.permissions.providerHints.preferredMode: expected one of ${PLAYBACK_MODES.join(" | ")} when present, got ${previewValue(hints.preferredMode)}`,
        );
      }
      if (hints.restrictionNote !== undefined && typeof hints.restrictionNote !== "string") {
        problems.push(
          `request.permissions.providerHints.restrictionNote: expected a string when present, got ${previewValue(hints.restrictionNote)}`,
        );
      }
    }
  }
  return problems;
}

/**
 * Validate the caller-supplied request CONTAINER. Throws the typed
 * `ExperienceError` with every collected problem when malformed (untyped JS
 * callers included). Per-realization shape problems are NOT checked here —
 * they are typed exclusions of the resolver, not caller misuse.
 */
export function assertValidSurfaceRequest(request: SurfaceRequest): void {
  if (!isRecord(request)) {
    throw new ExperienceError("request: expected a SurfaceRequest object");
  }
  const problems: string[] = [];
  const itemCheck = validateEntertainmentItem(request.item);
  if (!itemCheck.ok) {
    problems.push(...itemCheck.errors.map((message) => `request.item: ${message}`));
  }
  if (!Array.isArray(request.realizations)) {
    problems.push(
      `request.realizations: expected an array of PlaybackRealization, got ${previewValue(request.realizations)}`,
    );
  }
  problems.push(...deviceProblems(request.device));
  problems.push(...permissionProblems(request.permissions));
  if (!isIso8601(request.now)) {
    problems.push(
      `request.now: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-13T10:30:00.000Z), got ${previewValue(request.now)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}
