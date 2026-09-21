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

    await context.screenshot("j39-media-intelligence");
    await describe(
      context,
      "the multimodal walk: a natural-language query found the space documentary by what it IS with honest provenance and the ownership law, the show-me-the-part-where query landed on the findable moment and jumped into the player at its timestamp, the item disclosed its transcript (speaker-attributed), chapters, and moments with jump paths plus the per-feature prerequisite truth, the provenance named every contributing model with the model-authority boundary, the translation action carried its language choice, the live-captions surface answered the honest unregistered gap with its recovery and then routed to R2T2 (with its real license truth and envelope) once registered through Model & AI — all without a WebFlix account",
    );
  },
};

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
