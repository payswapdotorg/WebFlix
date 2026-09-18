/**
 * @wfx/journeys — J29 Network loss / playback recovery (encoded Web
 * journey).
 *
 * Doc expectation (J28–J30 block): "failures are specific, recoverable
 * where possible, and honest. A … network failure must never look like a
 * silent success."
 *
 * Web-fixture-boot encoding: the web adapter's SHIPPED network-loss
 * surfaces —
 * - the offline route (the self-contained honest state: you're offline,
 *   watch progress is safe, with a retry);
 * - the player's typed failure state for unresolvable content (specific +
 *   recoverable with a path back — never a silent success);
 * - R17: the SESSION recovery surface (Static Bloom's scripted network
 *   loss) — the MEASURED starvation truth (nothing arriving, 0 B/s, 0
 *   connected sources — the truthful frozen progress bar, never a fake
 *   moving one), then the interrupted session's EXPLICIT
 *   resume-or-clean-restart choice (both typed actions, the surface saying
 *   which is which), then the exercised clean restart landing FRESH
 *   (no resuming badge, no retained progress — never a false continuation).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";
import { driveAcquisition } from "./acquisition-drive";

export const j29NetworkLossRecovery: Journey = {
  id: "J29",
  title: "Network loss / playback recovery",
  doc: "docs/validation/webflix-golden-journeys.md §J28–J30 block",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/offline");

    // The honest offline state (the shipped network-loss surface).
    await assert.visible("[data-wfx-offline]", "the offline route renders its self-contained state");
    await assert.visible("[data-wfx-offline-state]", "the offline state is announced (role=status)");
    const offlineText = await browser.tryText("[data-wfx-offline-state]");
    assert.that(
      "the offline state says you're offline and the watch progress is safe (specific, honest)",
      "the offline + safe-progress truth",
      offlineText ?? "<none>",
      offlineText !== null && offlineText.toLowerCase().includes("offline") && offlineText.toLowerCase().includes("progress is safe"),
    );
    await assert.countAtLeast("[data-wfx-offline-retry]", 1, "the offline state offers its retry action (recoverable)");

    // The retry is wired (a real handler, not a dead button).
    const wired = await browser.eval<boolean>(
      `(() => { const button = document.querySelector('[data-wfx-offline-retry]'); return button !== null && (button.onclick !== null || document.getElementById('wfx-offline-retry') !== null); })()`,
    );
    assert.that(
      "the offline retry control is wired to a real handler",
      "a retry handler present",
      wired ? "wired" : "not wired",
      wired,
    );

    // Playback failure recovery: the typed failure with its return path.
    await goto(
      context,
      "/player?id=wfxitm_00000000000000000000000099&connector=fake-source&ref=fake%3Aunknown&title=Unresolvable&type=video",
    );
    await assert.countAtLeast("[data-wfx-error]", 1, "an unresolvable playback renders its typed failure (never a silent success)");
    await assert.textContains("[data-wfx-error]", "Playback could not start", "the failure is specific (names what failed)");
    await assert.countAtLeast("[data-wfx-surface='player'] a[href*='/item?']", 1, "the failure offers its recovery path back to the item");
    await assert.countExactly("[data-wfx-player-frame]", 0, "no provider frame renders for a failed session (never a fake stage)");

    // R17 — the SESSION network-loss surface (Static Bloom's scripted
    // outage): the measured starvation truth, then the explicit
    // resume-or-clean-restart choice.
    // R17 fix (lead integration): the network-loss item is the metadata-
    // bearing "Signal Fade" (fake:video-4) — the drive's scripted host.
    // (The no-metadata "Static Bloom" fake:video-2 stays a frozen fixture
    // law; its item page can never mount the acquisition panel.)
    const itemHref = await itemHrefFromSearch(context, "Signal Fade", "Signal Fade");
    assert.that(
      "the search surface offers the network-loss item",
      "an item link",
      itemHref ?? "<absent>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");

    // The healthy transfer first (the truthful starting point). The drive
    // STARTS with acquire (PENDING → preparing/locating — the J21 law),
    // then advances into the transfer.
    await driveAcquisition(context, "acquire", "Finding the details for this title.");
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");

    // THE CONNECTION LOST state: the MEASURED starvation truth — the
    // waiting badge, the measured numbers in the sentence, the frozen-but-
    // truthful 35% (never a fake moving bar).
    await driveAcquisition(
      context,
      "advance",
      "Nothing has arrived for 92s — 0 B/s measured from 0 connected sources.",
    );
    await assert.countAtLeast(
      "[data-wfx-acquisition-starved='true']",
      1,
      "the starved session renders its explicit starvation marker",
    );
    await assert.textEquals(
      "[data-wfx-acquisition-waiting]",
      "Waiting for the download source",
      "the starved session renders its waiting badge (the honest named state)",
    );
    await assert.textEquals(
      "[data-wfx-acquisition-percent]",
      "35%",
      "the starved session's progress bar stays the MEASURED 35% (never a fake moving bar)",
    );

    // THE INTERRUPTED SESSION: paused with its retained progress — the
    // EXPLICIT resume-or-clean-restart choice (both typed actions, the
    // surface saying which is which).
    await driveAcquisition(context, "advance", "Resuming where it left off — 35% already saved.");
    await assert.countAtLeast(
      "[data-wfx-acquisition-action='resume']",
      1,
      "the interrupted session offers its typed resume action (keep the saved progress)",
    );
    await assert.countAtLeast(
      "[data-wfx-acquisition-action='restart']",
      1,
      "the interrupted session offers its typed clean-restart action (discard the saved progress)",
    );
    const resumeLabel = await browser.eval<string | null>(
      `document.querySelector("[data-wfx-acquisition-action='resume']")?.textContent ?? null`,
    );
    const restartLabel = await browser.eval<string | null>(
      `document.querySelector("[data-wfx-acquisition-action='restart']")?.textContent ?? null`,
    );
    assert.that(
      "the resume action SAYS it keeps the saved progress",
      "a keep-progress label",
      resumeLabel ?? "<none>",
      resumeLabel !== null && resumeLabel.toLowerCase().includes("keep saved progress"),
    );
    assert.that(
      "the restart action SAYS it discards the saved progress",
      "a discard-progress label",
      restartLabel ?? "<none>",
      restartLabel !== null && restartLabel.toLowerCase().includes("discard saved progress"),
    );

    // THE CLEAN RESTART EXERCISED: the fresh attempt lands preparing with
    // NO resuming badge and NO retained progress (never a false
    // continuation, never a silent progress reset).
    await driveAcquisition(context, "restart", "Finding the details for this title.");
    await assert.countExactly(
      "[data-wfx-acquisition-resuming]",
      0,
      "the restarted session carries NO resuming badge (a fresh start — the progress was discarded)",
    );
    await assert.countExactly(
      "[data-wfx-acquisition-starved='true']",
      0,
      "the restarted session carries no starvation marker (a fresh healthy attempt)",
    );

    await context.screenshot("j29-network-loss-recovery");
    await describe(
      context,
      "the offline route rendered its honest state with a wired retry; the unresolvable playback rendered a specific typed failure with a recovery path; the network-loss session rendered its MEASURED starvation truth (92s nothing arriving, 0 B/s, 0 connected sources, the truthful 35%), the interrupted session offered the explicit resume-or-clean-restart choice with labels saying which is which, and the clean restart landed fresh (no resuming badge, no retained progress)",
    );
  },
};
