/**
 * @wfx/app-desktop — THE R27 CARD GRAMMAR (the corpus card anatomy,
 * projected — W3's surfaces lane).
 *
 * THE LAW (docs/parity-lab/reference/app-shell.md + search-card-grammar.json
 * + design-tokens.md): every discovery surface renders the SAME card
 * grammar the corpus pins — feed card (16:9 thumbnail radius 12, duration
 * pill bottom-right, 2-line 16/500 title, channel row, 12px meta line,
 * badge, watched red edge), search row (360×202 thumb + meta column:
 * 18/400 title, channel, meta, 12px snippet, badges), related compact
 * card (168×94 thumb, 4px gap, meta right). These pure functions project
 * the EXISTING desktop view models (`item-detail-surface.ts`'s
 * `DesktopDiscoveryRowView`) INTO that grammar — zero new product policy,
 * zero data fabrication.
 *
 * THE HONESTY LAWS THIS GRAMMAR KEEPS:
 * - REAL ARTWORK (R26): `r27ArtworkViewOf` renders the source-carried
 *   `<img>` view when the row carries `ContentArtwork`, and the typed
 *   placeholder-monogram view (with the artwork contract's own fallback
 *   detail) when it does not — never a generated replacement.
 * - DURATION PILLS render only the truth the row carries (`durationMs`
 *   absent ⇒ no pill, never an invented length).
 * - META LINES carry only real facts (canonical type, license basis,
 *   creator names) — the corpus's "views · age" row is honestly absent
 *   because the desktop catalog carries no view/age facts (DIVERGENCES:
 *   no fabricated counts).
 * - CHIPS derive from the rows' REAL facets (a dead chip with no rows
 *   never renders); "All" is the default facet.
 */

import type { ContentArtwork } from "@wfx/domain";

import type { DesktopDiscoveryRowView } from "./item-detail-surface";
import { R27_MOTION } from "./r27-parity-tokens";

// ---------------------------------------------------------------------------
// The view shapes
// ---------------------------------------------------------------------------

