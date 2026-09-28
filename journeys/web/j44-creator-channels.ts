/**
 * @wfx/journeys — J44 the creator-channel round trip (encoded Web
 * journey — R36; the survey's WAVE R36 journey).
 *
 * Doc expectation (docs/plans/2026-09-28-youtube-parity-survey.md —
 * WAVE R36 "Journeys: new J43 (channel browse/subscribe round trip)";
 * encoded as J44 — the survey's "J43" numbering collided with the
 * R25-W2 realtime-translation J43 already in the catalog at base
 * 8937bb8, so the channel journey takes the next free number; recorded
 * in evidence/r36/):
 *
 *   home → search a known creator name → the channel result row → the
 *   channel page → tab through Videos/Shorts/Playlists/About →
 *   Subscribe → the Library's Subscriptions list shows it → the bell
 *   round trip.
 *
 * WEB-SIDE ENCODING (over the fixtures boot — driven as a user):
 * - THE CREATOR SEARCH: the known creator on this boot is the fixture
 *   source's own display name ("Fake Source (TEST FIXTURE — never
 *   production)"); searching its name surfaces THE CHANNEL RESULT ROW
 *   above the item results (the honest subscriber truth — the typed
 *   absence, never a fabricated count; the real inline Subscribe);
 * - THE CHANNEL PAGE: the banner's typed absence, the monogram avatar,
 *   the R33-C display name + the @handle, the tab bar, the channel
 *   search field — every slot honest by construction;
 * - THE TABS: Videos (6 long-form items), Shorts (3 short-form — the
 *   same eligibility the shorts feed applies), Playlists (the typed
 *   empty state), About (the honest typed absences + the source's own
 *   connection date + the derived counts);
 * - THE IN-CHANNEL SEARCH: the field filters the channel's own items
 *   (the title containment law) and the honest disclosure names the
 *   filtered truth;
 * - THE SUBSCRIBE ROUND TRIP: the channel page's pill performs the REAL
 *   library write (the same POST /api/library seam the watch page's
 *   pill uses — ONE store, the frozen "Subscriptions" list name) and
 *   the LIBRARY's Subscriptions playlist section shows the entry;
 * - THE BELL ROUND TRIP: the bell appears once subscribed (the corpus
 *   grammar), the menu offers All / Personalized / None (the persisted
 *   per-channel preference record — the browser's own local store),
 *   the honest delivery note names the later-wave truth (never a dead
 *   imitation), and the choice persists in the record;
 * - THE ANONYMOUS LAW: the whole round trip runs without a WebFlix
 *   account — no login gate ever appears.
 *
 * THE ENCODING LAW: every step asserts the doc's expected states and
 * THROWS on regression (a journey that cannot fail is not a check).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** The fixtures boot's known creator (the sources model's own displayName). */
const CREATOR_NAME = "Fake Source (TEST FIXTURE — never production)";

/** The creator's handle (the slugified stable connector id). */
const CREATOR_HANDLE = "fake-source";

/** The channel page's URL (the presentation route). */
const CHANNEL_URL = `/channel/${CREATOR_HANDLE}`;

