/**
 * R23-W3 — the local AI surface tests (the R23-J catalog truth, the model
 * runtime packaging law, the R23-G live-caption gate/routing, the R23-I
 * local-helper route, and the J39 artifacts/moment-jump consumption).
 */

import { describe, expect, it } from "bun:test";

import type { MediaIntelligenceArtifacts } from "@wfx/model-fabric";
import { isStaleCompletionCopy } from "@wfx/client-runtime";
import {
  createScriptedModelRuntimeProbe,
  createUnavailableModelRuntimeProbe,
  DESKTOP_MODEL_RUNTIME,
} from "../src/platform/model-runtime";
import { createDesktopLocalAiSurface, localAiCopyStrings } from "../src/surface/local-ai-surface";
import { bootR23, lastNativeSessionId, nativeEvent, R23_ITEM } from "./r23-harness";

// ---------------------------------------------------------------------------
// The scripted runtime probes (the availability truth's two outcomes)
// ---------------------------------------------------------------------------

const AVAILABLE_PROBE = createScriptedModelRuntimeProbe({
  kind: "available",
  version: "wfx-local-rt 1.4.0 (onnxruntime; cpu+cuda)",
  detail: "Local open-model execution is available on this device.",
});

const UNAVAILABLE_PROBE = createUnavailableModelRuntimeProbe();

// ---------------------------------------------------------------------------
// The J39 artifact fixture (the R23-F honest shapes)
// ---------------------------------------------------------------------------

