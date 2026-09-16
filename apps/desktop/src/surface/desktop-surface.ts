/**
 * @wfx/app-desktop — the Desktop surface projection (R08).
 *
 * The thin, UI-framework-agnostic projection layer the native webview
 * frontend consumes: runtime STATE → view models, with ZERO duplicated
 * product logic (the shared client runtime owns navigation, playback
 * semantics, watch state, library, actions, intents — this surface only
 * PROJECTS them and frames the platform's truthful capability facts).
 *
 * The full product UI surfaces (the React tree over this projection)
 * are R09's media-surface/UX lane and R16's golden-journey lane; R08
 * delivers the projection contract those lanes render against — the same
 * law the web adapter follows (runtime state → UI, adapter-clean).
 *
 * Truth laws kept here:
 * - `capabilitySummary` is the DESCRIPTOR's truth (never a probe): what
 *   the platform can do, with the honest limitation notes verbatim.
 * - `activePlayback` snapshots are the runtime's truthful states —
 *   position evidence, buffering honesty, terminal phases (no ticker,
 *   no fabricated progress).
 * - Every read delegates to the runtime (no local folding, no caching
 *   theater).
 */

import type { ClientRuntime } from "@wfx/client-runtime";
import type { PlaybackState } from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import { supportsBrowserHost, supportsNativeMedia, supportsTorrentAcquisition } from "@wfx/platform-contracts";

/** The platform capability facts the surface renders (descriptor truth). */
export interface DesktopCapabilitySummary {
  readonly platform: PlatformCapabilities["platform"];
  readonly adapterId: string;
  readonly adapterVersion: string;
  /** Native/torrent-backed acquisition is truthfully available. */
  readonly torrentAcquisition: boolean;
  /** Native-mode playback is truthfully available. */
  readonly nativePlayback: boolean;
  /** A contained browser surface is truthfully available. */
  readonly containedBrowser: boolean;
  /** The background-work level, verbatim. */
  readonly backgroundWork: PlatformCapabilities["backgroundWork"];
  /** The storage kind, verbatim. */
  readonly storage: PlatformCapabilities["storage"];
  /** The honest per-area limitation notes (descriptor truth, verbatim). */
  readonly limitations: Readonly<Partial<Record<string, string>>>;
}

/** The Desktop surface: the runtime + capabilities, projected for the UI. */
export interface DesktopSurface {
  /** The truthful capability facts (the descriptor's own truth). */
  capabilitySummary(): DesktopCapabilitySummary;
  /** The runtime's active playback sessions, newest first (truthful states). */
  activePlayback(): readonly PlaybackState[];
  /** One playback session's truthful state (undefined when unknown). */
  playbackState(sessionId: string): PlaybackState | undefined;
  /** Observe one playback session's state changes until it terminates. */
  observePlayback(sessionId: string, listener: (state: PlaybackState) => void): () => void;
}

/**
 * Project the Desktop surface over the booted runtime + capabilities.
 * Pure projection: no state of its own beyond the runtime's own views.
 */
export function createDesktopSurface(
  runtime: ClientRuntime,
  capabilities: PlatformCapabilities,
): DesktopSurface {
  const descriptor = capabilities.descriptor;
  const summary: DesktopCapabilitySummary = {
    platform: capabilities.platform,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    torrentAcquisition: supportsTorrentAcquisition(capabilities),
    nativePlayback: supportsNativeMedia(capabilities),
    containedBrowser: supportsBrowserHost(capabilities),
    backgroundWork: capabilities.backgroundWork,
    storage: capabilities.storage,
    limitations: descriptor.limitations ?? {},
  };

  return {
    capabilitySummary(): DesktopCapabilitySummary {
      return { ...summary, limitations: { ...summary.limitations } };
    },

    activePlayback(): readonly PlaybackState[] {
      return runtime.playback.active();
    },

    playbackState(sessionId: string): PlaybackState | undefined {
      return runtime.playback.controller(sessionId)?.state();
    },

    observePlayback(sessionId: string, listener: (state: PlaybackState) => void): () => void {
      const controller = runtime.playback.controller(sessionId);
      if (controller === undefined) return () => undefined;
      return controller.subscribe(listener);
    },
  };
}
