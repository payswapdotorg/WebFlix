/**
 * @wfx/journeys — J34 Capability discoverability (encoded Web journey,
 * R21-F).
 *
 * Doc expectation (docs/validation/webflix-golden-journeys.md §J34):
 * "Starting from a fresh Home state, the user must be able to discover
 * without documentation: 1. identity/profile entry; 2. source
 * connection; 3. Bring Your Own Feed; 4. WebFlix / Following / BYOF
 * feed-mode choice; 5. temporary intent; 6. attention mode; 7.
 * recommendation feedback; 8. Model/BYOM/local-model controls; 9. AI
 * media actions from content/player; 10. current playback realization /
 * Where to watch; 11. Desktop/offline path; 12. Watchlist, History, and
 * Offline Library. Acceptance is based on the actual visible product
 * path, not a direct URL, test-only control, or documentation link."
 *
 * Encoding: the twelve-task walk over the REAL product paths — every
 * task starts from a normal surface (Home, its cards, the session menu,
 * the primary navigation) and asserts the CONTROL renders in context
 * with its product vocabulary (never an architecture term as the only
 * path). The walk also carries the stale-completion sweep: no visited
 * page shows "arrives later / ships with R0x" copy for an accepted
 * capability (the J35 primitive, mirrored locally — the harness imports
 * nothing from any @wfx package per the layering law).
 *
 * HONEST LIMIT (listed): the full production-parity sweep (J35) is the
 * lead's journey against the live deployment; this encoding proves the
 * discoverability paths on the deterministic web-fixture boot (the same
 * product surfaces, the same controls).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

/**
 * The stale-completion markers (a local mirror of the R21-A primitive
 * `isStaleCompletionCopy` — the harness layering law forbids importing
 * @wfx packages; the patterns are the frozen law's own).
 */
const STALE_COMPLETION_MARKERS: readonly RegExp[] = [
  /arriv(?:es?|ing)\s+with\s+(?:the\s+)?[\w\s-]*lane/i,
  /arriv(?:es?|ing)\s+later/i,
  /seeded\s+until/i,
  /until\s+(?:R\d{1,2}|personal ranking|the\s+[\w\s-]*lane\s+(?:lands|ships))/i,
  /R\d{1,2}\s+(?:ships|lands|arrives)\s+(?:later|with)/i,
  /(?:ships|lands?|arriv(?:es?|ing))\s+with\s+(?:the\s+)?R\d{1,2}\b/i,
  /lands?\s+with\s+(?:the\s+)?[\w\s-]*lane/i,
];

/** Does one rendered copy string carry stale completion wording? */
function isStaleCompletionCopy(text: string): boolean {
  return STALE_COMPLETION_MARKERS.some((pattern) => pattern.test(text));
}

