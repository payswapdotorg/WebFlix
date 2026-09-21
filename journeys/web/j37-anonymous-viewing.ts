/**
 * @wfx/journeys — J37 Anonymous public viewing without WebFlix login
 * (encoded Web journey — R23 web-A).
 *
 * Doc expectation (golden journeys §J37): a FRESH browser with NO
 * WebFlix account: Home → Search → public title → Play → continue
 * watching → switch playback realization → return to Home/Watch →
 * continue session. No login gate may appear solely because the viewer
 * lacks a WebFlix account. Provider-specific authentication remains a
 * separate truth.
 *
 * Acceptance encoded (the R23-A/B boundary, consumed by the surfaces):
 * - NO LOGIN WALL for public playback (the player renders; the URL
 *   never redirects to /settings or any login);
 * - no redirect to Settings merely to watch;
 * - provider-auth requirements are DISTINGUISHED from WebFlix-account
 *   requirements (the per-option access truth names the source's OWN
 *   sign-in as active — "works without a WebFlix account");
 * - anonymous state stays honestly SESSION-SCOPED (the player's
 *   progress-scope sentence + the optional sign-in offer);
 * - login remains available but OPTIONAL (the session menu's truth).
 *
 * HONEST LIMIT (listed): cross-ROUTE watch-state folding in the dev
 * boot is the documented Turbopack split-module reality (J11/J12's
 * entry); the anonymous CONTINUATION mechanics encode through the
 * player's own resume truth.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j37AnonymousViewing: Journey = {
  id: "J37",
  title: "Anonymous public viewing without WebFlix login",
  doc: "docs/validation/webflix-golden-journeys.md §J37 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // FRESH BROWSER, NO ACCOUNT: Home renders the honest anonymous
    // session (the R23-A fold — watching needs nothing).
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "the anonymous viewer lands on Home (no gate, no interstitial)");
    await assert.textContains("[data-wfx-session-label]", "Signed out", "the session menu states the honest anonymous truth");
    const sessionSentence = await browser.tryText("[data-wfx-session-state]");
    assert.that(
      "the anonymous session truth names accountless watching (login optional, never a prerequisite)",
      "no account is needed to watch public content",
      (sessionSentence ?? "<none>").slice(0, 80),
      (sessionSentence ?? "").includes("no account is needed to watch public content"),
    );

    // SEARCH → open a PUBLIC title (the fixture source's own sign-in is
    // active — its realizations play without a WebFlix account).
    const itemHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that("the search surface offers the public title anonymously", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");

    // The PROVIDER-AUTH distinction: the where-to-watch access truth
    // names the source's OWN sign-in as the provider's truth (never a
    // WebFlix-account requirement).
    await assert.visible(
      '[data-wfx-watch-access="provider-authorized"]',
      "the access truth renders: the source's own sign-in is active, so playback works without a WebFlix account (provider truth, distinguished from any WebFlix-account truth)",
    );
    const accessSentence = await browser.tryText('[data-wfx-watch-access="provider-authorized"]');
    assert.that(
      "the access sentence names the source's own sign-in (the R23-A independence law)",
      "works without a WebFlix account",
      (accessSentence ?? "<none>").slice(0, 100),
      (accessSentence ?? "").includes("without a WebFlix account"),
    );

    // PLAY: the player renders — NO login redirect, NO settings redirect.
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    assert.that("the item page offers Play to the anonymous viewer", "a play href", playHref ?? "<absent>", playHref !== null);
    await goto(context, playHref ?? "/");
    await assert.visible("[data-wfx-surface='player']", "the player renders for the anonymous viewer (no wall)");
    await assert.visible(
      "[data-wfx-player-frame]",
      "the public embed stage engages (playback actually starts — not a gate)",
    );
    const playerUrl = await browser.eval<string>("window.location.pathname");
    assert.that(
      "no redirect away from the player happened (no login wall, no settings redirect)",
      "the /player route",
      playerUrl,
      playerUrl === "/player",
    );

    // THE SESSION-SCOPED PROGRESS TRUTH: anonymous progress is kept for
    // this session on this device — sign-in is the OPTIONAL upgrade.
    await assert.visible(
      "[data-wfx-player-progress-scope='session-local']",
      "the player states the session-scoped progress truth (honestly session-local)",
    );
    const scopeSentence = await browser.tryText("[data-wfx-player-progress-scope]");
    assert.that(
      "the progress-scope sentence keeps watching accountless (sign-in optional)",
      "kept for this session / never requires it",
      (scopeSentence ?? "<none>").slice(0, 120),
      (scopeSentence ?? "").includes("kept for this session") && (scopeSentence ?? "").includes("never requires it"),
    );
    await assert.visible(
      "[data-wfx-player-progress-signin]",
      "sign-in remains available but optional (a link, never a wall)",
    );

    // CONTINUE WATCHING within the session: the resume seam carries the
    // position (the same continuation mechanics J12 encodes).
    const withResume = `${playHref}${(playHref ?? "").includes("?") ? "&" : "?"}resume=60000`;
    await goto(context, withResume);
    await assert.textEquals(
      "[data-wfx-player-resume]",
      "Resumed at 1:00",
      "the anonymous session continues watching at the carried position",
    );

    // SWITCH PLAYBACK REALIZATION where available: the player's
    // Where-to-watch switch row offers the alternates (embed ↔ browser).
    const switchHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-watch-switch]')?.getAttribute('href') ?? null`,
    );
    assert.that(
      "the realization switch is offered on the anonymous player (public playback controls)",
      "a switch href",
      switchHref ?? "<absent>",
      switchHref !== null,
    );
    if (switchHref !== null) {
      await goto(context, switchHref);
      await assert.visible(
        "[data-wfx-surface='player']",
        "the switched realization still plays anonymously (the session continues)",
      );
    }

    // RETURN TO HOME/WATCH → the session continues (still anonymous,
    // still no wall anywhere on the way).
    await goto(context, "/watch");
    await assert.visible("[data-wfx-surface='watch']", "the anonymous viewer browses Watch (no gate)");
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "returning Home keeps the anonymous session (the journey continues)");

    await context.screenshot("j37-anonymous-viewing");
    await describe(
      context,
      "a fresh anonymous viewer browsed Home, searched, opened a public title, played it (no login wall, no settings redirect), saw the provider's own sign-in distinguished from any WebFlix-account truth, continued watching at a carried position through the session-scoped progress law, switched realizations, and returned to Home/Watch with the session intact — sign-in stayed available but optional the whole way",
    );
  },
};
