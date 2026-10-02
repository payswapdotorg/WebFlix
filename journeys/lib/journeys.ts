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

/**
 * The ITEM-DETAIL href for one title, read from the SEARCH surface's own
 * card kebab (the R28-B deep-surface path: the card's primary link is the
 * one-click /player href; the quiet action row's Details link
 * [data-wfx-card-details] carries the /item URL). The DOM's own href is
 * the truthful source — never a hardcoded id.
 */
export async function detailHrefFromSearch(
  context: JourneyContext,
  query: string,
  title: string,
): Promise<string | null> {
  await goto(context, `/search?q=${encodeURIComponent(query)}`);
  return context.browser.eval<string | null>(
    `(() => { const card = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(title)})); if (card === undefined) return null; const wrap = card.closest('[data-wfx-cardwrap]') ?? card.parentElement; const details = wrap === null ? null : wrap.querySelector('details[data-wfx-card-actions]'); return details === null ? null : (details.querySelector('[data-wfx-card-details]')?.getAttribute('href') ?? null); })()`,
  );
}

/** The player href of the item page currently open (the Play button's own link). */
export async function playerHrefFromItem(context: JourneyContext): Promise<string | null> {
  return context.browser.eval<string | null>(
    `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
  );
}

/**
 * Ensure the player chrome is REVEALED (interactive) before clicking one
 * of its controls — the IDLE-COVER law (the WFX-DEPLOY defect class):
 * `.wfx-chrome` fades on ~3s idle to `pointer-events: none`, so while
 * idle EVERY chrome control is covered by whatever sits beneath the bar
 * (over a provider embed: the iframe) and a hit-target-verified click
 * can never land on it. The reveal law is the product's own: a mousemove
 * over the parent document (the window listener in PlayerChrome); over
 * an embed the only idle surface that can deliver that event is the
 * W1-D2 always-interactive wake strip [data-wfx-chrome-wake] at the
 * stage's bottom edge.
 *
 * The step is implementation-independent and backward-compatible:
 * - the CHECK is the click's own actionability law — the control IS the
 *   hit target at its own center point (the control itself or a
 *   descendant, e.g. its icon) — so a revealed chrome (or a tree without
 *   the idle-cover law) answers YES and NO gesture is dispatched;
 * - when a wake strip exists (the D2 trees), the gesture is the REAL
 *   user path: a pointer move over the strip (best-effort — the poll
 *   below is the truth gate, never the hover command);
 * - the synthetic parent-document mousemove is the same reveal law the
 *   product listens for (the pre-D2 trees' only path) — idempotent and
 *   harmless when the chrome is already revealed;
 * - the poll is bounded and LOUD: a control that never becomes
 *   actionable fails the journey with the typed browser error — never a
 *   silent proceed that would click into the void.
 */
export async function revealPlayerChrome(
  context: JourneyContext,
  controlSelector: string,
): Promise<void> {
  const { browser } = context;
  // The reveal precondition, evaluated FRESH each poll (the
  // navigation-safe law — never a stale ref). TWO branches, both the
  // product's own laws:
  // - IN-VIEWPORT controls: the direct hit-target law — the control IS
  //   the element at its own center point (itself or a descendant, e.g.
  //   its icon). While the chrome is idle this answers false (the whole
  //   bar is pointer-events:none — over an embed the hit lands on the
  //   iframe); revealed, it answers true.
  // - OUT-OF-VIEWPORT controls (e.g. a settings popup escaping past the
  //   viewport top): elementFromPoint cannot see them and the click
  //   command brings its own scroll — what the reveal must guarantee is
  //   the CHROME's interactive state, the exact idle-cover CSS law
  //   (pointer-events:none only while idle="true" AND not :focus-within).
  const actionable = `(() => { const el = document.querySelector(${JSON.stringify(controlSelector)}); if (el === null) return false; const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; if (x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight) { const hit = document.elementFromPoint(x, y); return hit !== null && (hit === el || el.contains(hit)); } const chrome = el.closest("[data-wfx-chrome]"); if (chrome === null) return true; return chrome.getAttribute("data-wfx-chrome-idle") !== "true" || chrome.matches(":focus-within"); })()`;
  if (await browser.eval<boolean>(actionable)) {
    return;
  }
  // The reveal gesture. With the D2 strip present, a REAL pointer move
  // over the always-interactive idle sliver — exactly the gesture a user
  // makes toward the controls (best-effort: other covers may make the
  // strip itself unhoverable; the poll is the gate).
  if ((await browser.count("[data-wfx-chrome-wake]")) > 0) {
    await browser.hover("[data-wfx-chrome-wake]").catch(() => undefined);
  }
  // The law itself: a parent-document mousemove reveals the chrome (the
  // product's window listener — the same event the strip's pointer move
  // delivers; the only reveal path on pre-D2 trees).
  await browser.eval(
    `void document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))`,
  );
  // The truth gate: bounded poll until the reveal precondition holds,
  // LOUD on timeout.
  await browser.pollEvalTruthy(actionable, 10_000);
}
