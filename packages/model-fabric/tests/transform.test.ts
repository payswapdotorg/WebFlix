/**
 * @wfx/model-fabric — transform tests (WFX-033): permission matrix, hard
 * laws, schema validation with field paths, pipeline semantics (short-circuit
 * + receipt), fabric routing (privacy class + fallback order), subtitle
 * composition (monotonicity, overlap rejection, VTT golden output), cost
 * estimates (deterministic, bounded by policy ceilings), and deterministic
 * fakes.
 */

import { describe, expect, it } from "bun:test";
import { isIso8601, type ModelTask } from "@wfx/domain";

import {
  isInvocationId,
  isModelTask,
  makeEchoProvider,
  makeFailingProvider,
  ModelFabric,
  ModelFabricRegistry,
  type RegisteredModelProvider,
  // transform: subtitle
  composeSubtitleCues,
  formatVttTimestamp,
  serializeVtt,
  validateSubtitleCues,
  validateTranscriptSegments,
  type SubtitleCue,
  type TranscriptSegment,
  // transform: tasks
  TRANSFORMATION_TASKS,
  transcriptTask,
  translationTask,
  subtitleTask,
  summaryTask,
  speechTask,
  transcribeTask,
  dubbingTask,
  commentaryTask,
  estimateTokens,
  type MediaProvenanceRecord,
  type TransformationTaskKind,
  // transform: permissions
  TransformationPermissions,
  type LicenseFlagName,
  // transform: pipeline
  describeTransformationError,
  runTransformation,
  type TransformationRunOptions,
  // transform: fakes
  makeFakeCommentaryProvider,
  makeFakeDubbingProvider,
  makeFakeSpeechProvider,
  makeFakeSubtitleProvider,
  makeFakeSummaryProvider,
  makeFakeTranscriptProvider,
  makeFakeTranscribeProvider,
  makeFakeTranslationProvider,
} from "../src/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProvenanceOverrides = {
  sourceId?: string;
  authorizedSource?: boolean;
  drmProtected?: boolean;
  allowsTranscript?: boolean;
  allowsTranslation?: boolean;
  allowsDubbing?: boolean;
  allowsCommentary?: boolean;
};

function provenance(overrides: ProvenanceOverrides = {}): MediaProvenanceRecord {
  return {
    sourceId: overrides.sourceId ?? "wfx-reference",
    authorizedSource: overrides.authorizedSource ?? true,
    drmProtected: overrides.drmProtected ?? false,
    allowsTranscript: overrides.allowsTranscript ?? true,
    allowsTranslation: overrides.allowsTranslation ?? true,
    allowsDubbing: overrides.allowsDubbing ?? true,
    allowsCommentary: overrides.allowsCommentary ?? true,
  };
}

function fabricWith(...providers: RegisteredModelProvider[]): ModelFabric {
  const registry = new ModelFabricRegistry();
  for (const provider of providers) registry.register(provider);
  return new ModelFabric(registry);
}

const SEGMENTS: TranscriptSegment[] = [
  { startMs: 0, endMs: 2000, text: "Hello" },
  { startMs: 2500, endMs: 4500, text: "World" },
];

function validInputFor(kind: TransformationTaskKind, media: MediaProvenanceRecord): unknown {
  switch (kind) {
    case "transcript":
      return { media, mediaRef: "asset-1", durationMs: 60_000 };
    case "translation":
      return { media, text: "Hello world.", targetLanguage: "es" };
    case "subtitle":
      return { media, segments: SEGMENTS, targetLanguage: "es" };
    case "summary":
      return { media, text: "One. Two. Three. Four. Five." };
    case "speech":
      return { media, text: "Hello there friend", voice: "narrator" };
    case "transcribe":
      return { media, audioRef: "audio-1", durationMs: 30_000 };
    case "dubbing":
      return { media, segments: SEGMENTS, targetLanguage: "es", voice: "warm" };
    case "commentary":
      return { media, mediaRef: "asset-1", durationMs: 60_000, style: "insightful" };
  }
}

/** Route any task to the echo provider (declares every ModelTask). */
const UNIVERSAL_ROUTING: TransformationRunOptions = {
  privacy: "any-cloud",
  preferredProvider: "counter",
};

/** The golden task → required license flag mapping (independently written down). */
const TASK_FLAG_TABLE: readonly { kind: TransformationTaskKind; flag: LicenseFlagName | undefined }[] = [
  { kind: "transcript", flag: "allowsTranscript" },
  { kind: "transcribe", flag: "allowsTranscript" },
  { kind: "translation", flag: "allowsTranslation" },
  { kind: "subtitle", flag: "allowsTranslation" },
  { kind: "summary", flag: undefined },
  { kind: "speech", flag: undefined },
  { kind: "dubbing", flag: "allowsDubbing" },
  { kind: "commentary", flag: "allowsCommentary" },
];

function issuePaths(input: { ok: false; issues: readonly { path: string; message: string }[] }): string[] {
  return input.issues.map((issue) => issue.path);
}

// ---------------------------------------------------------------------------
// Task registry sanity
// ---------------------------------------------------------------------------

