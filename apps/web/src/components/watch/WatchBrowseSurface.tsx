/**
 * @wfx/app-web — the long-form Watch Feed browse surface (WFX-051).
 *
 * The WFX-027 experience mode as a browse page: the continue-watching row
 * first (resume beats everything — the watch-feed row law), then the
 * browse rows. Rows state their honest reasons; cards link to the detail
 * page. Episodic and topic rows appear when the sources carry the data
 * for them (honest absence otherwise — the fixture catalog has no series
 * relations or topic features, so none are fabricated).
 */

import type { JSX } from "react";

import type { WatchBrowseView } from "@/host/views";
import { Row } from "@/components/home/HomeSurface";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState } from "@/components/ui/StateViews";

/** The watch browse surface. */
export function WatchBrowseSurface({ view }: { readonly view: WatchBrowseView }): JSX.Element {
  const hasContent = view.continueEntries.length > 0 || view.rows.some((row) => row.cards.length > 0);
  return (
    <div data-wfx-surface="watch" data-wfx-watch>
      <h1 className="wfx-page-title">Watch</h1>
      <p className="wfx-page-subtitle">
        The long-form feed: episodic continuity, resume, and browse — composed for this session.
      </p>
      {view.continueEntries.length > 0 ? (
        <section className="wfx-row" data-wfx-row="continue">
          <div className="wfx-row__header">
            <h2 className="wfx-row__title">Continue watching</h2>
            <p className="wfx-row__reason">Pick up where you left off — from your watch state.</p>
          </div>
          <div className="wfx-row__scroller">
            {view.continueEntries.map((entry) => (
              <ItemCard
                key={entry.card.itemId}
                card={entry.card}
                resume={{
                  resumePositionMs: entry.resumePositionMs,
                  completionRatio: entry.completionRatio,
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {view.rows.map((row) => (
        <Row key={row.id} title={row.title} reason={row.reason} cards={row.cards} />
      ))}
      {hasContent ? null : (
        <EmptyState
          title="Nothing to browse"
          detail="The configured source answered with no watch-form cards. WebFlix never fabricates content."
        />
      )}
    </div>
  );
}