export const j44CreatorChannels: Journey = {
  id: "J44",
  title: "Creator channel round trip",
  doc: "docs/plans/2026-09-28-youtube-parity-survey.md §WAVE R36 (the channel browse/subscribe round trip)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ------------------------------------------------------------------
    // 1. Home → search a known creator name.
    // ------------------------------------------------------------------
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "the home feed renders");
    await goto(context, `/search?q=${encodeURIComponent("Fake")}`);

    // ------------------------------------------------------------------
    // 2. The channel result row (above the item results — the YouTube grammar).
    // ------------------------------------------------------------------
    await assert.visible(`[data-wfx-channel-result='${CREATOR_HANDLE}']`, "the creator-name search surfaces the channel result row");
    await assert.textContains(`[data-wfx-channel-result='${CREATOR_HANDLE}']`, CREATOR_NAME, "the channel row carries the sources model's own display name (the R33-C seam)");
    await assert.textContains(`[data-wfx-channel-result='${CREATOR_HANDLE}']`, "Subscriber count not declared by this source", "the channel row's subscriber slot is the typed absence (never a fabricated count)");
    await assert.visible(`[data-wfx-channel-result='${CREATOR_HANDLE}'] [data-wfx-channel-inline-subscribe]`, "the channel row carries the real inline Subscribe (the one-store law)");

    // ------------------------------------------------------------------
    // 3. The channel result row → the channel page (the user path: the row's own link).
    // ------------------------------------------------------------------
    const channelHref = await browser.tryAttr(`[data-wfx-channel-result='${CREATOR_HANDLE}'] [data-wfx-channel-result-link='${CREATOR_HANDLE}']`, "href");
    assert.that(
      "the channel row links to the channel page (the handle law's route)",
      `/channel/${CREATOR_HANDLE}`,
      channelHref ?? "<no href>",
      channelHref === `/channel/${CREATOR_HANDLE}`,
    );
    await goto(context, CHANNEL_URL);

    // ------------------------------------------------------------------
    // 4. The channel page's grammar (every slot honest by construction).
    // ------------------------------------------------------------------
    await assert.visible("[data-wfx-surface='channel']", "the channel page renders");
    await assert.visible("[data-wfx-channel-banner='absent']", "the banner renders its typed absence (the source declares no banner — never a fabricated image)");
    await assert.textContains("[data-wfx-channel-banner-absent]", "does not fabricate", "the banner absence names its truth honestly");
    await assert.visible("[data-wfx-channel-avatar]", "the channel avatar renders (the honest monogram)");
    await assert.textContains("[data-wfx-channel-name]", CREATOR_NAME, "the channel name is the sources model's own display name (the R33-C seam)");
    await assert.textContains("[data-wfx-channel-meta]", `@${CREATOR_HANDLE}`, "the meta line carries the honest @handle (the slugified stable connector id)");
    await assert.textContains("[data-wfx-channel-meta]", "declares no subscriber count", "the meta line's subscriber slot is the typed absence (never a fabricated number)");
    await assert.visible("[data-wfx-channel-tabs]", "the tab bar renders");
    for (const tab of ["home", "videos", "shorts", "playlists", "about"] as const) {
      await assert.visible(`[data-wfx-channel-tab='${tab}']`, `the ${tab} tab renders`);
    }
    await assert.visible("[data-wfx-channel-search-input]", "the channel search field renders");
    // The Home tab: the channel's real items (the discovery-derived feed).
    await assert.countAtLeast("[data-wfx-channel-items] [data-wfx-card-title]", 8, "the channel's home tab carries the channel's real items (the discovery-derived feed)");
    await context.screenshot("j44-channel-home");

    // ------------------------------------------------------------------
    // 5. The tabs: Videos / Shorts / Playlists / About.
    // ------------------------------------------------------------------
    await goto(context, `${CHANNEL_URL}?tab=videos`);
    await assert.visible("[data-wfx-channel-videos]", "the Videos tab renders");
    await assert.countExactly("[data-wfx-channel-videos] [data-wfx-card-title]", 6, "the Videos tab carries exactly the 6 long-form items (the short-form eligibility split)");
    await assert.textContains("[data-wfx-channel-sort-note]", "declares no publish dates or view counts", "the Videos tab's sort options are honestly absent (the fixtures declare no dates/counts — the SearchFilters law)");
    await assert.countExactly("[data-wfx-channel-sort-chip]", 0, "no dead sort chip renders (an option without real backing never renders)");

    await goto(context, `${CHANNEL_URL}?tab=shorts`);
    await assert.visible("[data-wfx-channel-shorts]", "the Shorts tab renders");
    await assert.countExactly("[data-wfx-channel-shorts] [data-wfx-card-title]", 3, "the Shorts tab carries exactly the 3 short-form items (the same eligibility the shorts feed applies)");
    // The shorts link into the shorts queue (the real vertical surface).
    await assert.countAtLeast("[data-wfx-channel-shorts] a[data-wfx-card]", 1, "the channel's shorts link into the shorts queue (the real /shorts surface)");

    await goto(context, `${CHANNEL_URL}?tab=playlists`);
    await assert.visible("[data-wfx-channel-playlists]", "the Playlists tab renders");
    await assert.textContains("[data-wfx-channel-playlists]", "No playlists for this channel yet", "the Playlists tab renders the typed-empty state (the library carries no named list for this channel — never a fabricated playlist)");

    await goto(context, `${CHANNEL_URL}?tab=about`);
    await assert.visible("[data-wfx-channel-about]", "the About tab renders");
    await assert.textContains("[data-wfx-channel-about-description]", "declares no channel description", "the About description is the typed absence (the source declares none)");
    await assert.textContains("[data-wfx-channel-about-subs]", "never fabricates", "the About subscriber-count row carries the honest absence sentence");
    await assert.textContains("[data-wfx-channel-about-joined]", "Connected", "the About row carries the source's own connection date (the honest phrasing — never a fabricated 'Joined' claim)");
    await assert.textContains("[data-wfx-channel-about-content]", "6 videos", "the About content row carries the derived video count (real — from the channel's own items)");
    await assert.textContains("[data-wfx-channel-about-content]", "3 shorts", "the About content row carries the derived shorts count (real — from the channel's own items)");
    await context.screenshot("j44-channel-about");

    // ------------------------------------------------------------------
    // 6. The in-channel search round trip (the field filters the channel's own items).
    // ------------------------------------------------------------------
    await goto(context, CHANNEL_URL);
    await browser.waitForInteractive("[data-wfx-channel-search-input]");
    await browser.fill("[data-wfx-channel-search-input]", "rain");
    await browser.eval(
      `(() => { const form = document.querySelector('[data-wfx-channel-search]'); if (form !== null) { form.requestSubmit ? form.requestSubmit() : form.querySelector('button[type=submit]')?.click(); } return true; })()`,
    );
    await browser.waitLoad("networkidle");
    await assert.visible("[data-wfx-channel-search-note]", "the in-channel search answers with the honest filtered disclosure");
    await assert.textContains("[data-wfx-channel-search-note]", "rain", "the disclosure names the filtered query");
    await assert.countExactly("[data-wfx-channel-items] [data-wfx-card-title]", 3, "the in-channel search filters to the 3 title matches (the containment law)");
    await assert.textContains("[data-wfx-channel-search-note]", "Clear", "the disclosure offers the clear path back to the full channel");

    // ------------------------------------------------------------------
    // 7. Subscribe → the Library's Subscriptions list shows it (the one-store round trip).
    // ------------------------------------------------------------------
    await goto(context, CHANNEL_URL);
    await browser.waitForInteractive("[data-wfx-channel-subscribe]");
    await assert.attrEquals("[data-wfx-channel-subscribe]", "data-wfx-channel-subscribe-state", "idle", "the Subscribe pill starts idle (the honest unsubscribed truth)");
    await browser.clickInteractive("[data-wfx-channel-subscribe]");
    // The pill's typed outcome names the real library write (the same
    // POST /api/library seam the watch page's pill uses).
    await browser.pollTextContains("[data-wfx-channel-subscribe-status]", "Subscribed — saved to your Subscriptions list in Library");
    await assert.attrEquals("[data-wfx-channel-subscribe]", "data-wfx-channel-subscribe-state", "subscribed", "the pill flips to subscribed (the real write landed)");
    await context.screenshot("j44-channel-subscribed");

    // The Library's Subscriptions playlist section shows the entry (the
    // SAME list the watch page's pill writes — one truth).
    await goto(context, "/library");
    await assert.visible("[data-wfx-library-playlist='Subscriptions']", "the Library's playlists section renders the Subscriptions list (the frozen name — one store)");
    await assert.countAtLeast("[data-wfx-library-playlist='Subscriptions'] [data-wfx-watchlist-entry]", 1, "the Subscriptions list carries the channel's subscribed entry (the real write's durable row)");
    await context.screenshot("j44-library-subscriptions");

    // Back on the channel page, the connector-scoped truth persists
    // across the navigation (the same fold every subscribe surface reads).
    await goto(context, CHANNEL_URL);
    await assert.attrEquals("[data-wfx-channel-subscribe]", "data-wfx-channel-subscribe-state", "subscribed", "the channel page's pill renders subscribed on the fresh load (the connector-scoped stored truth — the reload-durability law)");

    // ------------------------------------------------------------------
    // 8. The bell round trip (the persisted per-channel preference record).
    // ------------------------------------------------------------------
    await assert.visible("[data-wfx-channel-bell-button]", "the bell renders once subscribed (the corpus grammar)");
    await assert.attrEquals("[data-wfx-channel-bell-button]", "data-wfx-channel-bell-preference", "personalized", "the bell's current preference is the default (personalized — no choice recorded yet)");
    await browser.clickInteractive("[data-wfx-channel-bell-button]");
    await assert.visible("[data-wfx-channel-bell-menu]", "the bell menu opens (the dialog family's grammar)");
    for (const option of ["all", "personalized", "none"] as const) {
      await assert.visible(`[data-wfx-channel-bell-option='${option}']`, `the ${option} preference option renders`);
    }
    await assert.textContains("[data-wfx-channel-bell-note]", "No notification source is connected", "the bell menu's honest delivery note names the later-wave truth (never a dead imitation)");
    await browser.clickInteractive("[data-wfx-channel-bell-option='none']");
    await assert.attrEquals("[data-wfx-channel-bell-button]", "data-wfx-channel-bell-preference", "none", "the bell's preference datum flips to none (the in-view record)");
    // The persisted record (the browser's own local store — the honest
    // local transport, the same law the reactions store keeps).
    const persisted = await browser.eval<string | null>(
      `(() => { try { return window.localStorage.getItem('wfx-channel-bells-v1') ?? null; } catch { return null; } })()`,
    );
    assert.that(
      "the per-channel preference record persists locally (the user's own choice, recorded)",
      `a store carrying {"${CREATOR_HANDLE}":"none"}`,
      persisted ?? "<no record>",
      persisted !== null && persisted.includes(`"${CREATOR_HANDLE}"`) && persisted.includes("none"),
    );
    await context.screenshot("j44-bell-none");
    await browser.press("Escape");
    await assert.countExactly("[data-wfx-channel-bell-menu]", 0, "the bell menu closes on Escape (the dialog family's law)");

    // ------------------------------------------------------------------
    // 9. The anonymous law: the whole round trip ran without a login gate.
    // ------------------------------------------------------------------
    assert.that(
      "the channel round trip never redirects to a sign-in surface (the anonymous law)",
      "the channel page still rendered (no login redirect)",
      (await browser.url()) ?? "<no url>",
      ((await browser.url()) ?? "").includes("/channel/"),
    );

    await describe(
      context,
      "the channel round trip: creator search → the channel result row (the honest truths) → the channel page (banner absence, monogram, tabs, search) → Videos/Shorts/Playlists/About with real data → the in-channel search → the Subscribe round trip through the ONE Subscriptions store (the Library shows it) → the bell's persisted preference record with the honest delivery note — all anonymous",
    );
  },
};
