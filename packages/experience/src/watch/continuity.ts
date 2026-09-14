/**
 * @wfx/experience — the episodic continuity engine (WFX-027, Lane C).
 *
 * PURE and deterministic: given a series' EPISODE GRAPH (host-derived from
 * Entertainment-Graph relations through the injected `RelationsPort` — the
 * graph owns relations, WFX-010; this engine consumes them) plus the watch
 * history (the WFX-029 event-folded `WatchState`s), it computes:
 *
 * - the NEXT episode to play (resume the in-progress one, or advance past a
 *   finished one),
 * - the per-episode RESUME POINTS,
 * - the "New season" markers,
 * - the packet's `ContinuityCursor` (seriesId, nextEpisodeId,
 *   resumePositionMs),
 * - the BINGE-CHAIN VISIBILITY (the N-next preview), bounded by the attention
 *   mode — mindful shows fewer upcoming episodes than immersive, reusing the
 *   frozen intent-graph policy vocabulary from `@wfx/domain`
 *   (`RecommendationPolicy["attentionMode"]`).
 *
 * Adjacency law (mirrors WFX-021's composition): next-episode adjacency is
 * DECLARED DATA, never guessed from titles. A `nextEpisodeId` edge on an
 * episode (host-derived from `ItemRelationship` `sequelOf`/`sameSeries`
 * edges) WINS when it points at another episode of the same series; the
 * canonical (season, episode) order is the documented fallback. An edge that
 * points outside the series (or at itself) is ignored — the fallback applies.
 *
 * Finished-episode law: an episode counts as finished when its watch state
 * is `completed` OR its completion ratio reached `RESUME_MAX_RATIO` (>= 95%,
 * the shared resume band constant from resume.ts — one law, one constant).
 *
 * Determinism: no randomness, no clock, no globals; the only inputs are the
 * arguments. Anchor selection (the decision base) is the most recently
 * watched episode of the series (`lastWatchedAt` desc, codepoint itemId asc
 * tie-break — chronology wins, the WFX-029 fold law).
 *
 * Error channel: malformed input (a broken `SeriesRelations`, a malformed
 * watch state, a non-member attention mode) throws the typed
 * `ExperienceError` — the package's caller-misuse channel. Absent data is
 * NOT an error: no watch history yields the honest `"pilot"` status.
 */

import type { EntertainmentItem, RecommendationPolicy } from "@wfx/domain";
import {
  ATTENTION_MODES,
  isRecord,
  previewValue,
  validateEntertainmentItem,
} from "@wfx/domain";

import { WATCH_STATUSES, type WatchState } from "../library/history";
import { ExperienceError } from "../ports";
import { RESUME_MAX_RATIO } from "./resume";
import { formatPositionMs, percentWatchedText, watchFeedTitle } from "./view";

// ---------------------------------------------------------------------------
// Attention mode + binge-chain visibility (the attention-policy law)
// ---------------------------------------------------------------------------

/** The frozen attention-mode vocabulary (intent-graph policy types, `@wfx/domain`). */
export type AttentionMode = RecommendationPolicy["attentionMode"];

/** Mindful: only the immediate next episode is visible (one conscious choice). */
export const MINDFUL_BINGE_CHAIN_VISIBILITY = 1;

/** Balanced (the default): the next two episodes are visible. */
export const BALANCED_BINGE_CHAIN_VISIBILITY = 2;

/** Immersive: a generous binge runway of four upcoming episodes. */
export const IMMERSIVE_BINGE_CHAIN_VISIBILITY = 4;

/**
 * Custom: the frozen custom policy carries no preview dial (attention tuning
 * is delegated to the user's explicit objectives), so the neutral balanced
 * visibility applies — a documented default, never presented as user-chosen.
 * Hosts honoring custom dials post-filter the chain (it is data, not state).
 */
export const CUSTOM_BINGE_CHAIN_VISIBILITY = BALANCED_BINGE_CHAIN_VISIBILITY;

