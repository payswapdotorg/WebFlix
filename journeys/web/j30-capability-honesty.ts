/**
 * @wfx/journeys — J30 Unsupported capability honesty (encoded Web
 * journey).
 *
 * Doc expectation (J28–J30 block): failures/capability limits are
 * honest; "an unsupported playback mode … must never look like a silent
 * success."
 *
 * Web-fixture-boot encoding: the capability truth table renders every
 * area with its supported/unsupported truth (native media and torrent
 * acquisition honestly "Not available on Web"), the descriptor line
 * states the adapter identity the runtime booted on, and the
 * unsupported-action grammar (like/save absent notes — J10's law) holds
 * on the playback surface too.
 *
 * R35b re-encode: the typed-absent action grammar is read from the ITEM
 * surface (the R28-B mount — `ActionButtons` rides `ItemDetailSurface`);
 * the player's action row is the R29-B `WatchActions` split pill, whose
 * honest unset state (`data-wfx-reaction="none"`) and zero provider-sync
 * notes the journey asserts on the playback surface.
 */

import { describe } from "./journey-description";
import type { Journey, JourneyContext } from "../lib/journeys";
import { goto } from "../lib/journeys";
import { parseActionbar, parseSettings } from "../lib/state";

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

export const j30CapabilityHonesty: Journey = {
  id: "J30",
  title: "Unsupported capability honesty",
  doc: "docs/validation/webflix-golden-journeys.md §J28–J30 block",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings");

    // The truth table: every row states its supported/unsupported chip.
    await assert.countAtLeast("[data-wfx-settings-capabilities] li[data-wfx-capability]", 5, "the capability truth table renders every platform area");
    const settingsHtml = await browser.outerHtml("[data-wfx-surface='settings']");
    const settings = parseSettings(settingsHtml ?? "");
    const rowAreas = settings.capabilityRows.map((row) => row.area);
    const expectedAreas = ["storage", "contained browser", "native media & torrent acquisition", "background work", "sharing", "notifications"];
    for (const area of expectedAreas) {
      assert.that(
        `the truth table covers the '${area}' capability area`,
        `a row for '${area}'`,
        rowAreas.join(", ") || "<none>",
        rowAreas.includes(area),
      );
    }
    assert.that(
      "the native-media area declares itself NOT available on Web (the honest unsupported state — never silent, never faked)",
      "the native row carries the unsupported chip",
      settings.capabilityRows.some((row) => row.area === "native media & torrent acquisition" && row.unsupported)
        ? "unsupported chip present"
        : "no unsupported chip",
      settings.capabilityRows.some((row) => row.area === "native media & torrent acquisition" && row.unsupported),
    );

    // The descriptor truth (the declaration the runtime booted on).
    await assert.textContains("[data-wfx-capability-descriptor]", "wfx-web-adapter", "the adapter's own descriptor is stated (the truth the runtime booted on)");
    const descriptor = await browser.tryText("[data-wfx-capability-descriptor]");
    assert.that(
      "the descriptor states the platform truth and that a lying bundle cannot boot",
      "the re-check law stated",
      descriptor ?? "<none>",
      descriptor !== null && descriptor.includes("lying bundle cannot boot"),
    );

    // The unsupported-action grammar: the typed-absent notes render on the
    // ITEM surface (the R28-B mount); the player half below binds the
    // R29-B action-row grammar.
    // binds R28-B deep surface: the search card's kebab Details link → the item hub.
    const itemHref = await detailHrefFromSearch(context, "Harbor", "Harbor Lights");
    await goto(context, itemHref ?? "/");
    const itemHtml = await browser.outerHtml("[data-wfx-surface='item']");
    const itemActionbar = parseActionbar(itemHtml ?? "");
    assert.that(
      "the item surface's like/save render their typed absent notes (unsupported never looks like success)",
      "absent like + save notes",
      itemActionbar.absent.join(", ") || "<no absent markers>",
      itemActionbar.absent.includes("like") && itemActionbar.absent.includes("save"),
    );
    assert.that(
      "no settled action state masquerades as provider-confirmed on the item surface",
      "zero settled action states",
      itemActionbar.settledStates.length === 0 ? "zero" : `${itemActionbar.settledStates.length} settled`,
      itemActionbar.settledStates.length === 0,
    );

    // The playback surface's action row: the R29-B WatchActions grammar.
    // binds R28-B one-click play: the item hub's play link → the player.
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    await goto(context, playHref ?? "/");
    const playerHtml = await browser.outerHtml("[data-wfx-surface='player']");
    const actionbar = parseActionbar(playerHtml ?? "");
    // binds the R29-B split pill: [data-wfx-action='like'] with its honest
    // unset reaction state (data-wfx-reaction='none') and NO provider-sync
    // note (the source declares neither like nor save).
    const reactionState = await browser.eval<string | null>(
      `document.querySelector("[data-wfx-action='like']")?.getAttribute('data-wfx-reaction') ?? null`,
    );
    assert.that(
      "the playback action row renders its like control in the honest unset state (the local reaction transport — never a provider-confirmed claim)",
      "data-wfx-reaction='none' on the split pill",
      reactionState ?? "<none>",
      reactionState === "none",
    );
    const syncNotes = await browser.count("[data-wfx-like-sync]");
    assert.that(
      "no provider-sync note renders when the source declares no like capability (never a fabricated 'Synced with the source')",
      "zero [data-wfx-like-sync] notes",
      `${syncNotes} note(s)`,
      syncNotes === 0,
    );
    assert.that(
      "no settled action state masquerades as provider-confirmed on the playback surface",
      "zero settled action states",
      actionbar.settledStates.length === 0 ? "zero" : `${actionbar.settledStates.length} settled`,
      actionbar.settledStates.length === 0,
    );

    await context.screenshot("j30-capability-honesty");
    await describe(context, "the truth table rendered all six areas with honest chips (native media unsupported on Web), the adapter descriptor law, and the playback surface's typed-absent action grammar");
  },
};
