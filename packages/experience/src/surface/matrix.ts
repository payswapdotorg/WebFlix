/**
 * @wfx/experience — Media Surface capability matrix (WFX-025, Lane C).
 *
 * Pure data describing the decision outcome for every
 * (device-profile × playback-mode) pair, for tests here and for the WFX-043
 * release acceptance later. The matrix is COMPUTED from the frozen inputs —
 * the WFX-002 `canPlay` declaration gate and the native codec-demand gate —
 * so it can never drift from the law it documents; the consistency test in
 * `tests/surface.test.ts` proves the resolver agrees with every row.
 *
 * The canonical probe per mode is ONE available, non-expired realization of
 * that mode offered under permissive permissions at the fixture instant:
 *
 * - native probe: capabilities `["playNative", "hevc"]` — carries the `hevc`
 *   media demand, so native rows demonstrate BOTH native gates (declaration
 *   and codec decodability).
 * - embed/browser/external probes: no media demands (their capabilities are
 *   frozen Capability values only) — the decision is the declaration gate.
 *
 * Device profiles (fixture data, product invariant 10 — explicit reference
 * values, not runtime probes of real devices):
 * - `tv-native`          — smart TV: native engine + OS deep-link handoff,
 *                          no in-app web surface (no embed, no browser mode).
 * - `desktop-full`       — the reference full-power desktop client; the
 *                          WFX-002 `DESKTOP_NATIVE` fixture verbatim.
 * - `mobile-restricted`  — managed mobile build: all four modes declared but
 *                          restricted codecs (no HEVC/AV1/FLAC decode), so
 *                          native playback is declaration-possible yet
 *                          codec-gated per asset.
 * - `kiosk-browser-only` — locked-down kiosk: in-app browser surface only —
 *                          no native engine, no embeds, no OS handoff.
 */

import type { DeviceCapabilities, PlaybackMode } from "@wfx/domain";
import { DESKTOP_NATIVE, canPlay } from "@wfx/domain";

import { PLAYBACK_MODE_PRECEDENCE } from "../use-cases/playback";
import type { SurfaceRealization } from "./request";
import { mediaDemands, undecodableDemands } from "./resolve";

// ---------------------------------------------------------------------------
// Device profiles
// ---------------------------------------------------------------------------

/** The canonical Media Surface device-profile identifiers (WFX-025). */
export type SurfaceDeviceProfileId =
  | "tv-native"
  | "desktop-full"
  | "mobile-restricted"
  | "kiosk-browser-only";

/** One named device profile: a label plus its `DeviceCapabilities`. */
export interface SurfaceDeviceProfile {
  id: SurfaceDeviceProfileId;
  label: string;
  device: Readonly<DeviceCapabilities>;
}

/** Fixture device: smart TV — native engine + external deep-link handoff, no web surface. */
export const SURFACE_TV_NATIVE_DEVICE: Readonly<DeviceCapabilities> = {
  playbackModes: ["native", "external"],
  codecs: ["h264", "hevc", "vp9", "av1", "aac"],
  browser: false,
  backgroundPlayback: true,
  storageBytes: 32 * 1024 * 1024 * 1024,
  casting: false,
};

/** Fixture device: the reference full-power desktop client (WFX-002 DESKTOP_NATIVE). */
export const SURFACE_DESKTOP_FULL_DEVICE: Readonly<DeviceCapabilities> = DESKTOP_NATIVE;

/** Fixture device: managed mobile build — all modes declared, restricted codecs. */
export const SURFACE_MOBILE_RESTRICTED_DEVICE: Readonly<DeviceCapabilities> = {
  playbackModes: ["native", "embed", "browser", "external"],
  codecs: ["h264", "vp9", "aac", "opus"],
  browser: true,
  backgroundPlayback: false,
  storageBytes: 16 * 1024 * 1024 * 1024,
  casting: true,
};

/** Fixture device: locked-down kiosk — in-app browser surface only. */
export const SURFACE_KIOSK_BROWSER_ONLY_DEVICE: Readonly<DeviceCapabilities> = {
  playbackModes: ["browser"],
  codecs: ["h264", "vp9", "aac", "opus"],
  browser: true,
  backgroundPlayback: false,
  storageBytes: 8 * 1024 * 1024 * 1024,
  casting: false,
};

