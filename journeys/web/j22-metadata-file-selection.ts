/**
 * @wfx/journeys — J22 Torrent metadata and file selection (encoded Web
 * journey — the Web LIMITED-STATUS surface).
 *
 * Doc expectation: metadata + file selection before the download (the
 * choosing step of the lifecycle).
 *
 * Web-fixture-boot encoding: the choosing-files step renders the
 * PREPARING state with its file-selection detail sentence ("Preparing
 * the files you selected."), the honest 0% progress (known-but-zero,
 * never fabricated), and the GATED diagnostics naming the selection
 * phase ("selecting") inside the closed disclosure — the technical
 * detail exists for troubleshooting but is not primary UX.
 *
 * R35b re-encode: the acquisition lifecycle surface is the ITEM hub (the
 * R28-B mount — the acquisition panel + the gated diagnostics ride
 * `ItemDetailSurface`); the journey reaches it through the search card's
 * kebab Details deep path (the card's primary link is the one-click
 * /player href).
 */

import { describe } from "./journey-description";
import { assertAcquisition, diagnosticsSessionState, driveAcquisition } from "./acquisition-drive";
import type { Journey, JourneyContext } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** The R28-B deep-surface path: the search card kebab's Details link href
 * (the /item detail is the card's quiet deep action; the primary link is
 * the one-click /player href). Reads the DOM's own server-rendered href. */
async function detailHrefFromSearch(
  context: JourneyContext,
  query: string,
  cardTitle: string,
): Promise<string | null> {
  await goto(context, `/search?q=${encodeURIComponent(query)}`);
  return context.browser.eval<string | null>(
    `(() => { const card = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(cardTitle)})); if (card === undefined) return null; const wrap = card.closest('[data-wfx-cardwrap]') ?? card.parentElement; const details = wrap === null ? null : wrap.querySelector('details[data-wfx-card-actions]'); return details === null ? null : (details.querySelector('[data-wfx-card-details]')?.getAttribute('href') ?? null); })()`,
  );
}

export const j22MetadataFileSelection: Journey = {
  id: "J22",
  title: "Torrent metadata and file selection (web limited-status surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J21–J25 (matrix: Web = Limited status UX)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    // binds R28-B deep surface: the search card's kebab Details link →
    // the item hub (where the acquisition panel mounts).
    const itemHref = await detailHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    await goto(context, itemHref ?? "/");

    // The scripted acquisition is already preparing (J21's drive order
    // is deterministic: the runner resets the drive state before the run).
    const state = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-acquisition-state]')?.getAttribute('data-wfx-acquisition-state') ?? null`,
    );
    assert.that(
      "the scripted acquisition is in its preparing phase (the deterministic run order from J21)",
      "the preparing state",
      state ?? "<none>",
      state === "preparing" || state === "available",
    );

    // Advance to the choosing-files step.
    await driveAcquisition(context, "advance", "Preparing the files you selected.");
    await assertAcquisition(context, "preparing", "Preparing the files you selected.");

    // The honest zero progress (the fraction is known-but-zero — a bar, never a fake number).
    const percent = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-acquisition-percent]')?.textContent ?? null`,
    );
    assert.that(
      "the choosing step renders its truthful known progress (0%)",
      "a 0% progress readout",
      percent ?? "<no percent>",
      percent === "0%",
    );

    // The gated diagnostics name the SELECTION phase.
    const sessionState = await diagnosticsSessionState(context);
    assert.that(
      "the gated advanced diagnostics name the file-selection phase (metadata resolved, files being selected)",
      "the 'selecting' session state inside the disclosure",
      sessionState ?? "<none>",
      sessionState === "selecting",
    );

    // The default surface still carries the user vocabulary only.
    const detail = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-acquisition-detail]')?.textContent ?? null`,
    );
    assert.that(
      "the choosing detail is user vocabulary (what is being prepared, not protocol jargon)",
      "the files-you-selected sentence",
      detail ?? "<none>",
      detail === "Preparing the files you selected.",
    );

    await context.screenshot("j22-metadata-file-selection");
    await describe(context, "the choosing-files step rendered its preparing state, the honest 0% progress, and the gated 'selecting' diagnostics");
  },
};
