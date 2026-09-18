/**
 * @wfx/app-web — the acquisition panel (R14): the DEFAULT lifecycle surface.
 *
 * Renders ONE `AcquisitionStatusView` (the runtime's honest, protocol-free
 * fold of the adapter's facts) in the user lifecycle vocabulary — the
 * J21-J25 "No native protocol" law: Available / Preparing / Buffering /
 * Playing / Completing / Ready offline / Couldn't finish, with TRUTHFUL
 * progress (no bar when honestly unknown — never a fake number), the
 * paused modifier, the J25 resuming sentence, the typed failure with its
 * typed actions, and the explicitly-gated advanced-diagnostics disclosure
 * (protocol vocabulary lives ONLY there).
 *
 * When NO view exists and the platform cannot acquire (the honest web
 * capability truth), the panel renders the limited-status note (J21/J22
 * on Web): native acquisition runs in the WebFlix desktop app. Server
 * component; the interactive controls are the `AcquisitionActions` island.
 */

import type { JSX } from "react";

import type {
  AcquisitionDiagnosticsView,
  AcquisitionStatusView,
} from "@wfx/client-runtime";

import { AcquisitionActions } from "@/components/acquisition/AcquisitionActions";
import { AcquisitionDiagnostics } from "@/components/acquisition/AcquisitionDiagnostics";

/** The state badge's tone (visual hierarchy only — the label is the truth). */
const STATE_TONES: Readonly<Record<string, string>> = {
  available: "wfx-badge wfx-badge--type",
  preparing: "wfx-badge wfx-acquisition__badge--progress",
  buffering: "wfx-badge wfx-acquisition__badge--progress",
  playing: "wfx-badge wfx-acquisition__badge--live",
  completing: "wfx-badge wfx-acquisition__badge--progress",
  "ready-offline": "wfx-badge wfx-acquisition__badge--ready",
  failed: "wfx-badge wfx-acquisition__badge--failed",
};

/** An honest human byte size. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** The acquisition panel: one item's honest lifecycle surface. */
export function AcquisitionPanel({
  view,
  diagnostics,
  mode,
  canAcquireOnThisDevice,
  sourceRef,
}: {
  /** The runtime's current view (null when nothing is known). */
  readonly view: AcquisitionStatusView | null;
  /** The gated diagnostics payload (null when no technical detail exists). */
  readonly diagnostics: AcquisitionDiagnosticsView | null;
  /** The host boot mode (the dev-drive control renders in fixtures mode only). */
  readonly mode: "fixtures" | "service";
  /** Whether THIS platform can start acquisitions (the web truth: false). */
  readonly canAcquireOnThisDevice: boolean;
  /** The item's stable source ref (the dev drive's cross-module key). */
  readonly sourceRef?: string | undefined;
}): JSX.Element {
  // The honest limited-status note (J21/J22 on Web — capability truth).
  if (view === null) {
    return (
      <section
        className="wfx-detail__section"
        aria-label="Offline availability"
        data-wfx-acquisition
        data-wfx-acquisition-none
      >
        <h2>Offline copy</h2>
        {canAcquireOnThisDevice ? (
          <p className="wfx-detail__meta" data-wfx-acquisition-available>
            Ready to be made available offline.
          </p>
        ) : (
          <p className="wfx-detail__meta" data-wfx-acquisition-elsewhere>
            You can make this title available offline in the WebFlix desktop app — it downloads and
            verifies a copy you can watch without a connection.
          </p>
        )}
      </section>
    );
  }

  const percent =
    view.progress !== null ? Math.max(0, Math.min(100, Math.round(view.progress * 100))) : null;

  return (
    <section
      className="wfx-detail__section"
      aria-label="Offline copy"
      data-wfx-acquisition
      data-wfx-acquisition-state={view.state}
    >
      <h2>Offline copy</h2>
      <div className="wfx-acquisition" data-wfx-acquisition-item={view.itemId}>
        <p className="wfx-detail__meta">
          <span className={STATE_TONES[view.state] ?? "wfx-badge wfx-badge--type"} data-wfx-acquisition-label>
            {view.paused ? "Paused" : view.label}
          </span>
          {view.resumed ? (
            <span className="wfx-badge" data-wfx-acquisition-resuming>
              Resuming
            </span>
          ) : null}
          {percent !== null ? <span data-wfx-acquisition-percent>{percent}%</span> : null}
          {view.state === "playing" && view.runwaySeconds !== null ? (
            <span data-wfx-acquisition-runway>{Math.round(view.runwaySeconds)}s buffered ahead</span>
          ) : null}
          {view.offline !== undefined ? (
            <span data-wfx-acquisition-size>
              {formatBytes(view.offline.sizeBytes)} · verified offline
            </span>
          ) : null}
        </p>
        {/* TRUTHFUL PROGRESS: a bar only when the fraction is known — an
            honestly-unknown progress renders NO bar (never a fake one). */}
        {percent !== null && view.state !== "ready-offline" ? (
          <progress
            className="wfx-acquisition__progress"
            data-wfx-acquisition-progress
            value={percent}
            max={100}
          >
            {percent}%
          </progress>
        ) : null}
        <p className="wfx-detail__meta" data-wfx-acquisition-detail>
          {view.detail}
        </p>
        {view.failure !== undefined ? (
          <p
            className="wfx-detail__meta wfx-acquisition__failure"
            data-wfx-acquisition-failure={view.failure.cause}
            data-wfx-acquisition-recoverable={view.failure.recoverable ? "true" : "false"}
          >
            {view.failure.recoverable ? "You can try again." : "This can't be retried — the authorization for this download is gone."}
          </p>
        ) : null}
        <AcquisitionActions view={view} mode={mode} sourceRef={sourceRef} />
      </div>
      <AcquisitionDiagnostics diagnostics={diagnostics} />
    </section>
  );
}
