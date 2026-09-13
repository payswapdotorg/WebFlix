/**
 * @wfx/experience — source-neutral feed use-case (WFX-005, Lane C).
 *
 * "Source does not choose feed mode; content and session context do."
 * (frozen architecture, "Experience modes"). Concretely:
 *
 * - The REQUEST carries the session context: which surface (`'watch'` or
 *   `'short'`) the user's session is on.
 * - Each CARD's ELIGIBILITY comes from the content itself: orientation,
 *   canonical type, and duration decide whether an item fits the short-form
 *   (vertical, swipe-driven, micro-duration) or long-form (episodic,
 *   resumable) experience. No connector or source field ever picks the mode.
 *
 * Card assembly law:
 * - Cards are assembled ONLY from `ConnectorPort` results — a `SearchResult`
 *   (existence on the source) enriched with `SourceItem` metadata when the
 *   connector can provide it. No provider types, no fabricated cards: a hit
 *   that cannot be canonically classified produces NO card, never a guessed
 *   one.
 * - Capability information is preserved: the card's `SourceRealization`
 *   carries the per-item capabilities the source reported (metadata view,
 *   intersected with the connector's declared capability truth); when no
 *   metadata is available it falls back to the connector's declared
 *   capabilities with `availability: "unknown"` — the Experience Core must
 *   know what each source can do.
 * - Canonical identities (`wfxitm_` item id, `wfxsrc_` realization id) are
 *   minted from the injected `IdGen` (a stopgap until the Entertainment
 *   Graph, WFX-010, owns item identity).
 *
 * Error-channel law: `getFeed` NEVER throws for source-side conditions and
 * never fabricates content. An unsupported or empty search — or a search that
 * fails — produces an EMPTY PAGE (the frozen plain surface has no error
 * channel for search; WFX-003's SDK degrades failures to `[]`, and this
 * use-case follows the same law; diagnostics live at the port). Malformed
 * CALLER input throws the typed `ExperienceError` — never a generic error.
 */

import type {
  Capability,
  ConnectorDescriptor,
  EntertainmentItem,
  SearchResult,
  SourceItem,
  SourceRealization,
} from "@wfx/domain";
import {
  AVAILABILITIES,
  CANONICAL_TYPES,
  CAPABILITIES,
  ENTERTAINMENT_ITEM_ID_PREFIX,
  ORIENTATIONS,
  SOURCE_REALIZATION_ID_PREFIX,
  isEntertainmentItemId,
  isRecord,
  isSourceRealizationId,
  previewValue,
} from "@wfx/domain";

import {
  ExperienceError,
  assertValidExperienceContext,
  connectorHas,
  type ExperienceContext,
  type Ports,
} from "../ports";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two experience surfaces (mirrors the frozen `RecommendationContext.surface`). */
export type FeedSurface = "watch" | "short";

/** Feed request: the surface (session context) plus the catalog query. */
export interface FeedRequest {
  surface: FeedSurface;
  query: string;
}

/**
 * One feed card: a canonical `EntertainmentItem` combined with its best
 * available `SourceRealization` on the searched source. Capability
 * information rides on the realization.
 */
export interface FeedCard {
  item: EntertainmentItem;
  realization: SourceRealization;
}

/** One feed page: the requested surface and its ordered cards. */
export interface FeedPage {
  surface: FeedSurface;
  cards: readonly FeedCard[];
}

// ---------------------------------------------------------------------------
// Content classification (pure, deterministic, source-independent)
// ---------------------------------------------------------------------------

/**
 * Upper bound for duration-based short-form eligibility. A vertical/square
 * orientation or the `short` canonical type is short-form regardless of
 * duration; bounded micro-content qualifies by duration alone.
 */
export const SHORT_FORM_MAX_DURATION_MS = 180_000;

/**
 * Short-form eligibility (Short Feed: vertical, swipe-driven, rapid
 * candidate replacement). Eligible when ANY of:
 * - `canonicalType === "short"`, or
 * - orientation is `vertical`/`square`, or
 * - a positive `durationMs` not exceeding `SHORT_FORM_MAX_DURATION_MS`.
 */
export function isShortFormCandidate(item: EntertainmentItem): boolean {
  if (item.canonicalType === "short") return true;
  if (item.orientation === "vertical" || item.orientation === "square") return true;
  return item.durationMs !== undefined && item.durationMs > 0 && item.durationMs <= SHORT_FORM_MAX_DURATION_MS;
}

