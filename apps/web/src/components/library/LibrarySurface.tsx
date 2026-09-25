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
import type { WebSessionState } from "@/host/session";
import type { ByofFeedView } from "@/host/byof/byof-view";
import { ByofFeedRegion } from "@/components/byof/ByofFeedRegion";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import { formatDuration, formatPlaylistDate, percentWatched } from "@/components/ui/format";
// R30-B (CORPUS §8/§9) — the playlist controls island (Play all +
// Shuffle + the sort chips — the real queue seam + the CSS filter seam).
import { PlaylistControls, type PlaylistChip, type PlaylistTarget } from "@/components/library/PlaylistControls";

/** The sync-state labels (the runtime's vocabulary, rendered verbatim). */
const SYNC_LABELS: Readonly<Record<string, string>> = {
  synced: "Synced",
  pending: "Sync pending",
  failed: "Sync failed",
  unsupported: "Not supported by the source",
  conflict: "Recorded locally (external sync unconfirmed)",
};

/** One watchlist entry row. */
function WatchlistRow({
  entry,
  rowType,
}: {
  readonly entry: WatchlistEntryView;
  /** R30-B — the playlist rows' canonical-type datum (the sort chips' CSS filter target). */
  readonly rowType?: string | undefined;
}): JSX.Element {
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
    <li
      className="wfx-queue__item"
      data-wfx-watchlist-entry={entry.itemId}
      {...(rowType !== undefined ? { "data-wfx-playlist-type": rowType } : {})}
    >
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

/**
 * R30-B (CORPUS §8) — the playlist header's video-count line: "N videos"
 * (the corpus card/header grammar — the singular "1 video" handled).
 */
function playlistCountLine(count: number): string {
  return count === 1 ? "1 video" : `${count} videos`;
}

/**
 * R30-B (CORPUS §9) — the playlist's sort chips: All + the REAL canonical
 * types the list's joinable entries carry (the ChipBar law: a chip never
 * names a category the list cannot fill; the corpus row: Videos · Shorts).
 */
function playlistChipsOf(types: ReadonlySet<string>): PlaylistChip[] {
  const chips: PlaylistChip[] = [];
  if (types.has("video")) chips.push({ label: "Videos", value: "video" });
  if (types.has("short")) chips.push({ label: "Shorts", value: "short" });
  return chips;
}

/**
 * R30-B (CORPUS §8) — the corpus's owner line: the session's own honest
 * identity (the account name when signed in; the honest anonymous phrase
 * when not — never a fabricated "Spartacus").
 */
function playlistOwnerLine(session: WebSessionState): string {
  return session.signedIn ? session.label : "an anonymous session";
}

/** The library surface. */
export function LibrarySurface({
  view,
  byof,
  justImported,
  session,
}: {
  /** The runtime's library read model (watchlist + history + offline). */
  readonly view: LibraryView;
  /** The BYOF feed view (R20-D — the imported feeds region's data). */
  readonly byof?: ByofFeedView;
  /** Whether this render is the post-confirm landing (`?byof=imported`). */
  readonly justImported?: boolean;
  /** R30-B — the page's session truth (the playlists' owner line — CORPUS §8). */
  readonly session?: WebSessionState;
}): JSX.Element {
  return (
    <div data-wfx-surface="library" data-wfx-library>
      <h1 className="wfx-page-title" data-wfx-library-title>
        Library
      </h1>
      <p className="wfx-page-subtitle">
        Your watchlist and watch history — canonical items, keyed once across every source.
      </p>

      {byof !== undefined ? <ByofFeedRegion view={byof} {...(justImported ? { justImported } : {})} /> : null}

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

      {/* R24-W2 — THE PLAYLISTS SECTION (the R24-C playlists row: the
          named lists from the watchlist's listName seam — the same
          canonical-keyed writes, grouped; the save-queue action and the
          item hub's save-to-playlist land here).
          R30-B (CORPUS §8/§9) — THE PLAYLIST FAMILY GRAMMAR joins each
          named list: the header (title · owner · "N videos" · "Last
          updated on <date>" · the Play all + Shuffle pills), the
          honest-unavailable notice ("N unavailable videos are hidden"
          — the entries whose source identity this process never joined
          hide behind the counted notice, the corpus's own pattern),
          and the sort chips (All · the real types the list carries —
          the CSS filter seam). The rows keep the watchlist row grammar
          (the seam law: no Library row redesign), each carrying its
          canonical-type datum for the chips' filter. */}
      <section className="wfx-detail__section" aria-label="Playlists" data-wfx-library-playlists>
        <h2>Playlists</h2>
        {view.playlists.lists.length === 0 ? (
          <EmptyState
            title="No playlists yet"
            detail="Save a playlist from any title's save control, or save your session queue from the player — the lists land here."
          />
        ) : (
          view.playlists.lists.map((list) => {
            // The honest split: the joinable entries (rows + the queue
            // targets) vs the unavailable ones (hidden behind the notice).
            const joinable = list.entries.filter((entry) => entry.joined !== null);
            const unavailable = list.entries.length - joinable.length;
            // The header's data: the count (the joinable truth — the
            // hidden ones are named by the notice, not the count line),
            // the latest save timestamp, the real type set.
            const lastUpdated = list.entries.reduce<string | null>(
              (latest, entry) =>
                entry.savedAt > (latest ?? "") ? entry.savedAt : latest,
              null,
            );
            const types = new Set(joinable.map((entry) => entry.joined!.canonicalType));
            const targets: PlaylistTarget[] = joinable.map((entry) => ({
              itemId: entry.itemId,
              connectorId: entry.joined!.connectorId,
              externalRef: entry.joined!.externalRef,
              title: entry.title,
              canonicalType: entry.joined!.canonicalType,
              ...(entry.joined!.durationMs !== undefined
                ? { durationMs: entry.joined!.durationMs }
                : {}),
            }));
            const updatedLine =
              lastUpdated !== null ? formatPlaylistDate(lastUpdated) : null;
            return (
              <div
                key={list.name}
                className="wfx-playlist"
                data-wfx-library-playlist={list.name}
                data-wfx-playlist
              >
                <div className="wfx-playlist__head" data-wfx-playlist-head={list.name}>
                  <h3 data-wfx-playlist-name>{list.name}</h3>
                  {/* §8 — the header grammar: owner · count · updated
                      (WebFlix's owner = its own session truth — the
                      corpus's account-name slot, honestly; "No views"
                      has no WebFlix datum and stays absent — the
                      divergence ledger records it). */}
                  <p className="wfx-playlist__meta" data-wfx-playlist-meta>
                    {session !== undefined ? playlistOwnerLine(session) : "an anonymous session"}
                    {" · "}
                    {playlistCountLine(joinable.length)}
                    {updatedLine !== null ? ` · Last updated on ${updatedLine}` : ""}
                  </p>
                  <PlaylistControls
                    listName={list.name}
                    targets={targets}
                    chips={playlistChipsOf(types)}
                  />
                </div>
                {/* §9 — THE HONEST-UNAVAILABLE NOTICE: the corpus's own
                    pattern ("6 unavailable videos are hidden") — the
                    entries with no joined source identity this session
                    hide behind the counted notice, never rendered as
                    fabricated links. */}
                {unavailable > 0 ? (
                  <p className="wfx-playlist__unavailable" data-wfx-playlist-unavailable={unavailable}>
                    {unavailable === 1
                      ? "1 unavailable video is hidden"
                      : `${unavailable} unavailable videos are hidden`}
                  </p>
                ) : null}
                <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
                  {joinable.map((entry) => (
                    <WatchlistRow
                      key={`${list.name}-${entry.itemId}`}
                      entry={entry}
                      rowType={entry.joined === null ? undefined : entry.joined.canonicalType}
                    />
                  ))}
                </ul>
              </div>
            );
          })
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
