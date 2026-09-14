/**
 * @wfx/experience — the long-form Watch Feed view model (WFX-027, Lane C).
 *
 * The CLIENT-facing model of the frozen "Watch Feed" experience mode
 * (docs/architecture/webflix-frozen-architecture.md, "Experience modes"):
 * long-form, episodic continuity, resume, quality/audio/subtitle controls.
 * "Source does not choose feed mode; content and session context do" — this
 * model receives the ALREADY-COMPOSED OS watch page plus the session context
 * and projects them into presentable rows; it never queries a source, never
 * embeds a player, never fetches (all data is injected).
 *
 * DEPENDENCY HONESTY (lead-visible, the WFX-029 pattern): `@wfx/recommendation`
 * is NOT a declared dependency of `@wfx/experience` (this package depends on
 * `@wfx/domain` only) and this work item may not edit package.json. The OS
 * page input (`WatchFeedPage` / `WatchFeedCard`) is therefore a STRUCTURAL
 * MIRROR of the WFX-021 `FeedPage` / `FeedCard` (packages/recommendation/src/
 * os/types.ts): every mirrored field exists verbatim on the real OS output,
 * so a real `FeedPage` with `surface: "watch"` is ASSIGNABLE to
 * `WatchFeedPage` — the host passes it through unchanged, and the OS `trace`
 * is carried as opaque data (never interpreted, never fabricated here).
 *
 * Candidate feature-key convention this view model consumes (documented, the
 * same law WFX-021 used for `nextEpisodeOf`): graph-aware hosts populate
 * - `topic` — the item's DOMINANT topic label (resolved from the
 *   Entertainment Graph topic registry). Absent ⇒ the card joins no topic row
 *   (typed-absent, never a guessed topic).
 *
 * Determinism laws (same as the rest of @wfx/experience): no randomness, no
 * hidden clock, no globals; every ordering is by explicit values with
 * documented codepoint tie-breaks.
 */

import type { EntertainmentCandidate, EntertainmentItem } from "@wfx/domain";

import type { RealizationBadge } from "../library/model";
import type {
  ContinuityCursor,
  SeriesContinuity,
  SeriesContinuityStatus,
} from "./continuity";
import type { ResumeAffordance } from "./resume";

// ---------------------------------------------------------------------------
// The OS page input (structural mirror of WFX-021's FeedPage — see module doc)
// ---------------------------------------------------------------------------

/**
 * One composed feed position, mirroring the WFX-021 `FeedCard` field for
 * field: the winning candidate, its verbatim model output, the dominant
 * matched objective, and the OS position explainability.
 */
export interface WatchFeedCard {
  /** 0-based position in the OS-composed feed. */
  position: number;
  /** The frozen pool candidate at this position (verbatim OS output). */
  candidate: EntertainmentCandidate;
  /** Verbatim model score for the item; null when the model omitted it. */
  modelScore: number | null;
  /** Verbatim model confidence; null alongside `modelScore`. */
  confidence: number | null;
  /** Verbatim model explanations. */
  explanations: readonly string[];
  /** The dominant matched objective at this position; null when none. */
  dominantObjective: string | null;
  /** Why this card sits at this position (OS explainability, verbatim). */
  positionReasons: readonly string[];
}

/**
 * The OS watch page input — a STRUCTURAL MIRROR of the WFX-021 `FeedPage`
 * (see the module doc for the dependency-honesty rationale). A real OS page
 * with `surface: "watch"` satisfies this shape without adaptation; the OS
 * `PipelineTrace` rides along opaquely in `trace`.
 */
export interface WatchFeedPage {
  surface: "watch";
  userId: string;
  sessionId: string;
  cards: readonly WatchFeedCard[];
  /** The OS `PipelineTrace` — opaque to the view model (carried, never interpreted). */
  trace?: unknown;
}

/**
 * The documented candidate feature key holding the item's DOMINANT topic
 * label (host-populated from the Entertainment Graph topic registry).
 */
export const TOPIC_FEATURE_KEY = "topic";

// ---------------------------------------------------------------------------
// Accessibility labels (the packet's a11y law, typed)
// ---------------------------------------------------------------------------

/**
 * The accessibility label carried by EVERY entry of the Watch Feed (and by
 * the hero): the entry's title, a position description, and the action label
 * for activation. All three fields are non-empty by construction.
 */
