"use client";

/**
 * @wfx/app-web — R37 — THE LIVE CHAT CLIENT (the browser side of the WS
 * seam — the realtime-session-client.ts law, followed for live chat).
 *
 * THE TRANSPORT LAW: the browser talks ONLY to the WebFlix livechat
 * bridge (the server-rendered bridge URL — no provider endpoint ever
 * reaches the client). The wire is validated on arrival (the closed
 * vocabulary — an unknown shape is ignored, never a trusted cast).
 *
 * THE HONEST-TRANSPORT LAW: the client state carries only what the
 * transport really delivered — the joined session (or the typed
 * refusal), the relayed messages (never a fabricated one), the pinned
 * entry, the viewer figure with its provenance, the slow-mode interval,
 * and the double's loud badge. A missing bridge answers the honest
 * `unavailable` state (never a spinner, never a fake chat).
 *
 * THE OBSERVATION RECORD (the J43 `window.__wfxRealtimeTelemetry`
 * precedent): `window.__wfxLiveChatState` exposes the product's own
 * observation — the bridge URL, the message count, the last viewer
 * figure, the refusals seen — for the journeys' honest assertions.
 */

import { useEffect, useRef, useState, type JSX } from "react";

import type { LiveChatAuthorBadge } from "@wfx/connectors";

import type {
  LiveChatWireEntry,
  LiveChatServerMessage,
} from "@/host/livechat/livechat-wire";

/** The client island's serialized props (the server view's truth). */
export interface LiveChatIslandProps {
  /** The item the chat joins (the external ref). */
  readonly externalRef: string;
  /** The bridge's WebSocket URL (empty = the bridge is not serving — the honest state). */
  readonly bridgeUrl: string;
  /** The loud dev-double badge sentence (rendered in the panel). */
  readonly doubleBadge: string;
  /** The source-reported viewer figure at SSR (the pill's pre-join truth). */
  readonly initialViewerCount: number | null;
}

/** The typed client state (every field is transport-delivered truth). */
interface LiveChatClientState {
  readonly phase: "unavailable" | "connecting" | "live" | "refused";
  readonly sessionId: string | null;
  readonly entries: readonly LiveChatWireEntry[];
  readonly pinned: LiveChatWireEntry | null;
  readonly viewerCount: number | null;
  readonly viewerProvenance: string | null;
  readonly slowModeMs: number | null;
  readonly refusal: { readonly errorKind: string; readonly detail: string; readonly recovery: string } | null;
}

/** The observation record the journeys read (the product's own observation). */
interface LiveChatObservation {
  bridgeUrl: string | null;
  sessionId: string | null;
  messages: number;
  lastViewerCount: number | null;
  slowModeRefusals: number;
  lastRefusal: string | null;
}

declare global {
  interface Window {
    __wfxLiveChatState?: LiveChatObservation;
  }
}

/** The badge chip (the closed vocabulary — color always paired with the label). */
function BadgeChip({ badge }: { readonly badge: LiveChatAuthorBadge }): JSX.Element {
  const tone =
    badge === "member" ? "member" : badge === "moderator" ? "moderator" : "verified";
  const label = badge === "verified-creator" ? "Verified" : badge === "moderator" ? "Moderator" : "Member";
  return (
    <span className={`wfx-livechat__badge wfx-livechat__badge--${tone}`} data-wfx-livechat-badge={badge}>
      {label}
    </span>
  );
}

/** One chat line (the author + badges + the body — the emoji grammar rides verbatim). */
function ChatLine({ entry }: { readonly entry: LiveChatWireEntry }): JSX.Element {
  return (
    <div
      className={`wfx-livechat__entry${entry.you === true ? " wfx-livechat__entry--you" : ""}`}
      data-wfx-livechat-entry
      {...(entry.you === true ? { "data-wfx-livechat-entry-you": "true" } : {})}
    >
      {entry.authorBadges.map((badge) => (
        <BadgeChip key={badge} badge={badge} />
      ))}
      <span className="wfx-livechat__author" data-wfx-livechat-author>
        {entry.you === true ? "you" : entry.author}
      </span>
      <span data-wfx-livechat-body>{entry.body}</span>
    </div>
  );
}

