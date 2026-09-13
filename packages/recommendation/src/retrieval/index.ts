/**
 * CandidateIndex — the source-neutral retrieval index (WFX-020, Lane A).
 *
 * This is the FIRST stage of the Recommendation OS pipeline (candidate
 * generation) described in docs/architecture/webflix-frozen-architecture.md.
 * It is pure, in-memory logic: no I/O, no network, no provider calls, no
 * persistence, and NO hidden nondeterminism — `Date.now()` / `Math.random()`
 * are never called. Every output is a pure function of (constructor anchor,
 * ingest history, query).
 *
 * Semantics (all lead-visible, all enforced):
 *
 * - Boundary: the index sits ON the merged lane work — it imports the frozen
 *   contracts, the WFX-002 validators, and the graph's canonicalization
 *   helpers through the public `@wfx/domain` entry, and never redefines any
 *   of them. Source neutrality: the index knows connector ids as opaque
 *   strings; it contains zero provider logic.
 * - Ingest (`ingest`): bulk load of canonical `EntertainmentItem`s plus their
 *   `SourceRealization`s. Inputs are validated with the domain validators
 *   (plus graph-ref checks) and a single aggregated typed `RetrievalError`
 *   is thrown on malformed input — validation happens BEFORE any mutation,
 *   so a failed call leaves the index untouched (all-or-nothing per call).
 *   Re-ingesting a known item is a merge-update (defined incoming fields win,
 *   exactly like `EntertainmentGraph.applyItemUpdate`): the index accumulates
 *   knowledge, it never forgets. Insertion order is stable across merges.
 * - Realization identity is the `(connectorId, externalRef)` pair (the graph's
 *   `realizationRefKey`). Duplicate reports of one pair are DEDUPLICATED
 *   KEEPING THE FRESHEST. Freshness is data-driven, not call-order-driven:
 *   realization ids are canonical `wfxsrc_` ULIDs (enforced by
 *   `validateSourceRealization`), so `ulidTimestamp` decodes a real ordering
 *   key; ties fall back to report order (later report wins). Consequence: a
 *   weak existence record (e.g. a connector search hit carrying no playback
 *   capabilities) can never clobber a later, richer realization of the same
 *   pair, because the rich one carries a later embedded timestamp.
 * - A realization referencing an item unknown to the index (this call or any
 *   earlier one) is invalid input: the index never invents canonical
 *   identities (same law as the graph store). A pair claimed by TWO different
 *   items is likewise a typed error — one source record realizes exactly one
 *   canonical identity.
 * - Query (`query`): filters over the index and returns `RetrievedCandidate`s
 *   in deterministic order — item insertion order, then realization order
 *   within the item. Free-text matching is tokenized substring (AND over
 *   tokens), case-insensitive via `toLowerCase` (locale-independent), over a
 *   per-item match surface assembled from the canonical title, resolved
 *   creator/topic names (graph enrichment), canonical type, and orientation.
 *   NO external search libraries, no fuzzy matching.
 * - `requiredCapability` filters on REALIZATION capabilities: only items with
 *   at least one realization DECLARING the capability can match, and only the
 *   declaring realizations materialize candidates. A movie whose only
 *   realization lacks `playNative` never matches a `playNative` query — this
 *   is the "preserving capabilities" law. `sourceRealizations` still carries
 *   EVERY realization of a matched item verbatim, so capability truth is
 *   never narrowed by retrieval.
 * - Emptiness is a query result, not an error: an empty index returns `[]`.
 *   Invalid query SHAPES throw a typed `RetrievalError` with field-level
 *   details.
 * - Reads are defensive: every returned object graph is deeply frozen —
 *   mutating a returned candidate, realization, or array cannot corrupt the
 *   index.
 * - This module is also the retrieval folder barrel: the sibling adapters
 *   (connector ingest bridge, intent-aware ranking, fixtures) are re-exported
 *   from here so the package barrel stays a single export line.
 */

import {
  CAPABILITIES,
  CANONICAL_TYPES,
  ORIENTATIONS,
  type Capability,
  type EntertainmentItem,
  type SourceRealization,
  isCreatorId,
  isIso8601,
  isRecord,
  isTopicId,
  previewValue,
  realizationRefKey,
  ulidTimestamp,
  validateEntertainmentItem,
  validateSourceRealization,
} from "@wfx/domain";

