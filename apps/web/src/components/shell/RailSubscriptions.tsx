/**
 * @wfx/app-web — THE RAIL SUBSCRIPTIONS SECTION (R30-B, CORPUS §4 —
 * docs/parity-lab/r30/lead-captures/CORPUS.md).
 *
 * THE CORPUS GRAMMAR (measured, run-2 09:45 — the avatars still live):
 * the guide's Subscriptions section is a FLAT CHANNEL LIST with the
 * channel avatars at 24x24 rendered (natural 88x88 — the R28
 * corpus-pending avatar measure, now CLOSED by this capture), guide
 * entries 204x40, avatars left.
 *
 * THE HONEST BINDING (the divergence-5 law — WebFlix's rail = its real
 * surfaces): WebFlix's "subscriptions" are the REAL stored
 * Subscriptions-list entries the Subscribe pill writes (the same
 * library truth the Library page renders — the R30-A hydrate seam's
 * fold). The rows list those entries — the item's own title (never a
 * fabricated channel name; WebFlix's subscribe keys the item), the
 * honest monogram avatar at 24x24 (this host's sources carry no
 * channel photos — the same stand-in the channel row carries), and the
 * row's REAL destination: the entry's own player surface. An entry
 * whose source identity this process never joined renders UNLINKED
 * (the cards' own law — never a fabricated link).
 *
 * THE SECTION LAW (the seam law: no rail redesign): the section joins
 * BETWEEN the primary group and the You group exactly where the corpus
 * taxonomy places it, only when the account view carries it (the
 * signed-in state's chrome; the signed-out rail stays the current
 * R29-verified state, byte-identical). An empty subscriptions list
 * renders the honest empty note — the same vocabulary every real
 * surface carries (never a fabricated row).
 */

import type { JSX } from "react";

import type { RailSubscriptionEntry } from "@/host/account-chrome";
import { playerHref } from "@/app/href";

/** The rail's Subscriptions section (CORPUS §4 — the flat list with avatars). */
export function RailSubscriptions({
  entries,
}: {
  /** The stored Subscriptions-list entries (the account chrome view's own). */
  readonly entries: readonly RailSubscriptionEntry[];
}): JSX.Element {
  return (
    <div className="wfx-railsub" data-wfx-rail-subscriptions>
      <h3 className="wfx-rail__heading">Subscriptions</h3>
      {entries.length === 0 ? (
        // The honest empty note (the flat list's real truth — the same
        // vocabulary the Library's sections carry, never a fabricated row).
        <p className="wfx-railsub__empty" data-wfx-rail-subscriptions-empty>
          No subscriptions yet — subscribe from any watch page.
        </p>
      ) : (
        <ul className="wfx-railsub__list" data-wfx-rail-subscriptions-list>
          {entries.map((entry) => {
            // The row's real destination: the entry's own player surface,
            // built from its JOINED source identity. No join ⇒ UNLINKED
            // (the cards' law — never a fabricated link).
            const href =
              entry.joined !== null
                ? playerHref({
                    itemId: entry.joined.itemId,
                    connectorId: entry.joined.connectorId,
                    externalRef: entry.joined.externalRef,
                    title: entry.joined.title,
                    canonicalType: entry.joined.canonicalType,
                    ...(entry.joined.durationMs !== undefined
                      ? { durationMs: entry.joined.durationMs }
                      : {}),
                  })
                : null;
            // The honest monogram avatar (24x24 — the corpus measure): the
            // title's own first mark (this host's sources carry no channel
            // photos — never a fabricated one).
            const monogram = entry.title.length > 0 ? entry.title[0]!.toUpperCase() : "W";
            const row = (
              <>
                {/* CORPUS §4 — the channel avatar 24x24, left of the label. */}
                <span className="wfx-railsub__avatar" aria-hidden="true">
                  {monogram}
                </span>
                <span className="wfx-railsub__label">{entry.title}</span>
              </>
            );
            return (
              <li key={entry.itemId} data-wfx-rail-subscription={entry.itemId}>
                {href !== null ? (
                  <a
                    className="wfx-railsub__row"
                    href={href}
                    data-wfx-rail-subscription-link={entry.itemId}
                  >
                    {row}
                  </a>
                ) : (
                  <span
                    className="wfx-railsub__row wfx-railsub__row--unlinked"
                    data-wfx-rail-subscription-unlinked={entry.itemId}
                  >
                    {row}
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
