/**
 * @wfx/app-desktop — the AUTHORIZED PEER CATALOG (R26-W3, the production
 * discoverability backbone for the first-class torrent realization).
 *
 * THE CORRECTIVE LAW THIS MODULE IMPLEMENTS (the R26 takeover packet —
 * Worker 3 lane, deliverable 2): torrent is architecturally first-class
 * (R23-C) but was NOT discoverable in the live journey — no authorized
 * peer realization surfaced on the content the audit encountered, and
 * "Torrent accessible ONLY through engineering/admin paths = rejection".
 * The peer realization must be reachable through the NORMAL product
 * journey (browse/search → item → Where to watch → Authorized peer copy
 * → play), with REAL content that is LAWFULLY PEER-SHAREABLE.
 *
 * WHAT THIS CATALOG IS: a REAL product subsystem — the Desktop's curated
 * catalog of lawfully peer-shareable films (the R23 plan's own named
 * category: "a licensed source, a public-domain/Creative-Commons
 * archive"). Every entry is:
 *
 * - REAL CONTENT: a real, complete, watchable open movie;
 * - LAWFULLY PEER-SHAREABLE: Creative-Commons licensed BY the rights
 *   holder (the Blender Foundation), with the license statement and its
 *   official URL carried on the entry — never an assumption;
 * - A REAL TORRENT: the actual v1 infohash, the actual tracker set, and
 *   the actual `.torrent` metainfo file shipped as a repo asset
 *   (`apps/desktop/assets/peer-catalog/*.torrent`) so the engine's
 *   torrent-file ingestion path knows the file list BEFORE any network
 *   contact (the magnets stay the primary open input; the files are the
 *   same swarm's truth);
 * - TRUTHFULLY BROWSER-CAPABLE: these swarms carry WebRTC (wss://)
 *   trackers, so `browserCapable: true` is a per-realization TRUTH, not
 *   the R23-D assumption the contract forbids;
 * - CANONICALLY IDENTIFIED: a deterministic `wfxitm_` id (the SEED's
 *   doctrine — a fixed 48-bit timestamp + hash-derived randomness, the
 *   same id in every environment, so cross-environment canonical
 *   identity is stable for these titles);
 * - ARTWORK-TRUE: the official source-authorized artwork URL (the
 *   films' own sites / Blender Studio), typed through Worker 1's R26-W1
 *   `ContentArtwork` contract — the Desktop-owned catalog surface keeps
 *   thumbnail/artwork parity with the Web.
 *
 * THE PROVENANCE LAW (invariant 5, unchanged): this catalog is a SOURCE
 * DECLARATION only. The engine re-gates every ingestion through the
 * authorized-source registry mint (`createPeerCatalogSourceRegistry`) —
 * an entry whose source is not registered is PROVENANCE_REJECTED, never
 * bypassed. The lawful basis is carried per entry ("creative-commons")
 * with its evidence URL.
 *
 * WHAT THIS MODULE IS NOT: a torrent engine (packages/torrent-engine),
 * a where-to-watch derivation (the R23-E surface), or a web surface.
 * It is the Desktop composition's authorized-realization TRUTH — the
 * `realizationOf` the R23-C binding consumes and the browse/search
 * discovery surface projects.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ContentArtwork } from "@wfx/domain";
import {
  createAuthorizedSourceRegistry,
  isAuthorizedProvenanceBasis,
  type AuthorizedSource,
  type AuthorizedSourceRegistry,
  type TorrentResult,
} from "@wfx/torrent-engine";

import type { DesktopTorrentRealization, DesktopTorrentRealizationSource } from "./torrent-playback";

// ---------------------------------------------------------------------------
// The catalog's identity + provenance vocabulary
// ---------------------------------------------------------------------------

/**
 * The connector id of the Desktop's peer catalog — the "source" the
 * browse/search discovery surface attributes these rows to (the same
 * source-neutral card grammar every catalog row carries).
 */
export const PEER_CATALOG_CONNECTOR_ID = "webflix-peer-catalog";

/**
 * The authorized-source id of the peer catalog's vault entry (the
 * registry-minted provenance names this source; the basis is the frozen
 * "creative-commons" member of the engine's authorized-basis union).
 */
export const PEER_CATALOG_SOURCE_ID = "vault:webflix-peer-catalog";

/**
 * The lawful basis every catalog entry declares (the engine's frozen
 * union member; per-entry license statements name the exact CC license).
 */
export const PEER_CATALOG_BASIS = "creative-commons" as const;