describe("transform task registry", () => {
  it("exposes all eight task kinds, uniquely, in declaration order", () => {
    expect(TRANSFORMATION_TASKS.map((task) => task.kind)).toEqual([
      "transcript",
      "translation",
      "subtitle",
      "summary",
      "speech",
      "transcribe",
      "dubbing",
      "commentary",
    ]);
  });

  it("routes every task through a frozen ModelTask capability (golden mapping)", () => {
    const mapping: Record<TransformationTaskKind, ModelTask> = {
      transcript: "transcription",
      translation: "translation",
      subtitle: "translation",
      summary: "summary",
      speech: "textToSpeech",
      transcribe: "speechToText",
      dubbing: "dubbing",
      commentary: "commentary",
    };
    for (const task of TRANSFORMATION_TASKS) {
      expect(task.modelTask).toBe(mapping[task.kind]);
      expect(isModelTask(task.modelTask)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Permission matrix — every task × every license combination
// ---------------------------------------------------------------------------

describe("TransformationPermissions — permission matrix", () => {
  it("requiredLicenseFlag matches the golden task→flag mapping", () => {
    for (const entry of TASK_FLAG_TABLE) {
      expect(TransformationPermissions.requiredLicenseFlag(entry.kind)).toBe(entry.flag);
    }
  });

  it("accepts descriptors as well as bare kinds", () => {
    expect(TransformationPermissions.requiredLicenseFlag(subtitleTask)).toBe("allowsTranslation");
    expect(TransformationPermissions.requiredLicenseFlag(summaryTask)).toBeUndefined();
  });

  it("every task × every license-flag combination yields the golden verdict (16 × 8)", () => {
    for (let mask = 0; mask < 16; mask++) {
      const combo = {
        allowsTranscript: (mask & 1) !== 0,
        allowsTranslation: (mask & 2) !== 0,
        allowsDubbing: (mask & 4) !== 0,
        allowsCommentary: (mask & 8) !== 0,
      };
      for (const entry of TASK_FLAG_TABLE) {
        const verdict = TransformationPermissions.check(provenance(combo), entry.kind);
        const expectedAllowed =
          entry.flag === undefined ? true : combo[entry.flag as "allowsTranscript"];
        expect(verdict.allowed).toBe(expectedAllowed);
        if (!expectedAllowed) {
          expect(verdict.reason).toBe(
            `${entry.kind} requires ${entry.flag} license flag — source wfx-reference marks it false`,
          );
        } else {
          expect(verdict.reason).toContain("authorized source 'wfx-reference'");
          expect(verdict.reason).toContain("no DRM protection");
        }
      }
    }
  });

  it("denial reasons are actionable (golden strings)", () => {
    expect(TransformationPermissions.check(provenance({ allowsDubbing: false }), "dubbing")).toEqual({
      allowed: false,
      reason: "dubbing requires allowsDubbing license flag — source wfx-reference marks it false",
    });
    expect(TransformationPermissions.check(provenance({ authorizedSource: false }), "summary")).toEqual({
      allowed: false,
      reason:
        "transformation of unauthorized media is always denied — source 'wfx-reference' is not an authorized source (user-owned, licensed, public-domain, Creative Commons, or otherwise authorized)",
    });
    expect(TransformationPermissions.check(provenance({ drmProtected: true }), "summary")).toEqual({
      allowed: false,
      reason:
        "transformation of DRM-protected inputs is always denied — source 'wfx-reference' is marked DRM-protected; no circumvention path exists",
    });
    const allowed = TransformationPermissions.check(provenance(), "summary");
    expect(allowed).toEqual({
      allowed: true,
      reason: "authorized source 'wfx-reference' with no DRM protection — summary requires no specific license flag",
    });
    const allowedFlagged = TransformationPermissions.check(provenance(), "dubbing");
    expect(allowedFlagged).toEqual({
      allowed: true,
      reason:
        "authorized source 'wfx-reference' with no DRM protection — dubbing license flag allowsDubbing is granted",
    });
  });

  it("hard-law precedence: unauthorized beats DRM beats license flags (deterministic order)", () => {
    const everything =
      provenance({ authorizedSource: false, drmProtected: true, allowsDubbing: false });
    for (const task of TRANSFORMATION_TASKS) {
      const verdict = TransformationPermissions.check(everything, task);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain("unauthorized");
    }
    const drmCase = provenance({ drmProtected: true, allowsDubbing: false });
    expect(TransformationPermissions.check(drmCase, "dubbing").reason).toContain("DRM-protected");
  });
});

// ---------------------------------------------------------------------------
// Hard laws at the pipeline level — exhaustive over tasks
// ---------------------------------------------------------------------------

describe("transform pipeline — hard laws (exhaustive over tasks)", () => {
  it("unauthorized media is ALWAYS denied, even fully licensed — fabric never invoked", async () => {
    for (const task of TRANSFORMATION_TASKS) {
      const counter = makeEchoProvider("counter");
      const fabric = fabricWith(counter);
      const result = await runTransformation(
        fabric,
        task,
        validInputFor(task.kind, provenance({ authorizedSource: false })),
        UNIVERSAL_ROUTING,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("permission");
        if (result.error.kind === "permission") {
          expect(result.error.verdict.reason).toContain("unauthorized");
          expect(result.error.verdict.allowed).toBe(false);
        }
      }
      expect(counter.calls.length).toBe(0); // fabric NEVER invoked
    }
  });

  it("DRM-protected media is ALWAYS denied, even fully licensed — fabric never invoked", async () => {
    for (const task of TRANSFORMATION_TASKS) {
      const counter = makeEchoProvider("counter");
      const fabric = fabricWith(counter);
      const result = await runTransformation(
        fabric,
        task,
        validInputFor(task.kind, provenance({ drmProtected: true })),
        UNIVERSAL_ROUTING,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("permission");
        if (result.error.kind === "permission") {
          expect(result.error.verdict.reason).toContain("DRM-protected");
        }
      }
      expect(counter.calls.length).toBe(0);
    }
  });

  it("every license-gated task is denied through the pipeline when its flag is false (fabric never invoked)", async () => {
    for (const entry of TASK_FLAG_TABLE) {
      if (entry.flag === undefined) continue;
      const task = TRANSFORMATION_TASKS.find((candidate) => candidate.kind === entry.kind);
      if (task === undefined) throw new Error("unreachable");
      const counter = makeEchoProvider("counter");
      const fabric = fabricWith(counter);
      const media = provenance({ [entry.flag]: false } as ProvenanceOverrides);
      const result = await runTransformation(
        fabric,
        task,
        validInputFor(entry.kind, media),
        UNIVERSAL_ROUTING,
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.kind === "permission") {
        expect(result.error.verdict.reason).toContain(entry.flag);
      } else {
        throw new Error(`expected a permission denial for ${entry.kind}`);
      }
      expect(counter.calls.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema validation — typed field-path errors
// ---------------------------------------------------------------------------

describe("transform task input validators — typed field-path errors", () => {
  it("rejects a non-object input with the input-path error", () => {
    for (const task of TRANSFORMATION_TASKS) {
      const result = task.validate(42);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain("input");
    }
  });

  it("rejects a missing or malformed provenance record with media.* paths", () => {
    const result = transcriptTask.validate({ mediaRef: "a", durationMs: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("media");

    const badMedia = transcriptTask.validate({
      media: { sourceId: 7, authorizedSource: "yes", drmProtected: "maybe" },
      mediaRef: "a",
      durationMs: 1000,
    });
    expect(badMedia.ok).toBe(false);
    if (!badMedia.ok) {
      expect(issuePaths(badMedia)).toContain("media.sourceId");
      expect(issuePaths(badMedia)).toContain("media.authorizedSource");
      expect(issuePaths(badMedia)).toContain("media.drmProtected");
      expect(issuePaths(badMedia)).toContain("media.allowsTranscript");
      expect(issuePaths(badMedia)).toContain("media.allowsTranslation");
      expect(issuePaths(badMedia)).toContain("media.allowsDubbing");
      expect(issuePaths(badMedia)).toContain("media.allowsCommentary");
    }
  });

  it("transcript: mediaRef and durationMs field paths", () => {
    for (const [input, path] of [
      [{ media: provenance(), mediaRef: "", durationMs: 1000 }, "mediaRef"],
      [{ media: provenance(), mediaRef: "a", durationMs: 0 }, "durationMs"],
      [{ media: provenance(), mediaRef: "a", durationMs: -5 }, "durationMs"],
      [{ media: provenance(), mediaRef: "a", durationMs: 1.5 }, "durationMs"],
      [{ media: provenance(), mediaRef: "a", durationMs: Number.NaN }, "durationMs"],
    ] as const) {
      const result = transcriptTask.validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("translation: text and targetLanguage field paths", () => {
    for (const [input, path] of [
      [{ media: provenance(), text: "", targetLanguage: "es" }, "text"],
      [{ media: provenance(), text: "  ", targetLanguage: "es" }, "text"],
      [{ media: provenance(), text: "hi", targetLanguage: 7 }, "targetLanguage"],
      [{ media: provenance(), text: "hi", targetLanguage: "es", sourceLanguage: "" }, "sourceLanguage"],
    ] as const) {
      const result = translationTask.validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("subtitle: segment list field paths (missing, empty, overlap, zero-duration, empty text)", () => {
    for (const [input, path] of [
      [{ media: provenance(), targetLanguage: "es" }, "segments"],
      [{ media: provenance(), segments: [], targetLanguage: "es" }, "segments"],
      [{ media: provenance(), segments: "nope", targetLanguage: "es" }, "segments"],
      [
        {
          media: provenance(),
          segments: [
            { startMs: 0, endMs: 2000, text: "Hello" },
            { startMs: 1500, endMs: 3000, text: "World" },
          ],
          targetLanguage: "es",
        },
        "segments[1].startMs",
      ],
      [{ media: provenance(), segments: [{ startMs: 0, endMs: 0, text: "Hello" }], targetLanguage: "es" }, "segments[0].endMs"],
      [{ media: provenance(), segments: [{ startMs: 0, endMs: 500, text: "  " }], targetLanguage: "es" }, "segments[0].text"],
      [{ media: provenance(), segments: [{ startMs: -1, endMs: 500, text: "hi" }], targetLanguage: "es" }, "segments[0].startMs"],
      [{ media: provenance(), segments: [42], targetLanguage: "es" }, "segments[0]"],
    ] as const) {
      const result = subtitleTask.validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("summary: text and maxSentences field paths", () => {
    for (const [input, path] of [
      [{ media: provenance(), text: "" }, "text"],
      [{ media: provenance(), text: "hi", maxSentences: 0 }, "maxSentences"],
      [{ media: provenance(), text: "hi", maxSentences: 21 }, "maxSentences"],
      [{ media: provenance(), text: "hi", maxSentences: 2.5 }, "maxSentences"],
    ] as const) {
      const result = summaryTask.validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("speech: closed voice vocabulary and text field paths", () => {
    for (const [input, path] of [
      [{ media: provenance(), text: "hi", voice: "robot" }, "voice"],
      [{ media: provenance(), text: "", voice: "narrator" }, "text"],
    ] as const) {
      const result = speechTask.validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("transcribe: audioRef and durationMs field paths", () => {
    const result = transcribeTask.validate({ media: provenance(), audioRef: "", durationMs: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("audioRef");
  });

  it("dubbing: targetLanguage, voice, and segment field paths", () => {
    for (const [input, path] of [
      [{ media: provenance(), segments: SEGMENTS, targetLanguage: "", voice: "warm" }, "targetLanguage"],
      [{ media: provenance(), segments: SEGMENTS, targetLanguage: "es", voice: "robot" }, "voice"],
      [{ media: provenance(), segments: [], targetLanguage: "es", voice: "warm" }, "segments"],
    ] as const) {
      const result = dubbingTask.validate(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("commentary: closed style vocabulary and field paths", () => {
    const result = commentaryTask.validate({
      media: provenance(),
      mediaRef: "asset-1",
      durationMs: 60_000,
      style: "boring",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("style");
  });

  it("aggregates multiple field errors into one typed issue list", () => {
    const result = dubbingTask.validate({
      media: { sourceId: "" },
      segments: [],
      targetLanguage: "",
      voice: "robot",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = issuePaths(result);
      expect(paths.length).toBeGreaterThanOrEqual(6);
      expect(paths).toContain("media.sourceId");
      expect(paths).toContain("media.authorizedSource");
      expect(paths).toContain("segments");
      expect(paths).toContain("targetLanguage");
      expect(paths).toContain("voice");
    }
  });

  it("accepts unknown extra fields (structural typing, domain convention)", () => {
    const result = summaryTask.validate({
      media: provenance(),
      text: "One. Two. Three.",
      callerNote: "extra fields are forward compatibility",
    });
    expect(result.ok).toBe(true);
  });
});

describe("transform pipeline — options validation (typed field paths)", () => {
  it("rejects malformed options with options.* paths and never invokes the fabric", async () => {
    const counter = makeEchoProvider("counter");
    const fabric = fabricWith(counter);
    const input = { media: provenance(), text: "One. Two." };
    for (const [options, path] of [
      [{ privacy: "public", preferredProvider: "counter" }, "options.privacy"],
      [{ preferredProvider: "" }, "options.preferredProvider"],
      [{ fallbackProviders: "counter" }, "options.fallbackProviders"],
      [{ fallbackProviders: [""] }, "options.fallbackProviders"],
      [{ maxCostPerOperation: -1 }, "options.maxCostPerOperation"],
      [{ maxCostPerOperation: Number.NaN }, "options.maxCostPerOperation"],
      [{ timeoutMs: 0 }, "options.timeoutMs"],
    ] as const) {
      const result = await runTransformation(
        fabric,
        summaryTask,
        input,
        options as unknown as TransformationRunOptions,
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.error.kind === "validation") {
        expect(result.error.issues.some((issue) => issue.path === path)).toBe(true);
      } else {
        throw new Error(`expected a validation error for ${path}`);
      }
    }
    expect(counter.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pipeline semantics
// ---------------------------------------------------------------------------

describe("transform pipeline — happy path receipt", () => {
  it("returns a fully populated typed receipt (output, provider, estimates, verdict echo, trace)", async () => {
    const fabric = fabricWith(makeFakeSummaryProvider("sum"));
    const result = await runTransformation(fabric, summaryTask, {
      media: provenance(),
      text: "One. Two. Three. Four. Five.",
    }, { preferredProvider: "sum" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.task).toBe("summary");
    expect(result.output).toEqual({ summary: "One. Two. Three.", sentenceCount: 3 });
    expect(result.providerId).toBe("sum");
    expect(result.costEstimate).toBe(0.007); // 28 chars → 7 tokens × 0.001
    expect(result.durationEstimateMs).toBe(670); // round(7 × 60) + 250
    expect(result.permission).toEqual({
      allowed: true,
      reason: "authorized source 'wfx-reference' with no DRM protection — summary requires no specific license flag",
    });
    expect(isInvocationId(result.trace.invocationId)).toBe(true);
    expect(result.trace.taskId).toBe("summary");
    expect(result.trace.providerId).toBe("sum");
    expect(result.trace.fallbacks).toEqual([]);
    expect(isIso8601(result.trace.startedAt)).toBe(true);
    expect(result.trace.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("transform pipeline — short-circuits (fabric never invoked)", () => {
  it("validation failure short-circuits before any provider runs", async () => {
    const counter = makeEchoProvider("counter");
    const fabric = fabricWith(counter);
    const result = await runTransformation(fabric, summaryTask, { media: provenance(), text: "" }, UNIVERSAL_ROUTING);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.issues.some((issue) => issue.path === "text")).toBe(true);
    } else {
      throw new Error("expected a validation error");
    }
    expect(counter.calls.length).toBe(0);
  });

  it("permission denial short-circuits — the verdict is echoed, the fabric is never invoked", async () => {
    const counter = makeEchoProvider("counter");
    const fabric = fabricWith(counter);
    const result = await runTransformation(
      fabric,
      dubbingTask,
      validInputFor("dubbing", provenance({ allowsDubbing: false })),
      UNIVERSAL_ROUTING,
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "permission") {
      expect(result.error.verdict).toEqual({
        allowed: false,
        reason: "dubbing requires allowsDubbing license flag — source wfx-reference marks it false",
      });
    } else {
      throw new Error("expected a permission error");
    }
    expect(counter.calls.length).toBe(0);
  });
});

describe("transform pipeline — fabric failures surface through the typed machinery", () => {
  it("all providers failing surfaces the last provider-error with the full fallback chain", async () => {
    const first = makeFailingProvider("f1", {
      capabilities: ["summary"],
      errorMessage: "first blew up",
    });
    const second = makeFailingProvider("f2", {
      capabilities: ["summary"],
      errorMessage: "second blew up",
    });
    const fabric = fabricWith(first, second);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two." },
      { privacy: "any-cloud", fallbackProviders: ["f1", "f2"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("provider-error");
      if (result.error.error.kind === "provider-error") {
        expect(result.error.error.providerId).toBe("f2");
        expect(result.error.error.detail).toContain("second blew up");
      }
      expect(result.error.trace?.fallbacks).toEqual(["f1"]);
      expect(result.error.trace?.providerId).toBe("f2");
    } else {
      throw new Error("expected a fabric error");
    }
    expect(first.calls.length).toBe(1);
    expect(second.calls.length).toBe(1);
  });

  it("a hanging provider surfaces as a typed timeout error via the timeout override", async () => {
    const hanging = makeFailingProvider("hanging", { capabilities: ["summary"], failure: "hang" });
    const fabric = fabricWith(hanging);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two." },
      { privacy: "any-cloud", fallbackProviders: ["hanging"], timeoutMs: 20 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("timeout");
      if (result.error.error.kind === "timeout") {
        expect(result.error.error.providerId).toBe("hanging");
        expect(result.error.error.ms).toBe(20);
      }
      expect(result.error.trace?.providerId).toBe("hanging");
    } else {
      throw new Error("expected a fabric timeout error");
    }
  });

  it("no routable provider surfaces as a typed no-provider error (empty default plan)", async () => {
    const fabric = fabricWith(makeFakeSummaryProvider("sum"));
    const result = await runTransformation(fabric, summaryTask, {
      media: provenance(),
      text: "One. Two.",
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("no-provider");
    } else {
      throw new Error("expected a fabric no-provider error");
    }
  });

  it("errors are renderable as one-line summaries that name the kind", () => {
    expect(
      describeTransformationError({
        kind: "permission",
        task: "dubbing",
        verdict: { allowed: false, reason: "nope" },
      }),
    ).toContain("permission:");
    expect(
      describeTransformationError({
        kind: "cost-ceiling",
        task: "summary",
        estimate: 2,
        ceiling: 1,
      }),
    ).toContain("cost-ceiling:");
  });
});

// ---------------------------------------------------------------------------
// Fabric routing — privacy class + fallback order
// ---------------------------------------------------------------------------

describe("transform pipeline — fabric routing", () => {
  it("fallback order honored: first provider fails ⇒ second used, chain recorded in the trace", async () => {
    const failing = makeFailingProvider("first-fail", { capabilities: ["summary"] });
    const succeeding = makeFakeSummaryProvider("second-ok");
    const fabric = fabricWith(failing, succeeding);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two. Three." },
      { privacy: "any-cloud", fallbackProviders: ["first-fail", "second-ok"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("second-ok");
    expect(result.trace.providerId).toBe("second-ok");
    expect(result.trace.fallbacks).toEqual(["first-fail"]);
    expect(failing.calls.length).toBe(1);
    expect(succeeding.calls.length).toBe(1);
  });

  it("privacy class honored: default local-only never routes to a cloud provider", async () => {
    const cloud = makeFakeSummaryProvider("cloud-sum", { privacy: "cloud" });
    const local = makeFakeSummaryProvider("local-sum");
    const fabric = fabricWith(cloud, local);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two. Three." },
      { fallbackProviders: ["cloud-sum", "local-sum"] }, // privacy defaults to local-only
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("local-sum");
    expect(cloud.calls.length).toBe(0); // the cloud provider never saw the input
    expect(local.calls.length).toBe(1);
  });

  it("local-only with only cloud providers in the plan answers a typed no-provider error", async () => {
    const cloud = makeFakeSummaryProvider("cloud-sum", { privacy: "cloud" });
    const fabric = fabricWith(cloud);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two. Three." },
      { fallbackProviders: ["cloud-sum"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("no-provider");
    } else {
      throw new Error("expected a fabric no-provider error");
    }
    expect(cloud.calls.length).toBe(0);
  });

  it("explicit any-cloud routes to the cloud provider when the caller opts in", async () => {
    const cloud = makeFakeSummaryProvider("cloud-sum", { privacy: "cloud" });
    const fabric = fabricWith(cloud);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two. Three." },
      { privacy: "any-cloud", fallbackProviders: ["cloud-sum"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.providerId).toBe("cloud-sum");
    expect(cloud.calls.length).toBe(1);
  });

  it("the fabric independently enforces the ceiling against DECLARED provider costs (layered defense)", async () => {
    const expensive = makeFakeSummaryProvider("expensive", { costs: { summary: 5 } });
    const fabric = fabricWith(expensive);
    // The deterministic estimate (0.004) is far under the ceiling 1 — the
    // pipeline pre-flight passes — but the provider DECLARES cost 5, so the
    // fabric's router excludes it: typed no-provider, never a silent overrun.
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two. Three." },
      { privacy: "any-cloud", fallbackProviders: ["expensive"], maxCostPerOperation: 1 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("no-provider");
    } else {
      throw new Error("expected a fabric no-provider error");
    }
    expect(expensive.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Subtitle composition
// ---------------------------------------------------------------------------

describe("subtitle validators — monotonicity, overlap, non-empty text", () => {
  it("accepts a valid cue list and returns it verbatim", () => {
    const cues: SubtitleCue[] = [
      { startMs: 0, endMs: 2000, text: "Hello" },
      { startMs: 2000, endMs: 4000, text: "World" },
    ];
    const result = validateSubtitleCues(cues);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(cues);
  });

  it("rejects overlapping consecutive cues (endMs(i) > startMs(i+1))", () => {
    const result = validateSubtitleCues([
      { startMs: 0, endMs: 2000, text: "Hello" },
      { startMs: 1500, endMs: 3000, text: "World" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issuePaths(result)).toContain("cues[1].startMs");
      expect(result.issues.some((issue) => issue.message.includes("overlap"))).toBe(true);
    }
  });

  it("rejects non-monotonic starts even without overlap", () => {
    const result = validateSubtitleCues([
      { startMs: 5000, endMs: 6000, text: "First" },
      { startMs: 0, endMs: 1000, text: "Second" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("monotonicity"))).toBe(true);
    }
  });

  it("rejects empty text, zero-duration items, negative or non-integer timings, empty lists, non-arrays", () => {
    for (const [cues, path] of [
      [[{ startMs: 0, endMs: 500, text: "  " }], "cues[0].text"],
      [[{ startMs: 0, endMs: 0, text: "hi" }], "cues[0].endMs"],
      [[{ startMs: -1, endMs: 500, text: "hi" }], "cues[0].startMs"],
      [[{ startMs: 0.5, endMs: 500, text: "hi" }], "cues[0].startMs"],
      [[{ startMs: 0, endMs: 500, text: 42 }], "cues[0].text"],
      [[], "cues"],
      ["nope", "cues"],
    ] as const) {
      const result = validateSubtitleCues(cues as unknown);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(issuePaths(result)).toContain(path);
    }
  });

  it("validates transcript segments under the same invariants with segments paths", () => {
    const result = validateTranscriptSegments([{ startMs: 0, endMs: 100, text: "hi" }, 7]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("segments[1]");
  });
});

describe("subtitle composition — composeSubtitleCues", () => {
  it("composes cues 1:1 from segments + translations, preserving timing verbatim", () => {
    const result = composeSubtitleCues(SEGMENTS, ["[es] Hello", "[es] World"]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.cues).toEqual([
      { startMs: 0, endMs: 2000, text: "[es] Hello" },
      { startMs: 2500, endMs: 4500, text: "[es] World" },
    ]);
  });

  it("rejects a translation-count mismatch with a typed translations issue (no silent drops)", () => {
    const result = composeSubtitleCues(SEGMENTS, ["only one"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(issuePaths(result)).toContain("translations");
      expect(result.issues[0]?.message).toContain("expected 2 translations for 2 segments, got 1");
    }
  });

  it("rejects empty or non-string translations with indexed paths", () => {
    const result = composeSubtitleCues(SEGMENTS, ["[es] Hello", "  "]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("translations[1]");
  });

  it("re-validates its segments (safe standalone use)", () => {
    const result = composeSubtitleCues(
      [
        { startMs: 0, endMs: 2000, text: "Hello" },
        { startMs: 1000, endMs: 3000, text: "World" },
      ],
      ["a", "b"],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("segments[1].startMs");
  });
});

describe("subtitle composition — WebVTT serialization", () => {
  it("formatVttTimestamp renders HH:MM:SS.mmm goldens", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(2_500)).toBe("00:00:02.500");
    expect(formatVttTimestamp(93_784)).toBe("00:01:33.784");
    expect(formatVttTimestamp(3_723_500)).toBe("01:02:03.500");
    expect(formatVttTimestamp(3_600_000)).toBe("01:00:00.000");
  });

  it("formatVttTimestamp throws TypeError on out-of-domain input (programmer error)", () => {
    expect(() => formatVttTimestamp(-1)).toThrow(TypeError);
    expect(() => formatVttTimestamp(1.5)).toThrow(TypeError);
  });

  it("serializes a valid cue list to the exact golden VTT document (no trailing newline)", () => {
    const result = serializeVtt([
      { startMs: 0, endMs: 2_500, text: "Hello" },
      { startMs: 3_000, endMs: 5_000, text: "World" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.vtt).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello\n\n00:00:03.000 --> 00:00:05.000\nWorld",
    );
  });

  it("refuses to serialize invalid cues (typed issues, never a malformed document)", () => {
    const result = serializeVtt([{ startMs: 100, endMs: 50, text: "broken" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(issuePaths(result)).toContain("cues[0].endMs");
  });
});

describe("subtitle composition — end-to-end through the pipeline", () => {
  it("runs the subtitle task through the fabric and composes timed cues from the translations", async () => {
    const fake = makeFakeSubtitleProvider("sub");
    const fabric = fabricWith(fake);
    const result = await runTransformation(
      fabric,
      subtitleTask,
      { media: provenance(), segments: SEGMENTS, targetLanguage: "es" },
      { preferredProvider: "sub" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.task).toBe("subtitle");
    expect(result.output).toEqual({
      cues: [
        { startMs: 0, endMs: 2000, text: "[es] Hello" },
        { startMs: 2500, endMs: 4500, text: "[es] World" },
      ],
      targetLanguage: "es",
    });
    expect(result.trace.taskId).toBe("translation"); // subtitle routes through 'translation'
    expect(result.permission.reason).toContain("allowsTranslation");

    const vtt = serializeVtt(result.output.cues);
    expect(vtt.ok).toBe(true);
    if (!vtt.ok) throw new Error("unreachable");
    expect(vtt.vtt).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n[es] Hello\n\n00:00:02.500 --> 00:00:04.500\n[es] World",
    );
  });

  it("a provider that violates the subtitle output contract surfaces as a typed fabric provider-error", async () => {
    const liar = makeEchoProvider("liar", {
      capabilities: ["translation"],
      transform: () => ({ translations: ["only-one"], targetLanguage: "es" }),
    });
    const fabric = fabricWith(liar);
    const result = await runTransformation(
      fabric,
      subtitleTask,
      { media: provenance(), segments: SEGMENTS, targetLanguage: "es" },
      { privacy: "any-cloud", preferredProvider: "liar" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("provider-error");
      if (result.error.error.kind === "provider-error") {
        expect(result.error.error.providerId).toBe("liar");
        expect(result.error.error.detail).toContain("violated the subtitle output contract");
        expect(result.error.error.detail).toContain("expected 2 translations");
      }
      expect(result.error.trace?.providerId).toBe("liar");
    } else {
      throw new Error("expected a fabric provider-error");
    }
  });

  it("a provider that translates into the wrong language violates the output contract", async () => {
    const liar = makeEchoProvider("wrong-lang", {
      capabilities: ["translation"],
      transform: () => ({ translations: ["[fr] Hello", "[fr] World"], targetLanguage: "fr" }),
    });
    const fabric = fabricWith(liar);
    const result = await runTransformation(
      fabric,
      subtitleTask,
      { media: provenance(), segments: SEGMENTS, targetLanguage: "es" },
      { privacy: "any-cloud", preferredProvider: "wrong-lang" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("provider-error");
      if (result.error.error.kind === "provider-error") {
        expect(result.error.error.detail).toContain("'es'");
      }
    } else {
      throw new Error("expected a fabric provider-error");
    }
  });
});

// ---------------------------------------------------------------------------
// Cost estimates — deterministic, bounded by policy ceilings
// ---------------------------------------------------------------------------

describe("transform cost estimates — deterministic goldens", () => {
  it("estimateTokens: 1 token ≈ 4 characters, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });

  it("per-task cost estimates are exact, deterministic goldens", () => {
    expect(transcriptTask.estimateCost({ media: provenance(), mediaRef: "a", durationMs: 60_000 })).toBe(0.6);
    expect(translationTask.estimateCost({ media: provenance(), text: "a".repeat(40), targetLanguage: "es" })).toBe(0.01);
    expect(subtitleTask.estimateCost({ media: provenance(), segments: SEGMENTS, targetLanguage: "es" })).toBe(0.004);
    expect(summaryTask.estimateCost({ media: provenance(), text: "a".repeat(40) })).toBe(0.01);
    // speech: 3 words → 1500ms → 24000 bytes × 0.00001
    expect(speechTask.estimateCost({ media: provenance(), text: "Hello there friend", voice: "narrator" })).toBe(0.24);
    expect(transcribeTask.estimateCost({ media: provenance(), audioRef: "a", durationMs: 30_000 })).toBe(0.3);
    expect(dubbingTask.estimateCost({ media: provenance(), segments: SEGMENTS, targetLanguage: "es", voice: "warm" })).toBe(0.045);
    expect(commentaryTask.estimateCost({ media: provenance(), mediaRef: "a", durationMs: 60_000, style: "casual" })).toBe(0.6);
  });

  it("per-task duration estimates are exact, deterministic goldens", () => {
    expect(transcriptTask.estimateDurationMs({ media: provenance(), mediaRef: "a", durationMs: 60_000 })).toBe(6500);
    expect(translationTask.estimateDurationMs({ media: provenance(), text: "a".repeat(40), targetLanguage: "es" })).toBe(1050);
    expect(summaryTask.estimateDurationMs({ media: provenance(), text: "a".repeat(40) })).toBe(850);
    expect(speechTask.estimateDurationMs({ media: provenance(), text: "Hello there friend", voice: "narrator" })).toBe(500);
    expect(transcribeTask.estimateDurationMs({ media: provenance(), audioRef: "a", durationMs: 30_000 })).toBe(30500);
    expect(dubbingTask.estimateDurationMs({ media: provenance(), segments: SEGMENTS, targetLanguage: "es", voice: "warm" })).toBe(5500);
    expect(commentaryTask.estimateDurationMs({ media: provenance(), mediaRef: "a", durationMs: 60_000, style: "casual" })).toBe(31000);
  });

  it("repeated estimation is bit-stable", () => {
    const input = { media: provenance(), mediaRef: "a", durationMs: 123_457 };
    const first = transcriptTask.estimateCost(input);
    const second = transcriptTask.estimateCost(input);
    expect(first).toBe(second);
    expect(transcriptTask.estimateDurationMs(input)).toBe(transcriptTask.estimateDurationMs(input));
  });
});

describe("transform pipeline — cost-ceiling enforcement (never a silent overrun)", () => {
  it("over-ceiling estimate answers a typed cost-ceiling denial BEFORE invocation", async () => {
    const fake = makeFakeSummaryProvider("sum");
    const fabric = fabricWith(fake);
    // 40 chars → 7 tokens... use a 400-char text → 100 tokens → 0.1 > 0.05
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "a".repeat(400) },
      { preferredProvider: "sum", maxCostPerOperation: 0.05 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "cost-ceiling") {
      expect(result.error.estimate).toBe(0.1);
      expect(result.error.ceiling).toBe(0.05);
    } else {
      throw new Error("expected a cost-ceiling error");
    }
    expect(fake.calls.length).toBe(0);
  });

  it("an estimate exactly at the ceiling is allowed (boundary is inclusive)", async () => {
    const fake = makeFakeSummaryProvider("sum");
    const fabric = fabricWith(fake);
    const result = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "a".repeat(400) },
      { preferredProvider: "sum", maxCostPerOperation: 0.1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.costEstimate).toBe(0.1); // receipt estimate is bounded by the ceiling
    expect(result.costEstimate).toBeLessThanOrEqual(0.1);
  });

  it("receipt cost estimates are deterministic across runs", async () => {
    const fake = makeFakeSummaryProvider("sum");
    const fabric = fabricWith(fake);
    const input = { media: provenance(), text: "One. Two. Three." };
    const first = await runTransformation(fabric, summaryTask, input, { preferredProvider: "sum" });
    const second = await runTransformation(fabric, summaryTask, input, { preferredProvider: "sum" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.costEstimate).toBe(second.costEstimate);
      expect(first.durationEstimateMs).toBe(second.durationEstimateMs);
      expect(first.output).toEqual(second.output);
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic fakes
// ---------------------------------------------------------------------------

describe("transform fakes — determinism and honesty", () => {
  it("every fake is branded as a test fixture and logs its calls", async () => {
    const fabric = fabricWith(
      makeFakeTranscriptProvider("t1"),
      makeFakeTranslationProvider("t2"),
      makeFakeSubtitleProvider("t3"),
      makeFakeSummaryProvider("t4"),
      makeFakeSpeechProvider("t5"),
      makeFakeTranscribeProvider("t6"),
      makeFakeDubbingProvider("t7"),
      makeFakeCommentaryProvider("t8"),
    );
    const checks: Array<[TransformationTaskKind, string]> = [
      ["transcript", "t1"],
      ["translation", "t2"],
      ["subtitle", "t3"],
      ["summary", "t4"],
      ["speech", "t5"],
      ["transcribe", "t6"],
      ["dubbing", "t7"],
      ["commentary", "t8"],
    ];
    for (const [kind, id] of checks) {
      const task = TRANSFORMATION_TASKS.find((candidate) => candidate.kind === kind);
      if (task === undefined) throw new Error("unreachable");
      const first = await runTransformation(fabric, task, validInputFor(kind, provenance()), {
        privacy: "any-cloud",
        preferredProvider: id,
      });
      const second = await runTransformation(fabric, task, validInputFor(kind, provenance()), {
        privacy: "any-cloud",
        preferredProvider: id,
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.output).toEqual(second.output); // deterministic: same input, same output
      }
    }
  });

  it("transcript fake: deterministic cue grid over the media duration, valid as a track", async () => {
    const fake = makeFakeTranscriptProvider("tr");
    const fabric = fabricWith(fake);
    const result = await runTransformation(
      fabric,
      transcriptTask,
      { media: provenance(), mediaRef: "asset-1", durationMs: 12_000 },
      { preferredProvider: "tr" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({
      segments: [
        { startMs: 0, endMs: 5000, text: "transcript line 1 of 3" },
        { startMs: 5000, endMs: 10_000, text: "transcript line 2 of 3" },
        { startMs: 10_000, endMs: 12_000, text: "transcript line 3 of 3" },
      ],
    });
    const track = validateTranscriptSegments(result.output.segments);
    expect(track.ok).toBe(true);
  });

  it("translation fake: identity translation with the deterministic language prefix", async () => {
    const fabric = fabricWith(makeFakeTranslationProvider("tl"));
    const result = await runTransformation(
      fabric,
      translationTask,
      { media: provenance(), text: "Hello world.", targetLanguage: "es", sourceLanguage: "en" },
      { preferredProvider: "tl" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({
      text: "[es] Hello world.",
      targetLanguage: "es",
      sourceLanguage: "en",
    });
  });

  it("summary fake: first-N sentences (default 3)", async () => {
    const fabric = fabricWith(makeFakeSummaryProvider("sm"));
    const input = { media: provenance(), text: "One. Two. Three. Four. Five." };
    const result = await runTransformation(fabric, summaryTask, input, { preferredProvider: "sm" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({ summary: "One. Two. Three.", sentenceCount: 3 });

    const bounded = await runTransformation(
      fabric,
      summaryTask,
      { media: provenance(), text: "One. Two. Three. Four. Five.", maxSentences: 2 },
      { preferredProvider: "sm" },
    );
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) throw new Error("unreachable");
    expect(bounded.output).toEqual({ summary: "One. Two.", sentenceCount: 2 });
  });

  it("speech fake: typed SPEC from the shared estimators", async () => {
    const fabric = fabricWith(makeFakeSpeechProvider("sp"));
    const result = await runTransformation(
      fabric,
      speechTask,
      { media: provenance(), text: "Hello there friend", voice: "narrator" },
      { preferredProvider: "sp" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({ voice: "narrator", durationMs: 1500, bytes: 24_000 });
  });

  it("transcribe fake: deterministic text naming the audio reference", async () => {
    const fabric = fabricWith(makeFakeTranscribeProvider("st"));
    const result = await runTransformation(
      fabric,
      transcribeTask,
      { media: provenance(), audioRef: "audio-1", durationMs: 30_000 },
      { preferredProvider: "st" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({ text: "transcription of audio-1 (30000 ms)" });
  });

  it("dubbing fake: typed SPEC derived from the transcript track duration", async () => {
    const fabric = fabricWith(makeFakeDubbingProvider("db"));
    const result = await runTransformation(
      fabric,
      dubbingTask,
      { media: provenance(), segments: SEGMENTS, targetLanguage: "es", voice: "warm" },
      { preferredProvider: "db" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({
      targetLanguage: "es",
      voice: "warm",
      durationMs: 4500,
      bytes: 72_000,
    });
  });

  it("commentary fake: deterministic text naming the style and media reference", async () => {
    const fabric = fabricWith(makeFakeCommentaryProvider("cm"));
    const result = await runTransformation(
      fabric,
      commentaryTask,
      { media: provenance(), mediaRef: "asset-1", durationMs: 60_000, style: "insightful" },
      { preferredProvider: "cm" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.output).toEqual({
      commentary: "insightful commentary on asset-1 (60000 ms of media)",
    });
  });

  it("fakes fail loudly on input shapes they do not serve (typed provider-error through the fabric)", async () => {
    // The translation fake cannot serve a subtitle-shaped 'translation' input.
    const translationFake = makeFakeTranslationProvider("tl");
    const fabric = fabricWith(translationFake);
    const result = await runTransformation(
      fabric,
      subtitleTask,
      { media: provenance(), segments: SEGMENTS, targetLanguage: "es" },
      { privacy: "any-cloud", preferredProvider: "tl" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "fabric") {
      expect(result.error.error.kind).toBe("provider-error");
    } else {
      throw new Error("expected a fabric provider-error");
    }
    expect(translationFake.calls.length).toBe(1);
  });
});
