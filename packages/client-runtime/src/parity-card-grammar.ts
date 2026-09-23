/**
 * @wfx/client-runtime — THE R27 PARITY CARD VIEW-MODEL GRAMMAR (W1, the
 * reference-keeper lane: the YouTube card anatomy both apps render, as
 * ONE shared typed grammar).
 *
 * THE LAW (docs/parity-lab/reference/app-shell.md + search-card-grammar.json
 * + design-tokens.md): every discovery surface renders the SAME card
 * grammar the corpus pins —
 *
 * - the FEED CARD: 16:9 thumbnail (radius 12), duration pill
 *   bottom-right, optional badge, 2-line 16/500/22 title, channel row
 *   (14/400 secondary, hover primary), 12px meta line, hover/progress
 *   states (the watched red edge);
 * - the SEARCH ROW CARD: 360×202 thumbnail left, 16px gap, meta column
 *   right — 18/400/26 2-line title, channel, meta line, 12px/18 2-line
 *   snippet, badges (per `search-card-grammar.json`, [rendered]);
 * - the RELATED COMPACT CARD: 168×94 thumbnail + right meta column;
 * - the SHORTS CARD: 9:16 thumbnail + the action-rail counts grammar.
 *
 * Each card type carries its GRAMMAR DESCRIPTOR — the corpus numbers the
 * rendering must obey, derived from `@wfx/platform-contracts`'s canonical
 * token contract (`PARITY_GEOMETRY`, the type roles) — so a surface can
 * never drift from the sheet without the conformance harness seeing it.
 *
 * THE HONESTY LAWS THIS GRAMMAR KEEPS (frozen, carried from R26 + the
 * lab laws):
 * - REAL ARTWORK IS LAW: `parityCardArtwork` renders the source-carried
 *   `<img>` view when the row carries `ContentArtwork` (resolved through
 *   the domain's own `contentArtworkOf`), and the typed placeholder-
 *   monogram view with the artwork contract's own fallback detail when
 *   it does not — never a generated replacement, never a dead box.
 * - DURATION PILLS render only the truth the row carries (`durationMs`
 *   absent ⇒ no pill, never an invented length).
 * - META LINES carry only REAL FACTS the caller provides (canonical
 *   type, license basis, creator names…). The corpus's "views · age"
 *   row is honestly absent when the catalog carries no view/age facts —
 *   NO fabricated counts (record in the lane DIVERGENCES).
 * - DEAD CHIPS OMIT: a chip with zero rows behind it never renders.
 *
 * WHAT THIS MODULE IS: pure typed view-models + pure projections — the
 * shared grammar the Web (W2) and Desktop (W3) surfaces render FROM, and
 * the W1 harness asserts against. Zero React, zero fetching, zero clock.
 */

import { contentArtworkOf, type ContentArtwork } from "@wfx/domain";
import type { SearchResult } from "@wfx/domain";

import { PARITY_GEOMETRY } from "@wfx/platform-contracts";

import type { ContinueWatchingEntry, SearchHit, SearchModel } from "./models";

// ---------------------------------------------------------------------------
// The artwork view (the R26 real-artwork law, projected for cards)
// ---------------------------------------------------------------------------

/**
 * The artwork view a card renders: the REAL source `<img>` when the row
 * carries one, or the typed placeholder-monogram view when it does not.
 * Never a fabricated image.
 */
export type ParityCardArtwork =
  | {
    readonly kind: "image";
    /** The source's own artwork URL (connector-authorized, absolute http(s)). */
    readonly url: string;
    /** The honest alt text (the artwork contract's own alt grammar). */
    readonly alt: string;
    /** The source's declared aspect ratio; null when it carries none (honest). */
    readonly aspectRatio: number | null;
  }
  | {
    readonly kind: "monogram";
    /** The title's initial the placeholder renders. */
    readonly initial: string;
    /** The honest one-line fallback truth (the contract's own detail). */
    readonly note: string;
  };

/**
 * Project the artwork contract into the card's artwork view (PURE). A
 * `null`/unresolvable artwork renders the typed placeholder — never a
 * generated replacement (the real-artwork law).
 */
export function parityCardArtwork(
  artwork: ContentArtwork | null | undefined,
  title: string,
): ParityCardArtwork {
  if (
    artwork !== null &&
    artwork !== undefined &&
    typeof artwork.url === "string" &&
    artwork.url.startsWith("http")
  ) {
    return {
      kind: "image",
      url: artwork.url,
      alt: `${title} — artwork served by ${artwork.provenance.connectorId}`,
      aspectRatio: artwork.aspectRatio ?? null,
    };
  }
  return {
    kind: "monogram",
    initial: title.length > 0 ? (title[0] ?? "·").toUpperCase() : "·",
    note: "The source carries no artwork for this item — the placeholder renders instead.",
  };
}

