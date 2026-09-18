/**
 * @wfx/journeys — J26 Verified local asset appears in Library (encoded
 * Web journey — the Web STATUS/READ surface).
 *
 * Doc expectation: a verified local asset is exposed to the Library
 * (the R13/R14 exposure law: verified before exposed).
 *
 * Web-fixture-boot encoding: the library's offline-and-verified section
 * lists the EARNED offline copies (Harbor Lights — the seed's
 * already-verified copy; Asteroid Drift — the copy J24's drive earned)
 * with their verified statuses, and the item detail carries the
 * ready-offline panel with its verified size. Reads only: the web
 * status/read truth (the matrix's Web column).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

export const j26VerifiedAssetInLibrary: Journey = {
  id: "J26",
  title: "Verified local asset appears in Library (web status/read surface)",
  doc: "docs/validation/webflix-golden-journeys.md §J26 (matrix: Web = Status/read)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/library");

    // The offline-and-verified section lists the earned copies.
    await assert.visible("[data-wfx-library-offline]", "the library renders the offline-and-verified section");
    const entries = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-offline-entry]')].map((entry) => entry.getAttribute('data-wfx-offline-entry') ?? ''))()`,
    );
    assert.that(
      "the offline-and-verified section lists the earned offline copies (the seed's verified Harbor Lights + the J24-earned Asteroid Drift)",
      "2 offline entries",
      `${(entries ?? []).length} entries`,
      (entries ?? []).length === 2,
    );
    const statuses = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-offline-status]')].map((node) => node.textContent ?? ''))()`,
    );
    const statusText = (statuses ?? []).join(" | ");
    assert.that(
      "every offline entry states its Ready-offline verified status",
      "verified ready-offline statuses",
      statusText || "<none>",
      (statuses ?? []).length === 2 && (statuses ?? []).every((status) => status.includes("Ready offline") && status.includes("watchable without a connection")),
    );

    // The verified entry is playable from the library (the link target).
    const links = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-offline-entry] a[data-wfx-card]')].map((a) => a.getAttribute('href') ?? ''))()`,
    );
    assert.that(
      "the offline entries link their canonical items (replay from the library)",
      "item links on the entries",
      `${(links ?? []).length} links`,
      (links ?? []).length === 2 && (links ?? []).every((href) => href.startsWith("/item?id=wfxitm_")),
    );

    // The item detail carries the ready-offline panel (the read side).
    const harborHref = await itemHrefFromSearch(context, "Harbor", "Harbor Lights");
    await goto(context, harborHref ?? "/");
    await assert.attrEquals("[data-wfx-acquisition]", "data-wfx-acquisition-state", "ready-offline", "the verified item's detail renders the ready-offline state");
    await assert.textEquals("[data-wfx-acquisition-size]", "1.5 MB · verified offline", "the ready-offline item states its verified size");
    await assert.textEquals("[data-wfx-acquisition-detail]", "Verified and available to watch without a connection.", "the ready-offline detail states the verified truth");
    await assert.countAtLeast("[data-wfx-acquisition-action='play-offline']", 1, "the verified item offers its typed play-offline action");

    await context.screenshot("j26-verified-asset-in-library");
    await describe(context, "the library's offline-and-verified section listed the earned copies with verified statuses; the item detail carried the ready-offline panel with its verified size");
  },
};
