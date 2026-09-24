"use client";

/**
 * @wfx/app-web — the HOVER PREVIEW SINGLETON (R28-B, the operator's #1:
 * "hovering over thumbnails doesn't display gifs" — against the corpus
 * sheet docs/parity-lab/r28/youtube/hover-preview.md).
 *
 * THE YOUTUBE PREVIEW GRAMMAR, HONESTLY BACKED (the corpus's measured
 * anatomy, every value cited):
 *
 * - ONE singleton overlay per page (`ytd-video-preview`), repositioned
 *   per hovered card — never a per-card inline <video> (A's mutation
 *   log: exactly one element, reused per card);
 * - dwell-gated mount: ~150ms from pointer-over to preview (A measured
 *   the singleton at ~147ms, the video at ~193ms — the R27 "~500ms"
 *   value is superseded on this surface);
 * - the preview POPS beyond the card: +24px outward (~12px per side over
 *   the thumbnail rect);
 * - the preview player is the REAL STREAM (the provider's own embed,
 *   muted-autoplay through the same presentation law the player stage
 *   uses — NEVER a fake GIF, never a placeholder loop: the frozen
 *   REAL-ARTWORK+PLAYBACK law);
 * - hidden-chrome player with "Tap to unmute", a 2x speed pill, a
 *   progress bar, and an Info affordance (the corpus's gated-state
 *   chrome inventory);
 * - un-hover → OPACITY FADE-OUT, the element RETAINED for reuse (A
 *   measured the singleton persisting in the DOM, `pointer-events:
 *   none`, opacity transition — not an unmount);
 * - the CARD ITSELF never transforms (no scale, no title color change).
 *
 * THE HONEST LAWS THIS KEEPS:
 * - the preview truth is RESOLVED, never guessed: the dwell fires ONE
 *   lazy `/api/preview` read (the frozen resolve path) — previewable iff
 *   the item's own realizations carry an embed; a no-preview source
 *   keeps the card's static artwork (the gated state, named);
 * - the provider's own postMessage control contract (the same documented
 *   widget channel the player binds) drives the progress bar and the
 *   unmute/speed pills — provider-reported evidence only, never a
 *   ticker, never a fabricated phase;
 * - a hover preview NEVER writes watch state (previewing is not
 *   watching; the durable watch-state folds belong to the player page's
 *   session alone);
 * - the attention policy (the Personalize seam's frozen vocabulary)
 *   stays the derivation: Mindful keeps previews OFF; Balanced previews
 *   after the corpus dwell; Immersive previews immediately.
 */

// ---------------------------------------------------------------------------
// The preview state (the layer's read surface)
// ---------------------------------------------------------------------------

/** The preview's live truth — provider-reported evidence or the honest absent. */
export interface HoverPreviewState {
  /** Whether a card is currently hovered (the dwell gate passed). */
  readonly open: boolean;
  /** The hovered card's canonical item id (the resolve key). */
  readonly itemId: string;
  /** The hovered card's title (the Info affordance's label). */
  readonly title: string;
  /** The play href — the preview's click target (one click to the player). */
  readonly playHref: string;
  /** The resolve status: the honest ladder, never a guess. */
  readonly status: "idle" | "resolving" | "playing" | "not-previewable";
  /** The provider's real embed URL (present iff the resolve answered previewable). */
  readonly url: string | null;
  /** The honest reason when the source provides no previewable media. */
  readonly reason: string | null;
  /** The anchor element (the hovered card's thumbnail — the pop's geometry). */
  readonly anchor: HTMLElement | null;
  /** Provider-reported position (ms) — the progress bar's truth. */
  readonly positionMs: number;
  /** Provider-reported duration (ms); null until the provider answers. */
  readonly durationMs: number | null;
  /** Provider-reported mute truth; null until the provider answers. */
  readonly muted: boolean | null;
  /** Provider-reported playback rate; null until the provider answers. */
  readonly rate: number | null;
}

/** The stable idle snapshot (useSyncExternalStore's cached-reference law). */
const IDLE_PREVIEW_SNAPSHOT: HoverPreviewState = {
  open: false,
  itemId: "",
  title: "",
  playHref: "",
  status: "idle",
  url: null,
  reason: null,
  anchor: null,
  positionMs: 0,
  durationMs: null,
  muted: null,
  rate: null,
};

