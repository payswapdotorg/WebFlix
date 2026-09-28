/**
 * @wfx/journeys — J01 First launch (encoded Web journey).
 *
 * Doc expectation (docs/validation/webflix-golden-journeys.md):
 * "user can choose/create the intended profile, understand the primary
 * navigation, optionally configure sources, and land in a useful
 * discovery state without seeing implementation diagnostics."
 *
 * Web-fixture-boot encoding: the honest anonymous session (R02 seam —
 * no fake profile), the full primary navigation, the source-configuration
 * destination reachable, a useful discovery landing (the R28-B chip-bar
 * composition — the home surface renders chip bar + rows + cards
 * immediately, no hero), and the diagnostics-free chrome (no section
 * errors, no acquisition panel, no protocol vocabulary on the landing
 * surface).
 *
 * R35b re-encode: the navigation block binds the CURRENT shell grammar —
 * the R33-B (D6) state-conditional rail (the signed-out primary group
 * Home · Shorts · Subscriptions · Library in BOTH landmarks) + the You
 * group (History/Playlists/Offline/Settings, R29-B/R30-B) + the rail
 * sign-in promo link = 13 `nav a` (the pre-R28/R29 6×2 set is gone).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j01FirstLaunch: Journey = {
  id: "J01",
  title: "First launch / profile selection / onboarding",
  doc: "docs/validation/webflix-golden-journeys.md §J01",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/");

    // Primary navigation: every product surface is reachable. The shell
    // renders two nav landmarks (the desktop rail + the mobile bottom
    // bar) — both carry the corpus primary set.
    await assert.countExactly("nav", 2, "the shell renders its two navigation landmarks (desktop rail + mobile bar)");
    // binds R29-B/R30-B/R33-B rail grammar: 9 desktop-rail links (the
    // primary group + the You group + the rail sign-in promo) + 4 bottom-nav links.
    await assert.countExactly("nav a", 13, "the navigation landmarks expose the current rail grammar (desktop rail 9 + mobile bar 4)");
    for (const label of ["Home", "Shorts", "Subscriptions", "Library"]) {
      const count = await browser.eval<number>(
        `(() => [...document.querySelectorAll('nav a')].filter((a) => (a.textContent ?? '').trim() === ${JSON.stringify(label)}).length)()`,
      );
      assert.that(
        `the primary navigation names the "${label}" surface in BOTH landmarks`,
        `2 nav links labeled "${label}"`,
        `${count} links`,
        count === 2,
      );
    }
    // binds the R29-B/R30-B You group: the deep destinations render on
    // the desktop rail (History/Playlists/Offline/Settings).
    for (const label of ["History", "Playlists", "Offline", "Settings"]) {
      const count = await browser.eval<number>(
        `(() => [...document.querySelectorAll('nav.wfx-rail a')].filter((a) => (a.textContent ?? '').trim() === ${JSON.stringify(label)}).length)()`,
      );
      assert.that(
        `the desktop rail's You group names the "${label}" destination`,
        `a rail link labeled "${label}"`,
        `${count} links`,
        count === 1,
      );
    }

    // The honest session state (no fake profile — the R02 seam's truth).
    await assert.textContains(".wfx-topbar", "Signed out", "the shell renders the honest signed-out session state (never a fabricated profile)");

    // The boot mode is loud (the 050 environment law — honest chrome).
    await assert.textEquals("[data-wfx-mode-badge]", "dev fixtures", "the boot mode badge states the fixture configuration loudly (invariant 10)");

    // A useful discovery landing: the R28-B composition (chip bar + rows
    // + cards — the home surface restructured; the hero is gone).
    // binds R28-B home restructure: [data-wfx-chipbar] + the feed root.
    await assert.visible("[data-wfx-chipbar]", "the home landing renders the discovery chip bar (the R28-B composition)");
    await assert.countAtLeast("[data-wfx-row]", 2, "the home landing renders discovery rows");
    await assert.countAtLeast("a[data-wfx-card]", 4, "the home landing renders source-neutral cards");

    // No implementation diagnostics on the landing surface.
    await assert.countExactly("[data-wfx-section-error]", 0, "no feed section renders an error state on first launch (no diagnostics)");
    await assert.countExactly("[data-wfx-acquisition]", 0, "no acquisition diagnostics appear on the home landing");
    await assert.countExactly("[data-wfx-error]", 0, "no error surface renders on first launch");

    // The source-configuration destination is reachable (optional step).
    // binds the You group's Settings entry (the R29-B rail).
    const settingsHref = await browser.eval<string | null>(
      `(() => { const link = [...document.querySelectorAll('nav a')].find((a) => (a.textContent ?? '').trim() === 'Settings'); return link === undefined ? null : link.getAttribute('href'); })()`,
    );
    assert.that(
      "the settings (source configuration) destination is linked from the shell",
      "nav Settings link with href",
      settingsHref ?? "<absent>",
      settingsHref === "/settings",
    );

    await context.screenshot("j01-first-launch");
    await describe(context, "landed in a useful discovery state (the chip-bar + rows composition) with the full current navigation, the honest anonymous session, and no implementation diagnostics");
  },
};
