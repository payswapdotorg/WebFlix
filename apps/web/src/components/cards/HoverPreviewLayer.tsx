"use client";

/**
 * @wfx/app-web — THE HOVER PREVIEW LAYER (R28-B): the page's ONE preview
 * singleton (the `ytd-video-preview` grammar — see
 * hover-preview-client.ts's header for the corpus citations).
 *
 * Mounted ONCE in the AppShell; the card triggers (CardPreview's
 * dwell-gated pointer handlers) drive it through the module store. The
 * layer renders the popped preview box (+12px per side over the hovered
 * thumbnail), the REAL provider embed (muted autoplay — the same
 * presentation law the player stage uses), and the preview chrome:
 * "Tap to unmute", the 2x speed pill, the progress bar, and the Info
 * affordance. Un-hover fades the box out (the element is RETAINED for
 * reuse; the stream stops when the fade completes — the singleton's DOM
 * persistence, not a hidden player).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import {
  bindHoverPreviewSession,
  closeHoverPreview,
  getHoverPreview,
  subscribeHoverPreview,
  type HoverPreviewState,
} from "@/components/cards/hover-preview-client";
import {
  CONTROL_BOUND_SANDBOX,
  OPAQUE_ORIGIN_SANDBOX,
  presentationSrcOf,
  providerFamilyOf,
} from "@/components/player/embed-presentation";

/** The fade-out window (the corpus band: 200–400ms; the app's motion token). */
const FADE_OUT_MS = 200;

/** The idle snapshot for useSyncExternalStore's server render (stable reference). */
const SERVER_SNAPSHOT: HoverPreviewState = getHoverPreview();

/** The popped box geometry: the anchor rect + 12px per side (corpus: +24px outward). */
function boxGeometryOf(state: HoverPreviewState): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  const anchor = state.anchor;
  if (anchor === null) return null;
  const rect = anchor.getBoundingClientRect();
  return {
    left: rect.left - 12,
    top: rect.top - 12,
    width: rect.width + 24,
    height: rect.height + 24,
  };
}

