/**
 * @wfx/app-web — the R37 LIVE CHAT WIRE (the web lane's browser ↔
 * livechat-bridge transport, following the R25-D wire law verbatim).
 *
 * THE TRANSPORT LAW (§R25-D, adapted for live chat): Browser → WebFlix
 * WebSocket (the livechat bridge) → the session seam (the deterministic
 * dev chat double in the fixtures boot). NEVER: browser → any provider
 * with a credential. Every message is TYPED-WIRE VALIDATED at the bridge
 * boundary (`parseLiveChatWireClientMessage` — never a trusted cast; a
 * malformed message answers the typed `invalid` refusal, never a crash).
 *
 * THE HONEST-TRANSPORT LAW (R28, binding): every social number on the
 * live-chat surface renders only what this transport really carries —
 * the viewer count rides `chat-joined`/`viewer-count` events (the double's
 * own reported figure, provenance labeled); the badges ride the message
 * entries (the source-declared closed vocabulary); where the transport
 * carries no figure, the typed-absence state renders — never a
 * fabricated number, message, or badge.
 *
 * THE REPLAY SPLIT (the R37 artifact law): the archived live VOD's chat
 * replay is COMMITTED DATA read from the connector-layer log artifact —
 * it never touches this wire (an ended stream has no current chat; the
 * bridge refuses a join on an archived item with the typed `not-live`
 * refusal naming the replay as the honest alternative).
 *
 * The wire's own encoding: JSON text frames, exactly the R25-D envelope
 * split — the TRANSPORT messages (`chat-joined`, `chat-left`, `refused`)
 * are connection-management truths; the PRODUCT events (`chat-message`,
 * `chat-pinned`, `viewer-count`) are the chat grammar's own vocabulary.
 */

import type { LiveChatAuthorBadge } from "@wfx/connectors";

// ---------------------------------------------------------------------------
// The client → bridge messages (the operations)
// ---------------------------------------------------------------------------

/** `join` — join one live item's current chat. */
export interface LiveChatWireJoinMessage {
  readonly op: "join";
  /** The item's external ref (the fixture/live-catalog identity). */
  readonly externalRef: string;
}

/** `send` — post the viewer's own message into the joined chat. */
export interface LiveChatWireSendMessage {
  readonly op: "send";
  readonly sessionId: string;
  readonly text: string;
}

/** `leave` — leave the joined chat. */
export interface LiveChatWireLeaveMessage {
  readonly op: "leave";
  readonly sessionId: string;
}

/** The client → bridge message union. */
export type LiveChatWireClientMessage =
  | LiveChatWireJoinMessage
  | LiveChatWireSendMessage
  | LiveChatWireLeaveMessage;

/** The parsed/validated client message (the typed refusal carries the detail). */
export type ParsedLiveChatWireClientMessage =
  | LiveChatWireClientMessage
  | { readonly op: "invalid"; readonly detail: string };

/** The maximum chat body length the bridge accepts (the abuse floor). */
export const LIVE_CHAT_MAX_BODY_LENGTH = 500;

/** Parse + structurally validate one client wire message (the R25-D law). */
export function parseLiveChatWireClientMessage(raw: string): ParsedLiveChatWireClientMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { op: "invalid", detail: "the message is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { op: "invalid", detail: "the message is not an object" };
  }
  const message = parsed as Record<string, unknown>;
  const op = message["op"];
  const sessionId = typeof message["sessionId"] === "string" ? message["sessionId"] : null;
  if (op === "join") {
    const externalRef = message["externalRef"];
    if (typeof externalRef !== "string" || externalRef.length === 0) {
      return { op: "invalid", detail: "join: externalRef is required" };
    }
    return { op: "join", externalRef };
  }
  if (op === "send") {
    const text = message["text"];
    if (sessionId === null) {
      return { op: "invalid", detail: "send: sessionId is required" };
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      return { op: "invalid", detail: "send: text is required" };
    }
    if (text.length > LIVE_CHAT_MAX_BODY_LENGTH) {
      return { op: "invalid", detail: `send: text exceeds the ${LIVE_CHAT_MAX_BODY_LENGTH}-character limit` };
    }
    return { op: "send", sessionId, text };
  }
  if (op === "leave") {
    if (sessionId === null) {
      return { op: "invalid", detail: "leave: sessionId is required" };
    }
    return { op: "leave", sessionId };
  }
  return { op: "invalid", detail: `unknown operation '${String(op)}'` };
}