/**
 * Long-form eligibility (Watch Feed: episodic continuity, resume). Eligible
 * when ANY of:
 * - a long-form canonical type (`movie`/`series`/`episode`/`audio`), or
 * - horizontal orientation, or
 * - a `durationMs` beyond `SHORT_FORM_MAX_DURATION_MS`.
 *
 * An item can be eligible for both surfaces (e.g. a short horizontal clip);
 * the session context (requested surface) decides which feed shows it.
 */
export function isWatchFormCandidate(item: EntertainmentItem): boolean {
  switch (item.canonicalType) {
    case "movie":
    case "series":
    case "episode":
    case "audio":
      return true;
    default:
      break;
  }
  if (item.orientation === "horizontal") return true;
  return item.durationMs !== undefined && item.durationMs > SHORT_FORM_MAX_DURATION_MS;
}

// ---------------------------------------------------------------------------
// Runtime shape guards (a malformed port value never becomes a card)
// ---------------------------------------------------------------------------

const CANONICAL_TYPE_SET: ReadonlySet<string> = new Set(CANONICAL_TYPES);
const ORIENTATION_SET: ReadonlySet<string> = new Set(ORIENTATIONS);
const AVAILABILITY_SET: ReadonlySet<string> = new Set(AVAILABILITIES);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Optional-string vocabulary check: `undefined` (absent) passes, any non-member string fails. */
function isOptionalMemberOf(value: unknown, vocabulary: ReadonlySet<string>): boolean {
  return value === undefined || (typeof value === "string" && vocabulary.has(value));
}

/** Runtime shape check for one search hit. Malformed hits are skipped. */
function isUsableSearchResult(hit: unknown): boolean {
  if (!isRecord(hit)) return false;
  if (!isNonEmptyString(hit.connectorId)) return false;
  if (!isNonEmptyString(hit.externalRef)) return false;
  if (typeof hit.title !== "string") return false;
  if (!isOptionalMemberOf(hit.canonicalType, CANONICAL_TYPE_SET)) return false;
  if (hit.durationMs !== undefined && !isNonNegativeFinite(hit.durationMs)) return false;
  if (!isOptionalMemberOf(hit.orientation, ORIENTATION_SET)) return false;
  return true;
}

/** Runtime shape check for a metadata value. Malformed metadata counts as absent. */
function isUsableSourceItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string") return false;
  if (!isOptionalMemberOf(value.canonicalType, CANONICAL_TYPE_SET)) return false;
  if (value.durationMs !== undefined && !isNonNegativeFinite(value.durationMs)) return false;
  if (!isOptionalMemberOf(value.orientation, ORIENTATION_SET)) return false;
  if (typeof value.availability !== "string" || !AVAILABILITY_SET.has(value.availability)) return false;
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((cap) => typeof cap === "string")) {
    return false;
  }
  return true;
}

function isKnownCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Card capabilities — the honest capability view for this realization:
 * - metadata present: the source's per-item capabilities, filtered to the
 *   frozen `Capability` vocabulary and to what the connector actually
 *   DECLARES (descriptor capability truth; a metadata claim the connector
 *   does not declare is not reported as doable).
 * - no metadata: the connector's declared capabilities (connector-level
 *   truth; the card's availability is "unknown").
 */
