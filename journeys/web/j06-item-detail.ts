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
 *
 * R35b re-encode: the item hub is reached through the R28-B DEEP-SURFACE
 * path — the home card's primary link is the one-click /player href;
 * the card's quiet action row (the kebab) carries the Details link
 * ([data-wfx-card-details]) whose href is the /item URL. The journey
 * reads that href from the DOM (the SSR markup carries the contract)
 * and navigates it — the same href-reading law the harness follows
 * everywhere.
 */

import { describe } from "./journey-description";
import type { Journey, JourneyContext } from "../lib/journeys";
import { goto } from "../lib/journeys";
import { parseAcquisition } from "../lib/state";

/** The R28-B deep-surface path: the card kebab's Details link href (the
 * /item detail is the card's quiet deep action; the primary link is the
 * one-click /player href). Reads the DOM's own server-rendered href. */
async function detailHrefFromCard(
  context: JourneyContext,
  cardTitle: string,
): Promise<string | null> {
  return context.browser.eval<string | null>(
    `(() => { const card = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(cardTitle)})); if (card === undefined) return null; const wrap = card.closest('[data-wfx-cardwrap]') ?? card.parentElement; const details = wrap === null ? null : wrap.querySelector('details[data-wfx-card-actions]'); return details === null ? null : (details.querySelector('[data-wfx-card-details]')?.getAttribute('href') ?? null); })()`,
  );
}

export const j06ItemDetail: Journey = {
  id: "J06",
  title: "Item detail / availability / realization choice",
  doc: "docs/validation/webflix-golden-journeys.md §J06",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/");
    // binds R28-B one-click play: the card's primary link is the play path.
    const oneClickHref = await browser.eval<string | null>(
      `(() => { const link = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith("Asteroid Drift")); return link === undefined ? null : link.getAttribute('href'); })()`,
    );
    assert.that(
      "the home card's primary link is the one-click play path (the R28-B grammar)",
      "an id-first /player href",
      oneClickHref ?? "<none>",
      oneClickHref !== null && oneClickHref.startsWith("/player?id=wfxitm_"),
    );
    // binds R28-B deep surface: the card kebab's Details link ([data-wfx-card-details]).
    const itemHref = await detailHrefFromCard(context, "Asteroid Drift");
    assert.that(
      "the card's quiet action row carries the Details deep path to the item hub",
      "an /item?id=wfxitm_… Details href",
      itemHref ?? "<none>",
      itemHref !== null && itemHref.startsWith("/item?id=wfxitm_"),
    );
    await goto(context, itemHref ?? "/");

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
    // binds the R28-B mount: ActionButtons ([data-wfx-action-absent]) on the item surface.
    await assert.countAtLeast("[data-wfx-action-absent='like'], [data-wfx-action-absent='save']", 1, "like/save render their honest typed-absent state when the source declares neither (never fake controls)");

    // The acquisition panel: the web limited-status truth.
    // binds the R28-B mount: the acquisition panel on the item surface.
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
    await describe(context, "reached the item hub through the card's Details deep path: canonical identity, truthful availability and capability list, the play decision, honest absent like/save, the web limited-status offline panel, and gated secondary diagnostics");
  },
};
