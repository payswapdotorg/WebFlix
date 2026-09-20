/**
 * @wfx/journeys — J20 AI subtitles / translation / transcription /
 * dubbing / commentary (encoded Web journey).
 *
 * Doc expectation (matrix J20): the AI media transformation operations
 * with explicit states.
 *
 * Web-fixture-boot encoding (R21-E re-encode — the R21-C precedent
 * applied when the transport completed): the AI ACTION TRAY is the web
 * surface of the transforms transport (the R21-B/R21-C model-controls
 * seam; the fixtures persona answers the service shapes
 * deterministically). The tray's five frozen actions render with their
 * model-class truth; a submission answers the TYPED operation with its
 * EXPLICIT state (queued — explicit states only, NEVER fabricated
 * progress); the chained actions (subtitles, dubbing) render their
 * named precondition (discoverable + explained, never dead buttons);
 * and the same tray rides the player.
 *
 * HONEST LIMIT (listed, updated): the full pipeline's running→succeeded
 * transitions (real progress + result payloads) are the service-side
 * fabric (apps/api /experience/transforms over the model fabric); the
 * fixtures persona answers queued operations deterministically. The
 * manifest limitation names the local procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, openHomeAndClickCard } from "../lib/journeys";

export const j20AiTransforms: Journey = {
  id: "J20",
  title: "AI subtitles / translation / transcription / dubbing / commentary",
  doc: "docs/validation/webflix-golden-journeys.md §J20 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // The Model & AI settings section still names the transformation
    // scope (the tray's detailed-management home).
    await goto(context, "/settings?section=model");
    await assert.visible("[data-wfx-settings-model]", "the Model & AI section renders (the AI transformation surface's management home)");
    const text = await browser.tryText("[data-wfx-settings-model]");
    for (const term of ["transcription", "subtitles", "translation", "dubbing", "commentary"]) {
      assert.that(
        `the management home names the '${term}' transformation (the scope is stated, never hidden)`,
        `the section text mentions ${term}`,
        (text ?? "").includes(term) ? "named" : "not named",
        (text ?? "").includes(term),
      );
    }

    // The AI ACTION TRAY on the item decision hub: the contextual entry.
    await goto(context, "/");
    await openHomeAndClickCard(context, "Asteroid Drift");
    await assert.visible("[data-wfx-ai-tray]", "the AI action tray renders on the item decision hub (the contextual entry — no Settings-first path required)");

    // The tray's vocabulary is named BEFORE any interaction (server
    // HTML — no hydration gate on discoverability).
    const traySummary = await browser.tryText("[data-wfx-ai-tray-vocabulary]");
    assert.that(
      "the tray names the five-action vocabulary up front",
      "transcribe · subtitles · translate · dub · commentary",
      traySummary ?? "<none>",
      (traySummary ?? "").includes("transcribe") && (traySummary ?? "").includes("commentary"),
    );

    // Open the tray (the native <details> disclosure).
    await browser.clickInteractive("[data-wfx-ai-tray-toggle]");

    // The model-class truth + the Desktop platform truth ride the tray.
    const modelTruth = await browser.tryText("[data-wfx-ai-action-model]");
    assert.that(
      "the tray names which model class will run (the honest 'Not configured' names the first-party default — never a fabricated provider)",
      "a model-class sentence",
      modelTruth ?? "<none>",
      modelTruth !== null && modelTruth.length > 0,
    );
    const desktopTruth = await browser.tryText("[data-wfx-ai-tray-desktop-truth]");
    assert.that(
      "local-model execution carries its honest Desktop platform truth (unsupported is not undiscoverable)",
      "the Desktop sentence",
      desktopTruth ?? "<none>",
      (desktopTruth ?? "").includes("Desktop"),
    );

    // The chained actions carry their NAMED precondition (never a dead
    // button that lies about runnability).
    const precondition = await browser.tryText("[data-wfx-ai-precondition='subtitle']");
    assert.that(
      "the subtitles action names its precondition (composes from a transcript — discoverable + explained)",
      "the precondition sentence",
      precondition ?? "<none>",
      (precondition ?? "").includes("transcript"),
    );

    // Submit the transcript action: the typed operation with its
    // EXPLICIT state (queued — never fabricated progress).
    await browser.clickInteractive("[data-wfx-ai-submit='transcript']");
    await browser.waitSelector("[data-wfx-ai-operation]", 10_000);
    const operationState = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-ai-operation]')?.getAttribute('data-wfx-ai-operation-state') ?? null`,
    );
    assert.that(
      "the submission answers the TYPED operation state (queued — explicit states only)",
      "state='queued'",
      operationState ?? "<none>",
      operationState === "queued",
    );
    const operationSentence = await browser.tryText("[data-wfx-ai-operation-sentence]");
    assert.that(
      "the operation renders its state sentence with NO fabricated progress (no percent, no fake bar)",
      "a queued sentence without fabricated progress",
      operationSentence ?? "<none>",
      (operationSentence ?? "").includes("Queued") && !((operationSentence ?? "").includes("%")),
    );

    // The recovery path: a queued operation is cancellable on the spot.
    await assert.visible("[data-wfx-ai-cancel]", "the queued operation offers its cancel recovery on the spot");
    await browser.clickInteractive("[data-wfx-ai-cancel]");
    await browser.waitSelector("[data-wfx-ai-operation-state='cancelled']", 10_000);
    const cancelledSentence = await browser.tryText("[data-wfx-ai-operation-sentence]");
    assert.that(
      "the cancel recovery answers the typed cancelled state (reversible operations — never a silent no-op)",
      "the cancelled sentence",
      cancelledSentence ?? "<none>",
      (cancelledSentence ?? "").includes("Cancelled"),
    );

    // The Model & AI management path is one link away from the tray.
    await assert.visible("[data-wfx-ai-tray-manage]", "the tray carries the Model & AI management path (one link away)");

    // The same tray rides the PLAYER (transforming what is playing).
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    await goto(context, playHref ?? "/");
    await assert.visible(
      "[data-wfx-ai-tray-surface='player']",
      "the player carries the same AI action tray (transforming what is playing — the primary discovery surface)",
    );
    const playerTrayText = await browser.tryText("[data-wfx-ai-tray]");
    assert.that(
      "the player's tray names the transformation vocabulary too",
      "the vocabulary on the player tray",
      (playerTrayText ?? "").slice(0, 120),
      (playerTrayText ?? "").includes("transcribe"),
    );

    await context.screenshot("j20-ai-transforms");
    await describe(
      context,
      "the AI action tray rendered on the item decision hub and the player with the five-action vocabulary, the model-class truth, the Desktop platform truth, and the named preconditions; a transcript submission answered the typed queued operation with no fabricated progress, and the cancel recovery answered the typed cancelled state",
    );
  },
};
