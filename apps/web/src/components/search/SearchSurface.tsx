/**
 * @wfx/app-web — the search surface (WFX-051).
 *
 * The real search flow: query → Experience API search (both surfaces
 * browsed, watch first) → results grid. The typed states are honest by
 * construction: an EMPTY QUERY is the "type something" state, an EMPTY
 * RESULT set is the "no matches" state (never fabricated cards), and the
 * loading state is the route-level skeleton (`app/search/loading.tsx`).
 * Server component — the search BOX lives in the shell top bar as a plain
 * form, so the whole flow works without client JS.
 */

import type { JSX } from "react";

import type { SearchView } from "@/host/views";
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
          detail="Use the search box above — results come from the sources this host is connected to, through the same feed law every surface uses."
        />
      </div>
    );
  }
  if (view.results.length === 0) {
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
        {view.results.length} result{view.results.length === 1 ? "" : "s"} for “{view.query}”
      </p>
      <div className="wfx-grid" data-wfx-search-results>
        {view.results.map((card) => (
          <ItemCard key={card.itemId} card={card} />
        ))}
      </div>
    </div>
  );
}
