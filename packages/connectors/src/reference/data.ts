/**
 * @wfx/connectors — the reference connector's fixture catalog (WFX-013).
 *
 * A COMPLETE, DETERMINISTIC, OFFLINE catalog:
 * - 12 `SourceItem`s covering every canonical type (movie, series, episode,
 *   video, short, post, audio);
 * - every item carries at least one `PlaybackRealization`, drawn from a mix
 *   of embed / browser / external modes — native is ABSENT because the
 *   reference descriptor does not declare `playNative` (capability truth:
 *   a realization mode the connector denies is never fabricated);
 * - deterministic `availability` values (available / unavailable / unknown —
 *   all three occur in the fixture);
 * - NO network, NO clock, NO randomness: URLs use the reserved `.invalid`
 *   TLD (RFC 2606) so fixture data can never be mistaken for a live source,
 *   and every timestamp is a fixed ISO constant.
 *
 * The catalog is stored as compact seeds and DERIVED into its exported shape
 * (items, realizations, search documents) at module load, so internal
 * consistency (item.capabilities ↔ realization modes ↔ search index) is
 * structural rather than hand-maintained. Everything exported is deep-frozen:
 * callers can read the fixtures but never mutate them.
 */

import type {
  LibraryEntry,
  PlaybackMode,
  PlaybackRealization,
  SourceItem,
} from "@wfx/domain";

import { REFERENCE_CONNECTOR_ID } from "./descriptor";

// ---------------------------------------------------------------------------
// Playback mode truth for this source
// ---------------------------------------------------------------------------

/**
 * The playback modes the reference source can realize.
 *
 * `native` is EXCLUDED at the type level: the reference descriptor does not
 * declare `playNative`, so a native realization cannot even be expressed in
 * the fixture — the "NATIVE is unsupported and therefore ABSENT" rule is
 * structural, not a runtime promise.
 */
export type ReferencePlaybackMode = Exclude<PlaybackMode, "native">;

/** The play capability that backs each playback mode. */
const PLAY_CAPABILITY_FOR_MODE: Readonly<Record<PlaybackMode, string>> = {
  native: "playNative", // unreachable: ReferencePlaybackMode excludes "native"
  embed: "playEmbed",
  browser: "playBrowser",
  external: "playExternal",
};

/**
 * The canonical playback precedence for THIS source, lowest first:
 * embed → browser → external.
 *
 * `native` carries its frozen-hint slot (a declared-native source would rank
 * it first) but never occurs here — the fixture contains no native
 * realizations and `resolve` therefore never produces one.
 */
export const REFERENCE_PLAYBACK_MODE_PRECEDENCE: Readonly<Record<PlaybackMode, number>> = {
  native: 0,
  embed: 1,
  browser: 2,
  external: 3,
};

/** Order two realizations by the canonical precedence (embed < browser < external). */
export function byReferencePrecedence(
  a: PlaybackRealization,
  b: PlaybackRealization,
): number {
  return REFERENCE_PLAYBACK_MODE_PRECEDENCE[a.mode] - REFERENCE_PLAYBACK_MODE_PRECEDENCE[b.mode];
}

// ---------------------------------------------------------------------------
// Tokenization (the search index's only normalization)
// ---------------------------------------------------------------------------

/**
 * Tokenize a string for search: lowercase, split on non-alphanumeric runs,
 * drop empty fragments. Pure and deterministic — the same input always
 * yields the same tokens ("Aurora Protocol!" → ["aurora", "protocol"]).
 */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// ---------------------------------------------------------------------------
// Catalog seeds (the single hand-written source of fixture truth)
// ---------------------------------------------------------------------------

type CanonicalType = NonNullable<SourceItem["canonicalType"]>;
type Orientation = NonNullable<SourceItem["orientation"]>;
type Availability = SourceItem["availability"]; // 'available' | 'unknown' | 'unavailable'

/** Compact seed for one catalog entry; everything else is derived. */
interface CatalogSeed {
  readonly ref: string;
  readonly title: string;
  readonly canonicalType: CanonicalType;
  readonly durationMs?: number;
  readonly orientation?: Orientation;
  readonly availability: Availability;
  /** Topic strings, folded into the search index and item metadata. */
  readonly topics: readonly string[];
  /** Playback modes in canonical precedence order (embed → browser → external). */
  readonly modes: readonly ReferencePlaybackMode[];
}

/**
 * The 12 fixture items. Availability is deliberately mixed (available,
 * unavailable, unknown) so every deterministic branch is exercised. Every
 * item has at least one playback realization.
 */
