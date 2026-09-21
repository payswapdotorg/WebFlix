/**
 * @wfx/app-web — the player BOOT MARKER (R24-E): the parse-time
 * instrumentation of the real startup path.
 *
 * Rendered as an INLINE SCRIPT at the end of the player shell's HTML —
 * it executes the moment the streamed shell parses, BEFORE hydration:
 * the honest observation points of the startup path are the parse-time
 * ones (the contract's `navigation-start`, `player-surface-visible`,
 * `playable-declared`), not post-hydration approximations.
 *
 * THE CLOCK LAW (one trace origin, honest rebase):
 * - The script bridges a stored play intent (the click page's epoch in
 *   sessionStorage) onto this page's `performance.now()` clock:
 *   `originSkewMs = (Date.now() − performance.now()) − clickEpoch`.
 *   With an intent, the trace origin IS the click (`play-clicked` at
 *   offset 0; `navigation-start` at +skew — click-to-navigation); every
 *   later marker rebases onto the click origin, so click-to-first-frame
 *   is one monotonic measurement across the two documents.
 * - Without an intent (a direct navigation), the trace anchors at this
 *   page's navigation start (skew 0, no `play-clicked` — nothing
 *   fabricated).
 *
 * WHAT IT RECORDS (the parse-time truth of the SHELL — the streamed
 * player's own HTML):
 * - `navigation-start` (the trace origin, or +skew from the click);
 * - `player-surface-visible` (the shell parsed — the stage + chrome
 *   are in the DOM; the inline script's position IS the observation);
 * - `playable-declared` when the shell renders an ENGAGED runtime
 *   phase (the page's own `data-wfx-player-state` attribute — the
 *   runtime's truthful phase vocabulary, server-rendered);
 * - `startup-failed` when the shell renders the failed phase (the
 *   honest startup-failure observation — the detail names the kind);
 * - `realization-switch-confirmed` deferred to the stage observer (the
 *   switch's first frame — see PlaybackTelemetryObserver).
 */

import type { JSX } from "react";

/** The engaged phases the shell may render (the runtime's vocabulary). */
const ENGAGED_PHASES = new Set(["prepared", "preparing", "buffering", "playing", "degraded"]);

/** The failed phases (the honest startup-failure truth). */
const FAILED_PHASES = new Set(["failed", "unresolvable"]);

/** One player page's boot facts (serialized into the inline script). */
export interface PlayerBootMarkerProps {
  readonly itemId: string;
  readonly realization: string;
}

/**
 * The boot marker: the inline script recording the parse-time markers.
 * Rendered ONCE per player shell (at the shell's end, after the stage).
 */
export function PlayerBootMarker(props: PlayerBootMarkerProps): JSX.Element {
  const script = `(function(){
  try {
    var storageKey = "wfx-play-intent";
    var intent = null;
    try {
      var raw = sessionStorage.getItem(storageKey);
      if (raw !== null) {
        sessionStorage.removeItem(storageKey);
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed.epochMs === "number" && typeof parsed.href === "string") {
          intent = parsed;
        }
      }
    } catch (e) { /* storage refused: the navigation-anchored trace */ }
    // The wall-clock bridge: this page's navigation origin in epoch ms.
    var timeOriginEpoch = Date.now() - performance.now();
    var skew = intent !== null ? timeOriginEpoch - intent.epochMs : 0;
    // A negative skew means the stored intent is stale (a prior page's
    // click): anchor at the navigation, never a fabricated click origin.
    var fromPlayClick = intent !== null && skew >= 0;
    var effectiveSkew = fromPlayClick ? skew : 0;
    var trace = {
      traceId: "wfx-trace-" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2)),
      itemId: ${JSON.stringify(props.itemId)},
      realization: ${JSON.stringify(props.realization)},
      originSkewMs: effectiveSkew,
      fromPlayClick: fromPlayClick,
      markers: []
    };
    var mark = function (marker, detail) {
      trace.markers.push({ marker: marker, offsetMs: performance.now() + effectiveSkew, detail: detail });
    };
    if (fromPlayClick) {
      // The trace origin IS the play click (offset 0 by construction).
      trace.markers.push({ marker: "play-clicked", offsetMs: 0 });
      // A REALIZATION-SWITCH intent (a Where-to-watch "Play this way"
      // click — the intent carries the target rung): the request marker
      // rides THIS trace at the click origin, so the switch time pairs
      // with the confirmation the stage observer records at the new
      // realization's first frame.
      if (intent !== null && typeof intent.realization === "string" && intent.realization.length > 0) {
        trace.markers.push({
          marker: "realization-switch-requested",
          offsetMs: 0,
          detail: "switch to " + intent.realization + " (the play intent itself)",
        });
      }
    }
    // navigation-start is the PAGE'S navigation start (the performance
    // clock origin), not this script's execution instant: for a direct
    // navigation the offset IS 0 (the trace anchors at the navigation);
    // for a click-bridged trace the offset is the click-to-navigation
    // delta (the skew). The delta to player-surface-visible (this
    // script's parse instant) is the honest navigation-to-visible
    // measurement.
    trace.markers.push({
      marker: "navigation-start",
      offsetMs: fromPlayClick ? effectiveSkew : 0,
      detail: fromPlayClick ? "click-to-navigation bridge" : "direct navigation",
    });
    mark("player-surface-visible", "the streamed player shell parsed (stage + chrome in the DOM)");
    window.__wfxPlaybackTelemetry = trace;
    window.__wfxStartupObservations = { enrichmentMountedAtMs: {} };
    // The shell's own phase truth (server-rendered attribute): the
    // engaged-phase declaration or the honest startup failure.
    var shell = document.querySelector("[data-wfx-player-state]");
    if (shell !== null) {
      var phase = shell.getAttribute("data-wfx-player-state");
      if (phase !== null) {
        if (${JSON.stringify([...ENGAGED_PHASES])}.indexOf(phase) >= 0) {
          mark("playable-declared", "runtime phase at shell render: " + phase);
        } else if (${JSON.stringify([...FAILED_PHASES])}.indexOf(phase) >= 0) {
          mark("startup-failed", "the shell rendered the failed phase: " + phase);
        }
      }
    }
  } catch (e) { /* instrumentation must never break the playback path */ }
})();`;
  // The inline boot marker IS the parse-time instrument (the serialized
  // constants are JSON; the script's own code contains no user input).
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
