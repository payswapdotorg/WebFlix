/**
 * R33-C — THE CONTENT-SURFACE RESIDUALS (the parity reconciliation
 * matrix's content-surface rows: docs/parity-lab/r28/reconciliation/
 * MATRIX.md — D11/D13/D14/N19/N29/N3 + the O6 raised-gray residual).
 *
 * Proves the lane's closures over the fixtures-boot composition (the same
 * machinery the battery runs) + the stylesheet's corpus contracts:
 *
 * - N29 — THE CHANNEL SLOT'S HONEST IDENTITY: every content surface's
 *   card channel slot renders the SOURCES MODEL's own displayName
 *   (connectorId → displayName, the R32 `sourceNames` seam), never a
 *   fabricated channel name; a connector the sources model does not
 *   carry falls back to the connector id (the honest fallback); the
 *   shorts-shelf variant keeps its no-channel-row grammar (byte-law);
 * - THE RAISED-GRAY RESIDUAL (O6): the row-named content surfaces
 *   (chips/card-meta/rail) bind to the corpus raised + hover-overlay
 *   values (#f2f2f2 light / #272727 dark per color-survey.md row 27;
 *   rgba(0,0,0,0.05) / rgba(255,255,255,0.1) per row 29) — the
 *   off-corpus #e5e5e5/#3f3f3f/#f7f7f7/#212121 family is GONE from
 *   those rules (never a fabricated gray value);
 * - D14 — THE PLAYER PADDING: the corpus page margins 16px @1440 /
 *   24px @≥1600 (watch-geometry.md's own row), the full-bleed band
 *   below 1016, and the flush-right secondary in the two-column band;
 * - D13/N19/N3 — the geometry/badge rows' stylesheet contracts (the
 *   measured browser proof lives in evidence/r33c/captures/).
 *
 * Determinism: fixture transport, controlled env (restored), no network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import type { WebRuntimeHost } from "../src/host/web-host";
import { loadHomeView, loadSearchView, loadWatchBrowseView } from "../src/host/view-models";
import { HomeSurface } from "../src/components/home/HomeSurface";
import { SearchSurface } from "../src/components/search/SearchSurface";
import { WatchBrowseSurface } from "../src/components/watch/WatchBrowseSurface";
import { withEnv } from "./fake-web";

/** Boot the fixture host under a controlled environment. */
async function bootHost(): Promise<WebRuntimeHost> {
  let host: WebRuntimeHost | undefined;
  await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
    host = await getWebRuntimeHost();
  });
  if (host === undefined) throw new Error("the fixture host did not boot");
  return host;
}

/** The fixture source's own display name (the sources model's field). */
const FIXTURE_SOURCE_NAME = "Fake Source (TEST FIXTURE — never production)";

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// N29 — the channel slot's honest identity (the sourceNames seam)
// ---------------------------------------------------------------------------