const CATALOG_SEEDS: readonly CatalogSeed[] = [
  {
    ref: "ref:movie-aurora",
    title: "Aurora Protocol",
    canonicalType: "movie",
    durationMs: 7_080_000, // 118 min
    orientation: "horizontal",
    availability: "available",
    topics: ["space", "thriller", "scifi"],
    modes: ["embed", "browser", "external"],
  },
  {
    ref: "ref:movie-cartographer",
    title: "The Cartographer's Daughter",
    canonicalType: "movie",
    durationMs: 5_760_000, // 96 min
    orientation: "horizontal",
    availability: "unavailable",
    topics: ["drama", "expedition", "maps"],
    modes: ["browser", "external"],
  },
  {
    ref: "ref:series-lighthouse",
    title: "Lighthouse Keepers",
    canonicalType: "series",
    orientation: "horizontal",
    availability: "available",
    topics: ["drama", "mystery", "coastal"],
    modes: ["embed", "browser"],
  },
  {
    ref: "ref:series-static-harbor",
    title: "Static Harbor",
    canonicalType: "series",
    orientation: "horizontal",
    availability: "unknown",
    topics: ["mystery", "radio", "drama"],
    modes: ["external"],
  },
  {
    ref: "ref:episode-lighthouse-s1e1",
    title: "Lighthouse Keepers S1E1 The First Light",
    canonicalType: "episode",
    durationMs: 1_860_000, // 31 min
    orientation: "horizontal",
    availability: "available",
    topics: ["pilot", "mystery"],
    modes: ["embed"],
  },
  {
    ref: "ref:episode-lighthouse-s1e2",
    title: "Lighthouse Keepers S1E2 Fog Signal",
    canonicalType: "episode",
    durationMs: 1_740_000, // 29 min
    orientation: "horizontal",
    availability: "available",
    topics: ["mystery"],
    modes: ["embed", "browser"],
  },
  {
    ref: "ref:video-featurette-aurora",
    title: "Featurette Building the Aurora Set",
    canonicalType: "video",
    durationMs: 720_000, // 12 min
    orientation: "horizontal",
    availability: "available",
    topics: ["production", "behindthescenes"],
    modes: ["browser"],
  },
  {
    ref: "ref:short-silence",
    title: "Sixty Seconds of Silence",
    canonicalType: "short",
    durationMs: 60_000, // 60 s
    orientation: "vertical",
    availability: "available",
    topics: ["experimental", "calm"],
    modes: ["embed"],
  },
  {
    ref: "ref:short-neon-rain",
    title: "Neon Rain Walk",
    canonicalType: "short",
    durationMs: 41_000, // 41 s
    orientation: "vertical",
    availability: "unknown",
    topics: ["ambient", "city"],
    modes: ["external"],
  },
  {
    ref: "ref:post-storyboards",
    title: "Behind the Scenes Aurora Storyboards",
    canonicalType: "post",
    orientation: "square",
    availability: "available",
    topics: ["art", "behindthescenes"],
    modes: ["browser"],
  },
  {
    ref: "ref:audio-aurora-score",
    title: "Aurora Protocol Original Score",
    canonicalType: "audio",
    durationMs: 3_120_000, // 52 min
    availability: "available",
    topics: ["music", "score"],
    modes: ["external"],
  },
  {
    ref: "ref:audio-static-commentary",
    title: "Static Harbor Episode Commentary",
    canonicalType: "audio",
    durationMs: 2_280_000, // 38 min
    availability: "unavailable",
    topics: ["commentary", "radio"],
    modes: ["external"],
  },
];

/** The fixture "saved" list surfaced by `readLibrary` (deterministic, fixed timestamps). */
const LIBRARY_SEEDS: readonly {
  ref: string;
  addedAt: string;
  metadata?: Record<string, unknown>;
}[] = [
  {
    ref: "ref:movie-aurora",
    addedAt: "2026-09-01T09:00:00.000Z",
    metadata: { topics: ["space", "thriller", "scifi"] },
  },
  { ref: "ref:series-lighthouse", addedAt: "2026-09-03T18:30:00.000Z" },
  { ref: "ref:audio-aurora-score", addedAt: "2026-09-05T12:15:00.000Z" },
];

// ---------------------------------------------------------------------------
// Derivation: seeds → frozen exported fixtures
// ---------------------------------------------------------------------------

/** Deterministic, non-routable URL for one realization (`.invalid` TLD, RFC 2606). */
function realizationUrl(mode: ReferencePlaybackMode, ref: string): string {
  const slug = ref.slice("ref:".length);
  return `https://reference.invalid/${mode}/${slug}`;
}

/** Derive one playback realization from its mode + ref. */
function realize(mode: ReferencePlaybackMode, ref: string): PlaybackRealization {
  return {
    mode,
    connectorId: REFERENCE_CONNECTOR_ID,
    url: realizationUrl(mode, ref),
    externalRef: ref,
    capabilities: [PLAY_CAPABILITY_FOR_MODE[mode]],
  };
}