import type { RetrievedCandidate } from "./candidate";
export type { RetrievedCandidate } from "./candidate";
export * from "./ingest-connectors";
export * from "./intent-filter";
export * from "./fixtures";

// ---------------------------------------------------------------------------
// Typed failure
// ---------------------------------------------------------------------------

/** Typed failure kind produced by retrieval operations. */
export type RetrievalErrorKind = "invalid-input";

/**
 * Typed error thrown by retrieval operations on bad input. Failures are
 * explicit and structured — the error carries a machine-readable `kind` plus
 * field-level `details` (at least one). There are no silent coercions and no
 * fake-success paths: absent data is an empty query result, malformed data is
 * a typed error.
 */
export class RetrievalError extends Error {
  readonly kind: RetrievalErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`RetrievalError (invalid-input): ${list.join("; ")}`);
    this.name = "RetrievalError";
    this.kind = "invalid-input";
    this.details = list;
  }
}

// ---------------------------------------------------------------------------
// Input / query shapes
// ---------------------------------------------------------------------------

/**
 * An ingestable canonical item: the frozen `EntertainmentItem` plus OPTIONAL
 * graph enrichment — canonical creator/topic id references, resolved to names
 * at query time through the ingest `labels` maps.
 *
 * `GraphItem` (WFX-010) satisfies this shape structurally: a graph item CAN be
 * ingested directly, with its creator/topic references and the graph's
 * creator/topic registries as the label maps. Plain frozen items (no
 * enrichment fields) are equally valid — they simply match on title/type only.
 */
export interface RetrievalItemInput extends EntertainmentItem {
  /** Canonical creator ids (`wfxcre_`) referenced by this item (graph shape). */
  creators?: readonly string[];
  /** Canonical topic ids (`wfxtop_`) referenced by this item (graph shape). */
  topics?: readonly string[];
}

/** Name lookups for graph enrichment references (creator names / topic labels). */
export interface RetrievalLabels {
  /** Canonical creator id (`wfxcre_`) → display name (non-empty after trimming). */
  creatorNames?: Readonly<Record<string, string>>;
  /** Canonical topic id (`wfxtop_`) → label (non-empty after trimming). */
  topicLabels?: Readonly<Record<string, string>>;
}

/** Inclusive duration window on the item's `durationMs`; absent bound = unbounded. */
export interface DurationRange {
  /** Inclusive lower bound in milliseconds. */
  minMs?: number;
  /** Inclusive upper bound in milliseconds. */
  maxMs?: number;
}

/** The retrieval query. `limit` is the only required field. */
export interface RetrievalQuery {
  /**
   * Free-text filter: whitespace-tokenized, case-insensitive; EVERY token must
   * appear as a substring of the item's match surface (title + resolved
   * creator/topic names + canonicalType + orientation). Blank text is invalid
   * input (an empty needle is a caller bug, same law as the graph store).
   */
  text?: string;
  /** Exact canonical type filter. */
  canonicalType?: EntertainmentItem["canonicalType"];
  /** Exact orientation filter; items without an orientation never match. */
  orientation?: NonNullable<EntertainmentItem["orientation"]>;
  /**
   * Duration window (inclusive bounds). Items with an undefined `durationMs`
   * never match a duration-filtered query — incomplete metadata cannot claim
   * range membership (same law as the dedupe key: never silently equal).
   */
  durationRangeMs?: DurationRange;
  /** Restrict candidate realizations to this connector id (opaque string). */
  connectorId?: string;
  /**
   * Require at least one realization DECLARING this capability; only declaring
   * realizations materialize candidates (realization-level capability truth).
   */
  requiredCapability?: Capability;
  /** Maximum number of candidates to return; a positive integer. */
  limit: number;
}

/** Outcome counters for one `ingest` call. */
export interface IngestSummary {
  /** New canonical items inserted by this call (re-ingests are updates). */
  itemsInserted: number;
  /** New (connectorId, externalRef) pairs attached by this call. */
  realizationsAttached: number;
  /** Reports absorbed by the freshest-wins pair dedupe (staler ones discarded). */
  realizationsDeduplicated: number;
}