// ---------------------------------------------------------------------------
// The chat grammar's own entry shape (the product vocabulary)
// ---------------------------------------------------------------------------

/**
 * One chat message over the wire: the author identity, the source-declared
 * badges (the closed vocabulary), the body (the emoji grammar rides
 * verbatim), and `you` marking the viewer's OWN message (the honest
 * self-identity — the bridge mints it for the sending client only).
 */
export interface LiveChatWireEntry {
  /** The bridge's stable entry id (deterministic: `<sessionSeq>-<scriptIndex>`). */
  readonly id: string;
  readonly author: string;
  readonly authorBadges: readonly LiveChatAuthorBadge[];
  readonly body: string;
  readonly you?: boolean;
}

// ---------------------------------------------------------------------------
// The bridge → client messages (the transport envelope + the events)
// ---------------------------------------------------------------------------

/**
 * `chat-joined` — the transport ack for a joined chat: the session id +
 * the honest source-stream truth (`"scripted-dev-double"` in the fixtures
 * boot — loudly labeled) + the session's declared facts (the slow-mode
 * interval; the double's reported viewer figure at join, `null` when the
 * double carries none).
 */
export interface LiveChatTransportChatJoined {
  readonly transport: "chat-joined";
  readonly sessionId: string;
  readonly externalRef: string;
  readonly sourceStream: "scripted-dev-double";
  /** The loud dev-double badge sentence (rendered — never mistaken for a live provider). */
  readonly doubleBadge: string;
  /** The double's reported concurrent-viewer figure at join (null = the typed absence). */
  readonly viewerCount: number | null;
  /** The session's declared slow-mode interval (null = slow mode off). */
  readonly slowModeMs: number | null;
  /** The currently pinned message (null until a pin event arrives). */
  readonly pinned: LiveChatWireEntry | null;
}

/** `chat-message` — one chat message arriving (the product event). */
export interface LiveChatEventChatMessage {
  readonly event: "chat-message";
  readonly entry: LiveChatWireEntry;
}

/** `chat-pinned` — the pinned message changed (null unpins). */
export interface LiveChatEventChatPinned {
  readonly event: "chat-pinned";
  readonly entry: LiveChatWireEntry | null;
}

/**
 * `viewer-count` — the transport's carried viewer figure (the double's
 * scripted report; the provenance sentence rides every event so the
 * surface never mistakes the figure for a measured live count).
 */
export interface LiveChatEventViewerCount {
  readonly event: "viewer-count";
  readonly count: number;
  readonly provenance: string;
}

/** `chat-left` — the leave ack. */
export interface LiveChatTransportChatLeft {
  readonly transport: "chat-left";
  readonly sessionId: string;
}

/** The typed refusal kinds (the transport's own vocabulary). */
export type LiveChatRefusalKind =
  | "invalid"
  | "unknown-item"
  | "not-live"
  | "slow-mode"
  | "unknown-session"
  | "bridge-closed";

/** `refused` — the typed transport refusal (the no-dead-end law: the recovery sentence names the next action). */
export interface LiveChatTransportRefused {
  readonly transport: "refused";
  readonly errorKind: LiveChatRefusalKind;
  readonly detail: string;
  /** The useful next action (empty when none exists). */
  readonly recovery: string;
  /** The slow-mode wait (present iff the refusal is `slow-mode`). */
  readonly waitMs?: number;
}

/** The bridge → client message union. */
export type LiveChatServerMessage =
  | LiveChatTransportChatJoined
  | LiveChatEventChatMessage
  | LiveChatEventChatPinned
  | LiveChatEventViewerCount
  | LiveChatTransportChatLeft
  | LiveChatTransportRefused;

/** The wire's JSON encoding (the one transport encoding). */
export function encodeLiveChatServerMessage(message: LiveChatServerMessage): string {
  return JSON.stringify(message);
}
