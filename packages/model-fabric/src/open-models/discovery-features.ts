/**
 * @wfx/model-fabric — the multimodal discovery feature contracts (R23-H).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-H):
 * VideoPrism + Qwen2.5-VL + transcript embeddings improve discovery —
 * search by meaning rather than title, search for a specific
 * scene/moment, show-me-the-part-where queries, chapter-aware
 * recommendation, visual similarity, content-aware anti-tunnel
 * exploration, richer recommendation explanations, and cold-start
 * understanding for new titles.
 *
 * THE OWNERSHIP LAW (the plan's sharpest sentence, frozen as typed
 * truth): models generate FEATURES/SIGNALS; the Recommendation OS OWNS
 * user policy and authorization. Every feature contract carries
 * `signalOwnership: "model-generated-signal"` and `policyOwnership:
 * "recommendation-os"`; {@link isLawfulDiscoveryFeatureDefinition}
 * rejects any definition claiming model-side policy authority, and
 * {@link mayModelOwnUserPolicyOrAuthorization} is total and always
 * `false` — the machine-checkable companion of the R23-J model-authority
 * boundary.
 *
 * THE PREREQUISITE LAW: every feature declares the R23-F derived
 * artifacts it requires; availability is derived from the artifact
 * set's HONEST coverage ({@link discoveryFeatureAvailability}) — a
 * feature whose prerequisites are missing answers the typed
 * `prerequisites-missing` state naming exactly what is absent, never a
 * silent downgrade and never a fabricated result.
 *
 * WHAT THIS MODULE IS: PURE typed contracts + availability derivations
 * over the R23-F artifact shapes. No search engine, no recommendation
 * algorithm — the Recommendation OS consumes these SIGNALS under its
 * own policy; this module is the FEATURE CONTRACT seam.
 */

import {
  mediaIntelligenceArtifactCoverage,
  DERIVED_ARTIFACT_KINDS,
} from "../media-intelligence/artifacts";
import type {
  DerivedArtifactKind,
  MediaIntelligenceArtifacts,
} from "../media-intelligence/artifacts";

// ---------------------------------------------------------------------------
// The feature vocabulary (the plan's list)
// ---------------------------------------------------------------------------

/**
 * One multimodal discovery feature — exactly the plan's R23-H list:
 *
 * - `search-by-meaning` — natural-language search that finds relevant
 *   titles/moments by WHAT THEY ARE, not by title match;
 * - `moment-search` — search for a specific scene/moment,
 *   show-me-the-part-where queries landing on timestamps;
 * - `chapter-aware-signals` — recommendation signals that respect
 *   chapter/scene structure;
 * - `visual-similarity` — visually similar content through video
 *   embeddings;
 * - `anti-tunnel-exploration` — content-aware exploration signals that
 *   help the Recommendation OS counter recommendation tunneling;
 * - `richer-explanations` — recommendation explanations grounded in
 *   transcripts/chapters/visual truth;
 * - `cold-start-understanding` — understanding for new titles with no
 *   interaction history.
 */
export type DiscoveryFeatureKind =
  | "search-by-meaning"
  | "moment-search"
  | "chapter-aware-signals"
  | "visual-similarity"
  | "anti-tunnel-exploration"
  | "richer-explanations"
  | "cold-start-understanding";

/** Every value of {@link DiscoveryFeatureKind}, in plan order. */
export const DISCOVERY_FEATURE_KINDS: readonly DiscoveryFeatureKind[] = [
  "search-by-meaning",
  "moment-search",
  "chapter-aware-signals",
  "visual-similarity",
  "anti-tunnel-exploration",
  "richer-explanations",
  "cold-start-understanding",
] as const;

