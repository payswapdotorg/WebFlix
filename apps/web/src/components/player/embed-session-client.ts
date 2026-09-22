"use client";

/**
 * @wfx/app-web — the PROVIDER EMBED SESSION CLIENT (R26-W2: client-side
 * realization control for the embed rung — the YouTube interaction
 * grammar's honest backing).
 *
 * THE PROBLEM THIS MODULE FIXES (the corrective takeover's production
 * truth): for an `embed` realization the REAL player is the provider's own
 * player inside the contained sandboxed iframe — opaque to WebFlix by the
 * frozen security law (never injected into, never inspected). Until now
 * that opacity meant WebFlix's transport bar could not start, seek, or
 * truthfully phase the playback: pressing WebFlix's Play recorded an
 * intent on a server-side session whose phase could never advance (no
 * evidence channel existed), so the user saw "Buffering" forever while
 * the real first frame required knowing to click inside the iframe.
 *
 * THE LAWFUL CHANNEL (the packet's named fix direction, "client-side
 * realization control for embeds"): the provider's OWN sanctioned embed
 * control contract. YouTube's documented embedding surface exposes its
 * player control API over postMessage to the embedder: the provider's
 * player inside the iframe LISTENS for commands (playVideo / pauseVideo /
 * seekTo / setVolume / setPlaybackRate) and BROADCASTS its state (the
 * infoDelivery events: playerState, currentTime, duration, volume,
 * playbackRate) to the embedding page. Binding that surface:
 *
 * - is NOT script injection (no WebFlix code runs inside the provider's
 *   page — the sandbox discipline is unchanged, the iframe stays an
 *   opaque-origin, cookie-isolated, provider-owned surface);
 * - is NOT content inspection (the provider PUBLISHES these events to
 *   the embedder; WebFlix never reads anything the provider did not send
 *   to its embedder on purpose);
 * - is NOT a DRM/control bypass (the API exists only where the provider
 *   allows embedding; protected content simply does not embed);
 * - is the realization ITSELF exposing its controls — the honest
 *   "realization-exposed" backing, now bound through WebFlix's familiar
 *   chrome instead of requiring the user to hunt for the in-frame
 *   controls.
 *
 * THE EVIDENCE LAW (frozen, unchanged): WebFlix's phase becomes
 * "playing" ONLY when the provider's own broadcast says the player is
 * playing. No ticker, no extrapolation, no fabricated success: if the
 * provider's API never answers (a non-YouTube embed, a stripped-down
 * provider player, a blocked postMessage), the handshake times out and
 * the surface keeps the HONEST fallback — the server session's truthful
 * states plus the "this way of watching carries its own controls"
 * disclosure, exactly as before.
 *
 * THE DURABLE WATCH STATE: real provider progress folds through the SAME
 * closed vocabulary the runtime's watch-state engine defines — throttled
 * `progress` reports and the provider's own `ended` signal (→ `complete`)
 * POST to /api/events. `"start"` stays the runtime controller's own fold
 * (the chrome's play command through /api/playback) — never duplicated
 * here.
 */

import { recordPlaybackMarker } from "@/host/playback-telemetry";

// ---------------------------------------------------------------------------
// The public state (the chrome's read surface)
// ---------------------------------------------------------------------------

/** The provider's own player states (the YouTube vocabulary, provider-reported). */
export type EmbedPlayerPhase = "unstarted" | "buffering" | "playing" | "paused" | "ended";

/** The embed control state — every field is provider-reported evidence or the honest absent. */
export interface EmbedControlState {
  /** Whether the provider's embed API answered the listening handshake. */
  readonly live: boolean;
  /** Whether the handshake settled (answered or timed out) — the fallback decision's input. */
  readonly settled: boolean;
  /** The provider's reported player state (evidence only — never guessed). */
  readonly phase: EmbedPlayerPhase;
  /** The provider's reported position (ms). */
  readonly positionMs: number;
  /** The provider's reported duration (ms); null until reported. */
  readonly durationMs: number | null;
  /** The provider's reported loaded fraction (0..1); null until reported. */
  readonly loadedFraction: number | null;
  /** The provider's reported volume (0..1); null until reported. */
  readonly volume: number | null;
  /** The provider's reported mute truth; null until reported. */
  readonly muted: boolean | null;
  /** The provider's reported playback rate; null until reported. */
  readonly rate: number | null;
  /** Which provider family the bound surface speaks ("unknown" until the first answer). */
  readonly provider: "youtube" | "unknown";
}

/**
 * The STABLE idle snapshot — a CACHED module constant (the
 * `useSyncExternalStore` law: `getServerSnapshot` must return a stable
 * reference, never a fresh object per call — the fresh-object form threw
 * React's "result of getServerSnapshot should be cached" warning during
 * hydration, reproduced on the real-catalog player page).
 */
