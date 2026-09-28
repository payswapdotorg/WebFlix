/**
 * @wfx/app-web — R37 — THE LIVE BADGE (the red-dot grammar + the viewer
 * count's typed states — the shared lockup every live surface renders).
 *
 * THE HONESTY LAWS: the badge renders only where the connector metadata
 * declares the live state (the derivation ran before this component); the
 * viewer count renders ONLY the source-reported figure with its
 * provenance, or the typed-absence note — never a fabricated number. The
 * corpus red (#f03) is ALWAYS paired with the "LIVE" label text (color
 * never alone — the design-language law).
 */

import type { JSX } from "react";

import type { LiveViewerCountView } from "@/components/live/live-views";

/** The live badge (the red dot + the LIVE label). */
export function LiveBadge(): JSX.Element {
  return (
    <span className="wfx-livebadge" data-wfx-live-badge>
      <span className="wfx-livebadge__dot" aria-hidden="true" />
      Live
    </span>
  );
}

/** The "was live" badge (the archived VOD's ended truth — never red). */
export function WasLiveBadge(): JSX.Element {
  return (
    <span className="wfx-livedone" data-wfx-livedone-badge>
      Was live
    </span>
  );
}

/**
 * The viewer-count slot (the source-reported figure with its provenance,
 * or the typed absence). The `variant` tunes the presentation: `badge`
 * (the corner pill) or `inline` (the watch chrome).
 */
export function LiveViewerCount({
  count,
  variant = "inline",
}: {
  readonly count: LiveViewerCountView;
  readonly variant?: "badge" | "inline";
}): JSX.Element {
  if (count.kind === "declared") {
    return (
      <span
        className={variant === "badge" ? "wfx-liveviewers wfx-livecard__duration" : "wfx-liveviewers"}
        data-wfx-live-viewers={String(count.value)}
        data-wfx-live-viewers-state="declared"
        title={count.provenance}
      >
        {count.value.toLocaleString("en-US")} watching
      </span>
    );
  }
  return (
    <span
      className="wfx-liveviewers wfx-liveviewers--absent"
      data-wfx-live-viewers-state="absent"
      title={count.note}
    >
      Viewer count not reported
    </span>
  );
}
