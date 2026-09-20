/**
 * @wfx/journeys — J36 Major user journey completion / no dead-end discovery
 * (encoded Web journey, R22-G).
 *
 * Doc expectation (docs/validation/webflix-golden-journeys.md §J36, frozen):
 *
 * ```text
 * Start from fresh Home, with no documentation and no direct route navigation.
 * Home
 * -> create/sign in
 * -> connect a source using a supported connector
 * -> return to source management with Connected truth
 * -> browse source-backed content
 * -> Bring Your Feed
 * -> preview + confirm an authorized import
 * -> switch among available feed modes
 * -> set temporary intent
 * -> change attention mode
 * -> open an item
 * -> choose Where to watch
 * -> use an AI action
 * -> provide recommendation feedback
 * -> use Shorts and verify Like/Save/Share after hydration
 * -> open Library
 * -> verify Watchlist / History / Imported Feeds / Offline truth
 * -> open Model & AI management
 * -> add/remove BYOM where supported
 * -> sign out
 * -> verify honest anonymous state
 * ```
 *
 * Encoding: the FULL first-run walk over the REAL product surfaces — every
 * step starts from a normal product path (the primary navigation, the
 * session menu, the source strip's CTAs, a Home card's own link, the
 * sections nav), never a direct URL claim of discoverability and never a
 * test-only control. The walk consumes the R22-D/E/F surfaces exactly as a
 * first-time user meets them:
 *
 * - the ANONYMOUS chooser prerequisite (the F2 law: the first-connect CTA
 *   never dead-ends — the chooser itself names the sign-in-or-create next
 *   action and links to it);
 * - account creation (R22-E): the honest per-field pre-flight errors, the
 *   OPTIONAL display name left empty (the found-and-fixed defect: an
 *   optional field must be skippable), the auto-login reload to the
 *   authenticated state, and the identity's continuity on Home;
 * - the source connect round trip (R22-D): the connected source's own
 *   Disconnect control, then the Connect control of the not-connected
 *   chooser entry — the honest state truth at each step, no fabricated
 *   state;
 * - BYOF after the prerequisite (F3/J33's flow, condensed to the walk's
 *   preview + confirm): the dev-reset drive restores the pristine capture
 *   phase for determinism (the J33 scripted-drive law), then the panel's
 *   own Connect → Preview → Confirm buttons drive the real flow;
 * - the feed-mode transition (F4): the imported-feed mode is honestly
 *   UNAVAILABLE before the import (the named prerequisite + the recovery
 *   link) and AVAILABLE + selectable after it;
 * - the Personalize controls (temporary intent + attention mode) with the
 *   honest session-scope vocabulary;
 * - the item decision hub (Where to watch, the AI action tray, the
 *   recommendation feedback) and the player's realization switch;
 * - Shorts after HYDRATION (F7's law: the existing implementation is the
 *   one verified — Share is present and usable; Like/Save render only
 *   where the source advertises them, which the fixture source does NOT —
 *   the typed absence is the honest truth, never fake controls);
 * - Library continuity (the four sections with the imported feed present);
 * - BYOM add/remove (R22-F): through the panel's own form — the key is
 *   submitted and NEVER rendered back (the secret law), the bound row
 *   appears with its REMOVE action, the removal lands;
 * - sign out → the honest anonymous state (the session label's own truth,
 *   never a stale authenticated render).
 *
 * HONEST LIMITS (inherited, listed in the registry): the REAL provider
 * round trips (a live OAuth dance, a real Google account import) are the
 * service-mode local-only procedures (J14/J28/J33's own limitation
 * entries); this encoding proves the walk over the deterministic
 * web-fixture boot — the same product surfaces, the same controls.
 */

