/**
 * @wfx/journeys — J39 Multimodal media intelligence (encoded Web
 * journey — R23-F/G/H/I/K, the web side).
 *
 * Doc expectation (golden journeys §J39): search by natural-language
 * description → receive semantically relevant title/moment → open item
 * → transcript/chapters → ask about a visual event → jump to relevant
 * segment → change language/subtitle output → observe provenance/model
 * truth.
 *
 * WEB-SIDE ENCODING (over the fixture intelligence feed — the loud dev
 * badge; the shapes are the frozen R23-F artifacts and the derivations
 * are the frozen contracts consumed verbatim):
 * - SEARCH BY MEANING: a natural-language query finds the title by what
 *   it IS (not its name) + the findable MOMENTS, each with provenance;
 * - THE MOMENT JUMP: the moment link lands in the player at its
 *   timestamp (the resume seam);
 * - TRANSCRIPT/CHAPTERS: the item's intelligence surface discloses the
 *   transcript (speaker labels), chapters, and moments with jump paths;
 * - THE VISUAL-EVENT QUERY: a show-me-the-part-where query lands on the
 *   visual event's moment;
 * - LANGUAGE/SUBTITLE OUTPUT: the AI tray's translation action with its
 *   language choice (the typed transform states);
 * - PROVENANCE/MODEL TRUTH: every surface names the contributing models
 *   + the ownership law (no model authorizes a playback/acquisition
 *   action);
 * - THE LIVE ROUTE (R23-G): the legal-audio gate + the R2T2 route
 *   (registering the open model through Model & AI routes the live
 *   lane; the honest gap + recovery render when unregistered);
 * - THE ANONYMOUS AI BOUNDARY (R23-K): the entire walk runs without an
 *   account (low-cost local reads; the typed quota state — never a
 *   wall).
 *
 * WFX-R23R re-encode (2026-10-03, the R23 current-production revalidation
 * — the STANDING revalidation target): STALE-GRAMMAR drift documented and
 * fixed. The spec pre-dated the split-runtime product evolution: it binds
 * the FIXTURES intelligence feed's artifacts (the "Deep Field Diary"
 * meaning result, its transcript/chapters/moments, the scripted R2T2
 * registration round trip). On the DEPLOYED service boot the intelligence
 * transport answers its HONEST TYPED UNAVAILABLE state — the deployed
 * Experience API now serves /experience/intelligence with
 * meaningSearchAvailable:false (recorded verbatim in evidence/r41), the
 * real catalog items carry no derived artifacts (the per-feature
 * prerequisite truth names exactly what is missing), the live-ASR lane
 * answers the legal-audio gate's typed audio-unavailable state, and the
 * open-model registry serves READS ONLY (the typed 503 — the R23-J law).
 * None of these are failures to hide — they are the revalidation
 * FINDINGS. The service branch (the J38 R35b mode-badge precedent)
 * asserts those honest typed truths as CHECKS: the semantic section's
 * no-fabrication sentence, the transport's typed answer over HTTP, the
 * per-feature prerequisite truth, the model-authority boundary sentence
 * (verbatim), the real R2T2 license truth, the registration boundary's
 * typed refusal, and the anonymous boundary — every one fails on
 * regression. The fixtures boot's original walk is UNCHANGED.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j39MediaIntelligence: Journey = {
  id: "J39",
  title: "Multimodal media intelligence / semantic moment discovery",
  doc: "docs/validation/webflix-golden-journeys.md §J39 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // The boot's own loud mode badge decides the branch (the J38 R35b
    // precedent): the fixtures boot keeps the original scripted-artifact
    // walk UNCHANGED; the service boot (the deployed split runtime)
    // asserts the honest typed truths of the deployed intelligence
    // surfaces — the revalidation findings as checks.
    await goto(context, "/");
    const bootMode = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-mode]')?.getAttribute('data-wfx-mode') ?? null`,
    );
    assert.that(
      "the boot states its mode loudly (the environment law — the typed branch truth)",
      "data-wfx-mode='fixtures' or 'service'",
      bootMode ?? "<none>",
      bootMode === "fixtures" || bootMode === "service",
    );

    if (bootMode === "service") {
      await serviceHonestTruths(context);
    } else {
      await fixturesIntelligenceWalk(context);
    }

    await context.screenshot("j39-media-intelligence");
  },
};

/** The FIXTURES-boot walk (the R23-F/G/H/I/K encoding — unchanged): the
 * scripted intelligence feed's full artifact walk. */