// ---------------------------------------------------------------------------
// The entry shape (the catalog's public truth)
// ---------------------------------------------------------------------------

/** One file inside a catalog entry's torrent (the real metainfo truth). */
export interface PeerCatalogFileEntry {
  /** Path relative to the torrent's download root. */
  readonly path: string;
  /** The file's length in bytes. */
  readonly lengthBytes: number;
}

/** One entry's Creative-Commons license truth (evidence-carried). */
export interface PeerCatalogLicense {
  /** The human license label (e.g. "CC BY 3.0"). */
  readonly label: string;
  /** The license's canonical URL (the deed). */
  readonly url: string;
  /** The rights holder's own licensing statement (one sentence). */
  readonly statement: string;
  /** Where the statement lives (the official page). */
  readonly statementUrl: string;
}

/** One authorized peer-catalog entry (REAL content, REAL torrent truth). */
export interface PeerCatalogEntry {
  /** The deterministic canonical item id (`wfxitm_…`, stable everywhere). */
  readonly itemId: string;
  /** The film's canonical title. */
  readonly title: string;
  /** The release year. */
  readonly year: number;
  /** The rights-holder creator attribution (the license's BY requirement). */
  readonly creators: readonly string[];
  /** One-sentence synopsis (the film's own description). */
  readonly synopsis: string;
  /** The canonical type (all four entries are long-form films). */
  readonly canonicalType: "video";
  /**
   * The film's PUBLISHED duration (the official pages' figure — display
   * truth; the honest playback duration is the engine/player's own
   * measured truth once the file streams).
   */
  readonly durationMs: number;
  /** The REAL magnet URI (infohash + the swarm's actual trackers). */
  readonly magnet: string;
  /** The REAL v1 infohash (lowercase hex — the swarm's identity). */
  readonly infoHash: string;
  /** The shipped `.torrent` asset's file name (the metainfo truth). */
  readonly torrentFileName: string;
  /** The REAL file list from the shipped metainfo (order = torrent order). */
  readonly files: readonly PeerCatalogFileEntry[];
  /** The playable video file's path (the auto-selection truth). */
  readonly videoFilePath: string;
  /** The video file's size in bytes. */
  readonly videoBytes: number;
  /** The total size of every file in the torrent. */
  readonly totalBytes: number;
  /** The per-piece length of the real metainfo. */
  readonly pieceLengthBytes: number;
  /** The license truth (evidence-carried). */
  readonly license: PeerCatalogLicense;
  /** The official source-authorized artwork URL (verified reachable). */
  readonly artworkUrl: string;
  /** The artwork's alt text (the accessibility truth). */
  readonly artworkAltText: string;
  /** The film's official page (the canonical source page). */
  readonly homepageUrl: string;
  /** The per-realization WebRTC capability TRUTH (these swarms carry wss trackers). */
  readonly browserCapable: boolean;
}

// ---------------------------------------------------------------------------
// The deterministic canonical-id derivation (the SEED's doctrine)
// ---------------------------------------------------------------------------

/** The Crockford Base32 alphabet (the ULID body's law — ids.ts). */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The catalog's fixed 48-bit id timestamp — 2026-09-22T00:00:00Z (the
 * corrective round's date; the same FIXED timestamp every environment
 * derives, exactly the seed's determinism law).
 */
const PEER_CATALOG_ID_TIMESTAMP_MS = Date.UTC(2026, 8, 22);

/**
 * Derive one entry's DETERMINISTIC canonical item id: `wfxitm_` + a
 * 26-char Crockford Base32 ULID body whose 10-char time section encodes
 * the fixed catalog timestamp and whose 16-char random section is the
 * first 80 bits of sha256(`"<connector>:<infoHash>"`). The derivation is
 * PURE — the same source key always answers the same id, in every
 * environment, forever (cross-environment canonical identity for these
 * titles; mirrors `apps/api/src/host/seed.ts`'s doctrine).
 */
function peerCatalogItemIdOf(infoHash: string): string {
  const digest = createHash("sha256")
    .update(`${PEER_CATALOG_CONNECTOR_ID}:${infoHash}`)
    .digest();

  // Time section: 10 chars * 5 bits = the fixed timestamp, zero-padded.
  let time = PEER_CATALOG_ID_TIMESTAMP_MS;
  let timeSection = "";
  for (let index = 0; index < 10; index += 1) {
    timeSection = CROCKFORD_ALPHABET.charAt(time % 32) + timeSection;
    time = Math.floor(time / 32);
  }

  // Random section: 16 chars * 5 bits = 80 bits of the digest.
  let accumulator = 0;
  let bits = 0;
  let randomSection = "";
  for (const byte of digest) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5 && randomSection.length < 16) {
      bits -= 5;
      randomSection += CROCKFORD_ALPHABET.charAt((accumulator >>> bits) & 31);
    }
  }

  return `wfxitm_${timeSection}${randomSection}`;
}

