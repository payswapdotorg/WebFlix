/**
 * @wfx/journeys — J19 WebFlix model / BYOM / local model policy (encoded
 * Web journey).
 *
 * Doc expectation (matrix J19): the model policy controls on Web.
 *
 * Web-fixture-boot encoding: the HONEST-ABSENCE law — the web adapter's
 * Model & AI section renders the typed absent state for the model
 * controls (they are the R06 service-side surface), and NEVER renders
 * placeholder model controls that would imply capability the web
 * fixtures boot does not have (invariant 10: a fixture is never
 * silently presented as production capability).
 *
 * HONEST LIMIT (listed): the WebFlix-model / BYOM / local-model policy
 * with privacy/cost/fallback constraints is R06's service surface
 * (apps/api /experience/model-policy, /model-providers, BYOM routes);
 * the manifest limitation names the local procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j19ModelPolicy: Journey = {
  id: "J19",
  title: "WebFlix model / BYOM / local model policy",
  doc: "docs/validation/webflix-golden-journeys.md §J19 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings?section=model");

    await assert.visible("[data-wfx-settings-model]", "the Model & AI section renders");
    await assert.visible("[data-wfx-model-empty]", "the model section renders its typed honest-absent state (the controls are the service-side lane)");

    // The honest-absent state explains what arrives and where.
    const text = await browser.tryText("[data-wfx-settings-model]");
    assert.that(
      "the model section names the model lane's scope (selection, BYOM, local policy, privacy/cost)",
      "the scope named in the absent state",
      text ?? "<none>",
      text !== null && text.includes("BYOM"),
    );

    // No placeholder model controls (never fake capability).
    const buttons = await browser.eval<number>(
      `(() => { const section = document.querySelector('[data-wfx-settings-model]'); return section === null ? 0 : section.querySelectorAll('button, select, input').length; })()`,
    );
    assert.that(
      "no placeholder model controls render (a fixture is never presented as capability)",
      "zero interactive model controls",
      `${buttons} interactive controls`,
      buttons === 0,
    );

    // No fabricated model state (no selected-model lies).
    const html = await browser.tryHtml("[data-wfx-settings-model]");
    assert.that(
      "no fabricated selected-model or provider state renders",
      "no model/provider status chips",
      html !== null && (html.includes("data-wfx-action-state") || /selected model/i.test(html)) ? "model state chips present" : "no model state chips",
      html === null || (!html.includes("data-wfx-action-state") && !/selected model/i.test(html)),
    );

    await context.screenshot("j19-model-policy");
    await describe(context, "the Model & AI section rendered its typed honest-absent state with the lane's scope named and zero placeholder controls (the model policy surface is the service-side local-only procedure — listed)");
  },
};