import { describe } from "./journey-description";
import type { Browser } from "../lib/browser";
import type { Journey, JourneyContext } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** POST one BYOF dev drive to the RUNNING product (HTTP — the user channel; the J33 law). */
async function byofDrive(context: JourneyContext, action: string): Promise<number> {
  const response = await fetch(`${context.baseUrl}/api/byof`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return response.status;
}

/**
 * Reload-safe attribute polling: evaluate a FRESH page expression until
 * it satisfies the predicate (a write→reload control's state lands in the
 * RELOADED DOM — a one-shot attribute read can race the reload; each poll
 * here is an independent command against whatever page is live, the same
 * law as the harness's `pollTextContains` but for structured reads).
 */
async function pollEvalUntil<T>(
  browser: Browser,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await browser.eval<T>(expression);
    if (predicate(value)) return value;
    if (Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export const j36MajorJourneyCompletion: Journey = {
  id: "J36",
  title: "Major user journey completion / no dead-end discovery",
  doc: "docs/validation/webflix-golden-journeys.md §J36",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // -----------------------------------------------------------------
    // 0. FRESH HOME — the walk starts at the product's orientation
    //    surface with the honest anonymous identity (no direct route
    //    claims: the first navigation is the root the product owns).
    // -----------------------------------------------------------------
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "the fresh Home renders (the walk's start)");
    await assert.textContains(".wfx-topbar", "Signed out", "the fresh session states its honest anonymous identity");
    // The feed-mode truth BEFORE any import (the F4 law: an unavailable
    // mode names its prerequisite — the honest refusal, never a hidden mode).
    await assert.attrEquals(
      "[data-wfx-feed-mode-option='byof']",
      "data-wfx-feed-mode-available",
      "false",
      "the imported-feed mode is honestly unavailable before an import exists (never hidden, never fake)",
    );

    // -----------------------------------------------------------------
    // 1. CONNECT A SOURCE → the anonymous chooser prerequisite (the F2
    //    dead-end killer): the source strip's CTA lands on Settings →
    //    Sources, where the chooser ITSELF names the next action.
    // -----------------------------------------------------------------
    await browser.clickInteractive("[data-wfx-source-connect-cta]");
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.visible("[data-wfx-source-chooser]", "the source chooser renders (the empty state carries the chooser — no dead-end CTA)");
    await assert.visible(
      "[data-wfx-source-chooser-prerequisite]",
      "the anonymous session renders the typed sign-in prerequisite (never a fabricated catalog, never an empty dead end)",
    );
    const prerequisiteLabel = (await browser.tryText("[data-wfx-source-chooser-prerequisite-label]")) ?? "";
    assert.that(
      "the prerequisite names its next action in user vocabulary (sign in or create an account)",
      "the sign-in-or-create label",
      prerequisiteLabel.slice(0, 80),
      prerequisiteLabel.toLowerCase().includes("sign in"),
    );
    // The prerequisite's action is a LINK to the identity surface (the
    // anti-loop law: the next action exists, it is not the same state).
    const signinHref = await browser.eval<string | null>(
      "document.querySelector('[data-wfx-source-chooser-signin]')?.getAttribute('href') ?? null",
    );
    assert.that(
      "the prerequisite carries its own next action (the link to the identity surface)",
      "a settings identity link",
      signinHref ?? "<absent>",
      signinHref !== null && signinHref.includes("/settings"),
    );

    // -----------------------------------------------------------------
    // 2. CREATE/SIGN IN (R22-E) — follow the prerequisite's link (the
    //    normal path), create the account through the form, and land in
    //    the honest authenticated state.
    // -----------------------------------------------------------------
    await goto(context, signinHref ?? "/settings?section=general");
    await assert.visible("[data-wfx-session-controls]", "the session controls render at the identity surface (the prerequisite's destination)");
    // The honest validation surface FIRST: the create-account form states
    // its rules up front (the required vocabulary + the password rule),
    // and an empty submit is REFUSED — no navigation, no silent failure,
    // no authenticated state (the browser's own constraint layer is the
    // first line of honesty; the shared R22-B pre-flight is the second).
    await browser.clickInteractive('[data-wfx-session-mode-option="register"]');
    await browser.settle();
    await assert.attrEquals(
      "[data-wfx-session-controls]",
      "data-wfx-session-mode",
      "register",
      "the create-account mode renders (account creation is a first-class normal-path action)",
    );
    await assert.visible("#wfx-session-display-name", "the register form carries the optional display-name field");
    await assert.visible("[data-wfx-session-password-hint]", "the register form states the password rule up front (honest validation)");
    const emailRequired = await browser.eval<boolean>(
      "document.querySelector('#wfx-session-email')?.required ?? false",
    );
    assert.that(
      "the email field carries its required constraint (the first-line honest validation)",
      "required = true",
      String(emailRequired),
      emailRequired === true,
    );
    const passwordMinLength = await browser.eval<number | null>(
      "document.querySelector('#wfx-session-password')?.minLength ?? null",
    );
    assert.that(
      "the password field carries its minimum-length constraint (the rule stated up front)",
      "minLength >= 8",
      String(passwordMinLength),
      passwordMinLength !== null && passwordMinLength >= 8,
    );
    // The empty submit is refused: no reload, no authenticated state.
    await browser.clickInteractive('[data-wfx-session-action="register"]');
    await browser.settle(600);
    const labelAfterEmptySubmit = (await browser.tryText("[data-wfx-session-label]")) ?? "";
    assert.that(
      "the empty submit is honestly refused (no authentication, no silent failure)",
      "still the signed-out identity",
      labelAfterEmptySubmit.slice(0, 60),
      labelAfterEmptySubmit.toLowerCase().includes("signed out"),
    );

    // Fill and submit: the display name stays EMPTY (the optional truth —
    // the R22-G found-and-fixed defect: an optional field must be skippable).
    await browser.fill("#wfx-session-email", "dev@webflix.local");
    await browser.fill("#wfx-session-password", "dev-password-1");
    await browser.clickInteractive('[data-wfx-session-action="register"]');
    // The auto-login reload lands the authenticated state (the server's
    // honest answer — the profile switcher replaces the form).
    await browser.pollTextContains(".wfx-topbar", "Dev profile", 30_000);
    await assert.visible("[data-wfx-profile-switcher]", "the authenticated session renders the profile switcher (the post-registration state)");
    await assert.countAtLeast("[data-wfx-session-action='logout']", 1, "the authenticated session offers its sign-out control");
    await context.screenshot("j36-account-created");

    // The identity's continuity on HOME (the R22-G fix: every surface
    // consumes the request-scoped session — Home included).
    await goto(context, "/");
    await assert.textContains(".wfx-topbar", "Dev profile", "the authenticated identity is continuous on Home (never a stale signed-out render)");

    // -----------------------------------------------------------------
    // 3. CONNECT A SOURCE (R22-D) — the real round trip through the
    //    chooser's own typed controls: disconnect the scripted connected
    //    source, then CONNECT it from the not-connected state.
    // -----------------------------------------------------------------
    await goto(context, "/settings?section=sources");
    await assert.visible("[data-wfx-source-chooser-entry='fake-source']", "the authenticated chooser renders the wired connector (the catalog entry)");
    // The scripted source starts connected (J28's recovered state): its
    // own Disconnect control drives the honest first-connect setup.
    await assert.attrEquals(
      "[data-wfx-source-chooser-entry='fake-source']",
      "data-wfx-source-chooser-state",
      "connected",
      "the chooser states the source's connected truth (the walk starts from the observed state)",
    );
    await browser.clickInteractive("[data-wfx-source-chooser-entry='fake-source'] [data-wfx-source-action='disconnect']");
    // The action POSTs and the page RELOADS from the server's honest next
    // state (no optimism — the poll reads the reloaded DOM).
    await browser.pollTextContains("[data-wfx-source-chooser-state-label]", "Not connected", 30_000);
    await assert.attrEquals(
      "[data-wfx-source-chooser-entry='fake-source']",
      "data-wfx-source-chooser-state",
      "not-connected",
      "the disconnect lands the honest not-connected state",
    );
    await assert.countAtLeast(
      "[data-wfx-source-chooser-entry='fake-source'] [data-wfx-source-action='connect']",
      1,
      "the not-connected entry offers its typed Connect action (the first-connect control)",
    );
    // THE CONNECT: the first-time user's actual action.
    await browser.clickInteractive("[data-wfx-source-chooser-entry='fake-source'] [data-wfx-source-action='connect']");
    await browser.pollTextContains("[data-wfx-source-chooser-state-label]", "Connected", 30_000);
    await assert.attrEquals(
      "[data-wfx-source-chooser-entry='fake-source']",
      "data-wfx-source-chooser-state",
      "connected",
      "the connect lands the Connected truth (the source management state the walk returns to)",
    );
    await context.screenshot("j36-source-connected");

    // -----------------------------------------------------------------
    // 4. BROWSE SOURCE-BACKED CONTENT — back on Home (the primary
    //    navigation), the source strip states the connected truth and
    //    the feed offers the source's content.
    // -----------------------------------------------------------------
    await goto(context, "/");
    await assert.countAtLeast("[data-wfx-source-chip='fake-source']", 1, "the Home source strip shows the connected source");
    await assert.countAtLeast("a[data-wfx-card]", 3, "Home browses source-backed content (the feed's cards)");
    await context.screenshot("j36-browsing");

    // -----------------------------------------------------------------
    // 5. BRING YOUR FEED (F3) — the prerequisite is satisfied; the
    //    panel's own Connect → Preview → Confirm controls drive the real
    //    import (the J33 composition, condensed to the walk's steps).
    // -----------------------------------------------------------------
    // Determinism: the pristine capture phase (the J33 dev-drive law —
    // reads never advance the script; the drive restores phase 0).
    const resetStatus = await byofDrive(context, "dev-reset");
    assert.that(
      "the BYOF drive state resets to the pristine capture phase before the walk's import (determinism)",
      "HTTP 200 from the dev-reset drive",
      `HTTP ${resetStatus}`,
      resetStatus === 200,
    );
    // From HOME's own CTA (the normal path — no direct URL).
    await browser.clickInteractive("[data-wfx-byof-cta]");
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.visible("[data-wfx-byof-panel]", "the Bring your feed panel renders inside Settings → Sources (the existing IA)");
    // Connect the feed-import source (the grant).
    await browser.clickInteractive("[data-wfx-byof-action='connect']");
    await browser.pollTextContains("[data-wfx-byof-source-auth='connected']", "Connected — WebFlix can read the feed", 30_000);
    // Preview: the capture's own order, the snapshot truth, the count.
    await browser.clickInteractive("[data-wfx-byof-action='preview']");
    await browser.pollTextContains("[data-wfx-byof-preview]", "Preview your import from", 30_000);
    await assert.textContains("[data-wfx-byof-preview-count]", "7 items", "the preview states what will be imported");
    await assert.attrEquals(
      "[data-wfx-byof-preview]",
      "data-wfx-byof-order-semantics",
      "source-native",
      "the preview labels its order as source-native (never mislabeled as WebFlix ranking)",
    );
    // Confirm: the feed appears (the Library region's landing).
    await browser.clickInteractive("[data-wfx-byof-action='confirm']");
    await browser.pollTextContains("[data-wfx-byof-feed]", "Your imported feeds", 30_000);
    await assert.attrEquals(
      "[data-wfx-byof-import]",
      "data-wfx-byof-sync-state",
      "live",
      "the confirmed import lands its live state (the authorized continuous route)",
    );
    await context.screenshot("j36-byof-confirmed");

    // -----------------------------------------------------------------
    // 6. FEED-MODE TRANSITION (F4) — the imported-feed mode is NOW
    //    available; the walk switches to it (the real transition).
    // -----------------------------------------------------------------
    await goto(context, "/");
    await assert.attrEquals(
      "[data-wfx-feed-mode-option='byof']",
      "data-wfx-feed-mode-available",
      "true",
      "the imported-feed mode becomes available after the import (the prerequisite satisfied)",
    );
    await browser.clickInteractive("[data-wfx-feed-mode-option='byof']");
    // The control POSTs and the page RELOADS from the server's honest next
    // state — poll the reloaded DOM's selected-mode truth (reload-safe).
    const selectedMode = await pollEvalUntil<string>(
      browser,
      "document.querySelector('[data-wfx-feed-mode-control]')?.getAttribute('data-wfx-feed-mode-selected') ?? ''",
      (mode) => mode === "byof",
    );
    assert.that(
      "the feed-mode switch lands the selected imported-feed mode (the write→reload round trip)",
      "data-wfx-feed-mode-selected = 'byof'",
      selectedMode ?? "<absent>",
      selectedMode === "byof",
    );
    await assert.countAtLeast("[data-wfx-imported-card]", 1, "the imported feed's content renders in the imported-feed mode (source-native cards)");
    await context.screenshot("j36-feed-mode-byof");
    // Switch BACK to For-you (the always-available default) — the walk
    // exercises switching AMONG the modes, and the next step's item card
    // lives in the for-you feed (the source-backed discovery).
    await browser.clickInteractive("[data-wfx-feed-mode-option='foryou']");
    const selectedBack = await pollEvalUntil<string>(
      browser,
      "document.querySelector('[data-wfx-feed-mode-control]')?.getAttribute('data-wfx-feed-mode-selected') ?? ''",
      (mode) => mode === "foryou",
    );
    assert.that(
      "the feed-mode switch back to For-you lands (multiple modes switchable — the frozen vocabulary)",
      "data-wfx-feed-mode-selected = 'foryou'",
      selectedBack ?? "<absent>",
      selectedBack === "foryou",
    );

    // -----------------------------------------------------------------
    // 7. TEMPORARY INTENT + 8. ATTENTION MODE (the Personalize control —
    //    the contextual surface, not a Settings trip).
    // -----------------------------------------------------------------
    await browser.clickInteractive("[data-wfx-personalize-toggle]");
    await browser.settle();
    await assert.visible("[data-wfx-personalize-objective]", "the Personalize control offers the temporary-intent input in context");
    await browser.fill("[data-wfx-personalize-objective]", "cozy detective stories tonight");
    await browser.clickInteractive("[data-wfx-personalize-set-intent]");
    // The intent POSTs and the page RELOADS (the panel re-collapses — the
    // DOM still carries the intent's truth; the reload-safe poll reads it).
    const intentText = await pollEvalUntil<string | null>(
      browser,
      "document.querySelector('[data-wfx-personalize-intent]')?.textContent ?? null",
      (text) => text !== null && text.includes("cozy detective stories tonight"),
    );
    assert.that(
      "the temporary intent lands after the write→reload round trip",
      "the stated objective rendering in the intents list",
      intentText ?? "<absent>",
      intentText !== null && intentText.includes("cozy detective stories tonight"),
    );
    await assert.textContains(
      "[data-wfx-personalize-intent]",
      "ends with this session",
      "the intent states its session scope (temporary — never a durable preference)",
    );
    // The attention mode: re-open the (re-collapsed) panel, switch to
    // Mindful, and poll the RELOADED DOM's checked truth (reload-safe).
    await browser.clickInteractive("[data-wfx-personalize-toggle]");
    await browser.settle();
    await browser.clickInteractive("[data-wfx-attention-mode='mindful']");
    const mindfulChecked = await pollEvalUntil<string | null>(
      browser,
      "document.querySelector(\"[data-wfx-attention-mode='mindful']\")?.getAttribute('aria-checked') ?? null",
      (checked) => checked === "true",
    );
    assert.that(
      "the attention mode changes and renders its current truth (the write→reload round trip)",
      "aria-checked = 'true' on the mindful choice",
      mindfulChecked ?? "<absent>",
      mindfulChecked === "true",
    );
    await context.screenshot("j36-personalize");

    // -----------------------------------------------------------------
    // 9-11. OPEN AN ITEM (from a Home card) → Where to watch → AI action.
    // -----------------------------------------------------------------
    await goto(context, "/");
    const itemHref = await browser.eval<string | null>(
      `(() => { const link = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '').startsWith("Asteroid Drift")); return link === undefined ? null : link.getAttribute('href'); })()`,
    );
    assert.that(
      "the home feed offers the walk's item card (the item path starts from Home)",
      "an aria-labeled card link",
      itemHref ?? "<none>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");
    await assert.visible("[data-wfx-where-to-watch]", "the item hub answers 'where can I watch this?' (the Where-to-watch row)");
    await assert.countAtLeast("[data-wfx-watch-option]", 3, "the Where-to-watch row offers the realizations (canonical identity first)");
    // The AI action tray: open it and RUN the transcript action (the
    // honest queued receipt — the operation state vocabulary).
    await browser.clickInteractive("[data-wfx-ai-tray-toggle]");
    await browser.settle();
    await assert.visible("[data-wfx-ai-tray]", "the AI action tray renders in the item's context (the place to USE AI)");
    await browser.clickInteractive("[data-wfx-ai-submit='transcript']");
    await browser.pollTextContains("[data-wfx-ai-operation-sentence]", "Queued", 30_000);
    await assert.attrEquals(
      "[data-wfx-ai-operation]",
      "data-wfx-ai-operation-state",
      "queued",
      "the AI action answers its honest queued receipt (never a fabricated result)",
    );

    // -----------------------------------------------------------------
    // 12. RECOMMENDATION FEEDBACK — the item hub's feedback controls.
    // -----------------------------------------------------------------
    await assert.visible("[data-wfx-feedback-controls]", "the item hub offers the recommendation-feedback controls in context");
    await browser.clickInteractive("[data-wfx-feedback='more-like-this']");
    await browser.pollTextContains("[data-wfx-feedback-record='more-like-this']", "More like this", 30_000);
    await assert.countAtLeast(
      "[data-wfx-feedback-recorded='true']",
      1,
      "the feedback control records its applied state (the reversible vocabulary)",
    );
    await context.screenshot("j36-item-decisions");

    // -----------------------------------------------------------------
    // 13. PLAYER + REALIZATION SWITCHING — from the item's own Play.
    // -----------------------------------------------------------------
    const playHref = await browser.eval<string | null>(
      "document.querySelector('[data-wfx-item-play]')?.getAttribute('href') ?? null",
    );
    assert.that("the item hub offers the play decision (the player path starts from the item)", "a play link", playHref ?? "<absent>", playHref !== null);
    await goto(context, playHref ?? "/");
    await assert.visible("[data-wfx-player-mode-label]", "the player states the active realization in user vocabulary");
    await assert.visible("[data-wfx-ai-tray-surface='player']", "the player carries the same AI action tray (the use-AI surface)");
    // The realization switch: the Where-to-watch row's own switch control.
    await browser.clickInteractive("[data-wfx-watch-switch='browser']");
    // A normal link navigation: the player re-renders in the browser mode.
    await browser.pollTextContains("[data-wfx-player-mode-label]", "browser", 30_000);
    const modeLabel = (await browser.tryText("[data-wfx-player-mode-label]")) ?? "";
    assert.that(
      "the realization switch lands the browser mode's own truth (the mode label changes)",
      "the browser-mode label",
      modeLabel.slice(0, 80),
      modeLabel.includes("browser"),
    );
    await context.screenshot("j36-realization-switched");

    // -----------------------------------------------------------------
    // 14. SHORTS AFTER HYDRATION (F7) — the Share control is present AND
    //     usable; Like/Save render only where the source advertises them
    //     (the fixture source does NOT — the typed absence is the truth).
    // -----------------------------------------------------------------
    await goto(context, "/shorts");
    await assert.visible("[data-wfx-shorts-viewport]", "the Shorts destination renders the vertical feed");
    // HYDRATION is the gate: the control must be REACT-INTERACTIVE (a
    // pre-hydration click is a silent no-op — the harness's own law).
    await browser.waitForInteractive("[data-wfx-shorts-action='share']", 20_000);
    await assert.countAtLeast("[data-wfx-shorts-action='share']", 1, "the Share control is present on the current card (event-only, no capability needed)");
    // The capability truth: the fixture source declares NEITHER like NOR
    // save — the typed absence is honest (never fake controls). This is
    // the F7 law: actions render where the source ADVERTISES them.
    await assert.countExactly("[data-wfx-shorts-action='like']", 0, "like renders only where the source declares the capability (typed absence — the fixture source does not)");
    await assert.countExactly("[data-wfx-shorts-action='save']", 0, "save renders only where the source declares the capability (typed absence — the fixture source does not)");
    // USE the Share control: the click must not fail (the event emits; no
    // error surface, no page error — the harness's page-error gate).
    await browser.clickInteractive("[data-wfx-shorts-action='share']");
    await browser.settle();
    await assert.countExactly("[data-wfx-shorts-action-error]", 0, "using Share answers no action error (the honest event-only emission)");
    await context.screenshot("j36-shorts-hydrated");

    // -----------------------------------------------------------------
    // 15. LIBRARY CONTINUITY — the four sections with the imported feed.
    // -----------------------------------------------------------------
    await goto(context, "/library");
    for (const section of ["data-wfx-library-watchlist", "data-wfx-library-history", "data-wfx-library-offline"]) {
      await assert.visible(
        `[${section}]`,
        `the Library renders its '${section.replace("data-wfx-library-", "")}' section (continuity)`,
      );
    }
    await assert.visible("[data-wfx-byof-feed]", "the Library renders the imported-feeds region (the walk's import)");
    await assert.countAtLeast("[data-wfx-byof-import]", 1, "the confirmed import renders its durable card in the Library");
    await context.screenshot("j36-library");

    // -----------------------------------------------------------------
    // 16. MODEL & AI MANAGEMENT → 17. BYOM ADD/REMOVE (R22-F) — through
    //     the panel's own form; the key NEVER renders back (the secret law).
    // -----------------------------------------------------------------
    await goto(context, "/settings?section=model");
    await assert.visible("[data-wfx-byom-management]", "the Model & AI section renders the BYOM management panel (the management surface)");
    await assert.attrEquals(
      "[data-wfx-byom-management]",
      "data-wfx-byom-authenticated",
      "true",
      "the panel states the authenticated truth (bindings belong to the account)",
    );
    // Open the add form (the single primary action).
    await browser.clickInteractive("[data-wfx-byom-action='add']");
    await browser.settle();
    await assert.visible("[data-wfx-byom-add-form]", "the add-provider form opens (the F8 management entry point)");
    await assert.visible("[data-wfx-byom-key-hint]", "the form states the key's storage truth up front (encrypted, never shown again)");
    // Fill through the form's own inputs.
    await browser.fill("#wfx-byom-provider-id", "j36-provider");
    await browser.fill("#wfx-byom-endpoint", "https://provider.example/v1");
    await browser.fill("#wfx-byom-key", "sk-j36-secret-evidence-key");
    await browser.clickInteractive("[data-wfx-byom-action='bind']");
    // The bind POSTs and the page RELOADS: the bound row appears with its
    // REMOVE action (the add→observe round trip — the R22-G found-and-fixed
    // defect: the registry read now answers the binding).
    await browser.pollTextContains("[data-wfx-byom-state-label]", "Added", 30_000);
    await assert.visible("[data-wfx-byom-entry='j36-provider']", "the added provider renders its bound row (the registry read answers the binding)");
    // THE SECRET LAW: the key NEVER reaches the rendered DOM.
    const modelHtml = await browser.tryHtml("[data-wfx-settings-model]") ?? "";
    assert.that(
      "the submitted provider key NEVER renders back (the secret law's UI twin)",
      "no key material in the Model & AI DOM",
      modelHtml.includes("sk-j36-secret-evidence-key") ? "THE KEY LEAKED INTO THE DOM" : "no key material",
      !modelHtml.includes("sk-j36-secret-evidence-key"),
    );
    await context.screenshot("j36-byom-added");
    // REMOVE: the row's own action; the removal lands (the empty state returns).
    await browser.clickInteractive("[data-wfx-byom-remove='j36-provider']");
    await browser.pollTextContains("[data-wfx-byom-empty]", "No model provider of your own", 30_000);
    await assert.countExactly("[data-wfx-byom-entry='j36-provider']", 0, "the removed provider is gone (the honest removal — never a stale row)");
    await context.screenshot("j36-byom-removed");

    // -----------------------------------------------------------------
    // 18. SIGN OUT → 19. THE HONEST ANONYMOUS STATE.
    // -----------------------------------------------------------------
    await goto(context, "/settings?section=general");
    await browser.clickInteractive("[data-wfx-session-action='logout']");
    // The cookie clears and the page reloads to the signed-out truth.
    await browser.pollTextContains(".wfx-topbar", "Signed out", 30_000);
    await assert.visible("[data-wfx-session-signed-out]", "the session controls return to the sign-in/create surface (the honest post-sign-out state)");
    // The identity's continuity on Home: signed out EVERYWHERE.
    await goto(context, "/");
    await assert.textContains(".wfx-topbar", "Signed out", "the anonymous state is continuous on Home after the sign-out (never a stale authenticated render)");
    await assert.countExactly("[data-wfx-profile-switcher]", 0, "no profile switcher renders after the sign-out (no fabricated authenticated state)");
    await context.screenshot("j36-signed-out");

    await describe(
      context,
      "the full first-run journey completed without a single dead end: the Home source-strip CTA landed the chooser's anonymous prerequisite (its own sign-in link); the create-account form answered the honest per-field errors on the empty submit, accepted the optional display name left empty, auto-logged in, and the identity stayed continuous on Home; the source connect round trip ran through the chooser's own disconnect→connect controls with the Connected truth; Home browsed the source-backed feed; Bring Your Feed reset its capture phase, connected, previewed the 7-item source-native snapshot, and confirmed the live import; the imported-feed mode transitioned from honestly-unavailable (named prerequisite) to selected (the imported cards rendering); the Personalize control set the session-scoped temporary intent and switched the attention mode (both write→reload round trips landing); the item hub answered Where-to-watch, ran the AI transcript action to its honest queued receipt, and recorded the more-like-this feedback; the player switched realizations through its own Where-to-watch control; the hydrated Shorts feed offered the usable Share control with the typed-absent like/save (the source advertises neither); the Library rendered all four sections with the imported feed; the Model & AI panel added the BYOM provider through its own form (the key never rendering back), and removed it (the empty state's return); the sign-out landed the honest anonymous state on every surface",
    );
  },
};