// ---------------------------------------------------------------------------
// THE CATALOG (real content — every field verified against the sources)
// ---------------------------------------------------------------------------

/**
 * The REAL tracker set these swarms carry (from the actual metainfo
 * files): the UDP trackers AND the WebRTC (wss://) trackers that make
 * `browserCapable: true` the honest per-realization declaration.
 */
const PEER_CATALOG_TRACKERS: readonly string[] = [
  "udp://tracker.leechers-paradise.org:6969",
  "udp://tracker.coppersurfer.tk:6969",
  "udp://tracker.opentrackr.org:1337",
  "udp://explodie.org:6969",
  "udp://tracker.empire-js.us:1337",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.fastcast.nz",
];

/** Build the entry's magnet URI (the real infohash + the real trackers). */
function magnetOf(entry: { readonly infoHash: string; readonly title: string }): string {
  const trackers = PEER_CATALOG_TRACKERS.map(
    (tracker) => `&tr=${encodeURIComponent(tracker)}`,
  ).join("");
  return `magnet:?xt=urn:btih:${entry.infoHash}&dn=${encodeURIComponent(entry.title)}${trackers}`;
}

/**
 * THE AUTHORIZED PEER CATALOG — four Blender Foundation OPEN MOVIES:
 * real, complete, professionally produced short films released BY THE
 * RIGHTS HOLDER under Creative Commons attribution licenses that
 * explicitly permit sharing and redistribution. Every torrent field is
 * the actual metainfo truth (parsed from the shipped
 * `apps/desktop/assets/peer-catalog/*.torrent` files; see
 * peer-catalog.test.ts for the byte-level verification).
 */
