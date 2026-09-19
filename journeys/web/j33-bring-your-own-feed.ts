/**
 * @wfx/journeys — J33 Bring Your Own Feed (encoded Web journey — R20-E).
 *
 * Doc expectation (§J33, frozen):
 *
 * ```text
 * choose Bring Your Feed
 * -> choose supported source or official export
 * -> authorize/import
 * -> preview imported relationships/items
 * -> confirm
 * -> persist normalized feed records + provenance
 * -> show source-native order distinctly from WebFlix-ranked discovery
 * -> show live/snapshot/stale truth
 * -> refresh/sync when supported
 * -> disconnect/re-authorize without deleting WebFlix-local library/history
 * ```
 *
 * Web-fixture-boot encoding (R20-E): the journey drives the REAL Web
 * product surface (R20-D) over the REAL shared BYOF composition — the
 * `FeedImportService` (@wfx/persistence, R20-C) running the real
 * reconciliation, the real YouTube connector (@wfx/connectors, R20-B)
 * answering `importFeedResult` from its documented recorded fixtures —
 * exactly the seams the fixtures boot wires (host/byof/byof-fixtures.ts).
 * No fixture-only shortcut stands in for the shared lane: what the
 * browser exercises IS the shipped composition.
 *
 * THE LAWS ASSERTED (the R20 truth laws, bound to this doc):
 * - the flow lives in the EXISTING IA (Settings→Sources entry, the
 *   Library feed region — no new navigation system);
 * - an authorization failure renders CLEAR + actionable (the typed
 *   failure with its connect recovery path — never a silent empty state),
 *   and the honest attempt trail;
 * - the preview shows the imported relationships/items in the SOURCE'S
 *   OWN order, labeled as source-native — never as WebFlix-ranked;
 * - a capture is a SNAPSHOT (never presented as live); the confirmed
 *   continuous route lands Live with its synced truth;
 * - the imported feed renders with provenance + the follow summary, in
 *   the source's own order, with the WebFlix-mode separation stated;
 * - sync reconciles the changed source with the engine's OWN honest
 *   counts (the report is the server's, rendered verbatim);
 * - a failed re-authorization names its state and RETAINS every record;
 *   the recovery restores syncing;
 * - DISCONNECT is non-destructive: records + provenance SURVIVE, and the
 *   WebFlix-local watchlist/history are untouched; deletion is the
 *   SEPARATE explicit action (two-step armed) that ends the feed.
 *
 * Determinism: the journey resets the BYOF drive state to pristine via
 * the product's own dev-reset POST before step 1 (the J28/R17
 * scripted-drive law — reads never advance the script; the
 * advance-source/expire-auth drives move it deliberately).
 */