/** Binge-chain visibility per attention mode (documented constants). */
export const BINGE_CHAIN_VISIBILITY: Readonly<Record<AttentionMode, number>> = {
  mindful: MINDFUL_BINGE_CHAIN_VISIBILITY,
  balanced: BALANCED_BINGE_CHAIN_VISIBILITY,
  immersive: IMMERSIVE_BINGE_CHAIN_VISIBILITY,
  custom: CUSTOM_BINGE_CHAIN_VISIBILITY,
};

/**
 * How many upcoming episodes the binge-chain preview shows for an attention
 * mode (mindful: fewer, immersive: more — the attention-policy law).
 */
export function bingeChainVisibility(mode: AttentionMode): number {
  return BINGE_CHAIN_VISIBILITY[mode];
}

// ---------------------------------------------------------------------------
// The injected relations seam
// ---------------------------------------------------------------------------

/**
 * One episode of a series as the host derives it from Entertainment-Graph
 * relations: the canonical episode item, its season/episode coordinates
 * (host-declared — the frozen `EntertainmentItem` carries none), and its
 * declared successor edge (from `sequelOf`/`sameSeries` `ItemRelationship`
 * edges — never title-guessed).
 */
export interface SeriesEpisode {
  item: EntertainmentItem;
  /** Season coordinate (host-declared; 0 conventionally means specials). */
  season: number;
  /** Episode-within-season coordinate (host-declared). */
  episode: number;
  /** Declared next-episode target (canonical id), when the graph has the edge. */
  nextEpisodeId?: string;
}

/**
 * The episode graph of one series (host-derived from graph relations): the
 * series item when the host has it, plus the episodes in host-declared
 * canonical order. The engine re-sorts canonically anyway (season asc,
 * episode asc, itemId codepoint asc) — the port's array order is not trusted
 * for ordering, only for membership.
 */
export interface SeriesRelations {
  seriesId: string;
  series?: EntertainmentItem;
  episodes: readonly SeriesEpisode[];
}

/**
 * The injected seam for Entertainment-Graph relations. WFX-010 owns the
 * graph; the watch feed consumes HOST-DERIVED projections through this port
 * and never touches the store. `null` means "no relations known for this
 * series" — an honest absence, not an error.
 */
