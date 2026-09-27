"use client";

/**
 * @wfx/app-web — the SHORTS MEDIA STAGE CLIENT (R33-A, the operator's #1:
 * "the shorts are still bad"): the real-playback backing for the shorts
 * surface's media stage.
 *
 * THE PATTERN THIS MODULE FOLDS TOGETHER (each law cited at its use):
 *
 * - THE RESOLVE SEAM (the R28-B hover-preview law — the same resolution +
 *   caching seam): the stage resolves the item's playable realization at
 *   VIEW TIME through `GET /api/preview?connectorId=&ref=` — the frozen
 *   `serverPort.resolve` path (the provider's real embed URL from the SAME
 *   resolve path playback uses), ONE cached read per item per page life.
 *   An item with no embed realization answers `previewable: false` with
 *   the honest reason — the stage keeps the card's placeholder-art form
 *   (the typed absence, never a fake player, never a spinner).
 *
 * - THE PRESENTATION LAW (embed-presentation.ts, VERBATIM): the staged src
 *   is `presentationSrcOf(url)` — the provider's own privacy-enhanced host
 *   (`www.youtube-nocookie.com`) + the provider's own `enablejsapi`
 *   switch + the muted-autoplay pair (`autoplay=1&mute=1` — the one
 *   autoplay browsers permit without a same-document gesture). The sandbox
 *   posture is the containment law's (CONTROL_BOUND for the documented
 *   control-channel family, OPAQUE_ORIGIN otherwise — EmbedStage.tsx).
 *
 * - THE EVIDENCE LAW (R26-W2, frozen): only the provider's OWN broadcasts
 *   advance the stage's visible truth. The stage binds the provider's
 *   documented embed control contract (the widget postMessage channel the
 *   player's embed-session-client and the hover preview's client bind —
 *   the same message forms, the same listening handshake, the same honest
 *   3s timeout re-armed on the frame's load). A provider that never
 *   answers settles `live: false` — the honest unbound state, disclosed,
 *   never simulated.
 *
 * - THE SESSION LAW (the watch surface's own seam, surveyed): the shorts
 *   surface's PLAYS record through the SAME session machinery the watch
 *   surface uses — `host/shorts.ts`'s `resolveShortsPlaybackSession` (the
 *   runtime's `resolvePlayback` + `prepare()` + the playback bridge's
 *   `recordPlaybackSession`) over `POST /api/shorts-session`, then the
 *   runtime play command through `POST /api/playback {sessionId, command,
 *   intent}` (the client-carried intent path), then the provider-reported
 *   progress folds through `POST /api/events` (the CLOSED vocabulary —
 *   throttled `progress` + `complete` on the provider's own `ended` + the
 *   final position at unmount; `"start"` stays the runtime controller's
 *   own fold, never duplicated here). Resume truth and watch state stay
 *   coherent across surfaces.
 *
 * - THE PREFETCH LAW: the module's per-item resolve cache IS the prefetch
 *   window's carrier — the next card's resolve-only stage warms the cache,
 *   and only the ACTIVE card ever mounts an embed (the singleton
 *   discipline the hover preview keeps).
 */

// ---------------------------------------------------------------------------
// The resolve seam (the R28-B hover-preview law, the same cached read)
// ---------------------------------------------------------------------------

/** The stage's resolve answer (the /api/preview route's own shape). */
export interface ShortsStageResolveAnswer {
  readonly previewable: boolean;
  readonly url?: string;
  readonly reason?: string;
}

/**
 * The client-side resolve cache (one honest read per item per page life —
 * the hover-preview client's `previewTruth` law). The NEXT card's
 * resolve-only stage warms this cache (the prefetch window's carrier); the
 * mount when the card becomes current is then a cache hit.
 */
const stageTruth = new Map<string, ShortsStageResolveAnswer>();

/** The in-flight resolve guards (one read per item at a time). */
const stageInFlight = new Map<string, Promise<ShortsStageResolveAnswer>>();

/** The default resolve transport (the seam tests replace). */
export type ShortsStageResolveFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Resolve one card's playable realization (the same seam the hover preview
 * uses — `GET /api/preview`, cached per item). Pure transport: the caller
 * folds the answer; this never touches component state.
 */