/**
 * Resolve the artwork view straight off a content row's metadata carrier
 * (the domain's own `contentArtworkOf` resolution — the same projection
 * the apps' hosts use; one source of truth).
 */
export function parityCardArtworkOfCarrier(
  carrier: {
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title?: string;
    readonly orientation?: "horizontal" | "vertical" | "square" | "unknown";
    readonly metadata?: Record<string, unknown>;
  },
  title: string,
): ParityCardArtwork {
  const resolution = contentArtworkOf(carrier);
  return parityCardArtwork(
    resolution.kind === "source-artwork" ? resolution.artwork : null,
    title,
  );
}

// ---------------------------------------------------------------------------
// The card content input (the common denominator both apps' rows carry)
// ---------------------------------------------------------------------------

/**
 * The minimal card content input — the fields the corpus card grammar
 * renders, supplied HONESTLY by the caller (the runtime's read models or
 * an app's joined rows). Every optional field absent ⇒ the matching
 * grammar piece simply does not render (never a fabricated value).
 */
export interface ParityCardContentInput {
  readonly itemId: string;
  readonly title: string;
  /** The canonical type fact ("movie", "series", …) — an honest meta fact. */
  readonly canonicalType?: string;
  /** The real duration; absent ⇒ NO duration pill renders. */
  readonly durationMs?: number;
  /** The resolved source artwork; absent ⇒ the placeholder monogram. */
  readonly artwork?: ContentArtwork | null;
  /** The channel/creator row label; absent ⇒ no channel row (honest). */
  readonly channelLabel?: string | null;
  /** The honest meta facts, in display order (never fabricated counts). */
  readonly metaFacts?: readonly string[];
  /** The search snippet; absent ⇒ no snippet block (honest). */
  readonly snippet?: string | null;
  /** Badge labels under the title (e.g. the peer license basis, CC). */
  readonly badgeLabels?: readonly string[];
  /** The watched fraction in [0,1]; absent ⇒ no progress edge. */
  readonly watchedFraction?: number | null;
}

// ---------------------------------------------------------------------------
// The grammar descriptors (the corpus anatomy, tied to the token contract)
// ---------------------------------------------------------------------------

/** The feed-card grammar descriptor (the corpus numbers, from the contract). */
export const PARITY_FEED_CARD_GRAMMAR = {
  thumbAspectRatio: "16 / 9",
  thumbRadius: PARITY_GEOMETRY.cardRadius,
  titleRole: "card-title",
  channelRole: "channel-row",
  metaRole: "meta",
  pillRole: "pill",
  badgeRole: "badge",
  pillRadius: PARITY_GEOMETRY.pillRadius,
  pillPadding: `${PARITY_GEOMETRY.pillPaddingY}px ${PARITY_GEOMETRY.pillPaddingX}px`,
} as const;

/** The search-row grammar descriptor (per search-card-grammar.json). */
export const PARITY_SEARCH_ROW_GRAMMAR = {
  thumbWidth: PARITY_GEOMETRY.searchThumbWidth,
  thumbHeight: PARITY_GEOMETRY.searchThumbHeight,
  thumbAspectRatio: "16 / 9",
  gap: PARITY_GEOMETRY.searchGap,
  titleRole: "search-title",
  channelRole: "channel-row",
  metaRole: "meta",
  snippetRole: "snippet",
  badgeRole: "badge",
} as const;

/** The related-compact grammar descriptor (the watch sidebar's 168×94). */
export const PARITY_RELATED_CARD_GRAMMAR = {
  thumbWidth: PARITY_GEOMETRY.relatedThumbWidth,
  thumbHeight: PARITY_GEOMETRY.relatedThumbHeight,
  gap: PARITY_GEOMETRY.relatedGap,
  titleRole: "card-title",
  channelRole: "channel-row",
  metaRole: "meta",
} as const;

/** The shorts grammar descriptor (the 9:16 shelf card + the action rail). */
export const PARITY_SHORTS_CARD_GRAMMAR = {
  thumbAspectRatio: "9 / 16",
  thumbRadius: PARITY_GEOMETRY.shortsRadius,
  titleRole: "card-title",
  metaRole: "meta",
  actionTarget: PARITY_GEOMETRY.shortsActionTarget,
  countRole: "meta",
} as const;

