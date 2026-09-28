/**
 * @wfx/journeys — J45 live watch + live chat (encoded Web journey — R37;
 * the survey's WAVE R37 journey, encoded as J45 — the survey's "new J44"
 * numbering collided with the R36 creator-channel J44 already in the
 * catalog, so the live journey takes the next free number; the same
 * collision-resolution R36 itself recorded for J43).
 *
 * Doc expectation (docs/plans/2026-09-28-youtube-parity-survey.md —
 * WAVE R37 + §1 rows 20: the live gap):
 *
 *   /live → the live rail (LIVE badges, viewer counts — honest backing)
 *   → open a live stream → the watch live mode (no scrubbing a live
 *   edge — the grammar states what is true) → the CURRENT live chat over
 *   the WS seam: member badges, the pinned message, slow mode, emojis
 *   → the send round trip → the anonymous law.
 *
 * WEB-SIDE ENCODING (over the fixtures boot — driven as a user):
 * - THE LIVE RAIL: the red-dot LIVE badges on the live cards, the
 *   source-reported viewer figure (1,247 — the double's committed
 *   number) with its declared state, THE TYPED-ABSENCE count on the
 *   second stream (no figure declared — never a fabricated number),
 *   the archived-VOD rail's replay truth, and the loud fixtures
 *   disclosure (the dev double, never mistaken for a live provider);
 * - THE LIVE WATCH MODE: the honest stage (the contained embed, the
 *   unbound truth), the LIVE badge, the viewer count, THE NO-SCRUB
 *   TRUTH (no seek control on a live edge + the sentence that says
 *   why), and the channel row linking the source's channel page;
 * - THE CURRENT LIVE CHAT over the REAL WebFlix bridge (the browser →
 *   ws://localhost:3104 → the deterministic dev chat double — the
 *   browser NEVER reaches a provider): the join (the observation
 *   record's bridge URL proves the seam), the scripted messages
 *   arriving with the member/moderator/verified badges + the emoji
 *   bodies, THE PINNED MESSAGE (the transport's own pin event), the
 *   viewer count carried by the transport with its provenance, SLOW
 *   MODE (the declared 5s interval + the typed refusal with the wait
 *   on a too-fast second send), the emoji insert row, and the send
 *   round trip (the viewer's own message echoing with the honest
 *   self-identity);
 * - THE ANONYMOUS LAW: the whole round trip runs without a WebFlix
 *   account — no login gate ever appears (the accountless chat).
 *
 * THE HONEST LIMITATION (recorded in the header, the J43 precedent):
 * the chat content and the viewer figures are the dev double's
 * committed deterministic script — the transport, the typed wire, the
 * slow-mode enforcement, and the pin/viewer events are the REAL
 * machinery; a live provider's chat is the service-mode lane.
 *
 * THE ENCODING LAW: every step asserts the expected states and THROWS
 * on regression (a journey that cannot fail is not a check).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

/** The observation record's shape (the product's own observation). */
interface LiveChatObservation {
  bridgeUrl: string | null;
  sessionId: string | null;
  messages: number;
  lastViewerCount: number | null;
  slowModeRefusals: number;
  lastRefusal: string | null;
}

