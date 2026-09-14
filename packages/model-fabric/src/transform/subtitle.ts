/**
 * @wfx/model-fabric/src/transform — subtitle composition primitives (WFX-033, Lane A).
 *
 * The subtitle-specific half of the WFX-033 media transformation tool layer:
 * timed-cue types, list validators, pure composition builders, and WebVTT
 * serialization. This module deliberately imports nothing from the rest of
 * the transform stack (only `@wfx/domain` helpers): it is the lowest layer of
 * `transform/`, consumed by `tasks.ts` (input/output schemas and the
 * SubtitleTask realize step), `fakes.ts` (deterministic cue generation), and
 * callers that need raw subtitle utilities.
 *
 * Laws (encoded and tested):
 * - PURE: no file or network I/O, no randomness, no hidden globals. The
 *   validators and builders are TOTAL: malformed input answers a typed issue
 *   list — never a throw, never a coerced "success".
 * - Timed-text invariants enforced by the validators: non-empty list; every
 *   item carries non-negative INTEGER `startMs`/`endMs` with `endMs > startMs`
 *   (positive duration) and non-empty `text` (whitespace-only counts as
 *   empty); starts are monotonically ordered (non-decreasing); consecutive
 *   items NEVER overlap (`items[i].endMs <= items[i+1].startMs`).
 * - `composeSubtitleCues` composes cues from transcript segments +
 *   per-segment translation outputs: a strict 1:1 mapping that preserves
 *   segment timing verbatim and places each translated text unchanged.
 *   Parity and non-emptiness violations are typed issues, never silent drops.
 * - `serializeVtt` renders a VALIDATED cue list to an exact WebVTT document;
 *   invalid cues answer typed issues instead of a malformed document.
 *
 * WebVTT grammar produced (exact, golden-tested):
 *   "WEBVTT" \n\n (timestamp " --> " timestamp \n text) (\n\n block)*
 * with `HH:MM:SS.mmm` timestamps and NO trailing newline. `formatVttTimestamp`
 * is a pure formatter over already-validated values; out-of-domain arguments
 * are programmer errors and throw `TypeError` (repo precedent: planning-seam
 * errors) — the public validators remain total.
 */

import { isRecord, previewValue } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Timed-text types
// ---------------------------------------------------------------------------

/** One timed subtitle cue: `[startMs, endMs)` plus its display text. */
export interface SubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * One timed transcript segment: `[startMs, endMs)` plus its spoken text.
 * Structurally identical to {@link SubtitleCue} — a transcript segment is the
 * transcription-side twin of a display cue; `composeSubtitleCues` maps one to
 * the other 1:1. The distinct names keep the two vocabularies honest at their
 * consumption sites.
 */
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** A field-path issue: `path` locates the offending value, `message` says why. */
export interface TimedTextIssue {
  path: string;
  message: string;
}

/** Result of validating a list of timed-text items. */
export type TimedTextListResult<T> =
  | { ok: true; value: T[] }
  | { ok: false; issues: TimedTextIssue[] };

// ---------------------------------------------------------------------------
// Shared field checks (total: they answer issues, never throw)
// ---------------------------------------------------------------------------

function isNonNegativeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/**
 * Validate a list of timed-text items. `pathPrefix` anchors every issue path
 * (e.g. `"segments"` produces `segments[1].endMs`); relational checks
 * (monotonic starts, no overlap) run between consecutive VALID items only —
 * an item that already failed its field checks cannot ground a relation.
 */
function validateTimedTextList<T extends SubtitleCue>(
  value: unknown,
  pathPrefix: string,
): TimedTextListResult<T> {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      issues: [
        {
          path: pathPrefix,
          message: `expected a non-empty array of timed-text items, got ${previewValue(value)}`,
        },
      ],
    };
  }
  if (value.length === 0) {
    return {
      ok: false,
      issues: [
        {
          path: pathPrefix,
          message: "expected a non-empty array — an empty timed-text list is not a valid track",
        },
      ],
    };
  }

  const issues: TimedTextIssue[] = [];
  const items: T[] = [];
  let previous: T | undefined;

  for (let index = 0; index < value.length; index++) {
    const raw = value[index];
    const path = `${pathPrefix}[${index}]`;

    if (!isRecord(raw)) {
      issues.push({
        path,
        message: `expected an object with startMs, endMs, and text, got ${previewValue(raw)}`,
      });
      continue;
    }

    const startMs = raw.startMs;
    const endMs = raw.endMs;
    const text = raw.text;

    if (!isNonNegativeInteger(startMs)) {
      issues.push({
        path: `${path}.startMs`,
        message: `expected a non-negative integer (milliseconds), got ${previewValue(startMs)}`,
      });
      continue;
    }
    if (!isNonNegativeInteger(endMs)) {
      issues.push({
        path: `${path}.endMs`,
        message: `expected a non-negative integer (milliseconds), got ${previewValue(endMs)}`,
      });
      continue;
    }
    if (endMs <= startMs) {
      issues.push({
        path: `${path}.endMs`,
        message: `expected endMs (${endMs}) to be greater than startMs (${startMs}) — zero/negative-duration items are invalid`,
      });
      continue;
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      issues.push({
        path: `${path}.text`,
        message: `expected a non-empty string (whitespace-only is empty), got ${previewValue(text)}`,
      });
      continue;
    }

    const item = { startMs, endMs, text } as T;
    if (previous !== undefined) {
      if (item.startMs < previous.startMs) {
        issues.push({
          path: `${path}.startMs`,
          message: `monotonicity: startMs (${item.startMs}) precedes the previous item's startMs (${previous.startMs})`,
        });
      }
      if (item.startMs < previous.endMs) {
        issues.push({
          path: `${path}.startMs`,
          message: `overlap: previous item ends at ${previous.endMs} but this item starts at ${item.startMs} — timed-text items must not overlap`,
        });
      }
    }
    items.push(item);
    previous = item;
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: items };
}

