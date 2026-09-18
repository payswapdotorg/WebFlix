/**
 * @wfx/journeys — J28 Provider credential expiry/recovery (encoded Web
 * journey — R17).
 *
 * Doc expectation (J28–J30 block): "failures are specific, recoverable
 * where possible, and honest. A missing credential … must never look like
 * a silent success."
 *
 * Web-fixture-boot encoding (R17): the fixtures' scripted source-auth
 * lifecycle over the REAL runtime source-state machinery — the healthy
 * signed-in truth → the dev-labeled credential EXPIRY → the NAMED expired
 * state (its own chip + note + the typed `reauthorize` recovery action —
 * never a silent fallback to "not connected", never a fake "connected") →
 * the TYPED unauthorized read (the player's honest failure names the
 * expired credential and its reconnect path; no provider frame renders) →
 * the REAUTHORIZE recovery (the source is signed in again and reads work).
 * The journey RESTORES the recovered state before finishing (the scripted
 * feed is shared with every later journey).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch, playerHrefFromItem } from "../lib/journeys";

export const j28CredentialExpiry: Journey = {
  id: "J28",
  title: "Provider credential expiry/recovery",
  doc: "docs/validation/webflix-golden-journeys.md §J28–J30 block",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // 0. A real item + its player link, captured while the source is
    //    healthy (the search read works — the fixture feed's own truth).
    const itemHref = await itemHrefFromSearch(context, "Harbor", "Harbor Lights");
    assert.that(
      "the search surface offers the item while the source is signed in",
      "an item link",
      itemHref ?? "<absent>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");
    const playerHref = await playerHrefFromItem(context);
    assert.that(
      "the item page offers its play decision while the source is signed in",
      "a player link",
      playerHref ?? "<absent>",
      playerHref !== null,
    );

    // 1. The healthy signed-in truth (the source card's own state).
    await goto(context, "/settings?section=sources");
    await assert.visible("[data-wfx-settings-sources]", "the settings sources section renders");
    await assert.visible(
      "[data-wfx-source='fake-source']",
      "the scripted source's card renders (the fixtures' own source truth)",
    );
    await assert.attrEquals(
      "[data-wfx-source='fake-source']",
      "data-wfx-source-auth-state",
      "signedIn",
      "the source states its signed-in truth (never a fabricated state)",
    );
    await assert.textContains(
      "[data-wfx-source-auth-chip='signedIn']",
      "Connected",
      "the signed-in source renders its Connected chip",
    );
    await assert.countExactly("[data-wfx-source-expired]", 0, "no expired marker renders while signed in");

    // 2. THE EXPIRY (the dev-labeled drive): the named expired state.
    await browser.clickInteractive("[data-wfx-source-action='expire']");
    await browser.pollTextContains(
      "[data-wfx-source-recovery-detail]",
      "The stored sign-in expired",
      30_000,
    );
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.attrEquals(
      "[data-wfx-source='fake-source']",
      "data-wfx-source-auth-state",
      "expired",
      "the expired credential renders its OWN named state (never a silent fallback)",
    );
    await assert.countAtLeast("[data-wfx-source-expired]", 1, "the expired state carries its explicit marker");
    await assert.textContains(
      "[data-wfx-source-auth-chip='expired']",
      "Sign-in expired",
      "the expired source renders its named Sign-in-expired chip",
    );
    await assert.textContains(
      "[data-wfx-source-recovery-detail]",
      "reconnect to restore this source",
      "the expired state states its recovery path",
    );
    await assert.textContains(
      "[data-wfx-source-notes]",
      "The stored authorization expired",
      "the availability note names the expired authorization",
    );
    await assert.countAtLeast(
      "[data-wfx-source-action='reauthorize']",
      1,
      "the expired state offers its typed reauthorize (reconnect) action",
    );

    // 3. THE TYPED UNAUTHORIZED READ: the player refuses honestly — the
    //    failure names the expired credential and its recovery path; no
    //    provider frame renders (never a fake success, never a hang).
    await goto(context, playerHref ?? "/");
    await assert.countAtLeast("[data-wfx-player-failure]", 1, "the expired credential renders the player's typed failure");
    await assert.attrEquals(
      "[data-wfx-player-failure]",
      "data-wfx-player-failure-kind",
      "unauthorized",
      "the failure kind is the typed unauthorized (the classified credential)",
    );
    await assert.textContains(
      "[data-wfx-player-failure]",
      "sign-in expired",
      "the failure NAMES the expired credential (the honest classified state)",
    );
    await assert.textContains(
      "[data-wfx-player-failure]",
      "reconnect the source",
      "the failure states its re-auth recovery path",
    );
    await assert.countExactly("[data-wfx-player-frame]", 0, "no provider frame renders for an expired credential (never a fake stage)");

    // 4. THE RECOVERY: reauthorize restores the source (the account
    //    preserved, the authorization fresh) and reads work again.
    await goto(context, "/settings?section=sources");
    await browser.clickInteractive("[data-wfx-source-action='reauthorize']");
    await browser.pollTextContains(
      "[data-wfx-source-recovery-detail]",
      "This source is connected",
      30_000,
    );
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.attrEquals(
      "[data-wfx-source='fake-source']",
      "data-wfx-source-auth-state",
      "signedIn",
      "the reauthorized source is signed in again (the recovery completed)",
    );
    await assert.countExactly("[data-wfx-source-expired]", 0, "the expired marker is gone after recovery");

    // The recovered truth: the player resolves again (a real playback
    // stage — never a silent success).
    await goto(context, playerHref ?? "/");
    const mode = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-player-mode]')?.getAttribute('data-wfx-player-mode') ?? null`,
    );
    assert.that(
      "the recovered source resolves playback again (the read recovered)",
      "a resolved playback mode (not failed)",
      mode ?? "<none>",
      mode !== null && mode !== "failed",
    );

    await context.screenshot("j28-credential-expiry");
    await describe(
      context,
      "the source card rendered its signed-in truth; the dev expiry drove the NAMED expired state (chip + note + the typed reauthorize action); the player's typed unauthorized failure named the expired credential with its reconnect path and no provider frame; the reauthorize recovery restored the signed-in state and playback reads",
    );
  },
};