const IDLE_EMBED_CONTROL_SNAPSHOT: EmbedControlState = {
  live: false,
  settled: false,
  phase: "unstarted",
  positionMs: 0,
  durationMs: null,
  loadedFraction: null,
  volume: null,
  muted: null,
  rate: null,
  provider: "unknown",
};

/** The idle snapshot (no stage bound — the chrome's pre-hydration truth). */
export function idleEmbedControlSnapshot(): EmbedControlState {
  return IDLE_EMBED_CONTROL_SNAPSHOT;
}

// ---------------------------------------------------------------------------
// The module store (one active embed surface per player page — the same
// discipline the realtime session client keeps)
// ---------------------------------------------------------------------------

let state: EmbedControlState = idleEmbedControlSnapshot();
const listeners = new Set<() => void>();

function publish(next: EmbedControlState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Subscribe to the embed control state (useSyncExternalStore's contract). */
export function subscribeActiveEmbedControl(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current snapshot (useSyncExternalStore's contract). */
export function getActiveEmbedControl(): EmbedControlState {
  return state;
}

// ---------------------------------------------------------------------------
// The controller (the EmbedStage binds it; the chrome dispatches through it)
// ---------------------------------------------------------------------------

/** The bound embed surface's command surface (the provider's own API). */
export interface EmbedSessionController {
  play(): void;
  pause(): void;
  /** Seek to an absolute position (ms) through the provider's API. */
  seek(positionMs: number): void;
  /** Set the volume (0..1) through the provider's API. */
  setVolume(volume01: number): void;
  setMuted(muted: boolean): void;
  /** Set the playback rate through the provider's API. */
  setRate(rate: number): void;
}

/** The active controller (null before the EmbedStage binds / after it unbinds). */
let controller: EmbedSessionController | null = null;

/** The active embed session controller (the chrome resolves it at dispatch time). */
export function getActiveEmbedSessionController(): EmbedSessionController | null {
  return controller;
}

// ---------------------------------------------------------------------------
// The YouTube embed control protocol (the provider's documented surface)
// ---------------------------------------------------------------------------

/** Map the provider's numeric player state onto the typed phase (evidence only). */
function phaseOfPlayerState(playerState: number): EmbedPlayerPhase | null {
  switch (playerState) {
    case -1:
      return "unstarted";
    case 0:
      return "ended";
    case 1:
      return "playing";
    case 2:
      return "paused";
    case 3:
      return "buffering";
    case 5:
      return "unstarted"; // cued — not yet playing (the honest truth)
    default:
      return null;
  }
}

/** The watch-state progress report's throttle window (ms). */
const PROGRESS_REPORT_INTERVAL_MS = 5_000;

/** The handshake timeout: no provider answer within this window ⇒ the honest fallback. */
const HANDSHAKE_TIMEOUT_MS = 3_000;

/** The live poll cadence (ms) — the provider's own getters answer with evidence. */
const POLL_INTERVAL_MS = 1_000;

/** The mutable working copy (the evidence fold's scratch shape). */
type MutableEmbedControlState = { -readonly [K in keyof EmbedControlState]: EmbedControlState[K] };

/** The bind configuration (the EmbedStage's mount truth). */
export interface BindEmbedSessionConfig {
  readonly iframe: HTMLIFrameElement;
  /** The provider family the embed URL identifies (YouTube embeds today). */
  readonly provider: "youtube" | "unknown";
  /** The canonical item id (the watch-state reports' binding). */
  readonly itemId: string;
  /** The page's playback session id (the reports' correlation). */
  readonly playbackSessionId: string;
}

/**
 * Bind the active embed session: attach the provider's control contract to
 * the mounted iframe, run the listening handshake, translate the
 * provider's broadcasts into the typed evidence state, and fold real
 * progress into the durable watch state through the closed /api/events
 * vocabulary. Returns the controller (also reachable through
 * {@link getActiveEmbedSessionController}) and an unbind for the stage's
 * cleanup.
 */
export function bindActiveEmbedSession(config: BindEmbedSessionConfig): {
  readonly controller: EmbedSessionController;
  readonly unbind: () => void;
} {
  const { iframe } = config;
  let disposed = false;
  let handshakeSettled = false;
  let lastReportedPositionMs = -1;
  let lastReportAt = 0;
  let firstFrameMarked = false;
  let rebufferMarked = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  publish({
    ...idleEmbedControlSnapshot(),
    provider: config.provider,
    // The stage renders before any evidence: the honest pre-handshake truth.
    phase: "unstarted",
  });

  /**
   * Send one protocol message to the provider's player — the provider's
   * OWN widget API message form (verified against
   * `www-widgetapi.js`'s `sendMessage`: every message carries the widget
   * `id` and the provider's `channel: "widget"`; the provider's answers
   * echo both). Best-effort; a refused postMessage (a closed/changed
   * window) degrades to the honest fallback path — never a crash, never
   * a fabricated state.
   */
  const send = (payload: Record<string, unknown>): void => {
    if (disposed) return;
    try {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ ...payload, id: "wfx-embed", channel: "widget" }),
        "*",
      );
    } catch {
      // A refused postMessage (a closed/changed window) degrades to the
      // honest fallback path — never a crash, never a fabricated state.
    }
  };

  const command = (func: string, args: readonly unknown[] = []): void => {
    send({ event: "command", func, args });
  };

  /** Fold the provider's evidence into the typed state (the only state mover). */
  const applyEvidence = (info: {
    playerState?: unknown;
    currentTime?: unknown;
    duration?: unknown;
    videoLoadedFraction?: unknown;
    volume?: unknown;
    muted?: unknown;
    playbackRate?: unknown;
  }): void => {
    if (disposed) return;
    const next: MutableEmbedControlState = { ...getActiveEmbedControl() };
    if (!handshakeSettled) {
      handshakeSettled = true;
      next.live = true;
      next.settled = true;
      next.provider = "youtube";
    }
    if (typeof info.playerState === "number") {
      const phase = phaseOfPlayerState(info.playerState);
      if (phase !== null) next.phase = phase;
    }
    if (typeof info.currentTime === "number" && Number.isFinite(info.currentTime) && info.currentTime >= 0) {
      next.positionMs = info.currentTime * 1000;
    }
    if (typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration > 0) {
      next.durationMs = info.duration * 1000;
    }
    if (
      typeof info.videoLoadedFraction === "number" &&
      Number.isFinite(info.videoLoadedFraction) &&
      info.videoLoadedFraction >= 0
    ) {
      next.loadedFraction = Math.min(1, info.videoLoadedFraction);
    }
    if (typeof info.volume === "number" && Number.isFinite(info.volume)) {
      next.volume = Math.min(1, Math.max(0, info.volume / 100));
    }
    if (typeof info.muted === "boolean") next.muted = info.muted;
    if (typeof info.playbackRate === "number" && Number.isFinite(info.playbackRate)) {
      next.rate = info.playbackRate;
    }
    publish(next);

    // The evidence-derived telemetry markers (the real first frame, the
    // real rebuffers — the provider's own truth, never synthesized).
    if (next.live && next.phase === "playing" && !firstFrameMarked) {
      firstFrameMarked = true;
      rebufferMarked = false;
      recordPlaybackMarker("first-frame-rendered", "the provider's own player reported playing");
    }
    if (next.live && next.phase === "buffering" && firstFrameMarked && !rebufferMarked) {
      rebufferMarked = true;
      recordPlaybackMarker("rebuffer-started", "the provider's own player reported buffering");
    }
    if (next.live && next.phase === "playing" && rebufferMarked) {
      rebufferMarked = false;
      recordPlaybackMarker("rebuffer-ended", "the provider's own player resumed");
    }

    // The durable watch-state folds (the closed vocabulary — progress
    // throttled, complete on the provider's own ended signal).
    void reportProgress(next);
  };

  /** Fold real progress into the durable watch state (throttled). */
  const reportProgress = (snapshot: EmbedControlState): void => {
    if (disposed || config.itemId.length === 0) return;
    if (snapshot.phase === "ended") {
      if (lastReportedPositionMs !== -2) {
        lastReportedPositionMs = -2; // the complete report fires once
        void fireWatchReport("complete", snapshot.durationMs ?? snapshot.positionMs);
      }
      return;
    }
    if (snapshot.phase !== "playing" && snapshot.phase !== "paused") return;
    const now = Date.now();
    if (now - lastReportAt < PROGRESS_REPORT_INTERVAL_MS) return;
    if (snapshot.positionMs === lastReportedPositionMs) return;
    lastReportAt = now;
    lastReportedPositionMs = snapshot.positionMs;
    void fireWatchReport("progress", snapshot.positionMs);
  };

  /** One watch-state report through the closed /api/events vocabulary. */
  const fireWatchReport = async (type: "progress" | "complete", positionMs: number): Promise<void> => {
    try {
      await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: type === "complete",
        body: JSON.stringify({
          itemId: config.itemId,
          type,
          payload: {
            playbackSessionId: config.playbackSessionId,
            positionMs: Math.max(0, Math.round(positionMs)),
          },
        }),
      });
    } catch {
      // A lost report stays lost (the honest EventSink law surfaces
      // failures on the explicit report controls; the next throttled
      // report carries the position again).
    }
  };

  /** The provider's broadcast listener (source-checked, shape-guarded). */
  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
    // The sandboxed provider frame's origin is opaque ("null") — the
    // sender check is the WINDOW itself (the exact frame we bound).
    if (event.source !== iframe.contentWindow) return;
    if (typeof event.data !== "string" || event.data.length === 0 || event.data.charCodeAt(0) !== 123) {
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const kind = parsed.event;
    if (kind === "infoDelivery" || kind === "initialDelivery") {
      const info = parsed.info;
      if (typeof info === "object" && info !== null) {
        applyEvidence(info as Record<string, unknown>);
      }
      return;
    }
    if (kind === "onStateChange") {
      const info = parsed.info;
      const rawState =
        typeof info === "object" && info !== null
          ? (info as Record<string, unknown>).playerState
          : parsed.playerState;
      if (typeof rawState === "number") {
        applyEvidence({ playerState: rawState });
      }
    }
  };

  /** The live poll (the provider's own getters answer with evidence). */
  const startPolling = (): void => {
    if (pollTimer !== null || disposed) return;
    pollTimer = setInterval(() => {
      if (disposed) return;
      const snapshot = getActiveEmbedControl();
      if (!snapshot.live) return;
      command("getCurrentTime");
      command("getPlayerState");
      if (snapshot.durationMs === null) command("getDuration");
    }, POLL_INTERVAL_MS);
  };

  // THE LISTENING HANDSHAKE: sent when the frame loads (and retried once
  // after a short delay — the provider's player script must be up first).
  const handshake = (): void => {
    if (disposed || handshakeSettled) return;
    send({ event: "listening", id: "wfx-embed", channel: "wfx-embed" });
  };

  // The honest timeout: no provider answer ⇒ the API is not there for
  // this embed — the surface keeps the server session's truthful states
  // and the "carries its own controls" disclosure (never a fake live).
  // R26-W2 (corrective): the window is measured FROM THE FRAME'S LOAD — a
  // slow-loading provider frame (cold provider assets, first embed of the
  // session) used to settle the fallback BEFORE the provider's player
  // script even existed, permanently killing a channel that would have
  // answered; the load event now re-arms the window so the provider gets
  // its full chance after its player is actually up.
  let handshakeTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (disposed || handshakeSettled) return;
    handshakeSettled = true;
    publish({ ...getActiveEmbedControl(), live: false, settled: true });
  }, HANDSHAKE_TIMEOUT_MS);

  const rearmHandshakeTimeout = (): void => {
    if (handshakeTimeout !== null) clearTimeout(handshakeTimeout);
    handshakeTimeout = setTimeout(() => {
      if (disposed || handshakeSettled) return;
      handshakeSettled = true;
      publish({ ...getActiveEmbedControl(), live: false, settled: true });
    }, HANDSHAKE_TIMEOUT_MS);
  };

  const onLoad = (): void => {
    if (disposed || handshakeSettled) return;
    rearmHandshakeTimeout();
    handshake();
  };
  iframe.addEventListener("load", onLoad);
  handshake();
  const handshakeRetry = setTimeout(handshake, 800);

  window.addEventListener("message", onMessage);

  const boundController: EmbedSessionController = {
    play(): void {
      command("playVideo");
    },
    pause(): void {
      command("pauseVideo");
    },
    seek(positionMs: number): void {
      const seconds = Math.max(0, positionMs / 1000);
      command("seekTo", [seconds, true]);
    },
    setVolume(volume01: number): void {
      command("setVolume", [Math.round(Math.min(1, Math.max(0, volume01)) * 100)]);
    },
    setMuted(muted: boolean): void {
      command(muted ? "mute" : "unMute");
    },
    setRate(rate: number): void {
      command("setPlaybackRate", [rate]);
    },
  };

  // The poll starts once the handshake answers (live evidence only).
  const liveWatch = setInterval(() => {
    if (getActiveEmbedControl().live) {
      clearInterval(liveWatch);
      startPolling();
    }
  }, 250);

  controller = boundController;

  const unbind = (): void => {
    if (disposed) return;
    disposed = true;
    iframe.removeEventListener("load", onLoad);
    window.removeEventListener("message", onMessage);
    clearTimeout(handshakeRetry);
    if (handshakeTimeout !== null) clearTimeout(handshakeTimeout);
    handshakeTimeout = null;
    clearInterval(liveWatch);
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    if (controller === boundController) controller = null;
    // The final position folds once at unmount (the durable resume truth).
    const snapshot = getActiveEmbedControl();
    if (snapshot.positionMs > 0 && snapshot.phase !== "ended") {
      void fireWatchReport("progress", snapshot.positionMs);
    }
    publish(idleEmbedControlSnapshot());
  };

  return { controller: boundController, unbind };
}
