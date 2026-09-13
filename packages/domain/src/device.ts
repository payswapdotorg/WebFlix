/**
 * Device capability contracts for playback-mode resolution (WFX-002).
 *
 * `DeviceCapabilities` describes what a client surface can actually do;
 * `canPlay` answers the frozen Media Surface question "can this device
 * realize this PlaybackMode?" with an explicit boolean — no guessing.
 *
 * canPlay semantics (deliberate, lead-visible):
 * - `playbackModes` is the device's own declaration; a mode not listed is
 *   not playable, full stop.
 * - `embed` and `browser` additionally require `browser: true`, because both
 *   modes render inside a web/browser surface (provider player embed or
 *   in-app browser). `native` and `external` rely only on the declaration
 *   (WebFlix-controlled media path / OS handoff).
 *
 * The presets below are FIXTURES (invariant 10: no hidden mocks) — explicit
 * reference values for tests and adapters, not runtime probes of real devices.
 */

import type { PlaybackMode } from "./contracts/frozen";

export interface DeviceCapabilities {
  /** Playback modes this device declares support for. */
  playbackModes: PlaybackMode[];
  /** Decodable audio/video codecs (informational for realization selection). */
  codecs: string[];
  /** Whether an in-app web/browser surface is available (required by embed + browser modes). */
  browser: boolean;
  /** Whether playback continues while the app is backgrounded. */
  backgroundPlayback: boolean;
  /** Approximate persistent storage available to the client, in bytes. */
  storageBytes?: number;
  /** Whether the device can cast playback to an external screen. */
  casting: boolean;
}

/**
 * Whether a device with these capabilities can realize the given playback mode.
 * Pure declaration-based check; codec matching happens per asset elsewhere.
 */
export function canPlay(capabilities: Readonly<DeviceCapabilities>, mode: PlaybackMode): boolean {
  if (!capabilities.playbackModes.includes(mode)) return false;
  if ((mode === "embed" || mode === "browser") && !capabilities.browser) return false;
  return true;
}

const modernWeb: DeviceCapabilities = {
  playbackModes: ["native", "embed", "browser", "external"],
  codecs: ["h264", "hevc", "vp9", "av1", "aac", "opus", "flac"],
  browser: true,
  // Browsers typically suspend background *video* playback; audio-only may continue.
  backgroundPlayback: false,
  storageBytes: 2 * 1024 * 1024 * 1024,
  casting: true,
};

/** Fixture: a modern evergreen web browser client (video-first assumptions). */
export const MODERN_WEB: Readonly<DeviceCapabilities> = Object.freeze(modernWeb);

const desktopNative: DeviceCapabilities = {
  playbackModes: ["native", "embed", "browser", "external"],
  codecs: ["h264", "hevc", "vp9", "av1", "aac", "opus", "flac"],
  browser: true,
  // Desktop shells keep playing while unfocused.
  backgroundPlayback: true,
  storageBytes: 100 * 1024 * 1024 * 1024,
  casting: false,
};

/** Fixture: the reference full-power desktop native client. */
export const DESKTOP_NATIVE: Readonly<DeviceCapabilities> = Object.freeze(desktopNative);
