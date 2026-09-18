/**
 * @wfx/journeys — J07 Official embed playback (encoded Web journey).
 *
 * Doc expectation (matrix J07): "Official embed playback" — provider
 * playback runs inside the WebFlix-owned contained surface.
 *
 * Web-fixture-boot encoding: the embed rung wins for the item, the
 * provider iframe renders inside the contained mount with the security
 * grammar (sandbox + strict referrer policy), the embed attestation is
 * NAMED honestly (the fixture realizations carry no official marker —
 * invariant 10: a fixture is never presented as production capability),
 * and the playback phase is the evidence-backed truth (no fake
 * progress).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch, playerHrefFromItem } from "../lib/journeys";
import { parsePlayer } from "../lib/state";

export const j07EmbedPlayback: Journey = {
  id: "J07",
  title: "Official embed playback",
  doc: "docs/validation/webflix-golden-journeys.md §J07 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    // The user path: search → detail → play.
    const itemHref = await itemHrefFromSearch(context, "Harbor", "Harbor Lights");
    assert.that(
      "the search surface offers the Harbor Lights item (the embed-realized catalog item)",
      "an item link",
      itemHref ?? "<absent>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");
    const playHref = await playerHrefFromItem(context);
    assert.that("the detail page offers playback", "a play href", playHref ?? "<absent>", playHref !== null);
    await goto(context, playHref ?? "/");

    // The contained embed surface.
    await assert.visible("[data-wfx-surface='player']", "the player surface renders");
    const html = await browser.tryHtml("[data-wfx-surface='player']");
    const player = parsePlayer(html ?? "");
    assert.that("the embed rung wins (the realization is played inside WebFlix)", 'data-wfx-player-mode="embed"', player.mode ?? "<none>", player.mode === "embed");
    assert.that(
      "the provider playback renders inside the contained iframe mount",
      "an iframe carrying data-wfx-player-frame",
      html !== null && html.includes("data-wfx-player-frame") ? "the contained iframe is present" : "no contained iframe",
      html !== null && html.includes("data-wfx-player-frame"),
    );

    // The containment grammar: sandboxed, strict referrer policy.
    assert.that(
      "the provider iframe is sandboxed (the containment law)",
      "a sandbox attribute on the iframe",
      player.iframeSandbox ?? "<no sandbox>",
      player.iframeSandbox !== null && player.iframeSandbox.length > 0,
    );
    assert.that(
      "the provider iframe sends a strict referrer policy",
      "referrerpolicy=strict-origin-when-cross-origin",
      player.iframeReferrerPolicy ?? "<no policy>",
      player.iframeReferrerPolicy === "strict-origin-when-cross-origin",
    );

    // The attestation truth (fixture honesty — invariant 10).
    assert.that(
      "the embed attestation is named honestly (the fixture realizations carry no official marker)",
      'data-wfx-embed-attestation="unofficial"',
      player.attestation ?? "<none>",
      player.attestation === "unofficial",
    );
    await assert.htmlContains("[data-wfx-surface='player']", "no provider official-embed attestation", "the embed note states the attestation truth");

    // The honest playback phase (evidence-backed — no fake progress).
    await assert.textContains("[data-wfx-player-mode-label]", "embed", "the mode label names the embed surface");
    await assert.textContains("[data-wfx-player-phase]", "buffering", "the playback phase is the evidence-backed truth (buffering — no fabricated progress)");

    // The engagement truth: the watch-report controls are present.
    await assert.countAtLeast("[data-wfx-report='complete']", 1, "the player offers the explicit watch report control");
    await assert.countAtLeast("[data-wfx-report='skip']", 1, "the player offers the explicit skip report control");

    await context.screenshot("j07-embed-playback");
    await describe(context, "the embed rung played inside the contained, sandboxed iframe mount with the honest unofficial-attestation note and the evidence-backed buffering phase");
  },
};