/** Runtime membership check against the feature union. */
export function isDiscoveryFeatureKind(
  x: unknown,
): x is DiscoveryFeatureKind {
  return (
    typeof x === "string" &&
    (DISCOVERY_FEATURE_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The ownership vocabulary (the plan's ownership law, typed)
// ---------------------------------------------------------------------------

/**
 * WHO owns what — the ownership law's two fields, frozen as unions of
 * exactly ONE lawful value each (a second value would BE the drift):
 * - signal generation belongs to MODELS;
 * - user policy and authorization belong to the RECOMMENDATION OS.
 */
export type DiscoverySignalOwnership = "model-generated-signal";
export type DiscoveryPolicyOwnership = "recommendation-os";

// ---------------------------------------------------------------------------
// The feature contract
// ---------------------------------------------------------------------------

/** One discovery feature's frozen contract. */
export interface DiscoveryFeatureContract {
  readonly kind: DiscoveryFeatureKind;
  /** The feature's user label (the one derivation source). */
  readonly label: string;
  /** One honest sentence about what the feature gives the viewer. */
  readonly detail: string;
  /** The R23-F derived artifacts the feature requires. */
  readonly requiredArtifacts: readonly DerivedArtifactKind[];
  /** The catalog models whose signals contribute (provenance truth). */
  readonly contributingModels: readonly string[];
  /** Always "model-generated-signal" — models generate signals. */
  readonly signalOwnership: DiscoverySignalOwnership;
  /** Always "recommendation-os" — the OS owns policy + authorization. */
  readonly policyOwnership: DiscoveryPolicyOwnership;
}

/**
 * The frozen discovery-feature contracts — the plan's list with its
 * honest prerequisites and contributing models (VideoPrism + Qwen2.5-VL
 * + the BGE-M3 transcript-embedding family).
 */
export const DISCOVERY_FEATURE_CONTRACTS: readonly DiscoveryFeatureContract[] =
  [
    {
      kind: "search-by-meaning",
      label: "Search by meaning",
      detail:
        "Find titles and moments by describing what you are looking for — the search understands what content IS, across languages.",
      requiredArtifacts: [
        "transcript-text-embedding",
        "semantic-video-embedding",
      ],
      contributingModels: ["open-model:bge-m3", "open-model:videoprism-base-f16r288"],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
    {
      kind: "moment-search",
      label: "Find the exact moment",
      detail:
        "Show-me-the-part-where queries land on the timestamp you mean, grounded in transcripts, chapters, and visual events.",
      requiredArtifacts: ["transcript-segments", "searchable-moments"],
      contributingModels: [
        "open-model:bge-m3",
        "open-model:videoprism-base-f16r288",
        "open-model:qwen2.5-vl-7b-instruct",
      ],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
    {
      kind: "chapter-aware-signals",
      label: "Chapter-aware recommendations",
      detail:
        "Recommendation signals that respect where a title's chapters and scenes actually are.",
      requiredArtifacts: ["chapters-scenes"],
      contributingModels: ["open-model:qwen2.5-vl-7b-instruct"],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
    {
      kind: "visual-similarity",
      label: "Visually similar",
      detail:
        "More like this visually — similarity computed from what the video actually shows.",
      requiredArtifacts: ["semantic-video-embedding"],
      contributingModels: ["open-model:videoprism-base-f16r288"],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
    {
      kind: "anti-tunnel-exploration",
      label: "Content-aware exploration",
      detail:
        "Exploration signals that help recommendations widen honestly — grounded in what your watchlist actually contains.",
      requiredArtifacts: [
        "semantic-video-embedding",
        "transcript-text-embedding",
      ],
      contributingModels: [
        "open-model:videoprism-base-f16r288",
        "open-model:bge-m3",
      ],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
    {
      kind: "richer-explanations",
      label: "Richer why-this",
      detail:
        "Recommendation explanations grounded in the title's own transcripts, chapters, and visual truth.",
      requiredArtifacts: [
        "transcript-segments",
        "chapters-scenes",
        "visual-concepts-entities",
      ],
      contributingModels: [
        "open-model:qwen2.5-vl-7b-instruct",
        "open-model:bge-m3",
      ],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
    {
      kind: "cold-start-understanding",
      label: "New-title understanding",
      detail:
        "Fresh titles get understood from their content — chapters, visuals, and transcripts — before anyone has watched them.",
      requiredArtifacts: [
        "semantic-video-embedding",
        "visual-concepts-entities",
        "chapters-scenes",
      ],
      contributingModels: [
        "open-model:videoprism-base-f16r288",
        "open-model:qwen2.5-vl-7b-instruct",
        "open-model:bge-m3",
      ],
      signalOwnership: "model-generated-signal",
      policyOwnership: "recommendation-os",
    },
  ] as const;

/** The frozen contract for one feature kind (throws for unknown kinds). */
export function discoveryFeatureContractOf(
  kind: DiscoveryFeatureKind,
): DiscoveryFeatureContract {
  const contract = DISCOVERY_FEATURE_CONTRACTS.find(
    (row) => row.kind === kind,
  );
  if (contract === undefined) {
    throw new Error(
      `discovery-features: no contract for '${String(kind)}' — contract drift`,
    );
  }
  return contract;
}

// ---------------------------------------------------------------------------
// The ownership law (machine-checkable)
// ---------------------------------------------------------------------------

/**
 * THE OWNERSHIP LAW, machine-checkable: is a feature DEFINITION lawful?
 * Lawful definitions carry `signalOwnership: "model-generated-signal"`
 * AND `policyOwnership: "recommendation-os"` — any definition claiming
 * model-side policy or authorization authority is drift (the plan's
 * "models generate features/signals; they do not own user policy or
 * authorization").
 */
export function isLawfulDiscoveryFeatureDefinition(
  contract: DiscoveryFeatureContract,
): boolean {
  return (
    contract.signalOwnership === "model-generated-signal" &&
    contract.policyOwnership === "recommendation-os"
  );
}

/**
 * THE OWNERSHIP LAW, total sharp end: may a model own user policy or
 * authorization? NEVER — regardless of the feature, the model family,
 * or the signal quality. (The companion of the R23-J
 * model-authority-boundary law.)
 */
export function mayModelOwnUserPolicyOrAuthorization(): false {
  return false;
}

// ---------------------------------------------------------------------------
// The prerequisite law (honest availability over artifact truth)
// ---------------------------------------------------------------------------

/** The availability truth of one feature for one item's artifacts. */
export type DiscoveryFeatureAvailability =
  | {
      /** The feature's prerequisites are met by the item's artifacts. */
      kind: "available";
      /** The contributing models whose signals back the feature. */
      readonly contributingModels: readonly string[];
    }
  | {
      /** The honest gap: exactly which derived artifacts are missing. */
      kind: "prerequisites-missing";
      readonly missing: readonly DerivedArtifactKind[];
      /** One honest sentence — never a silent downgrade. */
      readonly detail: string;
    };

/**
 * Derive one feature's availability from an item's R23-F artifact set
 * (pure): available iff EVERY required artifact kind is covered by the
 * set's honest coverage; otherwise the typed `prerequisites-missing`
 * state naming exactly what is absent.
 */
export function discoveryFeatureAvailability(
  kind: DiscoveryFeatureKind,
  artifacts: MediaIntelligenceArtifacts,
): DiscoveryFeatureAvailability {
  const contract = discoveryFeatureContractOf(kind);
  const coverage = mediaIntelligenceArtifactCoverage(artifacts);
  const missing = contract.requiredArtifacts.filter(
    (required) => !coverage[required],
  );
  if (missing.length === 0) {
    return {
      kind: "available",
      contributingModels: contract.contributingModels,
    };
  }
  return {
    kind: "prerequisites-missing",
    missing,
    detail: `This feature needs ${
      missing.length === 1 ? "one more" : "more"
    } derived artifact${missing.length === 1 ? "" : "s"} for this title (${missing.join(
      ", ",
    )}) — it stays off honestly rather than approximate.`,
  };
}

/**
 * The full availability read model for one item: every feature's
 * availability, in frozen order (the J39 surfaces render this — the
 * honest truth, feature by feature).
 */
export function discoveryFeatureAvailabilityView(
  artifacts: MediaIntelligenceArtifacts,
): Readonly<Record<DiscoveryFeatureKind, DiscoveryFeatureAvailability>> {
  const view = {} as Record<
    DiscoveryFeatureKind,
    DiscoveryFeatureAvailability
  >;
  for (const kind of DISCOVERY_FEATURE_KINDS) {
    view[kind] = discoveryFeatureAvailability(kind, artifacts);
  }
  return view;
}

/** Are ALL of a feature's required artifacts within the known kinds? (Drift guard.) */
export function discoveryFeatureRequirementsAreKnown(
  contract: DiscoveryFeatureContract,
): boolean {
  return contract.requiredArtifacts.every((kind) =>
    (DERIVED_ARTIFACT_KINDS as readonly string[]).includes(kind),
  );
}
