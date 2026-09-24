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
import { ArtworkImage } from "@/components/cards/ArtworkImage";
import { AddToQueueControl } from "@/components/cards/CardActions";
import { itemDetailHref, playerHref } from "@/app/routing";
import { AcquisitionPanel } from "@/components/acquisition/AcquisitionPanel";
import { ActionButtons } from "@/components/player/ActionButtons";
import { ShareControl } from "@/components/player/ShareControl";
import { WatchlistSave } from "@/components/player/WatchlistSave";
import { WhereToWatch } from "@/components/item/WhereToWatch";
import { AiActionTray } from "@/components/discovery/AiActionTray";
import { IntelligenceSurface } from "@/components/item/IntelligenceSurface";
import { FeedbackControls } from "@/components/discovery/FeedbackControls";
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
  // R23-E — the primary play decision: the authorized peer copy is a
  // FIRST-CLASS way to watch. The provider rungs keep the frozen Media
  // Surface precedence for the primary Play target; when no provider rung
  // is usable here, a playable peer copy IS the primary play decision
  // (never "no playback capability", never hidden under Settings).
  const providerPlayable = view.capabilities.some((capability) => capability.startsWith("play"));
  const peerCopyPlayable = view.whereToWatch.peerCopy?.usable === true;
  const playable = providerPlayable || peerCopyPlayable;
  const primaryPlayHref = providerPlayable
    ? playerHref(
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
      )
    : (view.whereToWatch.peerCopy?.switchHref ?? null);
  const resumeLabel =
    view.watch === null
      ? null
      : view.watch.status === "completed"
        ? "Watch again"
        : view.watch.positionMs > 0
          ? `Resume from ${formatDuration(view.watch.positionMs)}`
          : null;
  // R24-W2 — the item hub's canonical href (the share copy's target) +
  // the add-to-queue target (the same decision-row vocabulary).
  const itemHref = itemDetailHref({
    itemId: view.itemId,
    connectorId: view.connectorId,
    externalRef: view.externalRef,
    title: view.title,
    canonicalType: view.canonicalType,
    ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
  });
  return (
    <div className="wfx-detail" data-wfx-surface="item" data-wfx-item={view.itemId}>
      <div className="wfx-detail__stage" style={{ background: placeholderArt(view.itemId) }}>
        {/* R26-W2 — the item's REAL SOURCE ARTWORK (the source-authorized
            thumbnail from the live metadata read); the deterministic
            placeholder stays beneath as the typed fallback (the honest
            reason renders when the source carries no artwork — never a
            generated replacement). */}
        {view.artwork.view !== null ? (
          <>
            <ArtworkImage
              artwork={view.artwork.view}
              className="wfx-card__img wfx-detail__img"
              alt={view.artwork.view.altText}
              eager
            />
            <span className="wfx-detail__scrim" aria-hidden="true" />
          </>
        ) : (
          <span className="wfx-card__art" aria-hidden="true">
            <span>{placeholderMonogram(view.title)}</span>
          </span>
        )}
        {view.artwork.fallbackReason !== null ? (
          <p className="wfx-detail__artwork-truth" data-wfx-artwork-fallback-reason>
            {view.artwork.fallbackReason}
          </p>
        ) : null}
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
          {/* R24-W2 — the SOURCE ROW (the channel-profile-pages row: the
              canonical source identity on the item hub — the same chip
              grammar the cards carry). */}
          <span className="wfx-capchip" data-wfx-item-source>
            From {view.connectorId}
          </span>
          {view.watch !== null && percentWatched(view.watch.completionRatio) !== null ? (
            <span>{percentWatched(view.watch.completionRatio)}</span>
          ) : null}
        </p>
      </div>
      <div className="wfx-actionbar">
        {playable && primaryPlayHref !== null ? (
          <a
            className="wfx-btn wfx-btn--primary"
            href={primaryPlayHref}
            data-wfx-item-play
            {...(!providerPlayable && peerCopyPlayable ? { "data-wfx-item-play-realization": "authorized-peer-copy" } : {})}
          >
            <Icon name="play" size={18} />
            {resumeLabel ?? "Play"}
          </a>
        ) : playable && primaryPlayHref === null ? (
          // A playable view without a concrete href (the peer copy is not
          // playable HERE): the where-to-watch row carries the honest
          // next step — never a dead button.
          <span className="wfx-actionbar__status" data-wfx-item-unplayable>
            The ways to watch this title are listed below — the ones this platform cannot host
            carry their honest next step.
          </span>
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
        {/* R24-W2 — the WebFlix-native watchlist save + the share control
            + the add-to-queue entry (the R24-C placement law: the same
            decision-row vocabulary the player carries — save / share /
            queue at the point of the content decision). */}
        <WatchlistSave
          itemId={view.itemId}
          title={view.title}
          connectorId={view.connectorId}
          externalRef={view.externalRef}
          initiallySaved={view.watchlistSaved}
          offerPlaylist
        />
        <ShareControl
          canonicalHref={itemHref}
          title={view.title}
          sourceId={view.connectorId}
          connectorId={view.connectorId}
          externalRef={view.externalRef}
        />
        <AddToQueueControl
          target={{
            itemId: view.itemId,
            connectorId: view.connectorId,
            externalRef: view.externalRef,
            title: view.title,
            canonicalType: view.canonicalType,
            ...(view.durationMs !== undefined ? { durationMs: view.durationMs } : {}),
            href: itemHref,
          }}
        />
      </div>
      {/* R21-E — the DECISION HUB order (the frozen law): one canonical
          identity first, realizations second, the AI tray and feedback
          controls in context, raw connector diagnostics secondary. */}
      <WhereToWatch view={view.whereToWatch} />
      <AiActionTray view={view.aiTray} surface="item" />
      {/* R23 (J39) — the item's derived intelligence: transcript, chapters,
          findable moments with jump paths, per-feature availability, and
          honest model provenance (progressively disclosed). */}
      <IntelligenceSurface
        view={view.intelligence}
        target={{
          itemId: view.itemId,
          connectorId: view.connectorId,
          externalRef: view.externalRef,
          title: view.title,
          canonicalType: view.canonicalType,
        }}
      />
      <FeedbackControls target={view.itemId} sourceId={view.connectorId} surface="item" />
      <section className="wfx-detail__section" aria-label="Source capabilities">
        <details className="wfx-disc__capabilities" data-wfx-item-capabilities-disclosure>
          <summary className="wfx-disc__capabilities-toggle" data-wfx-item-capabilities-toggle>
            What this source can do
          </summary>
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
        </details>
      </section>
      <AcquisitionPanel
        view={view.acquisition.view}
        diagnostics={view.acquisition.diagnostics}
        mode={view.mode}
        canAcquireOnThisDevice={false}
        sourceRef={view.externalRef}
      />
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