/** The artwork view a card renders (the real <img> or the placeholder). */
export type R27ArtworkView =
  | {
    readonly kind: "image";
    /** The source's own artwork URL (connector-authorized, absolute http(s)). */
    readonly url: string;
    /** The honest alt text (the artwork contract's own alt). */
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

/** One feed card (the grid grammar's card anatomy). */
export interface R27FeedCardView {
  readonly itemId: string;
  /** The 2-line-clamped title (16/500/22 — CSS clamps; text stays full). */
  readonly title: string;
  /** The channel row label (14/400 secondary; hover primary in CSS). */
  readonly channelLabel: string | null;
  /** The 12px secondary meta line (the honest facts the row carries). */
  readonly metaLine: string;
  /** The duration pill label ("7:45"); null renders NO pill (honest). */
  readonly durationLabel: string | null;
  /** The artwork view (the real image or the typed placeholder). */
  readonly artwork: R27ArtworkView;
  /** Badge labels under the title (e.g. the peer license basis). */
  readonly badgeLabels: readonly string[];
  /** The watched red-edge fraction in [0,1]; null renders no edge. */
  readonly watchedFraction: number | null;
  /** The card's origin (typed; the rendering is identical). */
  readonly origin: DesktopDiscoveryRowView["origin"];
  /** The accessible label (title + channel + meta + duration). */
  readonly ariaLabel: string;
}

/** One search result row (the row-card grammar). */
export interface R27SearchRowView {
  readonly itemId: string;
  /** The 18/400/26 2-line-clamped title. */
  readonly title: string;
  /** The channel label (14/400 secondary). */
  readonly channelLabel: string | null;
  /** The 12px meta line (the honest facts). */
  readonly metaLine: string;
  /** The 12px/18 2-line snippet; null renders no snippet (honest). */
  readonly snippet: string | null;
  /** The duration pill label; null renders no pill. */
  readonly durationLabel: string | null;
  readonly artwork: R27ArtworkView;
  readonly badgeLabels: readonly string[];
  readonly origin: DesktopDiscoveryRowView["origin"];
  readonly ariaLabel: string;
}

/** One related compact card (the watch sidebar's 168×94 grammar). */
export interface R27RelatedCardView {
  readonly itemId: string;
  /** The 14/500 2-line-clamped title. */
  readonly title: string;
  readonly channelLabel: string | null;
  /** The 12px meta line. */
  readonly metaLine: string;
  readonly durationLabel: string | null;
  readonly artwork: R27ArtworkView;
  readonly ariaLabel: string;
}

/** One chip in the feed's chip bar. */
export interface R27ChipView {
  /** The chip's stable id (the facet key; "all" is the default). */
  readonly id: string;
  /** The chip's label (14/500; the active chip inverts). */
  readonly label: string;
  /** The honest row count behind the chip (never zero — dead chips omit). */
  readonly count: number;
  /** Whether this is the default "All" facet. */
  readonly isDefault: boolean;
}

/** One skeleton card (the loading state's shells). */
export interface R27SkeletonCardView {
  readonly kind: "skeleton";
  /** The shells render at the corpus spec (20px h, radius 8, CSS-owned). */
  readonly lineCount: 2;
}

// ---------------------------------------------------------------------------
// The derivations (pure)
// ---------------------------------------------------------------------------

/**
 * Format a duration as the corpus pill label ("7:45", "1:02:03").
 * `undefined`/non-finite answers null — the pill renders only real truth.
 */
export function r27DurationLabelOf(durationMs: number | undefined | null): string | null {
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

/** Project the artwork contract into the card's artwork view. */
export function r27ArtworkViewOf(
  artwork: ContentArtwork | null,
  title: string,
): R27ArtworkView {
  if (artwork !== null && typeof artwork.url === "string" && artwork.url.startsWith("http")) {
    return {
      kind: "image",
      url: artwork.url,
      alt: `${title} — source artwork`,
      aspectRatio: artwork.aspectRatio ?? null,
    };
  }
  return {
    kind: "monogram",
    initial: title.length > 0 ? title[0]!.toUpperCase() : "·",
    note:
      "No source artwork for this title — the placeholder initial renders instead (never a generated image).",
  };
}

/** The canonical-type label (honest title-casing of the real facet). */
function canonicalTypeLabel(canonicalType: string): string {
  if (canonicalType.length === 0) return "Title";
  return canonicalType[0]!.toUpperCase() + canonicalType.slice(1);
}

/** The meta line: the REAL facts the row carries (never views/age). */
export function r27CardMetaLineOf(row: DesktopDiscoveryRowView): string {
  const parts: string[] = [canonicalTypeLabel(row.canonicalType)];
  if (row.licenseLabel !== undefined && row.licenseLabel.length > 0) {
    parts.push(row.licenseLabel);
  }
  return parts.join(" · ");
}

/** The channel-row label (creators joined; null when the row carries none). */
function channelLabelOf(row: DesktopDiscoveryRowView): string | null {
  if (row.creators.length === 0) return null;
  return row.creators.join(", ");
}

/** The badge labels (the honest license basis on peer rows). */
function badgeLabelsOf(row: DesktopDiscoveryRowView): readonly string[] {
  if (row.licenseLabel === undefined || row.licenseLabel.length === 0) return [];
  // The license basis already rides the meta line; the badge renders the
  // row's ORIGIN truth (the corpus's CC-style badge slot).
  return row.origin === "authorized-peer-copy" ? ["Authorized peer copy"] : [];
}

/** The card's accessible label (the full honest sentence). */
function ariaLabelOf(
  title: string,
  channelLabel: string | null,
  metaLine: string,
  durationLabel: string | null,
): string {
  const parts: string[] = [title];
  if (channelLabel !== null) parts.push(`by ${channelLabel}`);
  parts.push(metaLine);
  if (durationLabel !== null) parts.push(durationLabel);
  return parts.join(", ");
}

/** Project one discovery row into the FEED card grammar. */
export function r27FeedCardOf(
  row: DesktopDiscoveryRowView,
  watch?: {
    readonly completionRatio: number | null;
    readonly positionMs: number;
    readonly durationMs?: number;
  },
): R27FeedCardView {
  const channelLabel = channelLabelOf(row);
  const metaLine = r27CardMetaLineOf(row);
  const durationLabel = r27DurationLabelOf(row.durationMs);
  let watchedFraction: number | null = null;
  if (watch !== undefined && watch.completionRatio !== null) {
    watchedFraction = Math.min(1, Math.max(0, watch.completionRatio));
  } else if (
    watch !== undefined &&
    watch.durationMs !== undefined &&
    watch.durationMs > 0 &&
    watch.positionMs > 0
  ) {
    watchedFraction = Math.min(1, watch.positionMs / watch.durationMs);
  }
  return {
    itemId: row.itemId,
    title: row.title,
    channelLabel,
    metaLine,
    durationLabel,
    artwork: r27ArtworkViewOf(row.artwork, row.title),
    badgeLabels: badgeLabelsOf(row),
    watchedFraction,
    origin: row.origin,
    ariaLabel: ariaLabelOf(row.title, channelLabel, metaLine, durationLabel),
  };
}

/** Project one discovery row into the SEARCH row grammar (with snippet). */
export function r27SearchRowOf(
  row: DesktopDiscoveryRowView,
  snippet?: string | null,
): R27SearchRowView {
  const channelLabel = channelLabelOf(row);
  const metaLine = r27CardMetaLineOf(row);
  const durationLabel = r27DurationLabelOf(row.durationMs);
  return {
    itemId: row.itemId,
    title: row.title,
    channelLabel,
    metaLine,
    snippet: typeof snippet === "string" && snippet.length > 0 ? snippet : null,
    durationLabel,
    artwork: r27ArtworkViewOf(row.artwork, row.title),
    badgeLabels: badgeLabelsOf(row),
    origin: row.origin,
    ariaLabel: ariaLabelOf(row.title, channelLabel, metaLine, durationLabel),
  };
}

/** Project one discovery row into the RELATED compact-card grammar. */
export function r27RelatedCardOf(row: DesktopDiscoveryRowView): R27RelatedCardView {
  const channelLabel = channelLabelOf(row);
  const metaLine = r27CardMetaLineOf(row);
  const durationLabel = r27DurationLabelOf(row.durationMs);
  return {
    itemId: row.itemId,
    title: row.title,
    channelLabel,
    metaLine,
    durationLabel,
    artwork: r27ArtworkViewOf(row.artwork, row.title),
    ariaLabel: ariaLabelOf(row.title, channelLabel, metaLine, durationLabel),
  };
}

/**
 * Derive the chip bar's facets from the rows' REAL canonical types: "All"
 * (the default) + one chip per present facet, each carrying its honest
 * count. A facet with zero rows never renders (no dead chips).
 */
export function r27ChipsOf(rows: readonly DesktopDiscoveryRowView[]): readonly R27ChipView[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.canonicalType.length > 0 ? row.canonicalType : "title";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const chips: R27ChipView[] = [
    { id: "all", label: "All", count: rows.length, isDefault: true },
  ];
  for (const [facet, count] of counts) {
    chips.push({
      id: facet,
      label: canonicalTypeLabel(facet),
      count,
      isDefault: false,
    });
  }
  return chips;
}

/**
 * Apply one chip's facet to the rows (the honest filter: "all" passes
 * everything; a facet keeps only its own rows — the count on the chip is
 * the same number the filter produces).
 */
export function r27ApplyChip(
  rows: readonly DesktopDiscoveryRowView[],
  chipId: string,
): readonly DesktopDiscoveryRowView[] {
  if (chipId === "all") return rows;
  return rows.filter((row) => row.canonicalType === chipId);
}

/** The feed's skeleton cards (the loading state before data lands). */
export function r27SkeletonCards(count: number): readonly R27SkeletonCardView[] {
  return Array.from({ length: Math.max(0, count) }, () => ({
    kind: "skeleton" as const,
    lineCount: 2 as const,
  }));
}

/** The hover-dwell truth (the card's preview disclosure timing). */
export const R27_CARD_HOVER_DWELL_MS: number = R27_MOTION.hoverDwellMs;
