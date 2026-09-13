/**
 * Entertainment Graph canonicalization / deduplication (WFX-010, Lane A).
 *
 * Pure functions only — no store, no I/O, no clock. They implement the graph's
 * canonicalization policy for the invariant "one content identity, many
 * realizations": when two source records describe the same canonical content
 * they must collapse into ONE identity carrying the union of their knowledge.
 *
 * Policy summary (all decisions lead-visible):
 *
 * - `normalizeTitle` — lowercase, strip diacritics (NFD + combining-mark
 *   removal) and Unicode punctuation, collapse whitespace, trim. Deterministic
 *   and locale-independent (`toLowerCase`, no `toLocaleLowerCase`).
 * - `dedupeKey` — `[canonicalType, normalizedTitle, durationBucket?]` as a
 *   JSON tuple. The duration bucket is `floor(durationMs / 60_000)`: items
 *   whose durations land in the same 60-second bucket are duration-equal (the
 *   "±60s" tolerance is realized at bucket granularity; exact quantization
 *   inevitably has boundaries, and the boundary behavior is deterministic).
 *   A missing `durationMs` contributes NO bucket component — an item with a
 *   duration never key-matches an item without one (incomplete metadata is
 *   never silently equal). Same for a missing title: the component is `""`.
 * - `mergeCandidates` — true when the two items share a dedupe key AND both
 *   carry a non-empty normalized title (an untitled or punctuation-only title
 *   carries no matchable signal — such items only ever merge via a shared
 *   external identity), OR when they share a realization with the same
 *   `(connectorId, externalRef)` pair. A shared external identity is the
 *   strongest possible signal: the same source is describing both records.
 * - `mergeRealizations` — one realization identity per `(connectorId,
 *   externalRef)` pair: the primary's id is kept (stable identity), declared
 *   capabilities UNION (primary order first — connector abilities are
 *   additive), and an `availability` of `"unknown"` defers to a definite
 *   value from either side; between two definite conflicting values the
 *   primary wins (the primary is canonical).
 * - `mergeItems` — fold `duplicate` into `primary`: primary's identity and
 *   `canonicalType` survive; optional fields prefer the primary's value and
 *   fall back to the duplicate's when the primary's is absent (never
 *   undefined-over-defined); creators/topics union; realizations union with
 *   per-pair `mergeRealizations` and every duplicate realization retargeted
 *   to the primary's item id; `createdAt` keeps the EARLIEST instant and
 *   `updatedAt` the LATEST (ties keep the primary's string). The result is a
 *   new, deeply frozen item — inputs are never mutated.
 *
 * Inputs are typed; runtime validation of untrusted data belongs to the
 * validators in validation.ts (used by the store). The only thrown failure is
 * the `mergeRealizations` identity precondition (typed `GraphError`) — key
 * derivation never throws and never coerces.
 */

import type { EntertainmentItem, SourceRealization } from "../contracts/frozen";
import { type CreatorId, GraphError, type GraphItem, type TopicId } from "./model";

/** Duration bucket width for dedupe keys: one bucket per 60 seconds. */
export const DEDUPE_DURATION_BUCKET_MS = 60_000;

/** Minimal shape needed to derive a dedupe key (works for frozen items and graph items). */
export type DedupeKeyInput = Pick<EntertainmentItem, "canonicalTitle" | "canonicalType" | "durationMs">;

/** Minimal shape needed to evaluate merge candidacy. */
export type MergeCandidateInput = DedupeKeyInput & Pick<GraphItem, "realizations">;

// ---------------------------------------------------------------------------
// Title normalization
// ---------------------------------------------------------------------------