/**
 * Validate a subtitle cue list: non-empty, positive integer timings,
 * non-empty text, monotonic starts, no overlap. Issues carry paths anchored
 * at `pathPrefix` (default `"cues"`).
 */
export function validateSubtitleCues(
  cues: unknown,
  pathPrefix = "cues",
): TimedTextListResult<SubtitleCue> {
  return validateTimedTextList<SubtitleCue>(cues, pathPrefix);
}

/**
 * Validate a transcript segment list under the same timed-text invariants.
 * Issues carry paths anchored at `pathPrefix` (default `"segments"`).
 */
export function validateTranscriptSegments(
  segments: unknown,
  pathPrefix = "segments",
): TimedTextListResult<TranscriptSegment> {
  return validateTimedTextList<TranscriptSegment>(segments, pathPrefix);
}

// ---------------------------------------------------------------------------
// Composition: transcript segments + translation outputs → cues
// ---------------------------------------------------------------------------

/** Result of {@link composeSubtitleCues}. */
export type SubtitleCompositionResult =
  | { ok: true; cues: SubtitleCue[] }
  | { ok: false; issues: TimedTextIssue[] };

/**
 * Compose subtitle cues from transcript segments + per-segment translation
 * outputs. Pure and total:
 *
 * - Segments are RE-VALIDATED (the function is safe to call standalone, not
 *   only after pipeline input validation).
 * - `translations` must be an array whose length EXACTLY equals the segment
 *   count (1:1 mapping — no silent drops, no silent reuse) whose entries are
 *   non-empty strings.
 * - Output cues preserve segment timing VERBATIM; translated texts are placed
 *   unchanged.
 */
export function composeSubtitleCues(
  segments: readonly TranscriptSegment[],
  translations: readonly string[],
): SubtitleCompositionResult {
  const segmentCheck = validateTranscriptSegments(segments, "segments");
  if (!segmentCheck.ok) return { ok: false, issues: segmentCheck.issues };

  if (!Array.isArray(translations)) {
    return {
      ok: false,
      issues: [{ path: "translations", message: "expected an array of translated texts" }],
    };
  }
  if (translations.length !== segments.length) {
    return {
      ok: false,
      issues: [
        {
          path: "translations",
          message: `expected ${segments.length} translations for ${segments.length} segments, got ${translations.length}`,
        },
      ],
    };
  }

  const issues: TimedTextIssue[] = [];
  const cues: SubtitleCue[] = [];
  let index = 0;
  for (const segment of segmentCheck.value) {
    const translated = translations[index];
    if (typeof translated !== "string" || translated.trim().length === 0) {
      issues.push({
        path: `translations[${index}]`,
        message: `expected a non-empty translated text for the segment starting at ${segment.startMs}ms, got ${previewValue(translated)}`,
      });
    } else {
      cues.push({ startMs: segment.startMs, endMs: segment.endMs, text: translated });
    }
    index++;
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, cues };
}

// ---------------------------------------------------------------------------
// WebVTT serialization (pure string function — no file I/O)
// ---------------------------------------------------------------------------

/** Result of {@link serializeVtt}. */
export type VttSerializationResult =
  | { ok: true; vtt: string }
  | { ok: false; issues: TimedTextIssue[] };

/** The exact WebVTT document header this serializer emits. */
export const VTT_HEADER = "WEBVTT";

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function pad3(value: number): string {
  if (value < 10) return `00${value}`;
  return value < 100 ? `0${value}` : String(value);
}

/**
 * Format a millisecond timestamp as `HH:MM:SS.mmm` (WebVTT clock time).
 * Pure; expects a non-negative integer (a validated cue timing) — anything
 * else is a programmer error and throws `TypeError`.
 */
export function formatVttTimestamp(ms: number): string {
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0) {
    throw new TypeError(
      `formatVttTimestamp: expected a non-negative integer number of milliseconds, got ${previewValue(ms)}`,
    );
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

/**
 * Serialize a cue list to an exact WebVTT document (pure string function, no
 * file I/O). The cues are validated first: invalid input answers typed issues
 * instead of a malformed document. Output grammar:
 * `"WEBVTT\n\n"` + blocks joined by `"\n\n"`, each block
 * `"HH:MM:SS.mmm --> HH:MM:SS.mmm\ntext"`, NO trailing newline.
 */
export function serializeVtt(cues: readonly SubtitleCue[]): VttSerializationResult {
  const check = validateSubtitleCues(cues, "cues");
  if (!check.ok) return { ok: false, issues: check.issues };

  const blocks = check.value.map(
    (cue) => `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}\n${cue.text}`,
  );
  return { ok: true, vtt: `${VTT_HEADER}\n\n${blocks.join("\n\n")}` };
}
