/**
 * @wfx/client-runtime — the R24-A YouTube-parity taxonomy (THE shared
 * feature-inventory contract).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md — R24-A + the lab
 * rule in docs/validation/youtube-parity-lab.md):
 *
 * Every relevant viewer-facing capability observed in the current YouTube
 * product resolves to EXACTLY ONE classification:
 *
 * - `parity`                    — WebFlix provides the same user capability
 *                                 using source-neutral semantics;
 * - `native-equivalent`         — WebFlix provides the capability with a
 *                                 WebFlix-specific implementation because
 *                                 its multi-source mission requires
 *                                 different mechanics;
 * - `platform-variant`          — the capability exists where the Web/
 *                                 Desktop/mobile platform actually supports
 *                                 it (capability truth, never fake universality);
 * - `intentionally-out-of-scope`— not part of the Universal Entertainment
 *                                 OS mission; the row MUST carry the reason
 *                                 and the nearest user-facing WebFlix path.
 *
 * A BLANK classification is a lab failure, and NO feature may remain "to be
 * considered" after the lab review (both machine-checked below — see
 * {@link validateParityTaxonomy} and {@link PENDING_CLASSIFICATION_MARKERS}).
 *
 * ROW POPULATION (the frozen floor, complete — nothing left unclassified):
 * - the plan's ENTIRE R24-C pairing matrix — Discovery, Watch/player,
 *   Shorts, Identity/continuity — plus the reference rows the frozen lab
 *   contract (docs/validation/youtube-parity-lab.md) already inventories;
 * - EVERY WebFlix-only extension the R24-B extension law lists (the 14
 *   capabilities that "are not optional extras for the parity lab; they
 *   are part of the WebFlix identity").
 *
 * The taxonomy rows pair with `capability-placement.ts` (the R24-B laws
 * 1–6 as machine-checkable placement contracts) and feed
 * `interaction-policy.ts` (the startup/autoplay seams).
 *
 * WHAT THIS MODULE IS: INVENTORY + CLASSIFICATION — a typed read model
 * (data + pure derivations). It does NOT create a second product
 * architecture (the frozen product law): the primary navigation stays
 * Home / Watch / Shorts / Search / Library / Settings, rows never mint
 * navigation, and every user entry point renders inside the frozen
 * product-surface union (`ProductSurfaceId`). Workers 2/3 bind their
 * parity surfaces to THESE rows so Web/Desktop cannot invent divergent
 * semantics; the lead's J40/J41/J42 acceptance verifies against them.
 *
 * WHAT THIS MODULE IS NOT: a UI, a status tracker, or a YouTube-clone
 * spec. It adopts the INTERACTION GRAMMAR of a mature video platform —
 * never its branding, icons, copy or implementation.
 */

import type { ProductSurfaceId } from "./discoverability";
import type { ViewerAuthClass } from "./anonymous-viewing";

// ---------------------------------------------------------------------------
// The classification vocabulary (the lab rule — verbatim, closed)
// ---------------------------------------------------------------------------

/**
 * The parity classification of one taxonomy row — the frozen four-value
 * lab rule (`docs/validation/youtube-parity-lab.md`).
 */
export type ParityClassification =
  | "parity"
  | "native-equivalent"
  | "platform-variant"
  | "intentionally-out-of-scope";

/** Every value of {@link ParityClassification}, in lab order. */
export const PARITY_CLASSIFICATIONS: readonly ParityClassification[] = [
  "parity",
  "native-equivalent",
  "platform-variant",
  "intentionally-out-of-scope",
] as const;

