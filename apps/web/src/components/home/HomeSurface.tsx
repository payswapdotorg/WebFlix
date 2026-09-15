/**
 * @wfx/app-web — the home surface (WFX-051).
 *
 * The polished real face of the web host: a hero (resume-or-start), the
 * continue-watching row (recorded watch state — honest absence when the
 * session has none), the "For you" and "Trending" browse rows, and the
 * shorts rail that enters the vertical feed. Every card states the
 * canonical type, duration, and source-capability truth; every row states
 * its honest reason. Pure presentational SERVER component over the
 * `HomeView` the host pipeline produced (the composition test renders the
 * same component the route serves).
 */

import type { JSX } from "react";

import type { CardView, ContinueEntryView, HomeView } from "@/host/views";
import { ItemCard, detailHref, playerHref } from "@/components/cards/ItemCard";
import { Icon } from "@/components/shell/Icon";
import { EmptyState } from "@/components/ui/StateViews";
import { formatDuration, percentWatched, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** One horizontal, scrollable content row. */
export function Row({
  title,
  reason,
  cards,
  variant = "wide",
}: {
  readonly title: string;
  readonly reason: string;
  readonly cards: readonly CardView[];
  readonly variant?: "wide" | "short";
}): JSX.Element | null {
  if (cards.length === 0) return null; // honest absence — no empty scaffolding
  return (
    <section className="wfx-row" data-wfx-row={title.toLowerCase().replace(/\s+/g, "-")}>
      <div className="wfx-row__header">
        <h2 className="wfx-row__title">{title}</h2>
        <p className="wfx-row__reason">{reason}</p>
      </div>
      <div className={`wfx-row__scroller${variant === "short" ? " wfx-row__scroller--shorts" : ""}`}>
        {cards.map((card) => (
          <ItemCard key={card.itemId} card={card} variant={variant} />
        ))}
      </div>
    </section>
  );
}

/** The continue-watching row (resume positions + progress bars). */
function ContinueRow({ entries }: { readonly entries: readonly ContinueEntryView[] }): JSX.Element | null {
  if (entries.length === 0) return null; // honest absence on a fresh session
  return (
    <section className="wfx-row" data-wfx-row="continue">
      <div className="wfx-row__header">
        <h2 className="wfx-row__title">Continue watching</h2>
        <p className="wfx-row__reason">Pick up where you left off — from your watch state.</p>
      </div>
      <div className="wfx-row__scroller">
        {entries.map((entry) => (
          <ItemCard
            key={entry.card.itemId}
            card={entry.card}
            resume={{ resumePositionMs: entry.resumePositionMs, completionRatio: entry.completionRatio }}
          />
        ))}
      </div>
    </section>
  );
}

/** The hero: the one resume-or-start primary item. */
function Hero({ hero }: { readonly hero: HomeView["hero"] }): JSX.Element | null {
  if (hero === null) return null;
  const { card, kind, resumePositionMs, completionRatio } = hero;
  const pct = percentWatched(completionRatio);
  return (
    <section
      className="wfx-hero"
      style={{ background: placeholderArt(card.itemId) }}
      data-wfx-hero={kind}
      aria-label={`${kind === "resume" ? "Continue watching" : "Featured"}: ${card.title}`}
    >
      <span className="wfx-card__art" aria-hidden="true">
        <span>{placeholderMonogram(card.title)}</span>
      </span>
      <h1 className="wfx-hero__title" data-wfx-hero-title>
        {card.title}
      </h1>
      <p className="wfx-hero__meta">
        <span className="wfx-badge wfx-badge--type">{card.canonicalType}</span>
        {card.durationMs !== undefined ? <span>{formatDuration(card.durationMs)}</span> : null}
        {kind === "resume" && resumePositionMs > 0 ? (
          <span data-wfx-hero-resume>Resume at {formatDuration(resumePositionMs)}</span>
        ) : null}
        {pct !== null ? <span>{pct}</span> : null}
      </p>
      <div className="wfx-hero__actions">
        <a
          className="wfx-btn wfx-btn--primary"
          href={playerHref(card, kind === "resume" ? resumePositionMs : undefined)}
          data-wfx-hero-play
        >
          <Icon name="play" size={18} />
          {kind === "resume" ? "Resume" : "Play"}
        </a>
        <a className="wfx-btn" href={detailHref(card)}>
          Details
        </a>
      </div>
    </section>
  );
}

/** The home surface. */
export function HomeSurface({ view }: { readonly view: HomeView }): JSX.Element {
  const hasAnyContent =
    view.hero !== null ||
    view.continueEntries.length > 0 ||
    view.forYou.length > 0 ||
    view.trending.length > 0 ||
    view.shorts.length > 0;
  return (
    <div data-wfx-surface="home" data-wfx-home>
      <Hero hero={view.hero} />
      <ContinueRow entries={view.continueEntries} />
      {hasAnyContent ? (
        <>
          <Row
            title="For you"
            reason="Browse composed for your session (seeded until personal ranking ships)."
            cards={view.forYou}
          />
          <Row
            title="Trending on your sources"
            reason="What your connected sources surface broadly right now."
            cards={view.trending}
          />
          {view.shorts.length > 0 ? (
            <section className="wfx-row" data-wfx-row="shorts">
              <div className="wfx-row__header">
                <h2 className="wfx-row__title">Shorts</h2>
                <p className="wfx-row__reason">
                  Vertical, swipe-driven — <a href="/shorts">open the short feed</a>.
                </p>
              </div>
              <div className="wfx-row__scroller wfx-row__scroller--shorts">
                {view.shorts.map((card) => (
                  <ItemCard key={card.itemId} card={card} variant="short" />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No content yet"
          detail="The configured source answered with no cards for this feed. Connect a source or check the service — WebFlix never fabricates content."
          action={
            <a className="wfx-btn" href="/search">
              Try search
            </a>
          }
        />
      )}
    </div>
  );
}
