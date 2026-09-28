/**
 * R37 — the ARCHIVED LIVE-CHAT LOG tests (the committed-artifact law: the
 * replay reads committed data, validated at the boundary; the playhead
 * binding follows the position — scrub → the window follows).
 */

import { describe, expect, it } from "bun:test";

import type { LiveChatLog, LiveChatLogEntry } from "../src/live/live-chat-log";
import {
  liveChatEntriesBetween,
  liveChatEntryLabel,
  liveChatPinnedAt,
  liveChatWindowAt,
  parseLiveChatLog,
} from "../src/live/live-chat-log";

/** A well-formed committed log (the fixture's own grammar). */
function sampleLog(): LiveChatLog {
  const entries: LiveChatLogEntry[] = [
    { offsetMs: 0, author: "mod_ana", authorBadges: ["moderator"], body: "Welcome to the stream! 🌙" },
    { offsetMs: 4_000, author: "rainFan", authorBadges: ["member"], body: "first! 🎉" },
    { offsetMs: 9_000, author: "lurker", authorBadges: [], body: "the audio is perfect" },
    { offsetMs: 15_000, author: "AuroraNights", authorBadges: ["verified-creator"], body: "glad you're all here ✨" },
    { offsetMs: 22_000, author: "me", authorBadges: [], body: "hello from me", you: true },
    { offsetMs: 30_000, author: "quietOne", authorBadges: [], body: "👋" },
  ];
  return { kind: "live-chat-log", version: 1, slowModeMs: 5_000, pinnedOffsetMs: 15_000, entries };
}

describe("R37 parseLiveChatLog — the boundary validation (never a trusted cast)", () => {
  it("parses the well-formed v1 artifact", () => {
    const parsed = parseLiveChatLog(sampleLog());
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("live-chat-log");
    expect(parsed?.entries.length).toBe(6);
    expect(parsed?.slowModeMs).toBe(5_000);
    expect(parsed?.pinnedOffsetMs).toBe(15_000);
  });

  it("refuses a non-object / wrong-kind / wrong-version value", () => {
    expect(parseLiveChatLog(null)).toBeNull();
    expect(parseLiveChatLog(undefined)).toBeNull();
    expect(parseLiveChatLog("live-chat-log")).toBeNull();
    expect(parseLiveChatLog({ kind: "something-else", version: 1 })).toBeNull();
    expect(parseLiveChatLog({ kind: "live-chat-log", version: 2 })).toBeNull();
  });

  it("refuses a malformed entry (never a partial fabricated log)", () => {
    const log = sampleLog();
    expect(parseLiveChatLog({ ...log, entries: [...log.entries, { offsetMs: -1, author: "x", body: "y" }] })).toBeNull();
    expect(parseLiveChatLog({ ...log, entries: [...log.entries, { offsetMs: 1, author: "", body: "y" }] })).toBeNull();
    expect(parseLiveChatLog({ ...log, entries: [...log.entries, { offsetMs: 1, author: "x", body: "" }] })).toBeNull();
    expect(parseLiveChatLog({ ...log, entries: [...log.entries, { offsetMs: 1, author: "x", body: "y", authorBadges: ["paid"] }] })).toBeNull();
    expect(parseLiveChatLog({ ...log, entries: "nope" })).toBeNull();
  });

  it("refuses malformed session facts (slow mode / the pin offset)", () => {
    const log = sampleLog();
    expect(parseLiveChatLog({ ...log, slowModeMs: -5 })).toBeNull();
    expect(parseLiveChatLog({ ...log, slowModeMs: "5s" })).toBeNull();
    expect(parseLiveChatLog({ ...log, pinnedOffsetMs: Number.NaN })).toBeNull();
  });

  it("accepts the typed absences (no slow mode, no pin)", () => {
    const parsed = parseLiveChatLog({ ...sampleLog(), slowModeMs: null, pinnedOffsetMs: null });
    expect(parsed?.slowModeMs).toBeNull();
    expect(parsed?.pinnedOffsetMs).toBeNull();
  });

  it("carries the viewer's own archived message (the honest self-identity)", () => {
    const parsed = parseLiveChatLog(sampleLog());
    const you = parsed?.entries.find((entry) => entry.you === true);
    expect(you?.author).toBe("me");
  });
});

