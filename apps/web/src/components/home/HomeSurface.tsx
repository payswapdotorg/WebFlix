/**
 * @wfx/app-web — the home surface (R07).
 *
 * The home face over the RUNTIME's state: Continue Watching (the runtime's
 * session watch-state fold — honest absence on a fresh session) and the
 * seeded browse rows, each carrying its TYPED section status verbatim: an
 * ERROR section renders as the error state with the failure detail, never
 * as a fake empty row (the honesty law). The hero is the newest resumable
 * continue entry, else the first browse card.
 *
 * Server component: pure presentational projection of the `HomeView` the
 * view pipeline produced (the composition tests render the same tree).
 */

import type { JSX } from "react";

import type {
  CardView,
  ContinueCardView,
  HomeView,
  RowView,
  SectionStatusView,
} from "@/host/view-models";
import { ItemCard, cardPlayerHref } from "@/components/cards/ItemCard";
import { itemDetailHref } from "@/app/routing";
import { Icon } from "@/components/shell/Icon";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import { formatDuration, percentWatched, placeholderArt, placeholderMonogram } from "@/components/ui/format";

/** One typed section-status renderer (error sections are errors, verbatim). */
export function SectionStatus({ status, title }: { readonly status: SectionStatusView; readonly title: string }): JSX.Element | null {
  if (status.state !== "error") return null;
  return (
    <div data-wfx-section-error={title.toLowerCase().replace(/\s+/g, "-")}>
      <ErrorState
        title={`${title} could not load`}
        detail={`${status.error?.kind ?? "unavailable"}: ${status.error?.detail ?? "the read failed"}`}
        retry={
          <a className="wfx-btn" href="/">
            Retry
          </a>
        }
      />
    </div>
  );
}

