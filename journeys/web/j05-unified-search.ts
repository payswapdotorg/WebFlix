/**
 * @wfx/journeys — J05 Unified search (encoded Web journey).
 *
 * Doc expectation (matrix J05: unified search on Web = Yes): search is
 * the unified discovery entry over the canonical catalog — canonical
 * result cards for a query, the honest no-results state, and the
 * intent entry from every surface (J02's box).
 *
 * Web-fixture-boot encoding: the results state with canonical cards and
 * the query echo; the no-results state (typed, never an error); the
 * input retains the submitted query (the session's stated intent).
 *
 * KNOWN DEFECT (reported to the lead, not encoded as theater): opening
 * `/search` with NO query currently throws a typed RuntimeError before
 * the empty-query state can render (apps/web/src/app/search/page.tsx
 * calls loadSearchView before the empty-query guard). The doc's
 * expected empty-query state is asserted at the SEARCH-BOX level (the
 * product's own route-table law: "the empty state is the search box
 * itself"); the no-query crash is listed in the manifest limitations
 * and reported for an apps/web fix (outside this item's scope).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";
import { parseSearch } from "../lib/state";

export const j05UnifiedSearch: Journey = {
  id: "J05",
  title: "Unified search",
  doc: "docs/validation/webflix-golden-journeys.md §J05 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/search?q=rain");

    // The results state: canonical cards + the query echo.
    const resultsHtml = await browser.outerHtml("[data-wfx-surface='search']");
    const results = parseSearch(resultsHtml ?? "");
    assert.that("the search surface renders the results state", 'data-wfx-search-state="results"', results.state ?? "<none>", results.state === "results");
    // The echo is read as VISIBLE text (React segments the markup with
    // comment nodes — innerText is the honest read).
    const echo = await browser.tryText("[data-wfx-search-query]");
    assert.that(
      "the query is echoed with its result count",
      `the query echo names the results`,
      echo ?? "<no echo>",
      echo !== null && echo.includes("rain"),
    );
    assert.that(
      "the unified search joins the whole catalog (3 canonical rain titles across types)",
      "3 canonical result cards",
      `${results.resultCards} result cards`,
      results.resultCards === 3,
    );

    // Every result card is a canonical item link (source-neutral identity).
    const hrefs = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll("[data-wfx-search-results] a[data-wfx-card]")].map((a) => a.getAttribute('href') ?? ''))()`,
    );
    const canonical = (hrefs ?? []).filter((href) => href.startsWith("/item?id=wfxitm_"));
    assert.that(
      "every result links the canonical item detail",
      `${(hrefs ?? []).length} cards all linking /item?id=wfxitm_…`,
      `${canonical.length} of ${(hrefs ?? []).length}`,
      (hrefs ?? []).length === 3 && canonical.length === 3,
    );

    // The no-results state: typed and honest, never an error.
    await goto(context, "/search?q=zzzz-no-such-title");
    const noneHtml = await browser.outerHtml("[data-wfx-surface='search']");
    const none = parseSearch(noneHtml ?? "");
    assert.that(
      "an unmatched query renders the honest no-results state",
      'data-wfx-search-state="no-results"',
      none.state ?? "<none>",
      none.state === "no-results",
    );

    // The submitted query is retained (the stated intent, echoed by the surface).
    const noneEcho = await browser.tryText("[data-wfx-search-query]");
    assert.that(
      "the surface retains the submitted query (the stated intent, echoed)",
      "the query echo names 'zzzz-no-such-title'",
      noneEcho ?? "<no echo>",
      noneEcho !== null && noneEcho.includes("zzzz-no-such-title"),
    );

    await context.screenshot("j05-unified-search");
    await describe(context, "results state with 3 canonical cards and the query echo; honest no-results state; the intent entry retains the submitted query");
  },
};
