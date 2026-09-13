/**
 * Entertainment Graph entities (WFX-010, Lane A — intelligence).
 *
 * The frozen contracts (docs/architecture/contracts.md — "Entertainment Graph")
 * define the canonical trio `EntertainmentItem` / `SourceRealization` /
 * `EntertainmentEvent`. The frozen architecture fixes the graph's boundary:
 * the canonical entity graph for content, creators, topics, source
 * realizations, relationships, events, and derived features, under the
 * invariant "one content identity, many realizations — source is a
 * realization, not the canonical identity". Those contracts are the law; this
 * module extends them with graph-owned entities and never redefines them.
 *
 * Entities defined here:
 * - `Creator` — person | group | channel | studio, keyed by a `wfxcre_` id.
 * - `Topic` — a labeled content topic, keyed by a `wfxtop_` id.
 * - `ItemRelationship` — a directed, labeled edge between two canonical items
 *   (partOf | sequelOf | prequelOf | sameSeries | relatedTo | adaptationOf).
 * - `GraphItem` — the frozen `EntertainmentItem` plus graph bookkeeping:
 *   creator/topic references, the item's source realizations, and creation /
 *   update timestamps. `id` is narrowed to the canonical branded
 *   `EntertainmentItemId` from ids.ts (WFX-002) — the canonical identity, per
 *   the one-identity-many-realizations invariant.
 * - `GraphEvent` — the frozen `EntertainmentEvent` plus an optional reference
 *   to the `wfxevt_` envelope id when the event entered the graph wrapped in
 *   an `EventEnvelope` (events.ts).
 *
 * ID branding: ids.ts is off-limits (WFX-002 shipped it), so the two
 * graph-owned id kinds (`wfxcre_`, `wfxtop_`) are branded HERE, following the
 * exact canonical scheme from ids.ts — prefix + 26-char Crockford Base32
 * ULID body, minted with the shared `generateUlid` (no duplicate generator
 * logic, only the prefix layer is new). The existing canonical
 * `EntertainmentItemId` / `SourceRealizationId` brands are adopted from
 * ids.ts by import — same bindings, no shadowing.
 */

import type { EntertainmentEvent, EntertainmentItem, SourceRealization } from "../contracts/frozen";
import { generateUlid, type EntertainmentItemId } from "../ids";

// ---------------------------------------------------------------------------
// Graph-owned ID kinds (wfxcre_ / wfxtop_) — canonical scheme, graph-scoped
// ---------------------------------------------------------------------------

/** Canonical creator ID: `wfxcre_` + ULID body (same scheme as ids.ts). */
export type CreatorId = string & { readonly __wfxIdKind: "CreatorId" };
/** Canonical topic ID: `wfxtop_` + ULID body (same scheme as ids.ts). */
export type TopicId = string & { readonly __wfxIdKind: "TopicId" };

export const CREATOR_ID_PREFIX = "wfxcre_";
export const TOPIC_ID_PREFIX = "wfxtop_";

/**
 * 26-char ULID body pattern (mirrors the private constant in ids.ts — that
 * module deliberately exports only the *canonical* id kinds, so the graph
 * module keeps its own copy of the body grammar for its guards). First char
 * restricted to 0-7 by the 48-bit timestamp bound.
 */
const ULID_BODY_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Mint a fresh canonical creator ID: `wfxcre_` + ULID body. */
export function newCreatorId(): CreatorId {
  return `${CREATOR_ID_PREFIX}${generateUlid()}` as CreatorId;
}

/** Mint a fresh canonical topic ID: `wfxtop_` + ULID body. */
export function newTopicId(): TopicId {
  return `${TOPIC_ID_PREFIX}${generateUlid()}` as TopicId;
}

/** Structural guard: `wfxcre_` prefix followed by a valid 26-char ULID body. */
export function isCreatorId(value: unknown): value is CreatorId {
  return (
    typeof value === "string" &&
    value.startsWith(CREATOR_ID_PREFIX) &&
    ULID_BODY_RE.test(value.slice(CREATOR_ID_PREFIX.length))
  );
}

/** Structural guard: `wfxtop_` prefix followed by a valid 26-char ULID body. */
export function isTopicId(value: unknown): value is TopicId {
  return (
    typeof value === "string" &&
    value.startsWith(TOPIC_ID_PREFIX) &&
    ULID_BODY_RE.test(value.slice(TOPIC_ID_PREFIX.length))
  );
}

// ---------------------------------------------------------------------------
// Creator / Topic
// ---------------------------------------------------------------------------

/** Compile-time check that `Values` covers every member of the frozen `Union`. */
type Covers<Union extends string, Values extends readonly string[]> = [Union] extends [
  Values[number],
]
  ? unknown
  : never;

/** The creator kinds this module understands (closed vocabulary). */
export type CreatorKind = "person" | "group" | "channel" | "studio";

export const CREATOR_KINDS = [
  "person",
  "group",
  "channel",
  "studio",
] as const satisfies readonly CreatorKind[];
const _creatorKindsCover: Covers<CreatorKind, typeof CREATOR_KINDS> = null;

/** Structural guard: is this unknown value one of the creator kinds? */
export function isCreatorKind(value: unknown): value is CreatorKind {
  return typeof value === "string" && (CREATOR_KINDS as readonly string[]).includes(value);
}

