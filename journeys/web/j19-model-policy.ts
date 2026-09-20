/**
 * @wfx/journeys — J19 WebFlix model / BYOM / local model policy (encoded
 * Web journey).
 *
 * Doc expectation (matrix J19): the model policy controls on Web.
 *
 * Web-fixture-boot encoding (R21-B/R21-C update): the transport is
 * COMPLETE — the Model & AI section renders the REAL model-controls
 * read models (the provider registry: first-party + BYOM + local with
 * per-task capability truth; every frozen ModelTask's policy state with
 * the honest unset) over the fixtures persona's service-shaped answers.
 * The stale "arrives with the model lane" honest-absent state is gone
 * (the R21 stale-completion-copy law); no placeholder controls render
 * (the detailed management controls are the R21-D settings hub).
 *
 * HONEST LIMIT (updated): the REAL service-backed policy writes (your
 * account's BYOM bindings, persisted policies) run against the
 * configured service — the fixtures persona answers the same shapes
 * deterministically; the manifest limitation names the service-mode
 * procedure.
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

    // R21-B/R21-C: the transport is COMPLETE — the section renders the REAL
    // model-controls read models (the provider registry + every task's
    // policy truth) over the fixtures persona's service-shaped answers.
    // The stale "arrives with the model lane" honest-absent state is gone.
    await assert.visible(
      "[data-wfx-model-providers-list]",
      "the provider registry renders over the completed transport (first-party + BYOM + local truth)",
    );
    await assert.countAtLeast(
      "[data-wfx-model-providers-list] [data-wfx-model-provider]",
      1,
      "the registry carries at least the first-party provider row",
    );
    await assert.visible(
      "[data-wfx-model-policies-list]",
      "the per-task policy truth renders (the honest unset — never a fabricated default)",
    );
    await assert.countAtLeast(
      "[data-wfx-model-policies-list] [data-wfx-model-policy]",
      9,
      "every frozen ModelTask carries its policy chip (the full task set is visible)",
    );

    // The scope is named (selection, BYOM, local policy, privacy) — the
    // product vocabulary, never the stale lane wording.
    const text = await browser.tryText("[data-wfx-settings-model]");
    assert.that(
      "the model section names the controls' scope (providers, BYOM, local models, policy truth)",
      "the scope named in the section",
      text ?? "<none>",
      text !== null && text.includes("BYOM") && text.includes("policy"),
    );

    // No placeholder model controls (never fake capability) — the R22-F
    // update: the section's interactive controls are the REAL BYOM
    // management surface (the F8 closer: the Add action + the per-entry
    // Remove, over the typed bind/unbind routes — the R22-C contract).
    // The law this assertion keeps: every interactive control in the
    // section belongs to that REAL management panel (no placeholder
    // capability fabrication outside it).
    const controls = await browser.eval<readonly string[]>(
      `(() => { const section = document.querySelector('[data-wfx-settings-model]'); if (section === null) return []; return [...section.querySelectorAll('button, select, input')].map((el) => el.getAttribute('data-wfx-byom-action') ?? (el.closest('[data-wfx-byom-management]') !== null ? 'byom-form-control' : 'UNMARKED')); })()`,
    );
    const unmarked = (controls ?? []).filter((marker) => marker === "UNMARKED");
    assert.that(
      "every interactive model control belongs to the REAL BYOM management surface (no placeholder capability fabrication)",
      "zero unmarked controls outside the byom management panel",
      unmarked.length === 0 ? "all controls are the byom management surface" : `${unmarked.length} unmarked control(s)`,
      unmarked.length === 0,
    );
    await assert.countAtLeast(
      "[data-wfx-byom-management] [data-wfx-byom-action='add']",
      1,
      "the BYOM management panel offers its real Add action (the F8 closer — a working control, never a placeholder)",
    );

    // No fabricated model state: the honest unset policies render "Not
    // configured"; no selected-model lie appears anywhere.
    const html = await browser.tryHtml("[data-wfx-settings-model]");
    assert.that(
      "no fabricated selected-model state renders (the honest unset is named)",
      "the policy truth is the honest unset",
      html !== null && /selected model/i.test(html) ? "selected-model lie present" : "no selected-model lie",
      html === null || !/selected model/i.test(html),
    );

    await context.screenshot("j19-model-policy");
    await describe(context, "the Model & AI section rendered the REAL provider registry and per-task policy truth over the completed R06 transport (the fixtures persona's service-shaped answers) — no placeholder controls, no fabricated state");
  },
};
