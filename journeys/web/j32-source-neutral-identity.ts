/**
 * @wfx/journeys — J32 Source-neutral identity: same item, multiple
 * realizations (encoded Web journey).
 *
 * Doc expectation (matrix J32): the canonical item identity is primary;
 * a source's realizations are secondary play paths.
 *
 * Web-fixture-boot encoding: the multi-realization item (Asteroid
 * Drift) — the item detail lists the realizations' capability truth
 * (native/embed/browser/external as "what this source can do"), and
 * the player's precedence trace walks the SAME canonical item's four
 * realizations in frozen precedence order (the visible proof that one
 * identity carries many realizations and the surface resolver picks
 * per device truth). The search surface joins sources to canonical
 * cards (identity-first).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";
import { parsePlayer } from "../lib/state";

export const j32SourceNeutralIdentity: Journey = {
  id: "J32",
  title: "Source-neutral identity: same item, multiple realizations",
  doc: "docs/validation/webflix-golden-journeys.md §J32 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // The canonical identity is what links carry (source-neutral).
    const itemHref = await itemHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    assert.that("the search card links the CANONICAL identity (id-first, not source-first)", "an /item?id=wfxitm_… link", itemHref ?? "<absent>", (itemHref ?? "").startsWith("/item?id=wfxitm_"));
    await goto(context, itemHref ?? "/");
    await assert.textEquals("[data-wfx-item-title]", "Asteroid Drift", "the canonical item renders one identity");

    // The realization capability truth: one item, MANY play paths.
    const capabilities = await browser.tryText("[data-wfx-item-capabilities]");
    for (const mode of ["Native playback", "Embedded playback", "Web player", "External handoff"]) {
      assert.that(
        `the item declares the '${mode}' realization (multiple realizations of one canonical item)`,
        `the capability list includes ${mode}`,
        capabilities ?? "<none>",
        (capabilities ?? "").includes(mode),
      );
    }

    // The player walks the same item's realizations in precedence order.
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    await goto(context, playHref ?? "/");
    const html = await browser.outerHtml("[data-wfx-surface='player']");
    const player = parsePlayer(html ?? "");
    assert.that(
      "the player's precedence trace walks the SAME item's realizations (native, embed, browser, external — one identity, many paths)",
      "all four rungs in the trace",
      player.precedenceLines.join(" | ").slice(0, 260),
      player.precedenceLines.length === 4,
    );
    assert.that(
      "the chosen realization is named with its source identity (realization metadata is secondary but present)",
      "the accepted line names the realization",
      player.precedenceLines.join(" | ").slice(0, 260),
      player.precedenceLines.some((line) => line.includes("realization #") && line.includes("fake-source")),
    );

    // The search surface joins by canonical identity across types.
    await goto(context, "/search?q=rain");
    const cardIds = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-search-results] a[data-wfx-card]')].map((a) => (a.getAttribute('href') ?? '').match(/id=(wfxitm_[A-Z0-9]+)/)?.[1] ?? ''))()`,
    );
    assert.that(
      "every search card carries a distinct canonical identity (the join is identity-keyed, not source-keyed)",
      "3 distinct canonical ids",
      (cardIds ?? []).join(", "),
      new Set(cardIds ?? []).size === 3,
    );

    await context.screenshot("j32-source-neutral-identity");
    await describe(context, "one canonical identity carried its four realizations through the detail capability truth and the player's precedence walk; the search join was identity-keyed across types");
  },
};
