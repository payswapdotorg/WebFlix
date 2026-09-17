/**
 * @wfx/app-web — the content detail surface (R07).
 *
 * Real source metadata (the adapter's transport read), the source's
 * declared capability list (the truth, rendered verbatim), the actions
 * (like/save through the RUNTIME's action states — receipts are the
 * truth), the resume affordance (the runtime's folded watch state), and
 * the related browse cards. Server component; the actions are the client
 * `ActionButtons` island.
 */

import type { JSX } from "react";

import type { DetailView } from "@/host/view-models";
import { ItemCard } from "@/components/cards/ItemCard";
import { playerHref } from "@/app/routing";
import { ActionButtons } from "@/components/player/ActionButtons";
import { Icon } from "@/components/shell/Icon";
import { formatDuration, percentWatched, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** The playback capability labels (the same truth grammar as before). */
const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  catalogSearch: "Search",
  metadata: "Metadata",
  playNative: "Native playback",
  playEmbed: "Embedded playback",
  playBrowser: "Web player",
  playExternal: "External handoff",
  libraryRead: "Reads your library",
  libraryWrite: "Writes your library",
  like: "Likes",
  save: "Saves",
  follow: "Follows",
  comment: "Comments",
  download: "Downloads",
  transform: "Transforms",
};

/** The detail surface. */
export function ItemDetailSurface({ view }: { readonly view: DetailView }): JSX.Element {
  const playable = view.capabilities.some((capability) => capability.startsWith("play"));
  const resumeLabel =
    view.watch === null
      ? null
      : view.watch.status === "completed"
        ? "Watch again"
        : view.watch.positionMs > 0
          ? `Resume from ${formatDuration(view.watch.positionMs)}`
          : null;
  return (
    <div className="wfx-detail" data-wfx-surface="item" data-wfx-item={view.itemId}>
      <div className="wfx-detail__stage" style={{ background: placeholderArt(view.itemId) }}>
        <span className="wfx-card__art" aria-hidden="true">
          <span>{placeholderMonogram(view.title)}</span>
        </span>
      </div>
      <div>
        <h1 className="wfx-detail__title" data-wfx-item-title>
          {view.title}
        </h1>
        <p className="wfx-detail__meta">
          <span className="wfx-badge wfx-badge--type">{view.canonicalType}</span>
          {view.durationMs !== undefined ? <span>{formatDuration(view.durationMs)}</span> : null}
          <span data-wfx-item-availability>
            {view.availability === "available"
              ? "Available"
              : view.availability === "unavailable"
                ? "Currently unavailable"
                : "Availability unknown"}
          </span>
          {view.watch !== null && percentWatched(view.watch.completionRatio) !== null ? (
            <span>{percentWatched(view.watch.completionRatio)}</span>
          ) : null}
        </p>
      </div>
      <div className="wfx-actionbar">
        {playable ? (
          <a
            className="wfx-btn wfx-btn--primary"
            href={playerHref(
              {
                itemId: view.itemId,
                connectorId: view.connectorId,
                externalRef: view.externalRef,
                title: view.title,
                canonicalType: view.canonicalType,
                ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
              },
              view.watch !== null && view.watch.status !== "completed" && view.watch.positionMs > 0
                ? view.watch.positionMs
                : undefined,
            )}
            data-wfx-item-play
          >
            <Icon name="play" size={18} />
            {resumeLabel ?? "Play"}
          </a>
        ) : (
          <span className="wfx-actionbar__status" data-wfx-item-unplayable>
            This source declares no playback capability for this content.
          </span>
        )}
        <ActionButtons
          like={
            view.capabilities.includes("like")
              ? {
                  type: "like",
                  connectorId: view.connectorId,
                  externalRef: view.externalRef,
                  itemId: view.itemId,
                }
              : null
          }
          save={
            view.capabilities.includes("save")
              ? {
                  type: "save",
                  connectorId: view.connectorId,
                  externalRef: view.externalRef,
                  itemId: view.itemId,
                }
              : null
          }
        />
      </div>
      <section className="wfx-detail__section" aria-label="Source capabilities">
        <h2>What this source can do</h2>
        <ul className="wfx-caplist" data-wfx-item-capabilities>
          {view.capabilities.map((capability) => (
            <li key={capability} className="wfx-badge">
              {CAPABILITY_LABELS[capability] ?? capability}
            </li>
          ))}
        </ul>
        {view.capabilities.length === 0 ? (
          <p className="wfx-row__reason" data-wfx-item-nocapabilities>
            This source declared no capabilities for this content — every action reflects that
            truth.
          </p>
        ) : null}
      </section>
      {view.related.length > 0 ? (
        <section className="wfx-detail__section" aria-label="Related content">
          <h2>More to explore</h2>
          <div className="wfx-grid">
            {view.related.map((card) => (
              <ItemCard key={card.itemId} card={card} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
