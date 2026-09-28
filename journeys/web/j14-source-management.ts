/**
 * @wfx/journeys — J14 Source connect / reauthorize / disconnect (encoded
 * Web journey).
 *
 * Doc expectation (matrix J14): source management — connect, see
 * capabilities/authorization state, reconnect, disconnect.
 *
 * Web-fixture-boot encoding (R17): the fixtures' scripted source-auth
 * lifecycle over the REAL runtime source-state machinery — the settings
 * sources section renders the scripted source's card with its honest
 * authorization truth (the signed-in state, its Connected chip, the
 * connect/reauthorize/disconnect action vocabulary). No fabricated state
 * renders beyond the scripted truth (an expired marker while signed in is
 * structurally absent). The expiry → reauthorize → recovery ROUND TRIP is
 * J28's own encoding; the REAL provider round trips (a real OAuth dance
 * against a real provider) remain the service-mode local-only procedure
 * (listed in the manifest's limitations).
 *
 * R35b re-encode (M3, production-neutral): the scripted source card is a
 * FIXTURES-BOOT binding (the service-mode anonymous read answers the
 * honest `{"authenticated":false,"sources":[]}` envelope — probed live by
 * the R34-C sweep, evidence/r34c/adjudication-table.md §B). The spec now
 * binds the boot's own typed truth through the loud mode badge
 * ([data-wfx-mode]): on the fixtures boot the scripted card's full typed
 * truth is asserted UNCHANGED; on a service boot the structural truths
 * the R23 production sweep verified (evidence/r23/production-sweep.md —
 * "the source chooser (settings?section=sources, 7 markers)" + the
 * anonymous prerequisite with its sign-in path) are asserted, with zero
 * fabricated source cards. Both branches fail on regression; neither
 * fabricates a pass.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j14SourceManagement: Journey = {
  id: "J14",
  title: "Source connect / reauthorize / disconnect",
  doc: "docs/validation/webflix-golden-journeys.md §J14 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings?section=sources");

    // The sources section + the source chooser (the structural truths —
    // both boots; the R23 production sweep's "source chooser, 7 markers"
    // line is the production truth of record).
    // binds the R22-A source chooser: [data-wfx-source-chooser] on the settings sources section.
    await assert.visible("[data-wfx-settings-sources]", "the settings sources section renders");
    await assert.visible(
      "[data-wfx-source-chooser]",
      "the source chooser renders in the sources section (the first-connect surface — both boots)",
    );
    // binds the R22-A chooser grammar: the anonymous prerequisite + its
    // sign-in-or-create path (the fixtures persona is anonymous; the
    // service-mode anonymous read renders the same prerequisite).
    await assert.visible(
      "[data-wfx-source-chooser-prerequisite]",
      "the chooser carries its typed prerequisite state (the anonymous-session truth)",
    );
    await assert.visible(
      "[data-wfx-source-chooser-signin]",
      "the prerequisite offers the sign-in / create-account path (the connect step's honest entry)",
    );

    // The boot's own typed truth (the loud environment law) decides the
    // per-boot contract — never a guessed branch.
    // binds the shell's mode badge: [data-wfx-mode] (fixtures | service).
    const bootMode = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-mode]')?.getAttribute('data-wfx-mode') ?? null`,
    );
    assert.that(
      "the boot states its mode loudly (the environment law — the typed branch truth)",
      "data-wfx-mode='fixtures' or 'service'",
      bootMode ?? "<none>",
      bootMode === "fixtures" || bootMode === "service",
    );

    if (bootMode === "fixtures") {
      // The fixtures-boot contract (the scripted source card's typed
      // truth — unchanged from the R17 encoding).
      await assert.visible(
        "[data-wfx-source='fake-source']",
        "the source card renders (the runtime's own sources read)",
      );
      await assert.attrEquals(
        "[data-wfx-source='fake-source']",
        "data-wfx-source-auth-state",
        "signedIn",
        "the source states its authorization truth (never a fabricated state)",
      );
      // R17 fix (lead integration): the chips render CSS-uppercased — assert
      // case-insensitively (the J28 law).
      const j14ChipText = await browser.tryText("[data-wfx-source-auth-chip='signedIn']");
      assert.that(
        "the signed-in source renders its Connected chip",
        "the chip label (case-insensitive)",
        j14ChipText ?? "<element absent>",
        j14ChipText !== null && j14ChipText.toLowerCase().includes("connected"),
      );
      await assert.textContains(
        "[data-wfx-source-recovery-detail]",
        "This source is connected",
        "the source card states its connection truth",
      );

      // The typed action vocabulary exists (the source-management grammar).
      await assert.countAtLeast(
        "[data-wfx-source-action='disconnect']",
        1,
        "the signed-in source offers its typed disconnect action",
      );

      // No fabricated states beyond the scripted truth: while signed in,
      // the expired/failed/signed-out markers are structurally absent.
      const html = await browser.tryHtml("[data-wfx-settings-sources]");
      assert.that(
        "no fabricated authorization states render beyond the scripted truth",
        "no expired/failed chips while signed in",
        html !== null && html.includes("Sign-in expired") ? "an expired chip rendered" : "no expired chip",
        html === null || !html.includes("Sign-in expired"),
      );
      await assert.countExactly(
        "[data-wfx-source-auth-state='expired']",
        0,
        "no expired source row renders while signed in (never a fabricated state)",
      );
    } else {
      // The service-boot contract (the R23 production truth of record):
      // the anonymous sources read renders ZERO source cards — the honest
      // typed envelope ({"authenticated":false,"sources":[]}), never a
      // fabricated connector card.
      await assert.countExactly(
        "[data-wfx-source]",
        0,
        "the anonymous service-mode read renders zero source cards (the honest empty truth — never a fabricated connector)",
      );
      await assert.countExactly(
        "[data-wfx-source-auth-state]",
        0,
        "no fabricated authorization states render on the anonymous read",
      );
    }

    // The section navigation works (the destination is reachable from settings).
    await assert.countAtLeast("[data-wfx-settings-sections] a[href='/settings?section=sources']", 1, "the sources section is linked from the settings sections nav");
    await assert.countAtLeast("[data-wfx-settings-sections] a[href='/settings?section=model']", 1, "the model section is linked from the settings sections nav");
    await assert.countAtLeast("[data-wfx-settings-sections] a[href='/settings?section=general']", 1, "the general section is linked from the settings sections nav");

    await context.screenshot("j14-source-management");
    await describe(context, "the settings sources section rendered its structural truths (the source chooser + the typed prerequisite) and the boot's own typed source-card contract (the fixtures boot's scripted signed-in truth with its Connected chip and typed disconnect action, or the service boot's honest anonymous read — the expiry/reauthorize round trip is J28's encoding; the real provider round trips are the service-mode local-only procedure — listed)");
  },
};
