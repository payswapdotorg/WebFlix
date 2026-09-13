/**
 * Deterministic retrieval fixtures (WFX-020, Lane A).
 *
 * NO randomness, NO clock reads: every id, timestamp, and value here is a
 * hand-authored literal. The fixtures satisfy the WFX-020 packet minimums:
 *
 * - 12 canonical entertainment items covering ALL 7 canonical types
 *   (movie, series, episode, video, short, post, audio).
 * - 19 source realizations across 3 fake connector ids with DIFFERENT
 *   capability sets:
 *     · `wfx-test-native`   — native-capable (declares playNative + download)
 *     · `wfx-test-embed`    — embed-only (playEmbed; no native/browser/external)
 *     · `wfx-test-browser`  — browser + external (playBrowser + playExternal;
 *                              no native/embed)
 * - 5 user intents covering all 5 frozen scopes (persistent, temporary,
 *   session, momentary, social).
 *
 * Canonical id scheme: every id is a structurally canonical literal
 * (`wfxitm_` / `wfxsrc_` / `wfxcre_` / `wfxtop_` / `wfxint_` + 26-char
 * Crockford Base32 ULID body, first char 0-7) — the fixtures test asserts
 * this via the `@wfx/domain` guards, so a typo cannot survive CI.
 *
 * Realization ids encode freshness in their ULID time section (the index's
 * dedupe law — "keeping the freshest" — is data-driven):
 *   · base reports       time section `01F8KQZ7T0`
 *   · stale re-reports   time section `01D78GYZ0R` (older — always discarded)
 *   · fresh re-reports   time section `02HB6WZ9RK` (newer — always wins)
 * Synthetic ids minted by the connector bridge carry the fixed epoch-0 time
 * section `0000000000`, so search-hit existence records always lose
 * freshness battles against genuinely minted realization ids.
 */

import type {
  Capability,
  EntertainmentItem,
  SearchResult,
  SourceRealization,
  UserIntent,
} from "@wfx/domain";

import { CandidateIndex, type RetrievalItemInput, type RetrievalLabels } from "./index";

/** The deterministic retrieval instant for fixture indexes. */
export const RETRIEVAL_NOW = "2026-09-13T12:00:00.000Z";

/** The fixture user every intent belongs to. */
export const FIXTURE_USER_ID = "wfx-user-fixture";

// ---------------------------------------------------------------------------
// Fake connectors (opaque ids + capability truth — three DIFFERENT sets)
// ---------------------------------------------------------------------------

export const NATIVE_CONNECTOR_ID = "wfx-test-native";
export const EMBED_CONNECTOR_ID = "wfx-test-embed";
export const BROWSER_CONNECTOR_ID = "wfx-test-browser";

/** Native-capable connector: controls the media path (playNative, download). */
export const NATIVE_CONNECTOR_CAPABILITIES: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "download",
];

/** Embed-only connector: official embed player, nothing else. */
export const EMBED_CONNECTOR_CAPABILITIES: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playEmbed",
  "availability",
  "like",
  "comment",
];

/** Browser + external connector: in-app browser playback or external handoff. */
export const BROWSER_CONNECTOR_CAPABILITIES: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playBrowser",
  "playExternal",
  "availability",
  "follow",
];

// ---------------------------------------------------------------------------
// Canonical id literals (structurally canonical, hand-authored)
// ---------------------------------------------------------------------------

const itemId = {
  dunePartTwo: "wfxitm_01ARZ3NDEKF1XTVRE000000001",
  grandBudapest: "wfxitm_01ARZ3NDEKF1XTVRE000000002",
  severance: "wfxitm_01ARZ3NDEKF1XTVRE000000003",
  severanceS2E1: "wfxitm_01ARZ3NDEKF1XTVRE000000004",
  kurzgesagtLastHuman: "wfxitm_01ARZ3NDEKF1XTVRE000000005",
  morningStretch: "wfxitm_01ARZ3NDEKF1XTVRE000000006",
  deskSetup: "wfxitm_01ARZ3NDEKF1XTVRE000000007",
  ulidPost: "wfxitm_01ARZ3NDEKF1XTVRE000000008",
  loFiBeats: "wfxitm_01ARZ3NDEKF1XTVRE000000009",
  historyOfRome: "wfxitm_01ARZ3NDEKF1XTVRE00000000A",
  paperCrane: "wfxitm_01ARZ3NDEKF1XTVRE00000000B",
  stalker: "wfxitm_01ARZ3NDEKF1XTVRE00000000C",
} as const;

