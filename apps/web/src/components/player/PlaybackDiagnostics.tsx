/**
 * @wfx/app-web — the playback diagnostics disclosure (R21-E, server).
 *
 * The progressive-disclosure law made literal: the player's engineering
 * truth — the Media Surface precedence trace (what was chosen and why),
 * the capability-skipped rungs, and the embed attestation note — renders
 * INSIDE a native `<details>` (collapsed by default, keyboard-operable,
 * server-rendered content). The primary viewing experience stays the
 * product sentences; the protocol vocabulary is one honest disclosure
 * away, never the main surface.
 */

import type { JSX } from "react";

import type { PlayerView } from "@/host/view-models";

/** The playback diagnostics disclosure (one per player render). */
export function PlaybackDiagnostics({ view }: { readonly view: PlayerView }): JSX.Element {
  const hasTrace = view.precedenceTrace.length > 0 || view.skippedForCapability.length > 0;
  if (!hasTrace && view.embedAttestation === null) {
    return (
      <></>
    );
  }
  return (
    <details className="wfx-player__diagnostics" data-wfx-playback-diagnostics>
      <summary className="wfx-player__diagnostics-toggle" data-wfx-playback-diagnostics-toggle>
        Playback details (how this was chosen)
      </summary>
      <div className="wfx-player__diagnostics-panel">
        {view.precedenceTrace.length > 0 ? (
          <div data-wfx-precedence-trace>
            {view.precedenceTrace.map((line, index) => (
              <p key={index} data-wfx-precedence-line={index}>
                {line}
              </p>
            ))}
          </div>
        ) : null}
        {view.skippedForCapability.map((skipped) => (
          <p key={skipped.mode} className="wfx-player__trace" data-wfx-player-skipped={skipped.mode}>
            Skipped {skipped.mode}: {skipped.reason}
          </p>
        ))}
        {view.embedAttestation !== null ? (
          <p className="wfx-player__trace" data-wfx-embed-attestation>
            Embed attestation: {view.embedAttestation} — the provider&apos;s own marker of their
            embeddable player, carried verbatim (never fabricated).
          </p>
        ) : null}
      </div>
    </details>
  );
}
