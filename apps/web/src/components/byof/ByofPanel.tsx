/**
 * @wfx/app-web — the BYOF settings panel (R20-D, server component).
 *
 * The Bring Your Own Feed entry inside the EXISTING settings/sources
 * surface (the frozen UX law: no new navigation system — Library/Settings
 * context owns the entry). The panel renders the full consumer flow:
 *
 *   choose source → connect/import → preview → confirm
 *
 * with the lane's UI truth laws:
 * - the source-native vs WebFlix MODE distinction is VISIBLE at every
 *   step (the preview carries the order-semantics sentence);
 * - the freshness truth is first-class (the capture is a SNAPSHOT, never
 *   presented as live — the preview says what it is and what it will
 *   become);
 * - the imported follow/subscription summary renders as plain counts;
 * - authorization failures render CLEAR + actionable (the not-connected
 *   truth on the card, the typed failure with its recovery path from the
 *   action result), never a silent empty state;
 * - the import trail shows every import's durable truth (staged previews,
 *   failed attempts, confirmed imports) — the honest attempt trail.
 *
 * The service-mode truth (the typed unavailable state) renders through
 * the same panel — never stale "arrives later" copy for this lane: the
 * panel states exactly what is wired and what the service boot lacks.
 */

import type { JSX } from "react";

import type {
  ByofImportView,
  ByofPanelView,
  ByofPreviewView,
  ByofSourceOptionView,
} from "@/host/byof/byof-view";
import {
  byofFormatTimestamp,
  byofRelationshipLabel,
  byofSyncTruth,
} from "@/host/byof/byof-view";
import { ByofPreviewActions, ByofSourceActions } from "@/components/byof/ByofActions";

/** The unavailable state (service mode's typed transport truth). */
function UnavailableState({ detail }: { readonly detail: string }): JSX.Element {
  return (
    <div className="wfx-byof__state" data-wfx-byof-unavailable>
      <p className="wfx-byof__state-title">Bring Your Own Feed isn&apos;t served by this boot</p>
      <p className="wfx-byof__state-detail">{detail}</p>
    </div>
  );
}

/** One relationship summary chip ("2 · Channels you follow"). */
function RelationshipChip({
  relationship,
  count,
}: {
  readonly relationship: string;
  readonly count: number;
}): JSX.Element {
  return (
    <span className="wfx-byof__chip" data-wfx-byof-relationship={relationship}>
      {count} · {byofRelationshipLabel(relationship)}
    </span>
  );
}

/** The relationship summary line of a preview or import. */
function RelationshipSummary({
  counts,
}: {
  readonly counts: Readonly<Record<string, number>>;
}): JSX.Element {
  const entries = Object.entries(counts);
  if (entries.length === 0) return <></>;
  return (
    <p className="wfx-byof__summary" data-wfx-byof-relationship-summary>
      {entries.map(([relationship, count], index) => (
        <span key={relationship}>
          {index > 0 ? " " : ""}
          <RelationshipChip relationship={relationship} count={count} />
        </span>
      ))}
    </p>
  );
}