/** Derive the full `SourceItem` for a seed (capabilities mirror its modes). */
function buildItem(seed: CatalogSeed, modes: readonly ReferencePlaybackMode[]): SourceItem {
  const capabilities = [...new Set(modes.map((mode) => PLAY_CAPABILITY_FOR_MODE[mode]))];
  const item: SourceItem = {
    connectorId: REFERENCE_CONNECTOR_ID,
    externalRef: seed.ref,
    title: seed.title,
    canonicalType: seed.canonicalType,
    availability: seed.availability,
    capabilities,
    metadata: { topics: [...seed.topics] },
  };
  if (seed.durationMs !== undefined) item.durationMs = seed.durationMs;
  if (seed.orientation !== undefined) item.orientation = seed.orientation;
  return item;
}

/** Recursively freeze a fixture value so exported data can never be mutated. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const element of value) deepFreeze(element);
    } else {
      for (const property of Object.values(value)) deepFreeze(property);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * One reference catalog entry: the full item plus its realizations in
 * canonical precedence order (embed → browser → external; native absent).
 */
export interface ReferenceCatalogEntry {
  readonly item: SourceItem;
  readonly realizations: readonly PlaybackRealization[];
}

function buildEntry(seed: CatalogSeed): ReferenceCatalogEntry {
  // Sort defensively even though seeds are already precedence-ordered:
  // the exported order is a derived invariant, not a hand-maintained one.
  const modes = [...seed.modes].sort(
    (a, b) =>
      REFERENCE_PLAYBACK_MODE_PRECEDENCE[a] - REFERENCE_PLAYBACK_MODE_PRECEDENCE[b],
  );
  const entry: ReferenceCatalogEntry = {
    item: buildItem(seed, modes),
    realizations: modes.map((mode) => realize(mode, seed.ref)),
  };
  return deepFreeze(entry);
}

/** The complete reference catalog, deep-frozen, in stable catalog order. */
export const REFERENCE_CATALOG: readonly ReferenceCatalogEntry[] = deepFreeze(
  CATALOG_SEEDS.map(buildEntry),
);

/**
 * The fixture "saved" list returned by `readLibrary`.
 * Deep-frozen; `addedAt` values are fixed ISO constants (no clock).
 */
export const REFERENCE_LIBRARY: readonly LibraryEntry[] = deepFreeze(
  LIBRARY_SEEDS.map((seed) => {
    const title = findTitle(seed.ref);
    const entry: LibraryEntry = {
      connectorId: REFERENCE_CONNECTOR_ID,
      externalRef: seed.ref,
      title,
      addedAt: seed.addedAt,
    };
    if (seed.metadata !== undefined) entry.metadata = { ...seed.metadata };
    return entry;
  }),
);

function findTitle(ref: string): string {
  const entry = CATALOG_SEEDS.find((seed) => seed.ref === ref);
  if (entry === undefined) {
    // A library seed pointing at a missing catalog ref is a fixture bug —
    // fail loudly at module load rather than serving a malformed entry.
    throw new Error(`reference fixture: library seed references unknown ref '${ref}'`);
  }
  return entry.title;
}

// ---------------------------------------------------------------------------
// Search index (tokenized title + topics, case-insensitive)
// ---------------------------------------------------------------------------

/**
 * One searchable document: the ref plus the lowercased alphanumeric tokens
 * of its title and topic strings. Derived from the catalog, so the index is
 * always in sync with the items it indexes.
 */
export interface ReferenceSearchDocument {
  readonly externalRef: string;
  readonly titleTokens: readonly string[];
  readonly topicTokens: readonly string[];
}

/** Read the topic strings off an item's metadata (defensive, deterministic). */
function topicsOf(item: SourceItem): readonly string[] {
  const topics = item.metadata?.["topics"];
  return Array.isArray(topics) ? (topics as readonly string[]) : [];
}

function buildSearchDocument(entry: ReferenceCatalogEntry): ReferenceSearchDocument {
  return deepFreeze({
    externalRef: entry.item.externalRef,
    titleTokens: tokenize(entry.item.title),
    topicTokens: tokenize(topicsOf(entry.item).join(" ")),
  });
}

/** The tokenized search index, aligned with `REFERENCE_CATALOG` by position. */
export const REFERENCE_SEARCH_INDEX: readonly ReferenceSearchDocument[] = deepFreeze(
  REFERENCE_CATALOG.map(buildSearchDocument),
);

// ---------------------------------------------------------------------------
// Lookup helpers (module-private map, exported read-only access)
// ---------------------------------------------------------------------------

const CATALOG_BY_REF: ReadonlyMap<string, ReferenceCatalogEntry> = new Map(
  REFERENCE_CATALOG.map((entry) => [entry.item.externalRef, entry]),
);

/**
 * Find one catalog entry by its external ref.
 * Pure: returns the same frozen entry for the same ref every time,
 * or `undefined` when the ref is unknown.
 */
export function findReferenceCatalogEntry(ref: string): ReferenceCatalogEntry | undefined {
  return CATALOG_BY_REF.get(ref);
}