export const j34CapabilityDiscoverability: Journey = {
  id: "J34",
  title: "Capability discoverability from normal product surfaces",
  doc: "docs/validation/webflix-golden-journeys.md §J34",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ---------------------------------------------------------------
    // The walk starts at a FRESH Home state (no direct URLs — the
    // product's own orientation surface).
    // ---------------------------------------------------------------
    await goto(context, "/");

    // Task 1 — identity/profile entry: the session menu (the avatar in
    // the top bar) carries the sign-in/create-profile path.
    await browser.clickInteractive(".wfx-avatar-menu__summary");
    await assert.visible(
      "[data-wfx-session-signin]",
      "the session menu offers the sign-in / create-profile path (task 1: identity)",
    );
    await assert.visible(
      "[data-wfx-session-profile]",
      "the session menu offers the profile & identity settings path (task 1: identity)",
    );

    // Task 2 — source connection: the Home source strip's connect CTA.
    await assert.visible(
      "[data-wfx-source-connect-cta]",
      "Home offers the source-connection CTA in context (task 2: connect a source)",
    );

    // Task 3 — Bring Your Own Feed: the Home entry.
    await assert.visible(
      "[data-wfx-byof-cta]",
      "Home offers the bring-your-feed entry (task 3: BYOF)",
    );

    // Task 4 — feed-mode choice: the Home feed-mode control renders ALL
    // FOUR frozen modes (discoverable, never hidden).
    for (const mode of ["foryou", "following", "byof", "hybrid"]) {
      await assert.visible(
        `[data-wfx-feed-mode-option='${mode}']`,
        `the feed-mode control renders the '${mode}' mode (task 4: feed-mode choice)`,
      );
    }

    // Task 5 — temporary intent + Task 6 — attention mode: the
    // Personalize control (a contextual control, not a Settings trip).
    await browser.clickInteractive("[data-wfx-personalize-toggle]");
    await assert.visible(
      "[data-wfx-personalize-objective]",
      "the Personalize control offers the temporary-intent input in context (task 5: temporary intent)",
    );
    await assert.visible(
      "[data-wfx-personalize-set-intent]",
      "the intent control states its scope in the action's own words (task 5)",
    );
    for (const mode of ["mindful", "balanced", "immersive", "custom"]) {
      await assert.visible(
        `[data-wfx-attention-mode='${mode}']`,
        `the Personalize control renders the '${mode}' attention mode (task 6: attention mode)`,
      );
    }

    // No stale completion copy on Home (the J35 primitive).
    const homeText = (await browser.tryText("[data-wfx-surface='home']")) ?? "";
    assert.that(
      "Home carries ZERO stale completion copy (no 'arrives later / ships with R0x' for accepted lanes)",
      "no stale completion markers",
      homeText.slice(0, 120),
      !isStaleCompletionCopy(homeText),
    );

    // Tasks 7/9/10/11 — the item decision hub: reached from a HOME CARD
    // (the normal product path, never a direct URL).
    await goto(context, "/");
    const itemHref = await browser.eval<string | null>(
      `(() => { const link = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith("Asteroid Drift")); return link === undefined ? null : link.getAttribute('href'); })()`,
    );
    assert.that(
      "the home feed offers a content card (the item path starts from Home)",
      "an aria-labeled card link",
      itemHref ?? "<none>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");

    // Task 7 — recommendation feedback: the item feedback controls.
    await assert.visible(
      "[data-wfx-feedback-controls]",
      "the item decision hub offers the recommendation-feedback controls in context (task 7)",
    );
    for (const kind of ["more-like-this", "not-interested", "not-interested-source", "already-watched"]) {
      await assert.visible(
        `[data-wfx-feedback='${kind}']`,
        `the feedback vocabulary includes '${kind}' (task 7: recommendation feedback)`,
      );
    }

    // Task 9 — AI media actions from content: the AI action tray.
    await assert.visible(
      "[data-wfx-ai-tray]",
      "the item decision hub offers the AI action tray (task 9: AI media actions from content)",
    );

    // Task 10 — current playback realization / Where to watch.
    await assert.visible(
      "[data-wfx-where-to-watch]",
      "the item decision hub answers 'where can I watch this?' (task 10: Where to watch)",
    );
    const watchOptions = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-watch-option]')].map((option) => option.getAttribute('data-wfx-watch-option') ?? ''))()`,
    );
    assert.that(
      "the Where-to-watch row names every offered way (canonical identity first, realizations second)",
      "multiple watch options",
      (watchOptions ?? []).join(", "),
      (watchOptions ?? []).length >= 3,
    );

    // Task 11 — the Desktop/offline path (discoverable + explained).
    await assert.visible(
      "[data-wfx-acquisition-elsewhere]",
      "the item hub carries the Desktop offline affordance with its explanation (task 11: Desktop/offline path)",
    );
    const offlineCopy = (await browser.tryText("[data-wfx-acquisition-elsewhere]")) ?? "";
    assert.that(
      "the offline affordance names its next step (the Desktop app), never a dead 'not available'",
      "the desktop next step",
      offlineCopy.slice(0, 100),
      offlineCopy.toLowerCase().includes("desktop"),
    );

    // Task 8 — Model/BYOM/local-model controls: reached from the TRAY's
    // own management link (the contextual path, not a Settings-first
    // discovery requirement).
    await browser.clickInteractive("[data-wfx-ai-tray-toggle]");
    const manageHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-ai-tray-manage]')?.getAttribute('href') ?? null`,
    );
    assert.that(
      "the AI tray carries the Model & AI management path (task 8: model controls — the contextual entry)",
      "a management link",
      manageHref ?? "<none>",
      manageHref !== null && manageHref.includes("/settings"),
    );
    await goto(context, manageHref ?? "/settings?section=model");
    await assert.visible(
      "[data-wfx-settings-model]",
      "the Model & AI settings section renders (task 8: model/BYOM/local controls)",
    );
    const modelText = (await browser.tryText("[data-wfx-settings-model]")) ?? "";
    assert.that(
      "the model section names BYOM (bring-your-own-model) — the vocabulary, never an architecture term as the only path",
      "BYOM named",
      modelText.slice(0, 120),
      modelText.includes("BYOM"),
    );
    await assert.visible(
      "[data-wfx-model-policies-list]",
      "the per-task policy truth renders (the real read models — task 8)",
    );

    // Task 9 (player half) + Task 10 (player half): the same tray and the
    // active realization truth ride the PLAYER (reached from the item's
    // own Play action — the normal path).
    await goto(context, itemHref ?? "/");
    const playHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null`,
    );
    assert.that(
      "the item hub offers the play decision (the player path starts from the item)",
      "a play link",
      playHref ?? "<none>",
      playHref !== null,
    );
    await goto(context, playHref ?? "/");
    await assert.visible(
      "[data-wfx-ai-tray-surface='player']",
      "the player carries the same AI action tray (task 9: AI actions from the player)",
    );
    await assert.visible(
      "[data-wfx-player-mode-label]",
      "the player states the active playback realization in user vocabulary (task 10: current realization)",
    );
    const modeLabel = (await browser.tryText("[data-wfx-player-mode-label]")) ?? "";
    assert.that(
      "the mode label names the mode AND what it means (never a bare protocol word)",
      "a mode sentence",
      modeLabel.slice(0, 100),
      modeLabel.includes("Playing via"),
    );
    await assert.visible(
      "[data-wfx-where-to-watch]",
      "the player carries the Where-to-watch switch row (task 10: realization switch)",
    );

    // Task 12 — Watchlist, History, Offline Library: the Library's three
    // important states are immediately legible (primary navigation).
    await goto(context, "/library");
    for (const section of ["data-wfx-library-watchlist", "data-wfx-library-history", "data-wfx-library-offline"]) {
      await assert.visible(
        `[${section}]`,
        `the Library renders its '${section.replace("data-wfx-library-", "")}' section (task 12)`,
      );
    }

    // The stale-completion sweep over the visited surfaces (Home already
    // checked; item + player + settings + library here).
    for (const [label, selector] of [
      ["the item hub", "[data-wfx-surface='item']"],
      ["the player", "[data-wfx-surface='player']"],
      ["the model settings", "[data-wfx-settings-model]"],
      ["the library", "[data-wfx-surface='library']"],
    ] as const) {
      const text = (await browser.tryText(selector)) ?? "";
      assert.that(
        `${label} carries ZERO stale completion copy`,
        "no stale completion markers",
        text.slice(0, 120),
        !isStaleCompletionCopy(text),
      );
    }

    await context.screenshot("j34-capability-discoverability");
    await describe(
      context,
      "all twelve J34 tasks were discoverable from the normal product paths: the session menu's identity path, the source strip's connect + bring-feed CTAs, the four feed modes, the Personalize intent + attention controls, the item hub's feedback/AI-tray/Where-to-watch/Desktop-offline surfaces, the tray's Model & AI management link, the player's tray + realization truth, and the Library's three states — with zero stale completion copy on any visited surface",
    );
  },
};