describe("R33-C — the card channel slot's honest identity (N29)", () => {
  it("the home view's sourceNames map carries the sources model's own displayName (the R32 seam)", async () => {
    const host = await bootHost();
    const view = await loadHomeView(host);
    // The map resolves the fixture source's own displayName — the same
    // read the watch channel row (R29-B) and the shorts payload (R32)
    // perform. Matrix row N29; corpus: home-anatomy.md's channel row.
    expect(view.sourceNames["fake-source"]).toBe(FIXTURE_SOURCE_NAME);
  });

  it("the home surface renders the displayName in every card channel slot (never the bare connector id)", async () => {
    const host = await bootHost();
    const view = await loadHomeView(host);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    // The channel slots carry the source's own displayName (N29's truth:
    // the connector id no longer fills the channel-name slot).
    expect(markup).toContain(`From ${FIXTURE_SOURCE_NAME}`);
    expect(markup).not.toContain("From fake-source");
    expect(markup).not.toContain("@"); // never a fabricated @handle
  });

  it("the search view + surface render the displayName in the result channel rows (the 24x24 monogram derives its initial from it)", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "rain");
    expect(view.sourceNames["fake-source"]).toBe(FIXTURE_SOURCE_NAME);
    expect(view.cards.length).toBeGreaterThan(0);
    const markup = renderToStaticMarkup(createElement(SearchSurface, { view }));
    expect(markup).toContain(`From ${FIXTURE_SOURCE_NAME}`);
    expect(markup).not.toContain("From fake-source");
  });

  it("the watch browse view + surface render the displayName in the browse cards' channel slots", async () => {
    const host = await bootHost();
    const view = await loadWatchBrowseView(host);
    expect(view.sourceNames["fake-source"]).toBe(FIXTURE_SOURCE_NAME);
    const markup = renderToStaticMarkup(createElement(WatchBrowseSurface, { view }));
    expect(markup).toContain(`From ${FIXTURE_SOURCE_NAME}`);
    expect(markup).not.toContain("From fake-source");
  });

  it("THE HONEST FALLBACK: a connector the sources model does not carry keeps the connector id (never a fabricated name)", async () => {
    const host = await bootHost();
    // A sourceNames map that does NOT carry the card's connector id: the
    // channel slot stays the connector truth (the sources-model identity
    // law — the anonymous-service truth, honestly rendered).
    const view = await loadSearchView(host, "rain");
    const fallbackView = { ...view, sourceNames: {} as Record<string, string> };
    const markup = renderToStaticMarkup(createElement(SearchSurface, { view: fallbackView }));
    expect(markup).toContain("From fake-source");
    expect(markup).not.toContain(FIXTURE_SOURCE_NAME);
  });

  it("the empty-query search view carries the empty map (no search ran — no fabricated names)", async () => {
    const host = await bootHost();
    const view = await loadSearchView(host, "");
    expect(view.sourceNames).toEqual({});
  });

  it("THE SHORTS SHELF BYTE-LAW: the shorts variant keeps the no-channel-row grammar (the corpus shorts lockup)", async () => {
    const host = await bootHost();
    const view = await loadHomeView(host);
    const markup = renderToStaticMarkup(createElement(HomeSurface, { view }));
    const shelf = markup.split('data-wfx-row="shorts"')[1] ?? "";
    // The corpus shorts shelf: title below the thumb, NO channel row, no
    // badge (home-anatomy.md's Shorts shelf row; the R29-B N20 law).
    expect(shelf.split("data-wfx-row=")[0]).not.toContain("wfx-card__channel");
    expect(shelf.split("data-wfx-row=")[0]).not.toContain(FIXTURE_SOURCE_NAME);
  });
});

// ---------------------------------------------------------------------------
// THE RAISED-GRAY RESIDUAL (O6) — the corpus bindings in the stylesheet
// ---------------------------------------------------------------------------

describe("R33-C — the raised-gray residual's corpus bindings (O6 residual)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("the corpus raised + hover tokens carry the captured values (#f2f2f2/#272727; rgba(0,0,0,0.05)/rgba(255,255,255,0.1))", () => {
    // color-survey.md row 27 (raised/elevated surfaces, cards-adjacent)
    // + row 29 (the hover-overlay family) — the token values verbatim.
    expect(css).toMatch(/--wfx-bg-raised: #272727;/);
    expect(css).toMatch(/--wfx-bg-hover: rgba\(255, 255, 255, 0\.1\);/);
    expect(css).toMatch(/--wfx-bg-raised: #f2f2f2;/);
    expect(css).toMatch(/--wfx-bg-hover: rgba\(0, 0, 0, 0\.05\);/);
  });

  it("the chips' hover binds to the corpus hover-overlay family (row 29) — the off-corpus #e5e5e5/#3f3f3f is gone", () => {
    expect(css).toMatch(/\.wfx-chip:hover \{[^}]*background: var\(--wfx-bg-hover\);/s);
    expect(css).toMatch(/\.wfx-filterspill:hover \{[^}]*background: var\(--wfx-bg-hover\);/s);
    expect(css).toMatch(/\.wfx-upnext__chip:hover \{[^}]*background: var\(--wfx-bg-hover\);/s);
    // The off-corpus pair no longer paints any content-surface hover.
    expect(css).not.toMatch(/\.wfx-chip:hover \{[^}]*--wfx-surface-2/s);
  });

  it("the watch actions pill's hover binds to the corpus hover-overlay family (watch-geometry.md's actions-row pair)", () => {
    expect(css).toMatch(/\.wfx-actions__pill:hover \{[^}]*background: var\(--wfx-bg-hover\);/s);
  });

  it("the channel-slot avatars + the card quiet action row bind to the corpus raised family (row 27)", () => {
    // The search result's 24x24 monogram avatar + the watch owner row's
    // 40x40 avatar + the card meta's quiet action row (row-form).
    expect(css).toMatch(/\.wfx-result__avatar \{[^}]*background: var\(--wfx-bg-raised\);/s);
    expect(css).toMatch(/\.wfx-channel__avatar \{[^}]*background: var\(--wfx-bg-raised\);/s);
    expect(css).toMatch(/\.wfx-card__actionbtn \{[^}]*background: var\(--wfx-bg-raised\);/s);
  });

  it("the off-corpus surface family stays OUT of the content-surface rules (the named families only)", () => {
    // The bound rules no longer reference --wfx-surface / --wfx-surface-2
    // (the #f7f7f7/#e5e5e5 light + #212121/#3f3f3f dark off-corpus pair).
    const resultAvatar = css.match(/\.wfx-result__avatar \{[^}]*\}/s)?.[0] ?? "";
    expect(resultAvatar).not.toContain("--wfx-surface");
    const channelAvatar = css.match(/\.wfx-channel__avatar \{[^}]*\}/s)?.[0] ?? "";
    expect(channelAvatar).not.toContain("--wfx-surface");
    const actionBtn = css.match(/\.wfx-card__actionbtn \{[^}]*\}/s)?.[0] ?? "";
    expect(actionBtn).not.toContain("--wfx-surface");
  });
});

