/**
 * EntertainmentGraph — the in-memory canonical content graph store (WFX-010,
 * Lane A).
 *
 * Semantics (all lead-visible, all enforced):
 *
 * - Boundary: pure data operations only — no I/O, no provider calls, no
 *   persistence (server persistence is a later work item), no clock-driven
 *   fields except `updatedAt` refreshes on store mutations. The store is the
 *   canonical side of "one content identity, many realizations": items are
 *   keyed by their canonical `wfxitm_` identity and hold the union of all
 *   source realizations reported for them.
 * - Validation: every mutation validates its input with the existing
 *   validators where applicable (`validateEntertainmentItem`,
 *   `validateSourceRealization` from validation.ts) plus graph-specific
 *   invariants, and throws a typed `GraphError` (kind "invalid-input",
 *   aggregated field-level details) on bad input — never a silent coercion.
 *   Graph-specific invariants: `creators` must be `wfxcre_` ids, `topics`
 *   must be `wfxtop_` ids, `createdAt`/`updatedAt` must be full ISO 8601
 *   strings, and every realization on an item must point back at that item's
 *   id.
 * - Mutations referencing unknown items (`upsertRealization`, `relate`) are
 *   invalid input — the store never invents canonical identities. Queries
 *   about absent data (`item`, `byCreator`, `byTopic`, `search`,
 *   `realizationsOf`, `neighbors`) are NOT errors: they return
 *   `undefined` / empty results. Only malformed arguments throw.
 * - Realization identity is the `(connectorId, externalRef)` pair: an item
 *   never holds two realizations with the same pair. Re-reporting a pair
 *   MERGES into the existing realization (`mergeRealizations` from dedupe.ts:
 *   stable id, capability union, "unknown" availability defers to a definite
 *   value, primary wins conflicts). Stale ids never dangle: merging items
 *   retargets every realization to the surviving identity.
 * - `upsertItem` on an existing id is a merge-update (the canonical graph
 *   accumulates knowledge; it never forgets): defined incoming scalar fields
 *   win, `creators`/`topics`/`realizations` union, `createdAt` keeps the
 *   earliest instant, `updatedAt` the latest (deterministic, data-driven).
 *   Insert keeps caller-supplied timestamps verbatim — the store only stamps
 *   `updatedAt` itself on `upsertRealization` (the mutation has no
 *   caller-side timestamp).
 * - `relate` stores directed, labeled edges with set semantics: the same
 *   (from, to, relation) triple is stored once; re-relating is an idempotent
 *   no-op returning the existing edge. Self-edges are rejected (an item is
 *   not part of / related to itself). The store never derives inverse edges —
 *   relationship direction is caller-stated data; only TRAVERSAL
 *   (`neighbors`) is direction-agnostic.
 * - Reads are defensive: every returned entity is a deep frozen copy —
 *   mutating a returned item, array, or realization cannot corrupt the store.
 *   Result ordering is deterministic (Map insertion order).
 * - Creator/topic registries (`upsertCreator`/`upsertTopic`) hold the
 *   canonical entity records by `wfxcre_`/`wfxtop_` id. `byCreator`/
 *   `byTopic` resolve over item REFERENCE lists (references may exist before
 *   their registry records are upserted); the registries themselves are
 *   written by this work item and read by later ones.
 */

import type { SourceRealization } from "../contracts/frozen";
import { type EntertainmentItemId, isEntertainmentItemId } from "../ids";
import {
  isIso8601,
  isRecord,
  previewValue,
  validateEntertainmentItem,
  validateSourceRealization,
} from "../validation";
import { mergeRealizations } from "./dedupe";
import {
  CREATOR_KINDS,
  GraphError,
  ITEM_RELATIONS,
  isCreatorId,
  isCreatorKind,
  isItemRelation,
  isTopicId,
  type Creator,
  type CreatorId,
  type GraphItem,
  type ItemRelation,
  type ItemRelationship,
  type Topic,
  type TopicId,
} from "./model";

// ---------------------------------------------------------------------------
// Internal copy helpers
// ---------------------------------------------------------------------------

/** Freeze an array without widening its static type (runtime immutability). */
function frozenArray<T>(values: readonly T[]): T[] {
  return Object.freeze([...values]) as T[];
}

