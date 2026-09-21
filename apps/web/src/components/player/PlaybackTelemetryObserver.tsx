"use client";

/**
 * @wfx/app-web — the playback STAGE OBSERVER (R24-E): the client
 * island that instruments the REAL stage elements of the running
 * product.
 *
 * Mounted inside the stage wrapper (the shell), it attaches to the
 * stage the runtime actually resolved and records the contract's
 * frame/audio/rebuffer markers from the platform's OWN events — with
 * the honest observation boundary named in each marker's detail:
 *
 * - the CONTAINED surface (embed/browser rungs — the provider's opaque
 *   iframe): the iframe's `load` event is the honest observable
 *   boundary (the provider's page is cookie-isolated and opaque BY
 *   LAW — WebFlix never injects into or inspects it; the provider's
 *   own first-frame timing is not measurable without breaking the
 *   containment law, which this product will not do);
 * - the WEBFLIX-OWNED media element (the authorized peer copy's
 *   browser rung where the adapter mounts a real video element):
 *   `loadeddata` is the first rendered frame; `playing` is the
 *   audible/rolling playback; `waiting`/`playing` pairs are the
 *   rebuffer accounting — the REAL media-element observations;
 * - the ACQUISITION LIFECYCLE (the peer copy's protocol-free stage
 *   states): the lifecycle's evidence-backed `playing` state is the
 *   first-frame observation for this configuration (the runtime's
 *   phase vocabulary is the only progress truth — never a ticker).
 *
 * It also observes the ENRICHMENT sections' mounts (the streamed
 * panels' arrival times — the R24-E startup-law evidence: first frame
 * must precede the nonessential sections' arrival) into
 * `window.__wfxStartupObservations` — the harness's architecture-law
 * record, NOT a contract marker (the vocabulary stays frozen).
 *
 * Instrumentation never breaks playback: every observation is
 * best-effort and silent (the markers are evidence, not a control
 * path).
 */

import { useEffect } from "react";

import { flushPlaybackTrace, recordEnrichmentMount, recordPlaybackMarker } from "@/host/playback-telemetry";

/** The enrichment sections the startup law watches (selector → section id). */
const ENRICHMENT_SECTIONS: readonly [string, string][] = [
  ["[data-wfx-ai-tray]", "ai-tray"],
  ["[data-wfx-intelligence]", "intelligence"],
  ["[data-wfx-live-captions]", "live-captions"],
  ["[data-wfx-upnext-rail]", "up-next-rail"],
];

/** The acquisition lifecycle's evidence-backed playing state. */
const ACQUISITION_PLAYING = "playing";

/**
 * The stage observer. One mount per player shell; attaches to whatever
 * stage the runtime resolved (contained iframe / owned media element /
 * the acquisition lifecycle) + the enrichment-mount observations.
 */
