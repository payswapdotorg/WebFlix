"use client";

/**
 * @wfx/app-web — THE DESCRIPTION INLINE EXPANDER (R29-B stage 1 — the
 * corpus watch-page-anatomy.md description grammar).
 *
 * THE YOUTUBE GRAMMAR: `#description-inline-expander` — collapsed 1–2
 * lines (14px/400/20 secondary-text) with the inline "...more" affordance
 * at the text's end; clicking EXPANDS INLINE (no dialog) and the
 * affordance flips to "Show less". The panel's content is WebFlix's own
 * playback-capability truth (the honest description of THIS way of
 * watching — the source carries no editorial description text for these
 * items; the grammar is the corpus's, the content is the real truth).
 */

import { useState, type JSX, type ReactNode } from "react";

/** The expander's serialized input (server-computed per render). */
export interface DescriptionExpanderProps {
  /** The collapsed lead line (the honest 1–2-line summary — inline content). */
  readonly lead: ReactNode;
  /** The expanded body (the full honest truth), when more exists. */
  readonly children?: ReactNode;
}

/** The description inline expander ("...more" / "Show less"). */
export function DescriptionExpander(props: DescriptionExpanderProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasMore = props.children !== undefined && props.children !== null;
  return (
    <div className="wfx-desc" data-wfx-player-description data-wfx-desc-open={open ? "true" : "false"}>
      <p className={open ? "wfx-desc__text" : "wfx-desc__text wfx-desc__text--clamped"}>{props.lead}</p>
      {/* The corpus `#description-inline-expander` keeps BOTH states in the
          DOM (the collapsed snippet + the expanded body, hidden until
          opened) — the expansion is INLINE, never a dialog, and the
          honest playback truths stay server-rendered for every reader
          (screen readers, no-JS, the SSR contract). */}
      {hasMore ? (
        <div className="wfx-desc__body" hidden={!open}>
          {props.children}
        </div>
      ) : null}
      {hasMore ? (
        <button
          type="button"
          className="wfx-desc__toggle"
          onClick={() => {
            setOpen((current) => !current);
          }}
          aria-expanded={open}
          data-wfx-desc-toggle
        >
          {open ? "Show less" : "...more"}
        </button>
      ) : null}
    </div>
  );
}