export interface A11yLabel {
  /** The entry's accessible name (its title). */
  title: string;
  /** Where the entry sits: resume position, chain position, or grouping. */
  position: string;
  /** What activating the entry does. */
  action: string;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

/** One continue-watching entry: a resumable item with its resume affordance. */
export interface ContinueEntry {
  item: EntertainmentItem;
  /** Deterministic display title (see `watchFeedTitle`). */
  title: string;
  /** Last known position in milliseconds (>= 0). */
  resumePositionMs: number;
  /** position/duration clamped to [0, 1]; null when duration is unknown. */
  completionRatio: number | null;
  /** The band-derived resume affordance (see `classifyResumeAffordance`). */
  affordance: ResumeAffordance;
  /** Where/how the item plays; null when no realization is joinable (typed-absent). */
  realizationBadge: RealizationBadge | null;
  /** ISO timestamp of the last watch evidence. */
  lastWatchedAt: string;
  a11y: A11yLabel;
}

/** One episode entry of an episodic row (a link in the visible binge chain). */
export interface EpisodicEntry {
  item: EntertainmentItem;
  title: string;
  /** Host-declared season coordinate (1-based by convention). */
  season: number;
  /** Host-declared episode-within-season coordinate. */
  episode: number;
  /** 0-based position in the visible binge chain (0 = the immediate next). */
  chainIndex: number;
  /** "New season" marker — present iff this entry crosses a season boundary. */
  newSeason?: { fromSeason: number; toSeason: number };
  /** True iff this entry is the continuity cursor's play target. */
  isNext: boolean;
  a11y: A11yLabel;
}

/** One entry of a topic row. */
export interface TopicEntry {
  item: EntertainmentItem;
  title: string;
  a11y: A11yLabel;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Fields shared by every watch-feed row. */
export interface FeedRowBase {
  /** Deterministic row identity: `"<kind>[:<key>]"`. */
  rowId: string;
  /** Human-readable row header (a11y-ready header text). */
  title: string;
  /** NON-EMPTY explainability reason (why this row exists for this user). */
  reason: string;
}

/** The continue-watching row: resumable entries, most recently watched first. */
export interface ContinueWatchingRow extends FeedRowBase {
  kind: "continue";
  /** rowId: `"continue"`. */
  entries: readonly ContinueEntry[];
}

/**
 * One episodic row: a series' continuity projection — the next episode to
 * play, the attention-bounded binge-chain preview, and the season markers.
 */
export interface EpisodicRow extends FeedRowBase {
  kind: "episodic";
  /** rowId: `"episodic:<seriesId>"`. */
  seriesId: string;
  /** The series' continuity status (pilot / in-progress / new-season / complete / empty). */
  status: SeriesContinuityStatus;
  /** The packet's continuity cursor (see continuity.ts). */
  cursor: ContinuityCursor;
  entries: readonly EpisodicEntry[];
}

/** One topic row: page cards grouped under a dominant topic label. */
export interface TopicRow extends FeedRowBase {
  kind: "topic";
  /** rowId: `"topic:<topic>"`. */
  topic: string;
  entries: readonly TopicEntry[];
}

/** Every row kind the Watch Feed view produces, in `WATCH_FEED_ROW_ORDER` order. */
export type FeedRow = ContinueWatchingRow | EpisodicRow | TopicRow;

/** Every row kind, in the presenter's ordering-policy order. */
export type WatchFeedRowKind = FeedRow["kind"];

/**
 * The row ordering POLICY (WFX-027): continue-watching first (resume beats
 * everything — the same law as WFX-029's library sections), then episodic
 * rows, then topic rows.
 */
export const WATCH_FEED_ROW_ORDER: readonly WatchFeedRowKind[] = [
  "continue",
  "episodic",
  "topic",
];

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/**
 * The hero: the ONE resume-or-start primary item. `kind: "resume"` when the
 * user's most recent resumable watch continues; `kind: "start"` when the
 * top-ranked fresh (or re-watchable) card leads the feed.
 */
export interface WatchFeedHero {
  kind: "resume" | "start";
  item: EntertainmentItem;
  title: string;
  /** 0 for a start hero; the last position for a resume hero. */
  resumePositionMs: number;
  completionRatio: number | null;
  /** Where/how the hero plays; null when no realization is joinable. */
  realizationBadge: RealizationBadge | null;
  /** The series continuity of the hero's series, when the hero is episodic. */
  continuity?: SeriesContinuity;
  a11y: A11yLabel;
  /** NON-EMPTY explainability reason. */
  reason: string;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The overall Watch Feed state (typed placeholders included). */
export type WatchFeedState = "loading" | "error" | "empty" | "ready";

/**
 * The presentable Watch Feed view: the typed surface state, the hero, the
 * ordered rows, and two TRANSPARENCY lists — watch states whose item could
 * not be joined (`unresolvedItemIds`) and page cards not represented in any
 * row or the hero (`unplacedCardIds`). Nothing is silently dropped: what the
 * row model cannot place is named, never hidden.
 */
export interface WatchFeedView {
  surface: "watch";
  state: WatchFeedState;
  /** Present iff `state` is `"ready"`. */
  hero?: WatchFeedHero;
  rows: readonly FeedRow[];
  /** Present iff `state` is `"error"`: what failed. */
  errorDetail?: string;
  /** Watch states whose canonical item could not be joined (no fabricated cards). */
  unresolvedItemIds: readonly string[];
  /** Page cards not represented in any row or the hero (typed transparency). */
  unplacedCardIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Pure display helpers (deterministic, shared by the watch modules)
// ---------------------------------------------------------------------------

/**
 * Deterministic display title: the canonical title when the item carries a
 * non-blank one, else the canonical id — never fabricated, never blank.
 */
export function watchFeedTitle(item: EntertainmentItem): string {
  return typeof item.canonicalTitle === "string" && item.canonicalTitle.trim().length > 0
    ? item.canonicalTitle
    : item.id;
}

/** Deterministic `m:ss` / `h:mm:ss` position text; non-finite values render as 0. */
export function formatPositionMs(ms: number): string {
  const safe = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/**
 * Deterministic percent announcement (`"45% watched"`); null when the ratio
 * is unknown or non-finite (an unknown ratio is never a fake percent).
 */
export function percentWatchedText(ratio: number | null): string | null {
  if (ratio === null || typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
  return `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}% watched`;
}
