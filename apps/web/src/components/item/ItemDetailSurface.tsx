/**
 * @wfx/app-web — the content detail surface (WFX-051).
 *
 * Metadata (through the connector port — the single-item read of the
 * transport contract), the capability list (the source's declared truth),
 * the available actions (like/save with capability-honest presence), the
 * resume affordance (recorded watch state), and the related browse cards.
 * Server component; the actions are the client `ActionButtons`.
 */

import type { JSX } from "react";

import type { DetailView } from "@/host/views";
import { ItemCard, playerHref } from "@/components/cards/ItemCard";
import { ActionButtons } from "@/components/player/ActionButtons";
import { Icon } from "@/components/shell/Icon";
import { formatDuration, percentWatched, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** The playback capability labels (the same truth grammar as the cards). */
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
  const resumeLabel =
    view.resume === null
      ? null
      : view.resume.affordance === "resume"
        ? `Resume from ${formatDuration(view.resume.resumePositionMs)}`
        : view.resume.affordance === "restart"
          ? "Start over"
          : "Watch again";
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
          {view.resume !== null && percentWatched(view.resume.completionRatio) !== null ? (
            <span>{percentWatched(view.resume.completionRatio)}</span>
          ) : null}
        </p>
      </div>
      <div className="wfx-actionbar">
        {view.playable ? (
          <a
            className="wfx-btn wfx-btn--primary"
            href={playerHref(
              {
                connectorId: view.connectorId,
                externalRef: view.externalRef,
                title: view.title,
                canonicalType: view.canonicalType,
                ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
              },
              view.resume !== null && view.resume.affordance === "resume"
                ? view.resume.resumePositionMs
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
            view.canLike
              ? {
                  type: "like",
                  connectorId: view.connectorId,
                  externalRef: view.externalRef,
                  itemId: view.itemId,
                }
              : null
          }
          save={
            view.canSave
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
