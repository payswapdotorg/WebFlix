/**
 * @wfx/app-web — the Bring Your Feed surface (R20-D).
 *
 * The BYOF destination over the BYOF host service's typed results:
 * the onboarding wizard (choose source → connect/import → preview →
 * confirm), the imported-feed view under the MODE selector (the visible
 * source-native vs WebFlix distinction — the J33 law), the import
 * management rows (freshness/live/snapshot truth, sync, disconnect,
 * the SEPARATE explicit delete-records), and the honest authorization
 * failure state with its recovery path (never a silent empty state).
 *
 * THE UI LAWS THIS SURFACE KEEPS (docs/architecture/byof-architecture.md):
 * - MODE VISIBILITY: the source-native order is labeled "Source order —
 *   exactly as the source lists it. WebFlix does not rank this list." and
 *   the WebFlix mode renders ONLY WebFlix's own discovery composition
 *   (never the imported records — the service's mode-truth law pins the
 *   empty read; the surface states it in plain language too).
 * - FRESHNESS FIRST-CLASS: every import row carries its freshness chip
 *   (live / snapshot / stale / needs-reconnect) with the label text —
 *   state is never communicated by color alone.
 * - SNAPSHOT NEVER LIVE: the export route's preview states the one-time
 *   snapshot truth; the sync of a one-time route is refused with the
 *   honest verdict (never a fake refresh).
 * - DISCONNECT NON-DESTRUCTIVE: the disconnect action's copy states the
 *   records are KEPT; the delete-records action is the SEPARATE explicit
 *   path with its own confirmation.
 * - AUTHORIZATION FAILURES: the named problem + the reconnect recovery
 *   path (Settings → the source's reconnect flow).
 *
 * Server component: the wizard's typed actions are the client island
 * (`ByofActions`); everything here renders the service's current truth.
 */

import type { JSX } from "react";

import { itemDetailHref } from "@/app/routing";
import { canonicalIdFor } from "@/host/web-host";
import type { ByofImportView, ByofRecordView } from "@/host/byof/service";
import type { ByofFeedViewModel, ByofPreviewView } from "@/host/byof/view-models";
import { BYOF_MODES, FEED_FRESHNESS_LABELS, relationshipSummaryOf } from "@/host/byof/view-models";
import type { CardView } from "@/host/view-models";
import { ByofActions, type ByofActionSpec } from "@/components/byof/ByofActions";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";

// ---------------------------------------------------------------------------
// The label vocabularies (plain language, rendered with the state — never color alone)
// ---------------------------------------------------------------------------

/** The relationship labels (the row vocabulary). */
const RELATIONSHIP_LABELS: Readonly<Record<string, string>> = {
  follow: "Channel you follow",
  subscription: "Subscription",
  playlist: "Playlist item",
  watchlist: "Watch-later item",
  like: "Liked item",
  save: "Saved item",
  "ranked-feed": "Ranked-feed item",
  history: "History item",
  unknown: "Item",
};

/** The import status labels. */
const IMPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  preview: "Preview staged — not imported yet",
  confirmed: "Imported",
  failed: "Import failed",
  "reauthorization-required": "Needs reconnect",
  disconnected: "Import disconnected — records kept",
};

/**
 * The fixture catalog's own item refs (the honest link truth): the BYOF
 * fixture's item-relationship records reference the SAME catalog entries
 * every other surface links — the rows join through the per-process
 * canonical seam (`canonicalIdFor`, the documented R04 stopgap every card
 * link uses). Follow/subscription targets and unknown refs stay UNLINKED
 * (a channel is not an EntertainmentItem — the WFX-054 law).
 */
