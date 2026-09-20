"use client";

/**
 * @wfx/app-web — the torrent stage's WebRTC environment probe (R23-D/E).
 *
 * A CLIENT island: on mount it probes the viewer's browser for WebRTC
 * (the R23-D adapter's environment truth — browser peers need
 * WebRTC-capable peers; ordinary TCP/UDP-only peers are unreachable from
 * a browser) and renders the honest sentence:
 *
 * - WebRTC present: "This browser can reach WebRTC-capable peer copies —
 *   browser playback is wired through the WebTorrent adapter."
 * - WebRTC absent / insecure context: the honest fallback sentence —
 *   the same authorized copy plays in the Desktop app's native player
 *   (never a workaround, never a dead end).
 *
 * In FIXTURES mode the scripted drive owns the acquisition lifecycle
 * (the loud dev badge — the same law as the acquisition fixtures); the
 * probe still reports the environment truth because capability truth is
 * never faked in either mode.
 */

import type { JSX } from "react";
import { useEffect, useState } from "react";

// CLIENT-SAFE: the probe island consumes ONLY the pure environment
// module (zero imports — the TorrentLibrary binding speaks the
// server-side @wfx/torrent-engine seam and must never enter a browser
// chunk).
import {
  browserTorrentEnvironmentSentence,
  detectBrowserTorrentEnvironment,
} from "@/platform/browser-torrent-environment";
import type { BrowserTorrentEnvironment } from "@/platform/browser-torrent-environment";

/** The probe's typed state (the environment read is client-side only). */
type ProbeState =
  | { readonly kind: "probing" }
  | { readonly kind: "read"; readonly environment: BrowserTorrentEnvironment };

export function TorrentStageProbe({ mode }: { readonly mode: "fixtures" | "service" }): JSX.Element {
  const [state, setState] = useState<ProbeState>({ kind: "probing" });

  useEffect(() => {
    // The honest client-side read (a server render pass answers
    // no-WebRTC; this runs only in the viewer's browser).
    setState({ kind: "read", environment: detectBrowserTorrentEnvironment() });
  }, []);

  return (
    <div data-wfx-torrent-probe={state.kind} data-wfx-torrent-probe-mode={mode}>
      {state.kind === "read" ? (
        <p
          className="wfx-player__trace"
          data-wfx-torrent-probe-webrtc={state.environment.webrtc ? "available" : "unavailable"}
        >
          {browserTorrentEnvironmentSentence(state.environment)}
          {mode === "fixtures"
            ? " The dev fixtures drive this copy's lifecycle (the loud dev badge) — the browser adapter is wired for real swarms."
            : ""}
        </p>
      ) : (
        <p className="wfx-player__trace" data-wfx-torrent-probe-webrtc="checking">
          Checking this browser&apos;s peer reachability…
        </p>
      )}
    </div>
  );
}
