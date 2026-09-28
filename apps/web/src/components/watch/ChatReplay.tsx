"use client";

/**
 * @wfx/app-web — R37 — THE CHAT REPLAY island (the archived live VOD's
 * committed-log replay, timed to the playhead).
 *
 * THE ARTIFACT LAW: the replay reads the COMMITTED log (the connector
 * layer's `LiveChatLog`, server-parsed and passed down) — never a stream
 * capture, never a live transport. An ended broadcast's chat replays
 * from its data of record; the surface states this truth plainly.
 *
 * THE PLAYHEAD BINDING: the replay clock is the surface's own position
 * control (play/pause + the scrub bar over the VOD's declared duration).
 * The fixture embed carries no real position (the honest unbound stage
 * truth — the same absence the shorts stage renders when the provider
 * never answers), so the REPLAY POSITION is this control's truth,
 * honestly labeled: scrub → the chat window follows (`liveChatWindowAt`,
 * the connector layer's pure derivation); play → the clock advances and
 * the messages arrive in TIME ORDER from the committed log.
 *
 * THE ARCHIVED TRUTHS: the pinned message stands from its own offset
 * onward (`liveChatPinnedAt`), the slow-mode fact renders in the past
 * tense (it WAS active — a recorded session fact, never a live rule),
 * and the "archived log — never a live stream" sentence rides the head.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import type { LiveChatLog, LiveChatLogEntry } from "@wfx/connectors";
import { liveChatEntriesBetween, liveChatPinnedAt, liveChatWindowAt } from "@wfx/connectors";

import { formatPosition } from "@/components/ui/format";
import "../live/live.css";

/** The replay window's span (the entries visible around the playhead). */
const REPLAY_WINDOW_MS = 30_000;

/** The island's serialized props (the committed log + the VOD's facts). */
export interface ChatReplayIslandProps {
  /** The committed chat log (validated at the boundary — the replay's data of record). */
  readonly log: LiveChatLog;
  /** The VOD's declared duration (ms — the scrub bar's range). */
  readonly durationMs: number;
}

/** One replay line (the committed entry's own rendering). */
function ReplayLine({ entry }: { readonly entry: LiveChatLogEntry }): JSX.Element {
  return (
    <div
      className={`wfx-livechat__entry${entry.you === true ? " wfx-livechat__entry--you" : ""}`}
      data-wfx-chatreplay-entry
      data-wfx-chatreplay-offset={String(entry.offsetMs)}
      {...(entry.you === true ? { "data-wfx-chatreplay-entry-you": "true" } : {})}
    >
      {entry.authorBadges.map((badge) => (
        <span key={badge} className={`wfx-livechat__badge wfx-livechat__badge--${badge === "verified-creator" ? "verified" : badge}`} data-wfx-livechat-badge={badge}>
          {badge === "verified-creator" ? "Verified" : badge === "moderator" ? "Moderator" : "Member"}
        </span>
      ))}
      <span className="wfx-livechat__author" data-wfx-livechat-author>
        {entry.you === true ? "you" : entry.author}
      </span>
      <span data-wfx-livechat-body>{entry.body}</span>
    </div>
  );
}

/** The chat replay island (client — the committed-log playhead binding). */
export function ChatReplay({ log, durationMs }: ChatReplayIslandProps): JSX.Element {
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [arrivalCount, setArrivalCount] = useState(0);
  const positionRef = useRef(0);
  positionRef.current = positionMs;

  // THE PLAY CLOCK (1× — the surface's own replay control).
  useEffect(() => {
    if (!playing) return;
    const startedAt = Date.now();
    const from = positionRef.current;
    const timer = setInterval(() => {
      const next = Math.min(durationMs, from + (Date.now() - startedAt));
      setPositionMs(next);
      if (next >= durationMs) setPlaying(false);
    }, 250);
    return () => clearInterval(timer);
  }, [playing, durationMs]);

  // THE PLAYHEAD BINDING (the connector layer's pure derivation — scrub
  // → the window follows; the arrival count proves the time-ordered flow:
  // every entry whose offset the clock has passed has ARRIVED).
  useEffect(() => {
    setArrivalCount((current) => Math.max(current, liveChatEntriesBetween(log, 0, positionMs).length));
  }, [positionMs, log]);

  const windowEntries = useMemo(
    () => liveChatWindowAt(log, positionMs, REPLAY_WINDOW_MS),
    [log, positionMs],
  );
  const pinned = useMemo(() => liveChatPinnedAt(log, positionMs), [log, positionMs]);

  const scrub = (next: number): void => {
    setPlaying(false);
    setPositionMs(Math.max(0, Math.min(durationMs, next)));
  };

  return (
    <div className="wfx-livechat" data-wfx-chatreplay data-wfx-chatreplay-state={playing ? "playing" : "paused"}>
      <div className="wfx-chatreplay__head">
        <p className="wfx-livechat__title" data-wfx-chatreplay-title>
          Chat replay
        </p>
        <span className="wfx-chatreplay__clock" data-wfx-chatreplay-clock>
          {formatPosition(positionMs)} / {formatPosition(durationMs)}
        </span>
        <input
          type="range"
          className="wfx-chatreplay__scrub"
          data-wfx-chatreplay-scrub
          min={0}
          max={durationMs}
          step={1000}
          value={positionMs}
          aria-label="The replay position"
          onChange={(event) => scrub(Number(event.target.value))}
        />
        <button
          type="button"
          className="wfx-chatreplay__play"
          data-wfx-chatreplay-play={playing ? "pause" : "play"}
          onClick={() => {
            if (positionMs >= durationMs) scrub(0);
            setPlaying((current) => !current);
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>
      <p className="wfx-chatreplay__truth" data-wfx-chatreplay-truth>
        Chat replay — the archived live chat, timed to the video position (a committed log,
        never a live stream).
      </p>
      <p className="wfx-chatreplay__facts" data-wfx-chatreplay-facts>
        {log.slowModeMs !== null && log.slowModeMs > 0
          ? `Slow mode (${Math.round(log.slowModeMs / 1000)}s) was on during this stream. `
          : ""}
        {log.entries.length} archived messages{arrivalCount > 0 ? ` — ${arrivalCount} replayed so far` : ""}.
      </p>

      {/* THE ARCHIVED PIN (stands from its own offset onward). */}
      {pinned !== null ? (
        <div className="wfx-livechat__pinned" data-wfx-chatreplay-pinned>
          <span className="wfx-livechat__pinned-label">Pinned</span>
          <span>
            <strong>{pinned.author}</strong>: {pinned.body}
          </span>
        </div>
      ) : null}

      {/* THE REPLAY WINDOW (the playhead-bound entries, time order). */}
      <div className="wfx-livechat__list" data-wfx-chatreplay-list>
        {windowEntries.length === 0 ? (
          <p className="wfx-livechat__state" data-wfx-chatreplay-empty>
            No chat at this position yet — scrub or play to see the archived messages.
          </p>
        ) : (
          windowEntries.map((entry) => <ReplayLine key={`${entry.offsetMs}-${entry.author}`} entry={entry} />)
        )}
      </div>
    </div>
  );
}