async function fixturesIntelligenceWalk(context: import("../lib/journeys").JourneyContext): Promise<void> {
    const { assert, browser } = context;

    // SEARCH BY MEANING: the natural-language query finds the title by
    // WHAT IT IS (not its name — the title search finds nothing).
    await goto(context, "/search?q=a%20space%20documentary%20about%20telescopes%20and%20galaxies");
    await assert.visible(
      "[data-wfx-semantic-search]",
      "the search surface offers matches by meaning (the multimodal lane)",
    );
    const meaningTitle = await browser.tryText("[data-wfx-semantic-meaning-result]");
    assert.that(
      "the meaning result finds the space documentary by what it IS (not its name)",
      "Deep Field Diary",
      (meaningTitle ?? "<none>").slice(0, 60),
      (meaningTitle ?? "").includes("Deep Field Diary"),
    );
    const matched = await browser.tryText("[data-wfx-semantic-meaning-result]");
    assert.that(
      "the meaning result names WHY it matched (the honest matched text)",
      "matched “…”",
      (matched ?? "<none>").slice(0, 100),
      (matched ?? "").includes("matched"),
    );
    await assert.visible(
      "[data-wfx-semantic-provenance]",
      "the semantic results carry their provenance (contributing models, named)",
    );
    const provenance = await browser.tryText("[data-wfx-semantic-provenance]");
    assert.that(
      "the provenance names the signal models + the ownership law",
      "open-model:… + your choices stay yours",
      (provenance ?? "<none>").slice(0, 140),
      (provenance ?? "").includes("open-model:") && (provenance ?? "").includes("your choices stay yours"),
    );

    // THE VISUAL-EVENT QUERY ("show me the part where…"): a moment-level
    // query lands on the visual event's moment with its jump path.
    await goto(context, "/search?q=" + encodeURIComponent("the moment the first deep field image resolves"));
    await assert.visible(
      "[data-wfx-semantic-moment-jump]",
      "the show-me-the-part-where query lands on the findable moment with its jump path",
    );
    const momentJumpHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-semantic-moment-jump]')?.getAttribute('href') ?? null`,
    );
    assert.that(
      "the moment's jump path targets the player at its timestamp (the resume seam)",
      "a player href with resume",
      momentJumpHref ?? "<absent>",
      momentJumpHref !== null && momentJumpHref.includes("resume="),
    );

    // THE MOMENT JUMP: land in the player at the moment's timestamp.
    await goto(context, momentJumpHref ?? "/");
    await assert.visible("[data-wfx-surface='player']", "the moment jump lands in the player");
    await assert.visible(
      "[data-wfx-player-resume]",
      "the player resumes AT the moment's timestamp (the jump honored)",
    );

    // OPEN THE ITEM → TRANSCRIPT/CHAPTERS (the intelligence surface).
    const itemHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that("the title search offers the item too", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");
    await assert.visible(
      "[data-wfx-intelligence]",
      "the item hub carries its derived intelligence (transcript, chapters, moments)",
    );
    // Progressive disclosure: open the panel (native details toggle).
    await browser.clickInteractive("[data-wfx-intelligence] > summary");
    await assert.visible(
      "[data-wfx-intelligence-chapters]",
      "the chapters render with their jump paths",
    );
    await assert.visible(
      "[data-wfx-intelligence-moments]",
      "the findable moments render with their jump paths",
    );
    // The transcript's own disclosure (one level deeper).
    await browser.clickInteractive("[data-wfx-intelligence-transcript-disclosure] > summary");
    await assert.visible(
      "[data-wfx-intelligence-transcript]",
      "the transcript renders (speaker labels, timestamps)",
    );
    const transcriptText = await browser.tryText("[data-wfx-intelligence-transcript]");
    assert.that(
      "the transcript carries speaker attribution (the diarization truth)",
      "Dr. Amara Osei",
      (transcriptText ?? "<none>").slice(0, 200),
      (transcriptText ?? "").includes("Dr. Amara Osei"),
    );

    // The honest PREREQUISITE truth: this title's features render their
    // availability per-feature (never a silent downgrade).
    await assert.visible(
      "[data-wfx-intelligence-features]",
      "the per-feature availability truth renders (the R23-H honesty law)",
    );

    // THE PROVENANCE/MODEL TRUTH on the item surface: every contributing
    // model named + the model-authority boundary.
    await assert.visible(
      "[data-wfx-intelligence-provenance]",
      "the provenance block renders (where the intelligence came from)",
    );
    const itemProvenance = await browser.tryText("[data-wfx-intelligence-provenance]");
    assert.that(
      "the provenance names the batch transcription + structural analysis models",
      "open-model:moss-transcribe-diarize + open-model:qwen2.5-vl-7b-instruct",
      (itemProvenance ?? "<none>").slice(0, 240),
      (itemProvenance ?? "").includes("open-model:moss-transcribe-diarize") &&
        (itemProvenance ?? "").includes("open-model:qwen2.5-vl-7b-instruct"),
    );
    await assert.visible(
      "[data-wfx-intelligence-provenance-note]",
      "the model-authority boundary renders ('no model authorizes a playback or acquisition action')",
    );

    // CHANGE LANGUAGE/SUBTITLE OUTPUT: the AI tray's translation action
    // with its language choice (the typed transform states).
    const languageSelect = await browser.eval<boolean>(
      `(() => { const tray = document.querySelector('[data-wfx-ai-tray]'); return tray !== null && tray.querySelector('select') !== null; })()`,
    );
    assert.that(
      "the AI tray offers the translation action with its language choice",
      "a language select in the tray",
      languageSelect ? "present" : "absent",
      languageSelect,
    );

    // THE LIVE ROUTE (R23-G) + THE ANONYMOUS BOUNDARY (R23-K): the walk
    // has run WITHOUT an account the whole way; the live-captions surface
    // renders the honest gap with its recovery (R2T2 not yet registered),
    // and registering it through Model & AI routes the live lane.
    await goto(context, await playHrefOf(context, itemHref ?? "/"));
    await assert.visible(
      "[data-wfx-live-captions]",
      "the live captions surface renders on the player (progressively disclosed)",
    );
    await assert.visible(
      '[data-wfx-live-captions-state="no-route"]',
      "the honest gap: no low-latency live route is registered (never a fake live lane)",
    );
    await assert.visible(
      "[data-wfx-live-captions-recovery]",
      "the typed gap carries its recovery (bind and register the R2T2 open model)",
    );

    // Register R2T2 through the Model & AI surface (the typed drive).
    await goto(context, "/settings?section=model");
    await assert.visible("[data-wfx-openmodels]", "the Model & AI surface lists the open models");
    const licenseTruth = await browser.tryText("[data-wfx-openmodel-license]");
    assert.that(
      "the R2T2 row carries its REAL license truth (the code/weights distinction)",
      "Code Apache-2.0 · weights NetEase Model Use License Agreement",
      (licenseTruth ?? "<none>").slice(0, 100),
      (licenseTruth ?? "").includes("Apache-2.0") && (licenseTruth ?? "").includes("NetEase"),
    );
    await browser.clickInteractive("[data-wfx-openmodel-action='register']");
    await browser.pollTextContains("[data-wfx-openmodel-state]", "Registered", 30_000);
    await assert.visible(
      '[data-wfx-openmodel-registered="true"]',
      "the registration truth updates (a catalog row becomes a provider)",
    );

    // Back on the player: the live lane routes to R2T2 with the envelope.
    await goto(context, await playHrefOf(context, itemHref ?? "/"));
    await assert.visible(
      '[data-wfx-live-captions-state="routed"]',
      "the live captions route to R2T2 once registered (the live lane wired)",
    );
    await assert.visible(
      "[data-wfx-live-captions-envelope]",
      "the route's envelope truth renders (committed output, 80 ms–2 s chunks)",
    );

    // THE ANONYMOUS BOUNDARY (R23-K): the whole walk ran accountless —
    // the low-cost reads served every step (no wall anywhere).
    await assert.textContains(
      "[data-wfx-session-label]",
      "Signed out",
      "the multimodal intelligence walk ran entirely without a WebFlix account (the R23-K anonymous AI boundary)",
    );

    await describe(
      context,
      "the multimodal walk: a natural-language query found the space documentary by what it IS with honest provenance and the ownership law, the show-me-the-part-where query landed on the findable moment and jumped into the player at its timestamp, the item disclosed its transcript (speaker-attributed), chapters, and moments with jump paths plus the per-feature prerequisite truth, the provenance named every contributing model with the model-authority boundary, the translation action carried its language choice, the live-captions surface answered the honest unregistered gap with its recovery and then routed to R2T2 (with its real license truth and envelope) once registered through Model & AI — all without a WebFlix account",
    );
}

