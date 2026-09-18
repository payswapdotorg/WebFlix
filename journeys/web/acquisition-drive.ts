/**
 * @wfx/journeys — the scripted-acquisition drive helper (R16, J21–J26).
 *
 * Drives the fixtures-mode acquisition feed through the USER surface:
 * every step clicks the panel's own typed action button (the island
 * POSTs to /api/acquisition and the page reloads from the server's
 * honest next view — no optimistic lifecycle). The helper waits for
 * the EXPECTED next state text (the deterministic script's label or
 * detail sentence), settles the reload, and re-snapshots per the
 * browser-validation protocol (a fresh snapshot after every DOM
 * change).
 *
 * The scripts are the product's own deterministic fixture content
 * (apps/web/src/host/acquisition-fixtures.ts — the R14 browser-
 * validation feed); asserting their EXACT labeled sequence is
 * asserting the acquisition state machine's user-facing truth.
 */

import type { JourneyContext } from "../lib/journeys";

/** Click one acquisition action and wait for the reload + expected text. */
export async function driveAcquisition(
  context: JourneyContext,
  action: "acquire" | "advance" | "retry" | "pause" | "resume" | "dismiss",
  expectedText: string,
): Promise<void> {
  // The robust island click: scrolled into view (a below-the-fold center
  // receives nothing) and hydrated (a pre-hydration click is a no-op).
  await context.browser.clickInteractive(`[data-wfx-acquisition-action='${action}']`);
  // The POST answers and the island reloads the page from the server's
  // honest next view. The text wait is NAVIGATION-SAFE (fresh-eval
  // polling): a `wait --text` command that starts before the reload
  // polls a context the reload then destroys — it would never see the
  // new state's text (the flake this harness must not have).
  await context.browser.pollTextContains("[data-wfx-acquisition-detail]", expectedText, 30_000);
  await context.browser.waitLoad("networkidle");
  await context.browser.snapshotInteractive();
}

/** Read the current acquisition state attribute (null when no panel state). */
export async function acquisitionState(context: JourneyContext): Promise<string | null> {
  return context.browser.eval<string | null>(
    `document.querySelector('[data-wfx-acquisition-state]')?.getAttribute('data-wfx-acquisition-state') ?? null`,
  );
}

/** Read the current acquisition detail sentence (null when absent). */
export async function acquisitionDetail(context: JourneyContext): Promise<string | null> {
  return context.browser.eval<string | null>(
    `document.querySelector('[data-wfx-acquisition-detail]')?.textContent ?? null`,
  );
}

/** Read the gated diagnostics session state (inside the closed disclosure). */
export async function diagnosticsSessionState(context: JourneyContext): Promise<string | null> {
  return context.browser.eval<string | null>(
    `document.querySelector('[data-wfx-diagnostics-session-state]')?.textContent ?? null`,
  );
}

/** Whether the advanced-diagnostics disclosure is open (must be closed by default). */
export async function diagnosticsOpen(context: JourneyContext): Promise<boolean> {
  return context.browser.eval<boolean>(
    `(() => { const details = document.querySelector('details[data-wfx-advanced-diagnostics]'); return details === null ? false : details.hasAttribute('open'); })()`,
  );
}

/** Assert the acquisition panel's exact state + label + detail. */
export async function assertAcquisition(
  context: JourneyContext,
  state: string,
  detail: string,
): Promise<void> {
  const { assert, browser } = context;
  await assert.attrEquals(
    "[data-wfx-acquisition]",
    "data-wfx-acquisition-state",
    state,
    `the acquisition panel renders the "${state}" lifecycle state`,
  );
  const observedDetail = await acquisitionDetail(context);
  assert.that(
    `the "${state}" state's detail sentence is the honest user vocabulary`,
    `"${detail}"`,
    observedDetail ?? "<no detail>",
    observedDetail === detail,
  );
  const label = await browser.eval<string | null>(
    `document.querySelector('[data-wfx-acquisition-label]')?.textContent ?? null`,
  );
  return void assert.that(
    "the state label renders (the badge vocabulary)",
    "a label",
    label ?? "<no label>",
    label !== null && label.length > 0,
  );
}
