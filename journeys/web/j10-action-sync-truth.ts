/**
 * @wfx/journeys — J10 Like/save/action synchronization truth (encoded
 * Web journey).
 *
 * Doc expectation: "the UI differentiates WebFlix-confirmed state from
 * provider-confirmed synchronization. Unsupported provider actions
 * never appear as successful."
 *
 * Web-fixture-boot encoding: the UNSUPPORTED action grammar — the
 * fixture source declares neither like nor save for the catalog items,
 * so the action bar renders the typed ABSENT notes (never greyed-out
 * lies implying provider support, never fake success), and NO settled
 * action state exists to masquerade as synchronized. The engagement
 * side of the truth: the watch-report control fires and reports its
 * honest settled state ("Marked as watched" — the WebFlix-confirmed
 * fold the player page owns).
 *
 * HONEST LIMIT (listed): the provider-confirmed / local-only
 * differentiation grammar (data-wfx-action-state =
 * "confirmed-by-provider" | "confirmed-locally") needs an item whose
 * source DECLARES like/save — the fixture catalog carries none. The
 * grammar ships in the R15 ActionButtons surface and is exercised
 * service-side; the manifest limitation names the local procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";
import { parseActionbar } from "../lib/state";

export const j10ActionSyncTruth: Journey = {
  id: "J10",
  title: "Like/save/action synchronization truth",
  doc: "docs/validation/webflix-golden-journeys.md §J10",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    const itemHref = await itemHrefFromSearch(context, "Asteroid", "Asteroid Drift");
    assert.that("the search surface offers the item", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");

    // The typed-absent grammar: unsupported actions never appear as successful.
    const barHtml = await browser.outerHtml("[data-wfx-surface='item']");
    const actionbar = parseActionbar(barHtml ?? "");
    assert.that(
      "like renders its typed absent state when the source declares it unsupported",
      "data-wfx-action-absent='like'",
      actionbar.absent.join(", ") || "<no absent markers>",
      actionbar.absent.includes("like"),
    );
    assert.that(
      "save renders its typed absent state when the source declares it unsupported",
      "data-wfx-action-absent='save'",
      actionbar.absent.join(", ") || "<no absent markers>",
      actionbar.absent.includes("save"),
    );
    await assert.textContains("[data-wfx-surface='item']", "not available on this source", "the absent notes state the provider truth (never a fake success)");

    // Nothing masquerades as synchronized.
    assert.that(
      "no settled action state renders as provider-confirmed or local-only success without a provider receipt",
      "zero data-wfx-action-state markers",
      actionbar.settledStates.length === 0 ? "zero settled states" : `${actionbar.settledStates.length} settled states`,
      actionbar.settledStates.length === 0,
    );

    // The engagement truth: the WebFlix-confirmed watch report.
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    assert.that("the item page offers playback (the report surface)", "a play href", playHref ?? "<absent>", playHref !== null);
    await goto(context, playHref ?? "/");
    await assert.countAtLeast("[data-wfx-report='complete']", 1, "the explicit watch report control is present");

    // Fire the report (the robust island click: in view + hydrated) and
    // observe the honest settled state.
    await browser.clickInteractive("[data-wfx-report='complete']");
    await browser.waitSelector("[data-wfx-report-status]", 10_000);
    const reportStatus = await browser.tryText("[data-wfx-report-status]");
    assert.that(
      "the watch report answers its honest settled state (WebFlix-confirmed fold)",
      "a report status naming what was recorded",
      reportStatus ?? "<no status>",
      reportStatus !== null && reportStatus.includes("Marked as watched"),
    );
    const disabled = await browser.eval<boolean>(
      `(() => { const button = document.querySelector("[data-wfx-report='complete']"); return button === null ? false : button.hasAttribute('disabled'); })()`,
    );
    assert.that(
      "a completed report control settles (disabled — never a re-fire lie)",
      "the complete control is disabled after the receipt",
      disabled ? "disabled" : "still enabled",
      disabled,
    );

    await context.screenshot("j10-action-sync-truth");
    await describe(context, "unsupported like/save render typed absent notes with zero fake settled states; the watch report fires and settles to its honest WebFlix-confirmed status");
  },
};