/** Construction options for `CandidateIndex`. */
export interface CandidateIndexOptions {
  /**
   * The deterministic ISO 8601 instant stamped on every retrieved candidate.
   * REQUIRED and validated: the index refuses to run on a hidden clock, so
   * the caller supplies the retrieval instant explicitly.
   */
  retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

/** Live internal record for one canonical item (never handed out directly). */
interface StoredItem {
  item: RetrievalItemInput;
  /** Pair keys of the item's realizations, in attach order. */
  realizationKeys: string[];
}

/** Live internal record for one realization identity. */
interface StoredRealization {
  realization: SourceRealization;
  /** Monotonic ingest report sequence — the freshness tiebreak. */
  reportSeq: number;
}

// ---------------------------------------------------------------------------
// Copy / freeze helpers
// ---------------------------------------------------------------------------

/** Freeze an array without widening its static type (runtime immutability). */
function frozenArray<T>(values: readonly T[]): T[] {
  return Object.freeze([...values]) as T[];
}

/** Frozen defensive copy of a realization (also defensive on the way IN). */
function cloneRealization(realization: SourceRealization): SourceRealization {
  return Object.freeze({
    ...realization,
    capabilities: frozenArray(realization.capabilities),
  });
}

// ---------------------------------------------------------------------------
// Argument guards
// ---------------------------------------------------------------------------

function isMemberOf(values: readonly string[], value: unknown): boolean {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Validate one ingestable item (frozen contract + graph-ref enrichment). */
function itemErrors(item: unknown, index: number, prefix: string): string[] {
  const errors: string[] = [];
  const base = validateEntertainmentItem(item);
  if (!base.ok) {
    errors.push(...base.errors.map((error) => `${prefix}[${index}]: ${error}`));
    return errors;
  }
  const enriched = item as RetrievalItemInput;
  if (enriched.creators !== undefined) {
    if (!Array.isArray(enriched.creators)) {
      errors.push(
        `${prefix}[${index}].creators: expected an array of creator ids, got ${previewValue(enriched.creators)}`,
      );
    } else {
      for (const [position, creatorId] of enriched.creators.entries()) {
        if (!isCreatorId(creatorId)) {
          errors.push(
            `${prefix}[${index}].creators[${position}]: expected a creator ID (wfxcre_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(creatorId)}`,
          );
        }
      }
    }
  }
  if (enriched.topics !== undefined) {
    if (!Array.isArray(enriched.topics)) {
      errors.push(
        `${prefix}[${index}].topics: expected an array of topic ids, got ${previewValue(enriched.topics)}`,
      );
    } else {
      for (const [position, topicId] of enriched.topics.entries()) {
        if (!isTopicId(topicId)) {
          errors.push(
            `${prefix}[${index}].topics[${position}]: expected a topic ID (wfxtop_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(topicId)}`,
          );
        }
      }
    }
  }
  return errors;
}

/** Validate the optional label maps (canonical-id keyed, non-empty values). */
function labelErrors(labels: RetrievalLabels | undefined): string[] {
  const errors: string[] = [];
  if (labels === undefined) return errors;

  if (labels.creatorNames !== undefined) {
    if (!isRecord(labels.creatorNames)) {
      errors.push(
        `labels.creatorNames: expected a record of creator id → name, got ${previewValue(labels.creatorNames)}`,
      );
    } else {
      for (const [key, name] of Object.entries(labels.creatorNames)) {
        if (!isCreatorId(key)) {
          errors.push(
            `labels.creatorNames["${key}"]: expected a creator ID (wfxcre_ prefix + 26-char Crockford Base32 ULID body) as the key`,
          );
        }
        if (typeof name !== "string" || name.trim().length === 0) {
          errors.push(
            `labels.creatorNames["${key}"]: expected a non-empty string after trimming, got ${previewValue(name)}`,
          );
        }
      }
    }
  }
  if (labels.topicLabels !== undefined) {
    if (!isRecord(labels.topicLabels)) {
      errors.push(
        `labels.topicLabels: expected a record of topic id → label, got ${previewValue(labels.topicLabels)}`,
      );
    } else {
      for (const [key, label] of Object.entries(labels.topicLabels)) {
        if (!isTopicId(key)) {
          errors.push(
            `labels.topicLabels["${key}"]: expected a topic ID (wfxtop_ prefix + 26-char Crockford Base32 ULID body) as the key`,
          );
        }
        if (typeof label !== "string" || label.trim().length === 0) {
          errors.push(
            `labels.topicLabels["${key}"]: expected a non-empty string after trimming, got ${previewValue(label)}`,
          );
        }
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/**
 * The in-memory candidate index: the source-neutral retrieval stage that
 * feeds the Recommendation OS.
 *
 * Create with `new CandidateIndex({ retrievedAt })` — the deterministic
 * instant stamped on results. Ingest canonical items + realizations (plus
 * optional creator/topic name lookups), then query. All reads return frozen
 * copies; all orderings are deterministic (Map insertion order).
 */
export class CandidateIndex {
  /** Canonical items by id — live internal objects (never handed out). */
  private readonly items = new Map<string, StoredItem>();
  /** Realizations by (connectorId, externalRef) pair key. */
  private readonly realizations = new Map<string, StoredRealization>();
  /** Creator id → display name (graph enrichment). */
  private readonly creatorNames = new Map<string, string>();
  /** Topic id → label (graph enrichment). */
  private readonly topicLabels = new Map<string, string>();
  /** The deterministic instant stamped on every retrieved candidate. */
  private readonly retrievedAt: string;
  /** Monotonic ingest report sequence (freshness tiebreak; never a clock). */
  private reportSeq = 0;

  constructor(options: CandidateIndexOptions) {
    if (!isRecord(options)) {
      throw new RetrievalError(
        `options: expected a CandidateIndexOptions object, got ${previewValue(options)}`,
      );
    }
    if (!isIso8601(options.retrievedAt)) {
      throw new RetrievalError(
        `options.retrievedAt: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-13T12:00:00.000Z), got ${previewValue(options.retrievedAt)} — the index refuses to read a hidden clock`,
      );
    }
    this.retrievedAt = options.retrievedAt;
  }

  /**
   * Bulk load canonical items, their source realizations, and optional
   * creator/topic name lookups into the index.
   *
   * Validation is upfront and aggregated: a malformed item, realization, or
   * label map throws ONE typed `RetrievalError` with field-level details and
   * leaves the index untouched. Realizations may reference items from this
   * call or any earlier ingest; orphans and cross-item pair conflicts are
   * invalid input (typed error naming both sides).
   *
   * Item semantics: first sight inserts; re-ingest merges (defined incoming
   * fields win, insertion order preserved). Realization semantics: one
   * identity per `(connectorId, externalRef)` pair — duplicate reports are
   * deduplicated KEEPING THE FRESHEST (embedded ULID timestamp of the
   * realization id; ties broken by later report). Returns an `IngestSummary`.
   */
  ingest(
    items: readonly RetrievalItemInput[],
    realizations: readonly SourceRealization[],
    labels?: RetrievalLabels,
  ): IngestSummary {
    if (!Array.isArray(items)) {
      throw new RetrievalError(
        `items: expected an array of EntertainmentItem, got ${previewValue(items)}`,
      );
    }
    if (!Array.isArray(realizations)) {
      throw new RetrievalError(
        `realizations: expected an array of SourceRealization, got ${previewValue(realizations)}`,
      );
    }
    if (labels !== undefined && !isRecord(labels)) {
      throw new RetrievalError(
        `labels: expected a RetrievalLabels object, got ${previewValue(labels)}`,
      );
    }

    // --- validate everything BEFORE mutating anything (all-or-nothing) -----
    const errors: string[] = [];
    for (const [index, item] of items.entries()) {
      errors.push(...itemErrors(item, index, "items"));
    }
    for (const [index, realization] of realizations.entries()) {
      const result = validateSourceRealization(realization);
      if (!result.ok) {
        errors.push(...result.errors.map((error) => `realizations[${index}]: ${error}`));
      }
    }
    errors.push(...labelErrors(labels));
    if (errors.length > 0) throw new RetrievalError(errors);

    // Orphan check: every realization must attach to a known-or-new item.
    const knownIds = new Set<string>(this.items.keys());
    for (const item of items) {
      knownIds.add(item.id);
    }
    for (const [index, realization] of realizations.entries()) {
      if (!knownIds.has(realization.entertainmentItemId)) {
        errors.push(
          `realizations[${index}].entertainmentItemId: item ${realization.entertainmentItemId} is not known to this index (this call or an earlier ingest) — the index never invents canonical identities`,
        );
      }
    }

    // Cross-item pair conflict check (within this call AND against stored pairs).
    const claimedBy = new Map<string, string>();
    for (const [pairKey, stored] of this.realizations) {
      claimedBy.set(pairKey, stored.realization.entertainmentItemId);
    }
    for (const [index, realization] of realizations.entries()) {
      const pairKey = realizationRefKey(realization);
      const owner = claimedBy.get(pairKey);
      if (owner !== undefined && owner !== realization.entertainmentItemId) {
        errors.push(
          `realizations[${index}]: (${realization.connectorId}, ${realization.externalRef}) is already realized by item ${owner}, got a report for item ${realization.entertainmentItemId} — one source record realizes exactly one canonical identity`,
        );
      } else if (owner === undefined) {
        claimedBy.set(pairKey, realization.entertainmentItemId);
      }
    }
    if (errors.length > 0) throw new RetrievalError(errors);

    // --- apply: items (insert or merge) ------------------------------------
    let itemsInserted = 0;
    for (const item of items) {
      const existing = this.items.get(item.id);
      if (existing === undefined) {
        this.items.set(item.id, {
          item: { ...item },
          realizationKeys: [],
        });
        itemsInserted += 1;
      } else {
        this.applyItemUpdate(existing, item);
      }
    }

    // --- apply: labels -------------------------------------------------------
    if (labels?.creatorNames !== undefined && isRecord(labels.creatorNames)) {
      for (const [key, name] of Object.entries(labels.creatorNames)) {
        this.creatorNames.set(key, name as string);
      }
    }
    if (labels?.topicLabels !== undefined && isRecord(labels.topicLabels)) {
      for (const [key, label] of Object.entries(labels.topicLabels)) {
        this.topicLabels.set(key, label as string);
      }
    }

    // --- apply: realizations (freshest-wins dedupe) --------------------------
    let realizationsAttached = 0;
    let realizationsDeduplicated = 0;
    for (const realization of realizations) {
      const pairKey = realizationRefKey(realization);
      const stored = this.realizations.get(pairKey);
      const incoming = cloneRealization(realization);
      this.reportSeq += 1;

      if (stored === undefined) {
        this.realizations.set(pairKey, { realization: incoming, reportSeq: this.reportSeq });
        this.attachPairToItem(realization.entertainmentItemId, pairKey);
        realizationsAttached += 1;
        continue;
      }
      // Freshest wins: embedded ULID timestamp first, report sequence as tiebreak.
      const incomingTime = ulidTimestamp(incoming.id);
      const storedTime = ulidTimestamp(stored.realization.id);
      const incomingIsFresher =
        incomingTime !== null && storedTime !== null
          ? incomingTime > storedTime ||
            (incomingTime === storedTime && this.reportSeq > stored.reportSeq)
          : this.reportSeq > stored.reportSeq; // defensive: validated ids always decode
      if (incomingIsFresher) {
        this.realizations.set(pairKey, { realization: incoming, reportSeq: this.reportSeq });
      }
      realizationsDeduplicated += 1;
    }

    return { itemsInserted, realizationsAttached, realizationsDeduplicated };
  }

  /**
   * Query the index. Returns matching `RetrievedCandidate`s in deterministic
   * order: item insertion order, then realization order within each item,
   * truncated to `limit`. An empty index returns `[]` — emptiness is a result,
   * not an error. Invalid query shapes throw a typed `RetrievalError` with
   * field-level details.
   */
  query(q: RetrievalQuery): RetrievedCandidate[] {
    const errors = queryErrors(q);
    if (errors.length > 0) throw new RetrievalError(errors);

    const out: RetrievedCandidate[] = [];
    for (const stored of this.items.values()) {
      if (!this.itemPasses(stored, q)) continue;

      const allRealizations = this.realizationsOf(stored);
      const eligible = allRealizations.filter(
        (realization) =>
          (q.connectorId === undefined || realization.connectorId === q.connectorId) &&
          (q.requiredCapability === undefined ||
            realization.capabilities.includes(q.requiredCapability)),
      );
      for (const realization of eligible) {
        if (out.length >= q.limit) break;
        out.push(this.buildCandidate(stored, allRealizations, realization));
      }
      if (out.length >= q.limit) break;
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Fold a validated incoming item into the live stored item (in place). */
  private applyItemUpdate(existing: StoredItem, incoming: RetrievalItemInput): void {
    existing.item.canonicalType = incoming.canonicalType;
    if (incoming.canonicalTitle !== undefined) existing.item.canonicalTitle = incoming.canonicalTitle;
    if (incoming.durationMs !== undefined) existing.item.durationMs = incoming.durationMs;
    if (incoming.orientation !== undefined) existing.item.orientation = incoming.orientation;
    if (incoming.creators !== undefined) existing.item.creators = [...incoming.creators];
    if (incoming.topics !== undefined) existing.item.topics = [...incoming.topics];
  }

  /** Record a pair key on its item's attach list (idempotent, order-stable). */
  private attachPairToItem(itemId: string, pairKey: string): void {
    const stored = this.items.get(itemId);
    if (stored === undefined) return; // defensive: orphan check ran before
    if (!stored.realizationKeys.includes(pairKey)) stored.realizationKeys.push(pairKey);
  }

  /** Frozen copies of every realization attached to the item (attach order). */
  private realizationsOf(stored: StoredItem): SourceRealization[] {
    const out: SourceRealization[] = [];
    for (const pairKey of stored.realizationKeys) {
      const entry = this.realizations.get(pairKey);
      if (entry !== undefined) out.push(entry.realization); // already frozen
    }
    return out;
  }

  /** Item-level filters: type, orientation, duration window, tokenized text. */
  private itemPasses(stored: StoredItem, q: RetrievalQuery): boolean {
    const item = stored.item;
    if (q.canonicalType !== undefined && item.canonicalType !== q.canonicalType) return false;
    if (q.orientation !== undefined && item.orientation !== q.orientation) return false;
    if (q.durationRangeMs !== undefined) {
      if (item.durationMs === undefined) return false;
      const { minMs, maxMs } = q.durationRangeMs;
      if (minMs !== undefined && item.durationMs < minMs) return false;
      if (maxMs !== undefined && item.durationMs > maxMs) return false;
    }
    if (q.text !== undefined) {
      const tokens = q.text.toLowerCase().split(/\s+/).filter((token) => token.length > 0);
      const matchText = this.matchTextOf(stored);
      if (!tokens.every((token) => matchText.includes(token))) return false;
    }
    return true;
  }

  /**
   * The per-item match surface: lowercase space-join of the canonical title,
   * resolved creator names, resolved topic labels, canonicalType, and
   * orientation (when present). Type and orientation are included so
   * type-level queries ("audio", "vertical") are honestly matchable. Unknown
   * enrichment references contribute nothing (a query, not an error — mirrors
   * the graph store's reference-before-registry law).
   */
  private matchTextOf(stored: StoredItem): string {
    const parts: string[] = [];
    if (stored.item.canonicalTitle !== undefined) parts.push(stored.item.canonicalTitle);
    for (const creatorId of stored.item.creators ?? []) {
      const name = this.creatorNames.get(creatorId);
      if (name !== undefined) parts.push(name);
    }
    for (const topicId of stored.item.topics ?? []) {
      const label = this.topicLabels.get(topicId);
      if (label !== undefined) parts.push(label);
    }
    parts.push(stored.item.canonicalType);
    if (stored.item.orientation !== undefined) parts.push(stored.item.orientation);
    return parts.join(" ").toLowerCase();
  }

  /** Assemble one frozen RetrievedCandidate from an eligible realization. */
  private buildCandidate(
    stored: StoredItem,
    allRealizations: readonly SourceRealization[],
    realization: SourceRealization,
  ): RetrievedCandidate {
    const matchText = this.matchTextOf(stored);
    const features: Record<string, number | string | boolean> = {
      canonicalType: stored.item.canonicalType,
      realizationCount: allRealizations.length,
      capabilityCount: realization.capabilities.length,
      availability: realization.availability,
      matchText,
    };
    if (stored.item.canonicalTitle !== undefined) features.canonicalTitle = stored.item.canonicalTitle;
    if (stored.item.durationMs !== undefined) features.durationMs = stored.item.durationMs;
    if (stored.item.orientation !== undefined) features.orientation = stored.item.orientation;

    const candidate = Object.freeze({
      itemId: stored.item.id,
      realization: Object.freeze({
        connectorId: realization.connectorId,
        externalRef: realization.externalRef,
        capabilities: Object.freeze([...realization.capabilities]) as string[],
        availability: realization.availability,
      }),
      features: Object.freeze(features),
    });

    return Object.freeze({
      candidate,
      sourceRealizations: frozenArray(allRealizations),
      matchedObjectives: frozenArray<string>([]),
      retrievedAt: this.retrievedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Query shape validation
// ---------------------------------------------------------------------------

/** Field-level validation of a `RetrievalQuery`; returns aggregated errors. */
function queryErrors(q: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(q)) {
    errors.push(`query: expected a RetrievalQuery object, got ${previewValue(q)}`);
    return errors;
  }

  if (typeof q.limit !== "number" || !Number.isInteger(q.limit) || q.limit < 1) {
    errors.push(
      `limit: expected a positive integer, got ${previewValue(q.limit)}`,
    );
  }
  if (q.text !== undefined) {
    if (typeof q.text !== "string" || q.text.trim().length === 0) {
      errors.push(
        `text: expected a non-empty string after trimming when present, got ${previewValue(q.text)}`,
      );
    }
  }
  if (q.canonicalType !== undefined && !isMemberOf(CANONICAL_TYPES, q.canonicalType)) {
    errors.push(
      `canonicalType: expected one of ${CANONICAL_TYPES.join(" | ")} when present, got ${previewValue(q.canonicalType)}`,
    );
  }
  if (q.orientation !== undefined && !isMemberOf(ORIENTATIONS, q.orientation)) {
    errors.push(
      `orientation: expected one of ${ORIENTATIONS.join(" | ")} when present, got ${previewValue(q.orientation)}`,
    );
  }
  if (q.durationRangeMs !== undefined) {
    const range = q.durationRangeMs;
    if (!isRecord(range)) {
      errors.push(
        `durationRangeMs: expected a DurationRange object when present, got ${previewValue(range)}`,
      );
    } else {
      if (range.minMs === undefined && range.maxMs === undefined) {
        errors.push(
          `durationRangeMs: expected at least one of minMs/maxMs — a boundless range carries no constraint`,
        );
      }
      for (const bound of ["minMs", "maxMs"] as const) {
        const value = range[bound];
        if (
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        ) {
          errors.push(
            `durationRangeMs.${bound}: expected a non-negative finite number when present, got ${previewValue(value)}`,
          );
        }
      }
      if (
        typeof range.minMs === "number" &&
        typeof range.maxMs === "number" &&
        range.minMs > range.maxMs
      ) {
        errors.push(
          `durationRangeMs: minMs (${range.minMs}) must not exceed maxMs (${range.maxMs})`,
        );
      }
    }
  }
  if (q.connectorId !== undefined) {
    if (typeof q.connectorId !== "string" || q.connectorId.trim().length === 0) {
      errors.push(
        `connectorId: expected a non-empty string when present, got ${previewValue(q.connectorId)}`,
      );
    }
  }
  if (q.requiredCapability !== undefined && !isMemberOf(CAPABILITIES, q.requiredCapability)) {
    errors.push(
      `requiredCapability: expected one of ${CAPABILITIES.join(" | ")} when present, got ${previewValue(q.requiredCapability)}`,
    );
  }
  return errors;
}
