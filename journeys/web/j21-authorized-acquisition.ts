/**
 * @wfx/journeys — J21 Authorized torrent acquisition (encoded Web
 * journey — the Web LIMITED-STATUS surface; the full native protocol
 * path is the Desktop equivalent procedure).
 *
 * Doc expectation (J21–J25 block): the lifecycle
 * `authorized source → … → preparing → …` with the user-state
 * vocabulary; the journey matrix marks Web "Limited status UX".
 *
 * Web-fixture-boot encoding: the Available → Preparing transition over
 * the scripted authorized acquisition (the deterministic R14 feed):
 * the AVAILABLE state with its typed acquire action, the acquire click
 * landing PREPARING (locating) with the honest detail sentence, NO
 * fabricated progress while the fraction is honestly unknown (no bar
 * at locating), and the protocol vocabulary gated inside the closed
 * advanced-diagnostics disclosure (the J21 "no native protocol on Web"
 * law: the default surface carries no torrent terms).
 */

import { describe } from "./journey-description";
import { assertAcquisition, diagnosticsOpen, driveAcquisition } from "./acquisition-drive";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j21AuthorizedAcquisition: Journey = {
  id: "J21",
  title: "Authorized torrent acquisition (web limited-status surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J21–J25 (matrix: Web = Limited status UX)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    const itemHref = await itemHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    assert.that("the search surface offers the scripted authorized acquisition item", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");

    // The authorized basis is stated in the gated diagnostics (vault:family-media / user-owned).
    const provenance = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-diagnostics-provenance]')?.textContent ?? null`,
    );
    assert.that(
      "the acquisition's authorized source basis is recorded (the gated diagnostics carry the provenance)",
      "the provenance line (authorized source, user-owned basis)",
      provenance ?? "<none>",
      provenance !== null && provenance.includes("user-owned"),
    );

    // The AVAILABLE state with its typed acquire action.
    await assertAcquisition(context, "available", "Ready to be made available offline.");
    await assert.countAtLeast("[data-wfx-acquisition-action='acquire']", 1, "the available state offers its typed acquire action (user vocabulary — no torrent terms)");

    // No progress bar while the fraction is honestly unknown.
    await assert.countExactly("[data-wfx-acquisition-progress]", 0, "no progress bar renders while progress is honestly unknown (never a fake number)");

    // The acquire click lands PREPARING (locating) — the honest first step.
    await driveAcquisition(context, "acquire", "Finding the details for this title.");
    await assertAcquisition(context, "preparing", "Finding the details for this title.");
    await assert.countAtLeast("[data-wfx-acquisition-action='pause']", 1, "the preparing state offers its typed pause action");
    await assert.countExactly("[data-wfx-acquisition-progress]", 0, "the locating step renders no progress bar (the fraction is still honestly unknown)");

    // The protocol vocabulary stays gated (the default surface is protocol-free).
    const open = await diagnosticsOpen(context);
    assert.that(
      "the advanced diagnostics remain gated closed on the default surface (protocol terminology is not primary UX)",
      "the diagnostics disclosure closed",
      open ? "OPEN" : "closed",
      !open,
    );
    const panelText = await browser.tryText("[data-wfx-acquisition]");
    const protocolTerms = ["peer", "piece", "seed", "leech", "infohash", "info hash", "magnet", "torrent", "swarm"];
    const leaked = protocolTerms.filter((term) => (panelText ?? "").toLowerCase().includes(term));
    assert.that(
      "the default acquisition surface carries NO torrent protocol vocabulary (the J21 web law)",
      "no protocol terms in the panel text",
      leaked.length === 0 ? "clean" : `leaked: ${leaked.join(", ")}`,
      leaked.length === 0,
    );

    await context.screenshot("j21-authorized-acquisition");
    await describe(context, "available → (acquire) → preparing/locating with honest details, no fabricated progress, authorized provenance recorded, and the protocol vocabulary gated");
  },
};