/** The emoji row's vocabulary (the composer's real insert affordance). */
const COMPOSER_EMOJIS = ["🌸", "🎉", "✨", "🌙", "💚", "🔥"] as const;

/** The live chat island (client — the WS seam's browser side). */
export function LiveChat({
  externalRef,
  bridgeUrl,
  doubleBadge,
  initialViewerCount,
}: LiveChatIslandProps): JSX.Element {
  const [state, setState] = useState<LiveChatClientState>({
    phase: bridgeUrl.length > 0 ? "connecting" : "unavailable",
    sessionId: null,
    entries: [],
    pinned: null,
    viewerCount: initialViewerCount,
    viewerProvenance: null,
    slowModeMs: null,
    refusal: null,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const lastSendAtRef = useRef<number | null>(null);
  const slowModeRefusalsRef = useRef(0);
  const [draft, setDraft] = useState("");

  // THE TRANSPORT (the one connection; the browser never reaches a provider).
  useEffect(() => {
    if (bridgeUrl.length === 0) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(bridgeUrl);
    } catch {
      setState((current) => ({ ...current, phase: "unavailable" }));
      return;
    }
    socketRef.current = socket;
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ op: "join", externalRef }));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const message = parsed as LiveChatServerMessage;
      if ("transport" in message && message.transport === "chat-joined") {
        setState((current) => ({
          ...current,
          phase: "live",
          sessionId: message.sessionId,
          viewerCount: message.viewerCount,
          slowModeMs: message.slowModeMs,
          pinned: message.pinned,
          refusal: null,
        }));
        window.__wfxLiveChatState = {
          bridgeUrl,
          sessionId: message.sessionId,
          messages: 0,
          lastViewerCount: message.viewerCount,
          slowModeRefusals: 0,
          lastRefusal: null,
        };
        return;
      }
      if ("transport" in message && message.transport === "refused") {
        if (message.errorKind === "slow-mode") {
          slowModeRefusalsRef.current += 1;
        }
        setState((current) => ({
          ...current,
          phase: current.phase === "live" ? "live" : "refused",
          refusal: { errorKind: message.errorKind, detail: message.detail, recovery: message.recovery },
        }));
        if (window.__wfxLiveChatState !== undefined) {
          window.__wfxLiveChatState = {
            ...window.__wfxLiveChatState,
            slowModeRefusals: slowModeRefusalsRef.current,
            lastRefusal: message.errorKind,
          };
        }
        return;
      }
      if ("transport" in message && message.transport === "chat-left") {
        setState((current) => ({ ...current, phase: "refused", sessionId: null }));
        return;
      }
      if ("event" in message && message.event === "chat-message") {
        setState((current) => ({
          ...current,
          entries: [...current.entries, message.entry].slice(-200),
        }));
        if (window.__wfxLiveChatState !== undefined) {
          window.__wfxLiveChatState = { ...window.__wfxLiveChatState, messages: (window.__wfxLiveChatState.messages ?? 0) + 1 };
        }
        return;
      }
      if ("event" in message && message.event === "chat-pinned") {
        setState((current) => ({ ...current, pinned: message.entry }));
        return;
      }
      if ("event" in message && message.event === "viewer-count") {
        setState((current) => ({
          ...current,
          viewerCount: message.count,
          viewerProvenance: message.provenance,
        }));
        if (window.__wfxLiveChatState !== undefined) {
          window.__wfxLiveChatState = { ...window.__wfxLiveChatState, lastViewerCount: message.count };
        }
        return;
      }
      // An unknown shape is ignored (the closed vocabulary — never a cast).
    });
    socket.addEventListener("close", () => {
      setState((current) =>
        current.phase === "live"
          ? { ...current, phase: "refused", sessionId: null, refusal: { errorKind: "bridge-closed", detail: "the live chat connection closed", recovery: "Reload to rejoin the chat." } }
          : current,
      );
    });
    return () => {
      try {
        socket.close();
      } catch {
        // The unmount path's business.
      }
      socketRef.current = null;
    };
  }, [bridgeUrl, externalRef]);

  /** The send path (the viewer's own message — the accountless chat). */
  const sendDraft = (): void => {
    const socket = socketRef.current;
    const text = draft.trim();
    if (socket === null || socket.readyState !== WebSocket.OPEN || text.length === 0 || state.sessionId === null) {
      return;
    }
    socket.send(JSON.stringify({ op: "send", sessionId: state.sessionId, text }));
    lastSendAtRef.current = Date.now();
    setDraft("");
  };

  // The honest unavailable state (the bridge is not serving on this boot).
  if (state.phase === "unavailable") {
    return (
      <div className="wfx-livechat" data-wfx-livechat data-wfx-livechat-state="unavailable">
        <div className="wfx-livechat__head">
          <p className="wfx-livechat__title">Live chat</p>
        </div>
        <p className="wfx-livechat__state" data-wfx-livechat-unavailable>
          Live chat is not serving on this boot — the live stream plays normally, and the chat
          stays honestly absent rather than simulated.
        </p>
      </div>
    );
  }

  return (
    <div className="wfx-livechat" data-wfx-livechat data-wfx-livechat-state={state.phase}>
      <div className="wfx-livechat__head">
        <p className="wfx-livechat__title" data-wfx-livechat-title>
          Live chat
        </p>
        <span
          className="wfx-liveviewers"
          data-wfx-livechat-viewers={state.viewerCount === null ? "absent" : String(state.viewerCount)}
          title={state.viewerProvenance ?? "the source's reported concurrent viewers"}
        >
          {state.viewerCount === null ? "—" : `${state.viewerCount.toLocaleString("en-US")} watching`}
        </span>
      </div>

      {/* THE PINNED MESSAGE (the transport's own pin event — never fabricated). */}
      {state.pinned !== null ? (
        <div className="wfx-livechat__pinned" data-wfx-livechat-pinned>
          <span className="wfx-livechat__pinned-label">Pinned</span>
          <span>
            <strong>{state.pinned.author}</strong>: {state.pinned.body}
          </span>
        </div>
      ) : null}

      {/* THE MESSAGE LIST (the relayed truth). */}
      <div className="wfx-livechat__list" data-wfx-livechat-list>
        {state.entries.length === 0 ? (
          <p className="wfx-livechat__state" data-wfx-livechat-empty>
            Joining the chat…
          </p>
        ) : (
          state.entries.map((entry) => <ChatLine key={entry.id} entry={entry} />)
        )}
      </div>

      {/* THE COMPOSER (the slow-mode truth + the emoji row + the send). */}
      <div className="wfx-livechat__composer">
        {state.slowModeMs !== null && state.slowModeMs > 0 ? (
          <p className="wfx-livechat__slowmode" data-wfx-livechat-slowmode>
            Slow mode: {Math.round(state.slowModeMs / 1000)}s between messages.
          </p>
        ) : null}
        {state.refusal !== null ? (
          <p className="wfx-livechat__refusal" data-wfx-livechat-refusal={state.refusal.errorKind}>
            {state.refusal.detail} {state.refusal.recovery}
          </p>
        ) : null}
        <div className="wfx-livechat__emojis" data-wfx-livechat-emojis aria-label="Insert an emoji">
          {COMPOSER_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="wfx-livechat__emoji"
              data-wfx-livechat-emoji={emoji}
              onClick={() => setDraft((current) => `${current}${emoji}`)}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="wfx-livechat__row">
          <input
            className="wfx-livechat__input"
            data-wfx-livechat-input
            type="text"
            value={draft}
            maxLength={500}
            placeholder={state.phase === "live" ? "Say something…" : "Joining…"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendDraft();
              }
            }}
          />
          <button
            type="button"
            className="wfx-livechat__send"
            data-wfx-livechat-send
            disabled={state.phase !== "live" || draft.trim().length === 0}
            onClick={sendDraft}
          >
            Send
          </button>
        </div>
        {/* The loud dev-double badge (never mistaken for a live provider). */}
        <p className="wfx-livechat__double" data-wfx-livechat-double>
          {doubleBadge}.
        </p>
      </div>
    </div>
  );
}