const creatorId = {
  denisVilleneuve: "wfxcre_01ARZ3NDEKCREA70R000000001",
  wesAnderson: "wfxcre_01ARZ3NDEKCREA70R000000002",
  danErickson: "wfxcre_01ARZ3NDEKCREA70R000000003",
  kurzgesagt: "wfxcre_01ARZ3NDEKCREA70R000000004",
  fitLoop: "wfxcre_01ARZ3NDEKCREA70R000000005",
  techNest: "wfxcre_01ARZ3NDEKCREA70R000000006",
  devDiary: "wfxcre_01ARZ3NDEKCREA70R000000007",
  chillCatCollective: "wfxcre_01ARZ3NDEKCREA70R000000008",
  mikeDuncan: "wfxcre_01ARZ3NDEKCREA70R000000009",
  origamiSensei: "wfxcre_01ARZ3NDEKCREA70R00000000A",
  andreiTarkovsky: "wfxcre_01ARZ3NDEKCREA70R00000000B",
  mubiClassics: "wfxcre_01ARZ3NDEKCREA70R00000000C",
} as const;

const topicId = {
  scienceFiction: "wfxtop_01ARZ3NDEK70P1C00000000001",
  epic: "wfxtop_01ARZ3NDEK70P1C00000000002",
  comedy: "wfxtop_01ARZ3NDEK70P1C00000000003",
  caper: "wfxtop_01ARZ3NDEK70P1C00000000004",
  thriller: "wfxtop_01ARZ3NDEK70P1C00000000005",
  space: "wfxtop_01ARZ3NDEK70P1C00000000006",
  science: "wfxtop_01ARZ3NDEK70P1C00000000007",
  fitness: "wfxtop_01ARZ3NDEK70P1C00000000008",
  wellness: "wfxtop_01ARZ3NDEK70P1C00000000009",
  tech: "wfxtop_01ARZ3NDEK70P1C0000000000A",
  setup: "wfxtop_01ARZ3NDEK70P1C0000000000B",
  engineering: "wfxtop_01ARZ3NDEK70P1C0000000000C",
  loFi: "wfxtop_01ARZ3NDEK70P1C0000000000D",
  focus: "wfxtop_01ARZ3NDEK70P1C0000000000E",
  history: "wfxtop_01ARZ3NDEK70P1C0000000000F",
  craft: "wfxtop_01ARZ3NDEK70P1C00000000010",
  artFilm: "wfxtop_01ARZ3NDEK70P1C00000000011",
} as const;

const intentId = {
  sciFiEpics: "wfxint_01ARZ3NDEK1NTENT0000000001",
  verticalShorts: "wfxint_01ARZ3NDEK1NTENT0000000002",
  loFiAudio: "wfxint_01ARZ3NDEK1NTENT0000000003",
  spaceDocs: "wfxint_01ARZ3NDEK1NTENT0000000004",
  comedyParty: "wfxint_01ARZ3NDEK1NTENT0000000005",
} as const;

// ---------------------------------------------------------------------------
// Creators / topics (graph-shaped enrichment records)
// ---------------------------------------------------------------------------

/** Canonical creator records referenced by the fixture items. */
export interface FixtureCreator {
  id: string;
  name: string;
  kind: "person" | "group" | "channel" | "studio";
}

export const FIXTURE_CREATORS: readonly FixtureCreator[] = [
  { id: creatorId.denisVilleneuve, name: "Denis Villeneuve", kind: "person" },
  { id: creatorId.wesAnderson, name: "Wes Anderson", kind: "person" },
  { id: creatorId.danErickson, name: "Dan Erickson", kind: "person" },
  { id: creatorId.kurzgesagt, name: "Kurzgesagt", kind: "channel" },
  { id: creatorId.fitLoop, name: "FitLoop", kind: "channel" },
  { id: creatorId.techNest, name: "TechNest", kind: "channel" },
  { id: creatorId.devDiary, name: "DevDiary", kind: "person" },
  { id: creatorId.chillCatCollective, name: "ChillCat Collective", kind: "group" },
  { id: creatorId.mikeDuncan, name: "Mike Duncan", kind: "person" },
  { id: creatorId.origamiSensei, name: "Origami Sensei", kind: "person" },
  { id: creatorId.andreiTarkovsky, name: "Andrei Tarkovsky", kind: "person" },
  { id: creatorId.mubiClassics, name: "Mubi Classics", kind: "studio" },
];

