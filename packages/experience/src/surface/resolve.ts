/**
 * @wfx/experience — Media Surface resolver (WFX-025, Lane C).
 *
 * `resolveSurface` is THE frozen precedence, implemented exactly
 * (docs/architecture/webflix-frozen-architecture.md, "Playback resolution"):
 *
 *   1. Native — when WebFlix controls the media path (a native realization
 *      exists) and the device can play it (WFX-002 `canPlay` plus the
 *      realization's codec/container demands) and the authorized-media
 *      permission allows it (`nativePermitted`).
 *   2. Official embed — when the provider exposes a supported player contract
 *      (an embed realization exists) and the device supports embedding
 *      (WFX-002 `canPlay`, which requires the browser surface).
 *   3. In-app browser — when provider web playback is permitted
 *      (`browserAllowed`) and the device has a browser surface.
 *   4. External handoff — otherwise (`externalAllowed`).
 *
 * Browser mode is a UX surface, not a mechanism for defeating provider
 * security (frozen architecture); the permission flags are the honest,
 * typed representation of those boundaries.
 *
 * Every decision is AUDITABLE: the success result carries a
 * `precedenceTrace` with exactly one line per mode (in frozen precedence
 * order) explaining why that mode was accepted, rejected, or skipped after a
 * higher-precedence mode won; the unresolvable result carries EVERY
 * exclusion reason (per-realization triage lines plus per-mode rejections).
 *
 * Gate order per mode (deterministic, short-circuit — the FIRST failing gate
 * is the recorded causal reason for that mode):
 *
 *   presence -> device (WFX-002 canPlay) -> permission -> viability -> codec demands (native only)
 *
 * Realization triage (before the mode walk) excludes candidates with a
 * recorded reason when they fail the WFX-002 shape validator, claim
 * non-availability (`unknown`/`unavailable`; a missing claim passes — see
 * `request.ts`), or are expired (`expiresAt` at or before `now` — a
 * realization expiring exactly at the decision instant is no longer usable;
 * safe-side interpretation).
 *
 * Determinism: no `Date.now()`, no `Math.random()`, no hidden state — the
 * same request always yields the identical resolution (order of candidates
 * is the caller's array order; within a mode the FIRST candidate passing all
 * gates wins).
 */

import type {
  DeviceCapabilities,
  PlaybackMode,
  PlaybackRealization,
} from "@wfx/domain";
import {
  CAPABILITIES,
  PLAYBACK_MODES,
  canPlay,
  isRecord,
  validatePlaybackRealization,
} from "@wfx/domain";

import { PLAYBACK_MODE_PRECEDENCE } from "../use-cases/playback";
import type { SurfacePermissions, SurfaceRealization, SurfaceRequest } from "./request";
import {
  assertValidSurfaceRequest,
  surfaceAvailability,
  surfacePermissionAllows,
} from "./request";

// ---------------------------------------------------------------------------
// SurfaceResolution — the typed result (no fake success, no silent skip)
// ---------------------------------------------------------------------------

/**
 * The resolver's decision.
 *
 * - `ok: true` — `chosen` is the winning realization (a frozen
 *   `PlaybackRealization`), `mode` its playback mode (always equal to
 *   `chosen.mode`), `precedenceTrace` one audit line per mode in frozen
 *   precedence order, and `itemId` the canonical item of the request (the
 *   additive field that lets `buildPlaybackSession` construct the frozen
 *   `PlaybackSession`, which requires `itemId`, without hidden state).
 * - `ok: false` — a total dead end: `reasons` carries every per-realization
 *   exclusion and every per-mode rejection.
 */
export type SurfaceResolution =
  | {
      ok: true;
      itemId: string;
      chosen: PlaybackRealization;
      mode: PlaybackMode;
      precedenceTrace: string[];
    }
  | {
      ok: false;
      kind: "unresolvable";
      reasons: string[];
    };

// ---------------------------------------------------------------------------
// Media demands (codec/container) — the native gate's second half
// ---------------------------------------------------------------------------

/** The frozen Capability vocabulary (runtime set). */
const FROZEN_CAPABILITIES: ReadonlySet<string> = new Set<string>(CAPABILITIES);

/**
 * The media demands (codec/container) a realization carries: entries of its
 * `capabilities` that are NOT frozen `Capability` values. The frozen
 * `PlaybackRealization.capabilities` is a free-form string array; connector
 * capability names (`playNative`, …) are play-contract statements, and every
 * other entry names a concrete media requirement the native pipeline must be
 * able to decode.
 *
 * Demands gate NATIVE mode only: embed/browser render through the provider's
 * own player or web stack, and external hands playback to the provider, so
 * the WebFlix device codec list is not the deciding capability there
 * (WFX-002: "codec matching happens per asset" — the native asset).
 */
