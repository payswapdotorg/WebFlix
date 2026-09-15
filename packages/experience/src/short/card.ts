/**
 * @wfx/experience — the Short Feed card view model (WFX-028, Lane C).
 *
 * The CLIENT-facing card model of the frozen "Short Feed" experience mode
 * (docs/architecture/webflix-frozen-architecture.md, "Experience modes"):
 * "Short Feed: vertical, swipe-driven, rapid candidate replacement and
 * session-aware ranking. Source does not choose feed mode; content and
 * session context do" — this module receives the ALREADY-COMPOSED OS short
 * page (plus the host's optional canonical-item join) and projects it into
 * presentable cards. It never queries a source, never embeds a player,
 * never fetches (all data is injected).
 *
 * DEPENDENCY HONESTY (the WFX-027 pattern, lead-visible): `@wfx/recommendation`
 * is NOT a declared dependency of `@wfx/experience` (this package depends on
 * `@wfx/domain` only) and this work item may not edit package.json. The OS
 * page input (`ShortFeedPage` / `ShortFeedCard`) is therefore a STRUCTURAL
 * MIRROR of the WFX-021 `FeedPage` / `FeedCard`
 * (packages/recommendation/src/os/types.ts): every mirrored field exists
 * verbatim on the real OS output, so a real `FeedPage` with
 * `surface: "short"` is ASSIGNABLE to `ShortFeedPage` — the host passes it
 * through unchanged, and the OS `trace` is carried as opaque data (never
 * interpreted, never fabricated here).
 *
 * VERTICAL-FIRST ORDERING (the packet's law): the Short Feed is vertical —
 * vertical items are ranked AHEAD; non-vertical items are TYPED-TAILED with
 * a reason (never silently dropped, never silently reordered without
 * explanation). The tier law mirrors the WFX-021 short-surface composition:
 * vertical = tier 0, square/unknown = tier 1, horizontal = tier 2; incoming
 * OS order is preserved WITHIN every tier (the OS rank is never re-sorted
 * away). Cards that cannot be canonically classified (no canonical type from
 * either the item join or the candidate features) produce NO card — their
 * ids land in `unresolvedItemIds` (typed transparency, never a fabricated
 * card).
 *
 * Candidate feature-key conventions consumed (documented, the same law
 * WFX-021 used for `nextEpisodeOf` and WFX-027 for `topic`): graph-aware
 * hosts populate `canonicalType`, `canonicalTitle`, `durationMs`,
 * `orientation` (for the candidate→item projection when no host item join
 * exists) and `topic` (the item's DOMINANT topic label; absent ⇒ the overlay
 * carries a typed-null topic, never a guessed one).
 *
 * Determinism laws (same as the rest of @wfx/experience): no randomness, no
 * hidden clock, no globals; every ordering is by explicit values (tier, then
 * incoming OS position) with documented codepoint tie-breaks.
 */

import type {
  EntertainmentCandidate,
  EntertainmentItem,
  PlaybackMode,
} from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";

import type { RealizationBadge } from "../library/model";
import { ExperienceError } from "../ports";
import type { ActionRequest } from "../use-cases/actions";
import { isShortFormCandidate } from "../use-cases/feed";
import { TOPIC_FEATURE_KEY } from "../watch/view";

// ---------------------------------------------------------------------------
// The OS page input (structural mirror of WFX-021's short-surface FeedPage)
// ---------------------------------------------------------------------------

/**
 * One composed feed position, mirroring the WFX-021 `FeedCard` field for
 * field: the winning candidate, its verbatim model output, the dominant
 * matched objective, and the OS position explainability.
 */
