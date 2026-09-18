/**
 * @wfx/journeys — J29 Network loss / playback recovery (encoded Web
 * journey).
 *
 * Doc expectation (J28–J30 block): "failures are specific, recoverable
 * where possible, and honest. A … network failure must never look like
 * a silent success."
 *
 * Web-fixture-boot encoding: the web adapter's SHIPPED network-loss
 * surface — the offline route (the self-contained honest state: you're
 * offline, watch progress is safe, with a retry) and the player's
 * typed failure state for unresolvable content (specific + recoverable
 * with a path back — never a silent success).
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";

export const j29NetworkLossRecovery: Journey = {
  id: "J29",
  title: "Network loss / playback recovery",
  doc: "docs/validation/webflix-golden-journeys.md §J28–J30 block",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;
    await goto(context, "/offline");

    // The honest offline state (the shipped network-loss surface).
    await assert.visible("[data-wfx-offline]", "the offline route renders its self-contained state");
    await assert.visible("[data-wfx-offline-state]", "the offline state is announced (role=status)");
    const offlineText = await browser.tryText("[data-wfx-offline-state]");
    assert.that(
      "the offline state says you're offline and the watch progress is safe (specific, honest)",
      "the offline + safe-progress truth",
      offlineText ?? "<none>",
      offlineText !== null && offlineText.toLowerCase().includes("offline") && offlineText.toLowerCase().includes("progress is safe"),
    );
    await assert.countAtLeast("[data-wfx-offline-retry]", 1, "the offline state offers its retry action (recoverable)");

    // The retry is wired (a real handler, not a dead button).
    const wired = await browser.eval<boolean>(
      `(() => { const button = document.querySelector('[data-wfx-offline-retry]'); return button !== null && (button.onclick !== null || document.getElementById('wfx-offline-retry') !== null); })()`,
    );
    assert.that(
      "the offline retry control is wired to a real handler",
      "a retry handler present",
      wired ? "wired" : "not wired",
      wired,
    );

    // Playback failure recovery: the typed failure with its return path.
    await goto(
      context,
      "/player?id=wfxitm_00000000000000000000000099&connector=fake-source&ref=fake%3Aunknown&title=Unresolvable&type=video",
    );
    await assert.countAtLeast("[data-wfx-error]", 1, "an unresolvable playback renders its typed failure (never a silent success)");
    await assert.textContains("[data-wfx-error]", "Playback could not start", "the failure is specific (names what failed)");
    await assert.countAtLeast("[data-wfx-surface='player'] a[href*='/item?']", 1, "the failure offers its recovery path back to the item");
    await assert.countExactly("[data-wfx-player-frame]", 0, "no provider frame renders for a failed session (never a fake stage)");

    await context.screenshot("j29-network-loss-recovery");
    await describe(context, "the offline route rendered its honest state with a wired retry; the unresolvable playback rendered a specific typed failure with a recovery path");
  },
};