/**
 * A canonical creator entity. Creators are referenced by id from `GraphItem`
 * `creators` lists; this record carries the display identity (`name`) and the
 * entity kind. One creator identity may be realized on many sources — the
 * graph keeps it canonical, exactly like content.
 */
export interface Creator {
  /** Canonical creator identity: `wfxcre_` prefix + 26-char ULID body. */
  id: CreatorId;
  /** Display name; stored trimmed, non-empty. */
  name: string;
  kind: CreatorKind;
}

/** A canonical topic entity (labeled content taxonomy node). */
export interface Topic {
  /** Canonical topic identity: `wfxtop_` prefix + 26-char ULID body. */
  id: TopicId;
  /** Topic label; stored trimmed, non-empty. */
  label: string;
}

// ---------------------------------------------------------------------------
// Item relationships
// ---------------------------------------------------------------------------

/** Directed relationship kinds between two canonical items (closed vocabulary). */
export type ItemRelation =
  | "partOf"
  | "sequelOf"
  | "prequelOf"
  | "sameSeries"
  | "relatedTo"
  | "adaptationOf";

export const ITEM_RELATIONS = [
  "partOf",
  "sequelOf",
  "prequelOf",
  "sameSeries",
  "relatedTo",
  "adaptationOf",
] as const satisfies readonly ItemRelation[];
const _itemRelationsCover: Covers<ItemRelation, typeof ITEM_RELATIONS> = null;

/** Structural guard: is this unknown value one of the item relation kinds? */
export function isItemRelation(value: unknown): value is ItemRelation {
  return typeof value === "string" && (ITEM_RELATIONS as readonly string[]).includes(value);
}

/**
 * A directed, labeled edge between two canonical items.
 *
 * Direction is caller-stated data, not derived symmetry: the store never
 * auto-creates the inverse edge (e.g. a `sequelOf` does NOT imply a
 * `prequelOf`) — relationship semantics belong to the caller. Traversal
 * (`EntertainmentGraph.neighbors`) is direction-agnostic: an edge is reachable
 * from both endpoints. Duplicate edges (same from/to/relation triple) are
 * collapsed by the store.
 */
export interface ItemRelationship {
  fromItemId: EntertainmentItemId;
  toItemId: EntertainmentItemId;
  relation: ItemRelation;
}

// ---------------------------------------------------------------------------
// GraphItem / GraphEvent
// ---------------------------------------------------------------------------

/**
 * A canonical graph item: the frozen `EntertainmentItem` contract plus the
 * graph's own bookkeeping.
 *
 * - `id` is narrowed to the canonical `wfxitm_`-branded `EntertainmentItemId`
 *   (ids.ts) — the canonical content identity.
 * - `creators` / `topics` hold canonical id references (registry records live
 *   in the store's creator/topic maps).
 * - `realizations` are the source realizations of this identity — the "many"
 *   side of "one content identity, many realizations". Each realization's
 *   `entertainmentItemId` must equal this item's `id`.
 * - `createdAt` / `updatedAt` are ISO 8601 instants supplied by the writer
 *   (the store is deterministic: it never invents timestamps on insert, only
 *   refreshes `updatedAt` when a store mutation changes the item).
 */
export interface GraphItem extends EntertainmentItem {
  /** Canonical content identity: `wfxitm_` prefix + 26-char ULID body (ids.ts). */
  id: EntertainmentItemId;
  /** Canonical creator ids referenced by this item. */
  creators: CreatorId[];
  /** Canonical topic ids referenced by this item. */
  topics: TopicId[];
  /** The source realizations of this canonical identity (may be empty). */
  realizations: SourceRealization[];
  /** ISO 8601 creation instant. */
  createdAt: string;
  /** ISO 8601 instant of the last mutation. */
  updatedAt: string;
}

/**
 * A graph-held entertainment event: the frozen `EntertainmentEvent` plus an
 * optional reference to the canonical envelope identity (`wfxevt_`, see
 * events.ts `EventEnvelope.eventId`) when the event entered the graph wrapped
 * in an envelope. The frozen event payload itself is never altered.
 */
export interface GraphEvent extends EntertainmentEvent {
  /** Canonical envelope id (`wfxevt_` + ULID body) when the event was enveloped. */
  envelopeId?: string;
}

// ---------------------------------------------------------------------------
// Typed failure
// ---------------------------------------------------------------------------

/**
 * Typed failure kind produced by Entertainment Graph operations.
 *
 * "invalid-input" is currently the only kind (per the WFX-010 task packet):
 * every malformed argument — bad id shapes, bad vocabularies, bad timestamps,
 * realizations that do not attach to the addressed item, mutations that
 * reference unknown items — is reported as invalid input with field-level
 * detail. Lookups of absent data are queries, not errors: they return
 * `undefined` / empty results.
 */
export type GraphErrorKind = "invalid-input";

/**
 * Typed error thrown by graph operations on bad input. Failures are explicit
 * and structured — the error carries a machine-readable `kind` plus
 * field-level `details` (at least one); there are no silent coercions and no
 * fake-success paths.
 */
export class GraphError extends Error {
  readonly kind: GraphErrorKind;
  /** Field-level problem descriptions (at least one). */
  readonly details: readonly string[];

  constructor(details: string | readonly string[]) {
    const list = typeof details === "string" ? [details] : details;
    super(`GraphError (invalid-input): ${list.join("; ")}`);
    this.name = "GraphError";
    this.kind = "invalid-input";
    this.details = list;
  }
}
