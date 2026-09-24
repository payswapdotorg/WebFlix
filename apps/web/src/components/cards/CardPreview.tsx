"use client";

/**
 * @wfx/app-web — the attention-policy-gated card preview trigger (R24-W2;
 * the R28-B corpus form — see hover-preview-client.ts's header for the
 * measured citations from docs/parity-lab/r28/youtube/hover-preview.md).
 *
 * THE HONEST PREVIEW LAW (unchanged): the preview's behavior DERIVES from
 * the session's attention mode (Mindful keeps previews off; Balanced
 * previews after the dwell; Immersive previews immediately) with the
 * per-realization CAPABILITY truth resolved LIVE (one lazy /api/preview
 * read at dwell — the frozen resolve path, never a fabricated preview).
 * Where a previewable realization exists, the singleton layer mounts the
 * provider's REAL muted-autoplay embed (the stream itself, never a
 * placeholder loop); where none does, the card keeps its static artwork
 * and the preview names the truth. The control IS the policy — the
 * preview is the policy's consequence.
 *
 * R28-B — THE MEASURED TRIGGER GEOMETRY: the dwell is ~150ms of
 * continuous hover over the card's THUMBNAIL region (A instrumented the
 * pointer moving onto the thumbnail; the singleton mounted at ~147ms,
 * the video at ~193ms — the R27 "~500ms" value is superseded on this
 * surface). The preview box then POPS +12px per side beyond the thumb —
 * the pointer may roam into that margin ring without closing; leaving
 * the ring (or moving onto the preview itself, which keeps it open)
 * fades it out. The card itself NEVER transforms (no scale, no title
 * color change); the singleton is RETAINED for reuse.
 */

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { closeHoverPreview, openHoverPreview } from "@/components/cards/hover-preview-client";

/** The preview trigger's serialized input (server-computed per card). */
export interface CardPreviewProps {
  readonly itemId: string;
  readonly title: string;
  /** The session's attention mode (the Personalize seam's vocabulary). */
  readonly attentionMode: "mindful" | "balanced" | "immersive" | "custom";
  /**
   * The SERVER's preview prior (false until a lazy resolve proves more —
   * the search hit itself never claims previewability; the resolve does).
   */
  readonly previewable: boolean;
  /** The hovered card's target fields (the resolve + the play click's input). */
  readonly connectorId?: string;
  readonly externalRef?: string;
  /** The card's play href (the preview's click target — one click to the player). */
  readonly playHref?: string;
  /** The hovered card's wrapper id (the anchor query's root). */
  readonly cardId?: string;
}

/** The dwell per attention mode (null = the policy keeps previews off). */
function previewDelayMsOf(mode: CardPreviewProps["attentionMode"]): number | null {
  switch (mode) {
    case "mindful":
      return null;
    case "immersive":
      return 0;
    // R28-B — the corpus-measured dwell (~150ms; the R27 600ms beat is
    // superseded by A's mutation-timeline evidence).
    case "balanced":
    case "custom":
      return 150;
  }
}

/** The pop margin: the pointer may roam this far past the thumb (the preview's own ring). */
const POP_MARGIN_PX = 12;

/**
 * The card preview trigger — the WRAPPER around the card link (R28-B:
 * the trigger must cover the card's surface; the prior sibling-mount was
 * a zero-size element whose handlers could never fire — the preview
 * scaffolding C measured but never saw open). A ~150ms dwell over the
 * card's thumbnail opens the policy-gated preview singleton; leaving
 * the thumb's popped region fades it out (the layer is retained for
 * reuse). Touch pointers never preview (a tap is a click — the
 * one-click play path).
 */
export function CardPreview(props: CardPreviewProps & { readonly children?: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inThumb = useRef(false);
  const delay = previewDelayMsOf(props.attentionMode);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  /** The hovered card's thumb (the pop's anchor — the corpus geometry). */
  const thumbOf = useCallback(
    (root: HTMLElement | null): HTMLElement | null => {
      const card =
        typeof props.cardId === "string" && root === null
          ? document.querySelector<HTMLElement>(`[data-wfx-cardwrap="${props.cardId}"]`)
          : root;
      const scope = card ?? null;
      if (scope === null) return null;
      return scope.querySelector<HTMLElement>(".wfx-card__thumb, .wfx-result__thumb");
    },
    [props.cardId],
  );

  /** Is the pointer inside the thumb's popped ring (thumb + the preview margin)? */
  const insideThumbRing = (x: number, y: number, thumb: HTMLElement | null): boolean => {
    if (thumb === null) return false;
    const rect = thumb.getBoundingClientRect();
    return (
      x >= rect.left - POP_MARGIN_PX &&
      x <= rect.right + POP_MARGIN_PX &&
      y >= rect.top - POP_MARGIN_PX &&
      y <= rect.bottom + POP_MARGIN_PX
    );
  };

  /** Open the singleton (the dwell fired with the pointer on the thumb). */
  const fire = useCallback(
    (anchor: HTMLElement): void => {
      if (
        props.connectorId === undefined ||
        props.externalRef === undefined ||
        props.playHref === undefined
      ) {
        return;
      }
      setOpen(true);
      openHoverPreview({
        itemId: props.itemId,
        title: props.title,
        playHref: props.playHref,
        connectorId: props.connectorId,
        externalRef: props.externalRef,
        card: anchor,
      });
    },
    [props.connectorId, props.externalRef, props.itemId, props.playHref, props.title],
  );

  /** Clear the pending dwell + close (a leave INTO the preview keeps it open). */
  const clearAndClose = useCallback((event: React.PointerEvent | React.FocusEvent): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    inThumb.current = false;
    const target = event.relatedTarget;
    if (target instanceof Node) {
      const layer = document.querySelector("[data-wfx-hover-preview]");
      if (layer !== null && layer.contains(target)) return;
    }
    setOpen(false);
    closeHoverPreview();
  }, []);

  /** The dwell tracker: pointer moves re-arm the dwell only over the thumb. */
  const trackPointer = useCallback(
    (event: React.PointerEvent): void => {
      if (event.pointerType === "touch") return;
      if (delay === null) return;
      const wrapper = event.currentTarget as HTMLElement;
      const thumb = thumbOf(wrapper);
      const inside = insideThumbRing(event.clientX, event.clientY, thumb);
      if (inside && !inThumb.current) {
        inThumb.current = true;
        if (timer.current !== null) clearTimeout(timer.current);
        const anchor = wrapper;
        timer.current = setTimeout(() => {
          timer.current = null;
          if (inThumb.current) fire(anchor);
        }, delay);
        return;
      }
      if (!inside) {
        inThumb.current = false;
        if (timer.current !== null) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        if (open) {
          setOpen(false);
          closeHoverPreview();
        }
      }
    },
    [delay, fire, open, thumbOf],
  );

  /** Keyboard focus opens directly (the pointer-free path — same policy). */
  const onKeyboardOpen = useCallback(
    (event: React.FocusEvent): void => {
      if (delay === null) return;
      const wrapper = event.currentTarget as HTMLElement;
      fire(wrapper);
    },
    [delay, fire],
  );

  return (
    <div
      className="wfx-cardpreview"
      data-wfx-card-preview
      data-wfx-preview-policy={props.attentionMode}
      data-wfx-previewable={props.previewable ? "true" : "false"}
      data-wfx-preview-open={open ? "true" : "false"}
      data-wfx-preview-dwell={delay === null ? "off" : `${delay}`}
      onPointerMove={trackPointer}
      onPointerLeave={clearAndClose}
      onFocus={onKeyboardOpen}
      onBlur={clearAndClose}
    >
      {props.children}
    </div>
  );
}
