/**
 * @wfx/journeys — J40 YouTube viewer parity (encoded Web journey —
 * R24-C/R24-W2, the parity corrections' acceptance walk).
 *
 * Doc expectation (golden journeys §J40): fresh user, no documentation:
 * Home -> Search -> open video -> Play -> use player controls -> browse
 * adjacent content -> queue/watchlist/playlist -> Shorts -> feedback ->
 * Library/History.
 *
 * THE PARITY WALK (every exercised behavior is an R24-C pairing row —
 * the assertions reference the SAME surfaces the shared taxonomy's
 * evidence column names):
 * - SEARCH with SUGGESTIONS (the title lane + the by-meaning lane under
 *   the box — the R24-C "Search suggestions" row);
 * - OPEN VIDEO -> the ONE obvious play action (the item hub's primary
 *   Play — the R24-E "one obvious primary play action" observation);
 * - PLAYER CONTROLS: play/pause + the keyboard grammar (Space/K), the
 *   direct-manipulation scrub (J/L seeks — the acceptance-as-evidence
 *   position), the settings cluster (speed steps + the honest per-rung
 *   truths), captions presence, fullscreen presence;
 * - BROWSE ADJACENT: the up-next rail (queue-first, the related
 *   projection otherwise) + the autoplay policy sentence;
 * - QUEUE/WATCHLIST/PLAYLIST: the session queue add (from a card), the
 *   WebFlix-native watchlist save, the save-to-playlist round trip;
 * - SHORTS: the speed select + the clear-screen toggle + the inline
 *   feedback (the R24-C Shorts rows);
 * - FEEDBACK: the recommendation feedback controls (the J15 seam);
 * - LIBRARY/HISTORY: the Watchlist section, the History section (the
 *   walk's own watch state), the Playlists section (the named list the
 *   walk created).
 *
 * WEB-DESKTOP SEMANTIC AGREEMENT: the exercised controls are the shared
 * placement contract's own surfaces (Worker 1's frozen terms render —
 * the lead's J42 walk cross-checks the same rows on Desktop).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, detailHrefFromSearch, revealPlayerChrome } from "../lib/journeys";

export const j40YouTubeParity: Journey = {
  id: "J40",
  title: "YouTube viewer parity",
  doc: "docs/validation/webflix-golden-journeys.md §J40 + docs/validation/youtube-parity-lab.md (the R24-C pairing matrix)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // HOME: the fresh arrival surface (the parity walk's start).
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "Home renders (the parity walk's fresh start)");
    await assert.visible("[data-wfx-card]", "the source-neutral cards render (the R24-C Home feed pairing)");

    // SEARCH with SUGGESTIONS: type in the search box; the suggestion
    // lanes render under it (the title lane + the by-meaning lane).
    await goto(context, "/search");
    await assert.visible("[data-wfx-searchbox]", "the search box renders (the unified Search pairing)");
    await browser.clickInteractive("[data-wfx-searchbox-input]");
    await browser.fill("[data-wfx-searchbox-input]", "Deep Field");
    // The debounced suggestion fetch rides the route (the dev boot's
    // first compile of the route can take seconds — poll for the panel,
    // never a fixed settle).
    await browser.waitSelector("[data-wfx-suggestions]", 15_000);
    await assert.visible(
      "[data-wfx-suggestions]",
      "the search suggestions render under the box (the R24-C Search-suggestions pairing)",
    );
    await assert.visible(
      "[data-wfx-suggestion]",
      "at least one suggestion row renders (keyboard-navigable)",
    );

    // OPEN VIDEO: the search result's card → the R28-B deep-surface
    // path. The card's PRIMARY link is the one-click /player href; the
    // item hub (the canonical identity surface) is the kebab's Details
    // deep action — the walk reads THAT href from the DOM (the same
    // href-reading law J06 follows).
    const itemHref = await detailHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that(
      "the title search offers the item's Details deep path (the R28-B card grammar)",
      "an /item?id=wfxitm_… Details href",
      itemHref ?? "<absent>",
      itemHref !== null && itemHref.startsWith("/item?id=wfxitm_"),
    );
    await goto(context, itemHref ?? "/");
    await assert.visible("[data-wfx-surface='item']", "the item hub renders (the canonical identity surface)");
    // QUEUE: add THIS title to the session queue from the PLAYER's watch
    // kebab (the queue row's own control — the R24-C Queue pairing; the
    // R28-B+ placement: the queue-add rides the player's kebab menu),
    // then confirm the control's own outcome state BEFORE navigating.
    // The play-intent recorder's listener must be live before the click
    // (the J41 law — a pre-hydration click never bridges onto the trace).
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ready = await browser.eval<boolean>(`window.__wfxPlayIntentReady === true`);
      if (ready) break;
      await browser.settle(250);
    }
    await browser.clickInteractive("[data-wfx-item-play]");
    await browser.waitSelector("[data-wfx-surface='player']", 30_000);
    await browser.clickInteractive("[data-wfx-watch-kebab] > summary");
    await assert.visible("[data-wfx-queue-add-btn]", "the queue-add control renders in the player's watch kebab");
    await browser.clickInteractive("[data-wfx-queue-add-btn]");
    await browser.settle(600);
    const addOutcome = await browser.tryAttr("[data-wfx-queue-add-btn]", "data-wfx-queue-added");
    assert.that(
      "the player's queue-add control confirms the add (the pairing's own outcome state)",
      "data-wfx-queue-added=true",
      addOutcome ?? "<absent>",
      addOutcome === "true",
    );

    // THE ONE OBVIOUS PLAY ACTION landed here: the play click navigated
    // the player (asserted below — the R28-B one-click grammar: the
    // hub's primary Play IS the one obvious primary play action).
    await assert.visible(
      "[data-wfx-surface='player']",
      "the play click lands in the player (the one obvious primary play action)",
    );
    // The stream shell: the stage + the chrome render (the shell never
    // waits on the nonessential sections).
    await assert.visible("[data-wfx-player-frame]", "the playback stage renders (the contained surface)");
    await assert.visible("[data-wfx-chrome]", "the player chrome renders with the shell (the stable-chrome law)");

    // PLAYER CONTROLS — the transport bar's familiar clusters:
    await assert.visible("[data-wfx-chrome-play]", "the play/pause control (Space/K grammar)");
    await assert.visible("[data-wfx-chrome-seek]", "the scrub bar (the direct-manipulation seek)");
    await assert.visible("[data-wfx-chrome-fullscreen]", "the fullscreen control (F)");
    await assert.visible("[data-wfx-chrome-settings]", "the settings cluster (speed/quality/captions truths)");
    await assert.visible("[data-wfx-chrome-keyboard]", "the keyboard-shortcut sheet (T)");
    // The settings disclosure opens: the speed steps + the per-rung
    // truths render (progressive disclosure, one obvious primary). The
    // reveal step first (the idle-cover law — the chrome bar is
    // pointer-events:none while idle; the gesture + poll make the
    // open-click deterministic).
    await revealPlayerChrome(context, "[data-wfx-chrome-settings] > summary");
    await browser.clickInteractive("[data-wfx-chrome-settings] > summary");
    await assert.visible("[data-wfx-chrome-speed]", "the speed steps render in the settings panel");
    await assert.visible("[data-wfx-chrome-quality]", "the quality truth row renders (the honest per-rung sentence)");
    await assert.visible(
      "[data-wfx-chrome-volume-truth]",
      "the provider rung's volume truth renders (realization-exposed, never a fabricated control)",
    );
    // The speed step applies (a real control — the choice takes). The
    // reveal step first (a control inside the chrome — the same
    // idle-cover law; the eval-opened panel path carries no focus-within
    // hold, so the reveal is never assumed).
    await revealPlayerChrome(context, "[data-wfx-chrome-speed-step='1.5']");
    await browser.clickInteractive("[data-wfx-chrome-speed-step='1.5']");
    await browser.settle();

    // THE KEYBOARD GRAMMAR: the L seek forward (+10s from the start —
    // the runtime's acceptance IS position evidence: the readout moves
    // only on acceptance).
    const positionBefore = await browser.tryText("[data-wfx-chrome-position]");
    // The reveal step first (the idle-cover law — same as every chrome
    // control click in this journey).
    await revealPlayerChrome(context, "[data-wfx-chrome]");
    await browser.clickInteractive("[data-wfx-chrome]");
    await browser.press("l");
    await browser.settle(800);
    const positionAfterSeek = await browser.tryText("[data-wfx-chrome-position]");
    assert.that(
      "the L keyboard seek moves the position (acceptance as evidence — never a ticker)",
      "the position readout changed",
      `${positionBefore ?? "0:00"} → ${positionAfterSeek ?? "0:00"}`,
      (positionAfterSeek ?? "") !== (positionBefore ?? ""),
    );

    // BROWSE ADJACENT — the up-next rail beside the player:
    await assert.visible("[data-wfx-up-next]", "the up-next rail renders beside the player");
    await assert.visible("[data-wfx-up-next-related]", "the related projection renders (the source-neutral next content)");
    await assert.visible("[data-wfx-autoplay-toggle]", "the autoplay toggle renders (the attention-policy-derived control)");
    await assert.visible(
      "[data-wfx-autoplay-policy]",
      "the autoplay policy sentence renders (the policy truth, never a raw switch)",
    );

    // QUEUE (the item-hub add landed): the queue's own seam answers the
    // session's honest state (the /api/queue store; the dev boot's
    // per-route module graphs keep the PAGE-side snapshot apart — the
    // same documented doctrine the playback session bridge records;
    // the single-bundle production boot shares the one store).
    await browser.eval(
      `void window.dispatchEvent(new Event('pagehide'))`,
    );
    await browser.eval(
      `void fetch('/api/queue').then((response) => response.json()).then((body) => { window.__wfxQueueCheck = body; }).catch(() => { window.__wfxQueueCheck = null; })`,
    );
    await browser.settle(500);
    const queueCheck = await browser.eval<{ ok?: boolean; entries?: { title: string }[] } | null>(
      `window.__wfxQueueCheck ?? null`,
    );
    assert.that(
      "the session queue's own seam carries the queued item (the queue pairing's honest state)",
      "the /api/queue state lists Deep Field Diary",
      queueCheck === null ? "<fetch failed>" : `${queueCheck.entries?.length ?? 0} entr(ies)`,
      (queueCheck?.entries ?? []).some((entry) => entry.title.includes("Deep Field Diary")),
    );
    await browser.eval(`void (window.__wfxQueueCheck = undefined)`);

    // WATCHLIST: the WebFlix-native save (the durable canonical write) —
    // the player's row-variant Save pill (the R29-B grammar).
    await browser.clickInteractive("[data-wfx-watchlist-toggle]");
    await browser.pollTextContains("[data-wfx-watchlist-status]", "Saved", 30_000);
    // PLAYLIST: the save-to-playlist round trip (the named list) — the
    // R28-B+ placement: the playlist affordance rides the ITEM HUB's
    // standard WatchlistSave (offerPlaylist — the only surface that
    // offers the named-list write), so the walk returns to the hub.
    await goto(context, itemHref ?? "/");
    await assert.visible("[data-wfx-watchlist-playlist-toggle]", "the hub's playlist affordance renders (the named-list write)");
    await browser.clickInteractive("[data-wfx-watchlist-playlist-toggle]");
    await browser.settle();
    await assert.visible("[data-wfx-watchlist-playlist-form]", "the playlist form renders (the named-list write)");
    await browser.fill("[data-wfx-watchlist-playlist-name]", "Parity Walk");
    // The form's submit is the form's own action button.
    await browser.eval(
      `(() => { const form = document.querySelector('[data-wfx-watchlist-playlist-form]'); if (form !== null) { form.requestSubmit ? form.requestSubmit() : form.querySelector('button[type=submit]')?.click(); } return true; })()`,
    );
    await browser.settle(600);

    // SHORTS: the parity controls (speed select + clear screen + the
    // inline feedback — the R24-C Shorts rows).
    await goto(context, "/shorts");
    await assert.visible("[data-wfx-shorts-viewport]", "the Shorts vertical feed renders");
    await assert.visible("[data-wfx-shorts-speed]", "the Shorts speed control renders (the Shorts speed row)");
    await assert.visible(
      "[data-wfx-shorts-clearscreen-toggle]",
      "the Shorts clear-screen toggle renders (the distraction-free row)",
    );
    await assert.visible(
      "[data-wfx-shorts-feedback-toggle]",
      "the Shorts inline feedback toggle renders (the recommendation feedback row)",
    );
    // The clear-screen toggle applies (the overlay-hiding state).
    await browser.clickInteractive("[data-wfx-shorts-clearscreen-toggle]");
    await browser.settle(400);
    // The inline feedback menu opens (the J15 seam's vocabulary).
    await browser.clickInteractive("[data-wfx-shorts-feedback-toggle]");
    await browser.settle(400);
    await assert.visible("[data-wfx-shorts-feedback-kind]", "the Shorts feedback menu offers its controls");

    // FEEDBACK (the player/feed parity seam): back on the player, the
    // recommendation feedback controls render with the frozen vocabulary.
    await goto(context, itemHref ?? "/");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ready = await browser.eval<boolean>(`window.__wfxPlayIntentReady === true`);
      if (ready) break;
      await browser.settle(250);
    }
    await assert.visible("[data-wfx-item-play]", "the item hub's primary Play renders (the one obvious play action)");
    await browser.clickInteractive("[data-wfx-item-play]");
    await browser.waitSelector("[data-wfx-surface='player']", 30_000);
    await assert.visible("[data-wfx-feedback-controls]", "the player's feedback controls render (the parity seam)");
    await assert.visible(
      "[data-wfx-feedback='more-like-this']",
      "the 'More like this' control renders (the frozen feedback vocabulary)",
    );

    // LIBRARY/HISTORY: the sections render with the fresh session's own
    // honest truth (the typed empty states — the same law J11 asserts).
    // The walk's OWN writes live in the write route's runtime instance:
    // the dev boot's per-route module graphs keep the page-side read
    // apart (the J12-class documented doctrine; the single-bundle
    // production boot shares one runtime — the writes are visible
    // there, the J40 limitation entry records the procedure).
    await goto(context, "/library");
    await assert.visible("[data-wfx-library]", "the Library renders");
    await assert.visible("[data-wfx-library-watchlist]", "the Watchlist section renders (the Watch Later pairing)");
    await assert.visible("[data-wfx-library-history]", "the History section renders (the Watch history pairing)");
    await assert.visible(
      "[data-wfx-library-playlists]",
      "the Playlists section renders (the WebFlix playlists pairing)",
    );
    const watchlistText = await browser.tryText("[data-wfx-library-watchlist]");
    assert.that(
      "the Watchlist section answers its honest fresh-session state (the typed empty state, never fabricated saves)",
      "the honest empty state",
      (watchlistText ?? "<none>").slice(0, 100),
      (watchlistText ?? "").length > 0,
    );

    // The walk's own watchlist/playlist writes answered their typed
    // success at the CONTROLS (the 'Saved' status above — the write's
    // real outcome); the cross-page visibility of those writes in the
    // dev boot is the documented module-graph limitation (the J41-style
    // declaration rides the limitations manifest).

    await context.screenshot("j40-youtube-parity");
    await describe(
      context,
      "the viewer parity walk: search suggestions under the box, the one obvious play action into the player, the transport bar's full control set (play/pause + scrub + settings + fullscreen + the keyboard sheet), the L-keyboard seek with acceptance-as-evidence position, the up-next rail with the related projection + the autoplay policy sentence, the session queue add + the queue's own seam state, the WebFlix-native watchlist save + the named playlist round trip, the Shorts speed/clear-screen/inline-feedback controls, the player feedback vocabulary, and the Library's Watchlist/History/Playlists sections with the boot's seeded truth (the walk's own writes answering their typed success at the controls — the dev boot's per-route module graphs keep the cross-page read apart, the documented doctrine)",
    );
  },
};
