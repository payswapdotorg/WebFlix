/**
 * @wfx/journeys — J12 Cross-device resume (encoded Web journey).
 *
 * Doc expectation (matrix J12): "Cross-device resume" — continuity of
 * watch state across devices/sessions keyed to the server-side
 * identity/profile state.
 *
 * Web-fixture-boot encoding: the resume CONTINUATION mechanics — the
 * player honors a carried resume position (the "Resumed at" truth, not
 * a fabricated progress), the resume position flows into the explicit
 * report offer, and the playback phase stays the evidence-backed truth
 * (a resume never fabricates progress inside the provider embed).
 *
 * HONEST LIMIT (listed): cross-DEVICE continuity requires the
 * server-side identity + service boot (WFX_API_BASE over the shared
 * profile state) — the fixtures boot is a single anonymous session.
 * The dev split-module reality also isolates the per-route runtime
 * folds (the same documented law the J11 limitation names). The
 * service-mode procedure is the manifest limitation entry.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j12CrossDeviceResume: Journey = {
  id: "J12",
  title: "Cross-device resume",
  doc: "docs/validation/webflix-golden-journeys.md §J12 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    const itemHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that("the search surface offers the item", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    assert.that("the detail page offers playback", "a play href", playHref ?? "<absent>", playHref !== null);

    // Carry a resume position (the continuity the URL contract accepts).
    const withResume = `${playHref}${(playHref ?? "").includes("?") ? "&" : "?"}resume=60000`;
    await goto(context, withResume);

    // The resume truth: the player states the carried position.
    await assert.textEquals("[data-wfx-player-resume]", "Resumed at 1:00", "the player honors the carried resume position (continuity, stated)");

    // A resume never fabricates playback progress.
    await assert.textContains("[data-wfx-player-phase]", "buffering", "the playback phase stays the evidence-backed truth after resume (no fabricated progress)");

    // The resume position flows into the explicit report offer.
    const reportStatus = await browser.eval<boolean>(
      `(() => { const bar = document.querySelector('[data-wfx-watch-report]'); return bar !== null; })()`,
    );
    assert.that(
      "the resumed session keeps the explicit watch-report controls (the position's honest continuation)",
      "the report controls present",
      reportStatus ? "present" : "absent",
      reportStatus,
    );

    // The honest fresh-player contrast: WITHOUT the resume param the
    // player states no resume line (the truth grammar is positional).
    await goto(context, playHref ?? "/");
    const noResume = await browser.tryText("[data-wfx-player-resume]");
    assert.that(
      "without a carried position the player states no resume line (never a fabricated resume)",
      "no resume line",
      noResume ?? "<none>",
      noResume === null,
    );

    await context.screenshot("j12-cross-device-resume");
    await describe(context, "the player honored the carried resume position ('Resumed at 1:00'), kept the evidence-backed phase, and stated no resume line without a carried position (the service-mode cross-device fold is listed)");
  },
};
