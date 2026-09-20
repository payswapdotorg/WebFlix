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

    // R22 update: the Model & AI section now carries REAL management
    // controls — the R22-F BYOM management panel (the F8 closer: a user
    // can discover, configure, verify, and remove a provider through the
    // normal surface). The R21-era "zero interactive controls" law is
    // superseded by the R22 plan; the no-placeholder INTENT is preserved:
    // every interactive control in the section must belong to the typed
    // BYOM management surface (no stray placeholder controls outside it).
    await assert.visible(
      "[data-wfx-byom-management]",
      "the R22-F BYOM management surface renders inside the Model & AI section (the normal-path management panel)",
    );
    await assert.visible(
      "[data-wfx-byom-action='add']",
      "the add-provider entry control renders (discover → configure is a real control, never a hidden API)",
    );
    // The anonymous truth: the add FORM is auth-gated (providers belong to
    // an account); the honest prerequisite note renders — never a dead end.
    // (The authenticated add→bind→remove round trip is J36's encoding.)
    await assert.visible(
      "[data-wfx-byom-anonymous-note]",
      "the anonymous state names the sign-in prerequisite honestly (the no-dead-end law)",
    );
    const strayControls = await browser.eval<number>(
      `(() => { const section = document.querySelector('[data-wfx-settings-model]'); if (section === null) return -1; const panel = section.querySelector('[data-wfx-byom-management]'); if (panel === null) return -1; return [...section.querySelectorAll('button, select, input')].filter((el) => panel.contains(el) === false).length; })()`,
    );
    assert.that(
      "no placeholder model controls render outside the BYOM management panel (a fixture is never presented as capability)",
      "zero interactive controls outside the typed BYOM panel",
      `${strayControls} stray controls`,
      strayControls === 0,
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
