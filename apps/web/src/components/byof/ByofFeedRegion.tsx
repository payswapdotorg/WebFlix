/**
 * @wfx/app-web — the BYOF Library feed region (R20-D, server component).
 *
 * The "feed appears" step of Bring Your Own Feed: the imported feed lives
 * in the Library (the frozen UX law — the entry lives in the existing
 * Library/Settings IA, no new navigation system). The region renders the
 * lane's UI truth laws:
 *
 * - MODE VISIBILITY: the region carries the source-native order sentence
 *   (`data-wfx-byof-mode="byof"`) and the explicit separation statement —
 *   an imported feed is visibly NOT WebFlix-ranked discovery and never
 *   silently becomes the user's recommendation identity (the anti-tunnel
 *   truth in plain language, with the Home link as the distinct mode).
 * - FRESHNESS SURFACE: every import's sync state renders as a chip +
 *   plain-language detail (a snapshot is never live; a disconnect says
 *   records are retained; a reauthorization gap names its recovery).
 * - FOLLOW/SUBSCRIPTION SUMMARY: the "Following" subset renders as its
 *   own count + group.
 * - UNDO/DISCONNECT: the import actions offer the NON-destructive
 *   disconnect (records retained — this region keeps rendering them with
 *   their provenance) and the SEPARATE explicit destructive delete.
 */

import type { JSX } from "react";

import type { ByofFeedView, ByofImportFeedView } from "@/host/byof/byof-view";
import {
  byofFormatTimestamp,
  byofOrderModeLabel,
  byofRelationshipLabel,
  byofSyncTruth,
} from "@/host/byof/byof-view";
import { ByofImportActions } from "@/components/byof/ByofActions";

/** The just-imported banner (the `?byof=imported` post-confirm landing). */
function ImportedBanner(): JSX.Element {
  return (
    <div className="wfx-byof__banner" data-wfx-byof-imported-banner>
      Your feed was imported — your items are below, in your source&apos;s own order.
    </div>
  );
}

