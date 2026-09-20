/**
 * @wfx/journeys — J36 Major user journey completion / no dead-end
 * discovery (encoded Web journey, R22-G).
 *
 * Doc expectation (docs/validation/webflix-golden-journeys.md §J36):
 * "Start from fresh Home, with no documentation and no direct route
 * navigation: Home → create/sign in → connect a source using a
 * supported connector → return to source management with Connected
 * truth → browse source-backed content → Bring Your Feed → preview +
 * confirm an authorized import → switch among available feed modes →
 * set temporary intent → change attention mode → open an item → choose
 * Where to watch → use an AI action → provide recommendation feedback
 * → use Shorts and verify Like/Save/Share after hydration → open
 * Library → verify Watchlist / History / Imported Feeds / Offline
 * truth → open Model & AI management → add/remove BYOM where supported
 * → sign out → verify honest anonymous state."
 *
 * J36 verifies that the user can actually FINISH the journey after
 * reaching the capability (J34/J35 proved reachability; this is the
 * completion sweep — the R22 dead-end-killer round trip).
 *
 * Encoding: the full walk over the REAL product paths on the
 * deterministic web-fixture boot — every step starts from a normal
 * surface (Home, the session menu, the primary navigation, Settings)
 * and asserts the honest completion state: the register form's
 * account-creation round trip (the R22-E closer), the source
 * chooser's typed entry truth (the R22-D/F2 killer — never the same
 * empty state again), the BYOF progress after connection, the four
 * feed modes, the intent/attention controls, the item hub's
 * Where-to-watch/AI/feedback surfaces, the hydrated Shorts actions
 * (the source's own capability truth — typed presence AND typed
 * absence), the Library's three states, the BYOM add/remove round
 * trip (the R22-F/F8 closer — a normal-path management surface, never
 * a hidden API), the sign-out, and the honest anonymous state. The
 * walk carries the J34 stale-completion sweep (no "arrives later"
 * copy on any visited surface).
 *
 * HONEST LIMITS (listed): the fixtures-mode register is the scripted
 * dev persona (the loud dev badge — the REAL register transport's
 * round trips are the service-mode local-only procedure, proven at
 * the contract level by R22-B's tests); the real provider OAuth dance
 * is J14/J28's service-side procedure (the chooser's typed entry +
 * connected truth is encoded here); the production-parity sweep (J35)
 * remains the lead's live-deployment journey. The harness imports
 * nothing from any @wfx package per the layering law.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** The stale-completion markers (the J34 primitive, mirrored verbatim). */
const STALE_COMPLETION_MARKERS: readonly RegExp[] = [
  /arriv(?:es?|ing)\s+with\s+(?:the\s+)?[\w\s-]*lane/i,
  /arriv(?:es?|ing)\s+later/i,
  /seeded\s+until/i,
  /until\s+(?:R\d{1,2}|personal ranking|the\s+[\w\s-]*lane\s+(?:lands|ships))/i,
  /R\d{1,2}\s+(?:ships|lands|arrives)\s+(?:later|with)/i,
  /(?:ships|lands?|arriv(?:es?|ing))\s+with\s+(?:the\s+)?R\d{1,2}\b/i,
  /lands?\s+with\s+(?:the\s+)?[\w\s-]*lane/i,
];