export function mediaDemands(realization: PlaybackRealization): string[] {
  return realization.capabilities.filter((entry) => !FROZEN_CAPABILITIES.has(entry));
}

/**
 * The demands of a realization the device cannot decode (case-insensitive
 * comparison — codec names are conventionally lowercase but the contract is
 * a free-form string array).
 */
export function undecodableDemands(
  realization: PlaybackRealization,
  device: DeviceCapabilities,
): string[] {
  const decodable = new Set(device.codecs.map((codec) => codec.toLowerCase()));
  return mediaDemands(realization).filter((demand) => !decodable.has(demand.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Realization triage — shape, availability, expiry (typed exclusions)
// ---------------------------------------------------------------------------

/**
 * One triaged candidate. Viable candidates carry their (shape-validated)
 * mode; excluded candidates carry the claimed mode when it was readable and
 * short + full exclusion reasons.
 */
type SurfaceTriage =
  | {
      viable: true;
      index: number;
      realization: SurfaceRealization;
      mode: PlaybackMode;
    }
  | {
      viable: false;
      index: number;
      claimedMode: PlaybackMode | null;
      shortReason: string;
      fullReason: string;
    };

function triageRealizations(
  realizations: readonly SurfaceRealization[],
  now: string,
  nowMs: number,
): SurfaceTriage[] {
  const entries: SurfaceTriage[] = [];
  realizations.forEach((realization, index) => {
    // Gate 1: frozen shape (WFX-002 validator). A broken realization is never
    // adopted, never repaired — recorded and excluded.
    const shape = validatePlaybackRealization(realization);
    if (!shape.ok) {
      entries.push({
        viable: false,
        index,
        claimedMode: claimedModeOf(realization),
        shortReason: "invalid shape",
        fullReason: `realization #${index}: invalid shape (${shape.errors.join("; ")})`,
      });
      return;
    }
    // Gate 2: availability claim (absent = no claim = passes; see request.ts).
    const availability = surfaceAvailability(realization);
    if (availability.effective !== "available") {
      entries.push({
        viable: false,
        index,
        claimedMode: realization.mode,
        shortReason: availability.description,
        fullReason: `realization #${index} (${realization.mode}, connector '${realization.connectorId}'): ${availability.description}`,
      });
      return;
    }
    // Gate 3: expiry — expiresAt at or before `now` is expired (safe-side).
    const expiresAt = realization.expiresAt;
    if (expiresAt !== undefined && Date.parse(expiresAt) <= nowMs) {
      entries.push({
        viable: false,
        index,
        claimedMode: realization.mode,
        shortReason: `expired at ${expiresAt}`,
        fullReason: `realization #${index} (${realization.mode}, connector '${realization.connectorId}'): expired at ${expiresAt} (now ${now})`,
      });
      return;
    }
    entries.push({ viable: true, index, realization, mode: realization.mode });
  });
  return entries;
}

/** Safe read of a candidate's claimed mode (null when absent/unreadable/invalid). */
function claimedModeOf(realization: SurfaceRealization): PlaybackMode | null {
  if (!isRecord(realization)) return null;
  const mode: unknown = realization.mode;
  if (typeof mode === "string" && (PLAYBACK_MODES as readonly string[]).includes(mode)) {
    return mode as PlaybackMode;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mode-gate rejection lines (deterministic formats — asserted by tests)
// ---------------------------------------------------------------------------

function deviceRejection(mode: PlaybackMode, device: DeviceCapabilities): string {
  return `${mode}: rejected — device cannot realize ${mode} playback (canPlay=false; device declares [${device.playbackModes.join(", ")}]; browser surface: ${device.browser ? "yes" : "no"})`;
}

/**
 * The per-mode permission gate (embed deliberately has none — frozen step 2
 * is capability-gated, not permission-gated). Returns the rejection line, or
 * null when the mode is permitted.
 */
function permissionRejection(mode: PlaybackMode, permissions: SurfacePermissions): string | null {
  if (mode === "native" && !surfacePermissionAllows(permissions, "nativePermitted")) {
    return "native: rejected — native playback not permitted (nativePermitted=false)";
  }
  if (mode === "browser" && !surfacePermissionAllows(permissions, "browserAllowed")) {
    return "browser: rejected — browser playback not allowed (browserAllowed=false)";
  }
  if (mode === "external" && !surfacePermissionAllows(permissions, "externalAllowed")) {
    return "external: rejected — external handoff not allowed (externalAllowed=false)";
  }
  return null;
}

function acceptLine(mode: PlaybackMode, index: number, connectorId: string): string {
  return `${mode}: accepted — realization #${index} from connector '${connectorId}'`;
}

// ---------------------------------------------------------------------------
// resolveSurface — THE frozen precedence walk
// ---------------------------------------------------------------------------

/**
 * Resolve ONE playback request to ONE realization mode by the frozen
 * precedence (Native -> Embed -> Browser -> External).
 *
 * The walk visits modes in precedence order and applies the gates in the
 * documented order (presence -> device -> permission -> viability -> codec
 * demands). The first mode with a candidate passing every gate wins; every
 * later mode is recorded as skipped, not rejected — the honest audit of a
 * decision that was never needed. When NO mode wins, the result is the typed
 * `unresolvable` failure with EVERY exclusion reason.
 *
 * Malformed request containers throw the typed `ExperienceError` (caller
 * misuse — see `assertValidSurfaceRequest`); every per-realization condition
 * is a typed exclusion instead.
 */
export function resolveSurface(request: SurfaceRequest): SurfaceResolution {
  assertValidSurfaceRequest(request);
  const nowMs = Date.parse(request.now);
  const entries = triageRealizations(request.realizations, request.now, nowMs);

  // Every per-realization exclusion, in input order (for the dead-end report).
  const exclusions: string[] = [];
  for (const entry of entries) {
    if (!entry.viable) exclusions.push(entry.fullReason);
  }

  const modeLines: string[] = [];
  let winner: { mode: PlaybackMode; realization: PlaybackRealization; index: number } | undefined;

  for (const mode of PLAYBACK_MODE_PRECEDENCE) {
    if (winner !== undefined) {
      modeLines.push(`${mode}: skipped — precedence satisfied by '${winner.mode}'`);
      continue;
    }

    // Gate 1: is there any candidate claiming this mode at all?
    const ofMode = entries.filter((entry) =>
      entry.viable ? entry.mode === mode : entry.claimedMode === mode,
    );
    if (ofMode.length === 0) {
      modeLines.push(`${mode}: rejected — no ${mode} realization present`);
      continue;
    }

    // Gate 2: can the device realize this mode at all? (WFX-002 canPlay)
    if (!canPlay(request.device, mode)) {
      modeLines.push(deviceRejection(mode, request.device));
      continue;
    }

    // Gate 3: is the mode permitted? (embed has no permission gate)
    const permissionLine = permissionRejection(mode, request.permissions);
    if (permissionLine !== null) {
      modeLines.push(permissionLine);
      continue;
    }

    // Gate 4: did any candidate of this mode survive triage?
    const viableOfMode = ofMode.filter((entry) => entry.viable);
    if (viableOfMode.length === 0) {
      const excluded = ofMode
        .map((entry) => (entry.viable ? "" : `#${entry.index} ${entry.shortReason}`))
        .filter((part) => part.length > 0)
        .join("; ");
      modeLines.push(
        `${mode}: rejected — no viable ${mode} realization (excluded: ${excluded})`,
      );
      continue;
    }

    // Gate 5 (native only): can the device decode the candidate's media demands?
    if (mode === "native") {
      const codecFailures: string[] = [];
      let chosen: { index: number; realization: SurfaceRealization } | undefined;
      for (const candidate of viableOfMode) {
        const undecodable = undecodableDemands(candidate.realization, request.device);
        if (undecodable.length === 0) {
          chosen = candidate;
          break;
        }
        codecFailures.push(
          `#${candidate.index}: demands [${undecodable.join(", ")}] not decodable by device codecs [${request.device.codecs.join(", ")}]`,
        );
      }
      if (chosen === undefined) {
        modeLines.push(
          `native: rejected — no decodable native realization (${codecFailures.join("; ")})`,
        );
        continue;
      }
      winner = { mode, realization: chosen.realization, index: chosen.index };
      modeLines.push(acceptLine(mode, chosen.index, chosen.realization.connectorId));
      continue;
    }

    // First viable candidate wins (deterministic: caller's array order).
    const first = viableOfMode[0];
    if (first === undefined) {
      continue; // unreachable: viableOfMode is non-empty here (defensive only)
    }
    winner = { mode, realization: first.realization, index: first.index };
    modeLines.push(acceptLine(mode, first.index, first.realization.connectorId));
  }

  if (winner !== undefined) {
    const precedenceTrace = [...modeLines];
    const hints = request.permissions.providerHints;
    if (hints !== undefined && hints.preferredMode !== undefined) {
      precedenceTrace.push(
        `hint: provider prefers '${hints.preferredMode}' — advisory only, frozen precedence decides`,
      );
    }
    return {
      ok: true,
      itemId: request.item.id,
      chosen: winner.realization,
      mode: winner.mode,
      precedenceTrace,
    };
  }

  return {
    ok: false,
    kind: "unresolvable",
    reasons: [
      `unresolvable: no playback mode could be realized for item '${request.item.id}'`,
      ...exclusions,
      ...modeLines,
    ],
  };
}