/**
 * Canonical title normal form: NFD (decompose accents) → strip combining
 * marks (diacritics) → lowercase → strip Unicode punctuation → collapse
 * whitespace → trim.
 *
 * Examples: "  Café  König!! " → "cafe konig"; "Spider-Man" → "spiderman";
 * "A  B" → "a b". Deterministic, locale-independent, never throws on any
 * string input.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // combining marks (diacritics)
    .toLowerCase()
    .replace(/\p{P}/gu, "") // Unicode punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Dedupe key
// ---------------------------------------------------------------------------

/**
 * Stable dedupe key for an item: JSON tuple `[canonicalType, normalizedTitle,
 * durationBucket]` where the bucket is `floor(durationMs / 60_000)` when a
 * non-negative finite duration is present and `null` otherwise.
 *
 * Two items share the key when they have the same canonical type, the same
 * normalized title, and duration-equal metadata (same 60-second bucket, or
 * both missing a duration). See the module header for the boundary caveat on
 * quantized buckets. Never throws; a non-string title or an invalid duration
 * contributes the same component as a missing one (callers validating untrusted
 * input upstream is the documented contract).
 */
export function dedupeKey(item: DedupeKeyInput): string {
  const title = typeof item.canonicalTitle === "string" ? normalizeTitle(item.canonicalTitle) : "";
  const duration = item.durationMs;
  const bucket =
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0
      ? Math.floor(duration / DEDUPE_DURATION_BUCKET_MS)
      : null;
  return JSON.stringify([item.canonicalType, title, bucket]);
}

// ---------------------------------------------------------------------------
// Realization identity
// ---------------------------------------------------------------------------

/** Identity key of a realization: the `(connectorId, externalRef)` pair. */
export function realizationRefKey(realization: Pick<SourceRealization, "connectorId" | "externalRef">): string {
  return JSON.stringify([realization.connectorId, realization.externalRef]);
}

/** True when any realization of `a` and any realization of `b` share an external identity. */
export function sharesExternalRealization(
  a: readonly SourceRealization[],
  b: readonly SourceRealization[],
): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const keys = new Set<string>(a.map(realizationRefKey));
  return b.some((realization) => keys.has(realizationRefKey(realization)));
}

// ---------------------------------------------------------------------------
// Merge candidacy
// ---------------------------------------------------------------------------

/**
 * Merge-candidate predicate: are `a` and `b` plausibly the same canonical
 * content?
 *
 * True when (1) both carry a non-empty normalized title and their dedupe keys
 * are equal — same type, same normalized title, duration-equal metadata — or
 * (2) they share at least one `(connectorId, externalRef)` realization pair.
 * False otherwise. Untitled items never match via the key path (no signal);
 * they can still match via a shared external identity.
 */
