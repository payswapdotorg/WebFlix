/**
 * Hand-rolled runtime validators for the frozen contracts (WFX-002).
 *
 * No external dependency: every check is explicit, total, and returns either a
 * typed value or a list of human-readable errors. Validators never throw on
 * malformed input and never silently coerce — unsupported input is reported.
 *
 * Semantics (deliberate, lead-visible decisions):
 * - Objects with unknown extra fields are ACCEPTED (structural typing, forward
 *   compatibility); only declared contract fields are checked.
 * - ID-prefix checks apply to the object's own canonical ID field and to
 *   references to Entertainment Graph entities (`itemId`, `entertainmentItemId`,
 *   `sourceRealizationId`). `userId` and `sessionId` stay opaque strings at the
 *   contract level and are only checked for non-emptiness.
 * - Timestamps must be full ISO 8601 datetime strings with an explicit
 *   UTC ('Z') or numeric (+HH:mm / -HH:mm) offset.
 * - `PlaybackRealization.capabilities` is `string[]` in the frozen contract
 *   (free-form surface capabilities), while `SourceRealization.capabilities`
 *   is `Capability[]` and is validated against the frozen `Capability` union.
 */

import type {
  Capability,
  EntertainmentEvent,
  EntertainmentItem,
  PlaybackMode,
  PlaybackRealization,
  SourceRealization,
} from "./contracts/frozen";
import { isEntertainmentItemId, isSourceRealizationId } from "./ids";

/** Result contract for every validator: success carries the typed value, failure carries errors. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type CanonicalType = EntertainmentItem["canonicalType"];
type Orientation = NonNullable<EntertainmentItem["orientation"]>;
type EventType = EntertainmentEvent["type"];
type Availability = SourceRealization["availability"];

// ---------------------------------------------------------------------------
// Canonical vocabularies (runtime mirrors of the frozen type unions)
// ---------------------------------------------------------------------------
// `satisfies` rejects values outside the frozen unions; the `Covers` assertions
// below fail compilation when a frozen union gains a member this table misses,
// so vocabulary drift between frozen.ts and these tables is a compile error.

/** Compile-time check that `Values` covers every member of the frozen `Union`. */
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? unknown
  : never;

export const CANONICAL_TYPES = [
  "movie",
  "series",
  "episode",
  "video",
  "short",
  "post",
  "audio",
] as const satisfies readonly CanonicalType[];
const _canonicalTypesCovers: Covers<CanonicalType, typeof CANONICAL_TYPES> = null;

export const ORIENTATIONS = [
  "horizontal",
  "vertical",
  "square",
  "unknown",
] as const satisfies readonly Orientation[];
const _orientationsCovers: Covers<Orientation, typeof ORIENTATIONS> = null;

export const EVENT_TYPES = [
  "impression",
  "start",
  "progress",
  "complete",
  "skip",
  "like",
  "dislike",
  "save",
  "share",
  "search",
] as const satisfies readonly EventType[];
const _eventTypesCovers: Covers<EventType, typeof EVENT_TYPES> = null;

export const AVAILABILITIES = [
  "available",
  "unknown",
  "unavailable",
] as const satisfies readonly Availability[];
const _availabilitiesCovers: Covers<Availability, typeof AVAILABILITIES> = null;

export const PLAYBACK_MODES = [
  "native",
  "embed",
  "browser",
  "external",
] as const satisfies readonly PlaybackMode[];
const _playbackModesCovers: Covers<PlaybackMode, typeof PLAYBACK_MODES> = null;

export const CAPABILITIES = [
  "identity",
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
  "feedImport",
] as const satisfies readonly Capability[];
const _capabilitiesCovers: Covers<Capability, typeof CAPABILITIES> = null;

// ---------------------------------------------------------------------------
// Untrusted-input helpers
// ---------------------------------------------------------------------------