import { describe } from "./journey-description";
import type { Journey, JourneyContext } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** POST one BYOF dev drive to the RUNNING product (HTTP — the user channel). */
async function drive(context: JourneyContext, action: string): Promise<number> {
  const response = await fetch(`${context.baseUrl}/api/byof`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return response.status;
}

export const j33BringYourOwnFeed: Journey = {
  id: "J33",
  title: "Bring Your Own Feed: import, preview, confirm, sync, provenance",
  doc: "docs/validation/webflix-golden-journeys.md §J33 (core acceptance details)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // 0. Determinism: pristine BYOF state (no imports, the source
    //    disconnected, the initial capture phase).
    const resetStatus = await drive(context, "dev-reset");
    assert.that(
      "the BYOF drive state resets to pristine before the journey (determinism)",
      "HTTP 200 from the dev-reset drive",
      `HTTP ${resetStatus}`,
      resetStatus === 200,
    );

    // 1. CHOOSE BRING YOUR FEED — from the EXISTING product IA (the
    //    settings/sources section; no new navigation system).
    await goto(context, "/settings?section=sources");
    await assert.visible("[data-wfx-byof-panel]", "the Bring your feed panel renders inside the settings sources section (the existing IA)");
    await assert.visible("[data-wfx-byof-source='youtube']", "the feed-import source card renders (the choose-source step)");
    await assert.attrEquals(
      "[data-wfx-byof-source='youtube']",
      "data-wfx-byof-source-auth-state",
      "not-connected",
      "the source states its authorization truth (not connected — never fabricated)",
    );
    // The honest absences (capability truth, plainly named).
    await assert.countAtLeast(
      "[data-wfx-byof-absence='history']",
      1,
      "the source's honest absence (watch history) renders with its reason",
    );
    await assert.countAtLeast(
      "[data-wfx-byof-absence='ranked-feed']",
      1,
      "the source's honest absence (the ranked home feed) renders with its reason",
    );

    // 2. AUTHORIZE/IMPORT WITHOUT THE GRANT — the CLEAR, actionable
    //    authorization failure (never a silent empty state).
    await browser.clickInteractive("[data-wfx-byof-action='preview']");
    await browser.pollTextContains("[data-wfx-byof-action-error]", "isn't connected", 30_000);
    await assert.attrEquals(
      "[data-wfx-byof-action-error]",
      "data-wfx-byof-failure-kind",
      "unauthorized",
      "the import attempt answers the TYPED unauthorized failure",
    );
    await assert.countAtLeast(
      "[data-wfx-byof-failure-recovery]",
      1,
      "the failure states its recovery path (connect first — actionable, never silent)",
    );
    // The honest attempt trail (the import that never captured) — a fresh
    // server render carries it (the failure itself rendered inline, no
    // reload — the trail row is the page's durable truth).
    await goto(context, "/settings?section=sources");
    await assert.countAtLeast(
      "[data-wfx-byof-import-status='reauthorization-required']",
      1,
      "the failed attempt lands its honest trail row",
    );
    await context.screenshot("j33-authorization-failure");

    // 3. THE CONNECT STEP (authorize): the grant appears; the recovery
    //    path completes.
    await browser.clickInteractive("[data-wfx-byof-action='connect']");
    await browser.pollTextContains(
      "[data-wfx-byof-source-auth='connected']",
      "Connected — WebFlix can read the feed",
      30_000,
    );
    await assert.attrEquals(
      "[data-wfx-byof-source='youtube']",
      "data-wfx-byof-source-auth-state",
      "connected",
      "the source states its connected truth after the connect step",
    );

    // 4. THE PREVIEW — imported relationships/items, in the SOURCE'S OWN
    //    order, with the snapshot truth.
    await browser.clickInteractive("[data-wfx-byof-action='preview']");
    await browser.pollTextContains("[data-wfx-byof-preview]", "Preview your import from", 30_000);
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.textContains(
      "[data-wfx-byof-preview-count]",
      "7 items",
      "the preview states what will be imported (the count the capture produced)",
    );
    // The imported relationship summary (follows/likes/playlists).
    await assert.countAtLeast("[data-wfx-byof-relationship='follow']", 1, "the follow summary chip renders");
    await assert.countAtLeast("[data-wfx-byof-relationship='like']", 1, "the likes summary chip renders");
    await assert.countAtLeast("[data-wfx-byof-relationship='playlist']", 1, "the playlist summary chip renders");
    await assert.countAtLeast("[data-wfx-byof-relationship='watchlist']", 1, "the watch-later summary chip renders");
    // THE MODE LAW: the order is visibly source-native, never WebFlix-ranked.
    await assert.attrEquals(
      "[data-wfx-byof-preview]",
      "data-wfx-byof-order-semantics",
      "source-native",
      "the preview labels its order semantics as source-native",
    );
    await assert.textContains(
      "[data-wfx-byof-preview]",
      "not a WebFlix ranking",
      "the preview states the mode distinction in plain language",
    );
    // THE SNAPSHOT LAW: the capture is never presented as live.
    await assert.attrEquals(
      "[data-wfx-byof-preview] [data-wfx-byof-freshness]",
      "data-wfx-byof-freshness",
      "snapshot",
      "the capture's freshness is the honest snapshot state",
    );
    await assert.textContains(
      "[data-wfx-byof-preview] [data-wfx-byof-freshness]",
      "This capture is a snapshot",
      "the freshness states the snapshot truth in plain language",
    );
    // The sample rows render in the capture's own order with positions.
    const firstSample = await browser.tryText("[data-wfx-byof-sample-item]");
    assert.that(
      "the preview's sample renders the source's own first item (most-recent-first order)",
      "Storm Chasers Lab first (the fixture capture's own order)",
      firstSample ?? "<element absent>",
      firstSample !== null && firstSample.includes("Storm Chasers Lab"),
    );
    await context.screenshot("j33-preview");

    // 5. CONFIRM — the feed appears in the Library (the existing IA's
    //    landing), with provenance and the mode separation.
    await browser.clickInteractive("[data-wfx-byof-action='confirm']");
    await browser.pollTextContains("[data-wfx-byof-feed]", "Your imported feeds", 30_000);
    await browser.waitLoad("networkidle");
    await browser.snapshotInteractive();
    await assert.countAtLeast("[data-wfx-byof-imported-banner]", 1, "the post-confirm landing renders its banner (the feed appears)");
    await assert.visible("[data-wfx-byof-import]", "the confirmed import renders its durable card");
    // PROVENANCE: what was imported, how, and when.
    await assert.textContains(
      "[data-wfx-byof-import]",
      "7 items imported via the authorized API",
      "the import card states its provenance (count + method)",
    );
    await assert.textContains("[data-wfx-byof-import]", "captured ", "the import card states its capture time");
    // The follow/subscription summary.
    await assert.textContains(
      "[data-wfx-byof-following-summary]",
      "2 followed channels",
      "the imported follow/subscription summary renders",
    );
    // THE MODE LAW on the feed surface.
    await assert.attrEquals(
      "[data-wfx-byof-import]",
      "data-wfx-byof-order-semantics",
      "source-native",
      "the imported feed labels its order semantics as source-native",
    );
    await assert.textContains(
      "[data-wfx-byof-mode-note]",
      "never silently replaced by this imported feed",
      "the WebFlix-mode separation is stated (no silent recommendation identity)",
    );
    // THE FRESHNESS LAW: the continuous route lands LIVE (with its synced
    // truth — never a snapshot labeled live, never a live labeled snapshot).
    await assert.attrEquals(
      "[data-wfx-byof-import]",
      "data-wfx-byof-sync-state",
      "live",
      "the confirmed continuous route lands its live state",
    );
    await assert.textContains("[data-wfx-byof-sync-chip]", "Live — kept current", "the live state renders its chip label");
    // The source-native groups render (the store's read order).
    await assert.countAtLeast("[data-wfx-byof-group='follow']", 1, "the follow group renders");
    await assert.countAtLeast("[data-wfx-byof-group='like']", 1, "the likes group renders");
    await assert.countAtLeast("[data-wfx-byof-group='playlist']", 1, "the playlist group renders");
    await assert.countAtLeast("[data-wfx-byof-group='watchlist']", 1, "the watch-later group renders");
    // The WebFlix-local library is UNTOUCHED by the import (the separation
    // law — visible on the same page).
    await assert.textContains(
      "[data-wfx-library-watchlist]",
      "Nothing saved yet",
      "the WebFlix watchlist stays untouched by the import",
    );
    await assert.textContains(
      "[data-wfx-library-history]",
      "No watch history yet",
      "the WebFlix history stays untouched by the import",
    );
    await context.screenshot("j33-feed-appears");

    // 6. REFRESH/SYNC WHEN SUPPORTED — the honest reconciliation: first a
    //    same-data sync (everything unchanged), then the CHANGED source
    //    (the dev drive) with the engine's own counts.
    const importId = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-byof-import]')?.getAttribute('data-wfx-byof-import') ?? null`,
    );
    assert.that(
      "the import card carries its id (the sync action's target)",
      "an import id",
      importId ?? "<absent>",
      importId !== null,
    );
    await browser.clickInteractive("[data-wfx-byof-action='sync']");
    await browser.pollTextContains("[data-wfx-byof-action-result='sync']", "Synced — here is exactly what changed", 30_000);
    await assert.textContains(
      "[data-wfx-byof-action-result='sync']",
      "0 added · 0 updated · 0 removed · 7 unchanged",
      "the same-data sync reports the honest all-unchanged counts (the server's own report)",
    );
    // The source CHANGED (the dev drive): one new follow, one like removed.
    const advanceStatus = await drive(context, "advance-source");
    assert.that(
      "the changed-source drive answers (the scripted source lifecycle)",
      "HTTP 200 from the advance-source drive",
      `HTTP ${advanceStatus}`,
      advanceStatus === 200,
    );
    await browser.clickInteractive("[data-wfx-byof-action='sync']");
    await browser.pollTextContains("[data-wfx-byof-action-result='sync']", "1 added", 30_000);
    await assert.textContains(
      "[data-wfx-byof-action-result='sync']",
      "1 added · 2 updated · 1 removed · 4 unchanged",
      "the changed-source sync reports the engine's honest reconciliation counts",
    );
    // The reconciled feed: the new follow is in, the removed like is out.
    await goto(context, "/library");
    await assert.textContains("[data-wfx-byof-feed]", "Aurora Nights", "the newly followed channel appears in the feed after the sync");
    const feedHtml = await browser.tryHtml("[data-wfx-byof-feed]");
    assert.that(
      "the removed like is gone after the reconciliation (honest removal, never hidden)",
      "no 'Desert Rain in 45 Seconds' row",
      feedHtml !== null && feedHtml.includes("Desert Rain in 45 Seconds") ? "the removed like still renders" : "gone",
      feedHtml === null || !feedHtml.includes("Desert Rain in 45 Seconds"),
    );
    await assert.textContains(
      "[data-wfx-byof-following-summary]",
      "3 followed channels",
      "the follow summary reflects the reconciled source (3 follows)",
    );
    await context.screenshot("j33-sync-reconciled");

    // 7. THE AUTHORIZATION GAP DURING SYNC — the named state, records
    //    RETAINED (never deleted by a failing sync).
    const expireStatus = await drive(context, "expire-auth");
    assert.that(
      "the expire-auth drive answers (the scripted grant loss)",
      "HTTP 200 from the expire-auth drive",
      `HTTP ${expireStatus}`,
      expireStatus === 200,
    );
    await browser.clickInteractive("[data-wfx-byof-action='sync']");
    await browser.pollTextContains("[data-wfx-byof-action-error]", "isn't connected", 30_000);
    await assert.attrEquals(
      "[data-wfx-byof-action-error]",
      "data-wfx-byof-failure-kind",
      "unauthorized",
      "the failing sync answers the typed unauthorized failure",
    );
    await goto(context, "/library");
    await assert.attrEquals(
      "[data-wfx-byof-import]",
      "data-wfx-byof-sync-state",
      "reauthorization-required",
      "the import renders the named reauthorization-required state (its own truth)",
    );
    await assert.textContains("[data-wfx-byof-sync-chip]", "Authorization needed", "the reauthorization gap renders its chip label");
    // RECORDS RETAINED through the failing sync.
    await assert.textContains("[data-wfx-byof-import]", "7 items imported via the authorized API", "every record is retained through the authorization gap");
    await assert.countAtLeast("[data-wfx-byof-record]", 7, "all seven records still render (the survival law)");
    await context.screenshot("j33-reauthorization-required");

    // 8. THE RECOVERY — reconnect restores syncing (the live truth again).
    const reconnectStatus = await drive(context, "connect");
    assert.that(
      "the reconnect drive answers (the scripted grant recovery)",
      "HTTP 200 from the connect drive",
      `HTTP ${reconnectStatus}`,
      reconnectStatus === 200,
    );
    await browser.clickInteractive("[data-wfx-byof-action='sync']");
    await browser.pollTextContains("[data-wfx-byof-action-result='sync']", "Synced — here is exactly what changed", 30_000);
    await goto(context, "/library");
    await assert.attrEquals(
      "[data-wfx-byof-import]",
      "data-wfx-byof-sync-state",
      "live",
      "the recovered import is live again (the reauthorization completed)",
    );

    // 9. DISCONNECT/RE-AUTHORIZE WITHOUT DELETING — the NON-destructive
    //    undo: records + provenance SURVIVE; the WebFlix-local library is
    //    untouched; deletion is the SEPARATE explicit action.
    await browser.clickInteractive("[data-wfx-byof-action='disconnect']");
    await browser.pollTextContains("[data-wfx-byof-action-result='disconnected']", "Import disconnected.", 30_000);
    await assert.textContains(
      "[data-wfx-byof-retained-truth]",
      "7 imported records are retained",
      "the disconnect result states the retention law",
    );
    await goto(context, "/library");
    await assert.attrEquals(
      "[data-wfx-byof-import]",
      "data-wfx-byof-disconnected",
      "true",
      "the import renders its user-disconnected truth",
    );
    await assert.textContains("[data-wfx-byof-sync-chip]", "Disconnected — records retained", "the disconnected state renders its own chip label");
    // PROVENANCE SURVIVES the disconnect: every record still renders.
    await assert.countAtLeast("[data-wfx-byof-record]", 7, "all seven records still render after the disconnect (provenance survives)");
    await assert.textContains("[data-wfx-byof-import]", "captured ", "the provenance (capture time) still renders after the disconnect");
    // The WebFlix-local library/history were never touched.
    await assert.textContains("[data-wfx-library-watchlist]", "Nothing saved yet", "the WebFlix watchlist is untouched by the import AND the disconnect");
    await assert.textContains("[data-wfx-library-history]", "No watch history yet", "the WebFlix history is untouched by the import AND the disconnect");
    await context.screenshot("j33-disconnect-retained");

    // 10. DELETION IS THE SEPARATE EXPLICIT ACTION — the two-step arm, the
    //     honest removal, the ended feed (never a disconnect side effect).
    await browser.clickInteractive("[data-wfx-byof-action='delete-records']");
    await assert.countAtLeast(
      "[data-wfx-byof-delete-armed='true']",
      1,
      "the destructive action arms explicitly (a separate deliberate step — never a side effect)",
    );
    await browser.clickInteractive("[data-wfx-byof-delete-armed='true']");
    await browser.pollTextContains("[data-wfx-byof-action-result='deleted']", "Deleted 7 imported records", 30_000);
    await assert.textContains(
      "[data-wfx-byof-action-result='deleted']",
      "watchlist and history were never touched",
      "the deletion result states the separation law",
    );
    await goto(context, "/library");
    await assert.countAtLeast("[data-wfx-byof-empty]", 1, "the ended import renders the honest empty state (the feed is gone)");
    await assert.textContains("[data-wfx-byof-empty]", "No imported feeds yet", "the empty state is the feed's own truth after the explicit deletion");
    await assert.textContains("[data-wfx-library-watchlist]", "Nothing saved yet", "the WebFlix watchlist survives the deletion untouched");
    await context.screenshot("j33-deleted-explicit");

    await describe(
      context,
      "the BYOF flow ran end-to-end over the REAL shared composition (FeedImportService + the real YouTube connector's recorded API fixtures): the settings/sources entry (existing IA) listed the feed-import source with its honest absences; the unconnected import attempt answered the typed unauthorized failure with its connect recovery and its honest attempt trail; connect → preview staged the capture (7 items, source-native order labeled, snapshot freshness, relationship summary); confirm landed the Library feed region with provenance, the follow summary, the live chip, the mode-separation statement, and the untouched WebFlix watchlist/history; the same-data sync reported 0/0/0/7, the changed-source sync reported the engine's honest 1 added · 2 updated · 1 removed · 4 unchanged with Aurora Nights in and the removed like out; the expire-auth sync answered the typed unauthorized failure with the named reauthorization-required state and all seven records retained; the reconnect recovery restored live; the disconnect retained every record with its provenance (the WebFlix-local library untouched); the two-step armed delete removed the records and ended the feed while the watchlist/history stayed untouched",
    );
  },
};
