/**
 * @wfx/journeys — J11 Library / watchlist / history (encoded Web journey).
 *
 * Doc expectation (matrix J11): the library destination — watchlist +
 * history (+ the R14 offline-and-verified section).
 *
 * Web-fixture-boot encoding: the library destination renders all three
 * sections with typed statuses; the fresh-session WATCHLIST is honestly
 * empty (the typed empty state with guidance, never fabricated entries);
 * the HISTORY carries this run's earlier engagement events — J10's
 * explicit watch report ("Marked as watched") and the playback/engagement
 * events of J04/J07/J09 — because the /api/events fold now CROSSES pages
 * in the dev boot (R22-G fixed the Turbopack module-graph split: the web
 * host's process state is shared, so the route's fold and the pages'
 * reads observe ONE runtime — the same single-bundle truth production
 * always had). The history is therefore the HONEST session fold, never
 * fabricated: the J10-watched item renders with its watched state.
 *
 * HONEST LIMIT (listed): cross-DEVICE history continuity (the same profile
 * on another device/browser) remains the service-mode procedure (the
 * server-side profile store); the dev-boot fold is one session's truth.
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

    // Fresh-session honest empty state for the WATCHLIST (typed, with guidance).
    const html = await browser.outerHtml("[data-wfx-surface='library']");
    const library = parseLibrary(html ?? "");
    assert.that(
      "the watchlist is honestly empty on a fresh session (typed empty state, never fabricated saves)",
      "the typed watchlist empty state",
      library.watchlistEmpty ? "the empty state rendered" : "entries present or no empty state",
      library.watchlistEmpty,
    );
    await assert.textContains("[data-wfx-library-watchlist]", "Nothing saved yet", "the watchlist empty state guides the user to save from details pages");
    // The HISTORY is the session's honest event fold (R22-G: the dev-boot
    // fold crosses pages now) — the earlier journeys' real engagement
    // events render: at minimum J10's explicit watch report (the
    // WebFlix-confirmed "watched" state, never a fabricated entry).
    const historyText = (await browser.tryText("[data-wfx-library-history]")) ?? "";
    assert.that(
      "the history carries this session's engagement events (the events fold crosses pages in the dev boot — the R22-G fix)",
      "at least one history entry rendering",
      historyText.length > 0 ? `${historyText.length} chars of history truth` : "<empty>",
      !library.historyEmpty,
    );
    assert.that(
      "the history includes J10's explicitly-reported watch (the WebFlix-confirmed fold, stated — never fabricated)",
      "the Asteroid Drift history entry with its watched state",
      historyText.includes("Asteroid Drift") ? "the watched entry renders" : "Asteroid Drift absent from the history",
      historyText.includes("Asteroid Drift"),
    );

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
    await describe(context, "the library destination rendered watchlist/history/offline-and-verified: the watchlist honestly empty, the history carrying the session's real engagement fold (J10's watched entry — the R22-G dev-boot fold fix), and the verified offline copy exposed");
  },
};