/** One horizontal, scrollable content row (typed status + cards). */
export function Row({ row }: { readonly row: RowView }): JSX.Element | null {
  const hasContent = row.cards.length > 0;
  if (!hasContent && row.status.state === "ready") return null; // honest absence — no empty scaffolding
  return (
    <section className="wfx-row" data-wfx-row={row.id}>
      <div className="wfx-row__header">
        <h2 className="wfx-row__title">{row.title}</h2>
        <p className="wfx-row__reason">{row.reason}</p>
      </div>
      <SectionStatus status={row.status} title={row.title} />
      {hasContent ? (
        <div className="wfx-row__scroller">
          {row.cards.map((card) => (
            <ItemCard key={card.itemId} card={card} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** The continue-watching row (resume positions + progress bars). */
function ContinueRow({
  entries,
  status,
}: {
  readonly entries: readonly ContinueCardView[];
  readonly status: SectionStatusView;
}): JSX.Element | null {
  if (entries.length === 0 && status.state === "ready") return null; // honest absence on a fresh session
  return (
    <section className="wfx-row" data-wfx-row="continue">
      <div className="wfx-row__header">
        <h2 className="wfx-row__title">Continue watching</h2>
        <p className="wfx-row__reason">Pick up where you left off — from your watch state.</p>
      </div>
      <SectionStatus status={status} title="Continue watching" />
      {entries.length > 0 ? (
        <div className="wfx-row__scroller">
          {entries.map((entry) => {
            const card: CardView | null = entry.joined === null ? null : {
              itemId: entry.itemId,
              title: entry.title,
              canonicalType: entry.joined.canonicalType,
              ...(entry.joined.durationMs !== undefined ? { durationMs: entry.joined.durationMs } : {}),
              connectorId: entry.joined.connectorId,
              externalRef: entry.joined.externalRef,
            };
            return card === null ? (
              <ItemCard
                key={entry.itemId}
                linked={false}
                card={{
                  itemId: entry.itemId,
                  title: entry.title,
                  canonicalType: "video",
                  connectorId: "",
                  externalRef: "",
                }}
                resume={{ resumePositionMs: entry.positionMs, completionRatio: entry.completionRatio }}
              />
            ) : (
              <ItemCard
                key={entry.itemId}
                card={card}
                resume={{ resumePositionMs: entry.positionMs, completionRatio: entry.completionRatio }}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/** The hero: the one resume-or-start primary item. */
function Hero({ view }: { readonly view: HomeView }): JSX.Element | null {
  const resumeEntry = view.continueWatching.entries.find((entry) => entry.status !== "completed") ?? null;
  const startCard = view.rows[0]?.cards[0] ?? view.rows[1]?.cards[0] ?? null;
  if (resumeEntry !== null && resumeEntry.joined !== null) {
    const pct = percentWatched(resumeEntry.completionRatio);
    return (
      <section
        className="wfx-hero"
        style={{ background: placeholderArt(resumeEntry.itemId) }}
        data-wfx-hero="resume"
        aria-label={`Continue watching: ${resumeEntry.title}`}
      >
        <span className="wfx-card__art" aria-hidden="true">
          <span>{placeholderMonogram(resumeEntry.title)}</span>
        </span>
        <h1 className="wfx-hero__title" data-wfx-hero-title>
          {resumeEntry.title}
        </h1>
        <p className="wfx-hero__meta">
          {resumeEntry.positionMs > 0 ? (
            <span data-wfx-hero-resume>Resume at {formatDuration(resumeEntry.positionMs)}</span>
          ) : null}
          {pct !== null ? <span>{pct}</span> : null}
        </p>
        <div className="wfx-hero__actions">
          <a
            className="wfx-btn wfx-btn--primary"
            href={cardPlayerHref(
              {
                itemId: resumeEntry.itemId,
                title: resumeEntry.title,
                canonicalType: resumeEntry.joined.canonicalType,
                ...(resumeEntry.joined.durationMs !== undefined
                  ? { durationMs: resumeEntry.joined.durationMs }
                  : {}),
                connectorId: resumeEntry.joined.connectorId,
                externalRef: resumeEntry.joined.externalRef,
              },
              resumeEntry.positionMs,
            )}
            data-wfx-hero-play
          >
            <Icon name="play" size={18} />
            Resume
          </a>
          <a
            className="wfx-btn"
            href={itemDetailHref({
              itemId: resumeEntry.itemId,
              connectorId: resumeEntry.joined.connectorId,
              externalRef: resumeEntry.joined.externalRef,
              title: resumeEntry.title,
              canonicalType: resumeEntry.joined.canonicalType,
            })}
          >
            Details
          </a>
        </div>
      </section>
    );
  }
  if (startCard === null) return null;
  return (
    <section
      className="wfx-hero"
      style={{ background: placeholderArt(startCard.itemId) }}
      data-wfx-hero="start"
      aria-label={`Featured: ${startCard.title}`}
    >
      <span className="wfx-card__art" aria-hidden="true">
        <span>{placeholderMonogram(startCard.title)}</span>
      </span>
      <h1 className="wfx-hero__title" data-wfx-hero-title>
        {startCard.title}
      </h1>
      <p className="wfx-hero__meta">
        <span className="wfx-badge wfx-badge--type">{startCard.canonicalType}</span>
        {startCard.durationMs !== undefined ? <span>{formatDuration(startCard.durationMs)}</span> : null}
      </p>
      <div className="wfx-hero__actions">
        <a
          className="wfx-btn wfx-btn--primary"
          href={cardPlayerHref(startCard)}
          data-wfx-hero-play
        >
          <Icon name="play" size={18} />
          Play
        </a>
        <a
          className="wfx-btn"
          href={itemDetailHref({
            itemId: startCard.itemId,
            connectorId: startCard.connectorId,
            externalRef: startCard.externalRef,
            title: startCard.title,
            canonicalType: startCard.canonicalType,
            ...(startCard.durationMs !== undefined ? { durationMs: startCard.durationMs } : {}),
          })}
        >
          Details
        </a>
      </div>
    </section>
  );
}

/** The home surface. */
export function HomeSurface({ view }: { readonly view: HomeView }): JSX.Element {
  const hasAnyRow =
    view.rows.some((row) => row.cards.length > 0) || view.shortsRail.cards.length > 0;
  const allRowsFailed =
    view.rows.every((row) => row.status.state === "error") &&
    view.shortsRail.status.state === "error" &&
    view.continueWatching.entries.length === 0;
  return (
    <div data-wfx-surface="home" data-wfx-home>
      <Hero view={view} />
      <ContinueRow entries={view.continueWatching.entries} status={view.continueWatching.status} />
      {view.rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
      {view.shortsRail.cards.length > 0 ? (
        <section className="wfx-row" data-wfx-row="shorts">
          <div className="wfx-row__header">
            <h2 className="wfx-row__title">Shorts</h2>
            <p className="wfx-row__reason">
              Vertical, swipe-driven — <a href="/shorts">open the short feed</a>.
            </p>
          </div>
          <div className="wfx-row__scroller wfx-row__scroller--shorts">
            {view.shortsRail.cards.map((card) => (
              <ItemCard key={card.itemId} card={card} variant="short" />
            ))}
          </div>
        </section>
      ) : view.shortsRail.status.state === "error" ? (
        <section className="wfx-row" data-wfx-row="shorts">
          <div className="wfx-row__header">
            <h2 className="wfx-row__title">Shorts</h2>
            <p className="wfx-row__reason">Vertical, swipe-driven.</p>
          </div>
          <SectionStatus status={view.shortsRail.status} title="Shorts" />
        </section>
      ) : null}
      {!hasAnyRow && !allRowsFailed && view.continueWatching.entries.length === 0 ? (
        <EmptyState
          title="No content yet"
          detail="The configured source answered with no cards for this feed. Connect a source or check the service — WebFlix never fabricates content."
          action={
            <a className="wfx-btn" href="/search">
              Try search
            </a>
          }
        />
      ) : null}
    </div>
  );
}