function cardCapabilities(metadata: SourceItem | null, descriptor: ConnectorDescriptor): Capability[] {
  if (metadata === null) {
    return [...descriptor.capabilities];
  }
  return metadata.capabilities.filter(
    (cap): cap is Capability => isKnownCapability(cap) && descriptor.capabilities.includes(cap),
  );
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function assertValidFeedRequest(request: FeedRequest): void {
  if (!isRecord(request)) {
    throw new ExperienceError("request: expected a FeedRequest object");
  }
  const problems: string[] = [];
  if (request.surface !== "watch" && request.surface !== "short") {
    problems.push(`request.surface: expected 'watch' or 'short', got ${previewValue(request.surface)}`);
  }
  if (typeof request.query !== "string" || request.query.trim().length === 0) {
    problems.push(`request.query: expected a non-empty string (after trim), got ${previewValue(request.query)}`);
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// Card assembly
// ---------------------------------------------------------------------------

/**
 * Build one card from a usable hit and its (possibly null) metadata.
 * Returns null when the hit cannot be canonically classified or the IdGen
 * produces a non-canonical body — a card is never fabricated.
 */
function buildCard(
  ports: Ports,
  descriptor: ConnectorDescriptor,
  hit: SearchResult,
  metadata: SourceItem | null,
): FeedCard | null {
  const canonicalType = metadata?.canonicalType ?? hit.canonicalType;
  if (canonicalType === undefined) {
    // The frozen EntertainmentItem REQUIRES a canonical type. A hit without
    // one cannot be canonically classified — no card is fabricated for it.
    return null;
  }

  const itemId = ENTERTAINMENT_ITEM_ID_PREFIX + ports.ids.next();
  const realizationId = SOURCE_REALIZATION_ID_PREFIX + ports.ids.next();
  if (!isEntertainmentItemId(itemId) || !isSourceRealizationId(realizationId)) {
    // A misbehaving IdGen yields no card, never a broken one.
    return null;
  }

  const title = metadata?.title ?? hit.title;
  const durationMs = pickNonNegativeFinite(metadata?.durationMs) ?? pickNonNegativeFinite(hit.durationMs);
  const orientation = metadata?.orientation ?? hit.orientation;

  const item: EntertainmentItem = { id: itemId, canonicalType };
  if (typeof title === "string" && title.trim().length > 0) item.canonicalTitle = title;
  if (durationMs !== undefined) item.durationMs = durationMs;
  if (orientation !== undefined) item.orientation = orientation;

  const realization: SourceRealization = {
    id: realizationId,
    entertainmentItemId: itemId,
    connectorId: hit.connectorId,
    externalRef: hit.externalRef,
    capabilities: cardCapabilities(metadata, descriptor),
    availability: metadata?.availability ?? "unknown",
  };
  return { item, realization };
}

function pickNonNegativeFinite(value: number | undefined): number | undefined {
  return value !== undefined && isNonNegativeFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Metadata enrichment
// ---------------------------------------------------------------------------

/**
 * Fetch metadata for one external ref through the port. Returns null when:
 * the connector does not declare `metadata` (capability truth), the port
 * answers null, the call rejects, or the value is malformed — the frozen
 * plain surface treats metadata failure as "no metadata" (the WFX-003 SDK's
 * degrade map) and the card falls back to connector-level capability truth.
 */
async function tryMetadata(
  ports: Ports,
  ctx: ExperienceContext,
  ref: string,
): Promise<SourceItem | null> {
  if (!connectorHas(ports.connector, "metadata")) return null;
  let raw: SourceItem | null;
  try {
    raw = await ports.connector.metadata(ctx, ref);
  } catch {
    return null;
  }
  if (raw === null) return null;
  if (!isUsableSourceItem(raw)) return null;
  return raw;
}

// ---------------------------------------------------------------------------
// getFeed
// ---------------------------------------------------------------------------

/**
 * Assemble one source-neutral feed page.
 *
 * Deterministic: cards follow the connector's search-result order; ids are
 * minted from the injected `IdGen` in that same order. The page is EMPTY
 * when the search is unsupported, empty, or failed — never a fake card,
 * never a thrown generic error. Malformed caller input throws the typed
 * `ExperienceError`.
 */
export async function getFeed(
  ports: Ports,
  ctx: ExperienceContext,
  request: FeedRequest,
): Promise<FeedPage> {
  assertValidExperienceContext(ctx);
  assertValidFeedRequest(request);

  let hits: SearchResult[];
  try {
    hits = await ports.connector.search(ctx, request.query.trim());
  } catch {
    // The frozen plain surface has no error channel for search (WFX-003's
    // SDK degrades search failures to []); this use-case follows the same
    // law. Diagnostics live at the port, never a fabricated card here.
    return { surface: request.surface, cards: [] };
  }
  if (!Array.isArray(hits)) {
    // Defensive: a port violating the plain surface yields no cards.
    return { surface: request.surface, cards: [] };
  }

  const descriptor = ports.connector.descriptor();
  const portConnectorId = descriptor.id;
  const cards: FeedCard[] = [];

  for (const hit of hits) {
    if (!isUsableSearchResult(hit)) continue; // malformed hit ⇒ no card
    if (hit.connectorId !== portConnectorId) continue; // foreign hit ⇒ no card

    let metadata = await tryMetadata(ports, ctx, hit.externalRef);
    if (
      metadata !== null &&
      (metadata.connectorId !== hit.connectorId || metadata.externalRef !== hit.externalRef)
    ) {
      // Metadata that does not match its own hit is treated as absent.
      metadata = null;
    }

    const card = buildCard(ports, descriptor, hit, metadata);
    if (card === null) continue;

    const eligible =
      request.surface === "short"
        ? isShortFormCandidate(card.item)
        : isWatchFormCandidate(card.item);
    if (eligible) {
      cards.push(card);
    }
  }

  return { surface: request.surface, cards };
}
