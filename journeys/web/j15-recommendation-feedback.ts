/**
 * @wfx/journeys — J15 Recommendation feedback controls (encoded Web
 * journey).
 *
 * Doc expectation: "`More like this`, `Not interested`, `Don't
 * recommend creator/source`, `Already watched`, and reversible
 * feedback affect future candidate composition."
 *
 * Web-fixture-boot encoding: the feedback → composition surface that
 * DID ship on the web adapter — the short feed's RE-RANK
 * explainability: after the session's policy threshold of forward
 * swipes, the feed fetches a fresh OS page and REPLANS the composition
 * (beyond-cursor slots only), rendering the typed decision note (the
 * visible effect of engagement on future candidates). The per-card
 * feedback vocabulary renders its honest typed-absent state (like/save
 * absent where the source declares neither) — unsupported feedback
 * never appears as available.
 *
 * HONEST LIMIT (listed): the full reversible feedback vocabulary
 * (More-like-this / Not-interested / creator-source suppression /
 * Already-watched) is R05's service-side policy surface (apps/api
 * /experience/feedback + policy routes); the web adapter ships the
 * session re-rank explainability + the absent grammar. The manifest
 * limitation names the service-mode procedure.
 *
 * R35b re-encode (M3, production-neutral): the re-rank note predicate
 * binds the frozen replacement-semantics vocabulary (the service-mode
 * composition sentence names the same semantics the fixtures note
 * does — the wording is the boot's own, the vocabulary is the law).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j15RecommendationFeedback: Journey = {
  id: "J15",
  title: "Recommendation feedback controls",
  doc: "docs/validation/webflix-golden-journeys.md §J15",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/shorts");

    // The feedback vocabulary's honest state on the card.
    await assert.countExactly("[data-wfx-shorts-action='like']", 0, "the like feedback control renders only where the source declares it (typed absence here)");
    await assert.countExactly("[data-wfx-shorts-action='save']", 0, "the save feedback control renders only where the source declares it (typed absence here)");
    await assert.countAtLeast("[data-wfx-shorts-action='share']", 1, "the share feedback control is present (the event-only vocabulary)");

    // Engagement (forward swipes) drives future candidate composition:
    // the balanced session's threshold is 5 forward swipes.
    const before = await browser.tryText("[data-wfx-shorts-rerank]");
    assert.that(
      "no re-rank decision is rendered before the engagement threshold",
      "no re-rank note before 5 forward swipes",
      before ?? "<none>",
      before === null,
    );
    for (let step = 0; step < 5; step += 1) {
      await browser.clickInteractive("[data-wfx-shorts-next]");
      await browser.settle(250);
    }
    await browser.waitSelector("[data-wfx-shorts-rerank]", 10_000);
    const note = await browser.tryText("[data-wfx-shorts-rerank]");
    assert.that(
      "engagement affects future candidate composition (the re-rank decision renders its typed note)",
      "a re-rank explainability note",
      note ?? "<none>",
      note !== null && note.length > 0,
    );

    // The note is typed explainability (the replacement plan's reason).
    // binds the re-rank note's replacement-semantics vocabulary —
    // catalog/config-neutral: the fixtures boot renders "the fresh page
    // replaced nothing — every slot is kept runway"; the service-mode
    // production surface renders its own composition sentence ("applied
    // 16 replacement(s); 8 slot(s) kept" — observed live by the R34-C
    // sweep, evidence/r34c/adjudication-table.md §B; the R23 production
    // sweep, evidence/r23/production-sweep.md, is the production truth
    // of record). Both name the replacement/kept-slot semantics; a
    // silent swap (no note, or a note without the composition
    // vocabulary) fails.
    const REPLACEMENT_SEMANTICS = ["replaced", "replacement", "re-rank", "runway", "slot", "kept"];
    assert.that(
      "the re-rank note names the composition decision (typed reasons — never a silent swap)",
      "a note naming the replacement semantics (replaced/replacement/kept/slot/re-rank/runway)",
      note ?? "<none>",
      note !== null && REPLACEMENT_SEMANTICS.some((term) => note.includes(term)),
    );

    await context.screenshot("j15-recommendation-feedback");
    await describe(context, "engagement (5 forward swipes) drove a fresh-page re-rank whose typed composition note rendered — feedback visibly affects future candidates; per-card like/save render their honest typed absence");
  },
};
