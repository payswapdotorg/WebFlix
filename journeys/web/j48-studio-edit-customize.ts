/**
 * @wfx/journeys — J48 the studio edit + customize round trip (encoded
 * Web journey — R38-B; the survey's WAVE R38 studio journey).
 *
 * Doc expectation (docs/plans/2026-09-28-youtube-parity-survey.md —
 * §1 row 30 + §2 WAVE R38 "R38-B (studio surfaces)": "Studio — content
 * list (drafts/scheduled/published), video details editor, analytics
 * (reach/engagement/audience per video + channel), comments management
 * (hold/review/pin/reply), channel customization
 * (banner/avatar/handle/description)". Encoded as J48 — the survey's
 * own "J47" numbering belongs to the R38-A upload lane (concurrent, not
 * at this base) and J45/J46 are R37's live lane (not at this base); the
 * next free catalog number after J44 is J48. Recorded in
 * evidence/r38b/.)
 *
 * WEB-SIDE ENCODING (over the fixtures boot — driven as a user):
 * - THE CONTENT LIST: the studio manages the catalog's own channel (the
 *   one channel this host's catalog carries — the honest binding, never
 *   a fabricated "your account's channel"); the published rows are the
 *   channel's REAL catalog items (the same discovery-derived feed the
 *   channel page renders — 9 on this boot); the drafts/scheduled rows
 *   are this device's own studio records with the honest empty states;
 * - THE DRAFT ROUND TRIP: create a draft (the typed saved state) →
 *   RELOAD → the draft persists (reload-durable — the studio store's
 *   own local record); schedule it → the scheduled state + the honest
 *   publish note (publishing into the catalog lands with the upload
 *   wave — never a fabricated catalog row);
 * - THE DETAILS EDITOR: the catalog's own truth renders (the
 *   provenance panel); the title/description/visibility edit saves
 *   (the typed states) → RELOAD → the composed truth persists with the
 *   original named;
 * - THE COMMENTS MODERATION (the R28 composition — the ONE store): sign
 *   in (the scripted dev persona), post a comment ON THE WATCH SURFACE
 *   (the real composer), then in the studio: PIN (the studio's own
 *   persisted record), REPLY (a REAL comment — the watch surface
 *   renders it), HOLD (the comment LEAVES the watch surface's rendered
 *   truth — real moderation), APPROVE (it returns);
 * - THE ANALYTICS (the honest map): the impressions/subscribers/
 *   demographics panels render their TYPED ABSENCES with the frozen
 *   sentences (never a fabricated chart); the real local truths render
 *   their real numbers (this journey's own comment + reply + like);
 * - THE CUSTOMIZATION (the graph seam): the base derived truth renders
 *   (R36's derivation); the banner/avatar/handle/description edit
 *   saves through the domain-graph seam (the typed states) → the
 *   composed preview → RELOAD → persisted;
 * - THE R36 COMPOSITION TRUTH: the channel page still renders the
 *   DERIVED truth (the stable handle, the banner absence, the
 *   monogram) — the byte-compatible read (J44's own assertions); the
 *   channel page's read-side binding of the customization record is
 *   the lane's recorded merge-time compose (evidence/r38b/
 *   DIVERGENCES.md), never a fabricated claim it shows there;
 * - THE ANONYMOUS LAW: the studio surfaces never redirect to a
 *   sign-in wall (the sign-in gate is only the comment composer's own
 *   corpus law).
 *
 * THE ENCODING LAW: every step asserts the doc's expected states and
 * THROWS on regression (a journey that cannot fail is not a check).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";
import type { Browser } from "../lib/browser";

/** The fixtures boot's known creator (the sources model's own displayName). */
const CREATOR_HANDLE = "fake-source";

/** The scripted dev persona's credentials (the loud dev badge's own note). */
const DEV_EMAIL = "dev@webflix.local";
const DEV_PASSWORD = "dev-password-1";

/** Set a <select>'s value through the DOM (React's change law) and verify it applied. */
async function selectValue(browser: Browser, selector: string, value: string): Promise<void> {
  const applied = await browser.eval<string | null>(
    `(() => { const select = document.querySelector(${JSON.stringify(selector)}); if (select === null) return null; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event("change", { bubbles: true })); return select.value; })()`,
  );
  if (applied !== value) {
    throw new Error(`journey J48: the select ${selector} did not take the value '${value}' (got '${applied}')`);
  }
}

