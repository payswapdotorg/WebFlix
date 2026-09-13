/**
 * Connector result → index bridge (WFX-020, Lane A).
 *
 * A PURE adapter that folds one connector's search output (the frozen-lane
 * `SearchResult` extension type from `@wfx/domain`) into a `CandidateIndex`.
 * No I/O, no provider logic, no clock, no randomness: folding the same
 * results twice produces byte-identical index state.
 *
 * Honesty laws enforced here:
 *
 * - NEVER silently dropped: every result is either ingested (folded into the
 *   index — attached as a new realization identity or absorbed by the
 *   freshest-wins dedupe) or SKIPPED with a recorded reason. The report
 *   counts both sides: `ingested + skipped === results.length`.
 * - A search hit is an EXISTENCE record, not a capability claim: the
 *   synthesized realization carries NO playback capabilities (`[]`) and
 *   `availability: "unknown"`. Realization-level capability truth arrives
 *   later through full metadata/resolve realizations re-ingested via
 *   `CandidateIndex.ingest` — the freshest-wins pair dedupe guarantees the
 *   richer realization (whose canonical id embeds a real timestamp) replaces
 *   the weak search record, never the reverse.
 * - Synthetic realization ids are DETERMINISTIC: `wfxsrc_` + a fixed
 *   epoch-0 ULID time section + 16 Crockford Base32 chars derived from an
 *   FNV-1a hash of the `(connectorId, externalRef)` pair. They are
 *   structurally canonical (they pass `isSourceRealizationId`) so the index
 *   validators accept them, they are NOT minted identities (no clock, no
 *   entropy — the same pair always yields the same id), and their embedded
 *   timestamp of 0 makes them always-stale in freshness battles against
 *   genuinely minted realization ids.
 * - Failure split: CALLER-level mistakes (non-array results, non-function
 *   mapper, non-index target) throw a typed `RetrievalError`. ENTRY-level
 *   problems (malformed result shape, unmappable result, item/realization
 *   rejected by the index) are per-result outcomes: skipped with a reason.
 */

import {
  CANONICAL_TYPES,
  ORIENTATIONS,
  type EntertainmentItem,
  type SearchResult,
  isRecord,
  previewValue,
} from "@wfx/domain";

import { RetrievalError, type CandidateIndex, type RetrievalItemInput } from "./index";

// ---------------------------------------------------------------------------
// Ingest report
// ---------------------------------------------------------------------------

/** Typed outcome of folding a batch of connector search results. */
export interface IngestReport {
  /** Results successfully folded into the index (attached or dedupe-absorbed). */
  ingested: number;
  /** Results NOT folded — every one is accounted for in `skipReasons`. */
  skipped: number;
  /** One human-readable reason per skipped result (same order as the input). */
  skipReasons: string[];
}

// ---------------------------------------------------------------------------
// Deterministic synthetic realization ids
// ---------------------------------------------------------------------------

/** Crockford Base32 alphabet (mirrors the canonical scheme in @wfx/domain ids). */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Fixed epoch-0 ULID time section: structurally canonical, always staler than minted ids. */
const SYNTHETIC_TIME_SECTION = "0000000000";

/** One round of 32-bit FNV-1a over `input`, seeded with `seed` (deterministic). */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic synthetic realization id for a `(connectorId, externalRef)`
 * pair: `wfxsrc_` + epoch-0 time section + 16 Crockford chars derived from
 * seeded FNV-1a hashes of the pair key. Identical pairs always produce
 * identical ids; different pairs collide only with negligible 80-bit hash
 * probability, and pair identity (not the id) remains the dedupe key anyway.
 */
export function syntheticRealizationId(connectorId: string, externalRef: string): string {
  const key = JSON.stringify([connectorId, externalRef]);
  let state = fnv1a32(key, 0x811c9dc5);
  let bits = 32;
  let randomSection = "";
  for (let index = 0; index < 16; index += 1) {
    if (bits < 5) {
      state = fnv1a32(`${key}#${index}`, state);
      bits = 32;
    }
    const shift = bits - 5;
    randomSection += CROCKFORD_ALPHABET.charAt((state >>> shift) & 31);
    bits -= 5;
  }
  return `wfxsrc_${SYNTHETIC_TIME_SECTION}${randomSection}`;
}

// ---------------------------------------------------------------------------
// SearchResult shape validation (entry-level → skip reasons, never a crash)
// ---------------------------------------------------------------------------

/** Structural membership check that accepts untrusted values (unknown-safe). */
function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && values.includes(value);
}