export interface RelationsPort {
  /** Relations of one series; null when the port has none for the id. */
  seriesRelations(seriesId: string): SeriesRelations | null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * The packet's continuity cursor: WHERE the user is in a series — the series
 * identity, the next episode to play (null when nothing remains), and the
 * resume position WITHIN that episode.
 */
export interface ContinuityCursor {
  seriesId: string;
  nextEpisodeId: string | null;
  resumePositionMs: number;
}

/** The series' continuity status (closed vocabulary). */
export type SeriesContinuityStatus =
  /** No watch history — start the pilot. */
  | "pilot"
  /** A next episode is ready (resume or advance within the series). */
  | "in-progress"
  /** The watched season is finished; the next episode starts a new season. */
  | "new-season"
  /** Every episode is watched; nothing remains. */
  | "complete"
  /** The relations declare no episodes (honest emptiness, not an error). */
  | "empty";

/** A crossed season boundary ("New season" marker). */
export interface SeasonMarker {
  fromSeason: number;
  toSeason: number;
}

/** The full continuity projection of one series. */
export interface SeriesContinuity {
  seriesId: string;
  status: SeriesContinuityStatus;
  /** The next episode to play; null iff status is "complete" or "empty". */
  nextEpisodeId: string | null;
  /** The in-progress episode the resume position belongs to; null when none. */
  resumeEpisodeId: string | null;
  /** The position to start playback at WITHIN `nextEpisodeId`. */
  resumePositionMs: number;
  /** Per-episode resume points (episodeId → last position) for episodes with watch state. */
  resumePoints: Readonly<Record<string, number>>;
  /** The decision base: the most recently watched episode; null when no history. */
  anchorEpisodeId: string | null;
  /** Present iff status is "new-season": the crossed boundary. */
  newSeason?: SeasonMarker;
  /** The packet's cursor (seriesId, nextEpisodeId, resumePositionMs). */
  cursor: ContinuityCursor;
  /** The attention-bounded binge-chain preview (episode ids, cursor target first). */
  bingeChain: readonly string[];
  /** NON-EMPTY explainability reason (deterministic). */
  reason: string;
}

/** The engine's input bundle. */
export interface ComputeContinuityInput {
  relations: SeriesRelations;
  /** The event-folded watch states (WFX-029 `deriveWatchHistory` output). */
  history: readonly WatchState[];
  /** The attention mode bounding binge-chain visibility. */
  attentionMode: AttentionMode;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Validate one claimed `SeriesRelations`; throws the typed error on problems. */
export function assertUsableSeriesRelations(relations: SeriesRelations): void {
  if (!isRecord(relations)) {
    throw new ExperienceError("relations: expected a SeriesRelations object");
  }
  const problems: string[] = [];
  if (!isNonEmptyString(relations.seriesId)) {
    problems.push(
      `relations.seriesId: expected a non-empty string, got ${previewValue(relations.seriesId)}`,
    );
  }
  if (relations.series !== undefined) {
    const checked = validateEntertainmentItem(relations.series);
    if (!checked.ok) {
      problems.push(...checked.errors.map((message) => `relations.series: ${message}`));
    }
  }
  if (!Array.isArray(relations.episodes)) {
    problems.push(
      `relations.episodes: expected an array of SeriesEpisode, got ${previewValue(relations.episodes)}`,
    );
  } else {
    const seen = new Set<string>();
    relations.episodes.forEach((episode, index) => {
      const prefix = `relations.episodes[${index}]`;
      if (episode === null || typeof episode !== "object") {
        problems.push(`${prefix}: expected a SeriesEpisode object, got ${previewValue(episode)}`);
        return;
      }
      const itemCheck = validateEntertainmentItem(episode.item);
      if (!itemCheck.ok) {
        problems.push(...itemCheck.errors.map((message) => `${prefix}.item: ${message}`));
      } else if (seen.has(episode.item.id)) {
        problems.push(`${prefix}.item.id: duplicate episode id '${episode.item.id}'`);
      } else {
        seen.add(episode.item.id);
      }
      if (!isNonNegativeFinite(episode.season)) {
        problems.push(
          `${prefix}.season: expected a finite non-negative number, got ${previewValue(episode.season)}`,
        );
      }
      if (!isNonNegativeFinite(episode.episode)) {
        problems.push(
          `${prefix}.episode: expected a finite non-negative number, got ${previewValue(episode.episode)}`,
        );
      }
      if (episode.nextEpisodeId !== undefined && !isNonEmptyString(episode.nextEpisodeId)) {
        problems.push(
          `${prefix}.nextEpisodeId: expected a non-empty string when present, got ${previewValue(episode.nextEpisodeId)}`,
        );
      }
    });
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertUsableHistory(history: readonly WatchState[]): void {
  if (!Array.isArray(history)) {
    throw new ExperienceError("history: expected an array of WatchState");
  }
  history.forEach((state, index) => {
    const problems: string[] = [];
    if (!isRecord(state)) {
      throw new ExperienceError(
        `history[${index}]: expected a WatchState object, got ${previewValue(state)}`,
      );
    }
    if (!isNonEmptyString(state.itemId)) {
      problems.push(
        `history[${index}].itemId: expected a non-empty string, got ${previewValue(state.itemId)}`,
      );
    }
    if (!isNonNegativeFinite(state.lastPositionMs)) {
      problems.push(
        `history[${index}].lastPositionMs: expected a finite non-negative number, got ${previewValue(state.lastPositionMs)}`,
      );
    }
    if (
      state.completionRatio !== null &&
      !(typeof state.completionRatio === "number" && Number.isFinite(state.completionRatio))
    ) {
      problems.push(
        `history[${index}].completionRatio: expected a finite number or null, got ${previewValue(state.completionRatio)}`,
      );
    }
    if (!isNonEmptyString(state.lastWatchedAt)) {
      problems.push(
        `history[${index}].lastWatchedAt: expected a non-empty string, got ${previewValue(state.lastWatchedAt)}`,
      );
    }
    if (!isMemberOf(WATCH_STATUSES, state.status)) {
      problems.push(
        `history[${index}].status: expected one of ${WATCH_STATUSES.join(" | ")}, got ${previewValue(state.status)}`,
      );
    }
    if (problems.length > 0) throw new ExperienceError(problems);
  });
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Codepoint string comparison (locale-independent, deterministic). */
function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO epoch (NaN-safe: malformed timestamps sort last, never crash). */
function epochOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

/** Season/episode text (`"S1E2"`), NaN-safe. */
function coordinateText(season: number, episode: number): string {
  return `S${season}E${episode}`;
}

/**
 * Compute one series' continuity (see the module doc for every law).
 * Deterministic and pure; malformed input throws the typed `ExperienceError`.
 */
export function computeContinuity(input: ComputeContinuityInput): SeriesContinuity {
  if (!isRecord(input)) {
    throw new ExperienceError("input: expected a ComputeContinuityInput object");
  }
  if (!isMemberOf(ATTENTION_MODES, input.attentionMode)) {
    throw new ExperienceError(
      `input.attentionMode: expected one of ${ATTENTION_MODES.join(" | ")}, got ${previewValue(input.attentionMode)}`,
    );
  }
  assertUsableSeriesRelations(input.relations);
  assertUsableHistory(input.history);

  const relations = input.relations;
  const seriesTitle =
    relations.series !== undefined
      ? watchFeedTitle(relations.series)
      : relations.seriesId;

  // Canonical episode order: season asc, episode asc, itemId codepoint asc.
  const ordered = [...relations.episodes].sort(
    (a, b) =>
      a.season - b.season || a.episode - b.episode || compareCodepoint(a.item.id, b.item.id),
  );
  const byId = new Map<string, (typeof ordered)[number]>();
  const indexById = new Map<string, number>();
  ordered.forEach((episode, index) => {
    byId.set(episode.item.id, episode);
    indexById.set(episode.item.id, index);
  });

  /**
   * The successor of an episode: a declared `nextEpisodeId` edge WINS when it
   * targets another episode of this series (graph truth); otherwise the
   * canonical order's next episode. Edges pointing outside (or at itself)
   * are ignored — the fallback applies (documented adjacency law).
   */
  const successorOf = (episode: (typeof ordered)[number]): (typeof ordered)[number] | null => {
    const declared = episode.nextEpisodeId;
    if (declared !== undefined && declared !== episode.item.id) {
      const target = byId.get(declared);
      if (target !== undefined) return target;
    }
    const index = indexById.get(episode.item.id);
    if (index === undefined || index + 1 >= ordered.length) return null;
    return ordered[index + 1] ?? null;
  };

  // The series' watch states, and the anchor (most recently watched).
  const statesByEpisode = new Map<string, WatchState>();
  for (const state of input.history) {
    if (byId.has(state.itemId)) statesByEpisode.set(state.itemId, state);
  }
  const anchor = [...statesByEpisode.values()].sort(
    (a, b) =>
      epochOf(b.lastWatchedAt) - epochOf(a.lastWatchedAt) ||
      compareCodepoint(a.itemId, b.itemId),
  )[0];

  // Per-episode resume points (the packet's "resume points").
  const resumePoints: Record<string, number> = {};
  for (const [episodeId, state] of statesByEpisode) {
    resumePoints[episodeId] = Math.max(0, Math.floor(state.lastPositionMs));
  }

  // The decision.
  let status: SeriesContinuityStatus;
  let nextEpisodeId: string | null;
  let resumeEpisodeId: string | null;
  let resumePositionMs: number;
  let newSeason: SeasonMarker | undefined;

  const first = ordered[0];
  if (first === undefined) {
    status = "empty";
    nextEpisodeId = null;
    resumeEpisodeId = null;
    resumePositionMs = 0;
  } else if (anchor === undefined) {
    status = "pilot";
    nextEpisodeId = first.item.id;
    resumeEpisodeId = null;
    resumePositionMs = 0;
  } else {
    const anchorEpisode = byId.get(anchor.itemId) ?? first;
    const finished =
      anchor.status === "completed" ||
      (anchor.completionRatio !== null && anchor.completionRatio >= RESUME_MAX_RATIO);
    if (!finished) {
      // Resume the in-progress episode where the user left it.
      status = "in-progress";
      nextEpisodeId = anchor.itemId;
      resumeEpisodeId = anchor.itemId;
      resumePositionMs = Math.max(0, Math.floor(anchor.lastPositionMs));
    } else {
      const successor = successorOf(anchorEpisode);
      if (successor === null) {
        status = "complete";
        nextEpisodeId = null;
        resumeEpisodeId = null;
        resumePositionMs = 0;
      } else if (successor.season > anchorEpisode.season) {
        status = "new-season";
        nextEpisodeId = successor.item.id;
        resumeEpisodeId = null;
        resumePositionMs = 0;
        newSeason = { fromSeason: anchorEpisode.season, toSeason: successor.season };
      } else {
        status = "in-progress";
        nextEpisodeId = successor.item.id;
        resumeEpisodeId = null;
        resumePositionMs = 0;
      }
    }
  }

  // The binge-chain preview: attention-bounded, cursor target first.
  const visibility = bingeChainVisibility(input.attentionMode);
  const bingeChain: string[] = [];
  let step: (typeof ordered)[number] | null =
    nextEpisodeId !== null ? (byId.get(nextEpisodeId) ?? null) : null;
  while (step !== null && bingeChain.length < visibility) {
    bingeChain.push(step.item.id);
    step = successorOf(step);
  }

  // The explainability reason (deterministic, non-empty).
  const nextEpisode = nextEpisodeId !== null ? byId.get(nextEpisodeId) : undefined;
  let reason: string;
  switch (status) {
    case "empty":
      reason = `"${seriesTitle}" — no episodes known for this series (nothing to play)`;
      break;
    case "pilot":
      reason = `"${seriesTitle}" — no watch history; start with the pilot (${coordinateText(first!.season, first!.episode)})`;
      break;
    case "new-season":
      reason = `"${seriesTitle}" — season ${newSeason?.fromSeason} complete; start season ${newSeason?.toSeason} (${coordinateText(nextEpisode!.season, nextEpisode!.episode)})`;
      break;
    case "complete": {
      const anchorText =
        anchor !== undefined && statesByEpisode.has(anchor.itemId)
          ? ` after ${coordinateText(byId.get(anchor.itemId)!.season, byId.get(anchor.itemId)!.episode)}`
          : "";
      reason = `"${seriesTitle}" — every episode watched${anchorText}; series complete`;
      break;
    }
    case "in-progress":
      if (resumeEpisodeId !== null) {
        const episode = byId.get(resumeEpisodeId)!;
        const anchorState = statesByEpisode.get(resumeEpisodeId);
        const progress =
          anchorState !== undefined
            ? (percentWatchedText(anchorState.completionRatio) ??
              `at ${formatPositionMs(resumePositionMs)}`)
            : `at ${formatPositionMs(resumePositionMs)}`;
        reason = `"${seriesTitle}" — resume ${coordinateText(episode.season, episode.episode)} "${watchFeedTitle(episode.item)}" ${progress}`;
      } else {
        const anchorEpisode =
          anchor !== undefined ? (byId.get(anchor.itemId) ?? undefined) : undefined;
        const anchorText =
          anchorEpisode !== undefined
            ? `${coordinateText(anchorEpisode.season, anchorEpisode.episode)} finished; `
            : "";
        reason = `"${seriesTitle}" — ${anchorText}continue with ${coordinateText(nextEpisode!.season, nextEpisode!.episode)} "${watchFeedTitle(nextEpisode!.item)}"`;
      }
      break;
  }

  const continuity: SeriesContinuity = {
    seriesId: relations.seriesId,
    status,
    nextEpisodeId,
    resumeEpisodeId,
    resumePositionMs,
    resumePoints,
    anchorEpisodeId: anchor !== undefined ? anchor.itemId : null,
    ...(newSeason !== undefined ? { newSeason } : {}),
    cursor: {
      seriesId: relations.seriesId,
      nextEpisodeId,
      resumePositionMs,
    },
    bingeChain: Object.freeze(bingeChain),
    reason,
  };
  return continuity;
}
