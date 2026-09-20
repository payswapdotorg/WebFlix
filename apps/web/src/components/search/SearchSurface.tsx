/**
 * @wfx/app-web — the search surface (R07).
 *
 * The unified search flow over the RUNTIME's search model: `?q=<query>` →
 * canonical-joined results. The typed states are honest by construction:
 * an EMPTY QUERY is the "type something" state (the route renders it
 * without asking the runtime — the state machine's invalid-target law);
 * an ERROR status renders as the error state with the typed failure
 * detail (never a fake empty result — the R01 law); an EMPTY result set
 * is the honest "no matches" state. Server component; the search BOX
 * lives in the shell top bar as a plain form (no client JS needed).
 */

import type { JSX } from "react";

import type { SearchView } from "@/host/view-models";
import { SectionStatus } from "@/components/home/HomeSurface";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState } from "@/components/ui/StateViews";

/** The search surface. */
export function SearchSurface({ view }: { readonly view: SearchView }): JSX.Element {
  if (view.query.length === 0) {
    return (
      <div data-wfx-surface="search" data-wfx-search-state="empty-query">
        <h1 className="wfx-page-title">Search</h1>
        <p className="wfx-page-subtitle">Search your entertainment across every connected source.</p>
        <EmptyState
          title="Type to search"
          detail="Use the search box above — results come from the sources this host is connected to, through the same runtime search every surface uses."
        />
      </div>
    );
  }
  if (view.status.state === "error") {
    return (
      <div data-wfx-surface="search" data-wfx-search-state="error">
        <h1 className="wfx-page-title">Search</h1>
        <p className="wfx-page-subtitle" data-wfx-search-query>
          Results for “{view.query}”
        </p>
        <div data-wfx-search-error>
          <SectionStatus status={view.status} title="Search" />
        </div>
      </div>
    );
  }
  if (view.cards.length === 0) {
    return (
      <div data-wfx-surface="search" data-wfx-search-state="no-results">
        <h1 className="wfx-page-title">Search</h1>
        <p className="wfx-page-subtitle" data-wfx-search-query>
          Results for “{view.query}”
        </p>
        <EmptyState
          title="No matches"
          detail={`Nothing in your sources matches “${view.query}”. WebFlix does not fabricate results — try a different query.`}
        />
      </div>
    );
  }
  return (
    <div data-wfx-surface="search" data-wfx-search-state="results">
      <h1 className="wfx-page-title">Search</h1>
      <p className="wfx-page-subtitle" data-wfx-search-query>
        {view.cards.length} result{view.cards.length === 1 ? "" : "s"} for “{view.query}”
      </p>
      <div className="wfx-grid" data-wfx-search-results>
        {view.cards.map((card) => {
          const availability = view.availability.get(card.itemId);
          return (
            <ItemCard
              key={card.itemId}
              card={card}
              {...(availability !== undefined ? { availability } : {})}
            />
          );
        })}
      </div>
    </div>
  );
}
