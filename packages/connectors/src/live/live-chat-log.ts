/**
 * @wfx/connectors — R37 — THE ARCHIVED LIVE-CHAT LOG ARTIFACT (the
 * committed data contract behind chat replay).
 *
 * THE ARTIFACT LAW (the R37 dispatch, frozen): the chat log an archived
 * live VOD replays is COMMITTED DATA, never a stream capture. A provider
 * that archives a live broadcast commits the chat alongside the video
 * (timed to the media timeline); WebFlix reads that artifact through
 * the connector boundary and derives the replay window from the playhead
 * — no live transport is involved in replay (an ended stream has no
 * current chat; replaying one over a live socket would be theater).
 *
 * THE VALIDATION LAW (the R25-D wire discipline at the artifact
 * boundary): `parseLiveChatLog` validates structure — never a trusted
 * cast. A malformed artifact answers `null` and the consuming surface
 * renders the honest typed absence ("the archived chat log for this
 * broadcast could not be read"), never a partial fabricated log.
 *
 * DETERMINISM: pure types + pure derivations (the artwork-contract
 * discipline). The committed fixture log (apps/web/src/host/byof/
 * byof-fixtures.ts — the R37 delimited section) is deterministic
 * committed data — the same log every replay reads.
 */

import {
  LIVE_CHAT_AUTHOR_BADGES,
  type LiveChatAuthorBadge,
} from "./live-designation";

// ---------------------------------------------------------------------------
// The artifact's types (the committed shape, versioned)
// ---------------------------------------------------------------------------

/**
 * One archived chat message: the time position (`offsetMs` — the entry's
 * offset into the VOD's own media timeline), the author identity, the
 * author's source-declared badges, and the body (emojis included — the
 * chat grammar's own vocabulary rides the body verbatim).
 */
export interface LiveChatLogEntry {
  /** The entry's offset into the archived media timeline (ms, ≥ 0, time-ordered by position). */
  readonly offsetMs: number;
  readonly author: string;
  /** The source-declared author badges (validated; the closed vocabulary). */
  readonly authorBadges: readonly LiveChatAuthorBadge[];
  readonly body: string;
  /** `true` marks the VIEWER's own archived message (the honest self-identity — never an impersonated author). */
  readonly you?: boolean;
}

/**
 * The committed chat log of one archived live broadcast: the ordered
 * entries plus the session's own archived facts — the slow-mode interval
 * that was active (`slowModeMs`, the recorded session fact — rendered
 * honestly in the past tense) and the pinned message's offset
 * (`pinnedOffsetMs`, the moderator's pin that stood at the end of the
 * stream; `null` when nothing was pinned).
 */
export interface LiveChatLog {
  readonly kind: "live-chat-log";
  readonly version: 1;
  readonly slowModeMs: number | null;
  readonly pinnedOffsetMs: number | null;
  /** The entries in committed order (time order — the replay's arrival order). */
  readonly entries: readonly LiveChatLogEntry[];
}

// ---------------------------------------------------------------------------
// The parse (typed validation at the artifact boundary — never a cast)
// ---------------------------------------------------------------------------

/**
 * Validate + parse one committed chat-log artifact. `null` when the value
 * is not a well-formed v1 log (the honest typed absence — the caller
 * never renders a partial or fabricated log).
 */