const JOINABLE_ITEM_REFS: readonly {
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
}[] = [
  { externalRef: "fake:movie-1", title: "Asteroid Drift", canonicalType: "movie" },
  { externalRef: "fake:series-1", title: "Harbor Lights", canonicalType: "series" },
  { externalRef: "fake:video-1", title: "Deep Field Diary", canonicalType: "video" },
  { externalRef: "fake:video-2", title: "Static Bloom", canonicalType: "video" },
  { externalRef: "fake:video-3", title: "Desert Rain Doc", canonicalType: "video" },
  { externalRef: "fake:video-4", title: "Signal Fade", canonicalType: "video" },
  { externalRef: "fake:short-1", title: "Neon Rain", canonicalType: "video" },
  { externalRef: "fake:short-2", title: "Midnight Scoop", canonicalType: "video" },
  { externalRef: "fake:short-3", title: "Rain Check", canonicalType: "video" },
];

/** The item-detail href join (null ⇒ the honest unlinked row). */
function joinedHrefOf(externalRef: string): string | null {
  const entry = JOINABLE_ITEM_REFS.find((ref) => ref.externalRef === externalRef);
  if (entry === undefined) return null;
  return itemDetailHref({
    itemId: canonicalIdFor("fake-source", externalRef),
    connectorId: "fake-source",
    externalRef: entry.externalRef,
    title: entry.title,
    canonicalType: entry.canonicalType,
  });
}