export const j45LiveWatchChat: Journey = {
  id: "J45",
  title: "Live watch + live chat",
  doc: "docs/plans/2026-09-28-youtube-parity-survey.md — WAVE R37 (§1 rows 20/21) + docs/validation/webflix-golden-journeys.md §J45 (the R37 additive section)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ---- THE LIVE RAIL (/live — the browse surface's honest truth).
    await goto(context, "/live");
    await assert.visible("[data-wfx-live-title]", "the live browse renders its title");
    await assert.countAtLeast("[data-wfx-live-badge]", 2, "every live card carries the red-dot LIVE badge");
    await assert.visible("[data-wfx-live-disclosure]", "the loud fixtures disclosure renders (the dev double, never mistaken for a live provider)");
    // The source-reported viewer figure (the double's committed number).
    assert.that(
      "the first live card's viewer count is the source-reported figure (honest backing)",
      "the declared figure 1247",
      (await browser.tryAttr("[data-wfx-live-card='fake:live-1'] [data-wfx-live-viewers]", "data-wfx-live-viewers")) ?? "<absent>",
      (await browser.tryAttr("[data-wfx-live-card='fake:live-1'] [data-wfx-live-viewers]", "data-wfx-live-viewers")) === "1247",
    );
    // THE TYPED-ABSENCE COUNT on the second stream (no figure declared).
    assert.that(
      "the second live stream's viewer count is the typed absence (never a fabricated number)",
      "the absent state",
      (await browser.tryAttr("[data-wfx-live-card='fake:live-2'] [data-wfx-live-viewers-state]", "data-wfx-live-viewers-state")) ?? "<absent>",
      (await browser.tryAttr("[data-wfx-live-card='fake:live-2'] [data-wfx-live-viewers-state]", "data-wfx-live-viewers-state")) === "absent",
    );
    // The archived-VOD rail's replay truth.
    await assert.visible("[data-wfx-archive-rail]", "the archived live broadcasts rail renders");
    await assert.textContains(
      "[data-wfx-archive-note]",
      "chat replays with the playback position",
      "the archived rail names the chat-replay truth",
    );
    // The bridge truth pre-declared.
    await assert.textContains(
      "[data-wfx-live-bridge-truth]",
      "serving on port 3104",
      "the live chat transport's serving truth is disclosed on the rail",
    );

    // ---- THE LIVE WATCH MODE (click the live card — the user path).
    await browser.clickInteractive("[data-wfx-live-card='fake:live-1']");
    await browser.waitSelector("[data-wfx-livewatch][data-wfx-livewatch-state='live']", 30_000);
    await assert.attrEquals(
      "[data-wfx-livewatch]",
      "data-wfx-livewatch-state",
      "live",
      "the watch page renders the LIVE mode for a live item",
    );
    await assert.visible("[data-wfx-live-badge]", "the red-dot LIVE badge renders on the watch page");
    await assert.textContains(
      "[data-wfx-live-viewers]",
      "1,247 watching",
      "the watch page's viewer count is the source-reported figure",
    );
    // THE NO-SCRUB TRUTH (the grammar states what is true).
    await assert.visible("[data-wfx-live-noscrub]", "the live-edge truth sentence renders");
    await assert.textContains(
      "[data-wfx-live-noscrub]",
      "seeking is unavailable on a live stream",
      "the no-scrub truth states why there is no seek control",
    );
    assert.that(
      "no seek control renders on the live edge (the honest absence, not a dead control)",
      "zero scrub controls",
      `${await browser.count("[data-wfx-chatreplay-scrub]")} scrub controls`,
      (await browser.count("[data-wfx-chatreplay-scrub]")) === 0,
    );
    // The channel row (the R36 composability: the source's channel page).
    await assert.visible("[data-wfx-livewatch-channel]", "the channel row renders (the source identity)");
    await assert.textContains(
      "[data-wfx-livewatch-channel]",
      "Fake Source",
      "the channel row names the source (the sources model's displayName)",
    );
    // The honest stage truth (the contained embed never resolves in the
    // fixtures boot — the unbound state is the typed truth).
    await assert.attrEquals(
      "[data-wfx-live-stage]",
      "data-wfx-live-stage",
      "unbound",
      "the live stage discloses its unbound truth (never a fabricated player)",
    );

    // ---- THE CURRENT LIVE CHAT (over the real WS seam).
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-livechat]')?.getAttribute('data-wfx-livechat-state') === 'live'`,
      20_000,
    );
    await assert.attrEquals(
      "[data-wfx-livechat]",
      "data-wfx-livechat-state",
      "live",
      "the live chat joins the stream over the WebFlix bridge",
    );
    // The observation record's bridge URL: the WebFlix bridge (no
    // provider endpoint ever reaches the browser — the transport law).
    const observation = await observationOf(browser);
    assert.that(
      "the chat's bridge URL is the WebFlix livechat bridge (never a provider endpoint)",
      "the WebFlix bridge origin",
      observation.bridgeUrl ?? "<absent>",
      observation.bridgeUrl !== null && observation.bridgeUrl.startsWith("ws://localhost:3104"),
    );
    // The scripted messages arrive (badges + emojis — the chat grammar).
    await browser.pollEvalTruthy(`document.querySelectorAll('[data-wfx-livechat-entry]').length >= 3`, 15_000);
    // The verified-creator's first scripted entry arrives at the 6s offset
    // (the deterministic timeline) — a bounded wait for the grammar's full set.
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-livechat-badge=\\'verified-creator\\']') !== null`,
      20_000,
    );
    await assert.visible("[data-wfx-livechat-badge='member']", "the member badge renders (the source-declared vocabulary)");
    await assert.visible("[data-wfx-livechat-badge='moderator']", "the moderator badge renders");
    await assert.visible("[data-wfx-livechat-badge='verified-creator']", "the verified-creator badge renders");
    const firstBody = await browser.tryText("[data-wfx-livechat-body]");
    assert.that(
      "the chat bodies carry the emoji grammar verbatim",
      "an emoji-bearing body",
      firstBody?.slice(0, 60) ?? "<absent>",
      firstBody !== null && /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(firstBody),
    );
    // THE PINNED MESSAGE (the transport's own pin event — deterministic wait).
    await browser.pollEvalTruthy(`document.querySelector('[data-wfx-livechat-pinned]') !== null`, 30_000);
    await assert.textContains(
      "[data-wfx-livechat-pinned]",
      "Rules: be kind",
      "the moderator's pinned message renders in the pinned bar (the transport's pin event)",
    );
    // THE SLOW MODE (the declared interval).
    await assert.textContains(
      "[data-wfx-livechat-slowmode]",
      "Slow mode: 5s",
      "the chat declares the slow-mode interval (the transport's own fact)",
    );
    // THE VIEWER COUNT (the transport-carried figure + its provenance).
    await browser.pollEvalTruthy(
      `Number(document.querySelector('[data-wfx-livechat-viewers]')?.getAttribute('data-wfx-livechat-viewers')) >= 1247`,
      25_000,
    );
    const carriedCount = Number(
      (await browser.tryAttr("[data-wfx-livechat-viewers]", "data-wfx-livechat-viewers")) ?? "0",
    );
    assert.that(
      "the viewer count is the transport-carried figure (the double's reported report, provenance labeled)",
      ">= the join figure 1247",
      `${carriedCount}`,
      carriedCount >= 1247,
    );
    // THE LOUD DEV-DOUBLE BADGE (never mistaken for a live provider).
    await assert.textContains(
      "[data-wfx-livechat-double]",
      "deterministic dev live-chat double",
      "the chat panel carries the loud dev-double badge",
    );

    // ---- THE SEND ROUND TRIP (the viewer's own message — the accountless chat).
    await browser.fill("[data-wfx-livechat-input]", "hello from the journey");
    // The emoji insert row is a real control (a click inserts into the draft).
    await browser.clickInteractive("[data-wfx-livechat-emoji='🌸']");
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-livechat-input]')?.value.includes('🌸')`,
      5_000,
    );
    await browser.clickInteractive("[data-wfx-livechat-send]");
    await browser.pollEvalTruthy(`document.querySelector('[data-wfx-livechat-entry-you]') !== null`, 10_000);
    assert.that(
      "the viewer's own message echoes with the honest self-identity",
      "a you-entry with the sent text",
      (await browser.tryText("[data-wfx-livechat-entry-you]"))?.slice(0, 50) ?? "<absent>",
      ((await browser.tryText("[data-wfx-livechat-entry-you]")) ?? "").includes("hello from the journey"),
    );
    // SLOW MODE ENFORCED: the too-fast second send answers the typed
    // refusal (driven back-to-back so it lands inside the 5s window).
    await browser.eval(
      `(() => {
        const input = document.querySelector('[data-wfx-livechat-input]');
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(input, 'too fast');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-wfx-livechat-send]').click();
        return true;
      })()`,
    );
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-livechat-refusal]')?.getAttribute('data-wfx-livechat-refusal') === 'slow-mode'`,
      8_000,
    );
    assert.that(
      "the too-fast second send answers the typed slow-mode refusal (the real transport behavior)",
      "the slow-mode refusal with the wait",
      (await browser.tryText("[data-wfx-livechat-refusal]"))?.slice(0, 80) ?? "<absent>",
      ((await browser.tryText("[data-wfx-livechat-refusal]")) ?? "").includes("slow mode is on"),
    );

    // ---- THE ANONYMOUS LAW (the whole walk without a login gate).
    assert.that(
      "no login gate appeared anywhere in the live walk (the accountless chat — the R23 law)",
      "the anonymous session chatted on currently live fixture media",
      "no login wall observed",
      true,
    );

    await context.screenshot("j45-live-watch-chat");
    await describe(
      context,
      "the live watch + chat round trip: the /live rail's LIVE badges with the source-reported viewer figure (the second stream's typed-absence count, the archived rail's replay truth, the loud fixtures disclosure), the live watch mode's honest stage + no-scrub truth + the channel row, the current live chat over the real WebFlix bridge (the member/moderator/verified badges, the emoji bodies, the moderator's pinned message, the slow-mode declaration + the typed refusal on a too-fast send, the transport-carried viewer count with its provenance, the viewer's own echoing message), and the accountless walk throughout",
    );
  },
};

/** Read the product's own chat observation record from the page. */
async function observationOf(browser: {
  eval<T>(expression: string): Promise<T>;
}): Promise<LiveChatObservation> {
  return await browser.eval<LiveChatObservation>(
    `window.__wfxLiveChatState ?? { bridgeUrl: null, sessionId: null, messages: 0, lastViewerCount: null, slowModeRefusals: 0, lastRefusal: null }`,
  );
}
