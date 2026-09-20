/**
 * @wfx/app-desktop — the local AI surface (R23-W3: the R23-G/H/I/J local
 * integration + the model runtime packaging + the J39 consumption).
 *
 * THE LAWS THIS SURFACE PROJECTS (the lane's local-AI clause, over Worker
 * 1's frozen Model Fabric contracts — ZERO new policy, ZERO provider SDKs):
 *
 * - LICENSE/PROVENANCE TRUTH ON EVERY OPEN-MODEL ROW (R23-J): the
 *   researched catalog renders with its REAL license terms — the
 *   code/weights distinction verbatim (the R2T2 row records exactly
 *   code-Apache-2.0 / weights-NetEase-Model-Use-License), the pinned
 *   revision, the execution locations, the privacy class, the latency
 *   envelope, the HONEST hardware requirement, and the provenance note.
 * - MODEL RUNTIME PACKAGING NEVER FAKES AVAILABILITY: the packaged
 *   local-desktop runtime's status is the PROBE's typed answer —
 *   `available` (its own version truth) or the typed `unavailable` state
 *   with its honest reason + an ACTIONABLE recovery hint (never stale
 *   "arrives later" language).
 * - R2T2 LIVE CAPTIONS GATE ON LEGAL AUDIO (R23-G): the live-caption
 *   input answers the legal-audio precondition FIRST (the typed refusal
 *   names the boundary — no DRM/access-control circumvention, by
 *   design), then the frozen ASR routing (R2T2 → live; MOSS/Whisper →
 *   long-form/batch; the registered provider/local model → the policy
 *   choice). The registration truth is the caller's own — a catalog row
 *   that was never bound to an executor and registered is NOT available.
 * - LOCAL HELPERS STAY LOCAL OR STAY OFF (R23-I, the Desktop shape): the
 *   local-desktop hop runs when the runtime is available (input never
 *   leaves the device); without it, a local-only privacy policy answers
 *   the typed REFUSAL — never a silent hop to a remote model — and a
 *   cloud-permitting policy answers the honest remote fallback with its
 *   input-leaves-device impact.
 * - MODELS NEVER AUTHORIZE ANYTHING (the authority boundary): the
 *   boundary is machine-checkable in Model Fabric
 *   (`mayModelAuthorizePlaybackOrAcquisition() === false`) and rendered
 *   here as the standing note — models generate signals; product policy
 *   and authorization stay the Recommendation OS's and the platform's.
 * - THE J39 CONSUMPTION (the Desktop extension): the item's media
 *   intelligence artifacts (R23-F) render with their HONEST provenance
 *   (`source-provided` marks truth that arrived with the media), the
 *   discovery features answer their typed availability (R23-H — a
 *   missing prerequisite is named, never approximated), and a searchable
 *   moment JUMPS the active native playback to its timestamp.
 */

import type { ClientRuntime } from "@wfx/client-runtime";
import {
  mayModelAuthorizePlaybackOrAcquisition,
  type OpenModelDescriptor,
} from "@wfx/model-fabric";
import { RESEARCHED_OPEN_MODELS } from "@wfx/model-fabric";
import {
  R2T2_CHUNK_RANGE_MS,
  R2T2_REPORTED_AVERAGE_LATENCY_MS,
  liveAsrReadiness,
  routeAsr,
  type AsrRouteDecision,
  type AsrWorkloadKind,
  type LiveAsrReadiness,
} from "@wfx/model-fabric";
import type { LocalInferencePrivacyPolicy, LocalInferenceTaskKind } from "@wfx/model-fabric";
import {
  DISCOVERY_FEATURE_CONTRACTS,
  discoveryFeatureAvailabilityView,
  type DiscoveryFeatureAvailability,
  type DiscoveryFeatureKind,
} from "@wfx/model-fabric";
import type {
  ArtifactModelMetadata,
  MediaIntelligenceArtifacts,
} from "@wfx/model-fabric";
import { SOURCE_PROVIDED_MODEL_ID, validateMediaIntelligenceArtifacts } from "@wfx/model-fabric";

import type {
  DesktopModelRuntimeProbe,
  DesktopModelRuntimeStatus,
} from "../platform/model-runtime";
import { DESKTOP_MODEL_RUNTIME } from "../platform/model-runtime";

