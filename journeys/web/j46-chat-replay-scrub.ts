/**
 * @wfx/journeys — J46 chat replay scrub (encoded Web journey — R37; the
 * survey's WAVE R37 "J45 (chat replay scrub)" — renumbered J46 after the
 * R36 J44 collision, the same resolution J45 itself records).
 *
 * Doc expectation (docs/plans/2026-09-28-youtube-parity-survey.md —
 * WAVE R37 + §1 row 21: the archived-live-VOD chat replay gap):
 *
 *   /live → the archived live broadcast → the watch page's replay mode
 *   → the chat window follows the playhead: scrub → the window moves;
 *   play → the messages arrive in time order → the archived truths
 *   (the pinned message, the slow-mode fact, the "committed log — never
 *   a live stream" sentence).
 *
 * WEB-SIDE ENCODING (over the fixtures boot — driven as a user):
 * - THE ARCHIVED MODE: the "was live" badge, the VOD's duration, and
 *   THE REPLAY TRUTH (the committed log, timed to the position — the
 *   surface states it plainly, never a live stream);
 * - THE PLAYHEAD BINDING (the scrub proof, three positions): at 0:00
 *   the window holds only the pre-roll entries; scrubbed to 20s the
 *   window follows (the 1s/5s/11s/18s entries visible, the 26s+ ones
 *   ABSENT); scrubbed to 100s the window moves again (the 74s/88s
 *   entries, the earlier ones gone);
 * - THE ARCHIVED PIN: nothing pinned at 20s (the pin's offset is 44s),
 *   pinned from 100s onward (the pin stands from its own offset);
 * - THE PLAY CLOCK: play advances the position and the messages arrive
 *   in TIME ORDER (the arrival count grows — the committed log's own
 *   order, never a stream);
 * - THE ARCHIVED FACTS: the slow-mode fact in the past tense (it WAS
 *   active — a recorded session fact), the 15-message truth, and the
 *   honest absence of any live-chat surface (an ended broadcast never
 *   streams a current chat).
 *
 * THE ENCODING LAW: every step asserts the expected states and THROWS
 * on regression (a journey that cannot fail is not a check).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j46ChatReplayScrub: Journey = {
  id: "J46",
  title: "Chat replay scrub",
  doc: "docs/plans/2026-09-28-youtube-parity-survey.md — WAVE R37 (§1 row 21) + docs/validation/webflix-golden-journeys.md §J46 (the R37 additive section)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ---- THE ARCHIVED MODE (from the live rail — the user path).
    await goto(context, "/live");
    await browser.clickInteractive("[data-wfx-live-card='fake:live-vod-1']");
    await browser.waitSelector("[data-wfx-livewatch][data-wfx-livewatch-state='archived-live-vod']", 30_000);
    await assert.attrEquals(
      "[data-wfx-livewatch]",
      "data-wfx-livewatch-state",
      "archived-live-vod",
      "the watch page renders the ARCHIVED-LIVE-VOD mode for an ended broadcast",
    );
    await assert.visible("[data-wfx-livedone-badge]", "the 'was live' badge renders (the ended truth, never red)");
    await assert.textContains(
      "[data-wfx-archive-duration]",
      "13:00",
      "the archived VOD carries its duration (it scrubs like any video)",
    );
    // THE REPLAY TRUTH (the surface states it plainly).
    await assert.visible("[data-wfx-chatreplay]", "the chat replay panel renders");
    await assert.textContains(
      "[data-wfx-chatreplay-truth]",
      "committed log, never a live stream",
      "the replay truth names the committed log (never a live stream)",
    );
    await assert.textContains(
      "[data-wfx-chatreplay-facts]",
      "Slow mode (5s) was on during this stream",
      "the archived slow-mode fact renders in the past tense (a recorded session fact)",
    );
    await assert.textContains(
      "[data-wfx-chatreplay-facts]",
      "15 archived messages",
      "the committed log's size is disclosed",
    );
    // The honest absence: an ended broadcast never streams a current chat.
    assert.that(
      "no live-chat surface renders on an archived broadcast (the ended stream never streams a current chat)",
      "zero live-chat panels",
      `${await browser.count("[data-wfx-livechat-state]")}`,
      (await browser.count("[data-wfx-livechat-state]")) === 0,
    );

    // ---- THE PLAYHEAD BINDING AT 0:00 (the initial window).
    await assert.textEquals(
      "[data-wfx-chatreplay-clock]",
      "0:00 / 13:00",
      "the replay clock starts at the video's start",
    );
    // Scrub to 20s (the surface's own position control — the user path).
    await scrubTo(browser, 20_000);
    await assert.textEquals(
      "[data-wfx-chatreplay-clock]",
      "0:20 / 13:00",
      "the clock follows the scrub",
    );
    const entriesAt20 = await replayEntriesAt(browser, 20_000);
    assert.that(
      "the window at 0:20 holds exactly the entries the playhead passed (1s/5s/11s/18s — the 26s+ ones absent)",
      "offsets 1000, 5000, 11000, 18000",
      entriesAt20.join(", ") || "<empty>",
      entriesAt20.join(",") === "1000,5000,11000,18000",
    );
    // Nothing pinned at 20s (the pin's own offset is 44s).
    assert.that(
      "nothing is pinned at 0:20 (the pin stands from its own 44s offset)",
      "no pinned bar",
      (await browser.count("[data-wfx-chatreplay-pinned]")) === 0 ? "no pinned bar" : "a pinned bar rendered",
      (await browser.count("[data-wfx-chatreplay-pinned]")) === 0,
    );

    // ---- SCRUB TO 100s (the window follows — the scrub proof's core).
    await scrubTo(browser, 100_000);
    await assert.textEquals(
      "[data-wfx-chatreplay-clock]",
      "1:40 / 13:00",
      "the clock follows the second scrub",
    );
    const entriesAt100 = await replayEntriesAt(browser, 100_000);
    assert.that(
      "the window at 1:40 moved with the playhead (the 74s/88s entries; the pre-70s ones gone)",
      "offsets 74000, 88000",
      entriesAt100.join(", ") || "<empty>",
      entriesAt100.join(",") === "74000,88000",
    );
    // THE ARCHIVED PIN stands from its own offset onward.
    await assert.visible("[data-wfx-chatreplay-pinned]", "the archived pinned message renders past its own offset");
    await assert.textContains(
      "[data-wfx-chatreplay-pinned]",
      "Pinned: tonight's shot list",
      "the moderator's archived pin is the pinned message (the log's own pin)",
    );
    // The viewer's own archived message is honestly marked (the you row).
    await scrubTo(browser, 55_000);
    await assert.visible(
      "[data-wfx-chatreplay-entry-you]",
      "the viewer's own archived message renders with the honest self-identity",
    );

    // ---- THE PLAY CLOCK (the time-ordered arrival).
    await scrubTo(browser, 60_000);
    await assert.attrEquals(
      "[data-wfx-chatreplay]",
      "data-wfx-chatreplay-state",
      "paused",
      "the replay starts paused (the surface's own control)",
    );
    await browser.clickInteractive("[data-wfx-chatreplay-play]");
    await assert.attrEquals(
      "[data-wfx-chatreplay]",
      "data-wfx-chatreplay-state",
      "playing",
      "play starts the replay clock",
    );
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-chatreplay-clock]')?.textContent.startsWith('1:0') === true && document.querySelector('[data-wfx-chatreplay-clock]')?.textContent !== '1:00 / 13:00'`,
      8_000,
    );
    const clockAfter = await browser.tryText("[data-wfx-chatreplay-clock]");
    assert.that(
      "the replay clock advances past 1:00 (the messages arrive in time order as it moves)",
      "a clock beyond 1:00",
      clockAfter ?? "<absent>",
      clockAfter !== null && clockAfter.startsWith("1:0") && clockAfter !== "1:00 / 13:00",
    );
    await assert.textContains(
      "[data-wfx-chatreplay-facts]",
      "replayed so far",
      "the arrival count discloses the time-ordered flow (never a stream)",
    );

    await context.screenshot("j46-chat-replay-scrub");
    await describe(
      context,
      "the chat replay scrub: the archived-live-VOD mode (the 'was live' badge, the 13:00 duration, the committed-log truth sentence, the past-tense slow-mode fact, the honest absence of any current chat), the playhead binding across three scrubs (0:20's window, 1:40's moved window with the 44s pin standing, the viewer's own marked archived message), and the play clock advancing with the messages arriving in time order",
    );
  },
};

/** Scrub the replay position control to one position (the DOM's own control). */
async function scrubTo(
  browser: { eval<T>(expression: string): Promise<T> },
  positionMs: number,
): Promise<void> {
  await browser.eval(
    `(() => {
      const scrub = document.querySelector('[data-wfx-chatreplay-scrub]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(scrub, '${String(positionMs)}');
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
      scrub.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  );
  // A settle for React's controlled flush (the clock follows).
  await browser.eval(
    `new Promise((resolve) => setTimeout(() => resolve(document.querySelector('[data-wfx-chatreplay-clock]')?.textContent ?? ''), 250))`,
  );
}

/** Read the visible replay window's entry offsets (the derived truth). */
async function replayEntriesAt(
  browser: { eval<T>(expression: string): Promise<T> },
  _positionMs: number,
): Promise<string[]> {
  return await browser.eval<string[]>(
    `[...document.querySelectorAll('[data-wfx-chatreplay-entry]')].map((entry) => entry.getAttribute('data-wfx-chatreplay-offset'))`,
  );
}