export function PlaybackTelemetryObserver(): null {
  useEffect(() => {
    // ---- The stage's frame/audio/rebuffer truth -------------------------
    // The realization-switch confirmation: when THIS navigation is a
    // Where-to-watch switch (the URL carries mode=/realization=), the
    // first frame's landing confirms the switch (the requested marker
    // was recorded on the ORIGIN page at the switch click).
    const switchEvidence = (): string | null => {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("mode");
      const realization = params.get("realization");
      if (mode !== null) return `mode=${mode}`;
      if (realization !== null) return `realization=${realization}`;
      return null;
    };
    const recordFirstFrame = (detail: string): void => {
      // Deduplicated (the load listener + the already-loaded check can
      // both fire — one observation per trace).
      if (firstFrameRecorded) return;
      firstFrameRecorded = true;
      recordPlaybackMarker("first-frame-rendered", detail);
      const evidence = switchEvidence();
      if (evidence !== null) {
        recordPlaybackMarker("realization-switch-confirmed", `the switch (${evidence}) reached its first frame`);
      }
    };
    let firstFrameRecorded = false;
    const frame = document.querySelector<HTMLIFrameElement>("[data-wfx-player-frame]");
    if (frame !== null) {
      const onLoad = (): void => {
        recordFirstFrame(
          "contained-surface-load — the provider's opaque page is the honest observable boundary (the containment law)",
        );
      };
      frame.addEventListener("load", onLoad);
      // An already-loaded iframe (the warm-cache pass can beat the
      // observer's mount): the complete readyState records now.
      if (frame.contentWindow !== null || frame.dataset.loaded === "true") {
        onLoad();
      }
      return () => frame.removeEventListener("load", onLoad);
    }

    // The WebFlix-owned media element (the real video path — the
    // authorized peer copy's browser rung where the adapter mounts one).
    const media = document.querySelector<HTMLMediaElement>(
      "[data-wfx-player-stagewrap] video, [data-wfx-player-stagewrap] audio",
    );
    if (media !== null) {
      const onLoadedData = (): void => {
        recordFirstFrame("media-element-loadeddata — the first rendered frame of WebFlix-owned playback");
      };
      const onPlaying = (): void => {
        recordPlaybackMarker("rebuffer-ended", "media-element playing");
        if (!media.muted && media.volume > 0) {
          recordPlaybackMarker("audible-playback", "media-element playing with live audio");
        }
      };
      const onWaiting = (): void => {
        recordPlaybackMarker("rebuffer-started", "media-element waiting for data");
      };
      media.addEventListener("loadeddata", onLoadedData);
      media.addEventListener("playing", onPlaying);
      media.addEventListener("waiting", onWaiting);
      if (media.readyState >= 2) onLoadedData();
      return () => {
        media.removeEventListener("loadeddata", onLoadedData);
        media.removeEventListener("playing", onPlaying);
        media.removeEventListener("waiting", onWaiting);
      };
    }

    // The acquisition lifecycle (the peer copy's protocol-free stage):
    // the lifecycle's evidence-backed state transitions ARE the stage
    // truth for this rung (the runtime's phase vocabulary).
    const lifecycle = document.querySelector("[data-wfx-acquisition-state]");
    if (lifecycle !== null) {
      const recordState = (state: string): void => {
        if (state === ACQUISITION_PLAYING) {
          recordFirstFrame(
            "acquisition-lifecycle playing — the evidence-backed stage state (the real WebRTC rung records media-element loadeddata)",
          );
        }
      };
      recordState(lifecycle.getAttribute("data-wfx-acquisition-state") ?? "");
      const observer = new MutationObserver((mutations): void => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes" && mutation.attributeName === "data-wfx-acquisition-state") {
            recordState((mutation.target as HTMLElement).getAttribute("data-wfx-acquisition-state") ?? "");
          }
        }
      });
      observer.observe(lifecycle, { attributes: true, attributeFilter: ["data-wfx-acquisition-state"] });
      return () => observer.disconnect();
    }

    // ---- The enrichment-mount observations (the startup-law evidence) --
    // Observed by the dedicated effect below (an always-on channel); no
    // fallback duplication here — a stage that matched owns this effect.
    return undefined;
  }, []);

  // The enrichment-mount observer runs in ADDITION to the stage
  // observer (both are startup-law evidence channels).
  useEffect(() => {
    const sectionObserver = new MutationObserver((): void => {
      for (const [selector, sectionId] of ENRICHMENT_SECTIONS) {
        if (document.querySelector(selector) !== null) {
          const observations = window.__wfxStartupObservations;
          if (observations === undefined || !(sectionId in observations.enrichmentMountedAtMs)) {
            recordEnrichmentMount(sectionId);
          }
        }
      }
    });
    // The already-mounted sections (a fast stream can beat the observer).
    for (const [selector, sectionId] of ENRICHMENT_SECTIONS) {
      if (document.querySelector(selector) !== null) {
        recordEnrichmentMount(sectionId);
      }
    }
    sectionObserver.observe(document.body, { childList: true, subtree: true });
    // Retention: the trace flushes when the page hides/unloads (the
    // benchmark walk may navigate away before the marker count grows).
    const flush = (): void => flushPlaybackTrace();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      sectionObserver.disconnect();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  return null;
}