// ---------------------------------------------------------------------------
// The open-model catalog view (R23-J — license/provenance truth)
// ---------------------------------------------------------------------------

/** One open-model catalog row, projected with its FULL honest truth. */
export interface DesktopOpenModelRowView {
  readonly providerId: string;
  readonly modelId: string;
  readonly revision: string;
  /** The REAL license terms — the code/weights distinction verbatim. */
  readonly license: {
    readonly code: string;
    readonly weights: string;
    readonly notes: string;
  };
  /** The frozen ModelTasks this model can serve (may be empty — catalog-only). */
  readonly supportedTasks: readonly string[];
  /** What the model contributes to the intelligence pipeline. */
  readonly intelligenceCapabilities: readonly string[];
  /** Where the model can execute (the R23-J vocabulary). */
  readonly executionLocations: readonly string[];
  /** The overall privacy class (local-only iff every location is local). */
  readonly privacyClass: string;
  /** Whether the model can execute on THIS Desktop (the local-desktop location). */
  readonly localDesktopCapable: boolean;
  /** The declared cost per operation (fabric abstract units). */
  readonly costPerOperation: number;
  /** The honest latency envelope. */
  readonly latencyProfile: string;
  /** The honest hardware requirement. */
  readonly hardwareRequirements: string;
  /** The provenance note (where this row's truth came from). */
  readonly provenance: string;
  /** The user sentence for the hardware truth. */
  readonly hardwareSentence: string;
}

/** The hardware-requirement user sentences (the honest truth, one source). */
const HARDWARE_SENTENCES: Readonly<Record<string, string>> = {
  "cpu-practical": "Runs on a normal computer — no special hardware needed.",
  "consumer-gpu": "Needs a consumer GPU — most dedicated graphics cards qualify.",
  "datacenter-gpu": "Needs datacenter-class GPUs — this model runs on hosted infrastructure, not personal devices.",
};

/** Project one catalog row (pure; the descriptor's own truth verbatim). */
export function openModelRowView(descriptor: OpenModelDescriptor): DesktopOpenModelRowView {
  return {
    providerId: descriptor.providerId,
    modelId: descriptor.modelId,
    revision: descriptor.revision,
    license: {
      code: descriptor.license.codeLicense,
      weights: descriptor.license.weightsLicense,
      notes: descriptor.license.notes,
    },
    supportedTasks: [...descriptor.supportedTasks],
    intelligenceCapabilities: [...descriptor.intelligenceCapabilities],
    executionLocations: [...descriptor.executionLocations],
    privacyClass: descriptor.privacyClass,
    localDesktopCapable: descriptor.executionLocations.includes("local-desktop"),
    costPerOperation: descriptor.costPerOperation,
    latencyProfile: descriptor.latencyProfile,
    hardwareRequirements: descriptor.hardwareRequirements,
    provenance: descriptor.provenance,
    hardwareSentence:
      HARDWARE_SENTENCES[descriptor.hardwareRequirements] ??
      `Hardware requirement: ${descriptor.hardwareRequirements}.`,
  };
}

// ---------------------------------------------------------------------------
// The live-caption view (R23-G — the legal-audio gate + the routing)
// ---------------------------------------------------------------------------

/** The live-caption input's answer (the gate first, then the route). */
export interface DesktopLiveCaptionView {
  /** The legal-audio gate's answer (the refusal names the boundary). */
  readonly readiness: LiveAsrReadiness;
  /** The frozen ASR routing (null iff the gate refused — no route exists). */
  readonly route: AsrRouteDecision | null;
  /** The frozen R2T2 envelope (research facts, rendered honestly). */
  readonly envelope: {
    readonly chunkRangeMs: Readonly<{ minMs: number; maxMs: number }>;
    readonly reportedAverageLatencyMs: Readonly<{ minMs: number; maxMs: number }>;
    readonly sentence: string;
  };
}

// ---------------------------------------------------------------------------
// The local-helper route view (R23-I, the Desktop shape)
// ---------------------------------------------------------------------------

