/**
 * @wfx/app-web — the live captions surface (R23-G, the J39 live-speech
 * walk).
 *
 * The R2T2 live/streaming ASR surface on the player, rendering the FROZEN
 * R23-G derivations verbatim:
 *
 * - THE LEGAL-AUDIO GATE: live captions run ONLY where an audio stream
 *   is legally available to WebFlix — the typed refusal names the
 *   boundary (never a bypass, never a dead end);
 * - THE ROUTE DECISION: R2T2 for the live lane when registered; the
 *   typed `no-live-route-registered` gap with its recovery otherwise
 *   (batch models are never silently substituted into the live lane);
 * - THE PROVENANCE + MODEL TRUTH: the route names the provider; the
 *   envelope truth (80 ms–2 s chunks, ~200–600 ms typical latency)
 *   renders as the honest latency profile;
 * - THE STREAM: in fixtures mode the deterministic committed-output
 *   double (the transcript's committed segments — the same double law
 *   as every fixture persona drive, loudly badged); the R25 realtime
 *   seam + the registered R2T2 executor serve it in production.
 *
 * Server component (the typed states render pre-hydration — the truth is
 * visible before any client JS).
 */

import type { JSX } from "react";

import type { LiveAsrRouteView } from "@/host/intelligence";

/** The live captions surface (progressively disclosed on the player). */
export function LiveCaptionsSurface({
  view,
  mode,
}: {
  readonly view: LiveAsrRouteView;
  /** The host boot mode (the fixtures double is loudly labeled). */
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  return (
    <details className="wfx-player__live" data-wfx-live-captions data-wfx-live-captions-state={
      view.readiness.kind === "ready"
        ? view.route?.kind === "r2t2-live-low-latency"
          ? "routed"
          : view.route?.kind === "provider-policy-choice"
            ? "policy-routed"
            : "no-route"
        : "audio-unavailable"
    }>
      <summary>Live captions</summary>

      {view.readiness.kind !== "ready" ? (
        // THE LEGAL-AUDIO GATE: the honest typed refusal.
        <p className="wfx-row__reason" data-wfx-live-captions-gate>
          {view.readiness.detail}
        </p>
      ) : view.route === null ? (
        <p className="wfx-row__reason">The live speech route could not be read.</p>
      ) : view.route.kind === "no-live-route-registered" ? (
        // THE TYPED GAP + its recovery (never a fake live lane).
        <div data-wfx-live-captions-gap>
          <p className="wfx-row__reason">{view.route.detail}</p>
          <p className="wfx-row__reason" data-wfx-live-captions-recovery>
            {view.route.recovery}
          </p>
          <a className="wfx-btn wfx-btn--sm" href="/settings?section=model" data-wfx-live-captions-manage>
            Model &amp; AI settings
          </a>
        </div>
      ) : (
        <div data-wfx-live-captions-route={view.route.providerId}>
          <p className="wfx-player__trace" data-wfx-live-captions-route-detail>
            {view.route.detail}
          </p>
          <p className="wfx-player__trace" data-wfx-live-captions-envelope>
            The live lane&apos;s envelope: committed output in {view.envelope.chunkRangeMs} chunks,
            typically {view.envelope.averageLatencyMs} behind the audio.
          </p>
          {/* The committed stream (fixtures: the deterministic double over
              the transcript — loudly labeled; production: the R25 realtime
              seam serves the registered executor). */}
          <div className="wfx-live-captions__stream" data-wfx-live-captions-stream>
            {mode === "fixtures" ? (
              <p className="wfx-row__reason" data-wfx-live-captions-stream-note>
                Dev fixtures drive this stream deterministically (the transcript&apos;s committed
                segments) — the loud dev badge covers it; a registered live provider serves real
                committed output in production.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </details>
  );
}