/** Field-level validation of one claimed SearchResult; returns its errors. */
function searchResultErrors(result: unknown): string[] {
  if (!isRecord(result)) {
    return [`expected a SearchResult object, got ${previewValue(result)}`];
  }
  const errors: string[] = [];
  if (typeof result.connectorId !== "string" || result.connectorId.trim().length === 0) {
    errors.push(
      `connectorId: expected a non-empty string, got ${previewValue(result.connectorId)}`,
    );
  }
  if (typeof result.externalRef !== "string" || result.externalRef.trim().length === 0) {
    errors.push(`externalRef: expected a non-empty string, got ${previewValue(result.externalRef)}`);
  }
  if (typeof result.title !== "string" || result.title.trim().length === 0) {
    errors.push(`title: expected a non-empty string, got ${previewValue(result.title)}`);
  }
  if (result.canonicalType !== undefined && !isMemberOf(CANONICAL_TYPES, result.canonicalType)) {
    errors.push(
      `canonicalType: expected one of ${CANONICAL_TYPES.join(" | ")} when present, got ${previewValue(result.canonicalType)}`,
    );
  }
  if (
    result.durationMs !== undefined &&
    (typeof result.durationMs !== "number" || !Number.isFinite(result.durationMs) || result.durationMs < 0)
  ) {
    errors.push(
      `durationMs: expected a non-negative finite number when present, got ${previewValue(result.durationMs)}`,
    );
  }
  if (result.orientation !== undefined && !isMemberOf(ORIENTATIONS, result.orientation)) {
    errors.push(
      `orientation: expected one of ${ORIENTATIONS.join(" | ")} when present, got ${previewValue(result.orientation)}`,
    );
  }
  if (result.metadata !== undefined && !isRecord(result.metadata)) {
    errors.push(
      `metadata: expected an object (Record<string, unknown>) when present, got ${previewValue(result.metadata)}`,
    );
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/**
 * Fold a connector's search results into a `CandidateIndex`.
 *
 * `itemFor` maps each well-formed result to the canonical item it realizes
 * (returning `null` when the result cannot be mapped — counted as skipped,
 * never silently dropped). Mapped results are ingested as (item, realization)
 * pairs: the item is inserted/merged and a weak existence realization
 * (capabilities `[]`, availability `"unknown"`, deterministic synthetic id)
 * is attached to the result's `(connectorId, externalRef)` identity, subject
 * to the index's freshest-wins dedupe. An `itemFor` that THROWS propagates
 * the caller's exception unchanged — caller code misbehaving is not a fold
 * outcome. Returns the typed `IngestReport`.
 */
export function ingestConnectorResults(
  index: CandidateIndex,
  results: readonly SearchResult[],
  itemFor: (result: SearchResult) => EntertainmentItem | null,
): IngestReport {
  if (typeof index !== "object" || index === null || typeof (index as CandidateIndex).ingest !== "function") {
    throw new RetrievalError(
      `index: expected a CandidateIndex, got ${previewValue(index)}`,
    );
  }
  if (!Array.isArray(results)) {
    throw new RetrievalError(
      `results: expected an array of SearchResult, got ${previewValue(results)}`,
    );
  }
  if (typeof itemFor !== "function") {
    throw new RetrievalError(
      `itemFor: expected a function (SearchResult) => EntertainmentItem | null, got ${previewValue(itemFor)}`,
    );
  }

  let ingested = 0;
  const skipReasons: string[] = [];

  for (const [position, result] of results.entries()) {
    const shapeErrors = searchResultErrors(result);
    if (shapeErrors.length > 0) {
      skipReasons.push(`results[${position}]: ${shapeErrors.join("; ")}`);
      continue;
    }

    const typed = result as SearchResult;
    const item = itemFor(typed);
    if (item === null || item === undefined) {
      skipReasons.push(
        `results[${position}]: unmappable — itemFor returned no canonical item for (${typed.connectorId}, ${typed.externalRef}) "${typed.title}"`,
      );
      continue;
    }

    const realization = {
      id: syntheticRealizationId(typed.connectorId, typed.externalRef),
      entertainmentItemId: item.id,
      connectorId: typed.connectorId,
      externalRef: typed.externalRef,
      // A search hit proves EXISTENCE only — no playback capability is claimed.
      capabilities: [] as never[],
      availability: "unknown" as const,
    };

    try {
      index.ingest([item as RetrievalItemInput], [realization]);
    } catch (error) {
      if (error instanceof RetrievalError) {
        // Entry-level rejection by the index (malformed mapped item, pair
        // conflict with a different canonical item, …): skipped with reasons.
        skipReasons.push(
          `results[${position}]: rejected by index — ${error.details.join("; ")}`,
        );
        continue;
      }
      throw error; // foreign errors (e.g. a throwing validator) are never swallowed
    }
    ingested += 1;
  }

  return { ingested, skipped: skipReasons.length, skipReasons };
}