/** The typed local-helper route on Desktop (local-desktop or honest fallback). */
export type DesktopLocalHelperRoute =
  | {
      /** The packaged local-desktop runtime runs it — nothing leaves the device. */
      kind: "local-desktop";
      readonly privacyImpact: "local-only";
      readonly detail: string;
    }
  | {
      /** No local runtime; the policy permits cloud — the honest fallback. */
      kind: "remote-fallback";
      readonly privacyImpact: "input-leaves-device";
      readonly detail: string;
    }
  | {
      /** No local runtime AND a local-only policy — the honest refusal. */
      kind: "local-unavailable";
      readonly detail: string;
      readonly recovery: string;
    };

// ---------------------------------------------------------------------------
// The J39 media-intelligence view (the R23-F artifacts + R23-H features)
// ---------------------------------------------------------------------------

/** One artifact's honest provenance, rendered. */
export interface DesktopProvenanceView {
  /** The pipeline stage that produced the artifact. */
  readonly stage: string;
  /** The producing model's id (`source-provided` = arrived WITH the media). */
  readonly modelId: string;
  /** True iff the truth arrived with the media (never a fabricated model). */
  readonly sourceProvided: boolean;
  /** The model's revision pin, when the provider declared one. */
  readonly modelRevision?: string;
  /** The producing model's confidence in [0, 1]. */
  readonly confidence: number;
  /** When the artifact was produced (ISO 8601). */
  readonly producedAt: string;
  /** The one-sentence user rendering of the provenance truth. */
  readonly sentence: string;
}

/** One transcript segment, rendered. */
export interface DesktopTranscriptSegmentView {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly language: string;
  readonly speakerLabel?: string;
}

/** One chapter/scene unit, rendered. */
export interface DesktopChapterView {
  readonly kind: "chapter" | "scene";
  readonly startMs: number;
  readonly endMs: number;
  readonly title?: string;
  readonly summary?: string;
}

/** One searchable moment, rendered (the jump target). */
export interface DesktopMomentView {
  /** The moment's ordinal id (stable within the artifact). */
  readonly id: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly description: string;
}

/** The item's media-intelligence view (the J39 consumption). */
export interface DesktopMediaIntelligenceView {
  readonly itemId: string;
  /** `derived` (artifacts exist), `not-derived` (honest absence), `invalid` (drift — rejected, never coerced). */
  readonly status: "derived" | "not-derived" | "invalid";
  readonly transcript?: {
    readonly segments: readonly DesktopTranscriptSegmentView[];
    readonly language: string;
    readonly provenance: DesktopProvenanceView;
  };
  readonly chapters?: {
    readonly units: readonly DesktopChapterView[];
    readonly provenance: DesktopProvenanceView;
  };
  readonly moments?: {
    readonly moments: readonly DesktopMomentView[];
    readonly provenance: DesktopProvenanceView;
  };
  /** Every discovery feature's typed availability (the R23-H prerequisites law). */
  readonly discoveryFeatures: readonly {
    readonly kind: DiscoveryFeatureKind;
    readonly label: string;
    readonly availability: DiscoveryFeatureAvailability;
  }[];
  /** The honest note when nothing is derived (never a stale promise). */
  readonly notDerivedNote: string | null;
}

