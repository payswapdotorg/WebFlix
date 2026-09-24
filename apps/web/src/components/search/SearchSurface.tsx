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
import type { SemanticSearchView } from "@/host/intelligence";
import { SectionStatus } from "@/components/home/HomeSurface";
import { ItemCard } from "@/components/cards/ItemCard";
import { EmptyState } from "@/components/ui/StateViews";
import { formatPosition } from "@/components/ui/format";
import { playerHref } from "@/app/routing";
// R29-B — the REAL filters dialog (N23): the corpus 696px paper dialog,
// honestly wired (only the filters with a real truth behind them).
import { SearchFilters } from "@/components/search/SearchFilters";

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
    // R29-B — the FILTERED empty state: the query HAD real matches, the
    // applied filter hid them all (a different truth than no matches —
    // named honestly, never a fake "no results").
    const filtered =
      view.filters.type !== undefined || view.filters.duration !== undefined;
    return (
      <div data-wfx-surface="search" data-wfx-search-state="no-results">
        <h1 className="wfx-page-title">Search</h1>
        <p className="wfx-page-subtitle" data-wfx-search-query>
          Results for “{view.query}”
        </p>
        <SearchFilters query={view.query} filters={view.filters} typeCounts={view.typeCounts} />
        {filtered ? (
          <EmptyState
            title="Nothing matches this filter"
            detail={`Your search had real matches, but the applied filter hides them all — clear the filter to see every result. WebFlix does not fabricate results.`}
          />
        ) : (
          <>
            <EmptyState
              title="No title matches"
              detail={`Nothing in your sources matches “${view.query}” by name — WebFlix does not fabricate results. Matches by meaning (below) may still find what you mean.`}
            />
            <SemanticResults semantic={view.semantic} query={view.query} />
          </>
        )}
      </div>
    );
  }
  const videoCount = view.typeCounts.get("video") ?? 0;
  const shortCount = view.typeCounts.get("short") ?? 0;
  return (
    <div data-wfx-surface="search" data-wfx-search-state="results">
      <h1 className="wfx-page-title">Search</h1>
      <p className="wfx-page-subtitle" data-wfx-search-query>
        {view.cards.length} result{view.cards.length === 1 ? "" : "s"} for “{view.query}”
        {view.filters.type !== undefined || view.filters.duration !== undefined ? " (filtered)" : ""}
      </p>
      {/* R29-B — THE CONTEXTUAL CHIPS (N23): the corpus chip bar under the
          header — every chip a REAL type filter over the result set (the
          chips render only the types actually present; the corpus's
          Unwatched/Watched/Recently-uploaded/Live chips have no real
          backing on this host and are honestly absent). */}
      <div className="wfx-chipbar" data-wfx-search-chips>
        <div className="wfx-chipbar__track">
          <a
            className={`wfx-chip${view.filters.type === undefined ? " wfx-chip--active" : ""}`}
            href={`/search?q=${encodeURIComponent(view.query)}`}
            data-wfx-search-chip="all"
          >
            All
          </a>
          {videoCount > 0 ? (
            <a
              className={`wfx-chip${view.filters.type === "video" ? " wfx-chip--active" : ""}`}
              href={`/search?q=${encodeURIComponent(view.query)}&type=video`}
              data-wfx-search-chip="video"
            >
              Videos
            </a>
          ) : null}
          {shortCount > 0 ? (
            <a
              className={`wfx-chip${view.filters.type === "short" ? " wfx-chip--active" : ""}`}
              href={`/search?q=${encodeURIComponent(view.query)}&type=short`}
              data-wfx-search-chip="short"
            >
              Shorts
            </a>
          ) : null}
        </div>
      </div>
      {/* R29-B — the REAL Filters control (the corpus 696px dialog — the
          honest TYPE/DURATION groups; the unsupported groups stay
          honestly absent, named inside). */}
      <SearchFilters query={view.query} filters={view.filters} typeCounts={view.typeCounts} />
      {/* R26-W2 — the honest token-composition disclosure (the
          literal-phrase recovery's own sentence — token matches are never
          presented as phrase matches). */}
      {view.resultsNote !== null ? (
        <p className="wfx-row__reason" data-wfx-search-results-note>
          {view.resultsNote}
        </p>
      ) : null}
      <div className="wfx-grid" data-wfx-search-results>
        {view.cards.map((card) => {
          const availability = view.availability.get(card.itemId);
          return (
            <ItemCard
              key={card.itemId}
              card={card}
              variant="result"
              {...(availability !== undefined ? { availability } : {})}
              actions={view.cardActions}
            />
          );
        })}
      </div>
      <SemanticResults semantic={view.semantic} query={view.query} />
    </div>
  );
}

