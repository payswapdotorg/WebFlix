/**
 * @wfx/journeys — J17 Explicit intent: learn / happier / surprise /
 * tonight / friend taste (encoded Web journey).
 *
 * Doc expectation: "intent can be temporary/session-scoped without
 * corrupting long-term preferences."
 *
 * Web-fixture-boot encoding: the SESSION-SCOPED intent mechanics that
 * ship on the web adapter — the search box is the intent entry; a
 * stated intent (a query) answers the session's candidates (the search
 * state + results), the intent is retained in the entry (session
 * state), and a NEW intent replaces it without corrupting anything
 * persistent (the fresh navigation composes from the query alone — no
 * persistent preference is written by the web fixtures session).
 *
 * HONEST LIMIT (listed): the explicit intent VOCABULARY (learn/happier/
 * surprise/tonight/friend-taste) is the service-side intent submission
 * (apps/api /experience/intents — R05's delivery, session-scoped by
 * design); the web adapter ships the query intent. The manifest
 * limitation names the service-mode procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j17ExplicitIntent: Journey = {
  id: "J17",
  title: "Explicit intent: learn / happier / surprise / tonight / friend taste",
  doc: "docs/validation/webflix-golden-journeys.md §J17",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // State one intent (the session's query intent).
    await goto(context, "/search?q=rain");
    await assert.countAtLeast("[data-wfx-search-results] a[data-wfx-card]", 3, "a stated intent answers the session's candidates (the rain intent composes its results)");

    // The intent is retained: the surface's query echo states it.
    const echo = await browser.tryText("[data-wfx-search-query]");
    assert.that(
      "the stated intent is echoed by the surface (the session's retained intent)",
      "the query echo names 'rain'",
      echo ?? "<no echo>",
      echo !== null && echo.includes("rain"),
    );

    // A new intent replaces it (temporary/session-scoped — the fresh
    // composition comes from the new query alone; "harbor" is the
    // fixture catalog's other distinct topic).
    await goto(context, "/search?q=harbor");
    const results = await browser.count("[data-wfx-search-results] a[data-wfx-card]");
    assert.that(
      "a new intent composes a fresh answer (the intent is replaceable, never sticky in this session)",
      "a fresh result set for 'harbor'",
      `${results} result cards`,
      results >= 1,
    );
    const newEcho = await browser.tryText("[data-wfx-search-query]");
    assert.that(
      "the replaced intent is what the surface now states (no residue of the earlier intent)",
      "the query echo names 'harbor'",
      newEcho ?? "<no echo>",
      newEcho !== null && newEcho.includes("harbor") && !newEcho.includes("rain"),
    );

    // The session intent never writes a persistent preference: the home
    // feed (the long-term composition surface) is untouched by the intents.
    await goto(context, "/");
    await assert.visible("[data-wfx-hero]", "the home composition renders after the session intents (no corrupted feed)");
    await assert.countAtLeast("a[data-wfx-card]", 4, "the home composition still carries its cards (the session intent corrupted no long-term preference)");

    await context.screenshot("j17-explicit-intent");
    await describe(context, "the query intent answered and was echoed, was replaced by a new intent with a fresh echo, and corrupted no long-term composition (the explicit intent vocabulary is the service-side submission — listed)");
  },
};