// ---------------------------------------------------------------------------
// D14 — the player padding (the corpus page margins)
// ---------------------------------------------------------------------------

describe("R33-C — the player padding's corpus contracts (D14)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("the base band carries the 16px sides @1440 (the measured player x=16) with the 12px top gap", () => {
    // watch-geometry.md: "Page margin: 16px at 1440 (24px at ≥1600)" —
    // the player x=16 measure below the 56px masthead (y=68 = 12px gap).
    expect(css).toMatch(/\.wfx-player \{[^}]*padding: 12px 16px 48px;/s);
  });

  it("the ≥1600 band carries the 24px margins (the corpus's own responsive row)", () => {
    expect(css).toMatch(/@media \(min-width: 1600px\) \{\s*\.wfx-player \{[^}]*padding: 24px 24px 48px;/s);
  });

  it("the two-column band keeps the flush-right secondary (padding-right: 0 @≥1016) and the full-bleed band below", () => {
    // The corpus: secondary 412 ending at the viewport edge (x=1028+412
    // = 1440); ≤1000px the player goes full-bleed (single column).
    expect(css).toMatch(/@media \(min-width: 1016px\) \{\s*\.wfx-player \{[^}]*padding-right: 0;/s);
    expect(css).toMatch(/@media \(max-width: 1015px\) \{\s*\.wfx-player \{[^}]*padding: 0 0 48px;/s);
  });
});

// ---------------------------------------------------------------------------
// N19 — the duration badge's captured pill grammar (the stylesheet)
// ---------------------------------------------------------------------------

describe("R33-C — the duration badge's pill grammar (N19)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("the corner badge carries the captured pill form (12/500 #fff on rgba(0,0,0,0.6), r4, pad 1px 4px, 8px inset)", () => {
    // color-survey.md's duration-pill row (the 0.6 alpha) + the N19
    // matrix row's captured badge form; the measured browser proof
    // (32x16, 8px inset, "0:45") lives in evidence/r33c/captures/.
    // The base badge carries the 12/500 pill typography + the pill
    // tokens; the duration modifier carries the captured literal form.
    expect(css).toMatch(/\.wfx-badge \{[^}]*font-size: 12px;[^}]*font-weight: 500;[^}]*background: var\(--wfx-pill-bg\);/s);
    expect(css).toMatch(/--wfx-pill-bg: rgba\(0, 0, 0, 0\.6\);/);
    expect(css).toMatch(/--wfx-pill-fg: #ffffff;/);
    expect(css).toMatch(/\.wfx-badge--duration \{[^}]*background: rgba\(0, 0, 0, 0\.6\);[^}]*border-radius: 4px;[^}]*padding: 1px 4px;[^}]*color: #fff;/s);
  });
});

// ---------------------------------------------------------------------------
// N3 — the search result row's captured geometry (the stylesheet)
// ---------------------------------------------------------------------------

describe("R33-C — the search result row's captured geometry (N3)", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  it("the result thumb carries the corpus 500px width + 12px radius (search-card-grammar.json)", () => {
    // The corpus row form @1440: thumb 500x281 radius 12px, img
    // object-fit cover inside — the measured proof (row 1152x281,
    // thumb 500x281 r12) is in evidence/r33c/captures/
    // search-rows-1440.png + the browser-measured facts. The ≥700px
    // band carries the corpus large-thumbnail form; the narrow band
    // keeps the 16:9 r12 lockup.
    expect(css).toMatch(/@media \(min-width: 700px\) \{[\s\S]*?\.wfx-result__thumb \{[^}]*width: 500px;[^}]*height: 281px;[^}]*border-radius: var\(--wfx-radius\);/);
    expect(css).toMatch(/\.wfx-result__thumb \{[^}]*aspect-ratio: 16 \/ 9;[^}]*border-radius: var\(--wfx-radius\);/s);
    expect(css).toMatch(/--wfx-radius: 12px;/);
  });
});
