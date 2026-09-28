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
 *
 * R35b re-encode: the user path is the R28-B ONE-CLICK grammar — the
 * search card's primary link IS the play path (card click → playback
 * starts); the player surface is reached directly through the card's
 * own /player href.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";
import { parsePlayer } from "../lib/state";

export const j07EmbedPlayback: Journey = {
  id: "J07",
  title: "Official embed playback",
  doc: "docs/validation/webflix-golden-journeys.md §J07 (matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    // The user path: search → the card's one-click play (R28-B).
    const playHref = await itemHrefFromSearch(context, "Harbor", "Harbor Lights");
    assert.that(
      "the search surface offers the Harbor Lights card (the embed-realized catalog item)",
      "an id-first /player link (the one-click play path)",
      playHref ?? "<absent>",
      playHref !== null && playHref.startsWith("/player?id=wfxitm_"),
    );
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

    // The engagement truth: the watch-report controls are present
    // binds the R29-B watch kebab: the explicit watch-state reports.
    await assert.countAtLeast("[data-wfx-report='complete']", 1, "the player offers the explicit watch report control");
    await assert.countAtLeast("[data-wfx-report='skip']", 1, "the player offers the explicit skip report control");

    await context.screenshot("j07-embed-playback");
    await describe(context, "the one-click card path started the embed rung inside the contained, sandboxed iframe mount with the honest unofficial-attestation note and the evidence-backed buffering phase");
  },
};