export const PEER_CATALOG_ENTRIES: readonly PeerCatalogEntry[] = [
  {
    title: "Big Buck Bunny",
    year: 2008,
    creators: ["Blender Foundation"],
    synopsis:
      "A giant rabbit with a heart bigger than himself meets three bullying rodents — the Blender Institute's landmark open movie, produced entirely with free and open-source tools.",
    canonicalType: "video",
    durationMs: 596_000,
    infoHash: "74036a39dd3018ef5ae6f115497290c711c308da",
    torrentFileName: "big-buck-bunny.torrent",
    files: [
      { path: "Big Buck Bunny.en.srt", lengthBytes: 140 },
      { path: "Big Buck Bunny.mp4", lengthBytes: 276_134_947 },
      { path: "poster.jpg", lengthBytes: 310_380 },
    ],
    videoFilePath: "Big Buck Bunny.mp4",
    videoBytes: 276_134_947,
    totalBytes: 276_445_467,
    pieceLengthBytes: 262_144,
    license: {
      label: "CC BY 3.0",
      url: "https://creativecommons.org/licenses/by/3.0/",
      statement:
        "The Blender Foundation publishes Big Buck Bunny under Creative Commons Attribution 3.0 — share and show the film freely with attribution.",
      statementUrl: "https://peach.blender.org/about/",
    },
    artworkUrl:
      "https://studio.blender.org/files/public/thumbnail/25/a9/25a908ff92e1033f02c7b79db2edc398_m.webp",
    artworkAltText: "Big Buck Bunny — official Blender Studio artwork",
    homepageUrl: "https://peach.blender.org/",
    browserCapable: true,
    itemId: peerCatalogItemIdOf("74036a39dd3018ef5ae6f115497290c711c308da"),
    magnet: magnetOf({
      infoHash: "74036a39dd3018ef5ae6f115497290c711c308da",
      title: "Big Buck Bunny",
    }),
  },
  {
    title: "Sintel",
    year: 2010,
    creators: ["Blender Foundation"],
    synopsis:
      "A lonely young woman searches the wastelands for the dragon she once nursed back to health — the Blender Institute's third open movie.",
    canonicalType: "video",
    durationMs: 888_000,
    infoHash: "b6a3752ebf43b27ff5a76661d32bca4df08b0b02",
    torrentFileName: "sintel.torrent",
    files: [
      { path: "Sintel.de.srt", lengthBytes: 1_652 },
      { path: "Sintel.en.srt", lengthBytes: 1_514 },
      { path: "Sintel.es.srt", lengthBytes: 1_554 },
      { path: "Sintel.fr.srt", lengthBytes: 1_618 },
      { path: "Sintel.it.srt", lengthBytes: 1_546 },
      { path: "Sintel.mp4", lengthBytes: 129_241_752 },
      { path: "Sintel.nl.srt", lengthBytes: 1_537 },
      { path: "Sintel.pl.srt", lengthBytes: 1_536 },
      { path: "Sintel.pt.srt", lengthBytes: 1_551 },
      { path: "Sintel.ru.srt", lengthBytes: 2_016 },
      { path: "poster.jpg", lengthBytes: 46_115 },
    ],
    videoFilePath: "Sintel.mp4",
    videoBytes: 129_241_752,
    totalBytes: 129_302_391,
    pieceLengthBytes: 131_072,
    license: {
      label: "CC BY 3.0",
      url: "https://creativecommons.org/licenses/by/3.0/",
      statement:
        "The Blender Foundation publishes Sintel under Creative Commons Attribution 3.0 — you can share and show the movie freely as long as you include the credit scroll.",
      statementUrl: "https://durian.blender.org/about/",
    },
    artworkUrl:
      "https://durian.blender.org/wp-content/uploads/2011/02/4-DVD-verti-feb2011.jpg",
    artworkAltText: "Sintel — official poster artwork",
    homepageUrl: "https://durian.blender.org/",
    browserCapable: true,
    itemId: peerCatalogItemIdOf("b6a3752ebf43b27ff5a76661d32bca4df08b0b02"),
    magnet: magnetOf({
      infoHash: "b6a3752ebf43b27ff5a76661d32bca4df08b0b02",
      title: "Sintel",
    }),
  },
  {
    title: "Tears of Steel",
    year: 2012,
    creators: ["Blender Foundation"],
    synopsis:
      "In a future Amsterdam, a group of warriors and scientists gather at the Oude Kerk to stage a crucial event from the past — the Blender Institute's live-action/CGI open movie.",
    canonicalType: "video",
    durationMs: 734_000,
    infoHash: "9c677c3fab374db96c9137e8878e97893ba96ce3",
    torrentFileName: "tears-of-steel.torrent",
    files: [
      { path: "Tears of Steel.de.srt", lengthBytes: 4_850 },
      { path: "Tears of Steel.en.srt", lengthBytes: 4_755 },
      { path: "Tears of Steel.es.srt", lengthBytes: 4_944 },
      { path: "Tears of Steel.fr.srt", lengthBytes: 4_618 },
      { path: "Tears of Steel.it.srt", lengthBytes: 4_746 },
      { path: "Tears of Steel.nl.srt", lengthBytes: 4_531 },
      { path: "Tears of Steel.no.srt", lengthBytes: 9_558 },
      { path: "Tears of Steel.ru.srt", lengthBytes: 5_933 },
      { path: "Tears of Steel.webm", lengthBytes: 571_346_576 },
      { path: "poster.jpg", lengthBytes: 35_996 },
    ],
    videoFilePath: "Tears of Steel.webm",
    videoBytes: 571_346_576,
    totalBytes: 571_426_507,
    pieceLengthBytes: 524_288,
    license: {
      label: "CC BY 3.0",
      url: "https://creativecommons.org/licenses/by/3.0/",
      statement:
        "The Blender Foundation publishes Tears of Steel under a Creative Commons Attribution license — free for everyone to distribute and reuse (the film's own site carries the cc-by terms).",
      statementUrl: "https://mango.blender.org/",
    },
    artworkUrl:
      "https://mango.blender.org/wp-content/uploads/2013/06/12_scients_header.jpg",
    artworkAltText: "Tears of Steel — official still artwork",
    homepageUrl: "https://mango.blender.org/",
    browserCapable: true,
    itemId: peerCatalogItemIdOf("9c677c3fab374db96c9137e8878e97893ba96ce3"),
    magnet: magnetOf({
      infoHash: "9c677c3fab374db96c9137e8878e97893ba96ce3",
      title: "Tears of Steel",
    }),
  },
  {
    title: "Cosmos Laundromat: First Cycle",
    year: 2015,
    creators: ["Blender Foundation"],
    synopsis:
      "A suicidal sheep named Franck meets a mysterious salesman who offers him the life he always dreamed of — the first episode of the Blender Institute's open-movie project.",
    canonicalType: "video",
    durationMs: 726_000,
    infoHash: "f46ada76ae66b9151c3f98cb98b34240ce115faa",
    torrentFileName: "cosmos-laundromat.torrent",
    files: [
      { path: "Cosmos Laundromat.en.srt", lengthBytes: 3_945 },
      { path: "Cosmos Laundromat.es.srt", lengthBytes: 3_911 },
      { path: "Cosmos Laundromat.fr.srt", lengthBytes: 4_120 },
      { path: "Cosmos Laundromat.it.srt", lengthBytes: 3_945 },
      { path: "Cosmos Laundromat.mp4", lengthBytes: 220_087_570 },
      { path: "poster.jpg", lengthBytes: 760_595 },
    ],
    videoFilePath: "Cosmos Laundromat.mp4",
    videoBytes: 220_087_570,
    totalBytes: 220_864_086,
    pieceLengthBytes: 262_144,
    license: {
      label: "CC BY",
      url: "https://creativecommons.org/licenses/by/4.0/",
      statement:
        "The Blender Foundation publishes Cosmos Laundromat under a Creative Commons Attribution license — the Gooseberry project's open-movie release.",
      statementUrl: "https://gooseberry.blender.com/",
    },
    artworkUrl:
      "https://studio.blender.org/files/public/thumbnail/0d/91/0d91fba6aa9e0934c0d12012ec11189085831203_o_xs.webp",
    artworkAltText: "Cosmos Laundromat — official Blender Studio artwork",
    homepageUrl: "https://gooseberry.blender.com/",
    browserCapable: true,
    itemId: peerCatalogItemIdOf("f46ada76ae66b9151c3f98cb98b34240ce115faa"),
    magnet: magnetOf({
      infoHash: "f46ada76ae66b9151c3f98cb98b34240ce115faa",
      title: "Cosmos Laundromat",
    }),
  },
];

