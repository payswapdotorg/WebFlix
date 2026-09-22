/**
 * @wfx/app-web — the authorized peer copy's PLAYBACK stage (R23-E).
 *
 * The first-class torrent realization playing through the BROWSER rung
 * (WebTorrent/WebRTC — the R23-D adapter): the acquisition lifecycle's
 * protocol-free states drive the stage (Buffering -> Playing before
 * completion -> Completing -> Ready offline), the typed actions are the
 * SAME acquisition vocabulary (pause/resume/retry — the parity set),
 * and the parity surfaces render exactly as on the provider stage
 * (Where-to-watch switch row, the AI tray, feedback, actions — the same
 * canonical identity, the same resume position).
 *
 * WHEN THIS ADAPTER CANNOT PLAY THE COPY (an ordinary TCP/UDP-only
 * swarm, or the viewer's browser without WebRTC): the stage renders the
 * honest DESKTOP NEXT STEP (the same canonical item, the same position,
 * the same library — the R23-C `desktop-next-step` outcome), never a
 * dead "unavailable" and never a protocol error dump.
 *
 * Server component; the interactive controls are the `AcquisitionActions`
 * island (the same typed action vocabulary) + the `TorrentStageProbe`
 * island (the viewer's WebRTC environment truth).
 */

import type { JSX } from "react";

import type { PlayerShellView } from "@/host/view-models";
import { AcquisitionPanel } from "@/components/acquisition/AcquisitionPanel";
import { TorrentStageProbe } from "@/components/player/TorrentStageProbe";
import { Icon } from "@/components/shell/Icon";
import { ErrorState } from "@/components/ui/StateViews";
import { firstCodePointOf, formatPosition } from "@/components/ui/format";

/** The authorized peer copy's stage (the browser rung). */
export function TorrentPlaybackStage({ view }: { readonly view: PlayerShellView }): JSX.Element {
  const torrent = view.torrent;
  if (torrent === null) {
    // The provider stage owns this render (the torrent view is absent).
    return <></>;
  }

  // The honest Desktop next step — the rung decision says this adapter
  // cannot play this copy (an ordinary swarm). The SAME CANONICAL ITEM
  // stays presented with its next step (the R21 "unsupported is not
  // undiscoverable" law, carried by the R23-C contract).
  if (torrent.rungKind === "desktop-next-step") {
    return (
      <div className="wfx-player__stage" data-wfx-player-mode="torrent-desktop-next-step">
        <Icon name="play" size={28} />
        <p data-wfx-torrent-next-step-label>{torrent.desktopNextStep?.label ?? "Play this in the Desktop app"}</p>
        <p className="wfx-row__reason" data-wfx-torrent-next-step>
          {torrent.rungDetail}
        </p>
        <p className="wfx-row__reason" data-wfx-torrent-next-step-detail>
          {torrent.desktopNextStep?.detail ?? ""}
        </p>
        <a className="wfx-btn" href={`/item?id=${encodeURIComponent(view.itemId)}&connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}`} data-wfx-torrent-back-to-details>
          Back to this title
        </a>
      </div>
    );
  }

  // The typed authorization refusal — the copy is not authorized; it is
  // NEVER offered as playback (the R11/R13 gate; this render is the
  // defensive truth, not a path the surfaces link).
  if (torrent.rungKind === "requires-authorization") {
    return (
      <div className="wfx-player__stage" data-wfx-player-mode="torrent-unauthorized">
        <Icon name="skip" size={28} />
        <ErrorState
          title="This peer copy is not authorized"
          detail={torrent.rungDetail}
          retry={
            <a
              className="wfx-btn"
              href={`/item?id=${encodeURIComponent(view.itemId)}&connector=${encodeURIComponent(view.connectorId)}&ref=${encodeURIComponent(view.externalRef)}&title=${encodeURIComponent(view.title)}&type=${encodeURIComponent(view.canonicalType)}`}
            >
              Choose another way to watch
            </a>
          }
        />
      </div>
    );
  }

  // The BROWSER RUNG: the acquisition lifecycle drives the stage. The
  // lifecycle surface (states, truthful progress, typed actions) is the
  // SAME acquisition panel vocabulary the Desktop renders — the parity
  // law (one protocol-free vocabulary, two adapters).
  return (
    <div className="wfx-player__stage" data-wfx-player-mode="torrent" data-wfx-torrent-stage>
      <div className="wfx-player__video" data-wfx-torrent-video-area>
        {/* The player shell stays (the R24 law: loading/recovery states
            preserve the shell); the media mount itself is the browser
            adapter's business (the client probe below carries the
            environment truth — no fabricated frames here). */}
        <span className="wfx-card__art" aria-hidden="true">
          {/* R26-W2 — code-point-safe leading glyph (an emoji-leading real
              catalog title renders the whole emoji, never a lone surrogate
              — the same hydration law the card monogram keeps). */}
          <span>{firstCodePointOf(view.title.trim())}</span>
        </span>
      </div>
      <p className="wfx-player__trace" data-wfx-torrent-rung-detail>
        Playing your authorized peer copy — it plays like any other way of watching, keeps your
        place, and lands in your Library.
      </p>
      {view.resumePositionMs > 0 ? (
        <p className="wfx-player__trace" data-wfx-torrent-resume>
          Resuming at {formatPosition(view.resumePositionMs)} — the peer copy keeps your place like
          any other way of watching.
        </p>
      ) : null}
      {/* The adapter truth is PROGRESSIVELY DISCLOSED (the design
          language: the primary experience is watching, not a protocol
          readout): the wired adapter identity + the viewer's WebRTC
          environment truth render behind one closed disclosure. */}
      <details className="wfx-playback-diagnostics" data-wfx-torrent-diagnostics>
        <summary data-wfx-torrent-diagnostics-toggle>How this copy reaches you</summary>
        <p className="wfx-player__trace" data-wfx-torrent-implementation>
          Wired adapter: {torrent.implementation}.
        </p>
        <TorrentStageProbe mode={view.mode} />
      </details>
    </div>
  );
}

/** The peer copy's lifecycle surface, rendered under the player stage. */
export function TorrentAcquisitionLifecycle({ view }: { readonly view: PlayerShellView }): JSX.Element {
  const torrent = view.torrent;
  if (torrent === null) return <></>;
  return (
    <AcquisitionPanel
      view={torrent.acquisition.view}
      diagnostics={torrent.acquisition.diagnostics}
      mode={view.mode}
      canAcquireOnThisDevice={false}
      sourceRef={view.externalRef}
    />
  );
}
