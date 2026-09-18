/**
 * @wfx/app-web — the ADVANCED DIAGNOSTICS surface (R14): THE GATED VIEW.
 *
 * ⚠️ PROTOCOL VOCABULARY LIVES HERE — AND ONLY HERE ⚠️
 *
 * This is the explicitly-gated advanced surface the J21-J25 journeys
 * mandate: the torrent-protocol detail (the honest session/scheduler
 * states, connected peers, verified pieces, transfer rates, the infohash,
 * the authorization provenance, where the bytes live) renders ONLY inside
 * this closed-by-default disclosure. The DEFAULT surfaces (the
 * `AcquisitionPanel` and everything else) render protocol-free strings
 * only — enforced by the runtime's leak guard and the surface tests
 * (which strip this container from the markup before scanning).
 *
 * Server component; a plain `<details>` disclosure (closed by default,
 * keyboard-accessible, no JS required).
 */

import type { JSX } from "react";

import type { AcquisitionDiagnosticsView } from "@wfx/client-runtime";

/** An honest rate in human bytes/second. */
function formatRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${Math.round(bytesPerSec / 1024)} kB/s`;
  return `${bytesPerSec} B/s`;
}

/** The gated advanced-diagnostics disclosure. */
export function AcquisitionDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: AcquisitionDiagnosticsView | null;
}): JSX.Element {
  return (
    <details className="wfx-acquisition__diagnostics" data-wfx-advanced-diagnostics>
      <summary data-wfx-advanced-diagnostics-summary>
        Advanced diagnostics
      </summary>
      <p className="wfx-detail__meta">
        Technical detail about how this title is being downloaded. This view is for troubleshooting —
        you don&apos;t need it to watch.
      </p>
      {diagnostics === null ? (
        <p className="wfx-detail__meta" data-wfx-advanced-diagnostics-empty>
          No technical detail is available on this device.
        </p>
      ) : (
        <dl className="wfx-acquisition__diagnostics-grid" data-wfx-advanced-diagnostics-data>
          {diagnostics.sessionState !== undefined ? (
            <div>
              <dt>Session state</dt>
              <dd data-wfx-diagnostics-session-state>{diagnostics.sessionState}</dd>
            </div>
          ) : null}
          {diagnostics.schedulerState !== undefined ? (
            <div>
              <dt>Scheduler</dt>
              <dd data-wfx-diagnostics-scheduler-state>{diagnostics.schedulerState}</dd>
            </div>
          ) : null}
          {diagnostics.peersConnected !== undefined ? (
            <div>
              <dt>Connected peers</dt>
              <dd data-wfx-diagnostics-peers>{diagnostics.peersConnected}</dd>
            </div>
          ) : null}
          {diagnostics.piecesVerified !== undefined && diagnostics.piecesTotal !== undefined ? (
            <div>
              <dt>Verified pieces</dt>
              <dd data-wfx-diagnostics-pieces>
                {diagnostics.piecesVerified} of {diagnostics.piecesTotal}
              </dd>
            </div>
          ) : null}
          {diagnostics.downloadBytesPerSec !== undefined ? (
            <div>
              <dt>Download rate</dt>
              <dd data-wfx-diagnostics-download-rate>{formatRate(diagnostics.downloadBytesPerSec)}</dd>
            </div>
          ) : null}
          {diagnostics.uploadBytesPerSec !== undefined ? (
            <div>
              <dt>Upload rate</dt>
              <dd data-wfx-diagnostics-upload-rate>{formatRate(diagnostics.uploadBytesPerSec)}</dd>
            </div>
          ) : null}
          {diagnostics.stallKind !== undefined ? (
            <div>
              <dt>Transfer health</dt>
              <dd data-wfx-diagnostics-stall>{diagnostics.stallKind}</dd>
            </div>
          ) : null}
          {diagnostics.infoHash !== undefined ? (
            <div>
              <dt>Info hash</dt>
              <dd data-wfx-diagnostics-infohash>{diagnostics.infoHash}</dd>
            </div>
          ) : null}
          {diagnostics.provenance !== undefined ? (
            <div>
              <dt>Authorized source</dt>
              <dd data-wfx-diagnostics-provenance>
                {diagnostics.provenance.sourceId} ({diagnostics.provenance.basis})
              </dd>
            </div>
          ) : null}
          {diagnostics.dataDir !== undefined ? (
            <div>
              <dt>Storage location</dt>
              <dd data-wfx-diagnostics-datadir>{diagnostics.dataDir}</dd>
            </div>
          ) : null}
          {diagnostics.offlineReadyKey !== undefined ? (
            <div>
              <dt>Offline library key</dt>
              <dd data-wfx-diagnostics-offline-key>{diagnostics.offlineReadyKey}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </details>
  );
}
