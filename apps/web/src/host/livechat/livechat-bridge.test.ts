/**
 * R37 — the LIVE CHAT BRIDGE tests (the transport law over the REAL
 * machinery: the bridge + the dev chat double start on a private test
 * port and a REAL WebSocket client drives them — the join ack's honest
 * source-stream truth, the scripted message relay, the pin event, the
 * viewer-count report, the slow-mode refusal over the viewer's own
 * sends, the honest `not-live` refusal for archived VODs, and the
 * leave ack. The realtime-bridge test pattern (real servers, private
 * ports, no network beyond localhost).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  startLiveChatBridge,
  type LiveChatBridgeHandle,
  type LiveChatBridgeItemLookup,
} from "./livechat-bridge";
import type { LiveChatServerMessage } from "./livechat-wire";
import { DEV_LIVECHAT_SLOW_MODE_MS } from "./livechat-dev-double";

const BRIDGE_PORT = 3514;

/** The test item lookup (the fixtures boot's seam, driven directly). */
const TEST_ITEMS: LiveChatBridgeItemLookup = {
  item(externalRef) {
    if (externalRef === "fake:live-1") {
      return { title: "Signal Bloom", designation: { kind: "live", startedAt: null, viewerCount: 1247 } };
    }
    if (externalRef === "fake:live-vod-1") {
      return {
        title: "Aurora Nights",
        designation: { kind: "archived-live-vod", startedAt: null, endedAt: null },
      };
    }
    return null;
  },
  refs() {
    return ["fake:live-1", "fake:live-vod-1"];
  },
};

/** One browser-shaped WebSocket client against the test bridge. */
class TestChatClient {
  private socket: WebSocket | null = null;
  readonly received: LiveChatServerMessage[] = [];
  private readonly waiters: ((message: LiveChatServerMessage) => void)[] = [];

  async connect(): Promise<void> {
    const socket = new WebSocket(`ws://localhost:${BRIDGE_PORT}/`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("the test client could not connect")), {
        once: true,
      });
    });
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data) as LiveChatServerMessage;
      this.received.push(message);
      for (const waiter of [...this.waiters]) waiter(message);
    });
  }

  send(raw: string): void {
    this.socket?.send(raw);
  }

  /** Wait until a message matching the predicate arrives (bounded). */
  async waitFor(
    predicate: (message: LiveChatServerMessage) => boolean,
    timeoutMs: number,
  ): Promise<LiveChatServerMessage | null> {
    const already = this.received.find(predicate);
    if (already !== undefined) return already;
    return await new Promise<LiveChatServerMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(null);
      }, timeoutMs);
      const waiter = (message: LiveChatServerMessage): void => {
        if (predicate(message)) {
          clearTimeout(timer);
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          resolve(message);
        }
      };
      this.waiters.push(waiter);
    });
  }

  close(): void {
    this.socket?.close();
  }
}

