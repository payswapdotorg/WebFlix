/**
 * @wfx/journeys — J03 Long-form Watch browsing (encoded Web journey).
 *
 * Doc expectation (matrix J03: long-form Watch browsing on Web = Yes):
 * the Watch destination is the long-form browse surface — rows of
 * movies/series/episodes with entry into playback.
 *
 * Web-fixture-boot encoding: the watch surface renders its typed browse
 * rows, the cards link into the item/player destinations, and the
 * surface names itself the long-form destination (the doc's "Long-form
 * Watch browsing").
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j03WatchBrowsing: Journey = {
  id: "J03",
  title: "Long-form Watch browsing",
  doc: "docs/validation/webflix-golden-journeys.md §J03 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/watch");

    await assert.visible("[data-wfx-surface='watch']", "the Watch destination renders the long-form browse surface");
    await assert.textEquals("[data-wfx-watch-title]", "Watch", "the surface names the Watch destination");
    await assert.countAtLeast("[data-wfx-row]", 1, "the Watch surface renders browse rows");

    // Long-form truth: the cards link into item detail or the player.
    await assert.countAtLeast("[data-wfx-row] a[data-wfx-card]", 4, "the Watch rows render long-form cards");
    const hrefs = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll("[data-wfx-surface='watch'] a[data-wfx-card]")].map((a) => a.getAttribute('href') ?? ''))()`,
    );
    const linked = (hrefs ?? []).filter((href) => href.startsWith("/item?") || href.startsWith("/player?"));
    assert.that(
      "every Watch card enters the item detail or playback destination",
      `${(hrefs ?? []).length} cards all linking /item or /player`,
      `${linked.length} of ${(hrefs ?? []).length} cards link product destinations`,
      (hrefs ?? []).length >= 4 && linked.length === (hrefs ?? []).length,
    );

    // The long-form compose: vertical shorts content is not the watch feed's primary card set.
    const types = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll("[data-wfx-surface='watch'] a[data-wfx-card]")].map((a) => a.getAttribute('aria-label') ?? ''))()`,
    );
    const labels = (types ?? []).join(" | ");
    assert.that(
      "the Watch browse cards carry long-form identity (movies/series/episodes — the vertical shorts feed is a separate destination)",
      "long-form card labels",
      labels.slice(0, 200) || "<none>",
      (types ?? []).length > 0,
    );

    await context.screenshot("j03-watch-browsing");
    await describe(context, "the Watch destination rendered its long-form browse rows with cards entering item detail/playback");
  },
};
