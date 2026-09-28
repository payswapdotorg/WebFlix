/**
 * @wfx/app-web — the R37 WEBFLIX LIVE CHAT BRIDGE (the web lane's
 * live-chat WebSocket transport — the R25-D bridge pattern, followed
 * law for law).
 *
 * THE TRANSPORT LAW (§R25-D, adapted): Browser → WebFlix WebSocket (this
 * bridge) → the session seam (the deterministic dev chat double in the
 * fixtures boot). NEVER: browser → any provider with a credential.
 *
 * The bridge owns (the realtime bridge's own ownership list, adapted):
 * - typed wire validation (`parseLiveChatWireClientMessage` — the
 *   operations are a closed set, never a trusted cast);
 * - the chat session lifecycle (join → the scripted stream relay →
 *   leave; the slow-mode enforcement over the viewer's own sends — a
 *   REAL transport behavior with the typed refusal carrying the wait);
 * - the honest refusals: an unknown item (`unknown-item`), an archived
 *   live VOD (`not-live` — the committed log artifact is the replay's
 *   truth, never a stream capture), the wire-level `invalid`;
 * - the viewer-count report (the double's own reported figure, the
 *   provenance sentence riding every event — the honest-transport law).
 *
 * NO RETENTION: the live chat is relayed, never stored (the R25-D
 * persistence law — the bridge persists nothing; the replay's data of
 * record is the COMMITTED connector-layer log artifact, not a capture of
 * this stream).
 *
 * The /health route (the bridge's identity seam): the bridge id + the
 * double badge + the item refs the injected lookup serves — the
 * journey's transport-truth read.
 */

import { createServer, type Server as HttpServer } from "node:http";

import { WebSocket as WsServerSocket, WebSocketServer } from "ws";

import type { LiveDesignation } from "@wfx/connectors";

import {
  encodeLiveChatServerMessage,
  type LiveChatServerMessage,
  type LiveChatWireEntry,
} from "./livechat-wire";
import { parseLiveChatWireClientMessage } from "./livechat-wire";
import {
  DEV_LIVECHAT_DOUBLE_BADGE,
  DEV_LIVECHAT_DOUBLE_ID,
  DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN,
  DEV_LIVECHAT_SLOW_MODE_MS,
  DEV_LIVECHAT_VIEWER_PROVENANCE,
  DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS,
  devLiveChatScriptBetween,
  devLiveChatViewerCountAt,
} from "./livechat-dev-double";
import { setLiveChatBridgeStatus } from "./livechat-bridge-state";

// ---------------------------------------------------------------------------
// The bridge's constants + the injected seams
// ---------------------------------------------------------------------------

/** The default livechat bridge port (the R25-D port sequence's next free: 3101 web, 3102 realtime, 3103 dev provider). */
export const LIVECHAT_BRIDGE_DEFAULT_PORT = 3104;

/** The dev double's script-pump interval (the emission cadence). */
const SCRIPT_PUMP_INTERVAL_MS = 400;

/** The item's presentation facts the fixtures boot injects. */
export interface LiveChatBridgeItem {
  readonly title: string;
  readonly designation: LiveDesignation;
}

/**
 * The item lookup seam (which external refs the double serves). The
 * fixtures boot injects the live fixture entries' reader; absent → the
 * bridge answers every join with the honest `unknown-item` refusal
 * (never a fabricated chat).
 */
export interface LiveChatBridgeItemLookup {
  item(externalRef: string): LiveChatBridgeItem | null;
  /** The refs the lookup serves (the /health truth — the honest set, never a hardcoded list). */
  refs(): readonly string[];
}

/** The options for {@link startLiveChatBridge}. */
export interface LiveChatBridgeOptions {
  /** The fixed port (default 3104). */
  readonly port?: number;
  /** The item lookup seam (the fixtures boot injects the live catalog's reader). */
  readonly items?: LiveChatBridgeItemLookup | null;
  /** Allowed browser origins for the WS upgrade (absent Origin headers — non-browser tooling — pass). */
  readonly allowedOrigins?: readonly string[];
  /** The slow-mode interval the double enforces (tests may compress it). */
  readonly slowModeMs?: number;
  /**
   * The script timeline's time scale (default 1 — real time). Tests may
   * COMPRESS the deterministic timeline (the realtime bridge's
   * `clientBlipAfterMs` compression precedent): the double's scripted
   * offsets divide by this factor, so a 13s pin at scale 10 arrives at
   * 1.3s — the same real machinery, the same ordering, a faster test.
   */
  readonly scriptTimeScale?: number;
}