describe("R37 the live chat bridge (the real transport over a private port)", () => {
  let bridge: LiveChatBridgeHandle | null = null;

  beforeEach(() => {
    bridge = null;
  });

  afterEach(async () => {
    await bridge?.stop();
    bridge = null;
  });

  it("starts, answers /health with the honest double badge, and stops", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const response = await fetch(`http://localhost:${BRIDGE_PORT}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      bridge: string;
      provider: { id: string; detail: string };
      serving: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.bridge).toBe("wfx-livechat-bridge");
    expect(body.provider.id).toBe("wfx-dev-livechat");
    expect(body.provider.detail).toContain("deterministic dev live-chat double");
    expect(body.serving).toEqual(["fake:live-1", "fake:live-vod-1"]);
  });

  it("the join round trip: the honest ack (the dev-double truth, the slow-mode fact, the reported figure)", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-1" }));
    const ack = await client.waitFor((m) => "transport" in m && m.transport === "chat-joined", 5_000);
    expect(ack).not.toBeNull();
    if (ack !== null && "transport" in ack && ack.transport === "chat-joined") {
      expect(ack.sourceStream).toBe("scripted-dev-double");
      expect(ack.doubleBadge).toContain("deterministic dev live-chat double");
      expect(ack.viewerCount).toBe(1247);
      expect(ack.slowModeMs).toBe(DEV_LIVECHAT_SLOW_MODE_MS);
      expect(ack.pinned).toBeNull();
      expect(ack.sessionId.startsWith("wfxlc_")).toBe(true);
    }
    client.close();
  });

  it("the scripted messages arrive on the timeline (badges + bodies verbatim, in order)", async () => {
    // Scale 4: the first three scripted offsets (0.8s/2.2s/4.1s) arrive
    // within ~1.1s of wall time — the same real machinery, compressed
    // (the realtime bridge's own test-compression precedent).
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS, scriptTimeScale: 4 });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-1" }));
    const first = await client.waitFor((m) => "event" in m && m.event === "chat-message", 5_000);
    expect(first).not.toBeNull();
    // Wait for at least three scripted messages (the deterministic timeline's
    // first ~5s of content: 800ms, 2200ms, 4100ms).
    const third = await client.waitFor(
      (m) =>
        "event" in m &&
        m.event === "chat-message" &&
        client.received.filter((x) => "event" in x && x.event === "chat-message").length >= 3,
      10_000,
    );
    expect(third).not.toBeNull();
    const messages = client.received
      .filter((m): m is Extract<LiveChatServerMessage, { event: "chat-message" }> => "event" in m && m.event === "chat-message")
      .map((m) => m.entry);
    expect(messages[0]?.author).toBe("mod_ana");
    expect(messages[0]?.authorBadges).toEqual(["moderator"]);
    expect(messages[0]?.body).toContain("Welcome to Signal Bloom live!");
    expect(messages[1]?.authorBadges).toEqual(["member"]);
    // The bodies carry the emoji grammar verbatim.
    expect(messages[1]?.body).toContain("🎉");
    client.close();
  });

  it("the pin event arrives at the scripted offset (the transport's own event)", async () => {
    // Scale 12: the 13s scripted pin arrives at ~1.1s of wall time.
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS, scriptTimeScale: 12 });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-1" }));
    const pin = await client.waitFor((m) => "event" in m && m.event === "chat-pinned", 20_000);
    expect(pin).not.toBeNull();
    if (pin !== null && "event" in pin && pin.event === "chat-pinned") {
      expect(pin.entry?.author).toBe("mod_ana");
      expect(pin.entry?.authorBadges).toEqual(["moderator"]);
      expect(pin.entry?.body).toContain("Rules:");
    }
    client.close();
  });

  it("the viewer-count report carries the double's figure + provenance", async () => {
    // Scale 12: the 15s report cadence arrives at ~1.25s of wall time.
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS, scriptTimeScale: 12 });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-1" }));
    const report = await client.waitFor((m) => "event" in m && m.event === "viewer-count", 20_000);
    expect(report).not.toBeNull();
    if (report !== null && "event" in report && report.event === "viewer-count") {
      expect(report.count).toBeGreaterThanOrEqual(1247);
      expect(report.provenance).toContain("dev chat double");
    }
    client.close();
  });

  it("slow mode: the second send inside the window answers the typed refusal with the wait", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-1" }));
    const ack = await client.waitFor((m) => "transport" in m && m.transport === "chat-joined", 5_000);
    expect(ack).not.toBeNull();
    const sessionId =
      ack !== null && "transport" in ack && ack.transport === "chat-joined" ? ack.sessionId : "";
    client.send(JSON.stringify({ op: "send", sessionId, text: "first message 🌸" }));
    const own = await client.waitFor(
      (m) => "event" in m && m.event === "chat-message" && m.entry.you === true,
      5_000,
    );
    expect(own).not.toBeNull();
    if (own !== null && "event" in own && own.event === "chat-message") {
      expect(own.entry.author).toBe("you");
      expect(own.entry.authorBadges).toEqual([]);
      expect(own.entry.body).toBe("first message 🌸");
    }
    // The second send lands INSIDE the slow-mode window.
    client.send(JSON.stringify({ op: "send", sessionId, text: "too soon" }));
    const refusal = await client.waitFor((m) => "transport" in m && m.transport === "refused", 5_000);
    expect(refusal).not.toBeNull();
    if (refusal !== null && "transport" in refusal && refusal.transport === "refused") {
      expect(refusal.errorKind).toBe("slow-mode");
      expect(refusal.waitMs).toBeGreaterThan(0);
      expect(refusal.waitMs).toBeLessThanOrEqual(DEV_LIVECHAT_SLOW_MODE_MS);
      expect(refusal.recovery.length).toBeGreaterThan(0);
    }
    client.close();
  });

  it("an archived live VOD answers the honest not-live refusal (the committed log is the replay's truth)", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-vod-1" }));
    const refusal = await client.waitFor((m) => "transport" in m && m.transport === "refused", 5_000);
    expect(refusal).not.toBeNull();
    if (refusal !== null && "transport" in refusal && refusal.transport === "refused") {
      expect(refusal.errorKind).toBe("not-live");
      expect(refusal.detail).toContain("archived live broadcast");
      expect(refusal.detail).toContain("committed log");
    }
    client.close();
  });

  it("an unknown item answers the honest unknown-item refusal", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:not-live" }));
    const refusal = await client.waitFor((m) => "transport" in m && m.transport === "refused", 5_000);
    expect(refusal !== null && "transport" in refusal && refusal.transport === "refused" && refusal.errorKind === "unknown-item").toBe(true);
    client.close();
  });

  it("a malformed wire message answers the typed invalid refusal (never a crash)", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const client = new TestChatClient();
    await client.connect();
    client.send("this is not json");
    const refusal = await client.waitFor((m) => "transport" in m && m.transport === "refused", 5_000);
    expect(refusal !== null && "transport" in refusal && refusal.transport === "refused" && refusal.errorKind === "invalid").toBe(true);
    client.send(JSON.stringify({ op: "join" }));
    const second = await client.waitFor(
      (m) => "transport" in m && m.transport === "refused" && m.errorKind === "invalid",
      5_000,
    );
    expect(second).not.toBeNull();
    client.close();
  });

  it("the leave round trip answers the chat-left ack", async () => {
    bridge = startLiveChatBridge({ port: BRIDGE_PORT, items: TEST_ITEMS });
    const client = new TestChatClient();
    await client.connect();
    client.send(JSON.stringify({ op: "join", externalRef: "fake:live-1" }));
    const ack = await client.waitFor((m) => "transport" in m && m.transport === "chat-joined", 5_000);
    const sessionId =
      ack !== null && "transport" in ack && ack.transport === "chat-joined" ? ack.sessionId : "";
    client.send(JSON.stringify({ op: "leave", sessionId }));
    const left = await client.waitFor((m) => "transport" in m && m.transport === "chat-left", 5_000);
    expect(left).not.toBeNull();
    // A session that ended answers the honest unknown-session refusal.
    client.send(JSON.stringify({ op: "send", sessionId, text: "after the end" }));
    const refusal = await client.waitFor(
      (m) => "transport" in m && m.transport === "refused" && m.errorKind === "unknown-session",
      5_000,
    );
    expect(refusal).not.toBeNull();
    client.close();
  });
});
