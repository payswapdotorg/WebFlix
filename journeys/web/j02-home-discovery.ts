/**
 * @wfx/journeys — J02 Home discovery (encoded Web journey).
 *
 * Doc expectation: "hero, Continue Watching when applicable,
 * personalized/discovery rows, Shorts entry, source-neutral cards, and
 * a direct way to state current intent."
 *
 * Web-fixture-boot encoding: the start hero (fresh session — no resume
 * entry yet, and Continue Watching is HONESTLY absent rather than
 * fabricated), the For-you + Trending rows, the Shorts rail with its
 * feed entry, source-neutral cards (title/type identity — no source
 * branding on cards), and the search box as the direct intent entry.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j02HomeDiscovery: Journey = {
  id: "J02",
  title: "Home discovery / hero / rows / intent entry",
  doc: "docs/validation/webflix-golden-journeys.md §J02",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/");

    // Hero (fresh session: the START hero — the featured card).
    await assert.attrEquals("[data-wfx-hero]", "data-wfx-hero", "start", "the hero renders the featured start card on a fresh session");
    await assert.visible("[data-wfx-hero-play]", "the hero offers the direct play action");
    await assert.countAtLeast("[data-wfx-hero-title]", 1, "the hero names its title");

    // Continue Watching: honest absence on a fresh session (never a fabricated row).
    await assert.countExactly("[data-wfx-row='continue']", 0, "Continue Watching is honestly absent on a fresh session (no fabricated resume entries)");

    // Personalized/discovery rows.
    const rowIds = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-row]')].map((row) => row.getAttribute('data-wfx-row')) )()`,
    );
    assert.that("the home renders discovery rows", "rows including the personalized feed", (rowIds ?? []).join(", ") || "<none>", (rowIds ?? []).length >= 2);
    assert.that(
      "the personalized (For you) row is present",
      "a 'for you' row id",
      (rowIds ?? []).join(", ") || "<none>",
      (rowIds ?? []).some((id) => id.includes("for-you")),
    );

    // Shorts entry: the dedicated rail + the feed link.
    await assert.visible("[data-wfx-row='shorts']", "the home renders the Shorts rail");
    await assert.countAtLeast("[data-wfx-row='shorts'] a[href='/shorts']", 1, "the Shorts rail links into the vertical feed");

    // Source-neutral cards: identity + type, no source branding.
    await assert.countAtLeast("a[data-wfx-card]", 5, "the home feed renders browse cards");
    const cardCount = await browser.count("a[data-wfx-card]");
    const titledCards = await browser.count("[data-wfx-card-title]");
    assert.that(
      "every browse card carries a canonical title (source-neutral identity)",
      `${cardCount} cards each with a title`,
      `${titledCards} titled cards of ${cardCount}`,
      cardCount === titledCards && cardCount > 0,
    );
    // R24 (the parity lab's correction): cards MAY carry the compact
    // secondary source chip (data-wfx-card-source — the design
    // language's "source/provenance labels are compact" + the R24-C
    // source-aware cards pairing); source BRANDING (the source's name
    // in the card's PRIMARY identity — the title line's markup) stays
    // forbidden (the source identity is secondary to the canonical
    // item, the frozen law's intent).
    const titleLine = await browser.tryHtml("[data-wfx-card-title]");
    assert.that(
      "cards keep the source identity SECONDARY (no source branding in the canonical title; the compact provenance chip is the R24-C pairing)",
      "the title line carries no connector identity (the chip may render below it)",
      titleLine !== null && titleLine.includes("fake-source")
        ? "connector id present in the title line"
        : "no source branding in the primary identity",
      titleLine === null || !titleLine.includes("fake-source"),
    );

    // The direct intent entry: the persistent search box.
    await assert.countAtLeast("[role='search'] input", 1, "the shell exposes the direct intent entry (the search box)");
    await assert.countAtLeast("form[action='/search']", 1, "the intent entry submits to the unified search surface");

    await context.screenshot("j02-home-discovery");
    await describe(context, "hero + For-you/Trending rows + Shorts rail + source-neutral cards + the search intent entry; Continue Watching honestly absent on a fresh session");
  },
};
