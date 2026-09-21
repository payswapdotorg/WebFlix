"use client";

/**
 * @wfx/app-web — the PLAY-INTENT recorder (R24-E): the client island
 * that records the user's real play actions from ANY product surface.
 *
 * A document-level click listener (one per page, mounted by the
 * AppShell) recognizes the product's own play-intent links:
 *
 * - `[data-wfx-item-play]` — the item hub's primary Play action (THE
 *   one obvious play action the R24-E law measures);
 * - `[data-wfx-watch-switch]` — the Where-to-watch "Play this way" /
 *   "Switch to this" links (a realization switch: the link's
 *   `data-wfx-watch-switch` value names the target rung).
 *
 * On a recognized click it stores the intent (epoch + href + item) in
 * sessionStorage — the NEXT page (the player) bridges the intent onto
 * its own clock (see PlayerBootMarker) and records the contract's
 * `play-clicked` / `realization-switch-requested` markers. A switch
 * click ALSO emits the `realization-switch-requested` marker on the
 * ORIGIN page's trace context when one is live (the in-page trace
 * array — the harness reads it before the navigation tears the page
 * down); the player side confirms the switch when its first frame
 * lands.
 *
 * Renders nothing. Breaks nothing (best-effort, silent).
 */

import { useEffect } from "react";

import { recordPlaybackMarker, recordPlayIntent } from "@/host/playback-telemetry";

/** Mount the recorder (one listener per document). */
export function PlayIntentRecorder(): null {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return;
      const playLink = event.target.closest<HTMLAnchorElement>(
        "[data-wfx-item-play], [data-wfx-watch-switch]",
      );
      if (playLink === null) return;
      const href = playLink.getAttribute("href");
      if (href === null || !href.startsWith("/player")) return;
      // The intent's item binding (the player href's id param).
      const itemId = new URLSearchParams(href.split("?")[1] ?? "").get("id") ?? "";
      if (itemId.length === 0) return;
      const switchKind = playLink.getAttribute("data-wfx-watch-switch");
      recordPlayIntent({
        epochMs: Date.now(),
        href,
        itemId,
        ...(switchKind !== null ? { realization: switchKind } : {}),
      });
      if (switchKind !== null) {
        // The realization-switch intent, recorded on the origin page's
        // live trace when one exists (the player page's first frame
        // answers the confirmation marker).
        recordPlaybackMarker("realization-switch-requested", `switch to ${switchKind}`);
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    // The deterministic hydration signal (the harness waits for this
    // before driving play clicks — a pre-hydration click is a silent
    // no-op for the recorder; this flag is the honest "listener live").
    (window as Window & { __wfxPlayIntentReady?: boolean }).__wfxPlayIntentReady = true;
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      (window as Window & { __wfxPlayIntentReady?: boolean }).__wfxPlayIntentReady = false;
    };
  }, []);
  return null;
}