/** One importable source card (the "choose source" step). */
function SourceCard({
  source,
  mode,
}: {
  readonly source: ByofSourceOptionView;
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  return (
    <li className="wfx-byof__card" data-wfx-byof-source={source.connectorId}>
      <div className="wfx-byof__card-head">
        <span className="wfx-byof__card-title">{source.displayName}</span>
        <span
          className={`wfx-byof-chip wfx-byof-chip--${source.connected ? "ok" : "neutral"}`}
          data-wfx-byof-source-auth-state={source.connected ? "connected" : "not-connected"}
        >
          {source.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="wfx-byof__card-detail">
        Importable: {source.importable.map(byofRelationshipLabel).join(", ")}
        {source.continuousSync
          ? " · this source can be re-read, so the import keeps itself current"
          : " · a one-time snapshot"}
        .
      </p>
      {source.unavailable.length > 0 ? (
        <ul className="wfx-byof__absences" data-wfx-byof-source-absences>
          {source.unavailable.map((absence) => (
            <li key={absence.relationship} data-wfx-byof-absence={absence.relationship}>
              Not available from {source.displayName}: {byofRelationshipLabel(absence.relationship)} —{" "}
              {absence.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <ByofSourceActions
        connectorId={source.connectorId}
        displayName={source.displayName}
        connected={source.connected}
        mode={mode}
      />
    </li>
  );
}

/** The staged preview panel (the "preview before you confirm" step). */
function PreviewPanel({ preview }: { readonly preview: ByofPreviewView }): JSX.Element {
  return (
    <section className="wfx-byof__preview" aria-label="Preview your import" data-wfx-byof-preview>
      <h3 className="wfx-byof__heading">Preview your import from {preview.displayName}</h3>
      <p className="wfx-byof__card-detail" data-wfx-byof-preview-count>
        Ready to bring in {preview.itemCount} item{preview.itemCount === 1 ? "" : "s"} — captured{" "}
        {byofFormatTimestamp(preview.sample[0]?.capturedAt ?? "")}.
      </p>
      <RelationshipSummary counts={preview.relationshipCounts} />
      <p className="wfx-byof__mode-note" data-wfx-byof-order-semantics="source-native">
        In {preview.displayName}&apos;s own order — this is the order {preview.displayName} lists
        your feed in, not a WebFlix ranking.
      </p>
      <p className="wfx-byof__freshness" data-wfx-byof-freshness={preview.freshness}>
        {preview.continuousSync
          ? "This capture is a snapshot of your feed as it stood. Because this source can be re-read, the import keeps itself current after you confirm (it will show as Live)."
          : "This capture is a snapshot of your feed as it stood — it is not live, and this source cannot be re-read automatically."}
      </p>
      <ol className="wfx-byof__sample" data-wfx-byof-preview-sample>
        {preview.sample.map((record) => (
          <li
            key={`${record.relationship}-${record.externalRef}-${record.sourceOrder}`}
            className="wfx-byof__sample-item"
            data-wfx-byof-sample-item
            data-wfx-byof-relationship={record.relationship}
            data-wfx-source-order={record.sourceOrder}
          >
            <span className="wfx-byof__sample-title">{record.title}</span>
            <span className="wfx-byof__sample-meta">
              {byofRelationshipLabel(record.relationship)} · position {record.sourceOrder + 1} as
              listed by {preview.displayName}
            </span>
          </li>
        ))}
      </ol>
      <p className="wfx-byof__card-detail" data-wfx-byof-preview-what-happens>
        Confirming imports exactly what you see above, with where it came from. It never touches
        your WebFlix watchlist, history, or recommendations — those stay their own thing.
      </p>
      <ByofPreviewActions importId={preview.importId} />
    </section>
  );
}

/** One import trail row (the honest durable state of every import). */
function ImportTrailRow({ entry }: { readonly entry: ByofImportView }): JSX.Element {
  const truth = byofSyncTruth({
    syncState: entry.syncState,
    disconnectedByUser: entry.disconnectedByUser,
    ...(entry.lastSyncedAt !== undefined ? { lastSyncedAt: entry.lastSyncedAt } : {}),
    ...(entry.errorDetail !== undefined ? { errorDetail: entry.errorDetail } : {}),
  });
  const isPreview = entry.status === "preview";
  return (
    <li
      className="wfx-byof__trail-row"
      data-wfx-byof-import={entry.importId}
      data-wfx-byof-import-status={entry.status}
      data-wfx-byof-sync-state={entry.syncState}
      {...(entry.disconnectedByUser ? { "data-wfx-byof-disconnected": "true" } : {})}
    >
      <div className="wfx-byof__card-head">
        <span className="wfx-byof__card-title">{entry.displayName}</span>
        <span className={`wfx-byof-chip wfx-byof-chip--${truth.tone}`} data-wfx-byof-sync-chip>
          {truth.label}
        </span>
      </div>
      <p className="wfx-byof__card-detail">
        {isPreview
          ? `A preview is staged (${entry.itemCount} items) — confirm it below.`
          : entry.status === "failed" || entry.status === "reauthorization-required"
            ? `An import was attempted from ${entry.displayName} but never captured (${entry.errorDetail ?? "the attempt failed"}).`
            : `${entry.itemCount} items imported${entry.importedAt !== undefined ? ` · imported ${byofFormatTimestamp(entry.importedAt)}` : ""}.`}
      </p>
      <p className="wfx-byof__freshness">{truth.detail}</p>
      {isPreview ? (
        <a
          className="wfx-byof-btn"
          href={`/settings?section=sources&byof=preview&import=${encodeURIComponent(entry.importId)}`}
        >
          Review the preview
        </a>
      ) : (
        <a className="wfx-byof-btn" href="/library">
          See your imported feed
        </a>
      )}
    </li>
  );
}

/** The BYOF settings panel (the flow entry inside the sources section). */
export function ByofPanel({
  view,
  mode,
}: {
  /** The honest panel view for this boot mode. */
  readonly view: ByofPanelView;
  /** The boot mode (the connect step's copy truth). */
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  return (
    <section className="wfx-byof" aria-label="Bring your feed" data-wfx-byof-panel>
      <h2 className="wfx-byof__heading">Bring your feed</h2>
      <p className="wfx-byof__intro">
        Import the feed you already have on a source — your follows, likes, and playlists come in
        exactly the order your source lists them, always labeled as your source&apos;s own order
        (never as WebFlix recommendations), with where they came from kept visible.
      </p>
      {view.state !== "ready" ? (
        <UnavailableState detail={view.detail ?? "the BYOF surface is not available in this boot"} />
      ) : (
        <>
          {view.sources.length > 0 ? (
            <ul className="wfx-byof__sources" data-wfx-byof-sources>
              {view.sources.map((source) => (
                <SourceCard key={source.connectorId} source={source} mode={mode} />
              ))}
            </ul>
          ) : (
            <div className="wfx-byof__state" data-wfx-byof-no-sources>
              <p className="wfx-byof__state-title">No feed-import sources yet</p>
              <p className="wfx-byof__state-detail">
                Sources that can bring your feed appear here as they connect.
              </p>
            </div>
          )}
          {view.preview !== null ? <PreviewPanel preview={view.preview} /> : null}
          {view.imports.length > 0 ? (
            <div className="wfx-byof__trail" data-wfx-byof-imports>
              <h3 className="wfx-byof__heading">Your imports</h3>
              <ul className="wfx-byof__trail-list">
                {view.imports.map((entry) => (
                  <ImportTrailRow key={entry.importId} entry={entry} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
