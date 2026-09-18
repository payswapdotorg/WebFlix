/**
 * @wfx/journeys — J20 AI subtitles / translation / transcription /
 * dubbing / commentary (encoded Web journey).
 *
 * Doc expectation (matrix J20): the AI media transformation operations
 * with explicit states.
 *
 * Web-fixture-boot encoding: the same honest-absence law as J19 — the
 * AI transformation operations (transcription, subtitles, translation,
 * dubbing, commentary) are the R06 service-side surface with explicit
 * operation states; the web fixtures boot renders NO transformation
 * controls and NO fabricated operation progress (an operation that
 * cannot run here never looks available or in-flight).
 *
 * HONEST LIMIT (listed): the explicit transcription/subtitle/translation/
 * dubbing/commentary operation states (progress + results) are the
 * service-side transforms surface (apps/api /experience/transforms);
 * the manifest limitation names the local procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j20AiTransforms: Journey = {
  id: "J20",
  title: "AI subtitles / translation / transcription / dubbing / commentary",
  doc: "docs/validation/webflix-golden-journeys.md §J20 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings?section=model");

    // The transformation scope is named in the honest-absent state.
    await assert.visible("[data-wfx-settings-model]", "the Model & AI section renders (the AI transformation surface's web state)");
    const text = await browser.tryText("[data-wfx-settings-model]");
    for (const term of ["transcription", "subtitles", "translation", "dubbing", "commentary"]) {
      assert.that(
        `the absent state names the '${term}' transformation (the scope is stated, never hidden)`,
        `the section text mentions ${term}`,
        (text ?? "").includes(term) ? "named" : "not named",
        (text ?? "").includes(term),
      );
    }

    // No transformation operation renders as available or in-flight.
    const html = await browser.tryHtml("[data-wfx-settings-model]");
    assert.that(
      "no AI transformation operation renders as available, running, or complete in this configuration (explicit states only where the operation can run)",
      "no transformation progress/controls",
      html !== null && (html.includes("Transcribing") || html.includes("in progress") || html.includes("<progress")) ? "operation state present" : "no operation state",
      html === null || (!html.includes("Transcribing") && !html.includes("in progress") && !html.includes("<progress")),
    );
    const controls = await browser.eval<number>(
      `(() => { const section = document.querySelector('[data-wfx-settings-model]'); return section === null ? 0 : section.querySelectorAll('button').length; })()`,
    );
    assert.that(
      "no transformation action buttons render (never a control that implies a runnable operation)",
      "zero transformation buttons",
      `${controls} buttons`,
      controls === 0,
    );

    // The playback surfaces carry no fabricated AI overlays either.
    await goto(context, "/player");
    const playerText = await browser.tryText("[data-wfx-surface='player']");
    assert.that(
      "the player surface offers no fabricated AI transformation affordances in this configuration",
      "no AI transform offers on the player",
      playerText !== null && /generate subtitles|translate|transcribe/i.test(playerText) ? "AI affordances present" : "no AI affordances",
      playerText === null || !/generate subtitles|translate|transcribe/i.test(playerText),
    );

    await context.screenshot("j20-ai-transforms");
    await describe(context, "the transformation vocabulary was named in the honest-absent state with zero fabricated operation states or controls anywhere (the transforms surface is the service-side local-only procedure — listed)");
  },
};