/** Canonical topic records referenced by the fixture items. */
export interface FixtureTopic {
  id: string;
  label: string;
}

export const FIXTURE_TOPICS: readonly FixtureTopic[] = [
  { id: topicId.scienceFiction, label: "science fiction" },
  { id: topicId.epic, label: "epic" },
  { id: topicId.comedy, label: "comedy" },
  { id: topicId.caper, label: "caper" },
  { id: topicId.thriller, label: "thriller" },
  { id: topicId.space, label: "space" },
  { id: topicId.science, label: "science" },
  { id: topicId.fitness, label: "fitness" },
  { id: topicId.wellness, label: "wellness" },
  { id: topicId.tech, label: "tech" },
  { id: topicId.setup, label: "setup" },
  { id: topicId.engineering, label: "engineering" },
  { id: topicId.loFi, label: "lo-fi" },
  { id: topicId.focus, label: "focus" },
  { id: topicId.history, label: "history" },
  { id: topicId.craft, label: "craft" },
  { id: topicId.artFilm, label: "art film" },
];

// ---------------------------------------------------------------------------
// Items — 12 canonical items, all 7 canonical types
// ---------------------------------------------------------------------------

export const FIXTURE_ITEMS: readonly RetrievalItemInput[] = [
  {
    id: itemId.dunePartTwo,
    canonicalType: "movie",
    canonicalTitle: "Dune: Part Two",
    durationMs: 9_960_000,
    orientation: "horizontal",
    creators: [creatorId.denisVilleneuve],
    topics: [topicId.scienceFiction, topicId.epic],
  },
  {
    id: itemId.grandBudapest,
    canonicalType: "movie",
    canonicalTitle: "The Grand Budapest Hotel",
    durationMs: 5_940_000,
    orientation: "horizontal",
    creators: [creatorId.wesAnderson],
    topics: [topicId.comedy, topicId.caper],
  },
  {
    id: itemId.severance,
    canonicalType: "series",
    canonicalTitle: "Severance",
    orientation: "horizontal",
    creators: [creatorId.danErickson],
    topics: [topicId.scienceFiction, topicId.thriller],
  },
  {
    id: itemId.severanceS2E1,
    canonicalType: "episode",
    canonicalTitle: "Severance S2E1: Hello, Ms. Casey",
    durationMs: 2_700_000,
    orientation: "horizontal",
    creators: [creatorId.danErickson],
    topics: [topicId.scienceFiction, topicId.thriller],
  },
  {
    id: itemId.kurzgesagtLastHuman,
    canonicalType: "video",
    canonicalTitle: "Kurzgesagt: The Last Human",
    durationMs: 630_000,
    orientation: "horizontal",
    creators: [creatorId.kurzgesagt],
    topics: [topicId.space, topicId.science],
  },
  {
    id: itemId.morningStretch,
    canonicalType: "short",
    canonicalTitle: "Morning Stretch Routine",
    durationMs: 45_000,
    orientation: "vertical",
    creators: [creatorId.fitLoop],
    topics: [topicId.fitness, topicId.wellness],
  },
  {
    id: itemId.deskSetup,
    canonicalType: "short",
    canonicalTitle: "Desk Setup Tour 2026",
    durationMs: 92_000,
    orientation: "vertical",
    creators: [creatorId.techNest],
    topics: [topicId.tech, topicId.setup],
  },
  {
    id: itemId.ulidPost,
    canonicalType: "post",
    canonicalTitle: "Deep-dive: why ULIDs beat UUIDs for content ids",
    orientation: "square",
    creators: [creatorId.devDiary],
    topics: [topicId.engineering],
  },
  {
    id: itemId.loFiBeats,
    canonicalType: "audio",
    canonicalTitle: "Lo-Fi Study Beats Vol. 4",
    durationMs: 3_600_000,
    orientation: "unknown",
    creators: [creatorId.chillCatCollective],
    topics: [topicId.loFi, topicId.focus],
  },
  {
    id: itemId.historyOfRome,
    canonicalType: "audio",
    canonicalTitle: "The History of Rome - Episode 1",
    durationMs: 2_400_000,
    orientation: "unknown",
    creators: [creatorId.mikeDuncan],
    topics: [topicId.history],
  },
  {
    id: itemId.paperCrane,
    canonicalType: "video",
    canonicalTitle: "Folding a Paper Crane in 4K",
    durationMs: 480_000,
    orientation: "horizontal",
    creators: [creatorId.origamiSensei],
    topics: [topicId.craft],
  },
  {
    id: itemId.stalker,
    canonicalType: "movie",
    canonicalTitle: "Stalker",
    durationMs: 9_600_000,
    orientation: "horizontal",
    creators: [creatorId.andreiTarkovsky, creatorId.mubiClassics],
    topics: [topicId.scienceFiction, topicId.artFilm],
  },
];