export function parseLiveChatLog(value: unknown): LiveChatLog | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] !== "live-chat-log" || record["version"] !== 1) return null;
  if (!Array.isArray(record["entries"])) return null;
  const entries: LiveChatLogEntry[] = [];
  for (const candidate of record["entries"]) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const entry = candidate as Record<string, unknown>;
    const offsetMs = entry["offsetMs"];
    const author = entry["author"];
    const body = entry["body"];
    if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs) || offsetMs < 0) return null;
    if (typeof author !== "string" || author.length === 0) return null;
    if (typeof body !== "string" || body.length === 0) return null;
    const badgesRaw = entry["authorBadges"];
    if (badgesRaw !== undefined && !Array.isArray(badgesRaw)) return null;
    const badges: LiveChatAuthorBadge[] = [];
    for (const badge of (badgesRaw ?? []) as unknown[]) {
      if (typeof badge !== "string") return null;
      if (!(LIVE_CHAT_AUTHOR_BADGES as readonly string[]).includes(badge)) return null;
      badges.push(badge as LiveChatAuthorBadge);
    }
    const you = entry["you"];
    if (you !== undefined && typeof you !== "boolean") return null;
    entries.push({
      offsetMs: Math.floor(offsetMs),
      author,
      authorBadges: badges,
      body,
      ...(you === true ? { you: true } : {}),
    });
  }
  const slowModeMs = record["slowModeMs"];
  if (slowModeMs !== undefined && slowModeMs !== null) {
    if (typeof slowModeMs !== "number" || !Number.isFinite(slowModeMs) || slowModeMs < 0) return null;
  }
  const pinnedOffsetMs = record["pinnedOffsetMs"];
  if (pinnedOffsetMs !== undefined && pinnedOffsetMs !== null) {
    if (typeof pinnedOffsetMs !== "number" || !Number.isFinite(pinnedOffsetMs) || pinnedOffsetMs < 0) {
      return null;
    }
  }
  return {
    kind: "live-chat-log",
    version: 1,
    slowModeMs:
      typeof slowModeMs === "number" && Number.isFinite(slowModeMs) && slowModeMs >= 0
        ? Math.floor(slowModeMs)
        : null,
    pinnedOffsetMs:
      typeof pinnedOffsetMs === "number" && Number.isFinite(pinnedOffsetMs) && pinnedOffsetMs >= 0
        ? Math.floor(pinnedOffsetMs)
        : null,
    entries,
  };
}

// ---------------------------------------------------------------------------
// The replay derivation (the playhead binding — pure)
// ---------------------------------------------------------------------------

/**
 * The replay window at one playhead position: the entries with
 * `offsetMs` in `(positionMs − windowMs, positionMs]`, in TIME ORDER —
 * the committed log's own arrival order. Scrub the position and the
 * window follows; let the position advance (play) and the messages
 * arrive in time order. THE PLAYHEAD BINDING of the R37 replay law.
 */
export function liveChatWindowAt(
  log: LiveChatLog,
  positionMs: number,
  windowMs: number,
): readonly LiveChatLogEntry[] {
  if (!Number.isFinite(positionMs) || positionMs < 0) return [];
  if (!Number.isFinite(windowMs) || windowMs <= 0) return [];
  const floor = positionMs - windowMs;
  return log.entries.filter((entry) => entry.offsetMs > floor && entry.offsetMs <= positionMs);
}

/**
 * The NEXT entries the replay will surface as the clock advances from
 * `fromMs` to `toMs` (the time-ordered arrival the play action renders).
 */
export function liveChatEntriesBetween(
  log: LiveChatLog,
  fromMs: number,
  toMs: number,
): readonly LiveChatLogEntry[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
  return log.entries.filter((entry) => entry.offsetMs > fromMs && entry.offsetMs <= toMs);
}

/**
 * The pinned entry visible at one playhead position (the pin stands from
 * its own offset onward — the archived pin's truth), or `null` when
 * nothing is pinned / the position precedes the pin.
 */
export function liveChatPinnedAt(log: LiveChatLog, positionMs: number): LiveChatLogEntry | null {
  if (log.pinnedOffsetMs === null) return null;
  if (!Number.isFinite(positionMs) || positionMs < log.pinnedOffsetMs) return null;
  const pinned = log.entries.find((entry) => entry.offsetMs === log.pinnedOffsetMs);
  return pinned ?? null;
}

/**
 * The entry's compact chat-line label (the render-side composition —
 * the author with the badge labels in declaration order).
 */
export function liveChatEntryLabel(entry: LiveChatLogEntry): string {
  const badges = entry.authorBadges.map((badge) => badge).join(", ");
  return badges.length > 0 ? `${entry.author} (${badges})` : entry.author;
}
