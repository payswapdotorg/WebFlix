/**
 * @wfx/journeys — J09 External playback fallback / return context
 * (encoded Web journey).
 *
 * Doc expectation (matrix J09): "External playback fallback / return
 * context" — when contained playback is not possible the handoff is
 * visible with its return context.
 *
 * Web-fixture-boot encoding: the fallback DECISION is inspectable — the
 * precedence trace names every rung (native/embed/browser/external)
 * with its accept/reject reason, the honest typed error state renders
 * when a link names no playable content (missing-params — never a fake
 * stage), and the unresolvable-realization failure is a typed error
 * with a path back to the detail page (the return context's shape).
 *
 * HONEST LIMIT (listed in the manifest, never silent): the
 * external-rung WIN (the visible handoff with its return-context link)
 * requires an item whose only realization is external — the fixture
 * catalog carries none (every item resolves embed or browser). The
 * service-mode configuration (a source with an external-only
 * realization) exercises it; the procedure is the manifest limitation
 * entry.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch, playerHrefFromItem } from "../lib/journeys";
import { parsePlayer } from "../lib/state";

export const j09ExternalFallback: Journey = {
  id: "J09",
  title: "External playback fallback / return context",
  doc: "docs/validation/webflix-golden-journeys.md §J09 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    // The fallback decision surface on a contained-mode item.
    const itemHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that("the search surface offers the multi-realization item", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");
    const playHref = await playerHrefFromItem(context);
    await goto(context, playHref ?? "/");

    const html = await browser.outerHtml("[data-wfx-surface='player']");
    const player = parsePlayer(html ?? "");

    // The precedence trace: every rung named, in frozen order.
    await assert.countExactly("[data-wfx-precedence-trace]", 1, "the player renders the Media Surface precedence trace (the fallback decision surface)");
    const trace = player.precedenceLines.join(" | ");
    assert.that(
      "the trace names the native rung with its reject reason",
      "a native: line",
      trace.slice(0, 240),
      player.precedenceLines.some((line) => line.startsWith("native:")),
    );
    assert.that(
      "the trace names the embed rung decision",
      "an embed: line",
      trace.slice(0, 240),
      player.precedenceLines.some((line) => line.startsWith("embed:")),
    );
    assert.that(
      "the trace names the browser rung decision",
      "a browser: line",
      trace.slice(0, 240),
      player.precedenceLines.some((line) => line.startsWith("browser:")),
    );
    assert.that(
      "the trace names the external rung decision (the fallback path is always inspectable)",
      "an external: line",
      trace.slice(0, 240),
      player.precedenceLines.some((line) => line.startsWith("external:")),
    );
    assert.that(
      "the accepted rung states its decision",
      "an accepted line for the browser rung",
      trace.slice(0, 240),
      player.precedenceLines.some((line) => line.includes("browser: accepted")),
    );

    // The honest typed error when a link names no playable content.
    await goto(context, "/player");
    await assert.countAtLeast("[data-wfx-empty]", 1, "a link without playable content renders the honest typed empty state (never a fake stage)");
    await assert.textContains("[data-wfx-surface='player']", "Nothing to play", "the missing-params state names the problem truthfully");
    await assert.countAtLeast("[data-wfx-surface='player'] a[href='/']", 1, "the honest error offers the way back (return context to home)");

    // The unresolvable realization: a typed failure with a path back.
    await goto(
      context,
      "/player?id=wfxitm_00000000000000000000000099&connector=fake-source&ref=fake%3Aunknown&title=Unknown+Item&type=video",
    );
    await assert.countAtLeast("[data-wfx-error]", 1, "an unresolvable realization renders the typed playback failure (never a silent success)");
    await assert.textContains("[data-wfx-surface='player']", "Playback could not start", "the failure state names the playback failure");
    const detailLink = await browser.eval<boolean>(
      `(() => { const link = document.querySelector("[data-wfx-surface='player'] a[href*='/item?']"); return link !== null; })()`,
    );
    assert.that(
      "the failure state offers the return context back to the item detail",
      "a link back to the item",
      detailLink ? "present" : "absent",
      detailLink,
    );

    await context.screenshot("j09-external-fallback");
    await describe(context, "the precedence trace names every rung with its decision; the missing-params and unresolvable-realization states render typed honest errors with return paths (the external-rung win itself needs the service-mode external-only realization — listed)");
  },
};