export async function resolveShortsStageMedia(
  input: { readonly connectorId: string; readonly externalRef: string },
  fetchImpl: ShortsStageResolveFetch = fetch,
): Promise<ShortsStageResolveAnswer> {
  const cached = stageTruth.get(input.externalRef);
  if (cached !== undefined) return cached;
  const inFlight = stageInFlight.get(input.externalRef);
  if (inFlight !== undefined) return inFlight;
  const pending = (async (): Promise<ShortsStageResolveAnswer> => {
    let answer: ShortsStageResolveAnswer;
    try {
      const params = new URLSearchParams({
        connectorId: input.connectorId,
        ref: input.externalRef,
      });
      const response = await fetchImpl(`/api/preview?${params.toString()}`);
      const body = (await response.json()) as ShortsStageResolveAnswer & { ok?: boolean };
      answer = {
        previewable: body.previewable === true,
        ...(typeof body.url === "string" && body.url.length > 0 ? { url: body.url } : {}),
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      };
    } catch {
      answer = {
        previewable: false,
        reason: "network: the stage's resolve read could not reach the host",
      };
    }
    stageTruth.set(input.externalRef, answer);
    stageInFlight.delete(input.externalRef);
    return answer;
  })();
  stageInFlight.set(input.externalRef, pending);
  return pending;
}

/** Test seam: forget the cached resolve truths (the sweep's clean-store law). */
export function resetShortsStageResolveCacheForTests(): void {
  stageTruth.clear();
  stageInFlight.clear();
}

// ---------------------------------------------------------------------------
// The stage state (provider-reported evidence or the honest absent)
// ---------------------------------------------------------------------------

/** The provider's own player states (the YouTube vocabulary — provider-reported). */
export type ShortsStagePhase = "unstarted" | "buffering" | "playing" | "paused" | "ended";

/** The stage's evidence state — every field is provider-reported or the honest absent. */
export interface ShortsStageState {
  /** The resolve status: the honest ladder, never a guess. */
  readonly status: "resolving" | "staged" | "unavailable";
  /** The provider's real embed URL (present iff the resolve answered previewable). */
  readonly url: string | null;
  /** The honest reason when the item carries no available realization. */
  readonly reason: string | null;
  /** Whether the provider's embed API answered the listening handshake. */
  readonly live: boolean;
  /** The provider's reported player state (evidence only — never guessed). */
  readonly phase: ShortsStagePhase;
  /** The provider's reported position (ms). */
  readonly positionMs: number;
  /** The provider's reported duration (ms); null until reported. */
  readonly durationMs: number | null;
  /** The provider's reported mute truth; null until reported. */
  readonly muted: boolean | null;
  /** The provider's reported playback rate; null until reported. */
  readonly rate: number | null;
}

/** The stable idle snapshot (the pre-evidence truth — the same law the embed-session-client keeps). */
export const SHORTS_STAGE_IDLE: ShortsStageState = {
  status: "resolving",
  url: null,
  reason: null,
  live: false,
  phase: "unstarted",
  positionMs: 0,
  durationMs: null,
  muted: null,
  rate: null,
};

/** Map the provider's numeric player state onto the typed phase (evidence only). */
function phaseOfPlayerState(playerState: number): ShortsStagePhase | null {
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

/** The mutable working copy (the evidence fold's scratch shape — the embed-session-client's own law). */
type MutableShortsStageState = { -readonly [K in keyof ShortsStageState]: ShortsStageState[K] };

/** Fold one resolve answer into the stage state (pure — exported for the tests). */
export function settleShortsStageResolve(
  state: ShortsStageState,
  answer: ShortsStageResolveAnswer,
): ShortsStageState {
  if (answer.previewable && typeof answer.url === "string" && answer.url.length > 0) {
    return { ...state, status: "staged", url: answer.url, reason: null };
  }
  return {
    ...state,
    status: "unavailable",
    url: null,
    reason: answer.reason ?? "This source provides no embeddable media for this short.",
  };
}

/**
 * Fold one provider evidence delivery into the stage state (pure — the ONLY
 * state mover; exported for the tests). Every field is provider-reported or
 * honestly absent: nothing here guesses, extrapolates, or ticks.
 */
export function applyShortsStageEvidence(
  state: ShortsStageState,
  info: {
    readonly playerState?: unknown;
    readonly currentTime?: unknown;
    readonly duration?: unknown;
    readonly muted?: unknown;
    readonly playbackRate?: unknown;
  },
): ShortsStageState {
  const next: MutableShortsStageState = { ...state, live: true };
  if (typeof info.playerState === "number") {
    const phase = phaseOfPlayerState(info.playerState);
    if (phase !== null) next.phase = phase;
  }
  if (
    typeof info.currentTime === "number" &&
    Number.isFinite(info.currentTime) &&
    info.currentTime >= 0
  ) {
    next.positionMs = info.currentTime * 1000;
  }
  if (typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration > 0) {
    next.durationMs = info.duration * 1000;
  }
  if (typeof info.muted === "boolean") next.muted = info.muted;
  if (typeof info.playbackRate === "number" && Number.isFinite(info.playbackRate)) {
    next.rate = info.playbackRate;
  }
  return next;
}

/** The provider's handshake-honest timeout fold (no answer ⇒ the unbound truth). */
export function settleShortsStageUnbound(state: ShortsStageState): ShortsStageState {
  return { ...state, live: false };
}

// ---------------------------------------------------------------------------
// The stage's key-command derivation (the watch surface's k/m grammar)
// ---------------------------------------------------------------------------

/** One derived key command (the watch surface's PlayerChrome grammar, scoped). */
export type ShortsStageKeyCommand = "toggle-play" | "toggle-mute";

/**
 * The typing-target guard (the watch surface's PlayerChrome law: keys never
 * reach the stage while the user is typing in an INPUT/TEXTAREA/SELECT or a
 * contentEditable host). DOM-free by shape — the same field vocabulary the
 * instanceof guard reads — so the derivation stays pure and testable in
 * every runtime.
 */
function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const record = target as { readonly tagName?: unknown; readonly isContentEditable?: unknown };
  if (typeof record.tagName === "string") {
    const tag = record.tagName.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  }
  return record.isContentEditable === true;
}

