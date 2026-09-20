/**
 * @wfx/model-fabric — R23-J huggingface-open-model tests.
 *
 * The first-class open-model provider category, at the shared seam:
 * - the descriptor's honest fields (model id, revision, REAL license
 *   with the code/weights distinction, supported tasks, execution
 *   locations, privacy class, cost, latency profile, hardware
 *   requirements, provenance);
 * - THE LICENSE TRUTH LAW: the R2T2 catalog row records EXACTLY the
 *   plan's split (code Apache 2.0; weights NetEase Model Use License
 *   Agreement) — never an assumed Apache-licensed dependency; every
 *   catalog row carries real license terms;
 * - validation: license-less entries, privacy-class incoherence, and
 *   unknown vocabulary are drift (rejected, never coerced);
 * - the researched catalog validates as a whole (the audit);
 * - the NO-SDK law: execution flows ONLY through the injected executor
 *   seam; the registry adapter refuses catalog-only entries and
 *   malformed executors;
 * - the registry adapter produces a truthful RegisteredModelProvider
 *   (capabilities, privacy mapping, declared cost, unsupported-task
 *   refusal, executor failures propagate — never fake success);
 * - THE MODEL-AUTHORITY BOUNDARY: no model may authorize a playback or
 *   acquisition action — total, always false.
 */

import { describe, expect, it } from "bun:test";

import type { ModelTask } from "@wfx/domain";

import {
  BGE_M3_OPEN_MODEL,
  MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL,
  OPEN_MODEL_CATALOG_PROVENANCE,
  OPEN_MODEL_EXECUTION_LOCATIONS,
  OPEN_MODEL_HARDWARE_REQUIREMENTS,
  OPEN_MODEL_LATENCY_PROFILES,
  OPEN_MODEL_PRIVACY_CLASSES,
  R2T2_OPEN_MODEL,
  RESEARCHED_OPEN_MODELS,
  VIDEOPRISM_OPEN_MODEL,
  WHISPER_LARGE_V3_TURBO_OPEN_MODEL,
  createOpenModelProvider,
  isOpenModelExecutorPort,
  isOpenModelLicenseTerms,
  mayModelAuthorizePlaybackOrAcquisition,
  openModelCatalogEntryOf,
  privacyClassOfExecutionLocation,
  validateOpenModelCatalog,
  validateOpenModelDescriptor,
  type OpenModelDescriptor,
  type OpenModelExecutorPort,
} from "../src/index";

/** A minimal valid executor double (records the calls it saw). */
function recordingExecutor(
  implement: (task: ModelTask, input: unknown) => unknown = () => ({}),
): OpenModelExecutorPort & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async execute(task, input, binding) {
      calls.push([task, input, binding.executionLocation]);
      return implement(task, input);
    },
  };
}

// ---------------------------------------------------------------------------
// The vocabularies
// ---------------------------------------------------------------------------

