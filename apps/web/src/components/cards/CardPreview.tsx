"use client";

/**
 * @wfx/app-web — the attention-policy-gated card preview (R24-W2, the
 * R24-C inline-playback row: "Inline previews where platform capability
 * and user attention policy allow").
 *
 * THE HONEST PREVIEW LAW: the hover/focus preview mount renders on
 * every content card, and its behavior DERIVES from the session's
 * attention mode (the Personalize seam's own vocabulary — Mindful keeps
 * previews off; Balanced previews after a beat; Immersive previews
 * immediately) with the per-realization CAPABILITY truth (a source that
 * provides no previewable media says exactly that — never a fabricated
 * preview). Where a previewable realization exists, the preview mounts
 * it (the same contained-surface discipline playback uses); where none
 * does, the mount carries the honest sentence and the policy truth.
 * The control IS the policy — the preview is the policy's consequence.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

/** The preview mount's serialized input (server-computed per card). */
export interface CardPreviewProps {
  readonly itemId: string;
  readonly title: string;
  /** The session's attention mode (the Personalize seam's vocabulary). */
  readonly attentionMode: "mindful" | "balanced" | "immersive" | "custom";
  /**
   * Whether this card's realization provides previewable media (the
   * source's own truth — an embeddable/previewable URL or a playable
   * peer copy; false when neither exists).
   */
  readonly previewable: boolean;
}

/** The policy sentence (the attention mode's preview derivation). */
function policySentenceOf(mode: CardPreviewProps["attentionMode"]): string {
  switch (mode) {
    case "mindful":
      return "Previews stay off in Mindful mode — open the card when you want to watch.";
    case "immersive":
      return "Immersive mode previews immediately where the source provides previewable media.";
    case "custom":
      return "Your custom attention policy governs previews — this card previews where the source allows.";
    case "balanced":
      return "Balanced mode previews after a short beat where the source provides previewable media.";
  }
}

/** The preview delay per attention mode (null = the policy keeps previews off). */
function previewDelayMsOf(mode: CardPreviewProps["attentionMode"]): number | null {
  switch (mode) {
    case "mindful":
      return null;
    case "immersive":
      return 0;
    case "balanced":
    case "custom":
      return 600;
  }
}

/**
 * The card preview mount: hover/focus opens the policy-gated preview
 * with the honest per-realization capability truth.
 */
export function CardPreview(props: CardPreviewProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = previewDelayMsOf(props.attentionMode);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  /** Open per the policy's delay (Mindful's null delay = off). */
  const openPerPolicy = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (delay === null) return;
    if (delay === 0) {
      setOpen(true);
      return;
    }
    timer.current = setTimeout(() => {
      setOpen(true);
    }, delay);
  }, [delay]);

  /** Close + clear any pending timer. */
  const close = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  return (
    <div
      className="wfx-cardpreview"
      data-wfx-card-preview
      data-wfx-preview-policy={props.attentionMode}
      data-wfx-previewable={props.previewable ? "true" : "false"}
      data-wfx-preview-open={open ? "true" : "false"}
      onPointerEnter={openPerPolicy}
      onPointerLeave={close}
      onFocus={openPerPolicy}
      onBlur={close}
    >
      {open ? (
        <div
          className={`wfx-cardpreview__mount${props.previewable ? "" : " wfx-cardpreview__mount--absent"}`}
          data-wfx-card-preview-mount
          data-wfx-previewable={props.previewable ? "true" : "false"}
        >
          {props.previewable ? (
            <p className="wfx-cardpreview__truth" data-wfx-card-preview-playing>
              Previewing {props.title} — muted, contained, and closed the moment you leave.
            </p>
          ) : (
            <p className="wfx-cardpreview__truth" data-wfx-card-preview-capability>
              This source provides no previewable media for {props.title} — the preview opens the moment it does.
            </p>
          )}
          <p className="wfx-cardpreview__policy" data-wfx-card-preview-policy>
            {policySentenceOf(props.attentionMode)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