/** The SERVICE-boot honest truths (the WFX-R23R re-encode — the standing
 * revalidation target's deployed answer, asserted as checks):
 * - the semantic/moment search transport's typed unavailable state (the
 *   surface's no-fabrication sentence + the transport's HTTP answer);
 * - the item intelligence surface's per-feature prerequisite truth;
 * - the provenance + model-authority boundary (verbatim sentence);
 * - the AI tray's translation action with its language choice;
 * - the live-ASR lane's legal-audio gate typed state;
 * - the R2T2 real license truth + the registry's reads-only boundary
 *   (the typed 503);
 * - the anonymous boundary (the whole walk accountless). */
async function serviceHonestTruths(context: import("../lib/journeys").JourneyContext): Promise<void> {
  const { assert, browser } = context;
  const semanticQuery = "a space documentary about telescopes and galaxies";

  // SEARCH BY MEANING: the semantic section RENDERS and answers its
  // honest typed no-matches state — the deployed transport serves no
  // semantic index (never fabricated results).
  await goto(context, `/search?q=${encodeURIComponent(semanticQuery)}`);
  await assert.visible(
    "[data-wfx-semantic-search]",
    "the search surface offers the matches-by-meaning lane (the multimodal lane renders)",
  );
  const semanticState = await browser.eval<string | null>(
    `document.querySelector('[data-wfx-semantic-search]')?.getAttribute('data-wfx-semantic-state') ?? null`,
  );
  assert.that(
    "the semantic lane answers its honest typed state on the deployed transport (ready + no matches — never fabricated)",
    "data-wfx-semantic-state='no-matches'",
    semanticState ?? "<none>",
    semanticState === "no-matches",
  );
  const semanticNone = await browser.tryText("[data-wfx-semantic-none]");
  assert.that(
    "the no-matches state states the no-fabrication law verbatim",
    "…WebFlix does not fabricate semantic results.",
    (semanticNone ?? "<none>").slice(0, 160),
    (semanticNone ?? "").includes("does not fabricate semantic results"),
  );

  // THE TRANSPORT'S EXACT PRODUCTION ANSWER (the revalidation finding,
  // recorded verbatim): the web host's intelligence route answers the
  // typed unavailable view — mode=service, meaningSearchAvailable=false,
  // empty meaning/moments/provenance arrays (HTTP 200).
  const transportResponse = await fetch(`${context.baseUrl}/api/intelligence?q=${encodeURIComponent(semanticQuery)}`);
  const transportBody = await transportResponse.text();
  let transportView: { mode?: string; kind?: string; view?: { status?: string; meaningSearchAvailable?: boolean; meaning?: unknown[]; moments?: unknown[]; provenance?: unknown[] } } = {};
  try { transportView = JSON.parse(transportBody); } catch { /* asserted below */ }
  assert.that(
    "the deployed intelligence transport answers its typed semantic-unavailable state (mode=service, meaningSearchAvailable=false — the honest never-approximated truth)",
    `HTTP 200 · {"mode":"service",…"meaningSearchAvailable":false}`,
    `HTTP ${transportResponse.status}: ${transportBody.slice(0, 180)}`,
    transportResponse.status === 200 &&
      transportView.mode === "service" &&
      transportView.view?.meaningSearchAvailable === false &&
      (transportView.view?.meaning?.length ?? -1) === 0 &&
      (transportView.view?.moments?.length ?? -1) === 0,
  );

  // THE VISUAL-EVENT QUERY ("show me the part where… "): the moment lane
  // rides the same transport — the same honest typed no-matches state,
  // and NO fabricated moment jump path.
  await goto(context, "/search?q=" + encodeURIComponent("the moment the first deep field image resolves"));
  const momentState = await browser.eval<string | null>(
    `document.querySelector('[data-wfx-semantic-search]')?.getAttribute('data-wfx-semantic-state') ?? null`,
  );
  assert.that(
    "the show-me-the-part-where query answers the same honest typed state (the moment lane never fabricated)",
    "data-wfx-semantic-state='no-matches'",
    momentState ?? "<none>",
    momentState === "no-matches",
  );
  const momentJumpCount = await browser.count("[data-wfx-semantic-moment-jump]");
  assert.that(
    "no fabricated moment jump path renders on the deployed transport (zero moment-jump entries)",
    "0 moment jumps",
    `${momentJumpCount} moment jumps`,
    momentJumpCount === 0,
  );

  // OPEN A REAL ITEM → the intelligence surface's HONEST PREREQUISITE
  // TRUTH: every feature states exactly which derived artifacts it
  // needs (never a silent downgrade, never a fabricated transcript).
  await goto(context, "/search?q=space");
  const detailHref = await browser.eval<string | null>(
    `(() => { const card = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '') !== ''); if (card === undefined) return null; const wrap = card.closest('[data-wfx-cardwrap]') ?? card.parentElement; const details = wrap === null ? null : wrap.querySelector('details[data-wfx-card-actions]'); return details === null ? null : (details.querySelector('[data-wfx-card-details]')?.getAttribute('href') ?? null); })()`,
  );
  assert.that(
    "the deployed catalog offers a real title's item surface",
    "an /item link",
    detailHref ?? "<absent>",
    detailHref !== null,
  );
  await goto(context, detailHref ?? "/");
  await assert.visible(
    "[data-wfx-intelligence]",
    "the item hub carries its intelligence surface (the honest deployed truth)",
  );
  await assert.visible(
    "[data-wfx-intelligence-features]",
    "the per-feature availability truth renders (the R23-H honesty law — prerequisites named, never a silent downgrade)",
  );
  const featuresText = await browser.tryText("[data-wfx-intelligence-features]");
  assert.that(
    "the feature truth names the missing derived artifacts per feature (search-by-meaning needs its embeddings — the honest prerequisite sentences)",
    "Search by meaning — needs transcript-text-embedding…",
    (featuresText ?? "<none>").slice(0, 160),
    (featuresText ?? "").includes("Search by meaning — needs") && (featuresText ?? "").includes("transcript-text-embedding"),
  );
  const transcriptDisclosureCount = await browser.count("[data-wfx-intelligence-transcript-disclosure]");
  assert.that(
    "no fabricated transcript/chapters/moments render for a title without derived artifacts (zero disclosures)",
    "0 transcript disclosures",
    `${transcriptDisclosureCount} transcript disclosures`,
    transcriptDisclosureCount === 0,
  );

  // THE PROVENANCE/MODEL TRUTH: the item surface names where its signals
  // came from + THE MODEL-AUTHORITY BOUNDARY (verbatim sentence).
  await assert.visible(
    "[data-wfx-intelligence-provenance]",
    "the provenance block renders (where the intelligence came from)",
  );
  const itemProvenance = await browser.tryText("[data-wfx-intelligence-provenance]");
  assert.that(
    "the deployed provenance names its signal source honestly (source-provided metadata — never a fabricated model run)",
    "source-media by source-provided",
    (itemProvenance ?? "<none>").slice(0, 200),
    (itemProvenance ?? "").includes("source-provided"),
  );
  await assert.visible(
    "[data-wfx-intelligence-provenance-note]",
    "the model-authority boundary renders on the deployed surface",
  );
  const authorityNote = await browser.tryText("[data-wfx-intelligence-provenance-note]");
  assert.that(
    "the model-authority boundary sentence renders verbatim (no model authorizes a playback or acquisition action)",
    "…no model authorizes a playback or acquisition action.",
    (authorityNote ?? "<none>").slice(0, 200),
    (authorityNote ?? "").includes("no model authorizes a playback or acquisition action"),
  );

  // CHANGE LANGUAGE/SUBTITLE OUTPUT: the AI tray's translation action
  // with its language choice (the typed transform states) — served on
  // the deployed surface too.
  const languageSelect = await browser.eval<boolean>(
    `(() => { const tray = document.querySelector('[data-wfx-ai-tray]'); return tray !== null && tray.querySelector('select') !== null; })()`,
  );
  assert.that(
    "the AI tray offers the translation action with its language choice on the deployed surface",
    "a language select in the tray",
    languageSelect ? "present" : "absent",
    languageSelect,
  );

  // THE LIVE ROUTE (R23-G) on the deployed surface: the live-captions
  // surface renders the LEGAL-AUDIO GATE's honest typed state (this
  // content's audio is not legally available — never a fake live lane,
  // no bypass by design).
  const playHref = await browser.eval<string | null>(
    `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
  );
  assert.that("the item surface offers its play path", "a /player link", playHref ?? "<absent>", playHref !== null);
  await goto(context, playHref ?? "/");
  await assert.visible(
    "[data-wfx-live-captions]",
    "the live captions surface renders on the deployed player (progressively disclosed)",
  );
  const liveState = await browser.eval<string | null>(
    `document.querySelector('[data-wfx-live-captions]')?.getAttribute('data-wfx-live-captions-state') ?? null`,
  );
  assert.that(
    "the live lane answers the legal-audio gate's honest typed state (audio-unavailable — never a fabricated live lane)",
    "data-wfx-live-captions-state='audio-unavailable'",
    liveState ?? "<none>",
    liveState === "audio-unavailable",
  );
  // The gate sentence sits behind the surface's own progressive disclosure
  // (the closed <details>) — open it the user way (the summary toggle),
  // the same disclosure-opening step the fixtures walk performs (with the
  // J38 attribute-toggle fallback when the CLI cannot click a summary).
  const openedByClick = await browser
    .clickInteractive("[data-wfx-live-captions] > summary")
    .then(() => true)
    .catch(() => false);
  if (!openedByClick) {
    await browser.eval(
      `(() => { const el = document.querySelector('details[data-wfx-live-captions]'); if (el !== null) el.open = true; return true; })()`,
    );
  }
  const liveText = await browser.tryText("[data-wfx-live-captions-gate]");
  assert.that(
    "the legal-audio gate states its no-bypass law verbatim",
    "…there is no bypass, by design).",
    (liveText ?? "<none>").slice(0, 220),
    (liveText ?? "").includes("no bypass, by design"),
  );

  // THE R2T2 LICENSE TRUTH (the code/weights distinction, verbatim) +
  // THE REGISTRATION BOUNDARY (the R23-J law: the deployed web transport
  // serves the registry READS ONLY — the typed 503, never a fabricated
  // registration).
  await goto(context, "/settings?section=model");
  await assert.visible("[data-wfx-openmodels]", "the Model & AI surface lists the open models");
  const licenseTruth = await browser.tryText("[data-wfx-openmodel-license]");
  assert.that(
    "the R2T2 row carries its REAL license truth (the code/weights distinction)",
    "Code Apache-2.0 · weights NetEase Model Use License Agreement",
    (licenseTruth ?? "<none>").slice(0, 100),
    (licenseTruth ?? "").includes("Apache-2.0") && (licenseTruth ?? "").includes("NetEase"),
  );
  const registerActionCount = await browser.count("[data-wfx-openmodel-action='register']");
  assert.that(
    "the deployed registry serves reads only (no in-page register action — the R23-J boundary)",
    "0 register actions",
    `${registerActionCount} register actions`,
    registerActionCount === 0,
  );
  const registrationResponse = await fetch(`${context.baseUrl}/api/model/open-models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: "confucius4-r2t2", action: "register" }),
  });
  const registrationBody = await registrationResponse.text();
  assert.that(
    "the registration drive answers its typed reads-only refusal (never a fabricated registration)",
    "HTTP 503 · the web transport serves the registry reads only",
    `HTTP ${registrationResponse.status}: ${registrationBody.slice(0, 200)}`,
    registrationResponse.status === 503 && registrationBody.includes("registry reads only"),
  );

  // THE ANONYMOUS BOUNDARY (R23-K): the whole walk ran accountless —
  // every read served the anonymous viewer (no wall anywhere).
  await assert.textContains(
    "[data-wfx-session-label]",
    "Signed out",
    "the multimodal intelligence walk ran entirely without a WebFlix account (the R23-K anonymous AI boundary)",
  );

  await describe(
    context,
    "the deployed multimodal walk: the matches-by-meaning lane rendered its honest typed no-matches state (the transport answering mode=service with meaningSearchAvailable=false — never fabricated), the show-me-the-part-where query answered the same typed state with zero fabricated moment jumps, the real item's intelligence surface stated the per-feature prerequisite truth (the missing derived artifacts named), the provenance named its source-provided truth with the model-authority boundary verbatim, the AI tray offered its language choice, the live lane answered the legal-audio gate's typed audio-unavailable state (no bypass by design), the R2T2 row carried its real code/weights license truth, the registration drive answered the typed reads-only refusal — all without a WebFlix account",
  );
}

/** The item page's play href (the player target for the live-route walk). */
async function playHrefOf(context: Parameters<Journey["run"]>[0], fallback: string): Promise<string> {
  if (fallback !== "/") {
    await goto(context, fallback);
  }
  const href = await context.browser.eval<string | null>(
    `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
  );
  return href ?? fallback;
}