describe("R23-J — the open-model vocabularies", () => {
  it("the execution-location union covers self-hosted, HF endpoint, desktop, browser", () => {
    expect(OPEN_MODEL_EXECUTION_LOCATIONS).toEqual([
      "self-hosted",
      "hf-inference-endpoint",
      "local-desktop",
      "local-browser",
    ]);
  });

  it("the privacy class of an execution location is derived honestly", () => {
    expect(privacyClassOfExecutionLocation("local-desktop")).toBe("local-only");
    expect(privacyClassOfExecutionLocation("local-browser")).toBe("local-only");
    expect(privacyClassOfExecutionLocation("self-hosted")).toBe("remote");
    expect(privacyClassOfExecutionLocation("hf-inference-endpoint")).toBe("remote");
  });

  it("the latency + hardware vocabularies are closed", () => {
    expect(OPEN_MODEL_LATENCY_PROFILES).toContain("low-latency-streaming");
    expect(OPEN_MODEL_LATENCY_PROFILES).toContain("batch");
    expect(OPEN_MODEL_HARDWARE_REQUIREMENTS).toContain("browser-feasible");
    expect(OPEN_MODEL_PRIVACY_CLASSES).toEqual(["local-only", "remote"]);
  });

  it("license terms guard: real terms require code + weights + notes", () => {
    expect(
      isOpenModelLicenseTerms({
        codeLicense: "Apache-2.0",
        weightsLicense: "Apache-2.0",
        notes: "Apache 2.0 — one license for code and weights.",
      }),
    ).toBe(true);
    expect(
      isOpenModelLicenseTerms({ codeLicense: "", weightsLicense: "MIT", notes: "n" }),
    ).toBe(false);
    expect(
      isOpenModelLicenseTerms({ codeLicense: "MIT", weightsLicense: "", notes: "n" }),
    ).toBe(false);
    expect(
      isOpenModelLicenseTerms({ codeLicense: "MIT", weightsLicense: "MIT", notes: "" }),
    ).toBe(false);
    expect(isOpenModelLicenseTerms(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE LICENSE TRUTH LAW (the R2T2 split, recorded exactly)
// ---------------------------------------------------------------------------

describe("R23-J — the license truth law", () => {
  it("the R2T2 row records EXACTLY the plan's code/weights split", () => {
    expect(R2T2_OPEN_MODEL.license.codeLicense).toBe("Apache-2.0");
    expect(R2T2_OPEN_MODEL.license.weightsLicense).toBe(
      "NetEase Model Use License Agreement",
    );
    expect(R2T2_OPEN_MODEL.license.notes).toContain("Apache 2.0");
    expect(R2T2_OPEN_MODEL.license.notes).toContain(
      "NetEase Model Use License Agreement",
    );
    // The plan's exact framing is preserved: never an assumed
    // Apache-licensed dependency.
    expect(R2T2_OPEN_MODEL.license.notes).toContain(
      "never an assumed Apache-licensed dependency",
    );
  });

  it("every catalog row carries REAL license terms (no license-less entries)", () => {
    for (const entry of RESEARCHED_OPEN_MODELS) {
      expect(isOpenModelLicenseTerms(entry.license)).toBe(true);
      expect(entry.license.codeLicense.length).toBeGreaterThan(0);
      expect(entry.license.weightsLicense.length).toBeGreaterThan(0);
    }
    // The plan's per-model license statements:
    expect(VIDEOPRISM_OPEN_MODEL.license.codeLicense).toBe("Apache-2.0");
    expect(VIDEOPRISM_OPEN_MODEL.license.weightsLicense).toBe("Apache-2.0");
    expect(QWEN_VL().license.codeLicense).toBe("Apache-2.0");
    expect(MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL.license.codeLicense).toBe("Apache-2.0");
    expect(WHISPER_LARGE_V3_TURBO_OPEN_MODEL.license.codeLicense).toBe("MIT");
    expect(WHISPER_LARGE_V3_TURBO_OPEN_MODEL.license.weightsLicense).toBe("MIT");
    expect(BGE_M3_OPEN_MODEL.license.codeLicense).toBe("MIT");
  });

  it("every catalog row's provenance names the plan's research findings", () => {
    for (const entry of RESEARCHED_OPEN_MODELS) {
      expect(entry.provenance).toBe(OPEN_MODEL_CATALOG_PROVENANCE);
      expect(entry.provenance).toContain("2026-09-20-webflix-open-viewing-torrent-ai-plan");
    }
  });
});

function QWEN_VL(): OpenModelDescriptor {
  return openModelCatalogEntryOf("open-model:qwen2.5-vl-7b-instruct");
}

// ---------------------------------------------------------------------------
// Descriptor validation
// ---------------------------------------------------------------------------

describe("R23-J — descriptor validation (drift rejected, never coerced)", () => {
  it("a license-less descriptor is drift (the one thing an entry may never lack)", () => {
    const drifted = { ...R2T2_OPEN_MODEL, license: { codeLicense: "", weightsLicense: "", notes: "" } };
    const result = validateOpenModelDescriptor(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.startsWith("license:"))).toBe(true);
    }
  });

  it("a privacy class that disagrees with the execution locations is drift", () => {
    const drifted: OpenModelDescriptor = {
      ...MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL,
      executionLocations: ["local-desktop", "local-browser"],
      privacyClass: "remote",
    };
    const result = validateOpenModelDescriptor(drifted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.startsWith("privacyClass:"))).toBe(true);
    }
    // The coherent version validates.
    const coherent: OpenModelDescriptor = { ...drifted, privacyClass: "local-only" };
    expect(validateOpenModelDescriptor(coherent).ok).toBe(true);
  });

  it("unknown vocabulary and bad cost are drift", () => {
    const badTask = {
      ...R2T2_OPEN_MODEL,
      supportedTasks: ["video-embedding" as ModelTask],
    };
    expect(validateOpenModelDescriptor(badTask).ok).toBe(false);

    const badCost = { ...R2T2_OPEN_MODEL, costPerOperation: -1 };
    const costResult = validateOpenModelDescriptor(badCost);
    expect(costResult.ok).toBe(false);
    if (!costResult.ok) {
      expect(costResult.problems.some((p) => p.startsWith("costPerOperation:"))).toBe(
        true,
      );
    }

    const noLocations = { ...R2T2_OPEN_MODEL, executionLocations: [] };
    const locResult = validateOpenModelDescriptor(noLocations);
    expect(locResult.ok).toBe(false);
    if (!locResult.ok) {
      expect(
        locResult.problems.some((p) => p.startsWith("executionLocations:")),
      ).toBe(true);
    }

    const noProvenance = { ...R2T2_OPEN_MODEL, provenance: "" };
    expect(validateOpenModelDescriptor(noProvenance).ok).toBe(false);
  });

  it("the whole catalog passes the audit", () => {
    const audit = validateOpenModelCatalog();
    expect(audit.ok).toBe(true);
    if (audit.ok) {
      expect(audit.entries).toHaveLength(6);
    }
  });
});

// ---------------------------------------------------------------------------
// The catalog facts
// ---------------------------------------------------------------------------

describe("R23-J — the researched catalog", () => {
  it("carries the plan's six candidates with honest routing truth", () => {
    expect(RESEARCHED_OPEN_MODELS.map((entry) => entry.providerId)).toEqual([
      "open-model:r2t2",
      "open-model:moss-transcribe-diarize",
      "open-model:whisper-large-v3-turbo",
      "open-model:qwen2.5-vl-7b-instruct",
      "open-model:videoprism-base-f16r288",
      "open-model:bge-m3",
    ]);
    // R2T2 serves the frozen speech tasks and the streaming capability.
    expect(R2T2_OPEN_MODEL.supportedTasks).toEqual(["speechToText", "transcription"]);
    expect(R2T2_OPEN_MODEL.intelligenceCapabilities).toEqual(["streaming-asr"]);
    expect(R2T2_OPEN_MODEL.latencyProfile).toBe("low-latency-streaming");
    // VideoPrism and BGE-M3 are catalog-only (no frozen task routing).
    expect(VIDEOPRISM_OPEN_MODEL.supportedTasks).toEqual([]);
    expect(BGE_M3_OPEN_MODEL.supportedTasks).toEqual([]);
    // BGE-M3 carries the local-browser execution location (the R23-I lane).
    expect(BGE_M3_OPEN_MODEL.executionLocations).toContain("local-browser");
  });

  it("openModelCatalogEntryOf throws on unknown ids (never a guess)", () => {
    expect(() => openModelCatalogEntryOf("open-model:not-researched")).toThrow(
      /never a guess/,
    );
  });
});

// ---------------------------------------------------------------------------
// The no-SDK law: the executor seam + the registry adapter
// ---------------------------------------------------------------------------

describe("R23-J — the executor seam and registry adapter (the no-SDK law)", () => {
  it("the executor seam is structural (an execute function)", () => {
    expect(isOpenModelExecutorPort(recordingExecutor())).toBe(true);
    expect(isOpenModelExecutorPort({})).toBe(false);
    expect(isOpenModelExecutorPort(null)).toBe(false);
    expect(isOpenModelExecutorPort({ execute: "not-a-function" })).toBe(false);
  });

  it("the registry adapter refuses catalog-only entries (no frozen task routing)", () => {
    expect(() =>
      createOpenModelProvider({
        descriptor: VIDEOPRISM_OPEN_MODEL,
        executor: recordingExecutor(),
      }),
    ).toThrow(/catalog-only/);
  });

  it("the registry adapter refuses malformed descriptors and executors", () => {
    expect(() =>
      createOpenModelProvider({
        descriptor: { ...R2T2_OPEN_MODEL, revision: "" },
        executor: recordingExecutor(),
      }),
    ).toThrow(/invalid open-model descriptor/);
    expect(() =>
      createOpenModelProvider({
        descriptor: R2T2_OPEN_MODEL,
        executor: {} as OpenModelExecutorPort,
      }),
    ).toThrow(/OpenModelExecutorPort/);
  });

  it("the adapter produces a truthful RegisteredModelProvider", async () => {
    const executor = recordingExecutor(() => ({ segments: [] }));
    const provider = createOpenModelProvider({
      descriptor: R2T2_OPEN_MODEL,
      executor,
    });
    expect(provider.id).toBe("open-model:r2t2");
    expect(provider.privacy).toBe("cloud"); // remote execution locations => cloud in the WFX-030 vocabulary
    expect(provider.capabilities).toEqual(["speechToText", "transcription"]);
    expect(provider.costPerOperation("speechToText")).toBe(0);
    expect(provider.costPerOperation("ranking")).toBeUndefined();

    const output = await provider.invoke("speechToText", { audio: "chunk" });
    expect(output).toEqual({ segments: [] });
    // The executor actually ran, with the resolved binding.
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]).toEqual([
      "speechToText",
      { audio: "chunk" },
      "self-hosted", // the first declared execution location (deterministic default binding)
    ]);
  });

  it("unsupported tasks are typed refusals — never silent success", async () => {
    const provider = createOpenModelProvider({
      descriptor: R2T2_OPEN_MODEL,
      executor: recordingExecutor(),
    });
    await expect(provider.invoke("ranking", {})).rejects.toThrow(
      /does not serve task 'ranking'/,
    );
  });

  it("executor failures propagate — never fake success", async () => {
    const provider = createOpenModelProvider({
      descriptor: R2T2_OPEN_MODEL,
      executor: {
        execute: () => {
          throw new Error("endpoint unreachable");
        },
      },
    });
    await expect(provider.invoke("transcription", {})).rejects.toThrow(
      /endpoint unreachable/,
    );
  });

  it("a local-only descriptor maps to the local registry privacy", async () => {
    const localDescriptor: OpenModelDescriptor = {
      ...MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL,
      providerId: "open-model:moss-local",
      executionLocations: ["local-desktop"],
      privacyClass: "local-only",
    };
    const provider = createOpenModelProvider({
      descriptor: localDescriptor,
      executor: recordingExecutor(() => null),
    });
    expect(provider.privacy).toBe("local");
    const output = await provider.invoke("transcription", {});
    expect(output).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The model-authority boundary
// ---------------------------------------------------------------------------

describe("R23-J — the model-authority boundary (frozen law)", () => {
  it("NO model may authorize a playback or acquisition action — always false", () => {
    expect(mayModelAuthorizePlaybackOrAcquisition()).toBe(false);
    expect(mayModelAuthorizePlaybackOrAcquisition()).toBe(false);
    // Total over every model family in the catalog:
    for (const entry of RESEARCHED_OPEN_MODELS) {
      expect(mayModelAuthorizePlaybackOrAcquisition()).toBe(false);
      expect(entry.providerId.length).toBeGreaterThan(0); // every row consulted
    }
  });
});