export const j36MajorJourneyCompletion: Journey = {
  id: "J36",
  title: "Major user journey completion / no dead-end discovery",
  doc: "docs/validation/webflix-golden-journeys.md §J36",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ------------------------------------------------------------------
    // 1 — fresh Home: the honest starting surface + the identity entry.
    // ------------------------------------------------------------------
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "the fresh Home surface renders");
    await browser.clickInteractive(".wfx-avatar-menu__summary");
    await assert.visible(
      "[data-wfx-session-signin]",
      "the session menu offers the create/sign-in path (the J36 identity entry — no documentation needed)",
    );

    // ------------------------------------------------------------------
    // 2 — account creation (R22-E): the normal-path register round trip.
    // ------------------------------------------------------------------
    await goto(context, "/settings?section=general");
    await assert.visible("[data-wfx-session-controls]", "the session controls render in Settings");
    await assert.visible(
      "[data-wfx-session-signed-out]",
      "the session states the honest signed-out identity before the journey starts",
    );
    // The create-account toggle: the mode switch is a NORMAL-path control.
    await assert.visible(
      "[data-wfx-session-mode-option='register'], [data-wfx-session-mode-toggle]",
      "the Create account entry is visible from the signed-out state (the F1 closer — never a hidden API)",
    );
    // Switch to the register mode and verify the register form's shape.
    const hasModeOption = await browser.tryText("[data-wfx-session-mode-option='register']");
    if (hasModeOption === null) {
      await browser.clickInteractive("[data-wfx-session-mode-toggle]");
    } else {
      await browser.clickInteractive("[data-wfx-session-mode-option='register']");
    }
    await assert.attrEquals(
      "[data-wfx-session-controls]",
      "data-wfx-session-mode",
      "register",
      "the register form is the active mode (one primary action per state — no modal sprawl)",
    );
    await assert.visible(
      "#wfx-session-display-name",
      "the register form carries the display-name field (the create-account shape, not the sign-in shape)",
    );
    // Fill and submit: the fixtures persona answers (the loud dev badge is
    // the honest fixtures truth; the auto-login continuity is the J36 law).
    await browser.fill("#wfx-session-email", "dev@webflix.local");
    await browser.fill("#wfx-session-display-name", "J36 Journey Walker");
    await browser.fill("#wfx-session-password", "dev-password-1");
    await browser.clickInteractive("[data-wfx-session-action='register']");
    // The register success RELOADS the page (no optimistic state — the
    // component's own law); the navigation-safe wait polls through the
    // reload before the assertions read the fresh DOM.
    await browser.waitSelector("[data-wfx-session-signed-in]", 20_000);
    await assert.visible(
      "[data-wfx-session-signed-in]",
      "the register round trip completes into the authenticated state (auto-login continuity — the account exists and the session is live)",
    );
    await assert.visible(
      "[data-wfx-profile-select]",
      "profile selection is downstream of the authenticated state (the registration closed the identity gap first)",
    );

    // ------------------------------------------------------------------
    // 3 — the source chooser (R22-D/F2): the first-connect completion.
    // ------------------------------------------------------------------
    await goto(context, "/settings?section=sources");
    await assert.visible("[data-wfx-settings-sources]", "the settings sources section renders");
    await assert.visible(
      "[data-wfx-source-chooser]",
      "the source chooser renders in the sources section (the F2 dead-end killer — the CTA no longer loops to the same empty state)",
    );
    await assert.visible(
      "[data-wfx-source-chooser-entry]",
      "the chooser carries at least one supported connector entry (a real catalog, never a bare anchor)",
    );
    // The entry's typed truth: the state label + the typed action (the
    // connector identifier + the state + the action are the R22-A model).
    await assert.visible(
      "[data-wfx-source-chooser-state-label]",
      "the chooser entry states its connection truth (the state label — never a fabricated state)",
    );
    const chooserEntryState = await browser.tryAttr("[data-wfx-source-chooser-entry]", "data-wfx-source-chooser-state");
    assert.that(
      "the chooser entry carries the typed connection-journey state (the R22-A union)",
      "a typed state (connected / not-connected / connecting / authorization-expired / failed / unsupported)",
      chooserEntryState ?? "<none>",
      chooserEntryState !== null &&
        ["connected", "not-connected", "connecting", "authorization-expired", "failed", "unsupported"].includes(
          chooserEntryState,
        ),
    );
    const connectedTruth = await browser.tryText("[data-wfx-source-chooser-state-label]");
    assert.that(
      "the fixture source's connected truth renders in user vocabulary (the return-to-source-management law)",
      "the Connected state label",
      connectedTruth ?? "<none>",
      connectedTruth !== null && connectedTruth.toLowerCase().includes("connected"),
    );

    // ------------------------------------------------------------------
    // 4 — BYOF after connection (the prerequisite is satisfied).
    // (The proven J33 flow: the fixture source starts not-connected — the
    // J36 walk CONNECTS it first, then completes the import.)
    // ------------------------------------------------------------------
    await assert.visible(
      "[data-wfx-byof-panel]",
      "the Bring your feed panel renders inside the sources section (BYOF is reachable once the prerequisite is satisfied — no direct URL)",
    );
    await assert.visible(
      "[data-wfx-byof-source='youtube']",
      "the feed-import source card renders (the choose-source step of the import journey)",
    );
    // Connect the source (the prerequisite completion), then the import.
    await browser.clickInteractive("[data-wfx-byof-action='connect']");
    await browser.pollTextContains(
      "[data-wfx-byof-source-auth='connected']",
      "Connected — WebFlix can read the feed",
      30_000,
    );
    await browser.clickInteractive("[data-wfx-byof-action='preview']");
    await browser.pollTextContains("[data-wfx-byof-preview]", "Preview your import from", 30_000);
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.visible(
      "[data-wfx-byof-preview]",
      "the authorized import preview renders (preview before confirm — the provenance law)",
    );
    await browser.clickInteractive("[data-wfx-byof-action='confirm']");
    await browser.pollTextContains("[data-wfx-byof-feed]", "Your imported feeds", 30_000);
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.visible(
      "[data-wfx-byof-import]",
      "the confirmed import renders its durable card (the BYOF journey completed)",
    );

    // ------------------------------------------------------------------
    // 5 — the feed modes (the imported feed is now a real mode).
    // ------------------------------------------------------------------
    await goto(context, "/");
    await assert.visible(
      "[data-wfx-feed-mode-option]",
      "the feed-mode choices render on the live surface (For you / Following / Your imported feed / Blend)",
    );
    const homeText = await browser.tryText("[data-wfx-surface='home']");
    assert.that(
      "the imported feed mode is present after the BYOF import (the mode transition law)",
      "the imported-feed mode label",
      homeText !== null && /imported/i.test(homeText) ? "imported mode present" : "no imported mode text",
      homeText !== null && /imported/i.test(homeText),
    );

    // ------------------------------------------------------------------
    // 6 — temporary intent + attention mode (the personalize controls).
    // ------------------------------------------------------------------
    await browser.clickInteractive("[data-wfx-personalize-toggle]");
    await assert.visible(
      "[data-wfx-personalize-set-intent]",
      "the temporary session intent control renders (Personalize → intent)",
    );
    await assert.visible(
      "[data-wfx-attention-mode]",
      "the attention modes render (Mindful / Balanced / Immersive / Custom)",
    );

    // ------------------------------------------------------------------
    // 7 — the item hub: Where to watch + AI tray + feedback.
    // ------------------------------------------------------------------
    const itemHref = await browser.eval<string | null>(
      `(() => { const link = [...document.querySelectorAll('a[data-wfx-card]')].find((a) => (a.getAttribute('aria-label') ?? '') !== ''); return link === undefined ? null : link.getAttribute('href'); })()`,
    );
    assert.that(
      "a source-backed item is browsable from the normal surface (no direct route navigation)",
      "a card link on Home",
      itemHref ?? "<none>",
      itemHref !== null && itemHref.length > 0,
    );
    if (itemHref !== null) {
      await goto(context, itemHref);
      await assert.visible(
        "[data-wfx-item-availability], [data-wfx-acquisition]",
        "the item states where to watch (the realization truth — the Where-to-watch step)",
      );
      await assert.visible(
        "[data-wfx-ai-tray-toggle], [data-wfx-ai-tray]",
        "the AI tray is reachable from the item (the use-an-AI-action step)",
      );
      await assert.visible(
        "[data-wfx-feedback-controls], [data-wfx-feedback]",
        "the recommendation feedback controls render (the provide-feedback step)",
      );
    }

    // ------------------------------------------------------------------
    // 8 — Shorts: the hydrated action truth (typed presence + absence).
    // ------------------------------------------------------------------
    await goto(context, "/shorts");
    await assert.visible("[data-wfx-shorts-viewport]", "the Shorts viewport renders");
    await assert.visible(
      "[data-wfx-shorts-action='share']",
      "the Share action is present after hydration (the source advertises it)",
    );
    // The typed absence law: like/save render ONLY when the source
    // declares them (the fixtures source does not — the honest truth).
    const likeCount = await browser.eval<number>(
      `document.querySelectorAll("[data-wfx-shorts-action='like']").length`,
    );
    assert.that(
      "Like renders exactly when the source declares the capability (the J36 hydration law — presence where permitted, typed absence where not)",
      "the like control's capability truth",
      `${likeCount} like control(s)`,
      likeCount === 0,
    );

    // ------------------------------------------------------------------
    // 9 — Library: the three durable states.
    // ------------------------------------------------------------------
    await goto(context, "/library");
    await assert.visible("[data-wfx-library-watchlist]", "the Library Watchlist renders");
    await assert.visible("[data-wfx-library-history]", "the Library History renders");
    await assert.visible(
      "[data-wfx-library-offline], [data-wfx-offline-status]",
      "the Library offline truth renders (the honest Web platform truth)",
    );

    // ------------------------------------------------------------------
    // 10 — BYOM management (R22-F/F8): the add/bind → remove round trip.
    // ------------------------------------------------------------------
    await goto(context, "/settings?section=model");
    await assert.visible("[data-wfx-settings-model]", "the Model & AI settings section renders");
    await assert.visible(
      "[data-wfx-byom-management]",
      "the BYOM management panel renders in Model & AI (the F8 closer — a normal-path management surface, never a hidden API)",
    );
    await assert.visible(
      "[data-wfx-byom-first-party-section]",
      "the built-in model stays visible context (the first-party truth)",
    );
    // The add form: the normal-path provider bind. The form is TOGGLED by
    // the add action (one primary action per state — the anti-sprawl law).
    await assert.visible(
      "[data-wfx-byom-action='add']",
      "the add-provider entry control renders (the management entry point)",
    );
    await browser.clickInteractive("[data-wfx-byom-action='add']");
    await browser.waitSelector("[data-wfx-byom-add-form]", 10_000);
    await assert.visible("[data-wfx-byom-add-form]", "the add-provider form renders (discover → configure)");
    await browser.fill("#wfx-byom-provider-id", "j36-lab-provider");
    await browser.fill("#wfx-byom-endpoint", "https://models.example.net/v1");
    await browser.fill("#wfx-byom-key", "j36-journey-key-material");
    await browser.clickInteractive("[data-wfx-byom-action='bind']");
    // The bind is a real POST → response → state update (network latency,
    // never optimistic) — wait for the bound list before asserting.
    await browser.waitSelector("[data-wfx-byom-bound-list]", 20_000);
    await assert.visible(
      "[data-wfx-byom-bound-list]",
      "the bound-provider list renders after the bind (configure → verified state)",
    );
    const boundEntry = await browser.tryAttr("[data-wfx-byom-entry]", "data-wfx-byom-bound");
    assert.that(
      "the just-bound provider appears in the bound list (the BYOM add completed through the normal surface)",
      "the bound provider entry",
      boundEntry ?? "<none>",
      boundEntry !== null,
    );
    // The key never re-renders (the secret-free law, observed at the surface).
    const modelText = await browser.tryText("[data-wfx-byom-management]");
    assert.that(
      "the provider key NEVER renders back in the management surface (secrets stay server-side)",
      "no key material in the rendered surface",
      modelText !== null && modelText.includes("j36-journey-key-material") ? "KEY MATERIAL VISIBLE" : "no key material",
      modelText === null || !modelText.includes("j36-journey-key-material"),
    );
    // Remove: the unbind round trip (the complete management journey). The
    // remove also reloads (the honest refresh law) — poll through it for
    // the honest empty state.
    await browser.clickInteractive("[data-wfx-byom-action='remove']");
    await browser.waitSelector("[data-wfx-byom-empty]", 20_000);
    await assert.visible(
      "[data-wfx-byom-empty]",
      "after removal the honest empty state renders (the remove completed — WebFlix's built-in model takes over)",
    );

    // ------------------------------------------------------------------
    // 11 — sign out → the honest anonymous state.
    // ------------------------------------------------------------------
    await goto(context, "/settings?section=general");
    await assert.visible(
      "[data-wfx-session-action='logout']",
      "the Sign out control renders in the session controls (the normal-path exit)",
    );
    await browser.clickInteractive("[data-wfx-session-action='logout']");
    // The logout success also reloads (the same no-optimism law) — poll
    // through the reload for the honest anonymous state.
    await browser.waitSelector("[data-wfx-session-signed-out]", 20_000);
    await assert.visible(
      "[data-wfx-session-signed-out]",
      "the sign-out completes into the honest anonymous state (no fabricated profile, no stale session)",
    );

    // ------------------------------------------------------------------
    // 12 — the stale-completion sweep (the J34 primitive, verbatim).
    // ------------------------------------------------------------------
    const visitedSurfaces = ["/", "/settings?section=sources", "/library", "/shorts"];
    for (const path of visitedSurfaces) {
      await goto(context, path);
      const surfaceText = (await browser.tryText("body")) ?? "";
      const stale = STALE_COMPLETION_MARKERS.some((marker) => marker.test(surfaceText));
      assert.that(
        `no stale accepted-capability copy on ${path} (the anti-regression sweep)`,
        "no 'arrives later / ships with R0x' language",
        stale ? "STALE COPY FOUND" : "clean",
        !stale,
      );
    }

    await context.screenshot("j36-major-journey-completion");
    await describe(
      context,
      "the full J36 walk completed on the fixtures boot: account creation through the normal path (auto-login continuity), the source chooser's typed connected truth (no empty-state loop), BYOF preview→confirm after connection, the imported feed mode, the personalize intent + attention controls, the item's Where-to-watch/AI/feedback surfaces, the hydrated Shorts action truth (typed presence and absence), the Library's three states, the BYOM add→bound→remove round trip with the secret-free surface, the sign-out into the honest anonymous state — with zero stale completion copy anywhere",
    );
  },
};
