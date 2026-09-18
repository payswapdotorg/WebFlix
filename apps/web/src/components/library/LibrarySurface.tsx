/**
 * @wfx/app-web — the Library surface (R07): watchlist + history.
 *
 * The library destination over the RUNTIME's library read model: the
 * watchlist (canonical-keyed saves with their typed sync states —
 * `synced`/`pending`/`failed`/`unsupported`/`conflict`, rendered verbatim)
 * and the history section (the watch-state fold with positions and
 * completion). Every section carries its typed status: an error read
 * renders as the error state with the detail, never as a fake empty list.
 *
 * Server component.
 */

import type { JSX } from "react";

import type {
  HistoryEntryView,
  LibraryView,
  OfflineReadyEntryView,
  WatchlistEntryView,
} from "@/host/view-models";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import { formatDuration, percentWatched } from "@/components/ui/format";

/** The sync-state labels (the runtime's vocabulary, rendered verbatim). */
const SYNC_LABELS: Readonly<Record<string, string>> = {
  synced: "Synced",
  pending: "Sync pending",
  failed: "Sync failed",
  unsupported: "Not supported by the source",
  conflict: "Recorded locally (external sync unconfirmed)",
};

/** One watchlist entry row. */
function WatchlistRow({ entry }: { readonly entry: WatchlistEntryView }): JSX.Element {
  const card =
    entry.joined === null
      ? null
      : {
          itemId: entry.itemId,
          title: entry.title,
          canonicalType: entry.joined.canonicalType,
          ...(entry.joined.durationMs !== undefined ? { durationMs: entry.joined.durationMs } : {}),
          connectorId: entry.joined.connectorId,
          externalRef: entry.joined.externalRef,
        };
  return (
    <li className="wfx-queue__item" data-wfx-watchlist-entry={entry.itemId}>
      {card !== null ? (
        <ItemCard card={card} />
      ) : (
        <span className="wfx-card" data-wfx-card={entry.itemId}>
          <span>
            <p className="wfx-card__title">{entry.title}</p>
            <p className="wfx-card__meta">Source unknown in this session</p>
          </span>
        </span>
      )}
      <p className="wfx-card__meta" data-wfx-watchlist-sync={entry.sync}>
        {SYNC_LABELS[entry.sync] ?? entry.sync}
        {entry.detail !== undefined ? ` — ${entry.detail}` : ""}
      </p>
    </li>
  );
}

/** One history entry row. */
function HistoryRow({ entry }: { readonly entry: HistoryEntryView }): JSX.Element {
  const card =
    entry.joined === null
      ? null
      : {
          itemId: entry.itemId,
          title: entry.title,
          canonicalType: entry.joined.canonicalType,
          ...(entry.joined.durationMs !== undefined ? { durationMs: entry.joined.durationMs } : {}),
          connectorId: entry.joined.connectorId,
          externalRef: entry.joined.externalRef,
        };
  return (
    <li className="wfx-queue__item" data-wfx-history-entry={entry.itemId}>
      {card !== null ? (
        <ItemCard
          card={card}
          resume={{ resumePositionMs: entry.positionMs, completionRatio: entry.completionRatio }}
        />
      ) : (
        <span className="wfx-card" data-wfx-card={entry.itemId}>
          <span>
            <p className="wfx-card__title">{entry.title}</p>
            <p className="wfx-card__meta">Source unknown in this session</p>
          </span>
        </span>
      )}
      <p className="wfx-card__meta" data-wfx-history-status={entry.status}>
        {entry.status === "completed"
          ? "Watched"
          : entry.status === "skipped"
            ? `Skipped — resumable at ${formatDuration(entry.positionMs)}`
            : `In progress at ${formatDuration(entry.positionMs)}`}
        {percentWatched(entry.completionRatio) !== null ? ` · ${percentWatched(entry.completionRatio)}` : ""}
      </p>
    </li>
  );
}

/** One verified-offline library row (J26 — `Ready offline`). */
function OfflineRow({ entry }: { readonly entry: OfflineReadyEntryView }): JSX.Element {
  const card =
    entry.joined === null
      ? null
      : {
          itemId: entry.itemId,
          title: entry.title,
          canonicalType: entry.joined.canonicalType,
          ...(entry.joined.durationMs !== undefined ? { durationMs: entry.joined.durationMs } : {}),
          connectorId: entry.joined.connectorId,
          externalRef: entry.joined.externalRef,
        };
  return (
    <li className="wfx-queue__item" data-wfx-offline-entry={entry.itemId}>
      {card !== null ? (
        <ItemCard card={card} />
      ) : (
        <span className="wfx-card" data-wfx-card={entry.itemId}>
          <span>
            <p className="wfx-card__title">{entry.title}</p>
            <p className="wfx-card__meta">Offline copy — verified</p>
          </span>
        </span>
      )}
      <p className="wfx-card__meta" data-wfx-offline-status={entry.itemId}>
        {entry.label} · {formatBytes(entry.sizeBytes)}
        {entry.assetCount > 1 ? ` · ${entry.assetCount} files` : ""} · watchable without a connection
      </p>
    </li>
  );
}

/** An honest human byte size. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/** The library surface. */
export function LibrarySurface({ view }: { readonly view: LibraryView }): JSX.Element {
  return (
    <div data-wfx-surface="library" data-wfx-library>
      <h1 className="wfx-page-title" data-wfx-library-title>
        Library
      </h1>
      <p className="wfx-page-subtitle">
        Your watchlist and watch history — canonical items, keyed once across every source.
      </p>

      <section className="wfx-detail__section" aria-label="Watchlist" data-wfx-library-watchlist>
        <h2>Watchlist</h2>
        {view.watchlist.status.state === "error" ? (
          <ErrorState
            title="Watchlist could not load"
            detail={view.watchlist.status.errorDetail ?? "the read failed"}
            retry={
              <a className="wfx-btn" href="/library">
                Retry
              </a>
            }
          />
        ) : view.watchlist.entries.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            detail="Save content from its details page — saves are keyed to the canonical item, so the same title from another source joins here."
            action={
              <a className="wfx-btn" href="/">
                Browse content
              </a>
            }
          />
        ) : (
          <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
            {view.watchlist.entries.map((entry) => (
              <WatchlistRow key={entry.itemId} entry={entry} />
            ))}
          </ul>
        )}
      </section>

      <section className="wfx-detail__section" aria-label="History" data-wfx-library-history>
        <h2>History</h2>
        {view.history.status.state === "error" ? (
          <ErrorState
            title="History could not load"
            detail={view.history.status.errorDetail ?? "the read failed"}
            retry={
              <a className="wfx-btn" href="/library?section=history">
                Retry
              </a>
            }
          />
        ) : view.history.entries.length === 0 ? (
          <EmptyState
            title="No watch history yet"
            detail="Watch something — your session's watch state folds here with positions and completion."
          />
        ) : (
          <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
            {view.history.entries.map((entry) => (
              <HistoryRow key={entry.itemId} entry={entry} />
            ))}
          </ul>
        )}
      </section>
      <section className="wfx-detail__section" aria-label="Offline and verified" data-wfx-library-offline>
        <h2>Offline and verified</h2>
        {view.offline.entries.length === 0 ? (
          <EmptyState
            title="No offline copies yet"
            detail="Titles made available offline are verified before they land here — you can watch them without a connection."
          />
        ) : (
          <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
            {view.offline.entries.map((entry) => (
              <OfflineRow key={entry.itemId} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