describe("R37 liveChatWindowAt — the playhead binding (scrub → the window follows)", () => {
  it("at position 0 the window holds only the entries at offset 0", () => {
    const window = liveChatWindowAt(sampleLog(), 0, 10_000);
    expect(window.map((entry) => entry.author)).toEqual(["mod_ana"]);
  });

  it("the window is (position − windowMs, position] — the boundary entries obey", () => {
    const log = sampleLog();
    // position 10_000, window 10_000 → offsets in (0, 10000]: 4000, 9000.
    expect(liveChatWindowAt(log, 10_000, 10_000).map((e) => e.offsetMs)).toEqual([4_000, 9_000]);
    // position 30_000, window 10_000 → offsets in (20000, 30000]: 22000, 30000.
    expect(liveChatWindowAt(log, 30_000, 10_000).map((e) => e.offsetMs)).toEqual([22_000, 30_000]);
    // The entry AT the position is included; the one exactly windowMs back is NOT.
    expect(liveChatWindowAt(log, 4_000, 4_000).map((e) => e.offsetMs)).toEqual([4_000]);
  });

  it("scrubbing mid-stream moves the window (the scrub proof's derivation)", () => {
    const log = sampleLog();
    const at15 = liveChatWindowAt(log, 15_000, 8_000).map((e) => e.author);
    expect(at15).toEqual(["lurker", "AuroraNights"]);
    const at25 = liveChatWindowAt(log, 25_000, 8_000).map((e) => e.author);
    expect(at25).toEqual(["me"]);
  });

  it("entries arrive in TIME ORDER within the window (the committed order)", () => {
    const window = liveChatWindowAt(sampleLog(), 60_000, 60_000);
    const offsets = window.map((entry) => entry.offsetMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("a malformed position answers the empty window (never a throw)", () => {
    const log = sampleLog();
    expect(liveChatWindowAt(log, Number.NaN, 10_000)).toEqual([]);
    expect(liveChatWindowAt(log, -1, 10_000)).toEqual([]);
    expect(liveChatWindowAt(log, 10_000, 0)).toEqual([]);
  });
});

describe("R37 liveChatEntriesBetween — the play-arrival derivation", () => {
  it("the entries a play from X to Y surfaces (time order)", () => {
    const between = liveChatEntriesBetween(sampleLog(), 10_000, 32_000);
    expect(between.map((entry) => entry.author)).toEqual(["AuroraNights", "me", "quietOne"]);
  });

  it("a non-advancing interval answers nothing", () => {
    expect(liveChatEntriesBetween(sampleLog(), 30_000, 30_000)).toEqual([]);
    expect(liveChatEntriesBetween(sampleLog(), 30_000, 10_000)).toEqual([]);
  });
});

describe("R37 liveChatPinnedAt — the archived pin's truth", () => {
  it("the pin stands from its own offset onward", () => {
    const log = sampleLog();
    expect(liveChatPinnedAt(log, 14_999)).toBeNull();
    expect(liveChatPinnedAt(log, 15_000)?.author).toBe("AuroraNights");
    expect(liveChatPinnedAt(log, 120_000)?.author).toBe("AuroraNights");
  });

  it("a log with no pin answers null at every position", () => {
    const log: LiveChatLog = { ...sampleLog(), pinnedOffsetMs: null };
    expect(liveChatPinnedAt(log, 60_000)).toBeNull();
  });

  it("a pin offset with no matching entry answers null (the honest absence)", () => {
    const log: LiveChatLog = { ...sampleLog(), pinnedOffsetMs: 77_777 };
    expect(liveChatPinnedAt(log, 80_000)).toBeNull();
  });
});

describe("R37 liveChatEntryLabel — the render-side composition", () => {
  it("the label carries the author + the declared badges", () => {
    const log = sampleLog();
    expect(liveChatEntryLabel(log.entries[0]!)).toBe("mod_ana (moderator)");
    expect(liveChatEntryLabel(log.entries[2]!)).toBe("lurker");
  });
});