/** The four canonical device profiles, in matrix row order. */
export const SURFACE_DEVICE_PROFILES: readonly SurfaceDeviceProfile[] = [
  {
    id: "tv-native",
    label: "Smart TV: native engine + OS deep-link handoff, no in-app web surface",
    device: SURFACE_TV_NATIVE_DEVICE,
  },
  {
    id: "desktop-full",
    label: "Reference full-power desktop client (WFX-002 DESKTOP_NATIVE)",
    device: SURFACE_DESKTOP_FULL_DEVICE,
  },
  {
    id: "mobile-restricted",
    label: "Managed mobile build: all modes declared, restricted codecs (no HEVC/AV1/FLAC)",
    device: SURFACE_MOBILE_RESTRICTED_DEVICE,
  },
  {
    id: "kiosk-browser-only",
    label: "Locked-down kiosk: in-app browser surface only — no native engine, no embeds, no OS handoff",
    device: SURFACE_KIOSK_BROWSER_ONLY_DEVICE,
  },
];

// ---------------------------------------------------------------------------
// Canonical per-mode probe realizations
// ---------------------------------------------------------------------------

/**
 * The canonical probe realization per mode — the single available,
 * non-expired realization the matrix offers under permissive permissions.
 * The native probe deliberately carries the `hevc` media demand so native
 * rows exercise the codec gate as well as the declaration gate.
 */
export const SURFACE_MATRIX_PROBES: Readonly<Record<PlaybackMode, SurfaceRealization>> = {
  native: {
    mode: "native",
    connectorId: "surface-matrix",
    externalRef: "surface:probe-native",
    capabilities: ["playNative", "hevc"],
  },
  embed: {
    mode: "embed",
    connectorId: "surface-matrix",
    externalRef: "surface:probe-embed",
    url: "https://surface.invalid/embed/probe",
    capabilities: ["playEmbed"],
  },
  browser: {
    mode: "browser",
    connectorId: "surface-matrix",
    externalRef: "surface:probe-browser",
    url: "https://surface.invalid/watch/probe",
    capabilities: ["playBrowser"],
  },
  external: {
    mode: "external",
    connectorId: "surface-matrix",
    externalRef: "surface:probe-external",
    url: "https://surface.invalid/open/probe",
    capabilities: ["playExternal"],
  },
};

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/**
 * Why a probe is (not) chosen on a profile:
 * - `chosen` — the resolver must select this mode for the probe.
 * - `rejected-device` — the profile does not declare the mode (WFX-002
 *   `canPlay` false, including the missing browser surface for embed/browser).
 * - `rejected-codecs` — the mode is declared but the probe's media demands
 *   are not decodable by the profile (native rows only).
 */
export type SurfaceMatrixDecision = "chosen" | "rejected-device" | "rejected-codecs";

/** One (device-profile × mode) cell of the capability matrix. */
export interface SurfaceMatrixRow {
  /** The device profile (row group). */
  profile: SurfaceDeviceProfileId;
  /** The probe's playback mode (frozen precedence order within a profile). */
  mode: PlaybackMode;
  /** Whether the profile's device declares the mode (WFX-002 canPlay). */
  deviceSupports: boolean;
  /** The probe's media demands (native probe carries ["hevc"]; others none). */
  demands: readonly string[];
  /** Whether the profile decodes every demand (always true for non-native rows). */
  demandsDecodable: boolean;
  /** The decision the resolver must produce for this probe. */
  decision: SurfaceMatrixDecision;
}

/**
 * The full capability matrix: 4 device profiles × 4 playback modes = 16 rows,
 * deterministic order (profile order × frozen precedence order). Pure data —
 * two calls return deeply equal rows; the resolver is never invoked here.
 */
export function capabilityMatrix(): readonly SurfaceMatrixRow[] {
  const rows: SurfaceMatrixRow[] = [];
  for (const profile of SURFACE_DEVICE_PROFILES) {
    for (const mode of PLAYBACK_MODE_PRECEDENCE) {
      const probe = SURFACE_MATRIX_PROBES[mode];
      const demands = mediaDemands(probe);
      const deviceSupports = canPlay(profile.device, mode);
      const demandsDecodable =
        mode !== "native" || undecodableDemands(probe, profile.device).length === 0;
      const decision: SurfaceMatrixDecision = !deviceSupports
        ? "rejected-device"
        : !demandsDecodable
          ? "rejected-codecs"
          : "chosen";
      rows.push({ profile: profile.id, mode, deviceSupports, demands, demandsDecodable, decision });
    }
  }
  return rows;
}