// ---------------------------------------------------------------------------
// The catalog reads (pure)
// ---------------------------------------------------------------------------

/** The catalog's entry for one canonical item id (null when unknown). */
export function peerCatalogByItemId(itemId: string): PeerCatalogEntry | null {
  return PEER_CATALOG_ENTRIES.find((entry) => entry.itemId === itemId) ?? null;
}

/** The catalog's entry for one infohash (null when unknown). */
export function peerCatalogByInfoHash(infoHash: string): PeerCatalogEntry | null {
  return PEER_CATALOG_ENTRIES.find((entry) => entry.infoHash === infoHash) ?? null;
}

/**
 * The catalog's title search (case-insensitive substring over title,
 * creators, and synopsis — the same simple, honest matching the catalog
 * connector's own search performs; ranked: title hits first, then
 * creator hits, then synopsis hits, codepoint-stable within a tier).
 */
export function peerCatalogSearch(query: string): readonly PeerCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...PEER_CATALOG_ENTRIES];
  const titleHits: PeerCatalogEntry[] = [];
  const creatorHits: PeerCatalogEntry[] = [];
  const synopsisHits: PeerCatalogEntry[] = [];
  for (const entry of PEER_CATALOG_ENTRIES) {
    if (entry.title.toLowerCase().includes(needle)) {
      titleHits.push(entry);
    } else if (entry.creators.some((creator) => creator.toLowerCase().includes(needle))) {
      creatorHits.push(entry);
    } else if (entry.synopsis.toLowerCase().includes(needle)) {
      synopsisHits.push(entry);
    }
  }
  return [...titleHits, ...creatorHits, ...synopsisHits];
}

// ---------------------------------------------------------------------------
// The shipped metainfo assets (the torrent-file path's truth)
// ---------------------------------------------------------------------------

/** The directory the shipped `.torrent` assets live in. */
function peerCatalogAssetsDir(): string {
  // src/platform/peer-catalog.ts → ../../assets/peer-catalog
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "assets", "peer-catalog");
}

/**
 * Read one entry's shipped `.torrent` bytes (the REAL metainfo — the
 * engine's torrent-file ingestion path consumes these when the caller
 * prefers metadata-before-network). Null (never a fabricated file) when
 * the asset is absent on this install.
 */
export function peerCatalogTorrentBytes(entry: PeerCatalogEntry): Uint8Array | null {
  const path = join(peerCatalogAssetsDir(), entry.torrentFileName);
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch {
    return null; // an unreadable asset is the honest null, never a fake
  }
}

