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
import { artworkViewOfContent } from "@/host/view-models";
import type { DiscoveryBundle } from "@/host/discoverability";
import { DiscoveryHeader } from "@/components/discovery/DiscoveryHeader";
import { ItemCard, cardPlayerHref, type CardActionContextInput } from "@/components/cards/ItemCard";
import { ArtworkImage } from "@/components/cards/ArtworkImage";
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
export function Row({
  row,
  actions,
}: {
  readonly row: RowView;
  /** R24-W2 — the cards' action context (queue/save/share + the preview policy). */
  readonly actions?: CardActionContextInput;
}): JSX.Element | null {
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
            <ItemCard key={card.itemId} card={card} {...(actions !== undefined ? { actions } : {})} />
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
              // R26-W2 — the continue card carries the joined item's REAL
              // source artwork (the same typed fallback floor when absent).
              ...(entry.joined.artwork !== undefined
                ? { artwork: artworkViewOfContent(entry.joined.artwork, entry.title) }
                : {}),
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

/** The hero: the one resume-or-start primary item (content-led — the real source artwork anchors it). */
function Hero({ view }: { readonly view: HomeView }): JSX.Element | null {
  const resumeEntry = view.continueWatching.entries.find((entry) => entry.status !== "completed") ?? null;
  const startCard = view.rows[0]?.cards[0] ?? view.rows[1]?.cards[0] ?? null;
  if (resumeEntry !== null && resumeEntry.joined !== null) {
    const pct = percentWatched(resumeEntry.completionRatio);
    const resumeArtwork =
      resumeEntry.joined.artwork !== undefined
        ? artworkViewOfContent(resumeEntry.joined.artwork, resumeEntry.title)
        : null;
    return (
      <section
        className="wfx-hero"
        style={{ background: placeholderArt(resumeEntry.itemId) }}
        data-wfx-hero="resume"
        aria-label={`Continue watching: ${resumeEntry.title}`}
      >
        {/* R26-W2 — the hero's REAL SOURCE ARTWORK (the media-product
            grammar: the artwork is the anchor); the deterministic gradient
            stays beneath as the typed fallback. */}
        {resumeArtwork !== null ? (
          <ArtworkImage
            artwork={resumeArtwork}
            className="wfx-hero__img"
            alt={`${resumeEntry.title} — artwork served by ${resumeArtwork.connectorId}`}
            eager
          />
        ) : null}
        <span className="wfx-hero__scrim" aria-hidden="true" />
        {resumeArtwork === null ? (
          <span className="wfx-card__art" aria-hidden="true">
            <span>{placeholderMonogram(resumeEntry.title)}</span>
          </span>
        ) : null}
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
      {/* R26-W2 — the start hero's REAL SOURCE ARTWORK (same law as the
          resume hero: the source's own thumbnail anchors the featured item;
          the deterministic gradient stays beneath as the fallback). */}
      {startCard.artwork !== undefined ? (
        <ArtworkImage
          artwork={startCard.artwork}
          className="wfx-hero__img"
          alt={`${startCard.title} — artwork served by ${startCard.artwork.connectorId}`}
          eager
        />
      ) : (
        <span className="wfx-card__art" aria-hidden="true">
          <span>{placeholderMonogram(startCard.title)}</span>
        </span>
      )}
      <span className="wfx-hero__scrim" aria-hidden="true" />
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

/**
 * The imported-feed section (R21-D): the records the CURRENT feed mode
 * honors — source-native order, never re-ranked (the frozen BYOF truth
 * law), with the freshness sentence and the Library management link.
 */
function ImportedFeedSection({ section }: { readonly section: NonNullable<DiscoveryBundle["importedSection"]> }): JSX.Element {
  return (
    <section className="wfx-row" data-wfx-row="imported-feed" data-wfx-imported-feed>
      <div className="wfx-row__header">
        <h2 className="wfx-row__title">{section.label}</h2>
        <p className="wfx-row__reason" data-wfx-imported-order-note>
          {section.orderSentence} {section.freshnessSentence}
        </p>
      </div>
      <div className="wfx-row__scroller">
        {section.cards.map((card) => (
          <a
            key={`${card.connectorId}:${card.externalRef}`}
            className="wfx-disc__importcard"
            href={itemDetailHref({
              itemId: card.itemId,
              connectorId: card.connectorId,
              externalRef: card.externalRef,
              title: card.title,
              canonicalType: "video",
            })}
            data-wfx-imported-card={card.externalRef}
          >
            <span className="wfx-card__art" aria-hidden="true">
              <span>{placeholderMonogram(card.title)}</span>
            </span>
            <span className="wfx-disc__importtitle">{card.title}</span>
            <span className="wfx-disc__importmeta">from your feed</span>
          </a>
        ))}
      </div>
      <p className="wfx-row__reason">
        <a href={section.manageHref}>See your imported feeds in Library</a>
      </p>
    </section>
  );
}

/** The home surface. */
export function HomeSurface({
  view,
  discovery,
}: {
  readonly view: HomeView;
  /** The R21-D discovery bundle (the orientation zone + the mode's feed). */
  readonly discovery?: DiscoveryBundle;
}): JSX.Element {
  const mode = discovery?.feedMode.mode ?? "foryou";
  const showDiscoveryRows = discovery?.discoveryRowsRender ?? true;
  const hasAnyRow =
    view.rows.some((row) => row.cards.length > 0) || view.shortsRail.cards.length > 0;
  const allRowsFailed =
    view.rows.every((row) => row.status.state === "error") &&
    view.shortsRail.status.state === "error" &&
    view.continueWatching.entries.length === 0;
  const importedSection = discovery?.importedSection ?? null;
  return (
    <div data-wfx-surface="home" data-wfx-home data-wfx-feed-mode={mode}>
      {discovery !== undefined ? <DiscoveryHeader bundle={discovery} /> : null}
      <Hero view={view} />
      <ContinueRow entries={view.continueWatching.entries} status={view.continueWatching.status} />
      {importedSection !== null ? <ImportedFeedSection section={importedSection} /> : null}
      {showDiscoveryRows
        ? view.rows.map((row) => (
            <Row key={row.id} row={row} actions={view.cardActions} />
          ))
        : null}
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
      {!hasAnyRow && !allRowsFailed && view.continueWatching.entries.length === 0 && importedSection === null ? (
        <EmptyState
          title="No content yet"
          detail="The configured source answered with no cards for this feed. Connect a source or check the service — WebFlix never fabricates content."
          action={
            <a className="wfx-btn" href="/settings?section=sources">
              Connect a source
            </a>
          }
        />
      ) : null}
    </div>
  );
}
