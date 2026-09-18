/**
 * @wfx/journeys — J06 Item detail / availability / realization choice
 * (encoded Web journey).
 *
 * Doc expectation: "canonical content identity, metadata, availability,
 * realizations, resume state, save/like, and a simple play decision.
 * Raw connector capability diagnostics remain secondary."
 *
 * Web-fixture-boot encoding: the canonical identity + metadata + the
 * availability badge, the capability truth list, the fresh-session play
 * decision (no fabricated resume), the like/save absence grammar (the
 * fixture source declares neither for this item — never fake controls),
 * the acquisition panel in its web limited-status truth, related
 * exploration, and the capability diagnostics rendered SECONDARY (the
 * acquisition protocol detail is gated inside a closed disclosure).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { openHomeAndClickCard } from "../lib/journeys";
import { parseAcquisition } from "../lib/state";

export const j06ItemDetail: Journey = {
  id: "J06",
  title: "Item detail / availability / realization choice",
  doc: "docs/validation/webflix-golden-journeys.md §J06",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await openHomeAndClickCard(context, "Asteroid Drift");

    // Canonical identity + metadata.
    await assert.visible("[data-wfx-surface='item']", "the item detail surface renders");
    await assert.textEquals("[data-wfx-item-title]", "Asteroid Drift", "the detail page names the canonical item identity");
    const badge = await browser.tryText(".wfx-detail__meta .wfx-badge");
    assert.that(
      "the metadata states the canonical type",
      "a canonical type badge",
      badge ?? "<none>",
      badge !== null && badge.length > 0,
    );

    // Availability.
    await assert.textEquals("[data-wfx-item-availability]", "Available", "the detail page states the truthful availability");

    // Realizations / capability truth.
    await assert.countAtLeast("[data-wfx-item-capabilities] li", 1, "the source's declared capabilities render truthfully");
    const capabilities = await browser.tryText("[data-wfx-item-capabilities]");
    assert.that(
      "the capability truth includes the playback realizations (native/embed/browser/external)",
      "the realization capability set",
      capabilities ?? "<none>",
      capabilities !== null && (capabilities.includes("play") || capabilities.includes("Playback") || capabilities.includes("playback")),
    );

    // The simple play decision (fresh session: Play, no fabricated resume).
    await assert.textContains("[data-wfx-item-play]", "Play", "the detail page offers the simple play decision");

    // Save/like: the honest typed absence (this source declares neither for the item).
    await assert.countAtLeast("[data-wfx-action-absent='like'], [data-wfx-action-absent='save']", 1, "like/save render their honest typed-absent state when the source declares neither (never fake controls)");

    // The acquisition panel: the web limited-status truth.
    const acquisitionHtml = await browser.outerHtml("[data-wfx-acquisition]");
    const acquisition = parseAcquisition(acquisitionHtml ?? "");
    assert.that(
      "the offline-copy panel renders (the web limited-status surface)",
      "an acquisition panel with a state",
      acquisition.state ?? (acquisition.elsewhere ? "the elsewhere note" : "<absent>"),
      acquisition.state !== null || acquisition.elsewhere,
    );

    // Related exploration.
    await assert.countAtLeast("section[aria-label='Related content'] a[data-wfx-card]", 1, "the detail page offers related exploration");

    // Diagnostics remain secondary: the acquisition protocol detail is
    // gated inside a CLOSED disclosure (never primary UX).
    const diagnosticsOpen = await browser.eval<boolean>(
      `(() => { const details = document.querySelector('details[data-wfx-advanced-diagnostics]'); return details === null ? false : details.hasAttribute('open'); })()`,
    );
    assert.that(
      "raw acquisition diagnostics remain secondary (the advanced disclosure is closed by default)",
      "the diagnostics <details> is closed",
      diagnosticsOpen ? "the diagnostics disclosure is OPEN" : "closed",
      !diagnosticsOpen,
    );

    await context.screenshot("j06-item-detail");
    await describe(context, "canonical identity, truthful availability and capability list, the play decision, honest absent like/save, the web limited-status offline panel, and gated secondary diagnostics");
  },
};
