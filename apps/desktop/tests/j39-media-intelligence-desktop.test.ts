/**
 * R23-W3 — the J39 Desktop evidence: multimodal media intelligence (the
 * Desktop extension — the artifacts CONSUMED on the native surface).
 *
 * THE JOURNEY (docs/validation/webflix-golden-journeys.md J39 + the plan's
 * R23-F/G/H/J, the Worker 3 lane): the multimodal artifacts consumed —
 *
 * ```text
 * the open-model catalog truth (license/provenance/hardware, R23-J)
 *   → the model runtime packaging truth (never faked — R23-W3's law)
 *   → the R2T2 live-caption gate (legal audio first — R23-G)
 *   → the item's derived artifacts (transcript/chapters/moments — R23-F)
 *   → the provenance/model truth rendered (source-provided vs derived)
 *   → the discovery features' typed availability (R23-H prerequisites)
 *   → the visual-event query → the searchable moment
 *   → JUMP to the relevant segment (the native playhead moves)
 *   → the local-helper route truth (R23-I, the Desktop shape)
 *   → the model-authority boundary (no model authorizes anything)
 * ```
 *
 * THE EVIDENCE VEHICLE (journeys/desktop/README.md): the REAL R23-W3
 * composition over the deterministic doubles (the J37/J38 harness). The
 * native halves + the real model invocation paths are the lead's
 * real-toolchain procedure (the same honest scoping).
 */

import { describe, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MediaIntelligenceArtifacts } from "@wfx/model-fabric";

import {
  R23_ITEM,
  R23_T0,
  bootR23,
  lastNativeSessionId,
  nativeEvent,
} from "./r23-harness";
import type { R23Boot } from "./r23-harness";
import { createScriptedModelRuntimeProbe } from "../src/platform/model-runtime";

// ---------------------------------------------------------------------------
// The journey log + the assertion recorder (the evidence primitives)
// ---------------------------------------------------------------------------

interface JourneyStep {
  readonly step: string;
  readonly observed: string;
}

const J39_LOG: JourneyStep[] = [];
const J39_ASSERTIONS: { readonly step: string; readonly description: string }[] = [];
const J39_STARTED_AT = new Date().toISOString();

function record(step: string, observed: string): void {
  J39_LOG.push({ step, observed });
}

function ok(step: string, description: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`J39 [${step}] ${description}`);
  }
  J39_ASSERTIONS.push({ step, description });
}

// ---------------------------------------------------------------------------
// The journey's derived artifacts (the R23-F honest shapes)
// ---------------------------------------------------------------------------

function journeyArtifacts(): MediaIntelligenceArtifacts {
  return {
    itemId: R23_ITEM,
    transcript: {
      kind: "transcript",
      segments: [
        { startMs: 0, endMs: 3_800, text: "Welcome to the family archive.", language: "en" },
        { startMs: 3_800, endMs: 8_200, text: "This reel was digitized in 2019.", language: "en", speakerLabel: "Speaker 1" },
        { startMs: 8_200, endMs: 12_000, text: "The digitization date appears on screen.", language: "en", speakerLabel: "Speaker 1" },
      ],
      language: "en",
      model: {
        stage: "transcription",
        modelId: "open-model:moss-transcribe-diarize",
        modelRevision: "research-2026-09-20",
        confidence: 0.93,
        producedAt: new Date(R23_T0).toISOString(),
      },
    },
    chaptersScenes: {
      kind: "chapters-scenes",
      units: [
        { kind: "chapter", startMs: 0, endMs: 8_000, title: "Opening", summary: "The archive opens with a welcome." },
        { kind: "scene", startMs: 8_000, endMs: 12_000, title: "The date slate", summary: "The digitization date is shown." },
      ],
      model: {
        stage: "structural-analysis",
        modelId: "open-model:qwen25-vl-7b-instruct",
        modelRevision: "research-2026-09-20",
        confidence: 0.87,
        producedAt: new Date(R23_T0).toISOString(),
      },
    },
    searchableMoments: {
      kind: "searchable-moments",
      moments: [
        {
          startMs: 8_400,
          endMs: 10_200,
          description: "The digitization date appears on screen",
          matchedText: "digitized in 2019",
          score: 0.92,
        },
        {
          startMs: 0,
          endMs: 3_500,
          description: "The welcome slate",
          score: 0.71,
        },
      ],
      model: {
        stage: "semantic-index",
        modelId: "open-model:bge-m3",
        modelRevision: "research-2026-09-20",
        confidence: 0.9,
        producedAt: new Date(R23_T0).toISOString(),
      },
    },
  };
}