/**
 * Derive the stage's keyboard command from one keydown (the watch surface's
 * k/m bindings — PlayerChrome.tsx's keyboard grammar: "k" toggles play/pause,
 * "m" toggles mute, and the typing guard keeps typing targets untouched).
 * Pure — exported for the tests.
 */
export function shortsStageKeyCommandOf(event: {
  readonly key: string;
  readonly target: unknown;
}): ShortsStageKeyCommand | null {
  if (isTypingTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  if (key === "k") return "toggle-play";
  if (key === "m") return "toggle-mute";
  return null;
}

// ---------------------------------------------------------------------------
// The provider control contract (the documented widget channel — the
// hover-preview binding's forms + the play/pause commands)
// ---------------------------------------------------------------------------

/** The bound stage's command surface (the provider's own API). */
export interface ShortsStageController {
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
}

/**
 * Bind the stage's provider control channel — the same documented postMessage
 * surface the player's embed-session-client and the hover preview's client
 * bind, scoped to THIS stage's iframe alone (never the player's
 * active-session store). The evidence callback receives every provider
 * delivery (the caller folds it through `applyShortsStageEvidence` — the
 * evidence law). Returns the command surface + the unbind.
 */
export function bindShortsStageSession(config: {
  readonly iframe: HTMLIFrameElement;
  /** The provider family the embed URL identifies (the presentation law's check). */
  readonly provider: "youtube" | "unknown";
  /** The evidence sink (every provider delivery, verbatim). */
  readonly onEvidence: (info: {
    readonly playerState?: unknown;
    readonly currentTime?: unknown;
    readonly duration?: unknown;
    readonly muted?: unknown;
    readonly playbackRate?: unknown;
  }) => void;
  /** The honest-timeout sink (no provider answer within the window). */
  readonly onUnbound: () => void;
}): {
  readonly controller: ShortsStageController;
  readonly unbind: () => void;
} {
  const { iframe } = config;
  let disposed = false;
  let settled = false;

  // The handshake window (embed-session-client's law: 3s, measured FROM THE
  // FRAME'S LOAD so a slow provider gets its full chance; no answer ⇒ the
  // honest unbound state).
  const HANDSHAKE_TIMEOUT_MS = 3_000;

  const send = (payload: Record<string, unknown>): void => {
    if (disposed) return;
    try {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ ...payload, id: "wfx-shortstage", channel: "widget" }),
        "*",
      );
    } catch {
      // A refused postMessage degrades to the honest unbound state.
    }
  };
  const command = (func: string, args: readonly unknown[] = []): void => {
    send({ event: "command", func, args });
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
    // The sender check is the WINDOW itself (the exact frame we bound).
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
        settled = true;
        if (handshakeTimeout !== null) {
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;
        }
        config.onEvidence(info as Record<string, unknown>);
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
        config.onEvidence({ playerState: rawState });
      }
    }
  };

  const handshake = (): void => {
    if (disposed || settled) return;
    send({ event: "listening", id: "wfx-shortstage", channel: "wfx-shortstage" });
  };

  let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  const armHandshakeTimeout = (): void => {
    if (handshakeTimeout !== null) clearTimeout(handshakeTimeout);
    handshakeTimeout = setTimeout(() => {
      if (disposed || settled) return;
      config.onUnbound();
    }, HANDSHAKE_TIMEOUT_MS);
  };

  const onLoad = (): void => {
    if (disposed || settled) return;
    armHandshakeTimeout();
    handshake();
  };
  iframe.addEventListener("load", onLoad);
  window.addEventListener("message", onMessage);
  handshake();
  armHandshakeTimeout();

  const controller: ShortsStageController = {
    play(): void {
      command("playVideo");
    },
    pause(): void {
      command("pauseVideo");
    },
    setMuted(muted: boolean): void {
      command(muted ? "mute" : "unMute");
    },
  };

  return {
    controller,
    unbind(): void {
      if (disposed) return;
      disposed = true;
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      if (handshakeTimeout !== null) clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
    },
  };
}

