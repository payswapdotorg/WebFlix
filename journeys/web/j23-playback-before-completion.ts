/**
 * @wfx/journeys — J23 Torrent playback before full completion (encoded
 * Web journey — the Web LIMITED-STATUS surface; the native protocol
 * path is the Desktop equivalent procedure).
 *
 * Doc expectation: playback possible before the full asset completes;
 * failure to meet a deadline produces an explicit buffering state, not
 * false success.
 *
 * Web-fixture-boot encoding: the truthful status sequence — BUFFERING
 * (getting enough ready to play), PLAYING with its buffered runway
 * ("92s buffered ahead"), and the honest DEMOTION back to buffering
 * when the deadline is at risk ("Playback may pause — the video isn't
 * arriving fast enough to keep up."): never false playback success.
 */

import { describe } from "./journey-description";
import { assertAcquisition, driveAcquisition } from "./acquisition-drive";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j23PlaybackBeforeCompletion: Journey = {
  id: "J23",
  title: "Torrent playback before full completion (web status surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J23 (matrix: Web = No native protocol)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    const itemHref = await itemHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    await goto(context, itemHref ?? "/");

    // Advance through the transfer start into the buffering step.
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");
    await assertAcquisition(context, "completing", "Finishing the offline copy in the background.");

    // BUFFERING: playback declared before completion.
    await driveAcquisition(context, "advance", "Getting enough of the video ready to play smoothly.");
    await assertAcquisition(context, "buffering", "Getting enough of the video ready to play smoothly.");

    // PLAYING with its truthful runway.
    await driveAcquisition(context, "advance", "Playing while the rest of the offline copy is finished in the background.");
    await assertAcquisition(context, "playing", "Playing while the rest of the offline copy is finished in the background.");
    await assert.textEquals("[data-wfx-acquisition-runway]", "92s buffered ahead", "the playing state states its truthful buffered runway");
    await assert.textEquals("[data-wfx-acquisition-percent]", "55%", "the playing state states its truthful transfer progress");

    // The honest demotion: deadline at risk → back to buffering, never false success.
    await driveAcquisition(context, "advance", "Playback may pause — the video isn't arriving fast enough to keep up.");
    await assertAcquisition(
      context,
      "buffering",
      "Playback may pause — the video isn't arriving fast enough to keep up.",
    );
    const stillPlaying = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-acquisition-state]')?.getAttribute('data-wfx-acquisition-state') ?? null`,
    );
    assert.that(
      "a deadline-at-risk playback DEMOTES to buffering truthfully (never false playback success)",
      "the buffering state after the risk",
      stillPlaying ?? "<none>",
      stillPlaying === "buffering",
    );

    await context.screenshot("j23-playback-before-completion");
    await describe(context, "buffering → playing (92s runway, 55%) → the honest deadline-risk demotion back to buffering — playback truth before completion, never false success");
  },
};