/**
 * Set an <input>'s value through the DOM's native setter (the
 * datetime-local inputs refuse typed text — the restricted-editing
 * law) and verify it applied.
 */
async function setInputValue(browser: Browser, selector: string, value: string): Promise<void> {
  const applied = await browser.eval<string | null>(
    `(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (input === null) return null; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return input.value; })()`,
  );
  if (applied !== value) {
    throw new Error(`journey J48: the input ${selector} did not take the value '${value}' (got '${applied}')`);
  }
}

/** Read one URL query param of the current page. */
async function queryParamOf(browser: Browser, name: string): Promise<string> {
  return await browser.eval<string>(
    `new URL(window.location.href).searchParams.get(${JSON.stringify(name)}) ?? ""`,
  );
}

/** Whether any comment text node on the page contains the fragment. */
async function anyCommentTextContains(browser: Browser, fragment: string): Promise<boolean> {
  return await browser.eval<boolean>(
    `[...document.querySelectorAll('[data-wfx-comment-text]')].some((node) => (node.textContent ?? '').includes(${JSON.stringify(fragment)}))`,
  );
}

export const j48StudioEditCustomize: Journey = {
  id: "J48",
  title: "Studio edit + customize round trip",
  doc: "docs/plans/2026-09-28-youtube-parity-survey.md §1 row 30 + §WAVE R38 (R38-B — the studio surfaces: content list, details editor, honest analytics, comments moderation, channel customization)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    const RUN = Date.now().toString(36);
    const DRAFT_TITLE = `J48 draft ${RUN}`;
    const EDIT_TITLE = `J48 edit ${RUN}`;
    const COMMENT_BODY = `The J48 moderation target ${RUN}`;
    const REPLY_BODY = `The J48 creator reply ${RUN}`;
    const CUSTOM_HANDLE = `made${RUN}`;
    const CUSTOM_DESCRIPTION = `The J48 customized description ${RUN}`;
    const CUSTOM_BANNER = `https://example.com/banner-${RUN}.png`;

    // ------------------------------------------------------------------
    // 1. The studio renders: the managed channel + the content list.
    // ------------------------------------------------------------------
    await goto(context, "/studio");
    await assert.visible("[data-wfx-studio]", "the studio renders (the content section)");
    await assert.textContains(
      "[data-wfx-studio-channel-display-name]",
      "Fake Source",
      "the studio's managed channel is the catalog's own source (the R33-C seam's own displayName)",
    );
    await assert.textContains(
      "[data-wfx-studio-binding-note]",
      "stored locally on this device",
      "the studio's binding note names the honest local-transport truth",
    );
    for (const section of ["content", "analytics", "comments", "customization"] as const) {
      await assert.visible(`[data-wfx-studio-tab='${section}']`, `the ${section} tab renders`);
    }
    // The published rows: the channel's REAL catalog items (the same
    // discovery-derived feed the channel page renders — 9 on this boot).
    await assert.countExactly("[data-wfx-studio-row]", 9, "the content list carries exactly the channel's 9 real catalog items (the published set — never a fabricated row)");
    // The honest empty drafts state (after the local record loads).
    await assert.textContains(
      "[data-wfx-studio-empty-drafts]",
      "No drafts yet",
      "the drafts empty state renders honestly (this device's own record is empty)",
    );
    await context.screenshot("j48-studio-content");

    // ------------------------------------------------------------------
    // 2. The draft round trip: create → the typed saved state → reload-durable.
    // ------------------------------------------------------------------
    await browser.waitForInteractive("[data-wfx-studio-newdraft-open]");
    await browser.clickInteractive("[data-wfx-studio-newdraft-open]");
    await assert.visible("[data-wfx-studio-newdraft-form]", "the new-draft form opens");
    await browser.fill("[data-wfx-studio-newdraft-title]", DRAFT_TITLE);
    await browser.fill("[data-wfx-studio-newdraft-description]", "The studio's own record.");
    await browser.clickInteractive("[data-wfx-studio-newdraft-submit]");
    await browser.pollTextContains("[data-wfx-studio-save-status]", "Saved");
    await assert.attrEquals("[data-wfx-studio-save-state]", "data-wfx-studio-save-state", "saved", "the draft save answers the typed saved state");
    await assert.visible("[data-wfx-studio-draft-row]", "the draft row renders in the content list");
    await assert.attrEquals("[data-wfx-studio-draft-row]", "data-wfx-studio-row-state", "draft", "the new record's state is draft (the state is data)");
    await assert.textContains("[data-wfx-studio-draft-title]", DRAFT_TITLE, "the draft row carries this journey's own title");
    // RELOAD → the draft persists (reload-durable — the local record).
    await goto(context, "/studio");
    await assert.textContains("[data-wfx-studio-draft-title]", DRAFT_TITLE, "the draft persists across the reload (the studio store's reload-durability law)");

    // ------------------------------------------------------------------
    // 3. The schedule round trip: the scheduled state + the honest publish note.
    // ------------------------------------------------------------------
    await browser.clickInteractive("[data-wfx-studio-draft-edit]");
    await assert.visible("[data-wfx-studio-newdraft-form]", "the draft editor opens with the stored record");
    await selectValue(browser, "[data-wfx-studio-newdraft-visibility]", "scheduled");
    await assert.visible("[data-wfx-studio-newdraft-schedule]", "the schedule field renders for the scheduled visibility");
    const futureLocal = new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 16);
    await setInputValue(browser, "[data-wfx-studio-newdraft-schedule]", futureLocal);
    await browser.clickInteractive("[data-wfx-studio-newdraft-submit]");
    await browser.pollTextContains("[data-wfx-studio-save-status]", "scheduled for");
    await assert.attrEquals(
      "[data-wfx-studio-draft-row]",
      "data-wfx-studio-row-state",
      "scheduled",
      "the record's state derives scheduled (a future instant on the scheduled visibility)",
    );
    await assert.textContains(
      "[data-wfx-studio-draft-publish-note]",
      "upload wave",
      "the scheduled row names the honest publish truth (publishing into the catalog lands with the upload wave — never a fabricated catalog row)",
    );
    await context.screenshot("j48-draft-scheduled");

    // ------------------------------------------------------------------
    // 4. The details editor: the catalog truth → the studio record → reload.
    // ------------------------------------------------------------------
    const editorHref = await browser.tryAttr("[data-wfx-studio-row-link]", "href");
    assert.that(
      "the published rows link into the details editor (the /player parameterized grammar)",
      "an href starting /studio/video",
      editorHref ?? "<no href>",
      (editorHref ?? "").startsWith("/studio/video?"),
    );
    await goto(context, editorHref ?? "/studio");
    await assert.visible("[data-wfx-studio-editor]", "the details editor renders");
    const catalogTitle = await browser.tryText("[data-wfx-studio-editor-catalog-title]");
    assert.that(
      "the editor carries the catalog's own title (the provenance panel)",
      "the row's own title",
      catalogTitle ?? "<no title>",
      catalogTitle !== null && catalogTitle.length > 0,
    );
    assert.textContains(
      "[data-wfx-studio-editor-catalog-note]",
      "catalog",
      "the provenance note names what the catalog's surfaces render (the concurrent-catalog law)",
    );
    await browser.fill("[data-wfx-studio-editor-title]", EDIT_TITLE);
    await browser.fill("[data-wfx-studio-editor-description]", "The studio's own description.");
    await selectValue(browser, "[data-wfx-studio-editor-visibility]", "unlisted");
    await browser.clickInteractive("[data-wfx-studio-editor-submit]");
    await browser.pollTextContains("[data-wfx-studio-save-status]", "Saved");
    await assert.textContains("[data-wfx-studio-composed-title]", EDIT_TITLE, "the composed truth carries the studio record's title");
    // RELOAD → the studio record persists (the composed truth + the original named).
    await goto(context, editorHref ?? "/studio");
    await browser.pollTextContains("[data-wfx-studio-composed-title]", EDIT_TITLE);
    await assert.textContains(
      "[data-wfx-studio-composed]",
      catalogTitle ?? "",
      "the composed truth names the catalog's original title beside the studio record (the provenance law)",
    );
    await context.screenshot("j48-details-editor");
    const videoItemId = await queryParamOf(browser, "id");
    assert.that(
      "the editor's route carries the video's canonical id (the ItemRouteTarget grammar)",
      "a non-empty id param",
      videoItemId,
      videoItemId.length > 0,
    );

    // ------------------------------------------------------------------
    // 5. Sign in (the scripted dev persona — the comment composer's gate).
    // ------------------------------------------------------------------
    await goto(context, "/settings?section=general");
    await browser.waitForInteractive("#wfx-session-email");
    await browser.fill("#wfx-session-email", DEV_EMAIL);
    await browser.fill("#wfx-session-password", DEV_PASSWORD);
    await browser.clickInteractive("[data-wfx-session-action='login']");
    await browser.waitLoad("networkidle");
    await assert.visible("[data-wfx-session-signed-in]", "the scripted dev persona signs in (the session controls' signed-in state)");

    // ------------------------------------------------------------------
    // 6. The watch surface: a REAL comment + a REAL like (the local wallet).
    // ------------------------------------------------------------------
    await goto(context, editorHref ?? "/studio");
    const watchHref = await browser.tryAttr("[data-wfx-studio-editor-watch-link]", "href");
    assert.that(
      "the editor links to the watch surface (the same item, the viewer side)",
      "an href starting /player",
      watchHref ?? "<no href>",
      (watchHref ?? "").startsWith("/player?"),
    );
    await goto(context, watchHref ?? "/studio");
    await assert.visible("[data-wfx-comments]", "the watch surface's comments section renders");
    await browser.waitForInteractive("[data-wfx-comments-simplebox]");
    await browser.clickInteractive("[data-wfx-comments-simplebox]");
    await assert.visible("[data-wfx-comments-editor]", "the signed-in composer opens (the corpus law)");
    await browser.fill("[data-wfx-comments-input]", COMMENT_BODY);
    await browser.clickInteractive("[data-wfx-comments-submit]");
    await browser.pollTextContains("[data-wfx-comment-text]", COMMENT_BODY);
    await assert.textContains("[data-wfx-comments-count]", "1 Comment", "the watch surface counts this journey's own comment (the honest local count)");
    // The like (this browser's own reaction record).
    await browser.waitForInteractive("[data-wfx-action='like']");
    await browser.clickInteractive("[data-wfx-action='like']");
    await browser.pollEvalTruthy(
      `(() => { const btn = document.querySelector('[data-wfx-action=\\'like\\']'); return btn !== null && btn.getAttribute('data-wfx-reaction') === 'like'; })()`,
    );
    await assert.attrEquals("[data-wfx-action='like']", "data-wfx-reaction", "like", "the like records this browser's own reaction (the local wallet)");
    await context.screenshot("j48-watch-comment");

    // ------------------------------------------------------------------
    // 7. The moderation round trip (the ONE store — the R28 composition).
    // ------------------------------------------------------------------
    const moderationUrl = `/studio/comments?channel=${CREATOR_HANDLE}&id=${encodeURIComponent(videoItemId)}`;
    await goto(context, moderationUrl);
    await browser.pollTextContains("[data-wfx-moderation-text]", COMMENT_BODY);
    await assert.textContains(
      "[data-wfx-studio-comments-video-title]",
      catalogTitle ?? "",
      "the moderation surface is scoped to the channel's own video (the picker's selected truth)",
    );
    // PIN: the studio's own persisted record.
    await browser.clickInteractive("[data-wfx-moderation-pin]");
    await browser.pollTextContains("[data-wfx-moderation-status]", "Pinned");
    await assert.attrEquals("[data-wfx-studio-moderation-row]", "data-wfx-moderation-pinned", "true", "the pin persists on the studio's own record");
    await assert.visible("[data-wfx-moderation-pinned-badge]", "the pinned badge renders in the studio (the corpus grammar)");
    // REPLY: a REAL comment in the same store.
    await browser.clickInteractive("[data-wfx-moderation-reply-toggle]");
    await assert.visible("[data-wfx-moderation-reply-form]", "the reply form opens (the signed-in creator's reply)");
    await browser.fill("[data-wfx-moderation-reply-input]", REPLY_BODY);
    await browser.clickInteractive("[data-wfx-moderation-reply-submit]");
    await browser.pollTextContains("[data-wfx-moderation-status]", "Reply posted");
    await assert.textContains("[data-wfx-studio-moderation-rows]", REPLY_BODY, "the studio renders the reply it wrote");
    // The watch surface renders the reply too (the ONE store). The reply
    // renders inside the thread's expander (the corpus grammar) — open it.
    await goto(context, watchHref ?? "/studio");
    await assert.textContains("[data-wfx-comments-count]", "2 Comments", "the watch surface counts the studio's reply (the same store — one truth)");
    await browser.waitForInteractive("[data-wfx-comment-replies-toggle]");
    await assert.textContains("[data-wfx-comment-replies-toggle]", "1 reply", "the thread's expander carries the studio's reply (the corpus grammar)");
    await browser.clickInteractive("[data-wfx-comment-replies-toggle]");
    assert.that(
      "the watch surface renders the studio's reply body (the moderation's reply is a real comment)",
      `a comment text containing '${REPLY_BODY}'`,
      "checked over every rendered comment text",
      await anyCommentTextContains(browser, REPLY_BODY),
    );
    // HOLD: the comment LEAVES the watch surface's rendered truth.
    await goto(context, moderationUrl);
    await browser.clickInteractive("[data-wfx-moderation-hold]");
    await browser.pollTextContains("[data-wfx-moderation-status]", "Held");
    await assert.countExactly("[data-wfx-studio-moderation-row]", 0, "the held comment leaves the studio's live list");
    await assert.visible("[data-wfx-studio-held-row]", "the held thread lands in the review queue (the restorable record)");
    await goto(context, watchHref ?? "/studio");
    await assert.textContains("[data-wfx-comments-count]", "0 Comments", "the watch surface no longer renders the held comment (real moderation — never cosmetic)");
    await assert.countExactly("[data-wfx-comment]", 0, "the held thread (parent + reply) is gone from the rendered truth");
    // APPROVE: the thread returns.
    await goto(context, moderationUrl);
    await browser.clickInteractive("[data-wfx-moderation-approve]");
    await browser.pollTextContains("[data-wfx-moderation-status]", "Approved");
    await assert.countAtLeast("[data-wfx-studio-moderation-row]", 1, "the approved comment returns to the studio's live list");
    await goto(context, watchHref ?? "/studio");
    await assert.textContains("[data-wfx-comments-count]", "2 Comments", "the watch surface renders the approved thread again (parent + reply)");
    assert.that(
      "the watch surface renders the restored parent body",
      `a comment text containing '${COMMENT_BODY}'`,
      "checked over every rendered comment text",
      await anyCommentTextContains(browser, COMMENT_BODY),
    );
    await context.screenshot("j48-moderation-approved");

    // ------------------------------------------------------------------
    // 8. The analytics (the honest map: the absences + this journey's real numbers).
    // ------------------------------------------------------------------
    await goto(context, `/studio/analytics?channel=${CREATOR_HANDLE}`);
    await assert.visible("[data-wfx-studio-analytics-channel]", "the channel analytics panel renders");
    // THE TYPED ABSENCES (the frozen sentences — never a fabricated chart).
    await assert.textContains(
      "[data-wfx-analytics-note='impressions']",
      "does not fabricate a reach number",
      "the impressions panel renders its typed absence (no impression transport on this host)",
    );
    await assert.textContains(
      "[data-wfx-analytics-note='subscribers']",
      "never fabricates one",
      "the subscribers panel renders the R36 typed absence (never a fabricated count)",
    );
    await assert.textContains(
      "[data-wfx-analytics-note='demographics']",
      "does not fabricate demographics",
      "the audience-insights panel renders its typed absence (no audience transport)",
    );
    // THE REAL LOCAL TRUTHS (this journey's own writes — honestly counted).
    await browser.pollTextContains("[data-wfx-analytics-value='totalComments']", "2");
    await assert.textContains("[data-wfx-analytics-value='totalComments']", "2", "the channel's total comments counts this journey's own comment + reply (the real sum)");
    await assert.textContains("[data-wfx-analytics-value='yourReactions']", "1", "the channel's reaction count carries this journey's own like (the local wallet)");
    await assert.textContains(
      `[data-wfx-analytics-row-comments='${videoItemId}']`,
      "2 comments",
      "the video's engagement panel carries the real per-item comment count",
    );
    await assert.textContains(
      `[data-wfx-analytics-row-reaction='${videoItemId}']`,
      "you liked this",
      "the video's engagement panel carries this journey's own like",
    );
    await assert.textContains(
      `[data-wfx-analytics-row-yourview='${videoItemId}']`,
      "not watched by you yet",
      "the video's reach panel renders the honest watch-fold truth for this journey (never a fabricated view)",
    );
    await context.screenshot("j48-analytics");

    // ------------------------------------------------------------------
    // 9. The customization round trip (the domain-graph seam).
    // ------------------------------------------------------------------
    await goto(context, `/studio/customization?channel=${CREATOR_HANDLE}`);
    await assert.visible("[data-wfx-studio-customization]", "the customization surface renders");
    // The base derived truth (R36's derivation — the provenance panel).
    await assert.textContains("[data-wfx-studio-customization-base-handle]", `@${CREATOR_HANDLE}`, "the base handle is the stable derived one (the pure href law)");
    await assert.textContains("[data-wfx-studio-customization-base-banner]", "does not fabricate", "the base banner is the typed absence (the fixtures boot's own truth)");
    await assert.textContains("[data-wfx-studio-customization-base-description]", "declares no channel description", "the base description is the typed absence (the source declares none)");
    // The edit (all four fields of the closed vocabulary).
    await browser.waitForInteractive("[data-wfx-studio-customization-handle]");
    await browser.fill("[data-wfx-studio-customization-handle]", CUSTOM_HANDLE);
    await browser.fill("[data-wfx-studio-customization-description]", CUSTOM_DESCRIPTION);
    await browser.fill("[data-wfx-studio-customization-banner]", CUSTOM_BANNER);
    await browser.fill("[data-wfx-studio-customization-avatar]", `https://example.com/avatar-${RUN}.png`);
    await browser.clickInteractive("[data-wfx-studio-customization-submit]");
    await browser.pollTextContains("[data-wfx-studio-save-status]", "Saved");
    await assert.textContains("[data-wfx-studio-save-status]", "4 field(s) declared", "the typed saved state names the declared-field count (all four of the closed vocabulary)");
    // The composed preview (the graph seam's overlay).
    await assert.textContains("[data-wfx-studio-customization-preview-handle]", `@${CUSTOM_HANDLE}`, "the composed preview carries the declared handle");
    await assert.textContains("[data-wfx-studio-customization-preview-description]", CUSTOM_DESCRIPTION, "the composed preview carries the declared description");
    await assert.textContains("[data-wfx-studio-customization-preview-banner]", CUSTOM_BANNER, "the composed preview carries the declared banner");
    // RELOAD → the customization persists (reload-durable through the seam).
    await goto(context, `/studio/customization?channel=${CREATOR_HANDLE}`);
    await browser.pollTextContains("[data-wfx-studio-customization-preview-handle]", `@${CUSTOM_HANDLE}`);
    await assert.textContains("[data-wfx-studio-customization-preview-handle]", `@${CUSTOM_HANDLE}`, "the customization persists across the reload (the profile record's reload-durability law)");
    await context.screenshot("j48-customization");

    // ------------------------------------------------------------------
    // 10. The R36 composition truth: the channel page renders the DERIVED truth.
    // ------------------------------------------------------------------
    await goto(context, `/channel/${CREATOR_HANDLE}`);
    await assert.visible("[data-wfx-surface='channel']", "the channel page renders (the studio's managed channel)");
    await assert.visible("[data-wfx-channel-banner='absent']", "the channel page's banner renders its typed absence (the byte-compatible read — no regression)");
    await assert.textContains("[data-wfx-channel-meta]", `@${CREATOR_HANDLE}`, "the channel page's meta line carries the STABLE derived handle (the customization's read-side binding is the recorded merge-time compose, never a fabricated claim it shows here)");
    await assert.visible("[data-wfx-channel-avatar]", "the channel page's avatar is still the honest monogram (the derivation law)");

    // ------------------------------------------------------------------
    // 11. The anonymous law: the studio surfaces never redirected to a sign-in wall.
    // ------------------------------------------------------------------
    await goto(context, "/studio");
    await assert.visible("[data-wfx-studio]", "the studio renders after the full round trip (no login wall)");
    assert.that(
      "the studio round trip never redirected to a sign-in surface (the anonymous law)",
      "the studio page still rendered (no login redirect)",
      (await browser.url()) ?? "<no url>",
      ((await browser.url()) ?? "").includes("/studio"),
    );

    await describe(
      context,
      "the studio round trip: the content list (the catalog's real published set + the honest empty states) → the draft round trip (typed saves, reload-durable, the scheduled state with the honest publish note) → the details editor (the catalog truth named, the studio record composed, reload-durable) → the moderation round trip over the ONE comments store (the watch surface's own comment, the studio's pin, the real reply, the hold that really removes, the approve that restores) → the analytics honest map (the typed absences with their sentences + this journey's own real numbers) → the customization round trip through the domain-graph seam (all four fields, the composed preview, reload-durable) with the channel page's derived truth byte-compatible — the sign-in only ever gating the comment composer",
    );
  },
};