/**
 * R23-H — the semantic search section: matches BY MEANING (titles whose
 * content matches the query, not their names) + findable MOMENTS (the
 * show-me-the-part-where results), each with its jump path and the
 * honest provenance of the contributing models. The anonymous AI
 * boundary (R23-K): a low-cost local read — no account needed.
 */
function SemanticResults({
  semantic,
  query,
}: {
  readonly semantic: SemanticSearchView;
  readonly query: string;
}): JSX.Element {
  if (semantic.status !== "ready") {
    return (
      <section className="wfx-detail__section" aria-label="Matches by meaning" data-wfx-semantic-search data-wfx-semantic-state="unavailable">
        <h2>Matches by meaning</h2>
        <p className="wfx-row__reason" data-wfx-semantic-detail>
          {semantic.detail ?? "Semantic search is not available on this host yet."}
        </p>
      </section>
    );
  }
  if (semantic.meaning.length === 0 && semantic.moments.length === 0) {
    return (
      <section className="wfx-detail__section" aria-label="Matches by meaning" data-wfx-semantic-search data-wfx-semantic-state="no-matches">
        <h2>Matches by meaning</h2>
        <p className="wfx-row__reason" data-wfx-semantic-none>
          Nothing matches “{query}” by meaning or moment yet — WebFlix does not fabricate
          semantic results.
        </p>
      </section>
    );
  }
  return (
    <section className="wfx-detail__section" aria-label="Matches by meaning" data-wfx-semantic-search data-wfx-semantic-state="results">
      <h2>Matches by meaning</h2>
      {semantic.meaning.length > 0 ? (
        <ul data-wfx-semantic-meaning>
          {semantic.meaning.map((result) => (
            <li key={`meaning-${result.itemId}`} data-wfx-semantic-meaning-result={result.itemId}>
              <a
                href={`/item?id=${encodeURIComponent(result.itemId)}&connector=${encodeURIComponent(result.connectorId)}&ref=${encodeURIComponent(result.externalRef)}&title=${encodeURIComponent(result.title)}&type=video`}
                data-wfx-semantic-meaning-link
              >
                <strong>{result.title}</strong>
              </a>
              <span> — matched “{result.matchedText}”</span>
              <span className="wfx-capchip">{Math.round(result.score * 100)}% of your meaning</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wfx-row__reason" data-wfx-semantic-meaning-none>
          No title matched by meaning
          {semantic.meaningSearchAvailable
            ? ""
            : " — this host's index carries no title with both embeddings yet (the honest prerequisite truth)"}
          .
        </p>
      )}
      {semantic.moments.length > 0 ? (
        <>
          <h3>Findable moments</h3>
          <ul data-wfx-semantic-moments>
            {semantic.moments.map((moment) => (
              <li
                key={`moment-${moment.itemId}-${moment.startMs}`}
                data-wfx-semantic-moment
              >
                <a
                  href={playerHref(
                    {
                      itemId: moment.itemId,
                      connectorId: moment.connectorId,
                      externalRef: moment.externalRef,
                      title: moment.title,
                      canonicalType: "video",
                    },
                    moment.startMs,
                  )}
                  data-wfx-semantic-moment-jump={String(moment.startMs)}
                >
                  <strong>{moment.title}</strong> at {formatPosition(moment.startMs)} —{" "}
                  {moment.description}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {semantic.provenance.length > 0 ? (
        <p className="wfx-row__reason" data-wfx-semantic-provenance>
          Signals from {semantic.provenance.map((entry) => entry.modelId).join(", ")} — models
          generate signals; your choices stay yours.
        </p>
      ) : null}
    </section>
  );
}