// ---------------------------------------------------------------------------
// The view-models (the typed grammar both apps render)
// ---------------------------------------------------------------------------

/** One feed card (the grid grammar's card anatomy). */
export interface ParityFeedCardView {
  readonly kind: "feed";
  readonly itemId: string;
  /** The title (2-line clamp is CSS-owned; the text stays full). */
  readonly title: string;
  /** The channel row label; null renders no channel row (honest). */
  readonly channelLabel: string | null;
  /** The 12px secondary meta line — ONLY the honest facts, " · "-joined. */
  readonly metaLine: string;
  /** The duration pill label ("7:45"); null renders NO pill (honest). */
  readonly durationLabel: string | null;
  /** The artwork view (the real image or the typed placeholder). */
  readonly artwork: ParityCardArtwork;
  /** Badge labels under the title. */
  readonly badgeLabels: readonly string[];
  /** The watched red-edge fraction in [0,1]; null renders no edge. */
  readonly watchedFraction: number | null;
  /** The accessible label (title + channel + meta + duration). */
  readonly ariaLabel: string;
}

/** One search result row (the row-card grammar per search-card-grammar.json). */
export interface ParitySearchRowCardView {
  readonly kind: "search-row";
  readonly itemId: string;
  readonly title: string;
  readonly channelLabel: string | null;
  readonly metaLine: string;
  /** The 12px/18 2-line snippet; null renders no snippet (honest). */
  readonly snippet: string | null;
  readonly durationLabel: string | null;
  readonly artwork: ParityCardArtwork;
  readonly badgeLabels: readonly string[];
  readonly ariaLabel: string;
}

/** One related compact card (the watch sidebar's 168×94 grammar). */
export interface ParityRelatedCardView {
  readonly kind: "related";
  readonly itemId: string;
  readonly title: string;
  readonly channelLabel: string | null;
  readonly metaLine: string;
  readonly durationLabel: string | null;
  readonly artwork: ParityCardArtwork;
  readonly ariaLabel: string;
}

/** One shorts card (the 9:16 shelf/rail grammar). */
export interface ParityShortsCardView {
  readonly kind: "shorts";
  readonly itemId: string;
  readonly title: string;
  readonly metaLine: string;
  readonly artwork: ParityCardArtwork;
  /** The honest action-rail counts label (e.g. real peer counts); null omits. */
  readonly countsLabel: string | null;
  readonly ariaLabel: string;
}

/** One chip in the feed's chip bar (the honest-count law: dead chips omit). */
export interface ParityChipView {
  readonly kind: "chip";
  /** The chip's stable id (the facet key; "all" is the default facet). */
  readonly id: string;
  /** The chip's label (14/500; the active chip inverts). */
  readonly label: string;
  /** The honest row count behind the chip (> 0 — dead chips never render). */
  readonly count: number;
  /** Whether this is the default "All" facet. */
  readonly isDefault: boolean;
}

/** One skeleton card (the loading state's shells — geometry is CSS-owned). */
export interface ParitySkeletonCardView {
  readonly kind: "skeleton";
  /** The corpus skeleton spec (20px h, radius 8) — the descriptor below. */
  readonly lineCount: 2;
}

/** The skeleton grammar descriptor (the corpus skeleton CSS numbers). */
export const PARITY_SKELETON_GRAMMAR = {
  shellHeight: PARITY_GEOMETRY.skeletonShellHeight,
  shellRadius: PARITY_GEOMETRY.skeletonShellRadius,
} as const;

// ---------------------------------------------------------------------------
// The shared derivations (pure)
// ---------------------------------------------------------------------------

/**
 * Format a duration as the corpus pill label ("7:45", "1:02:03").
 * `undefined`/non-finite answers null — the pill renders only real truth.
 */