/** One source-native record group (the store's read order, verbatim). */
function RecordGroup({
  group,
  sourceDisplayName,
}: {
  readonly group: ByofImportFeedView["groups"][number];
  readonly sourceDisplayName: string;
}): JSX.Element {
  return (
    <div
      className="wfx-byof__group"
      data-wfx-byof-group={group.relationship}
      data-wfx-byof-group-count={group.records.length}
    >
      <p className="wfx-byof__group-label">
        {byofRelationshipLabel(group.relationship)} — {group.records.length} · in{" "}
        {sourceDisplayName}&apos;s own order
      </p>
      <ol className="wfx-byof__records">
        {group.records.map((record) => (
          <li
            key={`${record.relationship}-${record.externalRef}-${record.sourceOrder}`}
            className="wfx-byof__record"
            data-wfx-byof-record
            data-wfx-byof-relationship={record.relationship}
            data-wfx-source-order={record.sourceOrder}
          >
            <span className="wfx-byof__record-title">{record.title}</span>
            <span className="wfx-byof__record-meta">
              position {record.sourceOrder + 1} as listed by {sourceDisplayName} · captured{" "}
              {byofFormatTimestamp(record.capturedAt)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One imported feed entry (the import's durable truth + its records). */
function ImportedFeed({ entry }: { readonly entry: ByofImportFeedView }): JSX.Element {
  const view = entry.import;
  const truth = byofSyncTruth({
    syncState: view.syncState,
    disconnectedByUser: view.disconnectedByUser,
    ...(view.lastSyncedAt !== undefined ? { lastSyncedAt: view.lastSyncedAt } : {}),
    ...(view.errorDetail !== undefined ? { errorDetail: view.errorDetail } : {}),
  });
  // The sync action's honest truth: offered on every continuously
  // re-readable route EXCEPT a user-disconnected import (the user ended
  // it — recovery is a fresh import, never a quiet resurrection). A
  // reauthorization GAP keeps the button: after the user reconnects the
  // source, THIS sync is the import's recovery path (while the grant is
  // missing, the sync honestly answers the typed unauthorized failure
  // with its connect recovery — never a fake success).
  const canSync = view.continuousSync && !view.disconnectedByUser && view.syncState !== "unsupported";
  return (
    <section
      className="wfx-byof__feed-entry"
      aria-label={`Imported feed from ${view.displayName}`}
      data-wfx-byof-import={view.importId}
      data-wfx-byof-sync-state={view.syncState}
      data-wfx-byof-order-semantics="source-native"
      {...(view.disconnectedByUser ? { "data-wfx-byof-disconnected": "true" } : {})}
    >
      <div className="wfx-byof__card-head">
        <span className="wfx-byof__card-title">{view.displayName}</span>
        <span className={`wfx-byof-chip wfx-byof-chip--${truth.tone}`} data-wfx-byof-sync-chip>
          {truth.label}
        </span>
      </div>
      <p className="wfx-byof__card-detail">
        {view.itemCount} items imported via{" "}
        {view.method === "api" ? "the authorized API" : view.method}
        {view.capturedAt !== undefined ? ` · captured ${byofFormatTimestamp(view.capturedAt)}` : ""}
        {view.lastSyncedAt !== undefined ? ` · last synced ${byofFormatTimestamp(view.lastSyncedAt)}` : ""}
        .
      </p>
      <p className="wfx-byof__freshness">{truth.detail}</p>
      <p className="wfx-byof__mode-note" data-wfx-byof-mode-note>
        {byofOrderModeLabel(view.displayName)} — WebFlix recommendations stay separate:{" "}
        <a href="/">what Home recommends you</a> is built from your own WebFlix activity, never
        silently replaced by this imported feed.
      </p>
      {entry.groups.map((group) => (
        <RecordGroup key={group.relationship} group={group} sourceDisplayName={view.displayName} />
      ))}
      <ByofImportActions importId={view.importId} itemCount={view.itemCount} canSync={canSync} />
    </section>
  );
}

/** The BYOF Library feed region. */
export function ByofFeedRegion({
  view,
  justImported,
}: {
  /** The honest feed view for this boot mode. */
  readonly view: ByofFeedView;
  /** Whether this render is the post-confirm landing (`?byof=imported`). */
  readonly justImported?: boolean;
}): JSX.Element {
  return (
    <section className="wfx-byof" aria-label="Your imported feeds" data-wfx-byof-feed data-wfx-byof-mode="byof">
      <h2 className="wfx-byof__heading">Your imported feeds</h2>
      <p className="wfx-byof__intro">
        Feeds you brought from your sources — shown in each source&apos;s own order, with where
        they came from. Your WebFlix watchlist and history below stay their own thing: an import
        never writes into them, and disconnecting an import never deletes them.
      </p>
      {view.state !== "ready" ? (
        <div className="wfx-byof__state" data-wfx-byof-unavailable>
          <p className="wfx-byof__state-title">Bring Your Own Feed isn&apos;t served by this boot</p>
          <p className="wfx-byof__state-detail">
            {view.detail ?? "the BYOF surface is not available in this boot"}
          </p>
        </div>
      ) : view.imports.length === 0 ? (
        <div className="wfx-byof__state" data-wfx-byof-empty>
          <p className="wfx-byof__state-title">No imported feeds yet</p>
          <p className="wfx-byof__state-detail">
            Bring the feed you already have on a source — your follows, likes, and playlists, in
            your source&apos;s own order.
          </p>
          <a className="wfx-byof-btn wfx-byof-btn--primary" href="/settings?section=sources">
            Bring your feed
          </a>
        </div>
      ) : (
        <>
          {justImported ? <ImportedBanner /> : null}
          {view.imports.map((entry) => (
            <ImportedFeed key={entry.import.importId} entry={entry} />
          ))}
          <p className="wfx-byof__card-detail" data-wfx-byof-following-summary>
            Following summary: {view.followingCount} followed channel
            {view.followingCount === 1 ? "" : "s"} across your imported feed
            {view.imports.length === 1 ? "" : "s"} (the &quot;Following&quot; subset of what you
            imported — shown in each source&apos;s own order).
          </p>
        </>
      )}
    </section>
  );
}