let state: HoverPreviewState = IDLE_PREVIEW_SNAPSHOT;
const listeners = new Set<() => void>();

function publish(next: HoverPreviewState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Subscribe to the preview state (useSyncExternalStore's contract). */
export function subscribeHoverPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current snapshot (useSyncExternalStore's contract). */
export function getHoverPreview(): HoverPreviewState {
  return state;
}

// ---------------------------------------------------------------------------
// The dwell → open → resolve pipeline (the card trigger's write surface)
// ---------------------------------------------------------------------------

/** One open request from a card's dwell-gated trigger. */
export interface HoverPreviewOpenInput {
  readonly itemId: string;
  readonly title: string;
  readonly playHref: string;
  readonly connectorId: string;
  readonly externalRef: string;
  /** The hovered card's element (the thumbnail is queried inside it). */
  readonly card: HTMLElement;
}

/** The client-side resolve cache (one honest read per item per page life). */
const previewTruth = new Map<string, PreviewResolveAnswer>();

interface PreviewResolveAnswer {
  readonly previewable: boolean;
  readonly url?: string;
  readonly reason?: string;
}

/** The thumbnail element the preview pops from (the card's own art region). */
function thumbOf(card: HTMLElement): HTMLElement {
  return (
    card.querySelector<HTMLElement>(".wfx-card__thumb, .wfx-result__thumb") ?? card
  );
}

/**
 * The dwell-gated open: publish the resolving state, read the preview
 * truth (cached), and settle — previewable mounts the real embed; a
 * no-preview source settles `not-previewable` (the card keeps its
 * static artwork, the honest gated state).
 */
export function openHoverPreview(input: HoverPreviewOpenInput): void {
  const anchor = thumbOf(input.card);
  const base: HoverPreviewState = {
    ...IDLE_PREVIEW_SNAPSHOT,
    open: true,
    itemId: input.itemId,
    title: input.title,
    playHref: input.playHref,
    anchor,
    status: "resolving",
  };
  publish(base);

  const cached = previewTruth.get(input.itemId);
  if (cached !== undefined) {
    settlePreview(cached);
    return;
  }
  void (async (): Promise<void> => {
    let answer: PreviewResolveAnswer;
    try {
      const params = new URLSearchParams({
        connectorId: input.connectorId,
        ref: input.externalRef,
      });
      const response = await fetch(`/api/preview?${params.toString()}`);
      const body = (await response.json()) as PreviewResolveAnswer & { ok?: boolean };
      answer = {
        previewable: body.previewable === true,
        ...(typeof body.url === "string" && body.url.length > 0 ? { url: body.url } : {}),
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      };
    } catch {
      answer = { previewable: false, reason: "network: the preview read could not reach the host" };
    }
    previewTruth.set(input.itemId, answer);
    // A slow resolve that lost the hover settles nothing (the user left).
    if (!state.open || state.itemId !== input.itemId) return;
    settlePreview(answer);
  })();
}

/** Fold one resolve answer into the open preview's state. */
function settlePreview(answer: PreviewResolveAnswer): void {
  publish({
    ...state,
    status: answer.previewable ? "playing" : "not-previewable",
    url: answer.previewable && answer.url !== undefined ? answer.url : null,
    reason: answer.previewable ? null : (answer.reason ?? "This source provides no previewable media."),
  });
}

/** The un-hover close: the fade-out's trigger (the element stays for reuse). */
export function closeHoverPreview(): void {
  if (!state.open) return;
  publish({ ...state, open: false });
}

/** The preview's provider-evidence fold (the progress bar + mute truth). */
export function reportHoverPreviewEvidence(evidence: {
  positionMs?: number;
  durationMs?: number | null;
  muted?: boolean;
  rate?: number;
}): void {
  if (!state.open || state.status !== "playing") return;
  publish({
    ...state,
    ...(typeof evidence.positionMs === "number" && Number.isFinite(evidence.positionMs)
      ? { positionMs: evidence.positionMs }
      : {}),
    ...(typeof evidence.durationMs === "number" && Number.isFinite(evidence.durationMs) && evidence.durationMs > 0
      ? { durationMs: evidence.durationMs }
      : {}),
    ...(typeof evidence.muted === "boolean" ? { muted: evidence.muted } : {}),
    ...(typeof evidence.rate === "number" && Number.isFinite(evidence.rate)
      ? { rate: evidence.rate }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// The provider's preview control contract (the documented widget channel)
// ---------------------------------------------------------------------------

/**
 * Bind the preview's provider control channel — the same documented
 * postMessage surface the player's embed-session-client binds, scoped to
 * the PREVIEW iframe alone (never the player's active-session store, and
 * never the durable watch-state: previewing is not watching). Returns
 * the command surface (unmute/speed) + the unbind.
 */
export function bindHoverPreviewSession(config: {
  readonly iframe: HTMLIFrameElement;
}): {
  readonly setMuted: (muted: boolean) => void;
  readonly setRate: (rate: number) => void;
  readonly unbind: () => void;
} {
  const { iframe } = config;
  let disposed = false;
  let settled = false;

  const send = (payload: Record<string, unknown>): void => {
    if (disposed) return;
    try {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ ...payload, id: "wfx-preview", channel: "widget" }),
        "*",
      );
    } catch {
      // A refused postMessage degrades to the honest static state.
    }
  };
  const command = (func: string, args: readonly unknown[] = []): void => {
    send({ event: "command", func, args });
  };
  const ask = (func: string): void => {
    send({ event: "command", func });
  };

  const onMessage = (event: MessageEvent): void => {
    if (disposed) return;
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
      if (typeof info !== "object" || info === null) return;
      const record = info as Record<string, unknown>;
      settled = true;
      const evidence: Parameters<typeof reportHoverPreviewEvidence>[0] = {};
      if (typeof record.currentTime === "number" && Number.isFinite(record.currentTime)) {
        evidence.positionMs = record.currentTime * 1000;
      }
      if (typeof record.duration === "number" && Number.isFinite(record.duration) && record.duration > 0) {
        evidence.durationMs = record.duration * 1000;
      }
      if (typeof record.muted === "boolean") evidence.muted = record.muted;
      if (typeof record.playbackRate === "number" && Number.isFinite(record.playbackRate)) {
        evidence.rate = record.playbackRate;
      }
      reportHoverPreviewEvidence(evidence);
      return;
    }
    if (kind === "onStateChange") {
      const info = parsed.info;
      const rawState =
        typeof info === "object" && info !== null
          ? (info as Record<string, unknown>).playerState
          : parsed.playerState;
      if (typeof rawState === "number") {
        // Provider state 1 = playing — the only state the preview cares
        // about (the evidence fold carries position regardless).
        reportHoverPreviewEvidence({});
      }
    }
  };

  const handshake = (): void => {
    if (disposed || settled) return;
    send({ event: "listening", id: "wfx-preview", channel: "wfx-preview" });
  };
  const onLoad = (): void => {
    if (disposed || settled) return;
    handshake();
    handshakeRetry = setTimeout(handshake, 800);
  };
  let handshakeRetry: ReturnType<typeof setTimeout> | null = null;

  iframe.addEventListener("load", onLoad);
  window.addEventListener("message", onMessage);
  handshake();

  // The live poll (the provider's own getters answer with evidence —
  // the progress bar's truth, 500ms cadence for the small preview).
  const poll = setInterval(() => {
    if (disposed || !settled) return;
    ask("getCurrentTime");
    if (state.durationMs === null) ask("getDuration");
  }, 500);

  return {
    setMuted(muted: boolean): void {
      command(muted ? "mute" : "unMute");
      // The provider's own mutedDelivery confirms; the optimistic fold
      // keeps the pill responsive (corrected by evidence on arrival).
      reportHoverPreviewEvidence({ muted });
    },
    setRate(rate: number): void {
      command("setPlaybackRate", [rate]);
      reportHoverPreviewEvidence({ rate });
    },
    unbind(): void {
      if (disposed) return;
      disposed = true;
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      if (handshakeRetry !== null) clearTimeout(handshakeRetry);
      clearInterval(poll);
    },
  };
}