/** The singleton preview layer (renders nothing until a card opens it). */
export function HoverPreviewLayer(): JSX.Element | null {
  const preview = useSyncExternalStore(subscribeHoverPreview, getHoverPreview, () => SERVER_SNAPSHOT);
  const [geometry, setGeometry] = useState<ReturnType<typeof boxGeometryOf>>(null);
  const [streaming, setStreaming] = useState(false);
  const [info, setInfo] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sessionRef = useRef<ReturnType<typeof bindHoverPreviewSession> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The stream mount follows the open truth: open+previewable mounts the
  // real embed; the fade-out window keeps it 200ms, then the stream stops
  // (the singleton ELEMENT persists — the reuse law — the player does not).
  useEffect(() => {
    if (preview.open && preview.status === "playing" && preview.url !== null) {
      if (fadeTimer.current !== null) {
        clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      setStreaming(true);
      return;
    }
    if (!preview.open && streaming) {
      if (fadeTimer.current === null) {
        fadeTimer.current = setTimeout(() => {
          fadeTimer.current = null;
          setStreaming(false);
          setInfo(false);
        }, FADE_OUT_MS);
      }
    }
  }, [preview.open, preview.status, preview.url, streaming]);

  // Bind the provider's preview control contract for the stream's life.
  useEffect(() => {
    if (!streaming) return;
    const frame = frameRef.current;
    if (frame === null) return;
    const bound = bindHoverPreviewSession({ iframe: frame });
    sessionRef.current = bound;
    return () => {
      sessionRef.current = null;
      bound.unbind();
    };
  }, [streaming, preview.itemId, preview.url]);

  // The pop geometry: measured at open + re-measured on scroll/resize (the
  // preview follows its card — the singleton's repositioning grammar).
  useLayoutEffect(() => {
    setGeometry(boxGeometryOf(preview));
    if (!preview.open) return;
    let raf = 0;
    const reposition = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setGeometry(boxGeometryOf(getHoverPreview())));
    };
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [preview.open, preview.itemId]);

  // Reset the transient chrome when the target changes.
  useEffect(() => {
    setInfo(false);
  }, [preview.itemId]);

  const keepOpen = useCallback((event: React.PointerEvent): void => {
    // Moving onto the preview keeps it open (the preview is hoverable —
    // its controls are real). Stopping propagation keeps the card's own
    // leave handler from closing what the pointer just entered.
    event.stopPropagation();
  }, []);

  const onLeave = useCallback((): void => {
    closeHoverPreview();
  }, []);

  const openPlay = useCallback((): void => {
    if (preview.playHref.length === 0) return;
    window.location.assign(preview.playHref);
  }, [preview.playHref]);

  // The hidden singleton: rendered (retained), faded out, inert.
  if (!preview.open && !streaming && geometry === null) {
    return (
      <div
        className="wfx-hoverpreview wfx-hoverpreview--idle"
        data-wfx-hover-preview
        data-wfx-preview-state="idle"
        aria-hidden="true"
      />
    );
  }

  const provider = preview.url !== null ? providerFamilyOf(preview.url) : "unknown";
  const progress =
    preview.durationMs !== null && preview.durationMs > 0
      ? Math.min(1, Math.max(0, preview.positionMs / preview.durationMs))
      : null;
  const speedActive = (preview.rate ?? 1) >= 2;

  return (
    <div
      className={`wfx-hoverpreview${preview.open ? " wfx-hoverpreview--open" : ""}${
        preview.status === "not-previewable" ? " wfx-hoverpreview--gated" : ""
      }`}
      data-wfx-hover-preview
      data-wfx-preview-state={preview.status}
      data-wfx-preview-item={preview.itemId}
      data-wfx-previewable={preview.status === "playing" ? "true" : preview.status === "not-previewable" ? "false" : "unknown"}
      style={
        geometry !== null
          ? {
              left: `${geometry.left}px`,
              top: `${geometry.top}px`,
              width: `${geometry.width}px`,
              height: `${geometry.height}px`,
            }
          : undefined
      }
      onPointerEnter={keepOpen}
      onPointerLeave={onLeave}
    >
      {preview.status === "not-previewable" ? (
        /* The honest gated state: the card's static artwork stays visible
            (the corpus: the preview never blanks the card) — a small pill
            names the capability truth, never a fake. */
        <p className="wfx-hoverpreview__gate" data-wfx-hover-preview-reason>
          {preview.reason ?? "This source provides no previewable media."}
        </p>
      ) : null}
      {streaming && preview.url !== null ? (
        <>
          <iframe
            ref={frameRef}
            className="wfx-hoverpreview__frame"
            src={presentationSrcOf(preview.url)}
            title={`Preview: ${preview.title}`}
            sandbox={provider === "youtube" ? CONTROL_BOUND_SANDBOX : OPAQUE_ORIGIN_SANDBOX}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media"
            data-wfx-hover-preview-frame
          />
          {/* The click layer: the preview click is the play gesture (one
              click to the player — the corpus preview opens the video). */}
          <button
            type="button"
            className="wfx-hoverpreview__clicklayer"
            aria-label={`Open ${preview.title} in the player`}
            onClick={openPlay}
            data-wfx-hover-preview-open
          />
          {/* "Tap to unmute" — the provider-reported mute truth drives it. */}
          {preview.muted !== false ? (
            <button
              type="button"
              className="wfx-hoverpreview__unmute"
              onClick={(event) => {
                event.stopPropagation();
                sessionRef.current?.setMuted(false);
              }}
              data-wfx-hover-preview-unmute
            >
              <Icon name="mute" size={16} />
              Tap to unmute
            </button>
          ) : null}
          {/* The 2x speed pill (the provider's own setPlaybackRate). */}
          <button
            type="button"
            className={`wfx-hoverpreview__pill${speedActive ? " wfx-hoverpreview__pill--active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              sessionRef.current?.setRate(speedActive ? 1 : 2);
            }}
            aria-pressed={speedActive}
            data-wfx-hover-preview-speed
          >
            {speedActive ? "1x" : "2x"}
          </button>
          {/* The Info affordance (the honest preview truth, on demand). */}
          <button
            type="button"
            className={`wfx-hoverpreview__pill wfx-hoverpreview__pill--info${info ? " wfx-hoverpreview__pill--active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              setInfo((shown) => !shown);
            }}
            aria-pressed={info}
            aria-label="Preview information"
            data-wfx-hover-preview-info
          >
            <Icon name="info" size={14} />
          </button>
          {info ? (
            <p className="wfx-hoverpreview__infoline" data-wfx-hover-preview-note>
              Previewing <strong>{preview.title}</strong> — the source&apos;s own embed, muted,
              contained, and closed the moment you leave.
            </p>
          ) : null}
          {/* The progress bar (provider-reported truth only — no ticker). */}
          <span className="wfx-hoverpreview__progress" aria-hidden="true">
            <span
              className="wfx-hoverpreview__fill"
              style={progress !== null ? { width: `${progress * 100}%` } : { width: "0%" }}
            />
          </span>
        </>
      ) : null}
    </div>
  );
}
