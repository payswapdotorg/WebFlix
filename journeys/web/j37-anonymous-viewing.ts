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
 *
 * R35b re-encode: the anonymous play path is the R28-B ONE-CLICK grammar
 * — the search card's primary link IS the /player href (the card click
 * starts playback; no extra hop, no gate). The access-truth assertions
 * hold on the player's own Where-to-watch row; the frame/no-redirect/
 * progress-scope/resume/switch assertions are unchanged.
 *
 * WFX-R23R re-encode (2026-10-03, the R23 current-production revalidation):
 * STALE-GRAMMAR drift documented and fixed — the spec pre-dated the
 * product evolution to the split-runtime SERVICE catalog. Two drifts:
 * (1) the title binding searched the FIXTURES-only catalog ("Deep Field
 * Diary" — absent from the real production catalog, so the journey could
 * never even reach the player on production); the service boot now binds
 * CATALOG-NEUTRALLY (any card's one-click /player href — the R28-B
 * grammar law, the same binding J38's R35b re-encode uses), with a query
 * the deployed surface answers; (2) the access-truth vocabulary: the
 * fixtures source answers provider-authorized ("works without a WebFlix
 * account") while the deployed service source answers public ("Public —
 * plays for everyone, no account needed.") — BOTH are honest per-source
 * access truths; the LAW (the R23-A independence law: the access truth
 * renders and names accountless watching, never a WebFlix-account
 * requirement) is what the service branch asserts. The fixtures boot's
 * original walk is UNCHANGED (the mode badge decides the branch — the
 * J38 R35b precedent).
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

    // The boot's own loud mode badge decides the branch (the J38 R35b
    // precedent): the fixtures boot keeps the original fixtures-catalog
    // walk UNCHANGED; the service boot (the deployed split runtime) walks
    // the real catalog with the same no-login-wall laws.
    const bootMode = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-mode]')?.getAttribute('data-wfx-mode') ?? null`,
    );
    assert.that(
      "the boot states its mode loudly (the environment law — the typed branch truth)",
      "data-wfx-mode='fixtures' or 'service'",
      bootMode ?? "<none>",
      bootMode === "fixtures" || bootMode === "service",
    );

    const playHref = bootMode === "service"
      ? await serviceCatalogPlayHref(context)
      : await fixturesPlayHref(context);

    await goto(context, playHref ?? "/");

    // THE PROVIDER-AUTH DISTINCTION (the R23-A independence law): the
    // where-to-watch access truth names the SOURCE's own truth — the
    // fixtures source answers provider-authorized ("works without a
    // WebFlix account"); the deployed service source answers public
    // ("Public — plays for everyone, no account needed."). BOTH are
    // honest per-source access truths; what the LAW requires is that an
    // access truth RENDERS and names accountless watching (never a
    // WebFlix-account requirement).
    await assert.visible(
      "[data-wfx-watch-access]",
      "the access truth renders (the source's own truth — provider-auth or public, distinguished from any WebFlix-account truth)",
    );
    const accessSentence = await browser.tryText("[data-wfx-watch-access]");
    const accessKind = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-watch-access]')?.getAttribute('data-wfx-watch-access') ?? null`,
    );
    const accountlessAccess = (accessSentence ?? "").includes("without a WebFlix account")
      || ((accessSentence ?? "").includes("no account needed") && accessKind === "public");
    assert.that(
      "the access sentence names accountless watching (the R23-A independence law — provider/public truth, never a WebFlix-account requirement)",
      "works without a WebFlix account | Public — plays for everyone, no account needed.",
      `${accessKind ?? "<none>"} :: ${(accessSentence ?? "<none>").slice(0, 100)}`,
      accountlessAccess,
    );

    // PLAY: the player renders — NO login redirect, NO settings redirect
    // (the one-click card path landed here directly).
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
      "a fresh anonymous viewer browsed Home, searched, opened a public title, played it (no login wall, no settings redirect), saw the source's own access truth (provider-auth or public — never a WebFlix-account requirement), continued watching at a carried position through the session-scoped progress law, switched realizations, and returned to Home/Watch with the session intact — sign-in stayed available but optional the whole way",
    );
  },
};

/** The FIXTURES-boot play href (the original walk's binding — unchanged):
 * the fixture catalog's "Deep Field Diary" one-click /player href. */
async function fixturesPlayHref(context: import("../lib/journeys").JourneyContext): Promise<string | null> {
  const playHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
  context.assert.that(
    "the search surface offers the public title's one-click play path anonymously",
    "an id-first /player link (the R28-B play decision — no gate, no extra hop)",
    playHref ?? "<absent>",
    playHref !== null && playHref.startsWith("/player?id=wfxitm_"),
  );
  return playHref;
}

/** The SERVICE-boot play href (the WFX-R23R re-encode): CATALOG-NEUTRAL —
 * any card the deployed surface answers offers the same one-click /player
 * grammar; the R28-B law (id-first href, no gate, no extra hop) is the
 * assertion, never a fixtures-only title. */
async function serviceCatalogPlayHref(context: import("../lib/journeys").JourneyContext): Promise<string | null> {
  await goto(context, "/search?q=space");
  const playHref = await context.browser.eval<string | null>(
    `(() => { const card = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '') !== ''); return card === undefined ? null : card.getAttribute('href'); })()`,
  );
  context.assert.that(
    "the deployed catalog offers a public title's one-click play path anonymously (catalog-neutral — the R28-B grammar law)",
    "an id-first /player link (the R28-B play decision — no gate, no extra hop)",
    playHref ?? "<absent>",
    playHref !== null && playHref.startsWith("/player?id=wfxitm_"),
  );
  return playHref;
}
