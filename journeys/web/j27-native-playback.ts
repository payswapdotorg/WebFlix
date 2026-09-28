/**
 * @wfx/journeys — J27 Native local media playback (encoded Web journey
 * — the Web CONSTRAINED surface).
 *
 * Doc expectation (matrix J27: Web = "Constrained"; the native
 * playback path is the Desktop equivalent procedure).
 *
 * Web-fixture-boot encoding: the honest capability TRUTH — the web
 * adapter's settings table declares native media "Not available on
 * Web" with its limitation, and an unscripted item's offline-copy note
 * states the desktop-app truth ("you can make this title available
 * offline in the WebFlix desktop app"). The web never pretends native
 * capability it does not have.
 *
 * R35b re-encode: the unscripted item's offline-copy note is read on
 * the ITEM hub (the R28-B mount — the acquisition panel rides
 * `ItemDetailSurface`), reached through the search card's kebab Details
 * deep path (the card's primary link is the one-click /player href).
 */

import { describe } from "./journey-description";
import type { Journey, JourneyContext } from "../lib/journeys";
import { goto } from "../lib/journeys";

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

export const j27NativePlayback: Journey = {
  id: "J27",
  title: "Native local media playback (web constrained truth)",
  doc: "docs/validation/webflix-golden-journeys.md §J27 (matrix: Web = Constrained)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/settings");

    // The capability truth table: native media honestly unsupported on Web.
    const nativeRow = await browser.eval<string | null>(
      `(() => { const row = document.querySelector("[data-wfx-capability='native media & torrent acquisition']"); return row === null ? null : row.textContent ?? ''; })()`,
    );
    assert.that(
      "the settings capability table declares the native media area (the truth table is complete)",
      "the native media & torrent acquisition row",
      nativeRow === null ? "<row absent>" : "present",
      nativeRow !== null,
    );
    assert.that(
      "the web adapter declares native media NOT available on Web (capability honesty, never a fake native path)",
      "the native row renders the Not-available-on-Web chip",
      (nativeRow ?? "").includes("Not available on Web") ? "declared not available" : (nativeRow ?? "<no row>"),
      (nativeRow ?? "").includes("Not available on Web"),
    );

    // An unscripted item's offline-copy note states the desktop truth.
    // R17 fix (lead integration): "Midnight Scoop" became a SCRIPTED
    // acquisition item (the metadata-failure journey) — the honest
    // no-session note now renders on any UNSCRIPTED item; "Neon Rain"
    // (fake:short-1, native-capable, unscripted) carries it.
    // binds R28-B deep surface: the search card's kebab Details link → the item hub.
    const unscriptedHref = await detailHrefFromSearch(context, "Neon", "Neon Rain");
    assert.that("the search card offers an unscripted item's Details deep path (no acquisition session)", "an /item link", unscriptedHref ?? "<absent>", unscriptedHref !== null);
    await goto(context, unscriptedHref ?? "/");
    await assert.visible("[data-wfx-acquisition-none]", "the offline-copy panel renders its no-session state");
    await assert.textContains("[data-wfx-acquisition-elsewhere]", "WebFlix desktop app", "the offline-copy note states where native acquisition runs (the honest desktop truth)");
    await assert.countExactly("[data-wfx-acquisition-state]", 0, "no acquisition lifecycle state is fabricated for the web (the constrained truth)");

    await context.screenshot("j27-native-playback");
    await describe(context, "the settings table declared native media Not available on Web; an unscripted item's offline-copy note stated the desktop-app truth (the native playback path itself is the Desktop equivalent procedure — listed)");
  },
};
