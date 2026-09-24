/**
 * @wfx/app-web — the home surface (R07; R27-W2 the YouTube home grammar;
 * R28-B the home restructure).
 *
 * THE R28-B RESTRUCTURE (the operator's #5: "YouTube home: chip bar +
 * card grid IMMEDIATELY — no hero, no config section"): the HERO and the
 * "What your feed shows" orientation zone LEFT the home surface. Home is
 * now THE CHIP BAR (sticky under the topbar) then the CONTENT ROWS
 * directly — Continue watching / For you / Trending / the Shorts shelf —
 * exactly the corpus home-anatomy (docs/parity-lab/r28/web-notes/
 * home-anatomy.md). The feed-mode and Personalize CONFIG surfaces moved to
 * Settings → General ("Your feed"); the first-run orientation stays
 * available there. Each typed section renders its cards with its honest
 * status verbatim: an ERROR section renders as the error state, never a
 * fake empty row (the honesty law).
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
import { ChipBar, type ChipCategory } from "@/components/home/ChipBar";
import { ItemCard, type CardActionContextInput } from "@/components/cards/ItemCard";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
// R28-B (resumption fix) — the 1d32ed8 commit's href-builder extraction
// left these two references unimported (the wiped session's last commit
// shipped mid-refactor); restored verbatim from the extraction's home.
import { itemDetailHref } from "@/app/href";
import { placeholderMonogram } from "@/components/ui/format";

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

/** One grid section: the row's cards in the responsive grid (typed status verbatim). */
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

/** The continue-watching grid section (resume positions + progress bars). */
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
      <div className="wfx-row__scroller wfx-row__scroller--shorts">
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

/**
 * The home surface. R27-W2: `data-wfx-feed-root` names the chip bar's
 * filtering root (the CSS seam) + `data-wfx-feed-filter` starts at all.
 */
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
  // R27-W2 — the REAL categories of THIS feed (the cards' own canonical
  // types, first-seen order — a chip never names a category the feed
  // cannot fill; "video" is the unmarked default and stays out).
  const categories: ChipCategory[] = [];
  const seenCategories = new Set<string>();
  for (const row of view.rows) {
    for (const card of row.cards) {
      const value = card.canonicalType.toLowerCase();
      if (value === "video" || seenCategories.has(value)) continue;
      seenCategories.add(value);
      categories.push({ label: card.canonicalType, value });
    }
  }
  return (
    <div data-wfx-surface="home" data-wfx-home data-wfx-feed-mode={mode} data-wfx-feed-root data-wfx-feed-filter="all">
      {/* THE CHIP BAR (the corpus anatomy — filters the real feed; the
          R28-B restructure: it is the FIRST thing under the topbar, the
          grid follows immediately — no hero, no orientation zone). */}
      <ChipBar categories={categories} />
      {/* The content rows — Continue watching first (the corpus feed's own
          shelf), then the feed rows, then the Shorts shelf. */}
      <ContinueRow entries={view.continueWatching.entries} status={view.continueWatching.status} />
      {importedSection !== null ? <ImportedFeedSection section={importedSection} /> : null}
      {showDiscoveryRows
        ? view.rows.map((row) => (
            <Row key={row.id} row={row} actions={view.cardActions} />
          ))
        : null}
      {/* THE SHORTS SHELF (the corpus: a row of 9:16 cards between the
          content rows — the REAL shorts content). */}
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