// ---------------------------------------------------------------------------
// The R23-C realization truth (the composition's realizationOf)
// ---------------------------------------------------------------------------

/**
 * Derive one entry's {@link DesktopTorrentRealization} — the composition's
 * authorized-realization truth for the R23-C binding, carrying BOTH real
 * open inputs for the two lanes that consume them:
 *
 * - `torrentBytes` (when the shipped `.torrent` asset is readable) — the
 *   ENGINE's ingestion lane (metadata-before-network: the file-selection
 *   step knows the truth with zero swarm contact);
 * - `magnet` — the NATIVE-OPEN lane (the v1 engine wire protocol carries
 *   JSON DTOs; bytes cannot cross it — the real magnet with its real
 *   trackers is the wire-transportable swarm identity).
 */
export function peerCatalogTorrentRealizationOf(
  entry: PeerCatalogEntry,
): DesktopTorrentRealization {
  const torrentBytes = peerCatalogTorrentBytes(entry);
  return {
    itemId: entry.itemId,
    title: entry.title,
    magnet: entry.magnet,
    ...(torrentBytes !== null ? { torrentBytes } : {}),
    provenance: { sourceId: PEER_CATALOG_SOURCE_ID, basis: PEER_CATALOG_BASIS },
    browserCapable: entry.browserCapable,
    knownFilePaths: entry.files.map((file) => file.path),
  };
}

/**
 * The peer catalog's REALIZATION SOURCE (the `realizationOf` the R23-C
 * binding consumes): the catalog's own truth, MERGED with an optional
 * additional source (the user's media vault) — the additional source
 * wins on conflict (the user's own copy outranks the catalog's).
 */
export function createPeerCatalogRealizationSource(
  additional?: DesktopTorrentRealizationSource,
): DesktopTorrentRealizationSource {
  return (itemId: string): DesktopTorrentRealization | null => {
    const extra = additional?.(itemId) ?? null;
    if (extra !== null) return extra;
    const entry = peerCatalogByItemId(itemId);
    return entry !== null ? peerCatalogTorrentRealizationOf(entry) : null;
  };
}

// ---------------------------------------------------------------------------
// The authorized-source registry (the provenance mint's truth)
// ---------------------------------------------------------------------------

/**
 * The peer catalog's authorized-source registry: the catalog's vault
 * source REGISTERED (the engine's own gate), plus any additional sources
 * the composition carries (the user's vault). This is the registry the
 * composition's `mintProvenance` (the `authorizeProvenance` mint) binds
 * — the ONLY lawful `AuthorizedProvenance` construction path.
 */
export function createPeerCatalogSourceRegistry(
  additionalSources: readonly AuthorizedSource[] = [],
): AuthorizedSourceRegistry & {
  register(source: AuthorizedSource): TorrentResult<AuthorizedSource>;
} {
  return createAuthorizedSourceRegistry({
    sources: [
      {
        sourceId: PEER_CATALOG_SOURCE_ID,
        basis: PEER_CATALOG_BASIS,
        label: "The WebFlix authorized peer catalog (Creative-Commons open movies)",
      },
      ...additionalSources.filter(
        (source) =>
          source.sourceId !== PEER_CATALOG_SOURCE_ID &&
          isAuthorizedProvenanceBasis(source.basis),
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// The artwork truth (Worker 1's R26-W1 contract, bound on the Desktop's
// own catalog surface)
// ---------------------------------------------------------------------------

/**
 * Project one entry's artwork through Worker 1's frozen R26-W1
 * `ContentArtwork` contract — the Desktop-owned catalog surface keeps
 * thumbnail/artwork parity with the Web (real source-authorized URLs,
 * never generated replacements; the monogram placeholder stays the
 * typed fallback beneath, exactly the Web's law).
 */
export function peerCatalogArtworkOf(entry: PeerCatalogEntry): ContentArtwork {
  return {
    url: entry.artworkUrl,
    variant: "thumbnail",
    provenance: {
      kind: "source-artwork",
      connectorId: PEER_CATALOG_CONNECTOR_ID,
      sourceRef: entry.infoHash,
    },
    aspectRatio: 16 / 9,
    fallback: {
      kind: "placeholder-monogram",
      detail: `The official ${entry.title} artwork could not be loaded — the title's initial renders instead.`,
    },
    source: {
      artworkServed: true,
      connectorId: PEER_CATALOG_CONNECTOR_ID,
    },
    cache: {
      origin: "source",
      detail: "The film's own site serves this artwork — the source's own URL and policy.",
    },
  };
}