export interface ShortFeedCard {
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
 * The OS short page input — a STRUCTURAL MIRROR of the WFX-021 `FeedPage`
 * with `surface: "short"` (see the module doc for the dependency-honesty
 * rationale). A real OS short page satisfies this shape without adaptation;
 * the OS `PipelineTrace` rides along opaquely in `trace`.
 */
export interface ShortFeedPage {
  surface: "short";
  userId: string;
  sessionId: string;
  cards: readonly ShortFeedCard[];
  /** The OS `PipelineTrace` — opaque to the view model (carried, never interpreted). */
  trace?: unknown;
}

// ---------------------------------------------------------------------------
// Orientation (the vertical-first law, typed)
// ---------------------------------------------------------------------------

/** The frozen orientation vocabulary of `EntertainmentItem`. */
export type ShortOrientationKind = NonNullable<EntertainmentItem["orientation"]>;

/**
 * The vertical-first tier law (mirrors the WFX-021 short-surface composition):
 * vertical = 0 (ranked ahead), square/unknown = 1, horizontal = 2 (typed tail).
 */
export const SHORT_ORIENTATION_TIERS: Readonly<Record<ShortOrientationKind, number>> = {
  vertical: 0,
  square: 1,
  unknown: 1,
  horizontal: 2,
};

/**
 * A card's orientation placement in the vertical-first ordering. `tailReason`
 * is present (non-null, non-empty) IFF the orientation is NOT vertical — the
 * typed-tailed-with-reason law; vertical cards carry `null` (they lead by
 * the law itself, no tail to explain).
 */
export interface ShortCardOrientation {
  kind: ShortOrientationKind;
  /** 0 (vertical), 1 (square/unknown), or 2 (horizontal). */
  tier: number;
  /** NON-EMPTY iff kind !== "vertical": why this card sits behind the vertical lead. */
  tailReason: string | null;
}

/** Classify an item's orientation (absent ⇒ "unknown", never guessed). */
export function shortOrientationKindOf(item: EntertainmentItem): ShortOrientationKind {
  switch (item.orientation) {
    case "vertical":
    case "square":
    case "horizontal":
    case "unknown":
      return item.orientation;
    default:
      return "unknown";
  }
}

/** The typed tail reason for a non-vertical orientation (vertical ⇒ null). */
export function shortOrientationTailReason(kind: ShortOrientationKind): string | null {
  switch (kind) {
    case "vertical":
      return null;
    case "square":
      return "square orientation — mid tier: vertical shorts are ranked ahead in the short feed";
    case "unknown":
      return "unknown orientation — mid tier: vertical shorts are ranked ahead in the short feed";
    case "horizontal":
      return "horizontal orientation — tail tier: the short feed is vertical-first";
  }
}

/** The orientation placement of one item (pure). */
export function shortOrientationPlacement(item: EntertainmentItem): ShortCardOrientation {
  const kind = shortOrientationKindOf(item);
  return {
    kind,
    tier: SHORT_ORIENTATION_TIERS[kind],
    tailReason: shortOrientationTailReason(kind),
  };
}

// ---------------------------------------------------------------------------
// A11y (typed labels on EVERY card)
// ---------------------------------------------------------------------------

/**
 * The accessibility label carried by EVERY Short Feed card: the card's
 * accessible name, a position description, the swipe action, and the
 * engagement affordances announcement. All four fields are non-empty by
 * construction.
 */
export interface ShortCardA11y {
  /** The card's accessible name (its overlay title). */
  title: string;
  /** Where the card sits: stack/OS position + orientation tier. */
  position: string;
  /** What the primary swipe gesture does. */
  action: string;
  /** The engagement affordances announcement (like / save / share). */
  affordances: string;
}

// ---------------------------------------------------------------------------
// Engagement affordances (mapped to the WFX-005 action use-case input types)
// ---------------------------------------------------------------------------

/**
 * One connector-executable engagement affordance — the EXACT fields of the
 * WFX-005 `runUserAction` input (`ActionRequest`) pre-bound to this card:
 * `type` + `connectorId` + `externalRef` + the canonical `itemId` the
 * mirror-able action law requires (see use-cases/actions.ts). The app layer
 * passes this through `cardActionRequest` verbatim.
 */
export interface CardActionAffordance {
  /** The frozen `UserAction.type` — "like" | "save" (share has NO action type; see below). */
  type: "like" | "save";
  connectorId: string;
  externalRef: string;
  /** Canonical entertainment-item id (the engagement-event mirror needs it). */
  itemId: string;
}

/**
 * Map one affordance to the EXACT WFX-005 `ActionRequest` input type (pure).
 * The returned object is ready for `runUserAction(ports, ctx, request)`.
 */
export function cardActionRequest(affordance: CardActionAffordance): ActionRequest {
  return {
    type: affordance.type,
    connectorId: affordance.connectorId,
    externalRef: affordance.externalRef,
    itemId: affordance.itemId,
  };
}

/**
 * The share affordance — HONESTLY TYPED ABSENCE of a connector action: the
 * frozen `UserAction` vocabulary has NO "share" type (like / save / follow /
 * comment / download / transform only), so share is NOT a `runUserAction`
 * input. It is an EVENT-ONLY engagement: the frozen `"share"`
 * `EntertainmentEvent` (see short/events.ts). This type makes the absence
 * explicit instead of fabricating an unsupported action input.
 */
export interface CardShareAffordance {
  kind: "share";
  /** The canonical item being shared. */
  itemId: string;
  /** Always "event": share emits the frozen "share" event, never a connector action. */
  channel: "event";
  /** Why (deterministic, non-empty — the honesty note above, as data). */
  detail: string;
}

/** The engagement affordances of one card (capability-honest presence). */
export interface ShortCardAffordances {
  /**
   * The like affordance; NULL when the card's realization does not declare
   * the "like" capability (a typed-absent affordance is never a greyed-out
   * lie — the UI omits the control).
   */
  like: CardActionAffordance | null;
  /** The save affordance; NULL when the realization does not declare "save". */
  save: CardActionAffordance | null;
  /** The share affordance — always present (event-only, no capability needed). */
  share: CardShareAffordance;
}

// ---------------------------------------------------------------------------
// The card view model
// ---------------------------------------------------------------------------

/**
 * One presentable Short Feed card: the canonical item, its vertical-first
 * orientation placement, duration (typed-null when unknown), the title/topic
 * overlay data, the engagement affordances, the realization badge, the OS
 * explainability, and the typed a11y label. PURE DATA — no callbacks, no
 * rendering, no gestures (the UI layer owns those).
 */
export interface ShortCard {
  item: EntertainmentItem;
  /** The vertical-first placement (tier + typed tail reason). */
  orientation: ShortCardOrientation;
  /** Duration in ms; null when unknown (never faked). */
  durationMs: number | null;
  /** The overlay data: deterministic title + typed-absent topic. */
  overlay: {
    title: string;
    /** The item's DOMINANT topic label; null when the OS page carries none. */
    topic: string | null;
  };
  /** Like / save / share affordances (see `ShortCardAffordances`). */
  affordances: ShortCardAffordances;
  /** Where/how the card plays; null when the realization admits no play mode. */
  realizationBadge: RealizationBadge | null;
  /** The OS page position the card came from (0-based, verbatim). */
  osPosition: number;
  /** Verbatim OS position reasons (end-to-end explainability, carried). */
  positionReasons: readonly string[];
  a11y: ShortCardA11y;
}

// ---------------------------------------------------------------------------
// Pure display helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic overlay title: the canonical title when the item carries a
 * non-blank one, else the canonical id — never fabricated, never blank (the
 * same law as the watch feed's `watchFeedTitle`).
 */
export function shortCardTitle(item: EntertainmentItem): string {
  return typeof item.canonicalTitle === "string" && item.canonicalTitle.trim().length > 0
    ? item.canonicalTitle
    : item.id;
}

// ---------------------------------------------------------------------------
// Realization badge (the WFX-027 cardBadge law, module-local)
// ---------------------------------------------------------------------------

/** The frozen Media Surface precedence order (native → embed → browser → external). */
const MODE_PRECEDENCE: readonly PlaybackMode[] = ["native", "embed", "browser", "external"];

/** The capability that produces each playback mode. */
const CAPABILITY_FOR_MODE: Readonly<Record<PlaybackMode, string>> = {
  native: "playNative",
  embed: "playEmbed",
  browser: "playBrowser",
  external: "playExternal",
};

/**
 * The best playback mode a realization's capabilities admit, by the frozen
 * precedence order — `undefined` when the realization carries no play
 * capability (honestly badge-less, never guessed).
 */
function preferredMode(capabilities: readonly string[]): PlaybackMode | undefined {
  for (const mode of MODE_PRECEDENCE) {
    if (capabilities.includes(CAPABILITY_FOR_MODE[mode])) return mode;
  }
  return undefined;
}

/** The realization badge of one OS card's candidate realization (null ⇒ no play mode). */
function shortCardBadge(
  card: ShortFeedCard,
  displayNames: Readonly<Record<string, string>> | undefined,
): RealizationBadge | null {
  const mode = preferredMode(card.candidate.realization.capabilities ?? []);
  if (mode === undefined) return null;
  const connectorId = card.candidate.realization.connectorId;
  const name = displayNames?.[connectorId] ?? connectorId;
  return {
    connectorId,
    mode,
    ...(card.candidate.realization.externalRef !== undefined
      ? { externalRef: card.candidate.realization.externalRef }
      : {}),
    label: `${name} (${mode})`,
  };
}

// ---------------------------------------------------------------------------
// Candidate → item projection (the WFX-027 feature-key convention)
// ---------------------------------------------------------------------------

function isCanonicalType(value: unknown): value is EntertainmentItem["canonicalType"] {
  return (
    value === "movie" ||
    value === "series" ||
    value === "episode" ||
    value === "video" ||
    value === "short" ||
    value === "post" ||
    value === "audio"
  );
}

/**
 * Project a candidate into a canonical `EntertainmentItem` from the
 * documented feature keys (canonicalType required; title/duration/orientation
 * optional). Returns null when the candidate cannot be canonically
 * classified — the caller never fabricates an item.
 */
function projectCandidateItem(candidate: EntertainmentCandidate): EntertainmentItem | null {
  const canonicalType = candidate.features["canonicalType"];
  if (!isCanonicalType(canonicalType)) return null;
  const item: EntertainmentItem = { id: candidate.itemId, canonicalType };
  const title = candidate.features["canonicalTitle"];
  if (typeof title === "string" && title.trim().length > 0) item.canonicalTitle = title;
  const durationMs = candidate.features["durationMs"];
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
    item.durationMs = durationMs;
  }
  const orientation = candidate.features["orientation"];
  if (
    orientation === "horizontal" ||
    orientation === "vertical" ||
    orientation === "square" ||
    orientation === "unknown"
  ) {
    item.orientation = orientation;
  }
  return item;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Type guard that preserves the declared type (unlike a raw index-signature guard). */
function isOptionsObject<T extends object>(value: T | null | undefined): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural guard for connectorId → displayName records. */
function isDisplayNameRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((name) => typeof name === "string");
}

function cardProblems(card: unknown, prefix: string): string[] {
  if (!isRecord(card)) {
    return [`${prefix}: expected a ShortFeedCard object, got ${previewValue(card)}`];
  }
  const problems: string[] = [];
  if (typeof card.position !== "number" || !Number.isFinite(card.position) || card.position < 0) {
    problems.push(
      `${prefix}.position: expected a finite non-negative number, got ${previewValue(card.position)}`,
    );
  }
  if (!isRecord(card.candidate)) {
    problems.push(
      `${prefix}.candidate: expected an EntertainmentCandidate object, got ${previewValue(card.candidate)}`,
    );
  } else {
    if (!isNonEmptyString(card.candidate.itemId)) {
      problems.push(
        `${prefix}.candidate.itemId: expected a non-empty string, got ${previewValue(card.candidate.itemId)}`,
      );
    }
    if (!isRecord(card.candidate.features)) {
      problems.push(
        `${prefix}.candidate.features: expected a record of primitive feature values, got ${previewValue(card.candidate.features)}`,
      );
    }
    if (!isRecord(card.candidate.realization)) {
      problems.push(
        `${prefix}.candidate.realization: expected an object, got ${previewValue(card.candidate.realization)}`,
      );
    } else {
      if (!isNonEmptyString(card.candidate.realization.connectorId)) {
        problems.push(
          `${prefix}.candidate.realization.connectorId: expected a non-empty string, got ${previewValue(card.candidate.realization.connectorId)}`,
        );
      }
      if (
        !Array.isArray(card.candidate.realization.capabilities) ||
        !card.candidate.realization.capabilities.every((cap) => typeof cap === "string")
      ) {
        problems.push(
          `${prefix}.candidate.realization.capabilities: expected an array of strings, got ${previewValue(card.candidate.realization.capabilities)}`,
        );
      }
    }
  }
  if (
    card.modelScore !== null &&
    !(typeof card.modelScore === "number" && Number.isFinite(card.modelScore))
  ) {
    problems.push(
      `${prefix}.modelScore: expected a finite number or null, got ${previewValue(card.modelScore)}`,
    );
  }
  if (
    card.confidence !== null &&
    !(typeof card.confidence === "number" && Number.isFinite(card.confidence))
  ) {
    problems.push(
      `${prefix}.confidence: expected a finite number or null, got ${previewValue(card.confidence)}`,
    );
  }
  if (
    !Array.isArray(card.explanations) ||
    !card.explanations.every((entry) => typeof entry === "string")
  ) {
    problems.push(
      `${prefix}.explanations: expected an array of strings, got ${previewValue(card.explanations)}`,
    );
  }
  if (card.dominantObjective !== null && !isNonEmptyString(card.dominantObjective)) {
    problems.push(
      `${prefix}.dominantObjective: expected a non-empty string or null, got ${previewValue(card.dominantObjective)}`,
    );
  }
  if (
    !Array.isArray(card.positionReasons) ||
    !card.positionReasons.every((entry) => typeof entry === "string")
  ) {
    problems.push(
      `${prefix}.positionReasons: expected an array of strings, got ${previewValue(card.positionReasons)}`,
    );
  }
  return problems;
}

/**
 * Assert one OS short page is usable (surface "short", non-empty identity,
 * usable cards). Throws the typed `ExperienceError` with aggregated
 * field-level problems on caller misuse.
 */
export function assertUsableShortFeedPage(page: ShortFeedPage): void {
  if (!isRecord(page)) {
    throw new ExperienceError("page: expected a ShortFeedPage object");
  }
  const problems: string[] = [];
  if (page.surface !== "short") {
    problems.push(`page.surface: expected 'short', got ${previewValue(page.surface)}`);
  }
  if (!isNonEmptyString(page.userId)) {
    problems.push(`page.userId: expected a non-empty string, got ${previewValue(page.userId)}`);
  }
  if (!isNonEmptyString(page.sessionId)) {
    problems.push(`page.sessionId: expected a non-empty string, got ${previewValue(page.sessionId)}`);
  }
  if (!Array.isArray(page.cards)) {
    problems.push(`page.cards: expected an array, got ${previewValue(page.cards)}`);
  } else {
    page.cards.forEach((card, index) => {
      problems.push(...cardProblems(card, `page.cards[${index}]`));
    });
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// buildShortCards — the vertical-first projection
// ---------------------------------------------------------------------------

/** Options of `buildShortCards` (the injected joins — never fetched). */
export interface BuildShortCardsOptions {
  /** connectorId → displayName for realization badges; missing names fall back to the connectorId. */
  displayNames?: Readonly<Record<string, string>>;
  /**
   * Host-supplied canonical items, joined by id (authoritative over the
   * candidate feature projection — the WFX-027 item-index law).
   */
  items?: readonly EntertainmentItem[];
}

/** The projection output: ordered cards + typed transparency lists. */
export interface ShortCardProjection {
  /** Cards in vertical-first order (tier asc, OS position asc within tier). */
  cards: readonly ShortCard[];
  /** Candidate item ids that could not be canonically classified (no card fabricated). */
  unresolvedItemIds: readonly string[];
  /** Candidate item ids excluded because they are not short-form candidates (typed honesty). */
  nonShortFormItemIds: readonly string[];
  /** Candidate item ids dropped as duplicates (one card per canonical item — first occurrence wins). */
  duplicateItemIds: readonly string[];
}

/**
 * Build the Short Feed cards from an OS short page (pure, deterministic).
 *
 * Ordering law: vertical-first — tier asc (`SHORT_ORIENTATION_TIERS`), OS
 * position asc within each tier. Non-vertical cards are typed-tailed with a
 * reason on `orientation.tailReason`. One card per canonical item (first OS
 * occurrence wins); duplicates, unclassifiable candidates, and non-short-form
 * candidates are reported in the typed transparency lists — never fabricated
 * into cards, never silently dropped.
 */
export function buildShortCards(
  page: ShortFeedPage,
  options: BuildShortCardsOptions = {},
): ShortCardProjection {
  assertUsableShortFeedPage(page);
  if (!isOptionsObject(options)) {
    throw new ExperienceError(
      `options: expected a BuildShortCardsOptions object, got ${previewValue(options)}`,
    );
  }
  if (options.displayNames !== undefined && !isDisplayNameRecord(options.displayNames)) {
    throw new ExperienceError(
      `options.displayNames: expected a record of connectorId -> displayName when present, got ${previewValue(options.displayNames)}`,
    );
  }
  if (options.items !== undefined && !Array.isArray(options.items)) {
    throw new ExperienceError(
      `options.items: expected an array of EntertainmentItem when present, got ${previewValue(options.items)}`,
    );
  }

  // The item index: host joins first, then candidate projections (first wins).
  const itemIndex = new Map<string, EntertainmentItem>();
  for (const item of options.items ?? []) {
    if (!itemIndex.has(item.id)) itemIndex.set(item.id, item);
  }

  const built: { card: ShortCard; tier: number; osPosition: number }[] = [];
  const unresolved: string[] = [];
  const nonShortForm: string[] = [];
  const duplicates: string[] = [];
  const seenItems = new Set<string>();

  for (const osCard of page.cards) {
    const itemId = osCard.candidate.itemId;
    if (seenItems.has(itemId)) {
      duplicates.push(itemId); // one card per canonical item — the OS composition law
      continue;
    }
    seenItems.add(itemId);

    let item = itemIndex.get(itemId);
    if (item === undefined) {
      const projected = projectCandidateItem(osCard.candidate);
      if (projected === null) {
        unresolved.push(itemId); // no canonical type ⇒ no card, never a guess
        continue;
      }
      item = projected;
    }

    if (!isShortFormCandidate(item)) {
      nonShortForm.push(itemId); // content decides the surface — honestly excluded
      continue;
    }

    const orientation = shortOrientationPlacement(item);
    const title = shortCardTitle(item);
    const topicFeature = osCard.candidate.features[TOPIC_FEATURE_KEY];
    const topic =
      typeof topicFeature === "string" && topicFeature.trim().length > 0
        ? topicFeature.trim()
        : null;

    const realization = osCard.candidate.realization;
    const capabilities = realization.capabilities ?? [];
    const actionAffordance = (type: "like" | "save"): CardActionAffordance => ({
      type,
      connectorId: realization.connectorId,
      externalRef: realization.externalRef !== undefined ? realization.externalRef : itemId,
      itemId,
    });
    const affordances: ShortCardAffordances = {
      like: capabilities.includes("like") ? actionAffordance("like") : null,
      save: capabilities.includes("save") ? actionAffordance("save") : null,
      share: {
        kind: "share",
        itemId,
        channel: "event",
        detail:
          'share has no frozen UserAction type — it is an event-only engagement (the frozen "share" EntertainmentEvent)',
      },
    };

    const card: ShortCard = {
      item,
      orientation,
      durationMs:
        typeof item.durationMs === "number" &&
        Number.isFinite(item.durationMs) &&
        item.durationMs >= 0
          ? item.durationMs
          : null,
      overlay: { title, topic },
      affordances,
      realizationBadge: shortCardBadge(osCard, options.displayNames),
      osPosition: osCard.position,
      positionReasons: Object.freeze([...osCard.positionReasons]),
      a11y: {
        title: `Short: ${title}`,
        position: `Card ${osCard.position + 1} of the short feed; ${
          orientation.tailReason !== null ? orientation.tailReason : "vertical orientation — ranked ahead"
        }`,
        action: "Swipe up for the next short, swipe down to go back",
        affordances: [
          affordances.like !== null ? "like available" : "like unavailable",
          affordances.save !== null ? "save available" : "save unavailable",
          "share available",
        ].join(", "),
      },
    };
    built.push({ card, tier: orientation.tier, osPosition: osCard.position });
  }

  // Vertical-first: tier asc, OS position asc within tier (stable, total).
  built.sort((a, b) => a.tier - b.tier || a.osPosition - b.osPosition);

  return {
    cards: Object.freeze(built.map((entry) => entry.card)),
    unresolvedItemIds: Object.freeze(unresolved),
    nonShortFormItemIds: Object.freeze(nonShortForm),
    duplicateItemIds: Object.freeze(duplicates),
  };
}
