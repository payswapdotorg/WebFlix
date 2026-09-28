/**
 * @wfx/app-web — the DETERMINISTIC DEV LIVE-CHAT DOUBLE (the R37
 * fixtures-boot double of a live-reporting source's chat session seam).
 *
 * THE HONEST DOUBLE LAW (the R23-G live-captions + R25-D provider-double
 * precedent, the same discipline): this module is the dev/fixtures
 * composition's stand-in for the live-chat session a real source serves.
 * Its scripted transcript IS committed deterministic data; its emission
 * timing is derived from the SESSION's elapsed time (so a given
 * observation offset sees a deterministic set — the dev-realtime
 * provider's scripted-timing law); its viewer figures are the double's
 * own REPORTED numbers (provenance labeled, never a claimed live
 * measurement).
 *
 * WHAT IS REAL HERE: the slow-mode enforcement (a real transport
 * behavior over the viewer's own sends — the typed refusal with the
 * remaining wait); the member badges (the closed source-declared
 * vocabulary); the pinned message (a real transport event that changes
 * the surface); the viewer-count report (a real transport event).
 *
 * WHAT IS MODELED (never claimed as measured): the chat CONTENT (the
 * committed script — deterministic dev data), the pacing, and the viewer
 * figures (the double's scripted reports).
 *
 * NEVER REACHED IN PRODUCTION: loaded ONLY through the fixtures boot's
 * dynamic import (livechat-boot.ts — the R23 lesson: the service graph
 * never statically reaches the dev double).
 */

import type { LiveChatAuthorBadge, LiveChatLogEntry } from "@wfx/connectors";

// ---------------------------------------------------------------------------
// The double's declared identity (the loud badge law)
// ---------------------------------------------------------------------------

/** The dev chat double's provider-neutral id (never a real provider's name). */
export const DEV_LIVECHAT_DOUBLE_ID = "wfx-dev-livechat";

/** The honest double badge sentence (rendered on the chat surface — the R25 labeling law). */
export const DEV_LIVECHAT_DOUBLE_BADGE =
  "the deterministic dev live-chat double (the fixtures' scripted chat — committed deterministic content and reported figures, never a live provider)";

/** The slow-mode interval the double's sessions declare (the chat grammar's transport behavior). */
export const DEV_LIVECHAT_SLOW_MODE_MS = 5_000;

// ---------------------------------------------------------------------------
// The committed script (the deterministic current-chat transcript)
// ---------------------------------------------------------------------------

/** One scripted chat entry (the timeline offset + the grammar's own shape). */
export interface DevChatScriptEntry {
  /** The session-relative emission offset (ms since join — the deterministic timeline). */
  readonly atMs: number;
  /** `true` when this scripted entry is the one the moderator PINS (the transport's own pin event). */
  readonly pin?: true;
  readonly entry: Omit<LiveChatLogEntry, "offsetMs">;
}

/**
 * THE COMMITTED SCRIPT of the live broadcast's current chat (the honest
 * transcript of record — evidence/r37/honesty.md carries it verbatim as
 * the deterministic transcript). The grammar's full set: the moderator's
 * welcome and the rules pin, the member-badge authors, the verified
 * creator's replies, emojis in the bodies, and the second-by-second
 * pacing a live chat carries.
 */
export const DEV_LIVECHAT_SCRIPT: readonly DevChatScriptEntry[] = [
  {
    atMs: 800,
    entry: {
      author: "mod_ana",
      authorBadges: ["moderator"],
      body: "Welcome to Signal Bloom live! The stream starts now 🌸",
    },
  },
  {
    atMs: 2_200,
    entry: {
      author: "bloomWatcher",
      authorBadges: ["member"],
      body: "member badge and proud — third bloom stream in a row 🎉",
    },
  },
  {
    atMs: 4_100,
    entry: { author: "quietSky", authorBadges: [], body: "the intro synth is so good tonight" },
  },
  {
    atMs: 6_000,
    entry: {
      author: "SignalBloom",
      authorBadges: ["verified-creator"],
      body: "We are LIVE from the bloom lab — tonight is the deep-sky sequence ✨",
    },
  },
  {
    atMs: 8_400,
    entry: { author: "lensLass", authorBadges: [], body: "🔥🔥🔥" },
  },
  {
    atMs: 10_500,
    entry: {
      author: "polaris_jim",
      authorBadges: ["member"],
      body: "the member stream notifications are worth it alone ⭐",
    },
  },
  {
    atMs: 13_000,
    // The scripted PIN (the transport's own event — the `pin` mark).
    pin: true,
    entry: {
      author: "mod_ana",
      authorBadges: ["moderator"],
      body: "📌 Rules: be kind, no spoilers, slow mode (5s) is on. Enjoy the bloom!",
    },
  },
  {
    atMs: 15_600,
    entry: { author: "nightowl_4", authorBadges: ["member"], body: "chat is moving fast tonight 🌙" },
  },
  {
    atMs: 18_200,
    entry: {
      author: "SignalBloom",
      authorBadges: ["verified-creator"],
      body: "Shout-out to the members in chat — the member badge looks great on you 💚",
    },
  },
  {
    atMs: 21_000,
    entry: { author: "selenite", authorBadges: ["member"], body: "😄😄😄" },
  },
  {
    atMs: 23_500,
    entry: { author: "quietSky", authorBadges: [], body: "asking for a friend: will the VOD keep this chat?" },
  },
  {
    atMs: 26_000,
    entry: {
      author: "mod_ana",
      authorBadges: ["moderator"],
      body: "Yes — the VOD keeps the chat as a replay, timed to the moment you are watching 📼",
    },
  },
  {
    atMs: 29_000,
    entry: { author: "bloomWatcher", authorBadges: ["member"], body: "best feature on the platform, honestly" },
  },
];

/**
 * The double's REPORTED viewer figure at join (the source-report the
 * bridge carries; the fixtures' committed number — never a measurement).
 */
export const DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN = 1247;

/**
 * The viewer-count report schedule: the double reports on this cadence,
 * stepping the figure deterministically (the same figure at the same
 * elapsed offset every run — the scripted-timing law).
 */
export const DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS = 15_000;

/** The deterministic per-report step (the modeled ebb of a live audience). */
export const DEV_LIVECHAT_VIEWER_REPORT_STEP = 3;

/** The double's viewer figure at one elapsed offset (pure — the scripted report). */
export function devLiveChatViewerCountAt(elapsedMs: number): number {
  const steps = Math.max(0, Math.floor(elapsedMs / DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS));
  return DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN + steps * DEV_LIVECHAT_VIEWER_REPORT_STEP;
}

/** The double's viewer-report provenance sentence (rides every event). */
export const DEV_LIVECHAT_VIEWER_PROVENANCE =
  "the dev chat double's scripted reported figure (a fixtures-mode model, never a live measurement)";

// ---------------------------------------------------------------------------
// The script derivations (pure)
// ---------------------------------------------------------------------------

/** The badge set the script exercises (the grammar's closed vocabulary, for the tests). */
export const DEV_LIVECHAT_SCRIPT_BADGES: readonly LiveChatAuthorBadge[] = [
  "moderator",
  "member",
  "verified-creator",
];

/**
 * The script entries whose emission offsets fall in `(fromMs, toMs]`
 * (the time-ordered slice the bridge relays as the session advances).
 */
export function devLiveChatScriptBetween(
  fromMs: number,
  toMs: number,
): readonly DevChatScriptEntry[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  return DEV_LIVECHAT_SCRIPT.filter((row) => row.atMs > fromMs && row.atMs <= toMs);
}
