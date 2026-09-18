/**
 * @wfx/journeys — J13 Account/profile/identity lifecycle (encoded Web
 * journey).
 *
 * Doc expectation (matrix J13): the identity lifecycle on Web.
 *
 * Web-fixture-boot encoding: the honest ANONYMOUS session truth (the
 * R02 seam) — the shell's session menu and the settings session
 * section state the signed-out/anonymous state with its durability
 * truth, and NOTHING pretends to be a profile (no fabricated profile
 * UI anywhere on the surface).
 *
 * HONEST LIMIT (listed): the full account lifecycle (register/login/
 * profiles) is the service-side identity lane (apps/api /auth routes);
 * the web fixtures boot renders its honest pre-identity state. The
 * service-mode procedure is the manifest limitation entry.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j13IdentityLifecycle: Journey = {
  id: "J13",
  title: "Account/profile/identity lifecycle",
  doc: "docs/validation/webflix-golden-journeys.md §J13 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings");

    // The session section: the honest anonymous state.
    await assert.visible("[data-wfx-settings-session]", "the settings session section renders");
    const label = await browser.tryText("[data-wfx-session-label]");
    assert.that(
      "the session states the honest signed-out identity (never a fabricated profile)",
      "the signed-out session label",
      label ?? "<none>",
      label !== null && label.toLowerCase().includes("signed out"),
    );
    const durability = await browser.tryText("[data-wfx-session-durability]");
    assert.that(
      "the session states its durability truth (how long the anonymous identity lasts)",
      "a session stability statement",
      durability ?? "<none>",
      durability !== null && durability.toLowerCase().includes("session stability"),
    );

    // Nothing pretends to be a profile anywhere on the surface.
    const pageText = await browser.tryText("[data-wfx-surface='settings']");
    assert.that(
      "no fabricated profile management UI renders in the fixtures identity state",
      "no profile switcher/manage controls",
      pageText !== null && /switch profile|manage profiles|your profile/i.test(pageText) ? "profile UI text present" : "no profile UI text",
      pageText === null || !/switch profile|manage profiles|your profile/i.test(pageText),
    );

    // The shell's session menu carries the same truth (one law, two surfaces).
    await assert.textContains(".wfx-topbar", "Signed out", "the shell session menu states the same signed-out truth");

    await context.screenshot("j13-identity-lifecycle");
    await describe(context, "the honest anonymous session rendered in both the settings session section and the shell menu, with durability truth and no fabricated profile UI");
  },
};