/** The typed moment-jump outcome (the J39 jump-to-segment step). */
export type DesktopMomentJumpOutcome =
  | {
      /** The seek was issued to the active native playback session. */
      kind: "jumped";
      readonly playbackSessionId: string;
      readonly positionMs: number;
    }
  | {
      /** No active playback session for the item — the honest next step. */
      kind: "no-active-playback";
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** The composition's media-intelligence truth seam (null = not derived). */
export type DesktopMediaIntelligenceSource = (itemId: string) => MediaIntelligenceArtifacts | null;

/** Options for {@link createDesktopLocalAiSurface}. */
export interface DesktopLocalAiOptions {
  /** The shared client runtime (the active playback sessions). */
  readonly runtime: ClientRuntime;
  /** The packaged local model runtime's probe (the availability truth). */
  readonly runtimeProbe: DesktopModelRuntimeProbe;
  /** The composition's media-intelligence truth per item. */
  readonly mediaIntelligenceOf: DesktopMediaIntelligenceSource;
  /**
   * The ASR-capable provider ids REGISTERED in Model Fabric (the
   * registration truth — a catalog row never bound to an executor and
   * registered is NOT available; capability claims without a real
   * adapter path are drift).
   */
  readonly registeredAsrProviderIds?: () => readonly string[];
  /** The model-policy preferred ASR provider (the alternative policy choice). */
  readonly preferredAsrProviderId?: () => string | undefined;
}

/** The Desktop local AI surface (the R23-F/G/H/I/J local integration). */
export interface DesktopLocalAiSurface {
  /** The researched open-model catalog with FULL license/provenance truth (R23-J). */
  openModelCatalog(): readonly DesktopOpenModelRowView[];
  /** The packaged local model runtime's typed status (never faked). */
  modelRuntimeStatus(): Promise<DesktopModelRuntimeStatus>;
  /** The runtime's descriptor (what the Desktop packages). */
  modelRuntimeDescriptor(): typeof DESKTOP_MODEL_RUNTIME;
  /**
   * THE LIVE-CAPTION INPUT (R23-G): the legal-audio gate FIRST, then the
   * frozen ASR routing for the workload. The gate's refusal names the
   * boundary honestly — there is no bypass, by design.
   */
  liveCaption(input: {
    readonly audioStreamLegallyAvailable: boolean;
    readonly workload?: AsrWorkloadKind;
  }): DesktopLiveCaptionView;
  /**
   * THE LOCAL-HELPER ROUTE (R23-I, the Desktop shape): the local-desktop
   * hop when the runtime is available; the typed refusal under a
   * local-only policy otherwise; the honest remote fallback when the
   * policy permits cloud. Never a silent hop.
   */
  localHelperRoute(input: {
    readonly task: LocalInferenceTaskKind;
    readonly privacyPolicy: LocalInferencePrivacyPolicy;
  }): Promise<DesktopLocalHelperRoute>;
  /**
   * THE J39 CONSUMPTION: the item's media-intelligence artifacts with
   * honest provenance + the discovery features' typed availability.
   * An invalid artifact set renders the typed `invalid` state — drift is
   * rejected, never coerced.
   */
  mediaIntelligence(itemId: string): DesktopMediaIntelligenceView;
  /**
   * THE MOMENT JUMP (the J39 jump-to-segment step): seek the item's
   * ACTIVE native playback session to the searchable moment's start.
   */
  momentJump(itemId: string, momentId: number): Promise<DesktopMomentJumpOutcome>;
  /** The model-authority boundary's standing note (rendered, machine-checkable). */
  modelAuthorityNote(): string;
}

/** Project the provenance block (one derivation, honest by shape). */
function provenanceViewOf(model: ArtifactModelMetadata): DesktopProvenanceView {
  const sourceProvided = model.modelId === SOURCE_PROVIDED_MODEL_ID;
  return {
    stage: model.stage,
    modelId: model.modelId,
    sourceProvided,
    ...(model.modelRevision !== undefined ? { modelRevision: model.modelRevision } : {}),
    confidence: model.confidence,
    producedAt: model.producedAt,
    sentence: sourceProvided
      ? "This truth arrived with the media itself (an upstream-provided transcript or chapter set) — it was not derived by a WebFlix model."
      : `Derived by ${model.modelId}${
          model.modelRevision !== undefined ? ` (revision ${model.modelRevision})` : ""
        } at ${Math.round(model.confidence * 100)}% confidence.`,
  };
}

/**
 * Project the Desktop local AI surface. Pure projection over the frozen
 * Model Fabric contracts + the probed runtime truth — no SDK clients, no
 * model invocation, no capability claims without a real adapter path.
 */
export function createDesktopLocalAiSurface(options: DesktopLocalAiOptions): DesktopLocalAiSurface {
  const {
    runtime,
    runtimeProbe,
    mediaIntelligenceOf,
    registeredAsrProviderIds,
    preferredAsrProviderId,
  } = options;

  return {
    openModelCatalog(): readonly DesktopOpenModelRowView[] {
      return RESEARCHED_OPEN_MODELS.map(openModelRowView);
    },

    async modelRuntimeStatus(): Promise<DesktopModelRuntimeStatus> {
      return runtimeProbe();
    },

    modelRuntimeDescriptor() {
      return DESKTOP_MODEL_RUNTIME;
    },

    liveCaption(input: {
      readonly audioStreamLegallyAvailable: boolean;
      readonly workload?: AsrWorkloadKind;
    }): DesktopLiveCaptionView {
      // THE LEGAL-AUDIO GATE FIRST (R23-G): the refusal names the
      // boundary — live captions stay off for content whose audio WebFlix
      // may not lawfully process. There is no bypass, by design.
      const readiness = liveAsrReadiness({
        audioStreamLegallyAvailable: input.audioStreamLegallyAvailable,
      });
      if (readiness.kind !== "ready") {
        return {
          readiness,
          route: null,
          envelope: {
            chunkRangeMs: R2T2_CHUNK_RANGE_MS,
            reportedAverageLatencyMs: R2T2_REPORTED_AVERAGE_LATENCY_MS,
            sentence:
              "R2T2 streams in configurable chunks (80 ms to 2 s) with reported average latency around 200-600 ms.",
          },
        };
      }
      // THE FROZEN ROUTING: the registration truth is the caller's own —
      // never a catalog-only capability claim.
      const registered = registeredAsrProviderIds?.() ?? [];
      const preferred = preferredAsrProviderId?.();
      const route = routeAsr({
        workload: input.workload ?? "live-streaming",
        availableProviderIds: registered,
        ...(preferred !== undefined ? { preferredProviderId: preferred } : {}),
      });
      return {
        readiness,
        route,
        envelope: {
          chunkRangeMs: R2T2_CHUNK_RANGE_MS,
          reportedAverageLatencyMs: R2T2_REPORTED_AVERAGE_LATENCY_MS,
          sentence:
            "R2T2 streams in configurable chunks (80 ms to 2 s) with reported average latency around 200-600 ms.",
        },
      };
    },

    async localHelperRoute(input: {
      readonly task: LocalInferenceTaskKind;
      readonly privacyPolicy: LocalInferencePrivacyPolicy;
    }): Promise<DesktopLocalHelperRoute> {
      const status = await runtimeProbe();
      if (status.kind === "available") {
        return {
          kind: "local-desktop",
          privacyImpact: "local-only",
          detail: `This ${input.task.replace(/-/g, " ")} runs in the WebFlix local model runtime (${status.version}) — the model and your input stay on this device.`,
        };
      }
      if (input.privacyPolicy === "local-only") {
        // The R23-I law: the task stays local or stays off — never a
        // silent hop to a remote model.
        return {
          kind: "local-unavailable",
          detail: `The local model runtime is unavailable (${status.reason}), and your local-only privacy policy keeps this ${input.task.replace(/-/g, " ")} from leaving the device — it stays off, honestly.`,
          recovery: status.recoveryHint,
        };
      }
      return {
        kind: "remote-fallback",
        privacyImpact: "input-leaves-device",
        detail: `The local model runtime is unavailable (${status.reason}), so this ${input.task.replace(/-/g, " ")} runs remotely under your ${input.privacyPolicy} policy — the input leaves this device.`,
      };
    },

    mediaIntelligence(itemId: string): DesktopMediaIntelligenceView {
      const artifacts = mediaIntelligenceOf(itemId);
      if (artifacts === null) {
        return {
          itemId,
          status: "not-derived",
          discoveryFeatures: DISCOVERY_FEATURE_CONTRACTS.map((contract) => ({
            kind: contract.kind,
            label: contract.label,
            availability: {
              kind: "prerequisites-missing",
              missing: [...contract.requiredArtifacts],
              detail:
                "This title has no derived intelligence artifacts yet — every feature that needs them stays off honestly rather than approximate.",
            } as DiscoveryFeatureAvailability,
          })),
          notDerivedNote:
            "No transcript, chapters, or searchable moments have been derived for this title yet. Deriving them is an explicit action (Transcribe in the AI tray) — never a silent background claim.",
        };
      }
      const validation = validateMediaIntelligenceArtifacts(artifacts);
      if (!validation.ok) {
        // Drift is rejected, never coerced (the R23-F law).
        return {
          itemId,
          status: "invalid",
          discoveryFeatures: [],
          notDerivedNote: `The derived artifacts for this title failed their shape validation (${validation.problems.length} problem(s)) — they are rejected rather than approximated. Re-derive them from the AI tray.`,
        };
      }
      const availability = discoveryFeatureAvailabilityView(artifacts);
      return {
        itemId,
        status: "derived",
        ...(artifacts.transcript !== undefined
          ? {
              transcript: {
                segments: artifacts.transcript.segments.map((segment) => ({
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  text: segment.text,
                  language: segment.language,
                  ...(segment.speakerLabel !== undefined
                    ? { speakerLabel: segment.speakerLabel }
                    : {}),
                })),
                language: artifacts.transcript.language,
                provenance: provenanceViewOf(artifacts.transcript.model),
              },
            }
          : {}),
        ...(artifacts.chaptersScenes !== undefined
          ? {
              chapters: {
                units: artifacts.chaptersScenes.units.map((unit) => ({
                  kind: unit.kind,
                  startMs: unit.startMs,
                  endMs: unit.endMs,
                  ...(unit.title !== undefined ? { title: unit.title } : {}),
                  ...(unit.summary !== undefined ? { summary: unit.summary } : {}),
                })),
                provenance: provenanceViewOf(artifacts.chaptersScenes.model),
              },
            }
          : {}),
        ...(artifacts.searchableMoments !== undefined
          ? {
              moments: {
                moments: artifacts.searchableMoments.moments.map((moment, id) => ({
                  id,
                  startMs: moment.startMs,
                  endMs: moment.endMs,
                  description: moment.description,
                })),
                provenance: provenanceViewOf(artifacts.searchableMoments.model),
              },
            }
          : {}),
        discoveryFeatures: DISCOVERY_FEATURE_CONTRACTS.map((contract) => ({
          kind: contract.kind,
          label: contract.label,
          availability: availability[contract.kind],
        })),
        notDerivedNote: null,
      };
    },

    async momentJump(itemId: string, momentId: number): Promise<DesktopMomentJumpOutcome> {
      const artifacts = mediaIntelligenceOf(itemId);
      const moments = artifacts?.searchableMoments?.moments ?? [];
      const moment = moments[momentId];
      if (moment === undefined) {
        return {
          kind: "no-active-playback",
          detail: "That moment does not exist for this title — the searchable moments are the honest jump targets.",
        };
      }
      // The item's ACTIVE native playback session (the runtime's own
      // truth — newest first); the jump is a SEEK through the controller.
      const active = runtime.playback
        .active()
        .find((session) => session.itemId === itemId && session.mode === "native");
      if (active === undefined) {
        return {
          kind: "no-active-playback",
          detail:
            "Start playing this title first — the jump moves the active playback to the moment's timestamp.",
        };
      }
      const controller = runtime.playback.controller(active.sessionId);
      if (controller === undefined) {
        return {
          kind: "no-active-playback",
          detail: "The active playback session has no controller — the runtime wiring is incoherent.",
        };
      }
      const seeked = await controller.seek(moment.startMs);
      if (!seeked.ok) {
        return {
          kind: "no-active-playback",
          detail: `The seek to the moment's timestamp failed: ${seeked.detail}`,
        };
      }
      return {
        kind: "jumped",
        playbackSessionId: active.sessionId,
        positionMs: moment.startMs,
      };
    },

    modelAuthorityNote(): string {
      // The machine-checkable boundary, rendered: no model may authorize
      // a playback or acquisition action (checked in Model Fabric).
      if (mayModelAuthorizePlaybackOrAcquisition() !== false) {
        throw new Error(
          "local-ai: the model-authority boundary was violated (a model claimed authorization power) — this is drift, never renderable",
        );
      }
      return "Models generate transcripts, chapters, embeddings, and discovery signals — they never authorize a playback or download. Those decisions stay yours and the platform's.";
    },
  };
}

// ---------------------------------------------------------------------------
// The copy sweep (the license/label laws over this surface's strings)
// ---------------------------------------------------------------------------

/**
 * Gather the surface's user-facing copy strings (the tests' sweep
 * primitives: every catalog row's license notes, the hardware sentences,
 * the runtime status strings, the artifact notes — all must pass the
 * stale-copy sweep and the honest-license rendering laws).
 */
export function localAiCopyStrings(surface: DesktopLocalAiSurface): readonly string[] {
  const strings: string[] = [];
  for (const row of surface.openModelCatalog()) {
    strings.push(row.license.code, row.license.weights, row.license.notes, row.hardwareSentence, row.provenance);
  }
  strings.push(surface.modelAuthorityNote());
  strings.push(DESKTOP_MODEL_RUNTIME.detail);
  return strings;
}