/** Private frozen copy of a realization (defensive on the way IN as well). */
function cloneRealization(realization: SourceRealization): SourceRealization {
  return Object.freeze({
    ...realization,
    capabilities: frozenArray(realization.capabilities),
  });
}

/** Frozen deep copy of an item for reads — the store keeps the live object. */
function readItem(item: GraphItem): GraphItem {
  return Object.freeze({
    ...item,
    creators: frozenArray(item.creators),
    topics: frozenArray(item.topics),
    // Realization objects are already frozen internally (never mutated in
    // place, only replaced) — sharing them in a fresh frozen array is safe.
    realizations: frozenArray(item.realizations),
  });
}

/**
 * Merge `incoming` into a realization list by `(connectorId, externalRef)`
 * identity: append when new, otherwise merge into the existing entry.
 * Returns the realization as stored. The list is mutated (internal state).
 */
function mergeRealizationInto(
  list: SourceRealization[],
  incoming: SourceRealization,
): SourceRealization {
  const index = list.findIndex(
    (existing) =>
      existing.connectorId === incoming.connectorId &&
      existing.externalRef === incoming.externalRef,
  );
  if (index === -1) {
    list.push(incoming);
    return incoming;
  }
  const existing = list[index];
  if (existing === undefined) {
    list.push(incoming);
    return incoming;
  }
  const merged = mergeRealizations(existing, incoming);
  list[index] = merged;
  return merged;
}

// ---------------------------------------------------------------------------
// Argument guards
// ---------------------------------------------------------------------------

function assertItemId(value: unknown): void {
  if (!isEntertainmentItemId(value)) {
    throw new GraphError(
      `id: expected an entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(value)}`,
    );
  }
}

function assertCreatorId(value: unknown): void {
  if (!isCreatorId(value)) {
    throw new GraphError(
      `creatorId: expected a creator ID (wfxcre_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(value)}`,
    );
  }
}

function assertTopicId(value: unknown): void {
  if (!isTopicId(value)) {
    throw new GraphError(
      `topicId: expected a topic ID (wfxtop_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(value)}`,
    );
  }
}

/**
 * Full shape validation of a `GraphItem` argument: the frozen
 * EntertainmentItem fields via `validateEntertainmentItem`, the frozen
 * realization fields via `validateSourceRealization`, plus the graph's own
 * invariants (creator/topic id arrays, ISO 8601 timestamps, realizations
 * attaching back to the item). Throws a single aggregated `GraphError`.
 */