/** The running bridge handle. */
export interface LiveChatBridgeHandle {
  readonly port: number;
  readonly url: string;
  readonly providerId: string;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// The session record
// ---------------------------------------------------------------------------

/** One joined chat session (the bridge's per-connection truth). */
interface ChatSession {
  readonly sessionId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly joinedAtMs: number;
  /** The bound client socket (null after the socket's close). */
  client: WsServerSocket | null;
  /** The last accepted viewer send (the slow-mode window's start). */
  lastAcceptedSendAtMs: number | null;
  /** The script cursor (every entry with atMs ≤ cursor has been relayed). */
  relayedThroughMs: number;
  /** The currently pinned entry (null until a pin event). */
  pinned: LiveChatWireEntry | null;
  pumpTimer: ReturnType<typeof setInterval> | null;
  reportTimer: ReturnType<typeof setInterval> | null;
  ended: boolean;
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/**
 * Start the WebFlix live chat bridge (one per port — idempotent through
 * the boot module's process-global guard; the one-bridge law).
 */
export function startLiveChatBridge(options: LiveChatBridgeOptions = {}): LiveChatBridgeHandle {
  const port = options.port ?? LIVECHAT_BRIDGE_DEFAULT_PORT;
  const allowedOrigins =
    options.allowedOrigins ?? ["http://localhost:3101", "http://127.0.0.1:3101"];
  const slowModeMs = options.slowModeMs ?? DEV_LIVECHAT_SLOW_MODE_MS;
  const scriptTimeScale = options.scriptTimeScale ?? 1;
  const items = options.items ?? null;

  const sessions = new Map<string, ChatSession>();
  /** The per-socket routing state (ws → the bound session id). */
  const socketSessions = new WeakMap<WsServerSocket, string | null>();
  let sessionCounter = 0;

  /** Send one server message to a session's client (a dead socket is never a crash). */
  const send = (session: ChatSession, message: LiveChatServerMessage): void => {
    if (session.client === null || session.client.readyState !== WsServerSocket.OPEN) return;
    try {
      session.client.send(encodeLiveChatServerMessage(message));
    } catch {
      // The disconnect path's business.
    }
  };

  /** Close one session (the single end path; the leave ack answers when the client asked). */
  const closeSession = (session: ChatSession, left: boolean): void => {
    if (session.ended) return;
    session.ended = true;
    if (session.pumpTimer !== null) clearInterval(session.pumpTimer);
    if (session.reportTimer !== null) clearInterval(session.reportTimer);
    if (left) {
      send(session, { transport: "chat-left", sessionId: session.sessionId });
    }
    session.client = null;
    sessions.delete(session.sessionId);
  };

  /** The script pump: relay the entries whose offsets have come due (+ the pin event when one pins). */
  const pumpScript = (session: ChatSession): void => {
    const elapsed = (Date.now() - session.joinedAtMs) * scriptTimeScale;
    const due = devLiveChatScriptBetween(session.relayedThroughMs, elapsed);
    for (const row of due) {
      const entry: LiveChatWireEntry = {
        id: `${session.sessionId}-s${row.atMs}`,
        author: row.entry.author,
        authorBadges: [...row.entry.authorBadges],
        body: row.entry.body,
        ...(row.entry.you === true ? { you: true } : {}),
      };
      send(session, { event: "chat-message", entry });
      if (row.pin === true) {
        session.pinned = entry;
        send(session, { event: "chat-pinned", entry });
      }
      session.relayedThroughMs = row.atMs;
    }
  };

  const httpServer: HttpServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/health") {
      // The bridge's identity seam (the double badge rides it — loudly).
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          bridge: "wfx-livechat-bridge",
          port,
          provider: { id: DEV_LIVECHAT_DOUBLE_ID, detail: DEV_LIVECHAT_DOUBLE_BADGE },
          serving: items === null ? [] : [...items.refs()],
          sessions: sessions.size,
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  // THE WEBSOCKET UPGRADE (the browser's lane — origin-checked, the R25-D law).
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    if (url.pathname !== "/") {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      socketSessions.set(ws, null);
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WsServerSocket) => {
    // Nothing on open — the first message binds the connection.
    ws.on("message", (data: unknown) => {
      const message =
        typeof data === "string" ? data : Buffer.from(data as ArrayBufferLike).toString("utf8");
      handleMessage(ws, message);
    });
    ws.on("close", () => {
      const bound = socketSessions.get(ws);
      if (bound === undefined || bound === null) return;
      const session = sessions.get(bound);
      if (session !== undefined && session.client === ws) {
        closeSession(session, false);
      }
    });
  });

