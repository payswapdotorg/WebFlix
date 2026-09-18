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
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";
import { parseActionbar, parseSettings } from "../lib/state";

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

    // The unsupported-action grammar holds on the playback surface.
    const itemHref = await itemHrefFromSearch(context, "Harbor", "Harbor Lights");
    await goto(context, itemHref ?? "/");
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    await goto(context, playHref ?? "/");
    const playerHtml = await browser.outerHtml("[data-wfx-surface='player']");
    const actionbar = parseActionbar(playerHtml ?? "");
    assert.that(
      "the playback surface's like/save render their typed absent notes (unsupported never looks like success)",
      "absent like + save notes",
      actionbar.absent.join(", ") || "<no absent markers>",
      actionbar.absent.includes("like") && actionbar.absent.includes("save"),
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
