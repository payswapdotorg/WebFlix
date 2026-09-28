/**
 * @wfx/app-web — R37 — THE /live BROWSE SURFACE (the live rail).
 *
 * The live browse page: the LIVE NOW row (the red-dot badges + the
 * source-reported viewer counts — honest backing or the typed absence),
 * the ARCHIVED LIVE BROADCASTS row (the "was live" grammar + the replay
 * truth), and the honest typed states (the service-mode absence, the
 * loud fixtures disclosure, the empty rail's honest sentence).
 *
 * Server component — pure presentational projection of a `LiveBrowseView`
 * (the view model derived through the connector-layer designation; this
 * surface never re-derives product truth).
 */

import type { JSX } from "react";

import type { LiveBrowseView, LiveCardView } from "@/components/live/live-views";
import { EmptyState } from "@/components/ui/StateViews";
import { formatPosition, placeholderMonogram } from "@/components/ui/format";
import { LiveBadge, LiveViewerCount, WasLiveBadge } from "@/components/live/LiveBadge";
import "./live.css";

/** One live rail card (the live lockup: badge + viewers + title + channel). */
function LiveCard({
  card,
  channelName,
}: {
  readonly card: LiveCardView;
  readonly channelName: string;
}): JSX.Element {
  const live = card.designation.kind === "live";
  return (
    <a className="wfx-livecard" href={card.watchHref} data-wfx-live-card={card.externalRef}>
      <span className="wfx-livecard__art" aria-hidden="true">
        <span className="wfx-livecard__monogram">{placeholderMonogram(card.title)}</span>
        <span className="wfx-livecard__badges">
          {live ? <LiveBadge /> : <WasLiveBadge />}
        </span>
        {live ? (
          <LiveViewerCount count={card.viewerCount} variant="badge" />
        ) : card.durationMs !== undefined ? (
          <span className="wfx-liveviewers wfx-livecard__duration" data-wfx-archive-duration>
            {formatPosition(card.durationMs)}
          </span>
        ) : null}
      </span>
      <p className="wfx-livecard__title" data-wfx-live-card-title>
        {card.title}
      </p>
      <p className="wfx-livecard__channel" data-wfx-live-card-channel>
        {channelName}
      </p>
    </a>
  );
}

/** The /live browse surface. */
export function LiveBrowseSurface({ view }: { readonly view: LiveBrowseView }): JSX.Element {
  // The channel slots resolve through the sources model's own display
  // names (the R33-C seam — the connector id stays the honest fallback).
  const channelNameOf = (connectorId: string): string =>
    view.sourceNames[connectorId] ?? connectorId;
  return (
    <div data-wfx-surface="live" data-wfx-live>
      <h1 className="wfx-page-title" data-wfx-live-title>
        Live
      </h1>
      <p className="wfx-page-subtitle">
        Live broadcasts from your sources — the chat joins when you open a stream.
      </p>

      {/* The loud fixtures disclosure (the dev-double badge — fixtures mode only). */}
      {view.fixturesBadge !== null ? (
        <p className="wfx-livechat__double" data-wfx-live-disclosure>
          This boot serves {view.fixturesBadge}.
        </p>
      ) : null}

      {/* THE LIVE NOW RAIL. */}
      <section className="wfx-row" data-wfx-live-rail>
        <div className="wfx-row__header">
          <h2 className="wfx-row__title">Live now</h2>
        </div>
        {view.liveCards.length > 0 ? (
          <div className="wfx-live-cards">
            {view.liveCards.map((card) => (
              <LiveCard key={card.externalRef} card={card} channelName={channelNameOf(card.connectorId)} />
            ))}
          </div>
        ) : view.serviceState !== null ? (
          <EmptyState
            title="No live broadcasts right now"
            detail={view.serviceState.note}
            action={
              <a className="wfx-btn" href="/">
                Go home
              </a>
            }
          />
        ) : (
          <EmptyState
            title="No live broadcasts right now"
            detail="No source is reporting a live broadcast at this moment — WebFlix never fabricates a live rail."
            action={
              <a className="wfx-btn" href="/">
                Go home
              </a>
            }
          />
        )}
      </section>

      {/* THE ARCHIVED LIVE BROADCASTS RAIL (the chat-replay row). */}
      {view.archivedCards.length > 0 ? (
        <section className="wfx-row" data-wfx-archive-rail>
          <div className="wfx-row__header">
            <h2 className="wfx-row__title">Archived live broadcasts</h2>
          </div>
          <p className="wfx-row__reason" data-wfx-archive-note>
            Ended streams kept as videos — their live chat replays with the playback position.
          </p>
          <div className="wfx-live-cards">
            {view.archivedCards.map((card) => (
              <LiveCard key={card.externalRef} card={card} channelName={channelNameOf(card.connectorId)} />
            ))}
          </div>
        </section>
      ) : null}

      {/* The search-derived live truth's honest disclosure (the general
          path's own answer — zero today, disclosed, never hidden). */}
      <p className="wfx-row__reason" data-wfx-live-search-truth>
        Live items declared by your connected sources through the catalog search:{" "}
        {view.searchDerivedLiveCount}.
      </p>

      {/* The chat bridge's pre-declared truth (the watch page's chat seam). */}
      <p className="wfx-row__reason" data-wfx-live-bridge-truth>
        {view.chatBridge.running
          ? `The live chat transport is serving on port ${view.chatBridge.port}.`
          : "The live chat transport is not serving on this boot — live streams open with the honest chat-unavailable state."}
      </p>
    </div>
  );
}