  /** The bridge's client-message handler (the typed-wire dispatch). */
  const handleMessage = (ws: WsServerSocket, message: string): void => {
    const parsed = parseLiveChatWireClientMessage(message);
    if (parsed.op === "invalid") {
      ws.send(
        encodeLiveChatServerMessage({
          transport: "refused",
          errorKind: "invalid",
          detail: parsed.detail,
          recovery: "",
        }),
      );
      return;
    }
    if (parsed.op === "join") {
      // THE ITEM GATE (the honest refusals before any session exists).
      const known = items?.item(parsed.externalRef) ?? null;
      if (known === null) {
        ws.send(
          encodeLiveChatServerMessage({
            transport: "refused",
            errorKind: "unknown-item",
            detail: `no live item '${parsed.externalRef}' is known on this host`,
            recovery: "Open the live browse (/live) and choose a live stream.",
          }),
        );
        return;
      }
      const designation = known.designation;
      if (designation.kind !== "live") {
        ws.send(
          encodeLiveChatServerMessage({
            transport: "refused",
            errorKind: "not-live",
            detail:
              designation.kind === "archived-live-vod"
                ? `'${parsed.externalRef}' is an archived live broadcast — its chat replays from the committed log, timed to the playback position (a current chat is never streamed for an ended broadcast)`
                : `'${parsed.externalRef}' is not a live item`,
            recovery: "Watch the archived broadcast — its chat replay follows the playback position.",
          }),
        );
        return;
      }
      sessionCounter += 1;
      const sessionId = `wfxlc_${String(sessionCounter).padStart(4, "0")}`;
      const session: ChatSession = {
        sessionId,
        externalRef: parsed.externalRef,
        title: known.title,
        joinedAtMs: Date.now(),
        client: ws,
        lastAcceptedSendAtMs: null,
        relayedThroughMs: 0,
        pinned: null,
        pumpTimer: null,
        reportTimer: null,
        ended: false,
      };
      sessions.set(sessionId, session);
      socketSessions.set(ws, sessionId);
      // THE TRANSPORT ACK (the honest source-stream truth + the session facts).
      send(session, {
        transport: "chat-joined",
        sessionId,
        externalRef: parsed.externalRef,
        sourceStream: "scripted-dev-double",
        doubleBadge: DEV_LIVECHAT_DOUBLE_BADGE,
        viewerCount: DEV_LIVECHAT_REPORTED_VIEWERS_AT_JOIN,
        slowModeMs,
        pinned: null,
      });
      // The script pump (the deterministic emission timeline).
      session.pumpTimer = setInterval(() => {
        if (session.ended) return;
        pumpScript(session);
      }, SCRIPT_PUMP_INTERVAL_MS);
      // The viewer-count report cadence (the double's scripted report —
      // the report interval compresses with the same test scale).
      session.reportTimer = setInterval(() => {
        if (session.ended) return;
        send(session, {
          event: "viewer-count",
          count: devLiveChatViewerCountAt((Date.now() - session.joinedAtMs) * scriptTimeScale),
          provenance: DEV_LIVECHAT_VIEWER_PROVENANCE,
        });
      }, Math.max(200, DEV_LIVECHAT_VIEWER_REPORT_INTERVAL_MS / scriptTimeScale));
      return;
    }
    const session = sessions.get(parsed.sessionId);
    if (session === undefined || session.ended) {
      ws.send(
        encodeLiveChatServerMessage({
          transport: "refused",
          errorKind: "unknown-session",
          detail: "this live chat session is unknown or ended",
          recovery: "Join the live chat again.",
        }),
      );
      return;
    }
    if (parsed.op === "leave") {
      closeSession(session, true);
      return;
    }
    if (parsed.op === "send") {
      // THE SLOW-MODE ENFORCEMENT (a real transport behavior — the typed
      // refusal carries the remaining wait).
      if (slowModeMs > 0 && session.lastAcceptedSendAtMs !== null) {
        const waited = Date.now() - session.lastAcceptedSendAtMs;
        if (waited < slowModeMs) {
          ws.send(
            encodeLiveChatServerMessage({
              transport: "refused",
              errorKind: "slow-mode",
              detail: `slow mode is on (${Math.round(slowModeMs / 1000)}s between messages) — send again in a moment`,
              recovery: "Your message is not lost — send it again after the wait.",
              waitMs: slowModeMs - waited,
            }),
          );
          return;
        }
      }
      // The viewer's own message: the bridge relays it with the honest
      // self-identity (the accountless chat — the anonymous law).
      const sentAt = Date.now();
      session.lastAcceptedSendAtMs = sentAt;
      send(session, {
        event: "chat-message",
        entry: {
          id: `${session.sessionId}-you-${sentAt}`,
          author: "you",
          authorBadges: [],
          body: parsed.text,
          you: true,
        },
      });
      return;
    }
  };

  httpServer.listen(port);

  setLiveChatBridgeStatus({
    running: true,
    port,
    provider: { id: DEV_LIVECHAT_DOUBLE_ID, detail: DEV_LIVECHAT_DOUBLE_BADGE },
  });

  return {
    port,
    url: `ws://localhost:${port}`,
    providerId: DEV_LIVECHAT_DOUBLE_ID,
    stop: async (): Promise<void> => {
      for (const session of [...sessions.values()]) {
        closeSession(session, false);
      }
      sessions.clear();
      // Terminate the live sockets first (an open WebSocket keeps the
      // http server's close from completing — the realtime bridge's law).
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        setTimeout(resolve, 500).unref?.();
      });
      setLiveChatBridgeStatus({ running: false, port: null, provider: null });
    },
  };
}