// ---------------------------------------------------------------------------
// Realizations — 19 source records across the 3 connectors
// ---------------------------------------------------------------------------

/** Realization ids by freshness tier (time section encodes the ordering). */
const realizationId = {
  // Base tier (`01F8KQZ7T0`): the standard fixture reports.
  duneNative: "wfxsrc_01F8KQZ7T0S0VRCERE00000001",
  duneEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE00000002",
  duneBrowser: "wfxsrc_01F8KQZ7T0S0VRCERE00000003",
  budapestEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE00000004",
  severanceNative: "wfxsrc_01F8KQZ7T0S0VRCERE00000005",
  severanceEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE00000006",
  severanceS2E1Native: "wfxsrc_01F8KQZ7T0S0VRCERE00000007",
  kurzgesagtEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE00000008",
  kurzgesagtBrowser: "wfxsrc_01F8KQZ7T0S0VRCERE00000009",
  stretchNative: "wfxsrc_01F8KQZ7T0S0VRCERE0000000A",
  stretchEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE0000000B",
  deskEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE0000000C",
  deskBrowser: "wfxsrc_01F8KQZ7T0S0VRCERE0000000D",
  ulidPostBrowser: "wfxsrc_01F8KQZ7T0S0VRCERE0000000E",
  loFiNative: "wfxsrc_01F8KQZ7T0S0VRCERE0000000F",
  loFiBrowser: "wfxsrc_01F8KQZ7T0S0VRCERE00000010",
  romeNative: "wfxsrc_01F8KQZ7T0S0VRCERE00000011",
  paperCraneEmbed: "wfxsrc_01F8KQZ7T0S0VRCERE00000012",
  stalkerBrowser: "wfxsrc_01F8KQZ7T0S0VRCERE00000013",
} as const;

