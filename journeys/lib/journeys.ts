/**
 * @wfx/journeys — the journey contract (R16).
 *
 * ONE encoded journey = ONE catalog entry from
 * docs/validation/webflix-golden-journeys.md: the exact id, the catalog
 * title, the doc's expected-state anchor, and a `run` that EXECUTES the
 * journey against the running product through agent-browser — asserting
 * the expected states (an encoded journey FAILS when the product
 * regresses the journey; these are checks, not theater).
 *
 * The harness law (frozen): a journey never imports from any `@wfx`
 * package — it consumes the product as a USER (HTTP + the browser). The
 * registry test enforces this over the source tree.
 */

import type { Assert } from "./assertions";
import type { Browser } from "./browser";

/** The context one journey executes within. */
export interface JourneyContext {
  /** The assertion vocabulary bound to this journey's journal. */
  readonly assert: Assert;
  /** The browser driver (the frozen protocol: navigate → snapshot). */
  readonly browser: Browser;
  /** The running product's base URL. */
  readonly baseUrl: string;
  /**
   * Capture a named screenshot under this run's evidence directory and
   * return its repo-relative artifact path (recorded in the manifest).
   */
  screenshot(name: string): Promise<string>;
  /** Save the current interactive snapshot text as a named artifact. */
  saveSnapshot(name: string): Promise<string>;
  /**
   * The repo-relative evidence directory for this run (screenshots and
   * snapshots land there; the manifest sits beside it).
   */
  readonly evidenceDir: string;
}

/** One encoded golden journey. */
export interface Journey {
  /** The exact catalog id (J01–J32). */
  readonly id: string;
  /** The catalog's journey title (verbatim). */
  readonly title: string;
  /** The doc anchor this journey's expectations bind to. */
  readonly doc: string;
  /** Whether the journey is part of the CI-feasible set. */
  readonly ci: boolean;
  /** Execute the journey (throws AssertionError on regression). */
  run(context: JourneyContext): Promise<void>;
}

/**
 * Navigate with the frozen browser-validation protocol and read one
 * parsed observation: open → wait networkidle → fresh snapshot → read.
 * Every journey step that changes the DOM goes through this or through
 * an explicit re-snapshot — never a stale ref.
 */
export async function goto(
  context: JourneyContext,
  path: string,
): Promise<void> {
  await context.browser.navigate(`${context.baseUrl}${path}`);
}

/**
 * Navigate from the product's home surface by CLICKING a card — the
 * user path (canonical ids are per-boot; the DOM's own hrefs are the
 * truthful source, never hardcoded ids).
 */
export async function openHomeAndClickCard(
  context: JourneyContext,
  cardTitle: string,
): Promise<void> {
  await goto(context, "/");
  // The card link carries the title in its aria-label.
  const link = await context.browser.eval<string | null>(
    `(() => { const link = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(cardTitle)})); return link === undefined ? null : link.getAttribute('href'); })()`,
  );
  if (link === null) {
    context.assert.that(
      `the home feed offers the card "${cardTitle}"`,
      `an aria-labeled card link for "${cardTitle}"`,
      "no matching card",
      false,
    );
    return;
  }
  await context.browser.navigate(`${context.baseUrl}${link}`);
}

/** The item href for one title, read from the SEARCH surface (the user path). */
export async function itemHrefFromSearch(
  context: JourneyContext,
  query: string,
  title: string,
): Promise<string | null> {
  await goto(context, `/search?q=${encodeURIComponent(query)}`);
  return context.browser.eval<string | null>(
    `(() => { const link = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(title)})); return link === undefined ? null : link.getAttribute('href'); })()`,
  );
}

/** The player href of the item page currently open (the Play button's own link). */
export async function playerHrefFromItem(context: JourneyContext): Promise<string | null> {
  return context.browser.eval<string | null>(
    `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
  );
}
