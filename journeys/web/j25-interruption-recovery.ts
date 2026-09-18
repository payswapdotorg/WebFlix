/**
 * @wfx/journeys — J25 Torrent interruption / restart / resume (encoded
 * Web journey — the Web LIMITED-STATUS surface).
 *
 * Doc expectation: "Interruption must preserve sufficient persistent
 * state to recover the session without falsely claiming completion."
 *
 * Web-fixture-boot encoding: the RECOVERABLE failure grammar (the typed
 * cause, the recoverable marker, the retry action, the honest "You can
 * try again." sentence — never a silent success); the RETRY landing
 * back at PREPARING (the restart); and the RESUMING truth on the
 * interrupted session (Deep Field's retained progress: the "Resuming"
 * badge, the "55% already saved" sentence, the 62% transfer — resumed,
 * never a fresh restart lying about completion).
 */

import { describe } from "./journey-description";
import { assertAcquisition, driveAcquisition } from "./acquisition-drive";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j25InterruptionRecovery: Journey = {
  id: "J25",
  title: "Torrent interruption / restart / resume (web status surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J25 + §J21–J25 block (matrix: Web = No native protocol)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // The recoverable failure (Desert Rain Doc's scripted interruption).
    const failedHref = await itemHrefFromSearch(context, "Desert Rain", "Desert Rain Doc");
    assert.that("the search surface offers the interrupted-acquisition item", "an item link", failedHref ?? "<absent>", failedHref !== null);
    await goto(context, failedHref ?? "/");

    await assertAcquisition(context, "failed", "The download source had a problem. You can try again.");
    await assert.attrEquals("[data-wfx-acquisition-failure]", "data-wfx-acquisition-failure", "source-problem", "the failure renders its typed cause");
    await assert.attrEquals("[data-wfx-acquisition-failure]", "data-wfx-acquisition-recoverable", "true", "the failure is marked recoverable (typed truth)");
    await assert.textContains("[data-wfx-acquisition-failure]", "You can try again.", "the recoverable failure states the retry truth");
    await assert.countAtLeast("[data-wfx-acquisition-action='retry']", 1, "the failed state offers its typed retry action");
    await assert.countAtLeast("[data-wfx-acquisition-action='dismiss']", 1, "the failed state offers its typed dismiss action");

    // The RETRY restarts honestly (lands at preparing/locating — not a
    // fabricated completion, not a silent success).
    await driveAcquisition(context, "retry", "Finding the details for this title.");
    await assertAcquisition(context, "preparing", "Finding the details for this title.");

    // The interrupted session resumed WITH retained progress (Deep Field
    // Diary's scripted resume — never fresh, never falsely complete).
    const resumedHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that("the search surface offers the resumed-session item", "an item link", resumedHref ?? "<absent>", resumedHref !== null);
    await goto(context, resumedHref ?? "/");
    await assertAcquisition(
      context,
      "completing",
      "Finishing the offline copy in the background. Resuming where it left off — 55% already saved.",
    );
    await assert.textEquals("[data-wfx-acquisition-resuming]", "Resuming", "the resumed session carries its Resuming badge (never presented as a fresh start)");
    await assert.textEquals("[data-wfx-acquisition-percent]", "62%", "the resumed session states its truthful retained+progressed transfer (62% — not reset, not falsely complete)");
    const state = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-acquisition-state]')?.getAttribute('data-wfx-acquisition-state') ?? null`,
    );
    assert.that(
      "the interrupted session does NOT claim completion (the honest in-progress truth)",
      "an in-progress state (not ready-offline)",
      state ?? "<none>",
      state !== null && state !== "ready-offline",
    );

    await context.screenshot("j25-interruption-recovery");
    await describe(context, "the recoverable failure rendered its typed cause + retry; the retry landed preparing; the interrupted session resumed with its Resuming badge and 55%-saved/62% truth");
  },
};