let BOOT: R23Boot | null = null;

/** The boot with the derived artifacts + the AVAILABLE local runtime. */
function boot(): R23Boot {
  if (BOOT === null) {
    BOOT = bootR23({
      runtimeProbe: createScriptedModelRuntimeProbe({
        kind: "available",
        version: "wfx-local-rt 1.4.0 (onnxruntime; cpu+cuda)",
        detail: "Local open-model execution is available on this device.",
      }),
      mediaIntelligenceOf: (itemId) => (itemId === R23_ITEM ? journeyArtifacts() : null),
    });
  }
  return BOOT;
}

// ---------------------------------------------------------------------------
// THE JOURNEY
// ---------------------------------------------------------------------------

describe("R23-W3 — the J39 Desktop journey (multimodal media intelligence consumed)", () => {
  it("J39-M1 — the open-model catalog truth (license/provenance/hardware — R23-J)", () => {
    const rows = boot().localAi.openModelCatalog();
    ok("M1", "the researched catalog renders (the plan's candidates)", rows.length >= 6);
    const r2t2 = rows.find((row) => row.providerId === "open-model:r2t2");
    ok("M1", "the R2T2 row records the REAL license terms", r2t2?.license.code === "Apache-2.0" && r2t2?.license.weights === "NetEase Model Use License Agreement");
    ok("M1", "the row carries the pinned revision + provenance", r2t2?.revision === "research-2026-09-20" && (r2t2?.provenance.length ?? 0) > 0);
    ok("M1", "the hardware truth is honest (consumer GPU)", (r2t2?.hardwareSentence ?? "").includes("GPU"));
    record(
      "M1 catalog truth",
      `rows=${rows.length}; r2t2.license=${r2t2?.license.code} (code) / ${r2t2?.license.weights} (weights); hardware="${r2t2?.hardwareSentence}"`,
    );
  });

  it("J39-M2 — the model runtime packaging truth (available — its own version)", async () => {
    const status = await boot().localAi.modelRuntimeStatus();
    ok("M2", "the runtime probe answers available", status.kind === "available");
    if (status.kind === "available") {
      ok("M2", "the version is the runtime's own truth", status.version.includes("wfx-local-rt"));
    }
    const descriptor = boot().localAi.modelRuntimeDescriptor();
    ok("M2", "the descriptor names the local-desktop execution", descriptor.servesExecutionLocation === "local-desktop");
    record("M2 runtime packaging", `status=${status.kind}; version="${status.kind === "available" ? status.version : ""}"; serves=${descriptor.servesExecutionLocation}`);
  });

  it("J39-M3 — the R2T2 live-caption gate (legal audio FIRST — R23-G)", () => {
    const boot_ = boot();
    const refused = boot_.localAi.liveCaption({ audioStreamLegallyAvailable: false });
    ok("M3", "no legal audio => the typed refusal (no bypass)", refused.readiness.kind === "audio-not-legally-available" && refused.route === null);
    const ready = boot_.localAi.liveCaption({ audioStreamLegallyAvailable: true });
    ok("M3", "legal audio => the gate opens (the routing consulted)", ready.readiness.kind === "ready" && ready.route !== null);
    ok("M3", "the frozen envelope renders (80ms-2s chunks; 200-600ms latency)", ready.envelope.chunkRangeMs.minMs === 80 && ready.envelope.chunkRangeMs.maxMs === 2_000);
    record(
      "M3 live-caption gate",
      `no-legal-audio → ${refused.readiness.kind}; legal-audio → ready, route=${ready.route?.kind}; envelope=80ms-2s / ~200-600ms`,
    );
  });

  it("J39-M4 — the item's derived artifacts render (transcript/chapters/moments — R23-F)", () => {
    const view = boot().localAi.mediaIntelligence(R23_ITEM);
    ok("M4", "the artifacts are derived", view.status === "derived");
    ok("M4", "the transcript carries the timed segments", view.transcript?.segments.length === 3);
    ok("M4", "the speaker labels ride the diarization", view.transcript?.segments[1]?.speakerLabel === "Speaker 1");
    ok("M4", "the chapters carry the structural units", view.chapters?.units.length === 2);
    ok("M4", "the searchable moments carry the descriptions", (view.moments?.moments.length ?? 0) === 2);
    record(
      "M4 artifacts",
      `transcript=${view.transcript?.segments.length} segments (speaker-labeled); chapters=${view.chapters?.units.length}; moments=${view.moments?.moments.length}`,
    );
  });

  it("J39-M5 — the provenance/model truth renders (which model, when, at what confidence)", () => {
    const view = boot().localAi.mediaIntelligence(R23_ITEM);
    const transcriptProvenance = view.transcript?.provenance;
    ok("M5", "the transcript names its model", transcriptProvenance?.modelId === "open-model:moss-transcribe-diarize");
    ok("M5", "the revision pin rides the provenance", transcriptProvenance?.modelRevision === "research-2026-09-20");
    ok("M5", "the confidence renders honestly", (transcriptProvenance?.sentence ?? "").includes("93% confidence"));
    ok("M5", "the source-provided distinction exists in the vocabulary", transcriptProvenance?.sourceProvided === false);
    record(
      "M5 provenance",
      `transcript ← ${transcriptProvenance?.modelId} (${transcriptProvenance?.modelRevision}) @ ${transcriptProvenance?.confidence}; moments ← ${view.moments?.provenance.modelId}`,
    );
  });

  it("J39-M6 — the discovery features answer their typed availability (R23-H prerequisites)", () => {
    const view = boot().localAi.mediaIntelligence(R23_ITEM);
    ok("M6", "every discovery feature answers", view.discoveryFeatures.length === 7);
    const available = view.discoveryFeatures.filter((f) => f.availability.kind === "available");
    const missing = view.discoveryFeatures.filter((f) => f.availability.kind === "prerequisites-missing");
    ok("M6", "some features are available on these artifacts", available.length > 0);
    ok("M6", "the missing prerequisites are NAMED (never approximated)", missing.every((f) => f.availability.kind === "prerequisites-missing" && f.availability.missing.length > 0));
    record(
      "M6 discovery availability",
      `features=7; available=${available.length} (${available.map((f) => f.kind).slice(0, 3).join(", ")}…); prerequisites-missing=${missing.length} (each names what is absent)`,
    );
  });

  it("J39-M7 — the visual-event query → the searchable moment → JUMP to the segment", async () => {
    const boot_ = boot();
    // The item is playing through the peer copy (the J38 flow — the native
    // playhead the jump moves).
    const started = await boot_.whereToWatch.playPeerCopy(R23_ITEM);
    ok("M7", "the playback started (the native playhead exists)", started.kind === "started");
    if (started.kind !== "started") throw new Error("J39 [M7] not started");
    await started.controller.play();
    nativeEvent(boot_.nativeMedia, lastNativeSessionId(boot_.nativeMedia), "playing", 1_000, 30_000);

    // The visual-event query: "the part where the digitization date appears".
    const view = boot_.localAi.mediaIntelligence(R23_ITEM);
    const moment = view.moments?.moments.find((m) => m.description.includes("digitization date"));
    ok("M7", "the moment matches the visual-event query", moment !== undefined);
    // JUMP: the native playhead moves to the moment's timestamp.
    const jump = await boot_.localAi.momentJump(R23_ITEM, moment!.id);
    ok("M7", "the jump executed", jump.kind === "jumped");
    if (jump.kind === "jumped") {
      ok("M7", "the playhead moved to the moment's start", jump.positionMs === 8_400 && started.controller.state().positionMs === 8_400);
    }
    record(
      "M7 moment jump",
      `query "the digitization date appears" → moment@${moment?.startMs}ms (score 0.92) → playhead=${started.controller.state().positionMs}ms`,
    );
  });

  it("J39-M8 — the local-helper route + the model-authority boundary (R23-I + the authority law)", async () => {
    const boot_ = boot();
    const route = await boot_.localAi.localHelperRoute({ task: "query-embeddings", privacyPolicy: "local-only" });
    ok("M8", "the available runtime answers the local-desktop hop", route.kind === "local-desktop" && route.privacyImpact === "local-only");
    const note = boot_.localAi.modelAuthorityNote();
    ok("M8", "the authority boundary renders (no model authorizes anything)", note.includes("never authorize"));
    const impact = route.kind === "local-desktop" || route.kind === "remote-fallback" ? route.privacyImpact : "";
    record(
      "M8 local route + authority",
      `query-embeddings → ${route.kind} (${impact}); authority="${note.slice(0, 60)}…"`,
    );
  });

  it("J39-M9 — the evidence record (the narration integrity + the optional manifest write)", () => {
    const steps = J39_LOG.map((entry) => entry.step);
    const expectedLegs = [
      "M1 catalog truth",
      "M2 runtime packaging",
      "M3 live-caption gate",
      "M4 artifacts",
      "M5 provenance",
      "M6 discovery availability",
      "M7 moment jump",
      "M8 local route + authority",
    ];
    ok("M9", `the narration carries every journey leg (${steps.length} steps)`, JSON.stringify(steps) === JSON.stringify(expectedLegs));
    ok("M9", "the journey recorded real assertions", J39_ASSERTIONS.length > 24);
    record("M9 narration", `${steps.length} steps; ${J39_ASSERTIONS.length} recorded assertions`);

    const evidenceDir = process.env.WFX_J39_EVIDENCE_DIR;
    if (evidenceDir !== undefined && evidenceDir !== "") {
      const commit = process.env.WFX_J39_COMMIT ?? "uncommitted";
      const branch = process.env.WFX_J39_BRANCH ?? "wfx/r23/desktop";
      const finishedAt = new Date().toISOString();
      const narration = [
        "# J39 — the Desktop multimodal media-intelligence narration (machine-generated by apps/desktop/tests/j39-media-intelligence-desktop.test.ts)",
        "",
        `- commit: ${commit}`,
        `- branch: ${branch}`,
        `- window: ${J39_STARTED_AT} → ${finishedAt}`,
        `- assertions recorded: ${J39_ASSERTIONS.length}`,
        "",
        ...J39_LOG.map((entry) => `## ${entry.step}\n${entry.observed}\n`),
      ].join("\n");
      const manifest = {
        schema: "wfx-journey-manifest/1",
        commit,
        branch,
        environment: {
          mode: "desktop-composition-simulator",
          webUrl: "",
          ci: false,
          startedAt: J39_STARTED_AT,
          finishedAt,
          determinism: [
            "the REAL R23-W3 Desktop surface composition (the localAi + whereToWatch + torrentPlayback surfaces over ONE shared runtime)",
            "the R23-F artifact fixture (the honest shapes: transcripts with speaker labels, chapters/scenes, searchable moments — every artifact carrying its provenance block)",
            "the scripted-available model runtime probe (the packaging truth's available branch)",
            "the InMemoryNativeMediaPort (the R10 seam's truthful event pump)",
            "the fixed clock (every stamp is 2026-09-21T10:00:00.000Z)",
          ],
        },
        summary: { total: 1, encoded: 1, passed: 1, failed: 0, notRun: 0 },
        journeys: [
          {
            id: "J39",
            title: "Multimodal Media Intelligence (Desktop — the artifacts consumed)",
            status: "pass",
            reason: null,
            failure: null,
            assertions: J39_ASSERTIONS,
            artifacts: ["j39-desktop-narration.txt", "summary.md"],
            pageErrors: [],
            durationMs: Date.now() - Date.parse(J39_STARTED_AT),
          },
        ],
        limitations: [
          {
            journeyId: "J39",
            kind: "desktop-procedure",
            note: "The REAL model invocation paths (the local runtime executing open models, the semantic search over a live index) and the native webview surfaces cannot execute in this sandbox; the artifacts here are the composition's truth seam feeding the REAL surface projections.",
            procedure:
              "LEAD (journeys/desktop/README.md): run the real Desktop product with a real derived-artifact set and the packaged local model runtime; the truths this run pinned (license/provenance rendering, the runtime packaging truth, the legal-audio gate, the artifact views, the typed feature availability, the moment jump) are the acceptance vocabulary.",
          },
        ],
      };
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "j39-desktop-narration.txt"), narration + "\n");
      writeFileSync(join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      writeFileSync(
        join(evidenceDir, "summary.md"),
        [
          "# WebFlix J39 Desktop Journey Run — Evidence Summary",
          "",
          `- commit: \`${commit}\``,
          `- branch: \`${branch}\``,
          `- environment: desktop-composition-simulator (the J21-J25 doctrine)`,
          `- window: ${J39_STARTED_AT} → ${finishedAt}`,
          "",
          "**1 passed · 0 failed · 0 not-run · 1 total**",
          "",
          `The journey: ${J39_LOG.length} recorded steps, ${J39_ASSERTIONS.length} recorded assertions — see \`j39-desktop-narration.txt\`.`,
          "",
        ].join("\n"),
      );
    }
  });
});
