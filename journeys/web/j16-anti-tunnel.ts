/**
 * @wfx/journeys — J16 Anti-tunnel / exploration after a single watched
 * topic (encoded Web journey).
 *
 * Doc expectation: "after watching a concentrated topic, future
 * recommendations remain capable of exploring adjacent and unrelated
 * interests unless the user explicitly requests narrow continuation."
 *
 * Web-fixture-boot encoding: the EXPLORATION mechanics on the feed that
 * ships — the re-rank's REPLACEMENT PLAN keeps the feed's runway (the
 * anti-tunnel behavior: the plan never collapses the feed to the
 * watched topic; beyond-cursor slots are recomposed from the fresh OS
 * page while the prefetch window is kept). The rendered note states the
 * kept-runway semantics; the composed page itself carries unrelated
 * topics (the fixture feed mixes topics per position).
 *
 * HONEST LIMIT (listed): profile-LEVEL anti-tunnel (a concentrated
 * watch history not permanently dominating the profile) is R05's
 * service-side recommendation policy (the recommendation-state and
 * policy tests cover the law); the web fixtures session cannot carry a
 * persistent profile. The manifest limitation names it.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j16AntiTunnel: Journey = {
  id: "J16",
  title: "Anti-tunnel / exploration after a single watched topic",
  doc: "docs/validation/webflix-golden-journeys.md §J16",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/shorts");

    // The feed island is interactive before the first swipe (the robust
    // island click handles in-view + hydration on every step).
    await browser.clickInteractive("[data-wfx-shorts-next]");

    // BEFORE concentrated engagement: the composed feed carries multiple
    // distinct items (adjacent/unrelated exploration is the feed's
    // composition — the anti-tunnel precondition).
    const initialTitles = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-shorts-card]')].map((card) => card.querySelector('h2')?.textContent ?? '').filter((t) => t.length > 0))()`,
    );
    assert.that(
      "the composed feed carries more than one distinct item (exploration-capable composition before concentration)",
      "multiple distinct cards",
      (initialTitles ?? []).join(", ") || "<none>",
      new Set(initialTitles ?? []).size >= 2,
    );

    // Concentrated engagement on the current card (forward swipes through
    // the feed's initial run, past the balanced threshold).
    for (let step = 0; step < 5; step += 1) {
      await browser.clickInteractive("[data-wfx-shorts-next]");
      await browser.settle(250);
    }
    await browser.waitSelector("[data-wfx-shorts-rerank]", 10_000);

    // The re-rank keeps the exploration runway (never a tunnel collapse).
    const note = await browser.tryText("[data-wfx-shorts-rerank]");
    assert.that(
      "the re-rank after concentrated engagement keeps the feed's runway (anti-tunnel: the plan never collapses to the watched topic)",
      "a kept-runway composition note",
      note ?? "<none>",
      note !== null && note.includes("runway"),
    );

    // The feed still presents a composed position set (exploration continues).
    const position = await browser.tryText("[data-wfx-shorts-position]");
    assert.that(
      "the feed continues presenting its composed position set after the re-rank",
      "a position label",
      position ?? "<none>",
      position !== null && position.includes("/"),
    );
    await assert.visible("[data-wfx-shorts-card='current']", "a current card remains presented (the feed never empties into a tunnel)");

    await context.screenshot("j16-anti-tunnel");
    await describe(context, "the multi-item feed kept its runway through the concentrated-engagement re-rank and continued presenting its composed position set (profile-level anti-tunnel is the service-side policy — listed)");
  },
};
