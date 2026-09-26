/**
 * @wfx/app-web — THE SUBSCRIPTIONS-FEED GRID (R31, GAP-CORPUS.md §G2 —
 * docs/parity-lab/r30/gap-captures/20260926-052954/g2-subs-feed.json +
 * .jpg, the healthy window's 14 real cards; the R30-B gap #3, captured
 * degraded in R30's raw/07, now captured healthy).
 *
 * THE CAPTURED GRAMMAR (§G2), bound to WebFlix's real truths only:
 *
 * - THE SHELL: the two-column browse grid (the
 *   ytd-two-column-browse-results-renderer family — the standard browse
 *   content area; the corpus-measured grid bar x=72 y=56 w=1352 in the
 *   1440 viewport is recorded in the divergence ledger: WebFlix's feed
 *   renders inside its own standard shell — the frozen rail law keeps
 *   the 240px guide, so the grid's origin is the shell's content area,
 *   never a rail redesign).
 * - THE HEADER: "Latest" — the captured section heading (present in BOTH
 *   captured states: the healthy grid's text dump + the R30 degraded
 *   window's "a 'Latest' header and 3 cards"). The captured "All
 *   subscriptions" LAYOUT TOGGLE stays honestly ABSENT (see the
 *   divergence ledger: no layout-toggle seam exists — a control with one
 *   honest state would be a dead imitation).
 * - THE CARDS: title, channel name, meta line ("channel · views · age"),
 *   thumbnail. WebFlix's binding: the SAME card grammar every feed
 *   surface renders (ItemCard — the seam law: no new card family), over
 *   the subscribed items' JOINED connector identities (the real
 *   connector read). The meta line's views/age carry NO WebFlix datum
 *   (the domain model has neither a view count nor an upload age — never
 *   a fabricated "64K 7h ago"); the channel slot renders the card's own
 *   honest source identity ("From <connector>").
 * - THE DATA TRUTH: the stored Subscriptions-list entries — the SAME
 *   fold the rail's Subscriptions section and the Library's Subscriptions
 *   list render (the R30-A `hydrate()` seam: one memoized server read
 *   per engine; the write paths keep it current). NEVER a new source.
 * - THE ROUTE LAW: each card follows the rail rows' own law — the
 *   entry's JOINED player surface (`playerHref`); an entry this process
 *   never joined renders UNLINKED (the cards' own law — never a
 *   fabricated link).
 * - THE EMPTY STATE: no subscriptions stored = the honest empty state in
 *   the capability row's own vocabulary ("No subscriptions yet —
 *   subscribe from any watch page", the rail's own empty note) — never a
 *   fabricated card.
 *
 * Server component: pure presentational projection of the account
 * chrome view's subscriptions entries.
 */

import type { JSX } from "react";

import type { RailSubscriptionEntry } from "@/host/account-chrome";
import type { CardView } from "@/host/view-models";
import { artworkViewOfContent } from "@/host/view-models";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState } from "@/components/ui/StateViews";

/**
 * Project one stored subscription entry into the card grammar's target
 * through its JOINED connector identity (the real connector read). An
 * entry with no joined identity projects to null — the surface renders
 * its honest UNLINKED form (the cards' own law).
 */
function cardOfEntry(entry: RailSubscriptionEntry): CardView | null {
  if (entry.joined === null) return null;
  return {
    itemId: entry.itemId,
    title: entry.title,
    canonicalType: entry.joined.canonicalType,
    ...(entry.joined.durationMs !== undefined ? { durationMs: entry.joined.durationMs } : {}),
    connectorId: entry.joined.connectorId,
    externalRef: entry.joined.externalRef,
    ...(entry.joined.artwork !== undefined
      ? { artwork: artworkViewOfContent(entry.joined.artwork, entry.title) }
      : {}),
  };
}

/** The subscriptions-feed grid (§G2): the captured browse grammar over the stored truth. */
export function SubscriptionsFeedSurface({
  entries,
}: {
  /** The stored Subscriptions entries (the account chrome view's own — the same fold the rail renders). */
  readonly entries: readonly RailSubscriptionEntry[];
}): JSX.Element {
  return (
    <div data-wfx-surface="subscriptions" data-wfx-subsfeed>
      {/* §G2 — the captured section heading ("Latest" — present in both
          captured states; the grid's own header row). */}
      <h1 className="wfx-subsfeed__heading" data-wfx-subsfeed-heading>
        Latest
      </h1>
      {entries.length === 0 ? (
        /* The honest empty state — the rail's own vocabulary, never a
           fabricated card. */
        <EmptyState
          title="No subscriptions yet"
          detail="Subscribe from any watch page — the titles you follow land here."
          action={
            <a className="wfx-btn" href="/">
              Browse content
            </a>
          }
        />
      ) : (
        /* §G2 — the browse grid (the captured 3-4 column card grid; the
           responsive seam keeps narrower viewports honest). */
        <ul className="wfx-subsfeed__grid" data-wfx-subsfeed-grid>
          {entries.map((entry) => {
            const card = cardOfEntry(entry);
            return (
              <li
                key={entry.itemId}
                className="wfx-subsfeed__cell"
                data-wfx-subsfeed-entry={entry.itemId}
                {...(card === null ? { "data-wfx-subsfeed-unlinked": entry.itemId } : {})}
              >
                {card !== null ? (
                  <ItemCard card={card} />
                ) : (
                  /* The honest UNLINKED card (the WatchlistRow's own
                     pattern): the stored title + the source-unknown
                     truth — never a fabricated link. */
                  <span className="wfx-card" data-wfx-card={entry.itemId}>
                    <span>
                      <p className="wfx-card__title">{entry.title}</p>
                      <p className="wfx-card__meta">Source unknown in this session</p>
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