function assertValidItem(input: unknown): void {
  if (!isRecord(input)) {
    throw new GraphError(`item: expected a GraphItem object, got ${previewValue(input)}`);
  }
  const errors: string[] = [];

  const base = validateEntertainmentItem(input);
  if (!base.ok) errors.push(...base.errors);

  if (Array.isArray(input.creators)) {
    for (const [index, creatorId] of input.creators.entries()) {
      if (!isCreatorId(creatorId)) {
        errors.push(
          `creators[${index}]: expected a creator ID (wfxcre_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(creatorId)}`,
        );
      }
    }
  } else {
    errors.push(
      `creators: expected an array of creator ids, got ${previewValue(input.creators)}`,
    );
  }

  if (Array.isArray(input.topics)) {
    for (const [index, topicId] of input.topics.entries()) {
      if (!isTopicId(topicId)) {
        errors.push(
          `topics[${index}]: expected a topic ID (wfxtop_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(topicId)}`,
        );
      }
    }
  } else {
    errors.push(`topics: expected an array of topic ids, got ${previewValue(input.topics)}`);
  }

  if (Array.isArray(input.realizations)) {
    for (const [index, realization] of input.realizations.entries()) {
      const result = validateSourceRealization(realization);
      if (!result.ok) {
        errors.push(...result.errors.map((error) => `realizations[${index}]: ${error}`));
        continue;
      }
      if (realization.entertainmentItemId !== input.id) {
        errors.push(
          `realizations[${index}].entertainmentItemId: expected ${previewValue(input.id)} (this item's id), got ${previewValue(realization.entertainmentItemId)}`,
        );
      }
    }
  } else {
    errors.push(
      `realizations: expected an array of SourceRealization, got ${previewValue(input.realizations)}`,
    );
  }

  if (!isIso8601(input.createdAt)) {
    errors.push(
      `createdAt: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-13T10:30:00.000Z), got ${previewValue(input.createdAt)}`,
    );
  }
  if (!isIso8601(input.updatedAt)) {
    errors.push(
      `updatedAt: expected an ISO 8601 datetime string with explicit offset (e.g. 2026-09-13T10:30:00.000Z), got ${previewValue(input.updatedAt)}`,
    );
  }

  if (errors.length > 0) throw new GraphError(errors);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * The in-memory Entertainment Graph.
 *
 * Create with `new EntertainmentGraph()`. Items are keyed by canonical
 * `wfxitm_` identity; creators, topics, and directed item relationships live
 * in their own registries. All reads return frozen deep copies; all results
 * follow Map insertion order (deterministic).
 */
export class EntertainmentGraph {
  /** Canonical items by id — live internal objects (never handed out). */
  private readonly items = new Map<EntertainmentItemId, GraphItem>();
  /** Canonical creator registry by `wfxcre_` id (frozen records). */
  private readonly creators = new Map<CreatorId, Creator>();
  /** Canonical topic registry by `wfxtop_` id (frozen records). */
  private readonly topics = new Map<TopicId, Topic>();
  /** Directed relationship edges, keyed by the (from, to, relation) triple. */
  private readonly relationships = new Map<string, ItemRelationship>();

  /**
   * Insert or merge-update an item by canonical id. First sight inserts the
   * item (timestamps kept verbatim, realizations deduped by
   * `(connectorId, externalRef)`); a re-upsert MERGES: defined incoming
   * scalar fields win, `creators`/`topics`/`realizations` union, `createdAt`
   * keeps the earliest instant, `updatedAt` the latest. Returns a frozen copy
   * of the stored item. Throws `GraphError` (kind "invalid-input", aggregated
   * details) on malformed input.
   */
  upsertItem(item: GraphItem): GraphItem {
    assertValidItem(item);
    const existing = this.items.get(item.id);
    if (existing === undefined) {
      const stored = this.internalizeItem(item);
      this.items.set(item.id, stored);
      return readItem(stored);
    }
    this.applyItemUpdate(existing, item);
    return readItem(existing);
  }

  /**
   * Add or merge one source realization onto an existing item. The
   * realization's `entertainmentItemId` must equal `itemId` (the addressed
   * canonical identity), and the item must already exist — the store never
   * invents identities. Realizations are deduped per `(connectorId,
   * externalRef)`: a re-report merges into the stored realization (stable id,
   * capability union, "unknown" availability defers to a definite value).
   * Refreshes the item's `updatedAt` to now. Returns the realization as
   * stored (frozen). Throws `GraphError` on malformed input or an
   * unknown/mismatched item.
   */
  upsertRealization(itemId: EntertainmentItemId, realization: SourceRealization): SourceRealization {
    assertItemId(itemId);
    const result = validateSourceRealization(realization);
    if (!result.ok) throw new GraphError(result.errors);

    const item = this.items.get(itemId);
    if (item === undefined) {
      throw new GraphError(`itemId: item ${itemId} does not exist in this graph`);
    }
    if (realization.entertainmentItemId !== itemId) {
      throw new GraphError(
        `realization.entertainmentItemId: expected ${itemId} (the addressed item), got ${previewValue(realization.entertainmentItemId)}`,
      );
    }

    const stored = mergeRealizationInto(item.realizations, cloneRealization(realization));
    item.updatedAt = new Date().toISOString();
    return stored;
  }

  /**
   * Insert or update a canonical creator by `wfxcre_` id (name/kind are
   * replaced on re-upsert; the name is stored trimmed). Returns the frozen
   * stored record. Throws `GraphError` on malformed input.
   */
  upsertCreator(creator: Creator): Creator {
    if (!isRecord(creator)) {
      throw new GraphError(`creator: expected a Creator object, got ${previewValue(creator)}`);
    }
    const errors: string[] = [];
    if (!isCreatorId(creator.id)) {
      errors.push(
        `id: expected a creator ID (wfxcre_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(creator.id)}`,
      );
    }
    const name = typeof creator.name === "string" ? creator.name.trim() : "";
    if (name.length === 0) {
      errors.push(`name: expected a non-empty string after trimming, got ${previewValue(creator.name)}`);
    }
    if (!isCreatorKind(creator.kind)) {
      errors.push(
        `kind: expected one of ${CREATOR_KINDS.join(" | ")}, got ${previewValue(creator.kind)}`,
      );
    }
    if (errors.length > 0) throw new GraphError(errors);

    const stored: Creator = Object.freeze({ id: creator.id, name, kind: creator.kind });
    this.creators.set(creator.id, stored);
    return stored;
  }

  /**
   * Insert or update a canonical topic by `wfxtop_` id (the label is replaced
   * on re-upsert and stored trimmed). Returns the frozen stored record.
   * Throws `GraphError` on malformed input.
   */
  upsertTopic(topic: Topic): Topic {
    if (!isRecord(topic)) {
      throw new GraphError(`topic: expected a Topic object, got ${previewValue(topic)}`);
    }
    const errors: string[] = [];
    if (!isTopicId(topic.id)) {
      errors.push(
        `id: expected a topic ID (wfxtop_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(topic.id)}`,
      );
    }
    const label = typeof topic.label === "string" ? topic.label.trim() : "";
    if (label.length === 0) {
      errors.push(`label: expected a non-empty string after trimming, got ${previewValue(topic.label)}`);
    }
    if (errors.length > 0) throw new GraphError(errors);

    const stored: Topic = Object.freeze({ id: topic.id, label });
    this.topics.set(topic.id, stored);
    return stored;
  }

  /**
   * Add a directed, labeled relationship edge between two existing items.
   * Set semantics: the (from, to, relation) triple is stored once —
   * re-relating is an idempotent no-op that returns the existing edge.
   * Self-edges (from === to) are rejected. Inverse edges are NEVER derived.
   * Returns a frozen copy of the stored relationship. Throws `GraphError` on
   * malformed input or unknown items.
   */
  relate(fromItemId: EntertainmentItemId, toItemId: EntertainmentItemId, relation: ItemRelation): ItemRelationship {
    assertItemId(fromItemId);
    assertItemId(toItemId);
    if (!isItemRelation(relation)) {
      throw new GraphError(
        `relation: expected one of ${ITEM_RELATIONS.join(" | ")}, got ${previewValue(relation)}`,
      );
    }
    if (fromItemId === toItemId) {
      throw new GraphError(
        `relation: an item cannot be related to itself (from and to are both ${fromItemId})`,
      );
    }
    if (!this.items.has(fromItemId)) {
      throw new GraphError(`fromItemId: item ${fromItemId} does not exist in this graph`);
    }
    if (!this.items.has(toItemId)) {
      throw new GraphError(`toItemId: item ${toItemId} does not exist in this graph`);
    }

    const key = JSON.stringify([fromItemId, toItemId, relation]);
    const existing = this.relationships.get(key);
    if (existing !== undefined) return Object.freeze({ ...existing });

    const relationship: ItemRelationship = { fromItemId, toItemId, relation };
    this.relationships.set(key, relationship);
    return Object.freeze({ ...relationship });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Fetch one item by canonical id. Returns a frozen deep copy, or
   * `undefined` when no such item exists (a query, not an error). Malformed
   * ids throw `GraphError`.
   */
  item(id: EntertainmentItemId): GraphItem | undefined {
    assertItemId(id);
    const stored = this.items.get(id);
    return stored === undefined ? undefined : readItem(stored);
  }

  /**
   * All items referencing a creator (insertion order). The creator registry
   * record itself need not exist — the query resolves over item reference
   * lists. Unknown creators return an empty list (a query, not an error).
   * Malformed ids throw `GraphError`.
   */
  byCreator(creatorId: CreatorId): GraphItem[] {
    assertCreatorId(creatorId);
    const out: GraphItem[] = [];
    for (const stored of this.items.values()) {
      if (stored.creators.includes(creatorId)) out.push(readItem(stored));
    }
    return out;
  }

  /**
   * All items referencing a topic (insertion order). Unknown topics return an
   * empty list (a query, not an error). Malformed ids throw `GraphError`.
   */
  byTopic(topicId: TopicId): GraphItem[] {
    assertTopicId(topicId);
    const out: GraphItem[] = [];
    for (const stored of this.items.values()) {
      if (stored.topics.includes(topicId)) out.push(readItem(stored));
    }
    return out;
  }

  /**
   * Case-insensitive substring search over `canonicalTitle` (insertion
   * order). Items without a title never match. A query that is empty after
   * trimming is invalid input (an empty needle is a caller bug, not a
   * match-all). The needle is NOT trimmed for matching — spaces are
   * significant. Throws `GraphError` on a malformed query.
   */
  search(titleSubstring: string): GraphItem[] {
    if (typeof titleSubstring !== "string" || titleSubstring.trim().length === 0) {
      throw new GraphError(
        `titleSubstring: expected a non-empty string, got ${previewValue(titleSubstring)}`,
      );
    }
    const needle = titleSubstring.toLowerCase();
    const out: GraphItem[] = [];
    for (const stored of this.items.values()) {
      if (stored.canonicalTitle !== undefined && stored.canonicalTitle.toLowerCase().includes(needle)) {
        out.push(readItem(stored));
      }
    }
    return out;
  }

  /**
   * All source realizations of an item (frozen copies, insertion order).
   * Unknown items return an empty list (a query, not an error). Malformed ids
   * throw `GraphError`.
   */
  realizationsOf(itemId: EntertainmentItemId): SourceRealization[] {
    assertItemId(itemId);
    const stored = this.items.get(itemId);
    return stored === undefined ? [] : frozenArray(stored.realizations);
  }

  /**
   * One-hop neighborhood of an item via relationships, in relationship
   * insertion order, deduplicated. Traversal is direction-agnostic: an edge
   * is reachable from both endpoints regardless of its direction. Unknown
   * items return an empty list (a query, not an error). Malformed ids throw
   * `GraphError`.
   */
  neighbors(itemId: EntertainmentItemId): GraphItem[] {
    assertItemId(itemId);
    const out: GraphItem[] = [];
    const seen = new Set<string>();
    for (const relationship of this.relationships.values()) {
      const otherId =
        relationship.fromItemId === itemId
          ? relationship.toItemId
          : relationship.toItemId === itemId
            ? relationship.fromItemId
            : undefined;
      if (otherId === undefined || seen.has(otherId)) continue;
      const other = this.items.get(otherId);
      if (other === undefined) continue; // defensive: edges always reference stored items
      seen.add(otherId);
      out.push(readItem(other));
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Internal update paths
  // -------------------------------------------------------------------------

  /** Build the live internal copy of a validated item (arrays owned by the store). */
  private internalizeItem(item: GraphItem): GraphItem {
    const realizations: SourceRealization[] = [];
    for (const realization of item.realizations) {
      mergeRealizationInto(realizations, cloneRealization(realization));
    }
    return {
      ...item,
      creators: [...item.creators],
      topics: [...item.topics],
      realizations,
    };
  }

  /** Fold a validated incoming item into the live stored item (in place). */
  private applyItemUpdate(existing: GraphItem, incoming: GraphItem): void {
    existing.canonicalType = incoming.canonicalType;
    if (incoming.canonicalTitle !== undefined) existing.canonicalTitle = incoming.canonicalTitle;
    if (incoming.durationMs !== undefined) existing.durationMs = incoming.durationMs;
    if (incoming.orientation !== undefined) existing.orientation = incoming.orientation;

    for (const creatorId of incoming.creators) {
      if (!existing.creators.includes(creatorId)) existing.creators.push(creatorId);
    }
    for (const topicId of incoming.topics) {
      if (!existing.topics.includes(topicId)) existing.topics.push(topicId);
    }
    for (const realization of incoming.realizations) {
      mergeRealizationInto(existing.realizations, cloneRealization(realization));
    }

    // Deterministic, data-driven timestamps: earliest createdAt, latest updatedAt.
    if (Date.parse(incoming.createdAt) < Date.parse(existing.createdAt)) {
      existing.createdAt = incoming.createdAt;
    }
    if (Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)) {
      existing.updatedAt = incoming.updatedAt;
    }
  }
}
