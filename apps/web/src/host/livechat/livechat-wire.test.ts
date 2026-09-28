/**
 * R37 — the LIVE CHAT WIRE tests (the typed-wire validation law: the
 * operations are a closed set; a malformed message answers the typed
 * `invalid` refusal — never a trusted cast, never a crash).
 */

import { describe, expect, it } from "bun:test";

import {
  LIVE_CHAT_MAX_BODY_LENGTH,
  parseLiveChatWireClientMessage,
  encodeLiveChatServerMessage,
  type LiveChatServerMessage,
} from "./livechat-wire";
import {
  DEV_LIVECHAT_SCRIPT,
  DEV_LIVECHAT_SCRIPT_BADGES,
  devLiveChatScriptBetween,
  devLiveChatViewerCountAt,
  DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN,
  DEV_LIVECHAT_SLOW_MODE_MS,
  DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS,
} from "./livechat-dev-double";

describe("R37 parseLiveChatWireClientMessage — the closed operation set", () => {
  it("parses a well-formed join", () => {
    expect(parseLiveChatWireClientMessage(JSON.stringify({ op: "join", externalRef: "fake:live-1" }))).toEqual({
      op: "join",
      externalRef: "fake:live-1",
    });
  });

  it("parses a well-formed send", () => {
    expect(
      parseLiveChatWireClientMessage(JSON.stringify({ op: "send", sessionId: "wfxlc_0001", text: "hello 🌙" })),
    ).toEqual({ op: "send", sessionId: "wfxlc_0001", text: "hello 🌙" });
  });

  it("parses a well-formed leave", () => {
    expect(
      parseLiveChatWireClientMessage(JSON.stringify({ op: "leave", sessionId: "wfxlc_0001" })),
    ).toEqual({ op: "leave", sessionId: "wfxlc_0001" });
  });

  it("refuses non-JSON and non-object messages (the typed invalid)", () => {
    expect(parseLiveChatWireClientMessage("not json")).toEqual({
      op: "invalid",
      detail: "the message is not JSON",
    });
    expect(parseLiveChatWireClientMessage("42")).toEqual({
      op: "invalid",
      detail: "the message is not an object",
    });
    expect(parseLiveChatWireClientMessage("null")).toEqual({
      op: "invalid",
      detail: "the message is not an object",
    });
  });

  it("refuses unknown operations", () => {
    expect(parseLiveChatWireClientMessage(JSON.stringify({ op: "eavesdrop" }))).toMatchObject({
      op: "invalid",
    });
  });

  it("refuses a join without an external ref", () => {
    expect(parseLiveChatWireClientMessage(JSON.stringify({ op: "join" }))).toMatchObject({ op: "invalid" });
    expect(parseLiveChatWireClientMessage(JSON.stringify({ op: "join", externalRef: "" }))).toMatchObject({
      op: "invalid",
    });
  });

  it("refuses a send without a session/body, and over the body limit", () => {
    expect(parseLiveChatWireClientMessage(JSON.stringify({ op: "send", text: "hi" }))).toMatchObject({
      op: "invalid",
    });
    expect(
      parseLiveChatWireClientMessage(JSON.stringify({ op: "send", sessionId: "s", text: "   " })),
    ).toMatchObject({ op: "invalid" });
    expect(
      parseLiveChatWireClientMessage(
        JSON.stringify({ op: "send", sessionId: "s", text: "x".repeat(LIVE_CHAT_MAX_BODY_LENGTH + 1) }),
      ),
    ).toMatchObject({ op: "invalid" });
  });

  it("refuses a leave without a session", () => {
    expect(parseLiveChatWireClientMessage(JSON.stringify({ op: "leave" }))).toMatchObject({
      op: "invalid",
    });
  });
});

describe("R37 the server-message encoding (the one transport encoding)", () => {
  it("round-trips every message shape through JSON", () => {
    const messages: LiveChatServerMessage[] = [
      {
        transport: "chat-joined",
        sessionId: "wfxlc_0001",
        externalRef: "fake:live-1",
        sourceStream: "scripted-dev-double",
        doubleBadge: "badge",
        viewerCount: 1247,
        slowModeMs: 5_000,
        pinned: null,
      },
      { event: "chat-message", entry: { id: "e1", author: "a", authorBadges: ["member"], body: "hi" } },
      { event: "chat-pinned", entry: null },
      { event: "viewer-count", count: 1250, provenance: "the double's report" },
      { transport: "chat-left", sessionId: "wfxlc_0001" },
      { transport: "refused", errorKind: "slow-mode", detail: "d", recovery: "r", waitMs: 3_000 },
    ];
    for (const message of messages) {
      expect(JSON.parse(encodeLiveChatServerMessage(message))).toEqual(message);
    }
  });
});

describe("R37 the dev chat double's committed script (the deterministic transcript)", () => {
  it("is deterministic committed data (fixed length, order, offsets)", () => {
    expect(DEV_LIVECHAT_SCRIPT.length).toBe(13);
    const offsets = DEV_LIVECHAT_SCRIPT.map((row) => row.atMs);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it("exercises the full badge vocabulary (member/moderator/verified-creator)", () => {
    const present = new Set(DEV_LIVECHAT_SCRIPT.flatMap((row) => [...row.entry.authorBadges]));
    for (const badge of DEV_LIVECHAT_SCRIPT_BADGES) {
      expect(present.has(badge)).toBe(true);
    }
  });

  it("carries exactly one scripted pin (the transport's pin event)", () => {
    expect(DEV_LIVECHAT_SCRIPT.filter((row) => row.pin === true).length).toBe(1);
  });

  it("carries emojis in bodies (the chat grammar's own vocabulary)", () => {
    const withEmoji = DEV_LIVECHAT_SCRIPT.filter((row) =>
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(row.entry.body),
    );
    expect(withEmoji.length).toBeGreaterThanOrEqual(6);
  });

  it("slices deterministically between offsets (the time-ordered relay)", () => {
    expect(devLiveChatScriptBetween(0, 1_000).map((row) => row.atMs)).toEqual([800]);
    expect(devLiveChatScriptBetween(5_000, 10_000).map((row) => row.atMs)).toEqual([6_000, 8_400]);
    expect(devLiveChatScriptBetween(29_000, 60_000)).toEqual([]);
  });

  it("answers nothing for a non-advancing interval", () => {
    expect(devLiveChatScriptBetween(10_000, 10_000)).toEqual([]);
    expect(devLiveChatScriptBetween(10_000, 5_000)).toEqual([]);
  });

  it("reports the deterministic viewer figures (the double's scripted report)", () => {
    expect(devLiveChatViewerCountAt(0)).toBe(DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN);
    expect(devLiveChatViewerCountAt(DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS - 1)).toBe(
      DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN,
    );
    expect(devLiveChatViewerCountAt(DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS)).toBe(
      DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN + 3,
    );
    expect(devLiveChatViewerCountAt(3 * DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS)).toBe(
      DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN + 9,
    );
  });

  it("declares the slow-mode interval the bridge enforces", () => {
    expect(DEV_LIVECHAT_SLOW_MODE_MS).toBe(5_000);
  });
});
