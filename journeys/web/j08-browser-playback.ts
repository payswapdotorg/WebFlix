/**
 * @wfx/journeys — J08 Contained Browser playback (encoded Web journey).
 *
 * Doc expectation: "provider playback remains inside a WebFlix-owned
 * contained browser surface whenever technically and legally permitted.
 * Provider security and DRM are not bypassed."
 *
 * Web-fixture-boot encoding: the browser rung wins when embed is
 * honestly absent, the provider page renders inside the contained
 * session-scoped surface (sandboxed iframe, strict referrer policy),
 * and the containment note states the boundary truth (cookie-isolated;
 * WebFlix never injects into or inspects the provider page — no
 * circumvention).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch, playerHrefFromItem } from "../lib/journeys";
import { parsePlayer } from "../lib/state";

export const j08BrowserPlayback: Journey = {
  id: "J08",
  title: "Contained Browser playback",
  doc: "docs/validation/webflix-golden-journeys.md §J08",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    // The user path: search → detail → play (Deep Field Diary is the
    // browser-realized catalog item — no embed realization present).
    const itemHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that(
      "the search surface offers the browser-realized item",
      "an item link",
      itemHref ?? "<absent>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");
    const playHref = await playerHrefFromItem(context);
    assert.that("the detail page offers playback", "a play href", playHref ?? "<absent>", playHref !== null);
    await goto(context, playHref ?? "/");

    await assert.visible("[data-wfx-surface='player']", "the player surface renders");
    const html = await browser.outerHtml("[data-wfx-surface='player']");
    const player = parsePlayer(html ?? "");

    // The browser rung wins (embed honestly absent for this realization set).
    assert.that("the browser rung wins when embed is honestly absent", 'data-wfx-player-mode="browser"', player.mode ?? "<none>", player.mode === "browser");

    // The contained, session-scoped browser surface.
    const containedSurface = await browser.tryAttr("[data-wfx-player-frame]", "data-wfx-player-frame");
    assert.that(
      "the provider page renders inside the contained surface mount",
      "the contained iframe with data-wfx-player-frame",
      containedSurface ?? "<absent>",
      containedSurface === "true",
    );
    assert.that(
      "the contained browser iframe is sandboxed",
      "a sandbox attribute on the iframe",
      player.iframeSandbox ?? "<no sandbox>",
      player.iframeSandbox !== null && player.iframeSandbox.length > 0,
    );
    assert.that(
      "the contained browser iframe sends a strict referrer policy",
      "referrerpolicy=strict-origin-when-cross-origin",
      player.iframeReferrerPolicy ?? "<no policy>",
      player.iframeReferrerPolicy === "strict-origin-when-cross-origin",
    );

    // The containment boundary is stated (never bypassed).
    await assert.textContains("[data-wfx-browser-surface-note]", "cookie-isolated", "the containment note states the cookie isolation");
    await assert.htmlContains("[data-wfx-surface='player']", "never injects into or inspects the provider page", "the containment note states the no-injection boundary (provider security is not bypassed)");

    // The honest mode label.
    await assert.textContains("[data-wfx-player-mode-label]", "browser", "the mode label names the contained browser surface");

    await context.screenshot("j08-browser-playback");
    await describe(context, "the browser rung played inside the contained, sandboxed, cookie-isolated surface with the no-injection boundary stated");
  },
};
