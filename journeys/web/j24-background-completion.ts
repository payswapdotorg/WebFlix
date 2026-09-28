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
 *
 * R35b re-encode: the acquisition lifecycle surface is the ITEM hub (the
 * R28-B mount); the journey reaches it through the search card's kebab
 * Details deep path (the card's primary link is the one-click /player
 * href).
 */

import { describe } from "./journey-description";
import { assertAcquisition, driveAcquisition } from "./acquisition-drive";
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

export const j24BackgroundCompletion: Journey = {
  id: "J24",
  title: "Torrent background completion (web status surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J24 (matrix: Web = No native protocol)",
  ci: true,
  async run(context): Promise<void> {
    const { assert } = context;
    // binds R28-B deep surface: the search card's kebab Details link →
    // the item hub (where the acquisition panel mounts).
    const itemHref = await detailHrefFromSearch(context, "Asteroid", "Asteroid Drift");
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
