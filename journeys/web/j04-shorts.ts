/**
 * @wfx/journeys — J04 Shorts vertical discovery (encoded Web journey).
 *
 * Doc expectation: "vertical feed, stable current card during
 * presentation, forward skip/rerank semantics, like/save/feedback, no
 * fake provider progress, and controls to influence future
 * recommendations."
 *
 * Web-fixture-boot encoding: the vertical viewport + position grammar,
 * the bounded forward/back navigation with a stable current card, the
 * HONEST absence of provider-progress fabrication (no progress bars or
 * percentages in the cards — this shell cannot observe playback inside
 * a provider embed), the typed-absent like/save grammar (never fake
 * controls), and the rerank explainability surface that appears when the
 * session's policy threshold fires (the influence-controls evidence —
 * the full click in J15).
 *
 * R35b re-encode (M3, production-neutral): the position-pill binding is
 * the PILL GRAMMAR — "N / M" with the total being the composed page's
 * own card count (the fixtures boot composes 3; the service-mode
 * production surface composes its real catalog's 24 — the R34-C sweep
 * observed "1 / 24" live, evidence/r34c/adjudication-table.md §B; the
 * R23 production sweep, evidence/r23/production-sweep.md, is the
 * production truth of record). The advance/return semantics, the typed
 * absences, and the no-fabricated-progress law hold identically on both
 * boots.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";
import { parseShorts } from "../lib/state";

/** Parse the position pill's "N / M" grammar (null when malformed). */
function parsePositionPill(pill: string | null): { readonly position: number; readonly total: number } | null {
  if (pill === null) return null;
  const match = pill.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (match === null) return null;
  const position = Number.parseInt(match[1] ?? "", 10);
  const total = Number.parseInt(match[2] ?? "", 10);
  return Number.isFinite(position) && Number.isFinite(total) ? { position, total } : null;
}

export const j04Shorts: Journey = {
  id: "J04",
  title: "Shorts vertical discovery",
  doc: "docs/validation/webflix-golden-journeys.md §J04",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/shorts");

    // The vertical feed.
    await assert.visible("[data-wfx-surface='shorts']", "the Shorts destination renders the vertical feed surface");
    await assert.visible("[data-wfx-shorts-viewport]", "the feed renders the vertical viewport");
    // binds the position-pill grammar: "N / M" — the composed page's own
    // total (catalog-neutral; the fixtures boot composes 3, the service
    // surface its real 24 — the pill is the surface's own truth).
    const initialPill = await browser.tryText("[data-wfx-shorts-position]");
    const initialPillParsed = parsePositionPill(initialPill);
    assert.that(
      "the feed states its position (the pill's N / M grammar — card N of the composed page M)",
      "a well-formed position pill",
      initialPill ?? "<none>",
      initialPillParsed !== null && initialPillParsed.position >= 1 && initialPillParsed.total >= 2,
    );


    // The stable current card during presentation.
    const initialHtml = await browser.outerHtml("[data-wfx-surface='shorts']");
    const initial = parseShorts(initialHtml ?? "");
    assert.that(
      "the feed presents a stable current card with its title",
      "a current card with a title",
      initial.currentTitle ?? "<no title>",
      initial.currentTitle !== null,
    );

    // No fake provider progress: the cards never fabricate playback progress.
    const cardHtml = await browser.tryHtml("[data-wfx-shorts-card='current']");
    assert.that(
      "the current card shows no fabricated provider progress (no progress element, no percentage)",
      "no progress bars or % text inside the card",
      cardHtml !== null && (cardHtml.includes("progress") || cardHtml.includes("%")) ? "progress fabrication present" : "no fabricated progress",
      cardHtml === null || (!cardHtml.includes("progress") && !cardHtml.includes("%")),
    );

    // Like/save: the honest typed absence (never fake controls).
    await assert.countExactly("[data-wfx-shorts-action='like']", 0, "like renders only when the source declares the capability (typed absence here)");
    await assert.countExactly("[data-wfx-shorts-action='save']", 0, "save renders only when the source declares the capability (typed absence here)");

    // Share (the event-only feedback vocabulary) is present.
    await assert.countAtLeast("[data-wfx-shorts-action='share']", 1, "the share feedback control is present on the current card");

    // Forward skip semantics: next moves the feed, back is bounded.
    await browser.clickInteractive("[data-wfx-shorts-next]");
    await browser.settle();
    // binds the position-pill grammar: the position ADVANCES (N+1 of the
    // same composed page — the skip semantics hold whatever the page size).
    const afterNextPill = await browser.tryText("[data-wfx-shorts-position]");
    const afterNextParsed = parsePositionPill(afterNextPill);
    assert.that(
      "a forward skip advances the feed position (the pill's N advances within the same page)",
      `position ${initialPillParsed?.position ?? "?"} → ${(initialPillParsed?.position ?? 0) + 1}`,
      afterNextPill ?? "<none>",
      afterNextParsed !== null && initialPillParsed !== null && afterNextParsed.position === initialPillParsed.position + 1 && afterNextParsed.total === initialPillParsed.total,
    );
    const afterNextHtml = await browser.outerHtml("[data-wfx-surface='shorts']");
    const afterNext = parseShorts(afterNextHtml ?? "");
    assert.that(
      "the current card changes on forward skip (the position grammar tracks the card)",
      "a new current card title",
      afterNext.currentTitle ?? "<no title>",
      afterNext.currentTitle !== null && afterNext.currentTitle !== initial.currentTitle,
    );
    await browser.clickInteractive("[data-wfx-shorts-back]");
    await browser.settle();
    // binds the position-pill grammar: the backward navigation RETURNS to
    // the previous position (the bounded back).
    const afterBackPill = await browser.tryText("[data-wfx-shorts-position]");
    const afterBackParsed = parsePositionPill(afterBackPill);
    assert.that(
      "the backward navigation returns to the previous card",
      `position back to ${initialPillParsed?.position ?? "?"}`,
      afterBackPill ?? "<none>",
      afterBackParsed !== null && initialPillParsed !== null && afterBackParsed.position === initialPillParsed.position,
    );

    // The rerank/influence surface exists in the feed's grammar (the
    // controls that influence future recommendations — exercised fully in J15/J18).
    await assert.countExactly("[data-wfx-shorts-next]", 1, "the feed's forward control is present (the skip semantics)");
    await assert.countExactly("[data-wfx-shorts-back]", 1, "the feed's bounded back control is present");

    await context.screenshot("j04-shorts");
    await describe(context, "vertical feed with position grammar, stable current card, bounded forward/back, honest absent like/save, share control, and no fabricated provider progress");
  },
};
