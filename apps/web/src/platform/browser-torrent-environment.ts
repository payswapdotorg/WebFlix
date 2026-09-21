/**
 * @wfx/app-web — the browser torrent ENVIRONMENT truth (R23-D, client-safe).
 *
 * The PURE, dependency-free half of the browser torrent adapter: the
 * implementation identity string, the WebRTC environment probe, and the
 * honest environment sentence. This module imports NOTHING — it is the
 * ONLY part of the R23-D adapter a CLIENT component may import (the
 * TorrentLibrary binding in `browser-torrent.ts` speaks the
 * `@wfx/torrent-engine` seam, which is server-side; pulling it into a
 * browser chunk would drag node:fs through the client graph).
 */

// ---------------------------------------------------------------------------
// The adapter identity + the capability truth
// ---------------------------------------------------------------------------

/**
 * The browser adapter's identity (the same version-pin law as the Node
 * binding; surfaces in capability truth so the wired stack is always
 * inspectable — never a silent fixture-as-production claim).
 */
export const WEB_BROWSER_TORRENT_IMPLEMENTATION =
  "webtorrent@3.0.21 browser build (WebRTC peers; parse-torrent@11.0.24)";

/**
 * THE ADAPTER-DECLARED CAPABILITY TRUTH the R23-C rung decision consumes
 * (`TorrentPlatformTruth.browserTorrentSupported` on the web platform):
 * the Web adapter WIRES browser torrent playback through this adapter —
 * a real adapter path, not an assumption. Per-realization truth
 * (`browserCapable`) and per-environment truth (the WebRTC probe below)
 * still decide each play, with honest typed fallbacks — the capability
 * claim never outruns the adapter.
 */
export const WEB_BROWSER_TORRENT_SUPPORTED = true;

// ---------------------------------------------------------------------------
// The environment probe (WebRTC truth; client-side only)
// ---------------------------------------------------------------------------

/** The browser-torrent environment truth (the honest probe result). */
export interface BrowserTorrentEnvironment {
  /** Whether this context provides RTCPeerConnection (WebRTC peers). */
  readonly webrtc: boolean;
  /** Whether this context is a secure context (WebRTC requires it). */
  readonly secureContext: boolean;
}

/**
 * Probe the CURRENT context's WebRTC truth honestly. In a browser this
 * reads the live globals; in a server render pass (or any non-browser
 * host) every facility is honestly absent — the adapter answers the
 * typed browser-incompatible failure there, never a fabricated session.
 */
export function detectBrowserTorrentEnvironment(): BrowserTorrentEnvironment {
  const globals = globalThis as {
    RTCPeerConnection?: unknown;
    isSecureContext?: boolean;
    window?: { RTCPeerConnection?: unknown };
  };
  const rtc =
    typeof globals.RTCPeerConnection === "function" ||
    typeof globals.window?.RTCPeerConnection === "function";
  return {
    webrtc: rtc,
    secureContext: globals.isSecureContext !== false,
  };
}

/** The one-sentence user truth of one probe (rendered by the surfaces). */
export function browserTorrentEnvironmentSentence(
  environment: BrowserTorrentEnvironment,
): string {
  if (environment.webrtc && environment.secureContext) {
    return "This browser can reach WebRTC-capable peer copies — browser playback is wired through the WebTorrent adapter.";
  }
  if (!environment.secureContext) {
    return "Browser peer playback needs a secure context (https) — this page does not have one, so peer copies fall back to the Desktop app.";
  }
  return "This browser cannot reach peer copies (no WebRTC) — the same authorized copy plays in the Desktop app's native player.";
}