export const FIXTURE_REALIZATIONS: readonly SourceRealization[] = [
  {
    id: realizationId.duneNative,
    entertainmentItemId: itemId.dunePartTwo,
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/dune-part-two",
    capabilities: [...NATIVE_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.duneEmbed,
    entertainmentItemId: itemId.dunePartTwo,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/dune-part-two",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.duneBrowser,
    entertainmentItemId: itemId.dunePartTwo,
    connectorId: BROWSER_CONNECTOR_ID,
    externalRef: "br/dune-part-two",
    capabilities: [...BROWSER_CONNECTOR_CAPABILITIES],
    availability: "unknown",
  },
  {
    id: realizationId.budapestEmbed,
    entertainmentItemId: itemId.grandBudapest,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/grand-budapest",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.severanceNative,
    entertainmentItemId: itemId.severance,
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/severance",
    capabilities: [...NATIVE_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.severanceEmbed,
    entertainmentItemId: itemId.severance,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/severance",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.severanceS2E1Native,
    entertainmentItemId: itemId.severanceS2E1,
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/severance-s2e1",
    capabilities: [...NATIVE_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.kurzgesagtEmbed,
    entertainmentItemId: itemId.kurzgesagtLastHuman,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/last-human",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.kurzgesagtBrowser,
    entertainmentItemId: itemId.kurzgesagtLastHuman,
    connectorId: BROWSER_CONNECTOR_ID,
    externalRef: "br/last-human",
    capabilities: [...BROWSER_CONNECTOR_CAPABILITIES],
    availability: "unknown",
  },
  {
    id: realizationId.stretchNative,
    entertainmentItemId: itemId.morningStretch,
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/morning-stretch",
    capabilities: [...NATIVE_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.stretchEmbed,
    entertainmentItemId: itemId.morningStretch,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/morning-stretch",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "unknown",
  },
  {
    id: realizationId.deskEmbed,
    entertainmentItemId: itemId.deskSetup,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/desk-setup",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.deskBrowser,
    entertainmentItemId: itemId.deskSetup,
    connectorId: BROWSER_CONNECTOR_ID,
    externalRef: "br/desk-setup",
    capabilities: [...BROWSER_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.ulidPostBrowser,
    entertainmentItemId: itemId.ulidPost,
    connectorId: BROWSER_CONNECTOR_ID,
    externalRef: "br/ulid-post",
    capabilities: [...BROWSER_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.loFiNative,
    entertainmentItemId: itemId.loFiBeats,
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/lofi-vol4",
    capabilities: [...NATIVE_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.loFiBrowser,
    entertainmentItemId: itemId.loFiBeats,
    connectorId: BROWSER_CONNECTOR_ID,
    externalRef: "br/lofi-vol4",
    capabilities: [...BROWSER_CONNECTOR_CAPABILITIES],
    availability: "unknown",
  },
  {
    id: realizationId.romeNative,
    entertainmentItemId: itemId.historyOfRome,
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/rome-ep1",
    capabilities: [...NATIVE_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.paperCraneEmbed,
    entertainmentItemId: itemId.paperCrane,
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/paper-crane",
    capabilities: [...EMBED_CONNECTOR_CAPABILITIES],
    availability: "available",
  },
  {
    id: realizationId.stalkerBrowser,
    entertainmentItemId: itemId.stalker,
    connectorId: BROWSER_CONNECTOR_ID,
    externalRef: "br/stalker",
    capabilities: [...BROWSER_CONNECTOR_CAPABILITIES],
    availability: "unavailable",
  },
];

// ---------------------------------------------------------------------------
// Dedupe / conflict fixtures (freshness-controlled re-reports)
// ---------------------------------------------------------------------------

/**
 * A STALE re-report of the Dune native pair (older ULID time section,
 * weaker capabilities): the index must DISCARD it and keep the base report.
 */
export const STALE_DUNE_NATIVE_REPORT: SourceRealization = {
  id: "wfxsrc_01D78GYZ0RS0VRCERE00000001",
  entertainmentItemId: itemId.dunePartTwo,
  connectorId: NATIVE_CONNECTOR_ID,
  externalRef: "nv/dune-part-two",
  capabilities: ["metadata"],
  availability: "unknown",
};

/**
 * A FRESH re-report of the Lo-Fi native pair (newer ULID time section): the
 * index must REPLACE the base report with this one (whole-realization
 * replacement — capabilities and availability come from the fresh report).
 */
export const FRESH_LOFI_NATIVE_REPORT: SourceRealization = {
  id: "wfxsrc_02HB6WZ9RKS0VRCERE0000000F",
  entertainmentItemId: itemId.loFiBeats,
  connectorId: NATIVE_CONNECTOR_ID,
  externalRef: "nv/lofi-vol4",
  capabilities: ["identity", "catalogSearch", "metadata", "playNative", "playEmbed", "availability"],
  availability: "unknown",
};

/**
 * A cross-item conflict: the Dune native pair re-reported for a DIFFERENT
 * canonical item — invalid input (one source record realizes exactly one
 * canonical identity); ingest must throw a typed RetrievalError.
 */
export const CONFLICTING_DUNE_REPORT: SourceRealization = {
  id: "wfxsrc_02HB6WZ9RKS0VRCERE00000014",
  entertainmentItemId: itemId.grandBudapest,
  connectorId: NATIVE_CONNECTOR_ID,
  externalRef: "nv/dune-part-two",
  capabilities: ["metadata"],
  availability: "unknown",
};

// ---------------------------------------------------------------------------
// Labels (graph enrichment: creator names / topic labels)
// ---------------------------------------------------------------------------

export const FIXTURE_CREATOR_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  FIXTURE_CREATORS.map((creator) => [creator.id, creator.name]),
);

export const FIXTURE_TOPIC_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  FIXTURE_TOPICS.map((topic) => [topic.id, topic.label]),
);

export const FIXTURE_LABELS: RetrievalLabels = {
  creatorNames: FIXTURE_CREATOR_NAMES,
  topicLabels: FIXTURE_TOPIC_LABELS,
};

// ---------------------------------------------------------------------------
// Intents — 5 user intents across all 5 frozen scopes
// ---------------------------------------------------------------------------

export const FIXTURE_INTENTS: readonly UserIntent[] = [
  {
    id: intentId.sciFiEpics,
    userId: FIXTURE_USER_ID,
    scope: "persistent",
    objective: "science fiction epics",
    weight: 0.9,
    confidence: 0.85,
    provenance: "explicit",
  },
  {
    id: intentId.verticalShorts,
    userId: FIXTURE_USER_ID,
    scope: "session",
    objective: "vertical shorts for a quick break",
    weight: 0.75,
    confidence: 0.6,
    provenance: "inferred",
  },
  {
    id: intentId.loFiAudio,
    userId: FIXTURE_USER_ID,
    scope: "momentary",
    objective: "lo-fi audio focus beats",
    weight: 0.8,
    confidence: 0.7,
    provenance: "inferred",
    expiresAt: "2026-09-13T12:30:00.000Z",
  },
  {
    id: intentId.spaceDocs,
    userId: FIXTURE_USER_ID,
    scope: "temporary",
    objective: "space documentaries",
    weight: 0.6,
    confidence: 0.75,
    provenance: "inferred",
    expiresAt: "2026-09-20T12:00:00.000Z",
  },
  {
    id: intentId.comedyParty,
    userId: FIXTURE_USER_ID,
    scope: "social",
    objective: "comedy watch party",
    weight: 0.5,
    confidence: 0.9,
    provenance: "explicit",
  },
];

// ---------------------------------------------------------------------------
// Connector search results + mapper (for the ingest bridge)
// ---------------------------------------------------------------------------

/**
 * A batch of connector search hits exercising every bridge outcome:
 * a NEW pair (extended cut), two KNOWN pairs (absorbed by freshest-wins —
 * the synthetic epoch-0 ids lose to the base reports), one UNMAPPABLE hit,
 * and one MALFORMED hit (empty externalRef).
 */
export const FIXTURE_SEARCH_RESULTS: readonly SearchResult[] = [
  {
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/dune-extended-cut",
    title: "Dune: Part Two (Extended Cut)",
    canonicalType: "movie",
    durationMs: 10_080_000,
    orientation: "horizontal",
  },
  {
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/severance-s2e1",
    title: "Severance S2E1: Hello, Ms. Casey",
    canonicalType: "episode",
    durationMs: 2_700_000,
    orientation: "horizontal",
  },
  {
    connectorId: EMBED_CONNECTOR_ID,
    externalRef: "em/grand-budapest",
    title: "The Grand Budapest Hotel",
    canonicalType: "movie",
    durationMs: 5_940_000,
    orientation: "horizontal",
  },
  {
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "nv/region-locked-special",
    title: "Region-Locked Special",
  },
  {
    connectorId: NATIVE_CONNECTOR_ID,
    externalRef: "",
    title: "No Ref",
  },
];

/**
 * The deterministic fixture mapper: resolves (connectorId, externalRef) to
 * the canonical fixture item, or `null` when the hit cannot be mapped.
 */
export function fixtureItemFor(result: SearchResult): EntertainmentItem | null {
  const key = `${result.connectorId}:${result.externalRef}`;
  const byKey: Readonly<Record<string, EntertainmentItem>> = {
    [`${NATIVE_CONNECTOR_ID}:nv/dune-extended-cut`]: FIXTURE_ITEMS[0] as EntertainmentItem,
    [`${NATIVE_CONNECTOR_ID}:nv/severance-s2e1`]: FIXTURE_ITEMS[3] as EntertainmentItem,
    [`${EMBED_CONNECTOR_ID}:em/grand-budapest`]: FIXTURE_ITEMS[1] as EntertainmentItem,
  };
  return byKey[key] ?? null;
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

/**
 * Build a fully-loaded fixture index: all 12 items, all 19 realizations, and
 * the creator/topic label maps, anchored at `RETRIEVAL_NOW`. Deterministic:
 * two calls yield indistinguishable index states.
 */
export function buildFixtureIndex(): CandidateIndex {
  const index = new CandidateIndex({ retrievedAt: RETRIEVAL_NOW });
  index.ingest(FIXTURE_ITEMS, FIXTURE_REALIZATIONS, FIXTURE_LABELS);
  return index;
}