export function parityDurationLabel(
  durationMs: number | undefined | null,
): string | null {
  if (durationMs === undefined || durationMs === null) return null;
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Compose the meta line from the HONEST facts only (" · "-joined, the
 * corpus's `viewCountText · publishedTimeText` grammar). Empty facts ⇒
 * the empty line (the card renders no meta row — never fabricated data).
 */
export function parityMetaLine(facts: readonly string[]): string {
  return facts
    .map((fact) => fact.trim())
    .filter((fact) => fact.length > 0)
    .join(" · ");
}

/** The card's accessible label (title + channel + meta + duration). */
function ariaLabelOf(
  title: string,
  channelLabel: string | null,
  metaLine: string,
  durationLabel: string | null,
): string {
  const parts = [title];
  if (channelLabel !== null && channelLabel.length > 0) parts.push(channelLabel);
  if (metaLine.length > 0) parts.push(metaLine);
  if (durationLabel !== null) parts.push(durationLabel);
  return parts.filter((part) => part.length > 0).join(" — ");
}

/** Project any card content input into the FEED card view (pure). */
export function parityFeedCard(
  input: ParityCardContentInput,
): ParityFeedCardView {
  const metaLine = parityMetaLine(input.metaFacts ?? []);
  const durationLabel = parityDurationLabel(input.durationMs);
  return {
    kind: "feed",
    itemId: input.itemId,
    title: input.title,
    channelLabel: input.channelLabel ?? null,
    metaLine,
    durationLabel,
    artwork: parityCardArtwork(input.artwork ?? null, input.title),
    badgeLabels: input.badgeLabels ?? [],
    watchedFraction:
      typeof input.watchedFraction === "number" &&
      Number.isFinite(input.watchedFraction) &&
      input.watchedFraction >= 0 &&
      input.watchedFraction <= 1
        ? input.watchedFraction
        : null,
    ariaLabel: ariaLabelOf(input.title, input.channelLabel ?? null, metaLine, durationLabel),
  };
}

/** Project any card content input into the SEARCH ROW card view (pure). */
export function paritySearchRowCard(
  input: ParityCardContentInput,
): ParitySearchRowCardView {
  const metaLine = parityMetaLine(input.metaFacts ?? []);
  const durationLabel = parityDurationLabel(input.durationMs);
  return {
    kind: "search-row",
    itemId: input.itemId,
    title: input.title,
    channelLabel: input.channelLabel ?? null,
    metaLine,
    snippet: input.snippet ?? null,
    durationLabel,
    artwork: parityCardArtwork(input.artwork ?? null, input.title),
    badgeLabels: input.badgeLabels ?? [],
    ariaLabel: ariaLabelOf(input.title, input.channelLabel ?? null, metaLine, durationLabel),
  };
}

/** Project any card content input into the RELATED compact card view (pure). */
export function parityRelatedCard(
  input: ParityCardContentInput,
): ParityRelatedCardView {
  const metaLine = parityMetaLine(input.metaFacts ?? []);
  const durationLabel = parityDurationLabel(input.durationMs);
  return {
    kind: "related",
    itemId: input.itemId,
    title: input.title,
    channelLabel: input.channelLabel ?? null,
    metaLine,
    durationLabel,
    artwork: parityCardArtwork(input.artwork ?? null, input.title),
    ariaLabel: ariaLabelOf(input.title, input.channelLabel ?? null, metaLine, durationLabel),
  };
}

/** Project any card content input into the SHORTS card view (pure). */
export function parityShortsCard(
  input: ParityCardContentInput,
): ParityShortsCardView {
  const metaLine = parityMetaLine(input.metaFacts ?? []);
  return {
    kind: "shorts",
    itemId: input.itemId,
    title: input.title,
    metaLine,
    artwork: parityCardArtwork(input.artwork ?? null, input.title),
    countsLabel: null,
    ariaLabel: ariaLabelOf(input.title, null, metaLine, null),
  };
}

// ---------------------------------------------------------------------------
// The runtime-model mappers (the runtime's own read models → the grammar)
// ---------------------------------------------------------------------------

/** Project one runtime search hit into a card content input (pure). */
export function parityContentInputOfHit(hit: SearchHit): ParityCardContentInput {
  const result = hit.result;
  const metaFacts: string[] = [];
  if (result.canonicalType !== undefined) metaFacts.push(result.canonicalType);
  const artworkResolution = contentArtworkOf(result);
  return {
    itemId: hit.canonicalItemId,
    title: result.title,
    ...(result.canonicalType !== undefined ? { canonicalType: result.canonicalType } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    artwork:
      artworkResolution.kind === "source-artwork"
        ? artworkResolution.artwork
        : null,
    metaFacts,
  };
}

/**
 * Project a search model's hits into FEED cards (order preserved). The
 * `channelOf`/`badgeOf` hooks let an app join its own honest channel and
 * badge facts without this package guessing them.
 */
export function parityFeedCardsFromModel(
  model: SearchModel,
  hooks?: {
    readonly channelOf?: (itemId: string) => string | null;
    readonly badgesOf?: (itemId: string) => readonly string[];
    readonly watchedFractionOf?: (itemId: string) => number | null;
  },
): readonly ParityFeedCardView[] {
  return model.hits.map((hit) => {
    const base = parityContentInputOfHit(hit);
    return parityFeedCard({
      ...base,
      channelLabel: hooks?.channelOf?.(base.itemId) ?? null,
      badgeLabels: hooks?.badgesOf?.(base.itemId) ?? [],
      watchedFraction: hooks?.watchedFractionOf?.(base.itemId) ?? null,
    });
  });
}

/** Project a search model's hits into SEARCH ROW cards (order preserved). */
export function paritySearchRowsFromModel(
  model: SearchModel,
  hooks?: {
    readonly channelOf?: (itemId: string) => string | null;
    readonly snippetOf?: (itemId: string) => string | null;
    readonly badgesOf?: (itemId: string) => readonly string[];
  },
): readonly ParitySearchRowCardView[] {
  return model.hits.map((hit) => {
    const base = parityContentInputOfHit(hit);
    return paritySearchRowCard({
      ...base,
      channelLabel: hooks?.channelOf?.(base.itemId) ?? null,
      snippet: hooks?.snippetOf?.(base.itemId) ?? null,
      badgeLabels: hooks?.badgesOf?.(base.itemId) ?? [],
    });
  });
}

/**
 * Project the related rail from a search model (the watch page's compact
 * 168×94 sidebar grammar). Order preserved.
 */
export function parityRelatedCardsFromModel(
  model: SearchModel,
  hooks?: {
    readonly channelOf?: (itemId: string) => string | null;
  },
): readonly ParityRelatedCardView[] {
  return model.hits.map((hit) => {
    const base = parityContentInputOfHit(hit);
    return parityRelatedCard({
      ...base,
      channelLabel: hooks?.channelOf?.(base.itemId) ?? null,
    });
  });
}

/**
 * Project the shorts rail from a search model — HONESTLY: only rows whose
 * canonical type is `short` (or whose orientation is `vertical`) become
 * shorts cards. Films are NEVER presented as shorts (the W3 honesty law).
 */
export function parityShortsCardsFromModel(
  model: SearchModel,
): readonly ParityShortsCardView[] {
  return model.hits
    .filter((hit) => isShortsRow(hit.result))
    .map((hit) => parityShortsCard(parityContentInputOfHit(hit)));
}

/** The honest shorts-row test (canonical type `short` or vertical orientation). */
export function isShortsRow(result: SearchResult): boolean {
  return (
    result.canonicalType === "short" || result.orientation === "vertical"
  );
}

/**
 * Project one Continue Watching entry (the session fold's resumable item)
 * into a FEED card carrying the watched red-edge fraction — the corpus's
 * "watched" state. `titleOf` resolves the registered title (the honest
 * join; the id when unknown).
 */
export function parityContinueWatchingCard(
  entry: ContinueWatchingEntry,
  titleOf: (itemId: string) => string,
  hooks?: {
    readonly channelOf?: (itemId: string) => string | null;
    readonly artworkOf?: (itemId: string) => ContentArtwork | null;
  },
): ParityFeedCardView {
  return parityFeedCard({
    itemId: entry.itemId,
    title: titleOf(entry.itemId),
    artwork: hooks?.artworkOf?.(entry.itemId) ?? null,
    channelLabel: hooks?.channelOf?.(entry.itemId) ?? null,
    metaFacts: [],
    watchedFraction: entry.completionRatio,
  });
}

/**
 * Compose the chip bar from REAL facets — the honest-count law: a chip
 * with zero rows NEVER renders (dead chips omit). "all" is the default
 * facet and renders its honest total count.
 */
export function parityChipsFromFacets(
  facets: readonly { id: string; label: string; count: number }[],
): readonly ParityChipView[] {
  const chips: ParityChipView[] = [];
  for (const facet of facets) {
    if (!Number.isFinite(facet.count) || facet.count <= 0) continue; // dead chip — omit
    chips.push({
      kind: "chip",
      id: facet.id,
      label: facet.label,
      count: facet.count,
      isDefault: facet.id === "all",
    });
  }
  return chips;
}

/** One skeleton card (the loading state — the shells' geometry is CSS-owned). */
export function paritySkeletonCard(): ParitySkeletonCardView {
  return { kind: "skeleton", lineCount: 2 };
}

/** The skeleton grid (n skeleton cards while loading). */
export function paritySkeletonGrid(count: number): readonly ParitySkeletonCardView[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, () => paritySkeletonCard());
}
