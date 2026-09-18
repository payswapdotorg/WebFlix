/**
 * @wfx/journeys — J24 Torrent background completion (encoded Web
 * journey — the Web LIMITED-STATUS surface).
 *
 * Doc expectation: authorized background completion after playback,
 * integrity verification, then the EARNED ready-offline verdict.
 *
 * Web-fixture-boot encoding: the completing (background) → verifying
 * ("Checking the finished files.") → READY OFFLINE sequence with the
 * earned verdict's size note ("87 kB · verified offline") and the
 * ready-offline action vocabulary (play offline / re-check) — the
 * verified-before-ready law visible in the user surface.
 */

import { describe } from "./journey-description";
import { assertAcquisition, driveAcquisition } from "./acquisition-drive";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j24BackgroundCompletion: Journey = {
  id: "J24",
  title: "Torrent background completion (web status surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J24 (matrix: Web = No native protocol)",
  ci: true,
  async run(context): Promise<void> {
    const { assert } = context;
    const itemHref = await itemHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    await goto(context, itemHref ?? "/");

    // Background completion (the transfer continues after playback).
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");
    await assertAcquisition(context, "completing", "Finishing the offline copy in the background.");
    await assert.textEquals("[data-wfx-acquisition-percent]", "80%", "the background completion states its truthful progress");

    // Integrity verification (the explicit checking step).
    await driveAcquisition(context, "advance", "Checking the finished files.");
    await assertAcquisition(context, "completing", "Checking the finished files.");
    await assert.textEquals("[data-wfx-acquisition-percent]", "100%", "the verification step states the complete transfer truthfully");

    // The completed transfer settles.
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");
    await assertAcquisition(context, "completing", "Finishing the offline copy in the background.");

    // The EARNED ready-offline verdict (verified before ready — never before).
    await driveAcquisition(context, "advance", "Verified and available to watch without a connection.");
    await assertAcquisition(context, "ready-offline", "Verified and available to watch without a connection.");
    await assert.textEquals("[data-wfx-acquisition-size]", "87 kB · verified offline", "the ready-offline verdict states its verified size");
    await assert.countAtLeast("[data-wfx-acquisition-action='play-offline']", 1, "the ready-offline state offers its typed play-offline action");
    await assert.countAtLeast("[data-wfx-acquisition-action='reverify-offline']", 1, "the ready-offline state offers its typed re-check action");
    await assert.countExactly("[data-wfx-acquisition-progress]", 0, "the ready-offline verdict renders no progress bar (completion is earned, not in flight)");

    await context.screenshot("j24-background-completion");
    await describe(context, "completing (80%) → verifying ('Checking the finished files.', 100%) → the earned ready-offline verdict with its verified size and typed actions");
  },
};
