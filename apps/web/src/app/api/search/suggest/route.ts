/**
 * @wfx/app-web — the search suggestion route (R24-W2): GET /api/search/suggest.
 *
 * THE SEARCH-SUGGESTIONS ROW'S REAL BACKING: source-neutral suggestions
 * under the search box while typing — the TITLE completions from the
 * runtime's own search seam (the same canonical-joined hits the results
 * surface renders) plus the MATCHES-BY-MEANING lane (the same semantic
 * search R23 wired, with its honest unavailable state on transports
 * that do not serve it). A suggestion is a HINT, never a required step:
 * submitting the raw query still runs the full search (the suggestion
 * list only ever fills the box).
 *
 * Honesty laws:
 * - the empty/short query answers the typed empty lane (no suggestion
 *   noise for single characters — the deterministic bound);
 * - the title lane comes from the REAL search seam (never a fabricated
 *   catalog);
 * - the meaning lane degrades to its honest unavailable state exactly
 *   as the results surface does (one source of truth);
 * - the response carries the suggestion kinds the client island
 *   renders (title | meaning) with their jump targets (the same hrefs
 *   the surfaces use).
 */

import { NextResponse } from "next/server";

import { getWebRuntimeHost } from "@/host/web-host";
import { loadSearchView } from "@/host/view-models";
import { searchByMeaning } from "@/host/intelligence";
import { itemDetailHref } from "@/app/routing";

export const dynamic = "force-dynamic";

/** The minimum query length before suggestions answer (the noise bound). */
const MIN_QUERY_LENGTH = 2;

/** The maximum suggestions per lane (the visual bound). */
const MAX_PER_LANE = 5;

/** One suggestion the client island renders. */
export interface SearchSuggestion {
  readonly kind: "title" | "meaning";
  readonly text: string;
  /** The target the suggestion navigates to (the item hub). */
  readonly href: string;
}

/** GET /api/search/suggest?q= — the source-neutral suggestion lanes. */
export async function GET(request: Request): Promise<NextResponse> {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ ok: true, query, suggestions: [] }, { status: 200 });
  }

  const host = await getWebRuntimeHost();
  // The TITLE lane: the runtime's own search seam (the real hits, the
  // same canonical join the results surface renders).
  const view = await loadSearchView(host, query);
  const titles: SearchSuggestion[] = view.cards
    .slice(0, MAX_PER_LANE)
    .map((card) => ({
      kind: "title" as const,
      text: card.title,
      href: itemDetailHref({
        itemId: card.itemId,
        connectorId: card.connectorId,
        externalRef: card.externalRef,
        title: card.title,
        canonicalType: card.canonicalType,
        ...(card.durationMs !== undefined ? { durationMs: card.durationMs } : {}),
      }),
    }));

  // The MEANING lane: the same semantic search the results surface
  // renders (with its honest unavailable state — one source of truth).
  const semantic = await searchByMeaning(host, query);
  const meanings: SearchSuggestion[] = semantic.meaning
    .slice(0, MAX_PER_LANE)
    .map((result) => ({
      kind: "meaning" as const,
      text: result.title,
      href: itemDetailHref({
        itemId: result.itemId,
        connectorId: result.connectorId,
        externalRef: result.externalRef,
        title: result.title,
        canonicalType: "video",
      }),
    }));

  return NextResponse.json(
    {
      ok: true,
      query,
      suggestions: [...titles, ...meanings],
      ...(semantic.meaningSearchAvailable ? { meaningAvailable: true } : { meaningAvailable: false }),
    },
    { status: 200 },
  );
}
