/**
 * @wfx/journeys — J31 Cross-platform Web/Desktop parity (encoded Web
 * journey — the WEB-SIDE anchor set).
 *
 * Doc expectation: "The same server-side profile state, library state,
 * intent, and Entertainment Item identity must produce semantically
 * equivalent Web and Desktop outcomes while allowing platform-specific
 * capability differences."
 *
 * Web-fixture-boot encoding: the WEB-SIDE parity anchors — the four
 * parity surfaces render their canonical state on the Web adapter:
 * (1) Entertainment Item identity: the same canonical id resolves
 * across surfaces (search card → detail → player all carry ONE
 * wfxitm_ identity); (2) library state: the typed library sections;
 * (3) intent: the session's stated intent composes the search surface;
 * (4) profile state: the honest anonymous session. The DESKTOP-side
 * comparison is the lead's parity procedure (the manifest limitation
 * entry names it — never silently skipped).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j31CrossPlatformParity: Journey = {
  id: "J31",
  title: "Cross-platform Web/Desktop parity (web-side anchors)",
  doc: "docs/validation/webflix-golden-journeys.md §J31",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // (1) Entertainment Item identity: ONE canonical id across surfaces.
    const itemHref = await itemHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    assert.that("the search surface anchors the canonical item", "an item link", itemHref ?? "<absent>", itemHref !== null);
    const searchId = (itemHref ?? "").match(/id=(wfxitm_[A-Z0-9]+)/)?.[1] ?? null;
    await goto(context, itemHref ?? "/");
    const detailId = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-surface=\"item\"]')?.getAttribute('data-wfx-item') ?? null`,
    );
    assert.that(
      "the item detail surface carries the SAME canonical identity the search card linked",
      `the detail carries ${searchId}`,
      detailId ?? "<none>",
      searchId !== null && detailId === searchId,
    );
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    const playId = (playHref ?? "").match(/id=(wfxitm_[A-Z0-9]+)/)?.[1] ?? null;
    assert.that(
      "the player entry carries the SAME canonical identity (one item identity across all three surfaces)",
      `the play link carries ${searchId}`,
      playId ?? "<none>",
      searchId !== null && playId === searchId,
    );

    // (2) Library state: the typed sections render (the parity anchor).
    await goto(context, "/library");
    await assert.visible("[data-wfx-library-watchlist]", "the library watchlist section renders (the library-state parity anchor)");
    await assert.visible("[data-wfx-library-history]", "the library history section renders (the library-state parity anchor)");
    await assert.visible("[data-wfx-library-offline]", "the library offline-and-verified section renders (the library-state parity anchor)");

    // (3) Intent: the session's stated intent composes the search outcome.
    await goto(context, "/search?q=rain");
    await assert.countAtLeast("[data-wfx-search-results] a[data-wfx-card]", 3, "the stated intent composes its outcome (the intent parity anchor)");

    // (4) Profile state: the honest anonymous session renders.
    await goto(context, "/settings");
    await assert.textContains("[data-wfx-session-label]", "Signed out", "the profile/session state renders its honest anonymous truth (the profile-state parity anchor)");

    // Platform-specific capability differences are ALLOWED (the parity
    // law's second clause): the web's native-media truth differs from the
    // desktop's — stated, not hidden.
    await assert.countAtLeast("[data-wfx-capability-unsupported]", 1, "platform-specific capability differences are stated (allowed by the parity law, never hidden)");

    await context.screenshot("j31-cross-platform-parity");
    await describe(context, "the web-side parity anchors rendered: one canonical item identity across search/detail/player, the typed library sections, the intent composition, and the honest session state (the desktop-side comparison is the lead's parity procedure — listed)");
  },
};