// ---------------------------------------------------------------------------
// The session folds (the watch surface's own seam — the closed vocabulary)
// ---------------------------------------------------------------------------

/** The watch-state progress report's throttle window (embed-session-client's law). */
const PROGRESS_REPORT_INTERVAL_MS = 5_000;

/** The runtime session's transport (the seams tests replace). */
export type ShortsStageSessionFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Mint the stage's playback session — `POST /api/shorts-session`, the thin
 * route over `host/shorts.ts`'s `resolveShortsPlaybackSession` (the SAME
 * seam the watch surface's media path uses: resolvePlayback + prepare +
 * the playback bridge's recordPlaybackSession). Answers the runtime's own
 * session id, or null (an honest failure never fabricates one).
 */
export async function mintShortsStageSession(
  input: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
  },
  fetchImpl: ShortsStageSessionFetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl("/api/shorts-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemId: input.itemId,
        connectorId: input.connectorId,
        externalRef: input.externalRef,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: unknown; sessionId?: unknown };
    if (body.ok !== true || typeof body.sessionId !== "string" || body.sessionId.length === 0) {
      return null;
    }
    return body.sessionId;
  } catch {
    return null;
  }
}

/**
 * Issue one runtime command through the watch surface's own transport —
 * `POST /api/playback {sessionId, command, intent}` (the client-carried
 * intent path, R26-W2): the provider command already went out FIRST (the
 * watch surface's issue() order); this records the session's truth with
 * the runtime. Best-effort by the same law (a lost record never blocks
 * playback); the honest failure returns false.
 */
export async function recordShortsStageCommand(
  input: {
    readonly sessionId: string;
    readonly command: "play" | "pause";
    readonly intent: {
      readonly itemId: string;
      readonly externalRef: string;
      readonly connectorId: string;
    };
  },
  fetchImpl: ShortsStageSessionFetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl("/api/playback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: input.sessionId,
        command: input.command,
        intent: { ...input.intent, preferredMode: "embed" },
      }),
    });
    const body = (await response.json()) as { ok?: unknown };
    return response.ok && body.ok === true;
  } catch {
    return false;
  }
}

/** The report types the stage folds (the route's CLOSED vocabulary). */
export type ShortsStageWatchReport = "progress" | "complete";

/**
 * Fold one provider-reported watch-state report through `POST /api/events`
 * (the closed vocabulary with `playbackSessionId` — the same fold the
 * player's embed-session-client performs). Best-effort: a lost report
 * stays lost (the EventSink law surfaces failures on the explicit report
 * controls; the next throttled report carries the position again).
 */
export async function reportShortsStageWatchState(
  input: {
    readonly itemId: string;
    readonly sessionId: string;
    readonly type: ShortsStageWatchReport;
    readonly positionMs: number;
  },
  fetchImpl: ShortsStageSessionFetch = fetch,
): Promise<void> {
  try {
    await fetchImpl("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(input.type === "complete" ? { keepalive: true } : {}),
      body: JSON.stringify({
        itemId: input.itemId,
        type: input.type,
        payload: {
          playbackSessionId: input.sessionId,
          positionMs: Math.max(0, Math.round(input.positionMs)),
        },
      }),
    });
  } catch {
    // A lost report stays lost (the embed-session-client law).
  }
}

/** The progress-report throttle's decision (pure — embed-session-client's law). */
export function shouldReportShortsStageProgress(
  lastReportAtMs: number,
  lastReportedPositionMs: number,
  snapshot: ShortsStageState,
  nowMs: number,
): boolean {
  if (snapshot.phase === "ended") return false; // the complete report's domain
  if (snapshot.phase !== "playing" && snapshot.phase !== "paused") return false;
  if (nowMs - lastReportAtMs < PROGRESS_REPORT_INTERVAL_MS) return false;
  return snapshot.positionMs !== lastReportedPositionMs;
}