/** Narrow `unknown` to a plain record (rejects null, arrays, primitives). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Full ISO 8601 datetime check: `YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:mm)`.
 * A Date.parse pass is added so impossible dates (e.g. month 13) are rejected.
 */
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIso8601(value: unknown): value is string {
  return typeof value === "string" && ISO_8601_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Compact, safe preview of an untrusted value for error messages (never throws). */
export function previewValue(value: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value) ?? String(value);
  } catch {
    rendered = String(value); // circular structures and other exotic input
  }
  return rendered.length > 80 ? `${rendered.slice(0, 77)}...` : rendered;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isCapabilityArray(value: unknown): value is Capability[] {
  return Array.isArray(value) && value.every((entry) => isMember(CAPABILITIES, entry));
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateEntertainmentItem(input: unknown): ValidationResult<EntertainmentItem> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["EntertainmentItem: expected an object"] };
  }
  const errors: string[] = [];

  if (!isEntertainmentItemId(input.id)) {
    errors.push(
      `id: expected an entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(input.id)}`,
    );
  }
  if (!isMember(CANONICAL_TYPES, input.canonicalType)) {
    errors.push(
      `canonicalType: expected one of ${CANONICAL_TYPES.join(" | ")}, got ${previewValue(input.canonicalType)}`,
    );
  }
  if (input.canonicalTitle !== undefined && typeof input.canonicalTitle !== "string") {
    errors.push(
      `canonicalTitle: expected a string when present, got ${previewValue(input.canonicalTitle)}`,
    );
  }
  if (input.durationMs !== undefined && !isNonNegativeNumber(input.durationMs)) {
    errors.push(
      `durationMs: expected a non-negative finite number when present, got ${previewValue(input.durationMs)}`,
    );
  }
  if (input.orientation !== undefined && !isMember(ORIENTATIONS, input.orientation)) {
    errors.push(
      `orientation: expected one of ${ORIENTATIONS.join(" | ")} when present, got ${previewValue(input.orientation)}`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  // Shape fully verified above; return the same reference (no cloning, extra fields preserved).
  return { ok: true, value: input as unknown as EntertainmentItem };
}

export function validateEntertainmentEvent(input: unknown): ValidationResult<EntertainmentEvent> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["EntertainmentEvent: expected an object"] };
  }
  const errors: string[] = [];

  if (!isNonEmptyString(input.userId)) {
    errors.push(`userId: expected a non-empty string, got ${previewValue(input.userId)}`);
  }
  if (!isEntertainmentItemId(input.itemId)) {
    errors.push(
      `itemId: expected an entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(input.itemId)}`,
    );
  }
  if (!isMember(EVENT_TYPES, input.type)) {
    errors.push(
      `type: expected one of ${EVENT_TYPES.join(" | ")}, got ${previewValue(input.type)}`,
    );
  }
  if (!isIso8601(input.occurredAt)) {
    errors.push(
      `occurredAt: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-13T10:30:00.000Z), got ${previewValue(input.occurredAt)}`,
    );
  }
  if (!isNonEmptyString(input.sessionId)) {
    errors.push(`sessionId: expected a non-empty string, got ${previewValue(input.sessionId)}`);
  }
  if (input.sourceRealizationId !== undefined && !isSourceRealizationId(input.sourceRealizationId)) {
    errors.push(
      `sourceRealizationId: expected a source-realization ID (wfxsrc_ prefix + 26-char Crockford Base32 ULID body) when present, got ${previewValue(input.sourceRealizationId)}`,
    );
  }
  if (input.payload !== undefined && !isRecord(input.payload)) {
    errors.push(
      `payload: expected an object (Record<string, unknown>) when present, got ${previewValue(input.payload)}`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as EntertainmentEvent };
}

export function validateSourceRealization(input: unknown): ValidationResult<SourceRealization> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["SourceRealization: expected an object"] };
  }
  const errors: string[] = [];

  if (!isSourceRealizationId(input.id)) {
    errors.push(
      `id: expected a source-realization ID (wfxsrc_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(input.id)}`,
    );
  }
  if (!isEntertainmentItemId(input.entertainmentItemId)) {
    errors.push(
      `entertainmentItemId: expected an entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(input.entertainmentItemId)}`,
    );
  }
  if (!isNonEmptyString(input.connectorId)) {
    errors.push(`connectorId: expected a non-empty string, got ${previewValue(input.connectorId)}`);
  }
  if (!isNonEmptyString(input.externalRef)) {
    errors.push(`externalRef: expected a non-empty string, got ${previewValue(input.externalRef)}`);
  }
  if (!isCapabilityArray(input.capabilities)) {
    errors.push(
      `capabilities: expected an array of Capability values (${CAPABILITIES.join(" | ")}), got ${previewValue(input.capabilities)}`,
    );
  }
  if (!isMember(AVAILABILITIES, input.availability)) {
    errors.push(
      `availability: expected one of ${AVAILABILITIES.join(" | ")}, got ${previewValue(input.availability)}`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as SourceRealization };
}

export function validatePlaybackRealization(
  input: unknown,
): ValidationResult<PlaybackRealization> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["PlaybackRealization: expected an object"] };
  }
  const errors: string[] = [];

  if (!isMember(PLAYBACK_MODES, input.mode)) {
    errors.push(
      `mode: expected one of ${PLAYBACK_MODES.join(" | ")}, got ${previewValue(input.mode)}`,
    );
  }
  if (!isNonEmptyString(input.connectorId)) {
    errors.push(`connectorId: expected a non-empty string, got ${previewValue(input.connectorId)}`);
  }
  if (input.url !== undefined && !isNonEmptyString(input.url)) {
    errors.push(`url: expected a non-empty string when present, got ${previewValue(input.url)}`);
  }
  if (input.externalRef !== undefined && !isNonEmptyString(input.externalRef)) {
    errors.push(
      `externalRef: expected a non-empty string when present, got ${previewValue(input.externalRef)}`,
    );
  }
  if (input.expiresAt !== undefined && !isIso8601(input.expiresAt)) {
    errors.push(
      `expiresAt: expected an ISO 8601 datetime string with explicit offset when present, got ${previewValue(input.expiresAt)}`,
    );
  }
  if (!isNonEmptyStringArray(input.capabilities)) {
    errors.push(
      `capabilities: expected an array of non-empty strings, got ${previewValue(input.capabilities)}`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as PlaybackRealization };
}
