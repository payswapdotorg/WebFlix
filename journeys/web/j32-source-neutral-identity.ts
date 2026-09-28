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
 *
 * R35b re-encode: the canonical-link grammar is the R28-B ONE-CLICK /player
 * href (id-first — the canonical identity rides the player URL); the
 * item's realization capability truth is read on the ITEM hub (the card
 * kebab's Details deep path); the precedence walk runs on the player
 * reached through the item's own play link; the search join is read from
 * the /player hrefs' id params.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";
import { parsePlayer } from "../lib/state";

export const j32SourceNeutralIdentity: Journey = {
  id: "J32",
  title: "Source-neutral identity: same item, multiple realizations",
  doc: "docs/validation/webflix-golden-journeys.md §J32 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // The canonical identity is what links carry (source-neutral).
    // binds R28-B one-click play + the deep surface: the search card's
    // id-first /player href carries the canonical identity; the card
    // kebab's Details link carries the /item deep path.
    await goto(context, `/search?q=${encodeURIComponent("Asteroid")}`);
    const cardAndDetail = await browser.eval<{ readonly card: string | null; readonly detail: string | null }>(
      `(() => { const card = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith('Asteroid Drift')); if (card === undefined) return { card: null, detail: null }; const wrap = card.closest('[data-wfx-cardwrap]') ?? card.parentElement; const details = wrap === null ? null : wrap.querySelector('details[data-wfx-card-actions]'); return { card: card.getAttribute('href'), detail: details === null ? null : (details.querySelector('[data-wfx-card-details]')?.getAttribute('href') ?? null) }; })()`,
    );
    assert.that(
      "the search card links the CANONICAL identity (the id-first one-click play path — never source-first)",
      "a /player?id=wfxitm_… link",
      cardAndDetail?.card ?? "<absent>",
      (cardAndDetail?.card ?? "").startsWith("/player?id=wfxitm_"),
    );
    assert.that(
      "the search card carries the Details deep path to the canonical item hub",
      "an /item?id=wfxitm_… link",
      cardAndDetail?.detail ?? "<absent>",
      (cardAndDetail?.detail ?? "").startsWith("/item?id=wfxitm_"),
    );
    await goto(context, cardAndDetail?.detail ?? "/");
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
    // binds the item hub's play decision: [data-wfx-item-play] → the player.
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    assert.that(
      "the item hub's play link carries the SAME canonical identity (the player entry — the R28-B grammar)",
      "a /player?id=wfxitm_… play link",
      playHref ?? "<absent>",
      (playHref ?? "").startsWith("/player?id=wfxitm_"),
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
    // binds R28-B one-click play: the id params of the /player hrefs.
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
