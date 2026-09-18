/**
 * @wfx/journeys — J18 Attention modes: mindful / balanced / immersive /
 * custom (encoded Web journey).
 *
 * Doc expectation: "selected attention mode changes policy behavior;
 * the system does not silently optimize for maximum time spent when
 * the user selected another mode."
 *
 * Web-fixture-boot encoding: the attention mode's OBSERVABLE POLICY
 * BEHAVIOR on the shipped surface — the session's balanced default
 * re-ranks the short feed after exactly 5 forward swipes (the frozen
 * BALANCED threshold in the session-ranking policy), demonstrably
 * NOT before (4 swipes → no re-rank). The mode is policy, not cosmetic:
 * the threshold drives the composition refresh. The evidence line
 * renders the typed decision note.
 *
 * HONEST LIMIT (listed): SWITCHING attention modes (mindful=3 /
 * immersive=none / custom) is the service-side policy submission
 * (apps/api /experience/policy — R05); the web session boots the
 * balanced default and renders its behavior. The manifest limitation
 * names the procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** The balanced mode's frozen forward-swipe threshold (session-ranking policy). */
const BALANCED_RERANK_SWIPE_THRESHOLD = 5;

export const j18AttentionModes: Journey = {
  id: "J18",
  title: "Attention modes: mindful / balanced / immersive / custom",
  doc: "docs/validation/webflix-golden-journeys.md §J18",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/shorts");

    // Below the threshold: the policy has NOT re-ranked (no silent
    // optimization — the mode's behavior is exactly its threshold).
    for (let step = 0; step < BALANCED_RERANK_SWIPE_THRESHOLD - 1; step += 1) {
      await browser.clickInteractive("[data-wfx-shorts-next]");
      await browser.settle(250);
    }
    const below = await browser.tryText("[data-wfx-shorts-rerank]");
    assert.that(
      "the balanced policy does NOT re-rank below its threshold (5th swipe) — the mode's behavior is its policy, not silent optimization",
      "no re-rank note after 4 forward swipes",
      below ?? "<none>",
      below === null,
    );

    // At the threshold: the policy fires (behavior changed by the mode).
    await browser.clickInteractive("[data-wfx-shorts-next]");
    await browser.waitSelector("[data-wfx-shorts-rerank]", 10_000);
    const at = await browser.tryText("[data-wfx-shorts-rerank]");
    assert.that(
      "the balanced policy re-ranks at its threshold (the attention mode's policy behavior is observable)",
      "a re-rank decision note at the 5th forward swipe",
      at ?? "<none>",
      at !== null && at.length > 0,
    );

    // The feed's presentation state stays truthful through the policy fire.
    await assert.visible("[data-wfx-shorts-card='current']", "the current card remains stably presented through the policy re-rank");
    const position = await browser.tryText("[data-wfx-shorts-position]");
    assert.that(
      "the feed's position grammar remains truthful after the policy behavior",
      "a position label",
      position ?? "<none>",
      position !== null && position.includes("/"),
    );

    await context.screenshot("j18-attention-modes");
    await describe(context, "the balanced attention mode's re-rank threshold behaved exactly as policy (no re-rank at 4 swipes, re-rank at 5) with the presentation staying truthful (mode switching is the service-side submission — listed)");
  },
};