/** Format one ISO instant as the plain row stamp (UTC, honest). */
function stampOf(iso: string | null): string {
  if (iso === null || iso.length === 0) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/** The mode selector (the visible mode distinction — tabs over the frozen product modes). */
function ModeTabs({ mode }: { readonly mode: string }): JSX.Element {
  return (
    <nav aria-label="Feed modes" data-wfx-byof-modes>
      {BYOF_MODES.map((choice) => (
        <a
          key={choice.id}
          className={`wfx-btn wfx-btn--sm${mode === choice.id ? " wfx-btn--primary" : ""}`}
          href={`/library/bring-feed?mode=${choice.id}`}
          data-wfx-byof-mode-tab={choice.id}
          {...(mode === choice.id ? { "aria-current": "page" as const } : {})}
        >
          {choice.label}
        </a>
      ))}
    </nav>
  );
}

/** The relationship summary rows (the imported follow/subscription summary). */
function RelationshipSummary({
  counts,
  testId,
}: {
  readonly counts: Readonly<Record<string, number>>;
  readonly testId: string;
}): JSX.Element | null {
  const rows = relationshipSummaryOf(counts);
  if (rows.length === 0) return null;
  return (
    <ul
      className="wfx-card__meta"
      data-wfx-byof-relationship-summary={testId}
      style={{ listStyle: "none", padding: 0, margin: 0 }}
    >
      {rows.map((row) => (
        <li key={row.relationship} data-wfx-byof-preview-count={row.relationship}>
          {row.label}: <strong data-wfx-byof-count-value={row.relationship}>{row.count}</strong>
        </li>
      ))}
    </ul>
  );
}

/** One imported record row (source-native order, provenance visible). */
function RecordRow({ record }: { readonly record: ByofRecordView }): JSX.Element {
  const joinedHref = joinedHrefOf(record.externalRef);
  const title = record.title ?? record.externalRef;
  return (
    <li
      className="wfx-queue__item"
      data-wfx-byof-record={record.key}
      data-wfx-byof-record-relationship={record.relationship}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type" data-wfx-byof-record-order>
          #{record.sourceOrder + 1}
        </span>
        <span className="wfx-capchip" data-wfx-byof-record-kind>
          {RELATIONSHIP_LABELS[record.relationship] ?? record.relationship}
        </span>
        {record.sourceRef !== null ? (
          <span className="wfx-capchip" data-wfx-byof-record-container>
            {record.sourceRef === "LL" ? "Liked list" : record.sourceRef}
          </span>
        ) : null}
        {record.deferredResolution !== null ? (
          <span
            className="wfx-capchip"
            data-wfx-byof-record-deferred
            title="A channel is not a WebFlix item — its canonical anchor is deferred (the WFX-054 law)."
          >
            Channel — not a WebFlix item
          </span>
        ) : null}
      </span>
      {joinedHref !== null ? (
        <a className="wfx-card__title" data-wfx-byof-record-title href={joinedHref}>
          {title}
        </a>
      ) : (
        <p className="wfx-card__title" data-wfx-byof-record-title>
          {title}
        </p>
      )}
      <p className="wfx-card__meta" data-wfx-byof-record-provenance>
        From your source in its own order · captured {stampOf(record.capturedAt)}
        {record.sourceUpdatedAt !== null
          ? ` · updated at the source ${stampOf(record.sourceUpdatedAt)}`
          : ""}
      </p>
    </li>
  );
}

/** The staged-preview card (the wizard's confirm step). */
function PreviewCard({
  preview,
  mode,
}: {
  readonly preview: ByofPreviewView;
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  return (
    <section
      className="wfx-detail__section"
      aria-label="Preview your import"
      data-wfx-byof-preview
      data-wfx-byof-preview-import={preview.importId}
    >
      <h2>Ready to import from the connected source</h2>
      <p className="wfx-detail__meta">
        {preview.itemCount} items found through the{" "}
        {preview.method === "api" ? "authorized connection" : "official export file"} — review them
        before anything is saved. Confirming imports exactly what you see here.
      </p>
      <RelationshipSummary counts={preview.relationshipCounts} testId={preview.importId} />
      <p className="wfx-row__reason" data-wfx-byof-order-truth>
        Source order — exactly as your source lists it. WebFlix does not rank this list.
      </p>
      <p
        className="wfx-row__reason"
        data-wfx-byof-preview-freshness
        data-wfx-byof-preview-continuous={preview.continuousSync ? "true" : "false"}
      >
        {preview.freshnessNote}
      </p>
      <ul
        className="wfx-queue__list"
        style={{ listStyle: "none", padding: 0 }}
        data-wfx-byof-preview-sample
      >
        {preview.sample.map((row) => (
          <li
            key={`${row.relationship}-${row.sourceRef ?? ""}-${row.sourceOrder}`}
            className="wfx-queue__item"
            data-wfx-byof-preview-sample-row
          >
            <span className="wfx-card__meta">
              <span className="wfx-badge wfx-badge--type">#{row.sourceOrder + 1}</span>
              <span className="wfx-capchip">
                {RELATIONSHIP_LABELS[row.relationship] ?? row.relationship}
              </span>
              {row.sourceRef !== null ? (
                <span className="wfx-capchip">
                  {row.sourceRef === "LL" ? "Liked list" : row.sourceRef}
                </span>
              ) : null}
            </span>
            <p className="wfx-card__title" data-wfx-byof-preview-sample-title>
              {row.title ?? row.relationship}
            </p>
          </li>
        ))}
      </ul>
      <ByofActions
        shape="preview"
        importId={preview.importId}
        mode={mode}
        actions={[
          { action: "confirm", label: "Confirm import", primary: true, importId: preview.importId },
          { action: "discard", label: "Discard this preview", importId: preview.importId },
        ]}
      />
    </section>
  );
}

/** One import's management row (the summaries + freshness + typed actions). */
function ImportRow({
  row,
  mode,
}: {
  readonly row: ByofImportView;
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  const actions: ByofActionSpec[] = [];
  // The sync action: the confirmed continuous route, AND the
  // needs-reconnect one (the retry-after-reconnect recovery path — the
  // fold refuses again while the grant is still expired, honestly).
  if (
    (row.status === "confirmed" || row.status === "reauthorization-required") &&
    row.continuousSync
  ) {
    actions.push({ action: "sync", label: "Sync now", importId: row.id });
  }
  if (row.status === "confirmed" || row.status === "reauthorization-required") {
    actions.push({
      action: "disconnect",
      label: "Disconnect import (keeps your items)",
      importId: row.id,
      title: "Stops syncing — your imported items and their history are kept.",
    });
  }
  if (row.status === "disconnected") {
    actions.push({ action: "reconnect", label: "Re-import (reconnect)", importId: row.id });
  }
  if (row.status !== "preview") {
    actions.push({
      action: "delete-records",
      label: "Delete imported records…",
      importId: row.id,
      destructive: true,
      confirm:
        "This permanently deletes the imported feed records for this import. This is separate from disconnecting — disconnect keeps them. Delete?",
    });
  }
  return (
    <li
      className="wfx-queue__item"
      data-wfx-byof-import={row.id}
      data-wfx-byof-import-status={row.status}
      data-wfx-byof-import-method={row.method}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">
          {row.connectorId === "fake-source" ? "Connected source" : row.connectorId} ·{" "}
          {row.method === "api" ? "authorized connection" : "official export"}
        </span>
        <span className="wfx-capchip" data-wfx-byof-import-status-chip>
          {IMPORT_STATUS_LABELS[row.status] ?? row.status}
        </span>
        <span
          className="wfx-capchip"
          data-wfx-byof-freshness={row.syncState}
          title="The freshness truth of this import (live/snapshot is a first-class status, never guessed)"
        >
          {FEED_FRESHNESS_LABELS[row.syncState] ?? row.syncState}
        </span>
      </span>
      <p className="wfx-card__meta" data-wfx-byof-import-summary>
        {row.recordCount} imported items · captured {stampOf(row.capturedAt)}
        {row.lastSyncedAt !== null ? ` · last synced ${stampOf(row.lastSyncedAt)}` : ""}
      </p>
      <RelationshipSummary counts={row.relationshipCounts} testId={row.id} />
      {row.lastReport !== undefined ? (
        <p className="wfx-card__meta" data-wfx-byof-sync-report>
          Last sync: {row.lastReport.added} added · {row.lastReport.updated} updated ·{" "}
          {row.lastReport.removed} removed · {row.lastReport.kept} kept
        </p>
      ) : null}
      {row.error !== null ? (
        <p className="wfx-row__reason" data-wfx-byof-import-error role="alert">
          {row.error}
        </p>
      ) : null}
      {actions.length > 0 ? (
        <ByofActions shape="import" importId={row.id} mode={mode} actions={actions} />
      ) : null}
    </li>
  );
}

/** The WebFlix discovery grid (the WebFlix picks — never imported records). */
function DiscoveryGrid({ cards }: { readonly cards: readonly CardView[] }): JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <div className="wfx-grid" data-wfx-byof-discovery>
      {cards.map((card) => (
        <ItemCard key={card.itemId} card={card} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** The Bring Your Feed surface. */
export function BringYourFeedSurface({ view }: { readonly view: ByofFeedViewModel }): JSX.Element {
  return (
    <div data-wfx-surface="byof" data-wfx-byof data-wfx-byof-mode={view.mode}>
      <h1 className="wfx-page-title" data-wfx-byof-title>
        Bring your feed
      </h1>
      <p className="wfx-page-subtitle" data-wfx-byof-subtitle>
        Import the follows, playlists, and likes you already have on a connected source. Your feed
        keeps its own order and its history — WebFlix never ranks it, and disconnecting never deletes
        it.
      </p>

      <ModeTabs mode={view.mode} />

      {/* The honest authorization-failure state (never a silent empty state). */}
      {view.lastCaptureFailure !== null ? (
        <div data-wfx-byof-auth-failure>
          <ErrorState
            title="Your feed import needs the source reconnected"
            detail={`${view.lastCaptureFailure.detail} Your imported items are kept.`}
            retry={
              <a className="wfx-btn" href="/settings?section=sources" data-wfx-byof-recovery-link>
                Reconnect the source in Settings
              </a>
            }
          />
        </div>
      ) : null}

      {/* The wizard: a staged preview (confirm) or the chooser. */}
      {view.stagedPreview !== null ? (
        <PreviewCard preview={view.stagedPreview} mode={view.bootMode} />
      ) : (
        <section className="wfx-detail__section" aria-label="Choose a source" data-wfx-byof-chooser>
          <h2>Choose a source</h2>
          {view.sources.map((source) => (
            <div
              key={source.connectorId}
              className="wfx-queue__item"
              data-wfx-byof-source={source.connectorId}
            >
              <p className="wfx-card__meta">
                <span className="wfx-badge wfx-badge--type">{source.displayName}</span>
              </p>
              {view.bootMode === "service" ? (
                <p className="wfx-row__reason" data-wfx-byof-service-not-wired>
                  Feed imports run against the configured WebFlix service — this host&apos;s feed
                  transport is not wired yet (the service-lane integration step). Nothing imports
                  here until then, and this surface will not pretend otherwise.
                </p>
              ) : (
                <ByofActions
                  shape="choose"
                  connectorId={source.connectorId}
                  methods={source.methods}
                  mode={view.bootMode}
                  actions={[{ action: "preview", label: "Connect and import", primary: true }]}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {/* The import management rows. */}
      {view.imports.length > 0 ? (
        <section
          className="wfx-detail__section"
          aria-label="Your imported feeds"
          data-wfx-byof-imports
        >
          <h2>Your imported feeds</h2>
          <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
            {view.imports.map((row) => (
              <ImportRow key={row.id} row={row} mode={view.bootMode} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* The feed view under the mode (the visible mode distinction). */}
      <section
        className="wfx-detail__section"
        aria-label={view.modeLabel}
        data-wfx-byof-feed
        data-wfx-byof-feed-mode={view.mode}
      >
        <h2>{view.modeLabel}</h2>
        <p className="wfx-detail__meta" data-wfx-byof-mode-note>
          {view.modeNote}
        </p>

        {view.mode === "webflix" ? (
          <>
            <p className="wfx-row__reason" data-wfx-byof-webflix-note>
              WebFlix never re-ranks your imported feed — imported items keep their source order
              under &ldquo;Your imports&rdquo;. The picks below are WebFlix&apos;s own discovery
              composition for your session.
            </p>
            <p className="wfx-card__meta" data-wfx-byof-webflix-source-count>
              {view.imports
                .filter((row) => row.status !== "preview")
                .reduce((total, row) => total + row.recordCount, 0)}{" "}
              imported items remain in source order under Your imports — none are re-labeled here.
            </p>
            {view.discoveryCards.length > 0 ? (
              <DiscoveryGrid cards={view.discoveryCards} />
            ) : (
              <EmptyState
                title="No WebFlix picks right now"
                detail="WebFlix's discovery composition found nothing for this session — this view never falls back to your imported feed (that would mislabel source order as WebFlix-ranked)."
              />
            )}
          </>
        ) : (
          <>
            {view.mode === "hybrid" ? (
              <p className="wfx-row__reason" data-wfx-byof-hybrid-note>
                Two labeled sections: your source&apos;s own items (source order — unranked) and
                WebFlix&apos;s discovery picks (WebFlix-ranked). The distinction is the product
                truth, not just a layout.
              </p>
            ) : null}
            {view.records.length > 0 ? (
              <>
                <p className="wfx-row__reason" data-wfx-byof-order-truth>
                  Source order — exactly as your source lists it. WebFlix does not rank this list.
                </p>
                {view.mode === "hybrid" ? (
                  <h3 data-wfx-byof-hybrid-source-heading>From your source (source order)</h3>
                ) : null}
                <ul
                  className="wfx-queue__list"
                  style={{ listStyle: "none", padding: 0 }}
                  data-wfx-byof-records
                >
                  {view.records.map((record) => (
                    <RecordRow key={record.key} record={record} />
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState
                title={view.mode === "following" ? "Nothing followed yet" : "Nothing imported yet"}
                detail={
                  view.mode === "following"
                    ? "Your followed channels and subscriptions appear here once you import a feed — in your source's own order."
                    : "Import a feed from a connected source and it appears here — in your source's own order, never re-ranked."
                }
              />
            )}
            {view.mode === "hybrid" && view.discoveryCards.length > 0 ? (
              <>
                <h3 data-wfx-byof-hybrid-discovery-heading>WebFlix picks (WebFlix-ranked)</h3>
                <DiscoveryGrid cards={view.discoveryCards} />
              </>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