/** Runtime membership check against the classification union. */
export function isParityClassification(
  x: unknown,
): x is ParityClassification {
  return (
    typeof x === "string" &&
    (PARITY_CLASSIFICATIONS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The area vocabulary (the R24-C matrix areas + the R24-B extension list)
// ---------------------------------------------------------------------------

/**
 * The matrix area a row belongs to: the plan's four R24-C areas plus the
 * R24-B WebFlix-only extension list.
 */
export type ParityTaxonomyArea =
  | "discovery"
  | "watch-player"
  | "shorts"
  | "identity-continuity"
  | "webflix-extension";

/** Every value of {@link ParityTaxonomyArea}, in plan order. */
export const PARITY_TAXONOMY_AREAS: readonly ParityTaxonomyArea[] = [
  "discovery",
  "watch-player",
  "shorts",
  "identity-continuity",
  "webflix-extension",
] as const;

/** Runtime membership check against the area union. */
export function isParityTaxonomyArea(x: unknown): x is ParityTaxonomyArea {
  return (
    typeof x === "string" &&
    (PARITY_TAXONOMY_AREAS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The reference-surface vocabulary (where the YouTube reference lives)
// ---------------------------------------------------------------------------

/**
 * The surface of the YouTube REFERENCE product where a row's reference
 * behavior is observed. For `webflix-extension` rows this names the
 * surface whose interaction grammar the extension borrows (the R24-B
 * law: extensions appear where a user would naturally expect them).
 */
export type ParityReferenceSurface =
  | "home"
  | "search"
  | "watch"
  | "shorts"
  | "library"
  | "channel"
  | "account"
  | "live"
  | "cross-surface";

/** Every value of {@link ParityReferenceSurface}. */
export const PARITY_REFERENCE_SURFACES: readonly ParityReferenceSurface[] = [
  "home",
  "search",
  "watch",
  "shorts",
  "library",
  "channel",
  "account",
  "live",
  "cross-surface",
] as const;

/** Runtime membership check against the reference-surface union. */
export function isParityReferenceSurface(
  x: unknown,
): x is ParityReferenceSurface {
  return (
    typeof x === "string" &&
    (PARITY_REFERENCE_SURFACES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Web/Desktop applicability (capability truth, never fake universality)
// ---------------------------------------------------------------------------

/**
 * Whether one platform adapter truthfully supports a capability. The
 * values are the R21 capability-truth law: a capability an adapter
 * cannot run is still DISCOVERABLE there with an honest next step —
 * never a dead "not available".
 */
export type ParitySurfaceSupport =
  /** The adapter truly supports the capability. */
  | "supported"
  /** Support depends on truthful platform/source capability (e.g. WebRTC peers). */
  | "capability-dependent"
  /** This adapter shows the honest next step; the other adapter owns the path. */
  | "native-only-next-step";

/** Every value of {@link ParitySurfaceSupport}. */
export const PARITY_SURFACE_SUPPORTS: readonly ParitySurfaceSupport[] = [
  "supported",
  "capability-dependent",
  "native-only-next-step",
] as const;

/** Runtime membership check against the surface-support union. */
export function isParitySurfaceSupport(x: unknown): x is ParitySurfaceSupport {
  return (
    typeof x === "string" &&
    (PARITY_SURFACE_SUPPORTS as readonly string[]).includes(x)
  );
}

/**
 * The Web/Desktop applicability of one row — the two-adapter truth the
 * plan's "Web/Desktop applicability" field freezes. Platform differences
 * are CAPABILITY truth (the R24-B law 6), never redesigned semantics:
 * both entries describe the SAME product capability.
 */
export interface ParityApplicability {
  /** Web-adapter truth for this capability. */
  readonly web: ParitySurfaceSupport;
  /** Desktop-adapter truth for this capability. */
  readonly desktop: ParitySurfaceSupport;
}

// ---------------------------------------------------------------------------
// Performance relevance (whether R24-E's playback-performance laws touch
// the capability)
// ---------------------------------------------------------------------------

/**
 * How the R24-E playback-performance contract touches one capability:
 *
 * - `startup-critical`  — on the measured startup critical path (the one
 *   obvious play action, canonical item + realization resolution, the
 *   media surface engage, torrent verified-range start, accountless
 *   public start);
 * - `startup-adjacent`  — must NEVER block first frame; the R24-E startup
 *   law defers it (recommendations, AI enrichment, nonessential metadata,
 *   posters, autoplay gating, chat);
 * - `playback-quality`  — materially affects the post-startup metrics
 *   (seek response, rebuffer, control responsiveness, recovery);
 * - `none`              — no direct R24-E metric relevance.
 */
export type ParityPerformanceRelevance =
  | "startup-critical"
  | "startup-adjacent"
  | "playback-quality"
  | "none";

/** Every value of {@link ParityPerformanceRelevance}. */
export const PARITY_PERFORMANCE_RELEVANCES: readonly ParityPerformanceRelevance[] =
  [
    "startup-critical",
    "startup-adjacent",
    "playback-quality",
    "none",
  ] as const;

/** Runtime membership check against the relevance union. */
export function isParityPerformanceRelevance(
  x: unknown,
): x is ParityPerformanceRelevance {
  return (
    typeof x === "string" &&
    (PARITY_PERFORMANCE_RELEVANCES as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// Implementation-owner vocabulary (the R24 three-worker split)
// ---------------------------------------------------------------------------

/**
 * The R24 implementation owner of one row — the plan's Worker split
 * (Worker 1 shared, Worker 2 Web, Worker 3 Desktop/native/torrent, Lead
 * ratification/integration). A row may span several owners; the array
 * is never empty (machine-checked).
 */
export type ParityImplementationOwner =
  | "worker-1"
  | "worker-2"
  | "worker-3"
  | "lead";

/** Every value of {@link ParityImplementationOwner}. */
export const PARITY_IMPLEMENTATION_OWNERS: readonly ParityImplementationOwner[] =
  ["worker-1", "worker-2", "worker-3", "lead"] as const;

/** Runtime membership check against the owner union. */
export function isParityImplementationOwner(
  x: unknown,
): x is ParityImplementationOwner {
  return (
    typeof x === "string" &&
    (PARITY_IMPLEMENTATION_OWNERS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The user entry point (the point-of-intent law's taxonomy half)
// ---------------------------------------------------------------------------

/**
 * Where a user encounters the capability — the plan's "user entry point"
 * field. `surfaces` MUST name at least one contextual product surface
 * from the frozen union (`ProductSurfaceId`: home / watch / shorts /
 * search / item / library / settings / player); a row whose ONLY entry
 * is `settings` violates the point-of-intent law and is rejected by
 * {@link validateParityTaxonomy}.
 */
export interface ParityUserEntryPoint {
  /** The product surfaces the entry renders on (never a dashboard route). */
  readonly surfaces: readonly ProductSurfaceId[];
  /** The visible affordance a user meets (concise, user vocabulary). */
  readonly control: string;
  /** True when the entry is contextual (at the point of intent). */
  readonly contextual: boolean;
}

// ---------------------------------------------------------------------------
// One taxonomy row — the frozen 17-field schema (R24-A, verbatim)
// ---------------------------------------------------------------------------

/**
 * One row of the R24-A parity taxonomy. The field set is the plan's
 * frozen schema; every field is required on every row except the two
 * out-of-scope companions, which are REQUIRED the moment a row
 * classifies `intentionally-out-of-scope` (the lab rule: the row must
 * include the reason and the nearest user-facing WebFlix path).
 */
export interface ParityTaxonomyRow {
  /** The row's stable id (the join key for placement + evidence). */
  readonly id: ParityTaxonomyRowId;
  /** The R24-C matrix area (or the R24-B extension list). */
  readonly area: ParityTaxonomyArea;
  /** The reference capability being paired (YouTube-side name). */
  readonly referenceCapability: string;
  /** The YouTube surface(s) where the reference behavior is observed. */
  readonly referenceSurface: ParityReferenceSurface;
  /** What the reference product does (the observable behavior). */
  readonly referenceBehavior: string;
  /** The WebFlix pairing (the plan's R24-C/R24-B treatment, verbatim). */
  readonly webflixTreatment: string;
  /** The frozen classification (never blank, never "to be considered"). */
  readonly classification: ParityClassification;
  /** Where the user encounters the WebFlix capability. */
  readonly userEntryPoint: ParityUserEntryPoint;
  /** Web/Desktop applicability (capability truth). */
  readonly webDesktopApplicability: ParityApplicability;
  /** The R23-A auth class of the capability. */
  readonly authRequirement: ViewerAuthClass;
  /** How the capability interacts with sources/realizations. */
  readonly sourceRealizationImplications: string;
  /** What state persists, where, for how long. */
  readonly persistenceExpectation: string;
  /** The accessibility requirement (keyboard / screen reader / motion). */
  readonly accessibilityRequirement: string;
  /** Whether/how R24-E's performance laws touch the capability. */
  readonly performanceRelevance: ParityPerformanceRelevance;
  /** The golden-journey / test ids that exercise the row. */
  readonly testJourneyIds: readonly string[];
  /** The frozen lab/evidence link (doc path, evidence path, or source URL). */
  readonly evidenceLink: string;
  /** The R24 implementation owners (never empty). */
  readonly implementationOwners: readonly ParityImplementationOwner[];
  /** Dependency ids (R-round ids and/or journey ids; never empty). */
  readonly dependencyIds: readonly string[];
  /**
   * REQUIRED when `classification` is `intentionally-out-of-scope`: why
   * the capability is not part of the Universal Entertainment OS mission.
   */
  readonly outOfScopeReason?: string;
  /**
   * REQUIRED when `classification` is `intentionally-out-of-scope`: the
   * nearest user-facing WebFlix path.
   */
  readonly nearestWebFlixPath?: string;
}

// ---------------------------------------------------------------------------
// The row-id vocabulary (the complete inventory — closed union)
// ---------------------------------------------------------------------------

/**
 * One capability row of the taxonomy — the COMPLETE frozen inventory:
 * the plan's entire R24-C pairing matrix (Discovery, Watch/player,
 * Shorts, Identity/continuity) + the reference rows the frozen lab
 * contract inventories + every R24-B WebFlix-only extension.
 */
export type ParityTaxonomyRowId =
  // — Discovery (R24-C + the lab inventory) —
  | "home-feed"
  | "search"
  | "search-suggestions"
  | "natural-language-search"
  | "related-next-videos"
  | "inline-playback"
  | "subscriptions"
  | "shorts-surface"
  | "channel-profile-pages"
  | "watch-later"
  // — Watch/player (R24-C + the lab inventory) —
  | "play-pause"
  | "seek-scrub"
  | "volume-mute"
  | "fullscreen"
  | "miniplayer-pip"
  | "playback-speed"
  | "quality"
  | "captions"
  | "transcript"
  | "chapters"
  | "autoplay"
  | "up-next"
  | "queue"
  | "save-queue"
  | "share"
  | "like-save"
  | "negative-feedback"
  | "comments-reactions"
  | "description-links"
  | "continue-watching"
  | "watch-history"
  | "playlists"
  | "external-handoff"
  | "live-playback"
  | "live-chat"
  | "live-replay"
  // — Shorts (R24-C) —
  | "shorts-vertical-swipe"
  | "shorts-like-save-share"
  | "shorts-sound-related"
  | "shorts-remix-attribution"
  | "shorts-clear-screen"
  | "shorts-speed-controls"
  | "shorts-inline-feedback"
  // — Identity and continuity (R24-C + the lab inventory) —
  | "anonymous-public-viewing"
  | "account-history"
  | "cross-device-continuity"
  | "source-subscription-relationships"
  | "notifications"
  | "tv-second-screen-continuation"
  | "device-handoff"
  | "offline-viewing"
  // — WebFlix-only extensions (the R24-B list, all 14) —
  | "canonical-identity"
  | "where-to-watch"
  | "authorized-peer-copy"
  | "bring-your-own-feed"
  | "feed-modes"
  | "session-intent"
  | "attention-policy"
  | "anti-tunnel-controls"
  | "model-selection"
  | "ai-transformations"
  | "semantic-moment-search"
  | "browser-host"
  | "local-offline-media"
  | "provenance-transparency";

/** Every taxonomy row id, in canonical (matrix + extension-list) order. */
export const PARITY_TAXONOMY_ROW_IDS: readonly ParityTaxonomyRowId[] = [
  // Discovery
  "home-feed",
  "search",
  "search-suggestions",
  "natural-language-search",
  "related-next-videos",
  "inline-playback",
  "subscriptions",
  "shorts-surface",
  "channel-profile-pages",
  "watch-later",
  // Watch/player
  "play-pause",
  "seek-scrub",
  "volume-mute",
  "fullscreen",
  "miniplayer-pip",
  "playback-speed",
  "quality",
  "captions",
  "transcript",
  "chapters",
  "autoplay",
  "up-next",
  "queue",
  "save-queue",
  "share",
  "like-save",
  "negative-feedback",
  "comments-reactions",
  "description-links",
  "continue-watching",
  "watch-history",
  "playlists",
  "external-handoff",
  "live-playback",
  "live-chat",
  "live-replay",
  // Shorts
  "shorts-vertical-swipe",
  "shorts-like-save-share",
  "shorts-sound-related",
  "shorts-remix-attribution",
  "shorts-clear-screen",
  "shorts-speed-controls",
  "shorts-inline-feedback",
  // Identity and continuity
  "anonymous-public-viewing",
  "account-history",
  "cross-device-continuity",
  "source-subscription-relationships",
  "notifications",
  "tv-second-screen-continuation",
  "device-handoff",
  "offline-viewing",
  // WebFlix-only extensions (R24-B)
  "canonical-identity",
  "where-to-watch",
  "authorized-peer-copy",
  "bring-your-own-feed",
  "feed-modes",
  "session-intent",
  "attention-policy",
  "anti-tunnel-controls",
  "model-selection",
  "ai-transformations",
  "semantic-moment-search",
  "browser-host",
  "local-offline-media",
  "provenance-transparency",
] as const;

/** Compile-time + runtime coverage guard: the array covers the union. */
const _rowIdsCover: Covers<ParityTaxonomyRowId, typeof PARITY_TAXONOMY_ROW_IDS> =
  null;
void _rowIdsCover;

/** Runtime membership check against the row-id union. */
export function isParityTaxonomyRowId(
  x: unknown,
): x is ParityTaxonomyRowId {
  return (
    typeof x === "string" &&
    (PARITY_TAXONOMY_ROW_IDS as readonly string[]).includes(x)
  );
}

/**
 * Structural exhaustiveness helper (the domain-package `Covers` idiom):
 * proves `Values` covers `Union` exactly at compile time.
 */
type Covers<Union extends string, Values extends readonly string[]> = [
  Union,
] extends [Values[number]]
  ? unknown
  : never;

// ---------------------------------------------------------------------------
// THE MATRIX — the frozen feature inventory (every row classified)
// ---------------------------------------------------------------------------

/**
 * The frozen R24-A parity taxonomy — THE shared feature-inventory read
 * model. Rows follow {@link PARITY_TAXONOMY_ROW_IDS} order: the R24-C
 * Discovery matrix, the Watch/player matrix, the Shorts matrix, the
 * Identity/continuity matrix, then all fourteen R24-B WebFlix-only
 * extensions. Every row is classified (a blank or "to be considered"
 * classification fails {@link validateParityTaxonomy}).
 */
export const PARITY_TAXONOMY: readonly ParityTaxonomyRow[] = [
  // ——— Discovery (the R24-C matrix + the lab inventory) ———
  {
    id: "home-feed",
    area: "discovery",
    referenceCapability: "Home feed",
    referenceSurface: "home",
    referenceBehavior:
      "A personalized home grid of recommended videos with rows, subscriptions mixed in, and a search box leading navigation.",
    webflixTreatment:
      "Home discovery with source-neutral cards and explicit intent controls",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home"],
      control: "Home rows + Personalize",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Cards are source-neutral: every realization (provider, authorized peer, local) renders the same card shape; the feed never requires choosing a source first.",
    persistenceExpectation:
      "Feed composition is session presentation state; personalization inputs (intent, attention policy, history) persist with the profile where one exists.",
    accessibilityRequirement:
      "Card grid is keyboard-navigable with visible focus; row and item titles are announced; hover previews honor reduced-motion.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J02"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R02", "R05"],
  },
  {
    id: "search",
    area: "discovery",
    referenceCapability: "Search",
    referenceSurface: "search",
    referenceBehavior:
      "A single search box producing ranked results with filters, suggestions as you type, and moment-level recall for described scenes.",
    webflixTreatment:
      "Unified source-neutral Search with exact, semantic and moment retrieval",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["search"],
      control: "Search box + results",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Results are canonical items across every connected source; each hit carries its realization set so playback never requires re-resolving identity.",
    persistenceExpectation:
      "Recent queries persist with the profile where present; anonymous search stays session-scoped.",
    accessibilityRequirement:
      "The search box is a labeled input; results are announced as a list; the query-to-first-result flow is keyboard-first.",
    performanceRelevance: "none",
    testJourneyIds: ["J05", "J39"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R01", "R05", "R23-F"],
  },
  {
    id: "search-suggestions",
    area: "discovery",
    referenceCapability: "Search suggestions",
    referenceSurface: "search",
    referenceBehavior:
      "Query completions and predictions offered while typing, before submitting the query.",
    webflixTreatment: "WebFlix suggestions plus optional voice/AI query",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["search"],
      control: "Suggestion list under the search box",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Suggestions derive from canonical titles, moments and connected sources — never from a single provider's isolated index.",
    persistenceExpectation:
      "Suggestions are session state derived from query history and the semantic index; nothing new persists per query.",
    accessibilityRequirement:
      "Suggestion list follows the combobox pattern: arrow keys move, Escape dismisses, the active option is announced.",
    performanceRelevance: "none",
    testJourneyIds: ["J05"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05", "R23-H"],
  },
  {
    id: "natural-language-search",
    area: "discovery",
    referenceCapability: "Natural-language / conversational search",
    referenceSurface: "search",
    referenceBehavior:
      "Descriptive queries resolve to relevant results; conversational follow-ups refine them.",
    webflixTreatment:
      "Semantic search + the AI query path (search by meaning, not just title)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["search"],
      control: "The same search box (natural-language queries accepted)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Semantic retrieval runs over the canonical index; anonymous viewers may use low-cost/local AI paths per the R23-K boundary.",
    persistenceExpectation:
      "Derived query embeddings stay transient; the query text follows the same session/profile persistence as plain search.",
    accessibilityRequirement:
      "Identical accessibility contract to plain search; AI query affordances are optional additions, never the only path.",
    performanceRelevance: "none",
    testJourneyIds: ["J39"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R23-F", "R23-H", "R23-K"],
  },
  {
    id: "related-next-videos",
    area: "discovery",
    referenceCapability: "Related / next videos",
    referenceSurface: "watch",
    referenceBehavior:
      "A rail of related content beside the player; the next video autoplays after the current one.",
    webflixTreatment:
      "WebFlix recommendation policy + source-neutral realizations (Recommendation OS with explicit intent/attention)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["watch", "player"],
      control: "Related rail beside the player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Next/related candidates are canonical items across sources; anti-tunnel policy keeps exploration open instead of fixating on the last watch.",
    persistenceExpectation:
      "Signals feed the profile's recommendation policy where present; anonymous sessions derive suggestions from session state only.",
    accessibilityRequirement:
      "The rail is a navigable list; autoplay state is announced and reversible (see the autoplay row).",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J17", "J18"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05", "R23-H"],
  },
  {
    id: "inline-playback",
    area: "discovery",
    referenceCapability: "Inline playback in feeds/search",
    referenceSurface: "home",
    referenceBehavior:
      "Hover or press previews a video inline in the feed without leaving the surface.",
    webflixTreatment:
      "Inline previews where platform capability and user attention policy allow",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "search"],
      control: "Hover/focus preview on a card",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Previews run only for realizations that support inline playback (e.g. direct/embeddable); an unavailable realization shows the card statically, never a fake preview.",
    persistenceExpectation:
      "No persistent state beyond the attention policy that gates autoplaying previews; Mindful disables them.",
    accessibilityRequirement:
      "Previews are opt-in through hover/focus, never the only content affordance, and are fully suppressed under reduced-motion.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J40"],
    evidenceLink: "https://support.google.com/youtube/answer/7640367",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R01", "R09", "R23-A"],
  },
  {
    id: "subscriptions",
    area: "discovery",
    referenceCapability: "Subscriptions",
    referenceSurface: "home",
    referenceBehavior:
      "Follow channels; a Subscriptions feed lists latest videos from followed creators.",
    webflixTreatment: "Following plus native/BYOF relationship semantics",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "item"],
      control: "Follow on cards/item + the Following feed mode",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Following attaches to the canonical source identity; BYOF may import the relationship from a provider export with explicit provenance.",
    persistenceExpectation:
      "Follow relationships are durable profile state (server-side); BYOF imports carry source/native-order provenance and freshness.",
    accessibilityRequirement:
      "Follow state is announced as a toggle; the Following feed is reachable from the feed-mode control, not only from Settings.",
    performanceRelevance: "none",
    testJourneyIds: ["J33", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R03", "R20"],
  },
  {
    id: "shorts-surface",
    area: "discovery",
    referenceCapability: "Shorts surface",
    referenceSurface: "shorts",
    referenceBehavior:
      "A dedicated vertical short-form feed reachable from primary navigation.",
    webflixTreatment: "Shorts (the WebFlix Shorts surface)",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Shorts in primary navigation",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Shorts items are canonical items; every realization participates, with playback truth per realization.",
    persistenceExpectation:
      "Binge position and shorts feedback persist with the profile where present; anonymous viewing stays session-scoped.",
    accessibilityRequirement:
      "Keyboard paging (up/down/space) matches the pointer swipe; the current card's title/actions are announced.",
    performanceRelevance: "none",
    testJourneyIds: ["J04"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R01", "R02"],
  },
  {
    id: "channel-profile-pages",
    area: "discovery",
    referenceCapability: "Channel / profile pages",
    referenceSurface: "channel",
    referenceBehavior:
      "A creator's page lists their videos, about information and the subscription state.",
    webflixTreatment:
      "Source-aware creator/source detail within canonical identity",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["item", "search"],
      control: "Source name/link on cards, item detail and search hits",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The source detail aggregates canonical items from that source; provider pages stay provider-owned (no scraping).",
    persistenceExpectation:
      "Source detail is derived read state; follow/authorization state is the durable part and lives with the profile.",
    accessibilityRequirement:
      "The source link is a real navigation target with an accessible name; the listing is a navigable list.",
    performanceRelevance: "none",
    testJourneyIds: ["J06", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R03", "R06"],
  },
  {
    id: "watch-later",
    area: "discovery",
    referenceCapability: "Watch Later",
    referenceSurface: "library",
    referenceBehavior:
      "Save any video to a Watch Later list that plays through like a queue.",
    webflixTreatment: "Watchlist (the WebFlix saved list)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["item", "player", "library"],
      control: "Save on cards, item detail and the player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "A watchlist entry is the canonical item; the realization is chosen at play time, never frozen into the save.",
    persistenceExpectation:
      "Durable, server-side with the profile (cross-device); anonymous viewers may use session-scoped local saves where supported, honestly labeled.",
    accessibilityRequirement:
      "Save is a labeled toggle announcing its state; the Watchlist section in Library is a navigable list.",
    performanceRelevance: "none",
    testJourneyIds: ["J11", "J40"],
    evidenceLink: "https://support.google.com/youtube/answer/56101",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R04", "R10"],
  },

  // ——— Watch/player (the R24-C matrix + the lab inventory) ———
  {
    id: "play-pause",
    area: "watch-player",
    referenceCapability: "Play / pause",
    referenceSurface: "watch",
    referenceBehavior:
      "One obvious play affordance; pause/resume with familiar control placement and keyboard behavior (spacebar).",
    webflixTreatment: "Same familiar control placement and keyboard behavior",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Play/Pause control + spacebar",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Controls command the ACTIVE realization's session (embed, browser, native alike); keyboard shortcuts are runtime-owned so every realization behaves the same.",
    persistenceExpectation:
      "No persistence beyond playback session state; the watch-state mirror records the resulting positions.",
    accessibilityRequirement:
      "The control is a labeled button with a visible focus state; spacebar toggling is announced; no fine motor precision is required (large target).",
    performanceRelevance: "startup-critical",
    testJourneyIds: ["J03", "J40", "J41"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01"],
  },
  {
    id: "seek-scrub",
    area: "watch-player",
    referenceCapability: "Seek / scrub",
    referenceSurface: "watch",
    referenceBehavior:
      "Direct manipulation of the timeline: drag to scrub, click or arrow keys to jump, with hover preview.",
    webflixTreatment: "Same direct manipulation model",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Timeline scrubber + arrow keys",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Seeking is modelled on the canonical timeline; realizations that cannot seek (some external handoffs) say so honestly, never fake a scrub.",
    persistenceExpectation:
      "Seeks update canonical watch state — resume mirrors the last position across realizations.",
    accessibilityRequirement:
      "The scrubber is keyboard-operable (arrows ±5s/±10s) with the position announced; a value label accompanies interaction.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J03", "J40", "J41"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01", "R04"],
  },
  {
    id: "volume-mute",
    area: "watch-player",
    referenceCapability: "Volume / mute",
    referenceSurface: "watch",
    referenceBehavior: "Player-local volume control with a mute toggle and keyboard shortcut.",
    webflixTreatment: "Same player-local control",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Volume control + M",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Volume is player-local where the realization exposes it; embeds fall back to the surface's own control contract honestly.",
    persistenceExpectation:
      "Volume/mute preference persists locally per platform (adapter storage), never as profile identity.",
    accessibilityRequirement:
      "Mute is a labeled toggle; the slider is keyboard-operable with the level announced (percentage).",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J40", "J41"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01"],
  },
  {
    id: "fullscreen",
    area: "watch-player",
    referenceCapability: "Fullscreen",
    referenceSurface: "watch",
    referenceBehavior: "A fullscreen toggle on the player with the keyboard shortcut and exit affordance.",
    webflixTreatment: "Same player affordance",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Fullscreen control + F / Escape",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Fullscreen is the adapter's platform capability (browser Fullscreen API / native window state); the semantic is identical, the mechanism is per platform.",
    persistenceExpectation:
      "Transient presentation state only; nothing persists beyond the session.",
    accessibilityRequirement:
      "Enter/exit is announced; focus is trapped inside the fullscreen surface and restored on exit.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01", "R07", "R08"],
  },
  {
    id: "miniplayer-pip",
    area: "watch-player",
    referenceCapability: "Miniplayer / picture-in-picture where supported",
    referenceSurface: "watch",
    referenceBehavior:
      "Playback continues in a floating miniplayer over other surfaces where the platform supports it.",
    webflixTreatment: "Platform capability equivalent",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Miniplayer control on the player",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "supported",
    },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Continuation requires a realization the platform can keep playing in a floating surface; realizations that cannot continue say so honestly.",
    persistenceExpectation:
      "Transient presentation state; the last-used mode may persist locally per platform.",
    accessibilityRequirement:
      "The miniplayer retains the full control set in a compact layout with keyboard access and announced state.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01", "R07", "R08"],
  },
  {
    id: "playback-speed",
    area: "watch-player",
    referenceCapability: "Playback speed",
    referenceSurface: "watch",
    referenceBehavior: "A speed selector in player settings with remembered preference.",
    webflixTreatment: "Player settings",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Speed in player settings",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Speed applies to the active realization where the realization honors it; unsupported realizations hide the control rather than showing a dead one.",
    persistenceExpectation:
      "Last-used speed persists with the profile where present; anonymous sessions stay session-scoped.",
    accessibilityRequirement:
      "The selector is a labeled listbox; the active speed is announced on change.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01"],
  },
  {
    id: "quality",
    area: "watch-player",
    referenceCapability: "Quality",
    referenceSurface: "watch",
    referenceBehavior:
      "Quality selection in player settings with adaptive behavior as the default.",
    webflixTreatment:
      "Source/player quality selection where exposed (adaptive where the realization offers it)",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Quality in player settings",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The quality list reflects the realization's actually exposed ladder (R24-E adaptive-quality law); a fabricated list or fake HD badge is forbidden.",
    persistenceExpectation:
      "Quality preference persists with the profile where present; adaptive remains the default.",
    accessibilityRequirement:
      "The selector lists real qualities with the active one announced; auto/adaptive is a first-class labeled option.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J40", "J41"],
    evidenceLink: "https://support.google.com/youtube/answer/91449",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R01", "R09"],
  },
  {
    id: "captions",
    area: "watch-player",
    referenceCapability: "Captions",
    referenceSurface: "watch",
    referenceBehavior:
      "Closed captions with language selection, styling and the CC toggle.",
    webflixTreatment: "AI/provider/local subtitle paths",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Captions in player settings + CC",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Subtitle paths span provider tracks, local files and AI-generated captions (R23-F/G); the active path is disclosed with provenance, and caption fetch never blocks first frame.",
    persistenceExpectation:
      "Caption on/off and language preference persist with the profile where present; generated artifacts persist as derived media intelligence with provenance.",
    accessibilityRequirement:
      "Captions are on by default when the OS requests them; the language list is a labeled listbox; styling respects user preferences.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J20", "J39", "J41"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R06", "R23-F", "R23-G"],
  },
  {
    id: "transcript",
    area: "watch-player",
    referenceCapability: "Transcript",
    referenceSurface: "watch",
    referenceBehavior:
      "A timestamped transcript panel that scrolls with playback and jumps when clicked.",
    webflixTreatment: "Timestamped transcript",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["watch", "player"],
      control: "Show transcript",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Transcripts are R23-F derived artifacts (provider, community or AI-generated — each labeled); they may arrive after playback starts and never block it.",
    persistenceExpectation:
      "Transcript artifacts persist as derived media intelligence with model/provenance metadata.",
    accessibilityRequirement:
      "The transcript is a navigable list of timestamped segments; current segment is announced; clicking a segment seeks (keyboard equivalent provided).",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J20", "J39"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R06", "R23-F"],
  },
  {
    id: "chapters",
    area: "watch-player",
    referenceCapability: "Chapters",
    referenceSurface: "watch",
    referenceBehavior:
      "Chapters marked on the timeline with titles in a list/hover preview.",
    webflixTreatment: "Chapter rail/list + semantic chapter fallback",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["watch", "player"],
      control: "Chapter marks on the timeline + chapter list",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Provider chapters are used when available; the AI pipeline derives semantic chapters as a fallback, clearly labeled as derived.",
    persistenceExpectation:
      "Chapters cache as derived artifacts and refresh with metadata; provenance is retained.",
    accessibilityRequirement:
      "Chapter boundaries are keyboard-navigable stops with titles announced; the list mirrors the timeline marks.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J39"],
    evidenceLink: "https://support.google.com/youtube/answer/9884579",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R23-F", "R23-H"],
  },
  {
    id: "autoplay",
    area: "watch-player",
    referenceCapability: "Autoplay",
    referenceSurface: "watch",
    referenceBehavior:
      "The next video plays automatically with a countdown and an off switch.",
    webflixTreatment: "Attention-policy-aware autoplay",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Autoplay toggle in player settings",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Autoplay follows the attention policy (Mindful/Balanced/Immersive/Custom), never engagement maximization; the up-next choice comes from the Recommendation OS without gating playback startup.",
    persistenceExpectation:
      "Autoplay state follows the profile's attention policy plus any per-session override; anonymous autoplay needs no login.",
    accessibilityRequirement:
      "The countdown is announced and cancellable; the toggle is labeled and its state is announced.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J18", "J40", "J41"],
    evidenceLink: "https://support.google.com/youtube/answer/6327615",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },
  {
    id: "up-next",
    area: "watch-player",
    referenceCapability: "Up next",
    referenceSurface: "watch",
    referenceBehavior: "The next video is surfaced beside/under the player as the autoplay target.",
    webflixTreatment: "Source-neutral next content",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "watch"],
      control: "Up next beside the player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Next content is a canonical item resolved across sources; its realization is chosen like any play (Where to watch), never frozen to the current source.",
    persistenceExpectation:
      "None beyond recommendation session state; choices feed the policy where a profile exists.",
    accessibilityRequirement:
      "The up-next card is a labeled navigation target; autoplay countdown state is announced.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },
  {
    id: "queue",
    area: "watch-player",
    referenceCapability: "Queue",
    referenceSurface: "watch",
    referenceBehavior:
      "Add videos to a session queue that plays through in order with reordering.",
    webflixTreatment:
      "Session queue (plays in order during the session)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "item"],
      control: "Add to queue on cards/item/player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The queue holds canonical items; entries re-resolve realizations at play time so a queued item follows Where to watch like any play.",
    persistenceExpectation:
      "Session-scoped by definition — no account needed; explicit persistence goes through save-queue.",
    accessibilityRequirement:
      "Queue state changes are announced; the queue is a reorderable list with keyboard move controls.",
    performanceRelevance: "none",
    testJourneyIds: ["J40"],
    evidenceLink: "https://support.google.com/youtube/answer/9546304",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R01"],
  },
  {
    id: "save-queue",
    area: "watch-player",
    referenceCapability: "Save queue / playlists from queue",
    referenceSurface: "watch",
    referenceBehavior: "Save the current queue as a playlist for later.",
    webflixTreatment:
      "Save queue to Library/playlist where supported",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "library"],
      control: "Save queue in the queue panel",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "A saved queue is a Library collection of canonical items; realization choices stay per-play, never baked in.",
    persistenceExpectation:
      "Durable, server-side with the profile (cross-device).",
    accessibilityRequirement:
      "The save action confirms success/failure honestly; the resulting collection appears in Library with an announced update.",
    performanceRelevance: "none",
    testJourneyIds: ["J40"],
    evidenceLink: "https://support.google.com/youtube/answer/57792",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R04"],
  },
  {
    id: "share",
    area: "watch-player",
    referenceCapability: "Share",
    referenceSurface: "watch",
    referenceBehavior: "Share dialog with the video link and share targets.",
    webflixTreatment: "Canonical WebFlix link + source link when appropriate",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "item"],
      control: "Share on cards/item/player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The canonical WebFlix link is primary (carries the item, not a source page); a source link is offered when appropriate; providers that forbid sharing say so honestly.",
    persistenceExpectation:
      "No persistence — link generation is transient per action.",
    accessibilityRequirement:
      "The share dialog is a labeled dialog with focus management; the link is copyable via keyboard.",
    performanceRelevance: "none",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01", "R07"],
  },
  {
    id: "like-save",
    area: "watch-player",
    referenceCapability: "Like / save",
    referenceSurface: "watch",
    referenceBehavior: "Like and save affordances on the watch surface with state feedback.",
    webflixTreatment: "Existing action model",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["player", "item"],
      control: "Like + Save on the player/item",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Likes/saves flow through the existing action model with provider-confirmed vs WebFlix-recorded truth (J10); an action never appears successful without its confirmation truth.",
    persistenceExpectation:
      "Durable with the profile; provider-synced where the provider confirms synchronization.",
    accessibilityRequirement:
      "Both are labeled toggles announcing state; unsupported provider actions are absent rather than dead.",
    performanceRelevance: "none",
    testJourneyIds: ["J10", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R15"],
  },
  {
    id: "negative-feedback",
    area: "watch-player",
    referenceCapability: "Dislike / negative feedback",
    referenceSurface: "watch",
    referenceBehavior:
      "Negative feedback shapes future recommendations and can be undone.",
    webflixTreatment:
      "Existing recommendation feedback (the Not-interested family: More like this / Not interested / Don't recommend source / Already watched)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "item", "home"],
      control: "Feedback menu on cards/item/player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Feedback binds to canonical items/sources, so it applies across every realization of the item.",
    persistenceExpectation:
      "Durable recommendation-policy inputs with the profile; reversible (undo).",
    accessibilityRequirement:
      "Menu items are labeled with their effect; feedback application is announced and reversible.",
    performanceRelevance: "none",
    testJourneyIds: ["J15", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },
  {
    id: "comments-reactions",
    area: "watch-player",
    referenceCapability: "Comments / reactions",
    referenceSurface: "watch",
    referenceBehavior:
      "A comments section with replies, reactions and sorting below the player.",
    webflixTreatment: "Provider/social actions where authorized",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["watch"],
      control: "Comments section under the player",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "provider-authorized",
    sourceRealizationImplications:
      "Comments live with the source: only providers that authorize comment interactions render them; unauthorized sources show nothing rather than fake local comments.",
    persistenceExpectation:
      "Provider-side persistence; WebFlix records only the synchronization truth of the interaction.",
    accessibilityRequirement:
      "When present, comments are a navigable list with labeled actions; loading is honest (skeleton or pending, never fake content).",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J10", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R03", "R15"],
  },
  {
    id: "description-links",
    area: "watch-player",
    referenceCapability: "Description / links",
    referenceSurface: "watch",
    referenceBehavior:
      "Expandable description with metadata, links and timestamps under the player.",
    webflixTreatment: "Item detail/content metadata",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["watch", "item"],
      control: "Description on the watch surface",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The description renders from the canonical record; it is fetched independently of the media startup critical path (R24-E law) and never blocks first frame.",
    persistenceExpectation:
      "Item metadata refreshes from sources; the canonical record persists server-side.",
    accessibilityRequirement:
      "The description is an expandable region with disclosed state; links are announced and keyboard-focusable; timestamps jump to moments.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J06", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R02", "R03"],
  },
  {
    id: "continue-watching",
    area: "watch-player",
    referenceCapability: "Continue watching",
    referenceSurface: "home",
    referenceBehavior:
      "Surfaced in-progress videos with resume position on Home/Library.",
    webflixTreatment: "Library/history/resume",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "library"],
      control: "Continue Watching row",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Resume position is canonical watch state shared by every realization of the item — switching realization continues from the same position.",
    persistenceExpectation:
      "Durable with the profile; anonymous resume stays session-scoped (the R23-B session-progress law).",
    accessibilityRequirement:
      "Resume cards announce remaining/elapsed time; the primary action is one obvious Continue.",
    performanceRelevance: "none",
    testJourneyIds: ["J11", "J12"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R04"],
  },
  {
    id: "watch-history",
    area: "watch-player",
    referenceCapability: "Watch history",
    referenceSurface: "library",
    referenceBehavior:
      "A chronological history list with per-item removal and controls.",
    webflixTreatment: "WebFlix History",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["library"],
      control: "History section in Library",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "History records canonical items regardless of realization (provider, authorized peer, local) — one list for every way you watched.",
    persistenceExpectation:
      "Durable, server-side with the profile; removal is real and immediate.",
    accessibilityRequirement:
      "History is a navigable list with remove controls; empty state explains how history accrues.",
    performanceRelevance: "none",
    testJourneyIds: ["J11", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R04"],
  },
  {
    id: "playlists",
    area: "watch-player",
    referenceCapability: "Playlists",
    referenceSurface: "library",
    referenceBehavior:
      "Curated ordered lists that play through with add/remove anywhere.",
    webflixTreatment: "WebFlix playlists/library collections",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["library", "watch"],
      control: "Playlists in Library + Save to playlist on cards/player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Playlists are Library collections of canonical items; ordering is user-owned and realizations are chosen per-play.",
    persistenceExpectation:
      "Durable, server-side with the profile (cross-device).",
    accessibilityRequirement:
      "Playlist editing (add/remove/reorder) is keyboard-operable with announced results.",
    performanceRelevance: "none",
    testJourneyIds: ["J11", "J40"],
    evidenceLink: "https://support.google.com/youtube/answer/57792",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R04"],
  },
  {
    id: "external-handoff",
    area: "watch-player",
    referenceCapability: "External handoff",
    referenceSurface: "watch",
    referenceBehavior:
      "Open in another app/site when the platform cannot contain playback.",
    webflixTreatment: "Return-context-preserving source handoff",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "item"],
      control: "Open in source (shown when a realization is external)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The handoff opens the provider surface when WebFlix cannot contain playback; return context (item + position) is preserved so coming back resumes.",
    persistenceExpectation:
      "Return context persists for the session; resume position is canonical watch state.",
    accessibilityRequirement:
      "The handoff is an honest labeled action — it never looks like failure, and its return path is explained.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J09", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R09"],
  },
  {
    id: "live-playback",
    area: "watch-player",
    referenceCapability: "Live playback",
    referenceSurface: "live",
    referenceBehavior: "Join live streams at the live edge with DVR seek where offered.",
    webflixTreatment: "Supported live realization",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["item", "player"],
      control: "Play on a live realization (Where to watch)",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Live plays only where a realization truly supports live (capability truth); unsupported realizations present the honest next way to watch, never a fake live badge.",
    persistenceExpectation:
      "Live position is by nature non-persistent; joining starts at the live edge (or a DVR position).",
    accessibilityRequirement:
      "LIVE state is announced; the timeline reflects DVR capability honestly (or hides seeking).",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J30", "J40"],
    evidenceLink: "https://support.google.com/youtube/answer/15270973",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R03", "R09"],
  },
  {
    id: "live-chat",
    area: "watch-player",
    referenceCapability: "Live chat / reactions",
    referenceSurface: "live",
    referenceBehavior:
      "Live chat and reactions beside the stream while it plays.",
    webflixTreatment:
      "Provider/realization-specific live interaction when supported",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["watch"],
      control: "Live chat beside the player (when the realization supports it)",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "provider-authorized",
    sourceRealizationImplications:
      "Live chat is realization-specific interaction where the provider supports and authorizes it; it never gates live playback start.",
    persistenceExpectation:
      "Chat is ephemeral provider state; WebFlix persists nothing of it.",
    accessibilityRequirement:
      "When present, chat is a live region with pause-on-hover/scroll; it can be dismissed without affecting playback.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J40"],
    evidenceLink: "https://support.google.com/youtube/answer/15270973",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R15"],
  },
  {
    id: "live-replay",
    area: "watch-player",
    referenceCapability: "Replay (after live)",
    referenceSurface: "live",
    referenceBehavior:
      "Ended streams become replayable ordinary videos in history.",
    webflixTreatment: "Canonical replay/history path",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["library", "watch"],
      control: "Replay from History / related rail",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Replays enter the canonical history/resume path as ordinary items; realization truth at replay time governs playback.",
    persistenceExpectation:
      "Ordinary watch-state persistence once the stream becomes an item.",
    accessibilityRequirement:
      "Replay state is honest (VOD semantics announced; no dead live chrome).",
    performanceRelevance: "none",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R04"],
  },

  // ——— Shorts (the R24-C matrix) ———
  {
    id: "shorts-vertical-swipe",
    area: "shorts",
    referenceCapability: "Vertical swipe / binge",
    referenceSurface: "shorts",
    referenceBehavior:
      "Full-screen vertical paging through short videos with a stable current card.",
    webflixTreatment: "ShortsFeed",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Swipe / arrow keys in Shorts",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "The feed is realization-agnostic: each short plays through its own truthful realization; an unplayable short presents an honest next action, never a frozen frame.",
    persistenceExpectation:
      "Binge position persists with the profile where present; anonymous stays session-scoped.",
    accessibilityRequirement:
      "Keyboard paging matches the swipe; the current card's title and actions are announced on change.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J04", "J40"],
    evidenceLink: "https://support.google.com/youtube/answer/13363900",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01", "R02"],
  },
  {
    id: "shorts-like-save-share",
    area: "shorts",
    referenceCapability: "Like / save / share on Shorts",
    referenceSurface: "shorts",
    referenceBehavior:
      "Like, save and share actions alongside the short on the same screen.",
    webflixTreatment: "Existing hydrated Shorts actions",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Like / Save / Share on the Shorts card",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Actions are the hydrated (source-advertised) Shorts actions through the existing action model — real provider capabilities only, no dead buttons.",
    persistenceExpectation:
      "Durable with the profile; provider-synced where the provider confirms.",
    accessibilityRequirement:
      "Actions are labeled buttons announcing state; hydration gaps hide the control rather than showing a dead one.",
    performanceRelevance: "none",
    testJourneyIds: ["J04", "J36", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R15"],
  },
  {
    id: "shorts-sound-related",
    area: "shorts",
    referenceCapability: "Sound / related content on Shorts",
    referenceSurface: "shorts",
    referenceBehavior:
      "The sound page links shorts that use the same audio and related content.",
    webflixTreatment: "Canonical audio/source links where available",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Sound/source link on the Shorts card",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Relations are canonical (same audio/source across items) where the source exposes them; missing relations are simply absent, never invented.",
    persistenceExpectation:
      "Derived relation state; nothing new persists per view.",
    accessibilityRequirement:
      "The relation link is a labeled navigation target announcing what it leads to.",
    performanceRelevance: "none",
    testJourneyIds: ["J04"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R02", "R03"],
  },
  {
    id: "shorts-remix-attribution",
    area: "shorts",
    referenceCapability: "Remix / source attribution on Shorts",
    referenceSurface: "shorts",
    referenceBehavior:
      "Remix creates derivative shorts with attribution back to the source.",
    webflixTreatment: "Authorized source-aware remix/reference path",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Remix / reference (where the source authorizes it)",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "provider-authorized",
    sourceRealizationImplications:
      "Remix exists only where the source authorizes derivative creation — provider authorization and rights are respected (never bypassed); unauthorized sources show no remix path.",
    persistenceExpectation:
      "Attribution relationships persist with the derived item; the authorization trail is retained.",
    accessibilityRequirement:
      "When present, remix is a labeled action with the attribution explained before use.",
    performanceRelevance: "none",
    testJourneyIds: ["J04"],
    evidenceLink: "https://support.google.com/youtube/answer/10623810",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R03", "R15"],
  },
  {
    id: "shorts-clear-screen",
    area: "shorts",
    referenceCapability: "Clear-screen style viewing",
    referenceSurface: "shorts",
    referenceBehavior:
      "Tap to dismiss chrome for a distraction-free view of the current short.",
    webflixTreatment:
      "WebFlix distraction-free presentation under attention policy",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Clear-screen toggle on the Shorts card",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Presentation-only: hiding chrome never changes the realization or the honest playback state.",
    persistenceExpectation:
      "Transient presentation state per card; attention policy may set the default.",
    accessibilityRequirement:
      "Chrome dismissal keeps an accessible restore affordance and never removes keyboard access to controls.",
    performanceRelevance: "none",
    testJourneyIds: ["J18", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01"],
  },
  {
    id: "shorts-speed-controls",
    area: "shorts",
    referenceCapability: "Speed controls on Shorts",
    referenceSurface: "shorts",
    referenceBehavior: "Playback speed control inside the Shorts player.",
    webflixTreatment: "Shorts player controls",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Speed in the Shorts player settings",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Same speed semantics as the long-form player — one grammar across surfaces.",
    persistenceExpectation:
      "Last-used speed persists with the profile where present, shared with the long-form player.",
    accessibilityRequirement:
      "Same selector semantics as the long-form speed control, announced on change.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R01"],
  },
  {
    id: "shorts-inline-feedback",
    area: "shorts",
    referenceCapability: "Recommendation feedback on Shorts",
    referenceSurface: "shorts",
    referenceBehavior:
      "Not interested / feedback controls directly on the Shorts surface.",
    webflixTreatment: "Inline Shorts feedback",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["shorts"],
      control: "Feedback menu on the Shorts card",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Feedback binds to the canonical item/source and shapes the Shorts feed policy — same vocabulary as long-form feedback (stable terminology law).",
    persistenceExpectation:
      "Durable recommendation-policy inputs with the profile; reversible.",
    accessibilityRequirement:
      "The feedback menu mirrors the long-form menu semantics with announced, reversible effects.",
    performanceRelevance: "none",
    testJourneyIds: ["J15", "J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },

  // ——— Identity and continuity (the R24-C matrix + the lab inventory) ———
  {
    id: "anonymous-public-viewing",
    area: "identity-continuity",
    referenceCapability: "Anonymous public watching",
    referenceSurface: "account",
    referenceBehavior:
      "Public videos watch without signing in; the sign-in is for extra capability, not for watching.",
    webflixTreatment: "WebFlix accountless public viewing (R23-A/B)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "watch", "shorts", "search", "item"],
      control: "Every public surface — no account needed",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Anonymous + public realization means playback may start (the R23-B invariant); provider authorization stays a separate truth from the WebFlix account.",
    persistenceExpectation:
      "Anonymous progress is session-scoped/local and never represented as durable identity until authentication.",
    accessibilityRequirement:
      "No login wall, modal or redirect appears solely because the viewer is anonymous (J37 law).",
    performanceRelevance: "startup-critical",
    testJourneyIds: ["J37", "J40", "J41"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R23-A", "R23-B"],
  },
  {
    id: "account-history",
    area: "identity-continuity",
    referenceCapability: "Account-based history",
    referenceSurface: "account",
    referenceBehavior:
      "History follows the account across devices and sessions.",
    webflixTreatment: "Account history (server-side, cross-device)",
    classification: "parity",
    userEntryPoint: {
      surfaces: ["library"],
      control: "History section in Library (when signed in)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "The account's history covers every realization — provider playback, authorized peer, local — one timeline.",
    persistenceExpectation:
      "Durable, server-side with the profile; cross-device by construction.",
    accessibilityRequirement:
      "Same accessibility contract as watch-history; the signed-in state is announced without nagging.",
    performanceRelevance: "none",
    testJourneyIds: ["J11", "J12"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R02", "R04"],
  },
  {
    id: "cross-device-continuity",
    area: "identity-continuity",
    referenceCapability: "Cross-device continuity",
    referenceSurface: "account",
    referenceBehavior:
      "Resume position, library and preferences follow the account between devices.",
    webflixTreatment: "Shared server-side profile/library state",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["library", "watch", "settings"],
      control: "Sign in (the durable-identity entry)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Continuity is keyed to canonical items, so a title started on one realization/device continues on another.",
    persistenceExpectation:
      "Durable server-side profile state — the same identity powers Web, Desktop and future Mobile.",
    accessibilityRequirement:
      "Continuity is explained at the sign-in moment; no silent device-binding.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J12", "J31"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3", "lead"],
    dependencyIds: ["R02", "R04"],
  },
  {
    id: "source-subscription-relationships",
    area: "identity-continuity",
    referenceCapability: "Source subscription relationships",
    referenceSurface: "account",
    referenceBehavior:
      "Subscription relationships belong to the account and are portable within the platform.",
    webflixTreatment: "Following + BYOF (authorized import/sync of external relationships)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "settings"],
      control: "Bring Your Feed from the feed-mode control + Sources in Settings",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "BYOF imports carry provenance, source-native order and live/snapshot truth; imported data never silently becomes recommendation identity.",
    persistenceExpectation:
      "Imported feed records persist with normalized provenance and freshness; disconnect never deletes WebFlix-local history.",
    accessibilityRequirement:
      "The import flow's preview/confirm steps are keyboard-operable with announced progress and results.",
    performanceRelevance: "none",
    testJourneyIds: ["J33", "J40"],
    evidenceLink: "docs/architecture/byof-architecture.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R20", "R03"],
  },
  {
    id: "notifications",
    area: "identity-continuity",
    referenceCapability: "Notifications",
    referenceSurface: "account",
    referenceBehavior:
      "New-content and activity notifications through the platform's notification system.",
    webflixTreatment: "Web/desktop notification adapter when supported",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["settings"],
      control: "Notifications in Settings (platform adapter)",
      contextual: false,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Notifications derive from followed sources/feeds (durable relationships); the adapter delivers only what the platform supports.",
    persistenceExpectation:
      "Preferences durable with the profile; delivered notifications are platform state.",
    accessibilityRequirement:
      "Permission requests happen in context with a decline path; notification content respects reduced-motion when it animates.",
    performanceRelevance: "none",
    testJourneyIds: ["J40"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R03", "R20"],
  },
  {
    id: "tv-second-screen-continuation",
    area: "identity-continuity",
    referenceCapability: "TV / second-screen continuation",
    referenceSurface: "account",
    referenceBehavior:
      "Cast or continue playback on a TV/second screen with the phone as remote.",
    webflixTreatment: "Platform adapter where supported (capability truth, not fake universal support)",
    classification: "platform-variant",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Cast/second-screen control on the player (where the platform supports it)",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "capability-dependent",
    },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Continuation requires a realization the target screen can actually play; unsupported platforms never show a fake cast control.",
    persistenceExpectation:
      "Continuation state is session-scoped; resume position is canonical watch state.",
    accessibilityRequirement:
      "The cast control is labeled with target state announced; it is absent (not dead) where unsupported.",
    performanceRelevance: "none",
    testJourneyIds: ["J40"],
    evidenceLink: "https://support.google.com/youtube/answer/7640706",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R07", "R08"],
  },
  {
    id: "device-handoff",
    area: "identity-continuity",
    referenceCapability: "Device handoff",
    referenceSurface: "account",
    referenceBehavior:
      "Moving between devices preserves position and context through the account.",
    webflixTreatment: "Return-context + platform capability (canonical resume)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["library", "watch"],
      control: "Continue Watching (cross-device)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Handoff is canonical: the same item, position and realization truth on the next device (J31 parity law).",
    persistenceExpectation:
      "Durable server-side watch state (the cross-device resume contract).",
    accessibilityRequirement:
      "Cross-device state appears without re-explanation; the resume affordance is one obvious action.",
    performanceRelevance: "none",
    testJourneyIds: ["J09", "J31"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3", "lead"],
    dependencyIds: ["R04", "R09"],
  },
  {
    id: "offline-viewing",
    area: "identity-continuity",
    referenceCapability: "Offline viewing / downloads",
    referenceSurface: "library",
    referenceBehavior:
      "Authorized downloads for offline playback where rights and platform permit.",
    webflixTreatment:
      "Verified local asset / offline Library (integrity-verified, honest states)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["library", "item"],
      control: "Offline section in Library + available-offline truth on items",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "native-only-next-step",
      desktop: "supported",
    },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Only verified local assets count as offline (integrity requirements satisfied); acquisition stays authorized and provenance-disclosed; Web shows the honest Desktop next step.",
    persistenceExpectation:
      "Verified assets persist in the Desktop library with integrity truth; the same item continues locally.",
    accessibilityRequirement:
      "Offline state is announced with integrity truth; downloading states are honest (never fake progress).",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J21", "J26", "J27"],
    evidenceLink: "docs/validation/webflix-golden-journeys.md",
    implementationOwners: ["worker-3", "worker-1"],
    dependencyIds: ["R13", "R14"],
  },

  // ——— WebFlix-only extensions (the complete R24-B list) ———
  {
    id: "canonical-identity",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) One title, many sources — the universal-detail mental model",
    referenceSurface: "cross-surface",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: the title is the thing; where it plays is a secondary choice — identity stays stable across Search, item detail and the player.",
    webflixTreatment:
      "Source-neutral canonical identity (one title, multiple realizations)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["search", "item", "player"],
      control: "The canonical title on cards, item detail and the player",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "THE core distinction: canonical Entertainment Item identity is primary, realization is secondary; every capability (resume, actions, feedback, AI) binds to the item, not to a source page.",
    persistenceExpectation:
      "Canonical identity is durable server-side state; resume/actions attach to it across realizations and devices.",
    accessibilityRequirement:
      "Source attribution renders as secondary text on the canonical card; screen readers announce the title first, the source second.",
    performanceRelevance: "startup-critical",
    testJourneyIds: ["J06", "J32", "J40", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R01", "R02"],
  },
  {
    id: "where-to-watch",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Where to watch — the playback-source selector mental model",
    referenceSurface: "watch",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: it sits near Play, opens like a source picker, and every entry uses the same title/item/player language.",
    webflixTreatment: "Where to watch / realization switching",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["item", "player"],
      control: "Where to watch near Play",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Lists the honest realization set (WebFlix source, authorized peer copy, provider realization, external source) with per-realization capability truth; switching preserves canonical identity and resume position.",
    persistenceExpectation:
      "Chosen realization persists as playback preference per item (per profile where present); identity/position never change on switch.",
    accessibilityRequirement:
      "The picker is a labeled list of ways to watch; the active realization is announced; switching is one obvious action with a recovery path when it fails.",
    performanceRelevance: "startup-critical",
    testJourneyIds: ["J06", "J38", "J40", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R09", "R23-C", "R23-E"],
  },
  {
    id: "authorized-peer-copy",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) A peer copy — the shared-source mental model inside Where to watch",
    referenceSurface: "watch",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: it appears as a way to watch (not a download-only admin flow), with the same player language and honest buffering.",
    webflixTreatment:
      "Authorized peer/torrent copies (a first-class realization, never a download-only afterthought)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["item", "player"],
      control: "Authorized peer copy under Where to watch",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "supported",
    },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Torrent is a realization SOURCE KIND, never a PlaybackMode (R23-C compile-guarded); Web runs WebRTC-capable browser realizations only; Desktop owns the full native rung — capability truth everywhere.",
    persistenceExpectation:
      "Shares resume/watch-state, actions, AI and Library semantics with every other realization; background completion and verified-offline states persist on Desktop.",
    accessibilityRequirement:
      "Acquisition states are product states (Preparing/Buffering/Playing/Completing/Ready offline) — protocol jargon stays behind progressive disclosure.",
    performanceRelevance: "startup-critical",
    testJourneyIds: ["J21", "J38", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-3", "worker-1"],
    dependencyIds: ["R11", "R23-C", "R23-D"],
  },
  {
    id: "bring-your-own-feed",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Imported subscriptions — the Following mental model applied to your existing service relationships",
    referenceSurface: "home",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: it lives beside Following (feed modes + source context), like adding another subscriptions source.",
    webflixTreatment: "Bring Your Own Feed (authorized import/sync)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "settings"],
      control: "Bring Your Feed from the feed-mode control + Sources in Settings",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Imports are authorized API/export/file inputs with provenance, freshness and live/snapshot truth; source-native order is preserved distinctly from WebFlix ranking; disconnect never deletes local history.",
    persistenceExpectation:
      "Normalized feed records persist with provenance/freshness; idempotent sync; the import never silently becomes recommendation identity.",
    accessibilityRequirement:
      "Preview/confirm steps are keyboard-operable; import progress and results are announced honestly.",
    performanceRelevance: "none",
    testJourneyIds: ["J33", "J36", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R20"],
  },
  {
    id: "feed-modes",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Feed orientation — For you / Following / imported / Blend",
    referenceSurface: "home",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: a segmented feed control on Home, the same mental model as switching between recommendation and subscriptions feeds.",
    webflixTreatment: "WebFlix / Following / imported / Blend feed modes",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home"],
      control: "Feed-mode control on Home",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "The imported mode shows source-native order distinctly from WebFlix-ranked discovery (never mislabeled); Blend honestly blends with disclosed weighting.",
    persistenceExpectation:
      "The active mode persists per profile; For you works for anonymous sessions with the other modes honestly marked unavailable with their prerequisite.",
    accessibilityRequirement:
      "The segmented control is keyboard-operable with the active mode announced; unavailable modes carry their reason, not silence.",
    performanceRelevance: "none",
    testJourneyIds: ["J34", "J36", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R21-A", "R20"],
  },
  {
    id: "session-intent",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Tell the app what you're in the mood for — temporary context, not a settings maze",
    referenceSurface: "cross-surface",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: an in-context, dismissible prompt near the feed — like a mood filter, never a configuration form.",
    webflixTreatment: "Explicit session intent (temporary, session-scoped)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "search"],
      control: "Set your intent (Personalize on Home/Search)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Intent shapes candidate composition source-neutrally across every connected source; it never pins the feed to one source.",
    persistenceExpectation:
      "Session-scoped by design — it must not corrupt long-term preferences (J17 law); durable intent history belongs to the profile.",
    accessibilityRequirement:
      "The intent prompt is dismissible without answer; chosen intent is announced and clearable in one action.",
    performanceRelevance: "none",
    testJourneyIds: ["J17", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },
  {
    id: "attention-policy",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) How much the platform should pull you in — user control over session flow",
    referenceSurface: "cross-surface",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: a small in-context selector (like autoplay/quiet-mode controls), never hidden optimization.",
    webflixTreatment: "Mindful / Balanced / Immersive / Custom attention policy",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "player"],
      control: "Attention mode in Personalize + player settings",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Policy, not cosmetics (frozen architecture law): it gates autoplay, inline previews and distraction-free presentation — never playback start or capability availability.",
    persistenceExpectation:
      "Durable with the profile; anonymous sessions may override per session (honestly session-scoped).",
    accessibilityRequirement:
      "The four modes are labeled with their effect; the active mode is announced; changing it is reversible and immediate.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J18", "J40", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },
  {
    id: "anti-tunnel-controls",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Recommendation steering — avoiding being stuck on one topic",
    referenceSurface: "cross-surface",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: feedback controls in the places recommendations appear (cards, player, Shorts) — like Not interested, but for diversity.",
    webflixTreatment: "Anti-tunnel recommendation controls",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["home", "item", "player", "shorts"],
      control: "Exploration controls in the feedback menu",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Exploration/novelty steering is policy-owned by the Recommendation OS across all sources; it never blocks or gates playback.",
    persistenceExpectation:
      "Durable policy inputs with the profile; a recent watch stays one signal, never permanent identity.",
    accessibilityRequirement:
      "Controls sit in the same feedback menu vocabulary as Not interested; effects are announced and reversible.",
    performanceRelevance: "none",
    testJourneyIds: ["J16", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R05"],
  },
  {
    id: "model-selection",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Which engine powers the feature — an optional choice, not a prerequisite to watch",
    referenceSurface: "cross-surface",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: an optional selector in the AI tray (like quality selection), with detailed management in Model & AI.",
    webflixTreatment: "WebFlix / BYOM / local model selection",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "settings"],
      control: "Model choice in the AI tray + Model & AI in Settings",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "capability-dependent",
      desktop: "supported",
    },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Model choice never gates playback; provider SDKs never appear in shared product logic (Model Fabric owns routing); local models run where the platform truly supports them (Desktop).",
    persistenceExpectation:
      "BYOM bindings and model policy persist with the profile; secrets never enter client read models (the secret-guard law).",
    accessibilityRequirement:
      "The selector labels privacy/execution truth (cloud vs local) plainly; default works without configuration.",
    performanceRelevance: "none",
    testJourneyIds: ["J19", "J36", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R06", "R23-J"],
  },
  {
    id: "ai-transformations",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Media tools — transcribe, translate, dub, comment, ask about the video",
    referenceSurface: "watch",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: contextual media tools in the player/AI tray, like captions settings — never an architecture console.",
    webflixTreatment:
      "Transcript / translation / dubbing / commentary / visual Q&A (explicit user actions with progress and results)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player", "watch"],
      control: "AI actions in the player tray",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Actions run through Model Fabric over authorized, lawfully-available media; AI work NEVER blocks first-frame playback (R24-E startup law); anonymous use follows the R23-K low-cost/local boundary.",
    persistenceExpectation:
      "Derived artifacts (transcripts, translations) persist with provenance/model metadata; operation states (progress/result) are explicit, never fake.",
    accessibilityRequirement:
      "Actions show real progress with cancellable states; results render progressively disclosed; transcripts double as accessible alternatives.",
    performanceRelevance: "startup-adjacent",
    testJourneyIds: ["J20", "J39", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R06", "R23-F", "R23-G"],
  },
  {
    id: "semantic-moment-search",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Find the part where… — moment-level search inside content",
    referenceSurface: "search",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: search behaves like searching a transcript — results jump to the moment, like clicking a chapter timestamp.",
    webflixTreatment: "Semantic moment search (searchable moments from the R23-F index)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["search", "watch"],
      control: "Moment results in Search + transcript/chapter jump",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Runs over the canonical semantic index (provider-derived where authorized, AI-derived otherwise — labeled); local/private retrieval for user-owned media where supported.",
    persistenceExpectation:
      "The moment index persists as derived media intelligence with provenance; queries stay transient.",
    accessibilityRequirement:
      "Moment hits announce their timestamp and context; jumping is one action with the same seek semantics as chapters.",
    performanceRelevance: "none",
    testJourneyIds: ["J39", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R23-F", "R23-H"],
  },
  {
    id: "browser-host",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) In-app web playback — the contained web surface",
    referenceSurface: "watch",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: it feels like another playback surface in the player — not a browser window bolted onto the app.",
    webflixTreatment: "Contained provider BrowserHost (a playback realization, where permitted)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["player"],
      control: "Contained web playback (a Where to watch realization)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "A UX surface, never a circumvention mechanism: provider security/DRM/access controls are fully respected; cookie isolation and containment are truthful.",
    persistenceExpectation:
      "Session-scoped surface state; canonical watch state mirrors position as with any realization.",
    accessibilityRequirement:
      "The contained surface participates in the player's keyboard/focus contract to the extent the contained content allows; honest limits are disclosed.",
    performanceRelevance: "startup-critical",
    testJourneyIds: ["J08", "J42"],
    evidenceLink: "docs/validation/webflix-golden-journeys.md",
    implementationOwners: ["worker-2", "worker-3"],
    dependencyIds: ["R09"],
  },
  {
    id: "local-offline-media",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Your own files and verified offline copies — the same item continues locally",
    referenceSurface: "library",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: offline items sit in Library beside everything else and play with the same player semantics.",
    webflixTreatment:
      "Local media and verified offline Library assets (integrity-verified)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["library", "item", "player"],
      control: "Offline section in Library + available-offline truth on items",
      contextual: true,
    },
    webDesktopApplicability: {
      web: "native-only-next-step",
      desktop: "supported",
    },
    authRequirement: "webflix-account",
    sourceRealizationImplications:
      "Only integrity-verified assets earn offline status; acquisition stays authorized with provenance; Web presents the honest Desktop next step (never a dead unsupported).",
    persistenceExpectation:
      "Verified assets persist in the Desktop Library; the same canonical item continues locally with shared resume semantics.",
    accessibilityRequirement:
      "Offline truth (verified/downloadable/needs Desktop) is announced per item; states are honest, never fake progress.",
    performanceRelevance: "playback-quality",
    testJourneyIds: ["J26", "J27", "J42"],
    evidenceLink: "docs/validation/webflix-golden-journeys.md",
    implementationOwners: ["worker-3", "worker-1"],
    dependencyIds: ["R10", "R13", "R14"],
  },
  {
    id: "provenance-transparency",
    area: "webflix-extension",
    referenceCapability:
      "(no YouTube counterpart) Where did this come from — origin, model and license truth",
    referenceSurface: "cross-surface",
    referenceBehavior:
      "No YouTube counterpart. The familiar grammar: a details affordance like an info popover — trust metadata on demand, never the main UX.",
    webflixTreatment:
      "Provenance and model/license transparency (progressive disclosure)",
    classification: "native-equivalent",
    userEntryPoint: {
      surfaces: ["item", "player", "watch"],
      control: "Provenance / model / license details (progressive disclosure)",
      contextual: true,
    },
    webDesktopApplicability: { web: "supported", desktop: "supported" },
    authRequirement: "anonymous",
    sourceRealizationImplications:
      "Every realization carries its authorization/provenance truth (source, peer, generated); model outputs carry model/license metadata; nothing is presented as more official than it is.",
    persistenceExpectation:
      "Provenance persists with the artifacts and realizations it describes — it is immutable context, not editable metadata.",
    accessibilityRequirement:
      "Detail is reachable via keyboard as a described disclosure; the summary never hides material facts (e.g. AI-generated captions are labeled).",
    performanceRelevance: "none",
    testJourneyIds: ["J39", "J42"],
    evidenceLink: "docs/validation/youtube-parity-lab.md",
    implementationOwners: ["worker-1", "worker-2", "worker-3"],
    dependencyIds: ["R06", "R23-J"],
  },
];

// ---------------------------------------------------------------------------
// Lookups + views (pure derivations over the frozen matrix)
// ---------------------------------------------------------------------------

/** Lookup one taxonomy row by id (undefined when unknown). */
export function parityTaxonomyRowOf(
  id: ParityTaxonomyRowId,
): ParityTaxonomyRow | undefined {
  return PARITY_TAXONOMY.find((row) => row.id === id);
}

/** All rows of one classification, in matrix order. */
export function parityTaxonomyRowsOfClassification(
  classification: ParityClassification,
): readonly ParityTaxonomyRow[] {
  return PARITY_TAXONOMY.filter((row) => row.classification === classification);
}

/** All rows of one area, in matrix order. */
export function parityTaxonomyRowsOfArea(
  area: ParityTaxonomyArea,
): readonly ParityTaxonomyRow[] {
  return PARITY_TAXONOMY.filter((row) => row.area === area);
}

/** The classification distribution (the lab's completion-signature counts). */
export function parityClassificationDistribution(): Readonly<
  Record<ParityClassification, number>
> {
  const distribution = {
    parity: 0,
    "native-equivalent": 0,
    "platform-variant": 0,
    "intentionally-out-of-scope": 0,
  } as Record<ParityClassification, number>;
  for (const row of PARITY_TAXONOMY) distribution[row.classification] += 1;
  return distribution;
}

/**
 * A flat serializable view of one row — what the parity surfaces and the
 * J40/J42 evidence harness render. Adds the human classification label
 * (the lab's wording) and the area label; never re-derives semantics.
 */
export interface ParityTaxonomyViewRow {
  readonly id: ParityTaxonomyRowId;
  readonly area: ParityTaxonomyArea;
  readonly referenceCapability: string;
  readonly referenceSurface: ParityReferenceSurface;
  readonly webflixTreatment: string;
  readonly classification: ParityClassification;
  readonly classificationLabel: string;
  readonly entrySurfaces: readonly ProductSurfaceId[];
  readonly entryControl: string;
  readonly contextualEntry: boolean;
  readonly webSupport: ParitySurfaceSupport;
  readonly desktopSupport: ParitySurfaceSupport;
  readonly authRequirement: ViewerAuthClass;
  readonly performanceRelevance: ParityPerformanceRelevance;
  readonly testJourneyIds: readonly string[];
  readonly evidenceLink: string;
}

/** The lab's user-facing classification wording (one derivation source). */
export const PARITY_CLASSIFICATION_LABELS: Readonly<
  Record<ParityClassification, string>
> = {
  parity: "Parity",
  "native-equivalent": "Native equivalent",
  "platform-variant": "Platform variant",
  "intentionally-out-of-scope": "Intentionally out of scope",
};

/** Flatten one row into the serializable view (pure). */
export function parityTaxonomyViewRow(
  row: ParityTaxonomyRow,
): ParityTaxonomyViewRow {
  return {
    id: row.id,
    area: row.area,
    referenceCapability: row.referenceCapability,
    referenceSurface: row.referenceSurface,
    webflixTreatment: row.webflixTreatment,
    classification: row.classification,
    classificationLabel: PARITY_CLASSIFICATION_LABELS[row.classification],
    entrySurfaces: row.userEntryPoint.surfaces,
    entryControl: row.userEntryPoint.control,
    contextualEntry: row.userEntryPoint.contextual,
    webSupport: row.webDesktopApplicability.web,
    desktopSupport: row.webDesktopApplicability.desktop,
    authRequirement: row.authRequirement,
    performanceRelevance: row.performanceRelevance,
    testJourneyIds: row.testJourneyIds,
    evidenceLink: row.evidenceLink,
  };
}

// ---------------------------------------------------------------------------
// The plan-matrix coverage contracts (the R24-C cells + the R24-B list)
// ---------------------------------------------------------------------------

/**
 * The plan's ENTIRE R24-C Discovery matrix, as taxonomy row ids. Every cell
 * MUST resolve to exactly one row — the parity regression tests assert this
 * list against {@link PARITY_TAXONOMY} (a missing viewer capability from the
 * plan matrix is an R24 rejection).
 */
export const PLAN_R24C_DISCOVERY_CELLS: readonly ParityTaxonomyRowId[] = [
  "home-feed",
  "search",
  "search-suggestions",
  "related-next-videos",
  "inline-playback",
  "subscriptions",
  "shorts-surface",
];

/**
 * The plan's ENTIRE R24-C Watch/player matrix. The plan's Watch cell
 * "Cast/second screen" consolidates with the Identity area's
 * "TV/second-screen continuation" into the single `tv-second-screen-continuation`
 * row — exactly the consolidation the frozen lab inventory makes (one
 * "Cast/TV continuation" row); the mapping is explicit here so the coverage
 * check stays honest about it.
 */
export const PLAN_R24C_WATCH_PLAYER_CELLS: readonly ParityTaxonomyRowId[] = [
  "play-pause",
  "seek-scrub",
  "volume-mute",
  "fullscreen",
  "miniplayer-pip",
  "playback-speed",
  "quality",
  "captions",
  "transcript",
  "chapters",
  "autoplay",
  "up-next",
  "queue",
  "share",
  "like-save",
  "negative-feedback",
  "comments-reactions",
  "watch-history",
  "watch-later",
  "playlists",
  "live-playback",
  "live-chat",
  "external-handoff",
  "tv-second-screen-continuation",
];

/** The plan's ENTIRE R24-C Shorts matrix, as taxonomy row ids. */
export const PLAN_R24C_SHORTS_CELLS: readonly ParityTaxonomyRowId[] = [
  "shorts-vertical-swipe",
  "shorts-like-save-share",
  "shorts-sound-related",
  "shorts-remix-attribution",
  "shorts-clear-screen",
  "shorts-speed-controls",
  "shorts-inline-feedback",
];

/** The plan's ENTIRE R24-C Identity-and-continuity matrix, as row ids. */
export const PLAN_R24C_IDENTITY_CELLS: readonly ParityTaxonomyRowId[] = [
  "anonymous-public-viewing",
  "account-history",
  "cross-device-continuity",
  "source-subscription-relationships",
  "notifications",
  "tv-second-screen-continuation",
];

/**
 * EVERY WebFlix-only extension the R24-B law lists — "not optional extras
 * for the parity lab; they are part of the WebFlix identity". Each must
 * carry a contextual placement decision (see capability-placement.ts).
 */
export const PLAN_R24B_EXTENSION_ITEMS: readonly ParityTaxonomyRowId[] = [
  "canonical-identity",
  "where-to-watch",
  "authorized-peer-copy",
  "bring-your-own-feed",
  "feed-modes",
  "session-intent",
  "attention-policy",
  "anti-tunnel-controls",
  "model-selection",
  "ai-transformations",
  "semantic-moment-search",
  "browser-host",
  "local-offline-media",
  "provenance-transparency",
];

/**
 * Reference rows the frozen lab contract (docs/validation/
 * youtube-parity-lab.md) inventories beyond the plan's R24-C cells — kept
 * explicit so the lab inventory is also machine-verified complete.
 */
export const LAB_INVENTORY_EXTRA_ROWS: readonly ParityTaxonomyRowId[] = [
  "natural-language-search",
  "channel-profile-pages",
  "save-queue",
  "description-links",
  "continue-watching",
  "device-handoff",
  "offline-viewing",
  "live-replay",
];

/** True when every listed id resolves to exactly one taxonomy row. */
export function taxonomyCoversAll(
  ids: readonly ParityTaxonomyRowId[],
): boolean {
  return ids.every(
    (id) =>
      PARITY_TAXONOMY.filter((row) => row.id === id).length === 1,
  );
}

// ---------------------------------------------------------------------------
// The completeness machine-checks (the lab rule as code)
// ---------------------------------------------------------------------------

/**
 * Copy that betrays an unclassified or deferred row — the machine check
 * behind the plan's "no feature may remain 'to be considered'" law. A row
 * whose classification, treatment or capability text matches any of these
 * patterns fails validation (the lab's "a blank classification is a lab
 * failure" rule, extended to evasive wording).
 */
export const PENDING_CLASSIFICATION_MARKERS: readonly RegExp[] = [
  /to be considered/i,
  /to be determined/i,
  /\bTBD\b/,
  /\bN\/A\b/,
  /^—$/,
  /^-$/,
  /unclassified/i,
  /pending (review|classification)/i,
  /not yet (classified|decided)/i,
];

/** One taxonomy validation problem (row-scoped, machine-checkable). */
export interface ParityTaxonomyViolation {
  readonly row: ParityTaxonomyRowId | "(matrix)";
  readonly field: string;
  readonly problem: string;
}

/**
 * The derived completeness report: row count, classification distribution
 * and the full violation list. `ok` is the lab-rule truth — it is true only
 * when every row is classified with real copy, every field carries its
 * required shape, the out-of-scope companions exist where required, entry
 * points are lawful, and the plan's R24-C matrix + R24-B extension list are
 * completely covered.
 */
export interface ParityTaxonomyValidation {
  readonly ok: boolean;
  readonly rowCount: number;
  readonly distribution: Readonly<Record<ParityClassification, number>>;
  readonly planCoverage: Readonly<
    Record<
      | "r24c-discovery"
      | "r24c-watch-player"
      | "r24c-shorts"
      | "r24c-identity-continuity"
      | "r24b-extensions"
      | "lab-inventory-extras",
      boolean
    >
  >;
  readonly violations: readonly ParityTaxonomyViolation[];
}

const JOURNEY_ID_RE = /^J\d{2}$/;
const DEPENDENCY_ID_RE = /^R\d{2}(-[A-Z])?$/;
const EVIDENCE_LINK_RE = /^(https:\/\/|http:\/\/|docs\/|evidence\/)/;
const NON_EMPTY_TEXT_RE = /\S/;

/**
 * Validate the ENTIRE frozen taxonomy (pure; run by the parity regression
 * tests and available to the lead's lab harness). Checks:
 *
 * 1. STRUCTURE — row ids are unique and exactly cover
 *    {@link PARITY_TAXONOMY_ROW_IDS}; every free-text field is real copy
 *    (non-blank); evidence links are doc paths, evidence paths or URLs.
 * 2. CLASSIFICATION COMPLETENESS — every row's classification is a member
 *    of the frozen union AND its capability/treatment/classification text
 *    carries none of {@link PENDING_CLASSIFICATION_MARKERS} (nothing may
 *    remain "to be considered").
 * 3. OUT-OF-SCOPE COMPANIONS — `intentionally-out-of-scope` rows MUST
 *    carry `outOfScopeReason` + `nearestWebFlixPath` (the lab rule).
 * 4. ENTRY-POINT LAWS — entry surfaces are valid product surfaces; every
 *    WebFlix-ONLY extension (area `webflix-extension`) has at least one
 *    CONTEXTUAL entry (never settings-only — the R24-B point-of-intent
 *    law; a settings-only extension is an R24 rejection).
 * 5. ID FORMATS — journey ids look like `J##`; dependency ids look like
 *    `R##`/`R##-A`; owners are members of the frozen union; owner and
 *    dependency lists are never empty.
 * 6. PLAN COVERAGE — the plan's entire R24-C matrix (all four areas) and
 *    all fourteen R24-B extensions are present exactly once, plus the
 *    frozen lab inventory's extra reference rows.
 */
export function validateParityTaxonomy(): ParityTaxonomyValidation {
  const violations: ParityTaxonomyViolation[] = [];

  // 1. structure ---------------------------------------------------------
  const seen = new Set<string>();
  for (const row of PARITY_TAXONOMY) {
    if (seen.has(row.id)) {
      violations.push({
        row: row.id,
        field: "id",
        problem: "duplicate row id in the matrix",
      });
    }
    seen.add(row.id);
  }
  for (const id of PARITY_TAXONOMY_ROW_IDS) {
    if (!seen.has(id)) {
      violations.push({
        row: "(matrix)",
        field: "id",
        problem: `row ${id} is missing from the matrix`,
      });
    }
  }
  for (const row of PARITY_TAXONOMY) {
    const textFields: ReadonlyArray<[keyof ParityTaxonomyRow, string]> = [
      ["referenceCapability", row.referenceCapability],
      ["referenceBehavior", row.referenceBehavior],
      ["webflixTreatment", row.webflixTreatment],
      [
        "sourceRealizationImplications",
        row.sourceRealizationImplications,
      ],
      ["persistenceExpectation", row.persistenceExpectation],
      ["accessibilityRequirement", row.accessibilityRequirement],
    ];
    for (const [field, value] of textFields) {
      if (!NON_EMPTY_TEXT_RE.test(value)) {
        violations.push({
          row: row.id,
          field: String(field),
          problem: "empty or blank text",
        });
      }
    }
    if (!NON_EMPTY_TEXT_RE.test(row.userEntryPoint.control)) {
      violations.push({
        row: row.id,
        field: "userEntryPoint.control",
        problem: "empty or blank entry-point control",
      });
    }
    if (row.userEntryPoint.surfaces.length === 0) {
      violations.push({
        row: row.id,
        field: "userEntryPoint.surfaces",
        problem: "no entry surfaces",
      });
    }
    if (!EVIDENCE_LINK_RE.test(row.evidenceLink)) {
      violations.push({
        row: row.id,
        field: "evidenceLink",
        problem: `evidence link must be a doc path, evidence path or URL (got ${row.evidenceLink})`,
      });
    }
    if (row.testJourneyIds.length === 0) {
      violations.push({
        row: row.id,
        field: "testJourneyIds",
        problem: "no journey/test ids",
      });
    }
    for (const jid of row.testJourneyIds) {
      if (!JOURNEY_ID_RE.test(jid)) {
        violations.push({
          row: row.id,
          field: "testJourneyIds",
          problem: `journey id ${jid} does not match J##`,
        });
      }
    }
    if (row.dependencyIds.length === 0) {
      violations.push({
        row: row.id,
        field: "dependencyIds",
        problem: "no dependency ids",
      });
    }
    for (const dep of row.dependencyIds) {
      if (!DEPENDENCY_ID_RE.test(dep)) {
        violations.push({
          row: row.id,
          field: "dependencyIds",
          problem: `dependency id ${dep} does not match R## or R##-A`,
        });
      }
    }
    if (row.implementationOwners.length === 0) {
      violations.push({
        row: row.id,
        field: "implementationOwners",
        problem: "no implementation owners",
      });
    }
    for (const owner of row.implementationOwners) {
      if (!isParityImplementationOwner(owner)) {
        violations.push({
          row: row.id,
          field: "implementationOwners",
          problem: `unknown owner ${String(owner)}`,
        });
      }
    }

    // 2. classification completeness -------------------------------------
    if (!isParityClassification(row.classification)) {
      violations.push({
        row: row.id,
        field: "classification",
        problem: "classification is not a member of the frozen union",
      });
    }
    const classifiedCopy = [
      row.classification,
      row.referenceCapability,
      row.webflixTreatment,
    ];
    for (const marker of PENDING_CLASSIFICATION_MARKERS) {
      if (classifiedCopy.some((text) => marker.test(text))) {
        violations.push({
          row: row.id,
          field: "classification",
          problem: `pending-classification copy matches ${String(marker)}`,
        });
      }
    }

    // 3. out-of-scope companions ------------------------------------------
    if (row.classification === "intentionally-out-of-scope") {
      if (!row.outOfScopeReason || !NON_EMPTY_TEXT_RE.test(row.outOfScopeReason)) {
        violations.push({
          row: row.id,
          field: "outOfScopeReason",
          problem:
            "intentionally-out-of-scope rows must carry the reason (lab rule)",
        });
      }
      if (
        !row.nearestWebFlixPath ||
        !NON_EMPTY_TEXT_RE.test(row.nearestWebFlixPath)
      ) {
        violations.push({
          row: row.id,
          field: "nearestWebFlixPath",
          problem:
            "intentionally-out-of-scope rows must carry the nearest user-facing WebFlix path (lab rule)",
        });
      }
    }

    // 4. entry-point laws --------------------------------------------------
    if (
      row.userEntryPoint.surfaces.length > 0 &&
      row.userEntryPoint.surfaces.some((s) => s === "settings") &&
      row.userEntryPoint.surfaces.every((s) => s === "settings")
    ) {
      // Settings is a legitimate detailed-management center — but a
      // WebFlix-ONLY feature whose ONLY entry is Settings violates the
      // R24-B point-of-intent law (an R24 rejection).
      if (row.area === "webflix-extension") {
        violations.push({
          row: row.id,
          field: "userEntryPoint.surfaces",
          problem:
            "WebFlix-only extension exposed only through Settings (R24-B point-of-intent law)",
        });
      }
    }
    if (row.area === "webflix-extension" && !row.userEntryPoint.contextual) {
      violations.push({
        row: row.id,
        field: "userEntryPoint.contextual",
        problem:
          "WebFlix-only extension must have a contextual entry (R24-B law)",
      });
    }
  }

  // 6. plan coverage ------------------------------------------------------
  const planCoverage = {
    "r24c-discovery": taxonomyCoversAll(PLAN_R24C_DISCOVERY_CELLS),
    "r24c-watch-player": taxonomyCoversAll(PLAN_R24C_WATCH_PLAYER_CELLS),
    "r24c-shorts": taxonomyCoversAll(PLAN_R24C_SHORTS_CELLS),
    "r24c-identity-continuity": taxonomyCoversAll(PLAN_R24C_IDENTITY_CELLS),
    "r24b-extensions": taxonomyCoversAll(PLAN_R24B_EXTENSION_ITEMS),
    "lab-inventory-extras": taxonomyCoversAll(LAB_INVENTORY_EXTRA_ROWS),
  };
  for (const [area, covered] of Object.entries(planCoverage)) {
    if (!covered) {
      violations.push({
        row: "(matrix)",
        field: `planCoverage.${area}`,
        problem: "the plan/lab inventory is not completely covered",
      });
    }
  }

  return {
    ok: violations.length === 0,
    rowCount: PARITY_TAXONOMY.length,
    distribution: parityClassificationDistribution(),
    planCoverage,
    violations,
  };
}