export function mergeCandidates(a: MergeCandidateInput, b: MergeCandidateInput): boolean {
  const titleA = typeof a.canonicalTitle === "string" ? normalizeTitle(a.canonicalTitle) : "";
  const titleB = typeof b.canonicalTitle === "string" ? normalizeTitle(b.canonicalTitle) : "";
  if (titleA.length > 0 && titleB.length > 0 && dedupeKey(a) === dedupeKey(b)) return true;
  return sharesExternalRealization(a.realizations, b.realizations);
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

/** Freeze an array without widening its static type (runtime immutability). */
function frozenArray<T>(values: readonly T[]): T[] {
  return Object.freeze([...values]) as T[];
}

/** Union of two string arrays preserving order: primary first, then unseen extras. */
function unionStrings<T extends string>(primary: readonly T[], extra: readonly T[]): T[] {
  const out: T[] = [...primary];
  const seen = new Set<string>(primary);
  for (const value of extra) {
    if (!seen.has(value)) {
      out.push(value);
      seen.add(value);
    }
  }
  return out;
}

/**
 * Merge two realizations of the SAME external identity into one.
 *
 * Precondition (validated, typed `GraphError` on violation): both sides carry
 * the same `connectorId`, `externalRef`, AND `entertainmentItemId` — a merge
 * is only defined for two realizations of one identity on one item.
 *
 * Result policy: the primary's id / connectorId / externalRef /
 * entertainmentItemId survive (stable identity); capabilities union (primary
 * order first); `"unknown"` availability defers to a definite value from
 * either side, and between two definite conflicting values the primary wins.
 * The result is a new, deeply frozen realization — inputs are not mutated.
 */
export function mergeRealizations(
  primary: SourceRealization,
  duplicate: SourceRealization,
): SourceRealization {
  if (
    primary.connectorId !== duplicate.connectorId ||
    primary.externalRef !== duplicate.externalRef
  ) {
    throw new GraphError(
      `realizations do not share an external identity: (${primary.connectorId}, ${primary.externalRef}) vs (${duplicate.connectorId}, ${duplicate.externalRef})`,
    );
  }
  if (primary.entertainmentItemId !== duplicate.entertainmentItemId) {
    throw new GraphError(
      `realizations belong to different items: ${primary.entertainmentItemId} vs ${duplicate.entertainmentItemId}`,
    );
  }

  const availability =
    primary.availability === "unknown" && duplicate.availability !== "unknown"
      ? duplicate.availability
      : primary.availability;

  const merged: SourceRealization = {
    id: primary.id,
    entertainmentItemId: primary.entertainmentItemId,
    connectorId: primary.connectorId,
    externalRef: primary.externalRef,
    capabilities: frozenArray(unionStrings(primary.capabilities, duplicate.capabilities)),
    availability,
  };
  return Object.freeze(merged);
}

/**
 * Fold `duplicate` into `primary` and return the merged canonical item.
 *
 * The primary's identity wins: the result carries `primary.id` and
 * `primary.canonicalType`, and every realization (including the duplicate's)
 * is retargeted to `primary.id` — after a merge the duplicate identity no
 * longer exists. Optional fields prefer a defined value (primary first);
 * creators and topics union; realizations union with per-pair
 * `mergeRealizations` semantics; `createdAt` keeps the earliest instant and
 * `updatedAt` the latest (ties keep the primary's string).
 *
 * Pure: returns a new, deeply frozen `GraphItem`; the inputs are never
 * mutated. `primary.id === duplicate.id` degenerates to an idempotent
 * re-merge of an item with itself.
 */
export function mergeItems(primary: GraphItem, duplicate: GraphItem): GraphItem {
  // Merge realizations: primary's list first (deduped defensively within
  // itself), then the duplicate's — each cloned frozen and retargeted to the
  // primary identity.
  const realizations: SourceRealization[] = [];
  const append = (incoming: SourceRealization): void => {
    const index = realizations.findIndex(
      (existing) =>
        existing.connectorId === incoming.connectorId &&
        existing.externalRef === incoming.externalRef,
    );
    const existing = index === -1 ? undefined : realizations[index];
    if (existing === undefined) {
      realizations.push(incoming);
      return;
    }
    realizations[index] = mergeRealizations(existing, incoming);
  };
  const cloneFrozen = (realization: SourceRealization): SourceRealization =>
    Object.freeze({
      ...realization,
      // Retarget: after the merge only the primary identity exists.
      entertainmentItemId: primary.id,
      capabilities: frozenArray(realization.capabilities),
    });
  for (const realization of primary.realizations) {
    append(cloneFrozen(realization));
  }
  for (const realization of duplicate.realizations) {
    append(cloneFrozen(realization));
  }

  const merged: GraphItem = {
    id: primary.id,
    canonicalType: primary.canonicalType,
    creators: frozenArray(unionStrings<CreatorId>(primary.creators, duplicate.creators)),
    topics: frozenArray(unionStrings<TopicId>(primary.topics, duplicate.topics)),
    realizations: frozenArray(realizations),
    createdAt:
      Date.parse(duplicate.createdAt) < Date.parse(primary.createdAt)
        ? duplicate.createdAt
        : primary.createdAt,
    updatedAt:
      Date.parse(duplicate.updatedAt) > Date.parse(primary.updatedAt)
        ? duplicate.updatedAt
        : primary.updatedAt,
  };
  // Optional fields: prefer the primary's defined value, fall back to the duplicate's.
  if (primary.canonicalTitle !== undefined) merged.canonicalTitle = primary.canonicalTitle;
  else if (duplicate.canonicalTitle !== undefined) merged.canonicalTitle = duplicate.canonicalTitle;
  if (primary.durationMs !== undefined) merged.durationMs = primary.durationMs;
  else if (duplicate.durationMs !== undefined) merged.durationMs = duplicate.durationMs;
  if (primary.orientation !== undefined) merged.orientation = primary.orientation;
  else if (duplicate.orientation !== undefined) merged.orientation = duplicate.orientation;

  return Object.freeze(merged);
}
