/**
 * @wfx/journeys — J11 Library / watchlist / history (encoded Web journey).
 *
 * Doc expectation (matrix J11): the library destination — watchlist +
 * history (+ the R14 offline-and-verified section).
 *
 * Web-fixture-boot encoding: the library destination renders all three
 * sections with typed statuses; the fresh-session watchlist/history are
 * HONESTLY empty (typed empty states with guidance, never fabricated
 * entries); the offline-and-verified section exposes the R14/J26
 * surface (the fixture's verified Harbor Lights copy).
 *
 * HONEST LIMIT (listed): recording a watch event on the player page and
 * reading it back on the library page requires ONE runtime instance —
 * the Turbopack dev server compiles every route as its own module
 * graph (the documented dev split-module reality in
 * apps/web/src/host/acquisition-fixtures.ts). The single-bundle
 * production/service boot folds it (the app's composition tests cover
 * the fold); the manifest limitation names it.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";
import { parseLibrary } from "../lib/state";

export const j11Library: Journey = {
  id: "J11",
  title: "Library / watchlist / history",
  doc: "docs/validation/webflix-golden-journeys.md §J11 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/library");

    await assert.visible("[data-wfx-surface='library']", "the library destination renders");
    await assert.visible("[data-wfx-library-watchlist]", "the watchlist section renders");
    await assert.visible("[data-wfx-library-history]", "the history section renders");
    await assert.visible("[data-wfx-library-offline]", "the offline-and-verified section renders (the R14 surface)");

    // Fresh-session honest empty states (typed, with guidance).
    const html = await browser.outerHtml("[data-wfx-surface='library']");
    const library = parseLibrary(html ?? "");
    assert.that(
      "the watchlist is honestly empty on a fresh session (typed empty state, never fabricated saves)",
      "the typed watchlist empty state",
      library.watchlistEmpty ? "the empty state rendered" : "entries present or no empty state",
      library.watchlistEmpty,
    );
    assert.that(
      "the history is honestly empty on a fresh session (typed empty state, never fabricated history)",
      "the typed history empty state",
      library.historyEmpty ? "the empty state rendered" : "entries present or no empty state",
      library.historyEmpty,
    );
    await assert.textContains("[data-wfx-library-watchlist]", "Nothing saved yet", "the watchlist empty state guides the user to save from details pages");
    await assert.textContains("[data-wfx-library-history]", "No watch history yet", "the history empty state guides the user to watch something");

    // The offline-and-verified section: the J26 surface (R14's fixture truth).
    assert.that(
      "the offline-and-verified section exposes the verified offline copy (the J26 fixture)",
      "one offline-ready entry",
      `${library.offlineEntries.length} offline entries`,
      library.offlineEntries.length >= 1,
    );
    // The status labels are read as VISIBLE text (React segments markup
    // with comment nodes — innerText is the honest read).
    const statusTexts = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-offline-status]')].map((node) => node.textContent ?? ''))()`,
    );
    const joined = (statusTexts ?? []).join(" | ");
    assert.that(
      "the offline entry states its earned ready-offline status (watchable without a connection — the verified truth)",
      "a Ready-offline status label",
      joined || "<none>",
      (statusTexts ?? []).some((status) => status.includes("Ready offline") && status.includes("watchable without a connection")),
    );

    // No section renders an error (typed statuses, all ready).
    await assert.countExactly("[data-wfx-surface='library'] [data-wfx-error]", 0, "no library section renders an error state in this configuration");

    await context.screenshot("j11-library");
    await describe(context, "the library destination rendered watchlist/history/offline-and-verified with honest fresh-session empty states and the verified offline copy exposed");
  },
};