function j39Artifacts(itemId: string): MediaIntelligenceArtifacts {
  return {
    itemId,
    transcript: {
      kind: "transcript",
      segments: [
        { startMs: 0, endMs: 4_000, text: "Welcome to the family archive.", language: "en" },
        { startMs: 4_000, endMs: 9_000, text: "This reel was digitized in 2019.", language: "en", speakerLabel: "Speaker 1" },
      ],
      language: "en",
      model: {
        stage: "transcription",
        modelId: "open-model:moss-transcribe-diarize",
        modelRevision: "research-2026-09-20",
        confidence: 0.94,
        producedAt: "2026-09-21T09:00:00.000Z",
      },
    },
    chaptersScenes: {
      kind: "chapters-scenes",
      units: [
        { kind: "chapter", startMs: 0, endMs: 9_000, title: "Opening", summary: "The archive opens." },
      ],
      model: {
        stage: "structural-analysis",
        modelId: "open-model:qwen25-vl-7b-instruct",
        confidence: 0.88,
        producedAt: "2026-09-21T09:01:00.000Z",
      },
    },
    searchableMoments: {
      kind: "searchable-moments",
      moments: [
        {
          startMs: 4_200,
          endMs: 6_800,
          description: "The digitization date appears on screen",
          matchedText: "digitized in 2019",
          score: 0.91,
        },
        {
          startMs: 0,
          endMs: 3_500,
          description: "The welcome slate",
          score: 0.72,
        },
      ],
      model: {
        stage: "semantic-index",
        modelId: "open-model:bge-m3",
        confidence: 0.9,
        producedAt: "2026-09-21T09:02:00.000Z",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe("R23-W3 local-ai — the open-model catalog (R23-J license/provenance truth)", () => {
  it("renders the researched catalog with the code/weights license distinction", () => {
    const boot = bootR23();
    const rows = boot.localAi.openModelCatalog();
    expect(rows.length).toBeGreaterThanOrEqual(6); // the plan's six candidates
    const r2t2 = rows.find((row) => row.providerId === "open-model:r2t2");
    expect(r2t2).toBeDefined();
    expect(r2t2?.license.code).toBe("Apache-2.0");
    expect(r2t2?.license.weights).toBe("NetEase Model Use License Agreement"); // the REAL terms, verbatim
    expect(r2t2?.license.notes).toContain("never an assumed Apache-licensed dependency");
    expect(r2t2?.revision).toBe("research-2026-09-20");
    expect(r2t2?.hardwareRequirements).toBe("consumer-gpu");
    expect(r2t2?.hardwareSentence).toContain("GPU");
    expect(r2t2?.localDesktopCapable).toBe(true); // local-desktop execution is declared
  });

  it("every row carries non-empty provenance + honest hardware truth", () => {
    const boot = bootR23();
    for (const row of boot.localAi.openModelCatalog()) {
      expect(row.provenance.length).toBeGreaterThan(0);
      expect(row.hardwareSentence.length).toBeGreaterThan(0);
      expect(row.executionLocations.length).toBeGreaterThan(0);
      // License truth binding: every open-model surface carries REAL terms.
      expect(row.license.code.length).toBeGreaterThan(0);
      expect(row.license.weights.length).toBeGreaterThan(0);
    }
    // The catalog-only vs task-routing truth: VideoPrism serves no frozen task.
    const videoprism = boot.localAi.openModelCatalog().find((row) => row.providerId.includes("videoprism"));
    expect(videoprism?.supportedTasks).toEqual([]);
  });

  it("the copy sweep passes (no stale completion copy on any catalog string)", () => {
    const boot = bootR23();
    const copy = localAiCopyStrings(boot.localAi);
    expect(copy.length).toBeGreaterThan(20);
    for (const text of copy) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
  });
});

describe("R23-W3 local-ai — the model runtime packaging (never fake availability)", () => {
  it("the honestly-unavailable probe answers the typed unavailable state with an actionable recovery hint", async () => {
    const boot = bootR23({ runtimeProbe: UNAVAILABLE_PROBE });
    const status = await boot.localAi.modelRuntimeStatus();
    expect(status.kind).toBe("unavailable");
    if (status.kind === "unavailable") {
      expect(status.reason).toContain("not packaged");
      expect(status.recoveryHint).toContain("Install");
      expect(status.recoveryHint).not.toContain("arrives later"); // no stale language
    }
  });

  it("the available probe answers the runtime's own version truth", async () => {
    const boot = bootR23({ runtimeProbe: AVAILABLE_PROBE });
    const status = await boot.localAi.modelRuntimeStatus();
    expect(status.kind).toBe("available");
    if (status.kind === "available") {
      expect(status.version).toContain("wfx-local-rt");
    }
  });

  it("the runtime descriptor names what the Desktop packages (local-desktop execution)", () => {
    const boot = bootR23();
    const descriptor = boot.localAi.modelRuntimeDescriptor();
    expect(descriptor.runtimeId).toBe(DESKTOP_MODEL_RUNTIME.runtimeId);
    expect(descriptor.servesExecutionLocation).toBe("local-desktop");
    expect(descriptor.detail).toContain("stay on this device");
  });
});

describe("R23-W3 local-ai — the R2T2 live-caption gate (R23-G)", () => {
  it("the legal-audio gate REFUSES first when the audio is not legally available (no bypass)", () => {
    const boot = bootR23();
    const view = boot.localAi.liveCaption({ audioStreamLegallyAvailable: false });
    expect(view.readiness.kind).toBe("audio-not-legally-available");
    expect(view.route).toBeNull(); // no route exists behind the refused gate
    if (view.readiness.kind === "audio-not-legally-available") {
      expect(view.readiness.detail).toContain("not available");
      expect(view.readiness.detail).toContain("no bypass");
    }
  });

  it("legal audio + no registered ASR route answers the typed gap with its recovery", () => {
    const boot = bootR23();
    const view = boot.localAi.liveCaption({ audioStreamLegallyAvailable: true });
    expect(view.readiness.kind).toBe("ready");
    expect(view.route?.kind).toBe("no-live-route-registered"); // the honest gap — never a silent substitute
    if (view.route?.kind === "no-live-route-registered") {
      expect(view.route.recovery.length).toBeGreaterThan(0);
    }
  });

  it("legal audio + the registered R2T2 route answers the low-latency decision + the frozen envelope", () => {
    // The registration truth: R2T2 bound to an executor and registered
    // (a catalog row never registered is NOT available — the drift law).
    const boot = bootR23({ runtimeProbe: AVAILABLE_PROBE });
    const surface = createDesktopLocalAiSurface({
      runtime: boot.runtime,
      runtimeProbe: AVAILABLE_PROBE,
      mediaIntelligenceOf: () => null,
      registeredAsrProviderIds: () => ["open-model:r2t2"],
    });
    const view = surface.liveCaption({ audioStreamLegallyAvailable: true });
    expect(view.readiness.kind).toBe("ready");
    expect(view.route?.kind).toBe("r2t2-live-low-latency");
    expect(view.envelope.chunkRangeMs).toEqual({ minMs: 80, maxMs: 2_000 }); // the frozen research facts
    expect(view.envelope.reportedAverageLatencyMs).toEqual({ minMs: 200, maxMs: 600 });
  });

  it("the long-form workload routes to the batch models (MOSS/Whisper — never a fake live substitute)", () => {
    const boot = bootR23();
    const surface = createDesktopLocalAiSurface({
      runtime: boot.runtime,
      runtimeProbe: AVAILABLE_PROBE,
      mediaIntelligenceOf: () => null,
      registeredAsrProviderIds: () => ["open-model:moss-transcribe-diarize"],
    });
    const batch = surface.liveCaption({
      audioStreamLegallyAvailable: true,
      workload: "long-form-batch",
    });
    expect(batch.route?.kind).toBe("batch-model");
  });
});

describe("R23-W3 local-ai — the local-helper route (R23-I, the Desktop shape)", () => {
  it("an available runtime answers the local-desktop hop (nothing leaves the device)", async () => {
    const boot = bootR23({ runtimeProbe: AVAILABLE_PROBE });
    const route = await boot.localAi.localHelperRoute({
      task: "query-embeddings",
      privacyPolicy: "local-only",
    });
    expect(route.kind).toBe("local-desktop");
    if (route.kind === "local-desktop") {
      expect(route.privacyImpact).toBe("local-only");
      expect(route.detail).toContain("stay on this device");
    }
  });

  it("an unavailable runtime + local-only policy answers the typed REFUSAL (never a silent hop)", async () => {
    const boot = bootR23({ runtimeProbe: UNAVAILABLE_PROBE });
    const route = await boot.localAi.localHelperRoute({
      task: "local-media-helpers",
      privacyPolicy: "local-only",
    });
    expect(route.kind).toBe("local-unavailable");
    if (route.kind === "local-unavailable") {
      expect(route.detail).toContain("stays off, honestly");
      expect(route.recovery).toContain("Install"); // the actionable recovery
    }
  });

  it("an unavailable runtime + a cloud-permitting policy answers the honest remote fallback", async () => {
    const boot = bootR23({ runtimeProbe: UNAVAILABLE_PROBE });
    const route = await boot.localAi.localHelperRoute({
      task: "private-preprocessing",
      privacyPolicy: "any-cloud",
    });
    expect(route.kind).toBe("remote-fallback");
    if (route.kind === "remote-fallback") {
      expect(route.privacyImpact).toBe("input-leaves-device"); // the honest impact
    }
  });
});

describe("R23-W3 local-ai — the J39 media-intelligence consumption (the R23-F/H truth)", () => {
  it("nothing derived answers the honest not-derived note (never a stale promise)", () => {
    const boot = bootR23();
    const view = boot.localAi.mediaIntelligence(R23_ITEM);
    expect(view.status).toBe("not-derived");
    expect(view.notDerivedNote).toContain("explicit action");
    expect(view.transcript).toBeUndefined();
    // Every discovery feature answers the prerequisites-missing truth.
    for (const feature of view.discoveryFeatures) {
      expect(feature.availability.kind).toBe("prerequisites-missing");
    }
  });

  it("derived artifacts render with HONEST provenance (model + revision + confidence)", () => {
    const boot = bootR23({ mediaIntelligenceOf: (itemId) => j39Artifacts(itemId) });
    const view = boot.localAi.mediaIntelligence(R23_ITEM);
    expect(view.status).toBe("derived");
    expect(view.transcript?.segments.length).toBe(2);
    expect(view.transcript?.segments[1]?.speakerLabel).toBe("Speaker 1");
    expect(view.transcript?.provenance.modelId).toBe("open-model:moss-transcribe-diarize");
    expect(view.transcript?.provenance.modelRevision).toBe("research-2026-09-20");
    expect(view.transcript?.provenance.sourceProvided).toBe(false);
    expect(view.transcript?.provenance.sentence).toContain("94% confidence");
    expect(view.chapters?.units[0]?.title).toBe("Opening");
    expect(view.moments?.moments.length).toBe(2);
  });

  it("source-provided truth renders as ARRIVED WITH THE MEDIA (never a fabricated model)", () => {
    const artifacts = j39Artifacts(R23_ITEM);
    const sourceProvidedArtifacts: MediaIntelligenceArtifacts = {
      ...artifacts,
      transcript: {
        kind: "transcript",
        segments: [{ startMs: 0, endMs: 1_000, text: "Official captions.", language: "en" }],
        language: "en",
        model: {
          stage: "transcription",
          modelId: "source-provided",
          confidence: 1,
          producedAt: "2026-09-21T08:00:00.000Z",
        },
      },
    };
    const boot = bootR23({ mediaIntelligenceOf: () => sourceProvidedArtifacts });
    const view = boot.localAi.mediaIntelligence(R23_ITEM);
    expect(view.transcript?.provenance.sourceProvided).toBe(true);
    expect(view.transcript?.provenance.sentence).toContain("arrived with the media");
  });

  it("an INVALID artifact set is rejected, never coerced (the drift law)", () => {
    const artifacts = j39Artifacts(R23_ITEM);
    // Corrupt the transcript (empty segments — the honest-shape violation).
    const invalidArtifacts: MediaIntelligenceArtifacts = {
      ...artifacts,
      transcript: {
        kind: "transcript",
        segments: [],
        language: "en",
        model: artifacts.transcript!.model,
      },
    };
    const boot = bootR23({ mediaIntelligenceOf: () => invalidArtifacts });
    const view = boot.localAi.mediaIntelligence(R23_ITEM);
    expect(view.status).toBe("invalid");
    expect(view.notDerivedNote).toContain("failed their shape validation");
  });

  it("the moment jump seeks the ACTIVE native playback to the moment's timestamp", async () => {
    const boot = bootR23({ mediaIntelligenceOf: (itemId) => j39Artifacts(itemId) });
    // No active playback: the honest next step.
    const before = await boot.localAi.momentJump(R23_ITEM, 0);
    expect(before.kind).toBe("no-active-playback");

    // Start the peer-copy playback (the J38 flow), then jump.
    const started = await boot.torrentPlayback.playPeerCopy(R23_ITEM);
    expect(started.kind).toBe("started");
    if (started.kind !== "started") return;
    await started.controller.play();
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 500, 30_000);
    const jump = await boot.localAi.momentJump(R23_ITEM, 0);
    expect(jump.kind).toBe("jumped");
    if (jump.kind === "jumped") {
      expect(jump.positionMs).toBe(4_200); // the moment's own start
      expect(started.controller.state().positionMs).toBe(4_200); // the seek moved the playhead
    }
    // An out-of-range moment id answers the honest absence.
    const missing = await boot.localAi.momentJump(R23_ITEM, 99);
    expect(missing.kind).toBe("no-active-playback");
  });
});

describe("R23-W3 local-ai — the model-authority boundary (rendered + machine-checked)", () => {
  it("the boundary note renders the law (no model authorizes playback or acquisition)", () => {
    const boot = bootR23();
    const note = boot.localAi.modelAuthorityNote();
    expect(note).toContain("never authorize");
    expect(note).toContain("playback or download");
  });
});
