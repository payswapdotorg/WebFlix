/**
 * @wfx/journeys — J14 Source connect / reauthorize / disconnect (encoded
 * Web journey).
 *
 * Doc expectation (matrix J14): source management — connect, see
 * capabilities/authorization state, reconnect, disconnect.
 *
 * Web-fixture-boot encoding: the HONEST pre-configuration state — the
 * settings sources section renders the typed "No sources connected"
 * state with the truthful note (this host browses its configured
 * service; never pretends a source is connected). Capability truth
 * before any connect: no fabricated connected sources anywhere.
 *
 * HONEST LIMIT (listed): the connect/reauthorize/disconnect ROUND TRIPS
 * are the service-side source-management lane (apps/api /sources routes
 * over the connector account store — R03's delivery). The web fixtures
 * boot cannot exercise them without the service; the manifest
 * limitation names the exact local procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j14SourceManagement: Journey = {
  id: "J14",
  title: "Source connect / reauthorize / disconnect",
  doc: "docs/validation/webflix-golden-journeys.md §J14 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings?section=sources");

    // The honest sources state.
    await assert.visible("[data-wfx-settings-sources]", "the settings sources section renders");
    await assert.visible("[data-wfx-sources-empty]", "the sources section renders its typed empty state (no sources connected)");
    await assert.textContains("[data-wfx-settings-sources]", "No sources connected", "the sources section states the honest no-sources truth");

    // The truth note: never pretends a source is connected.
    await assert.textContains("[data-wfx-settings-sources]", "never pretends", "the sources section states the never-pretend law");

    // The section navigation works (the destination is reachable from settings).
    await assert.countAtLeast("[data-wfx-settings-sections] a[href='/settings?section=sources']", 1, "the sources section is linked from the settings sections nav");
    await assert.countAtLeast("[data-wfx-settings-sections] a[href='/settings?section=model']", 1, "the model section is linked from the settings sections nav");
    await assert.countAtLeast("[data-wfx-settings-sections] a[href='/settings?section=general']", 1, "the general section is linked from the settings sections nav");

    // No fabricated connected-source row renders.
    const html = await browser.tryHtml("[data-wfx-settings-sources]");
    assert.that(
      "no fabricated connected-source rows render in the fixtures configuration",
      "no source rows with authorization states",
      html !== null && html.includes("Reauthorize") ? "a reauthorize control rendered" : "no connected-source controls",
      html === null || !html.includes("Reauthorize"),
    );

    await context.screenshot("j14-source-management");
    await describe(context, "the settings sources section rendered the typed no-sources state with the never-pretend note (the connect/reauthorize/disconnect round trips are the service-mode local-only procedure — listed)");
  },
};
