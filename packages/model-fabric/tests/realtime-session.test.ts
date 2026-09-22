/**
 * @wfx/model-fabric — R25-A realtime session contract tests.
 *
 * The shared session contract at the seam:
 * - EVENT VOCABULARY TOTALITY: the 12 event kinds are exactly the
 *   plan's list (session-created … session-closed) — no more, no
 *   fewer, in frozen order;
 * - OPERATION/STATE MACHINE LEGALITY: the operation × state table is
 *   total, deterministic, and matches the plan's operations (start,
 *   configure, append audio, append image frame, stop, reconnect,
 *   close) — including the never-force-visual-upload law;
 * - INPUT VALIDATION: the legal-audio gate fails closed; the consent
 *   gate rejects preservation without satisfied consent; vocabulary
 *   members are enforced; hotwords validate;
 * - THE PROVIDER-NEUTRALITY LAW: the frozen contract surface (the
 *   contracts.md realtime block + the exported vocabularies) contains
 *   NO provider protocol tokens, and the scanner detects violations;
 * - THE PLAYBACK LAW: mayRealtimeTranslationBlockPlayback is total
 *   and always false;
 * - the event stream + the session double obey the state machine.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  RealtimeTranslationEventKind,
  RealtimeTranslationSessionInputs,
} from "@wfx/domain";

import {
  REALTIME_AUDIO_FORMATS,
  REALTIME_EVENT_KINDS,
  REALTIME_EVENT_STATE_TRANSITIONS,
  REALTIME_ERROR_KINDS,
  REALTIME_OPERATIONS,
  REALTIME_OUTPUT_MODALITIES,
  REALTIME_SESSION_STATES,
  REALTIME_SPEAKER_ATTRIBUTION_MODES,
  REALTIME_SUBTITLE_MODES,
  REALTIME_TRANSLATED_VOICE_POLICIES,
  REALTIME_VISUAL_CONTEXT_POLICIES,
  REALTIME_VOICE_CONSENT_STATES,
  REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS,
  createRealtimeEventStream,
  createRealtimeSessionDouble,
  isRealtimeErrorKind,
  isRealtimeEventKind,
  isRealtimeOperation,
  isRealtimeOperationLegal,
  isRealtimeSegmentTiming,
  isRealtimeSessionState,
  mayRealtimeTranslationBlockPlayback,
  realtimeOperationLegalStates,
  scanRealtimeSessionProviderNeutrality,
  validateRealtimeSessionConfiguration,
  validateRealtimeTranslationSessionInputs,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LAWFUL_INPUTS: RealtimeTranslationSessionInputs = {
  sourceMedia: {
    itemId: "wfx-item-1",
    connectorId: "wfx-reference",
    externalRef: "ref-1",
    audioStreamLegallyAvailable: true,
  },
  targetLanguage: "en",
  sourceLanguageHint: "zh",
  outputModality: "text",
  subtitleMode: "bilingual",
  speakerAttribution: "simple-labels",
  visualContextPolicy: "adaptive",
  hotwords: [{ term: "WebFlix", preferredRendering: "WebFlix" }],
  translatedVoicePolicy: "neutral-system-voice",
};

const SATISFIED_CONSENT = {
  state: "satisfied" as const,
  basis: "rights-holder consent recorded through the product consent flow",
  recordedAt: "2026-09-20T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// The event vocabulary totality (the plan's 12, exactly)
// ---------------------------------------------------------------------------

describe("R25-A — the event vocabulary totality", () => {
  it("contains EXACTLY the plan's 12 event kinds, in frozen order", () => {
    expect([...REALTIME_EVENT_KINDS]).toEqual([
      "session-created",
      "source-transcript-delta",
      "source-transcript-final",
      "translation-delta",
      "translation-segment-final",
      "speaker-attribution",
      "translated-audio-chunk",
      "timing-metadata",
      "usage-telemetry",
      "recoverable-error",
      "terminal-error",
      "session-closed",
    ]);
  });

  it("maps the plan's prose events 1:1 onto the neutral kinds", () => {
    // The plan lists: session-created; source-transcript-delta;
    // source-transcript-final; translation-delta;
    // translation-segment-final; speaker-attribution;
    // translated-audio-chunk; source/translation timing metadata;
    // usage/cost telemetry; recoverable error; terminal error;
    // session-closed.
    const planEvents: RealtimeTranslationEventKind[] = [
      "session-created",
      "source-transcript-delta",
      "source-transcript-final",
      "translation-delta",
      "translation-segment-final",
      "speaker-attribution",
      "translated-audio-chunk",
      "timing-metadata", // <- "source/translation timing metadata"
      "usage-telemetry", // <- "usage/cost telemetry"
      "recoverable-error", // <- "recoverable error"
      "terminal-error", // <- "terminal error"
      "session-closed", // <- "session-closed"
    ];
    expect(new Set<string>(REALTIME_EVENT_KINDS)).toEqual(new Set<string>(planEvents));
    expect(REALTIME_EVENT_KINDS.length).toBe(12);
  });

  it("membership guards accept members and reject drift", () => {
    for (const kind of REALTIME_EVENT_KINDS) expect(isRealtimeEventKind(kind)).toBe(true);
    expect(isRealtimeEventKind("response.audio.delta")).toBe(false); // provider event name — never
    expect(isRealtimeEventKind("translation-final")).toBe(false);
    expect(isRealtimeEventKind(42)).toBe(false);
    for (const kind of REALTIME_ERROR_KINDS) expect(isRealtimeErrorKind(kind)).toBe(true);
    expect(isRealtimeErrorKind("fatal")).toBe(false);
  });

  it("the supporting vocabularies are the frozen unions", () => {
    expect([...REALTIME_OUTPUT_MODALITIES]).toEqual(["text", "text-and-audio"]);
    expect([...REALTIME_SUBTITLE_MODES]).toEqual(["source", "translated", "bilingual"]);
    expect([...REALTIME_SPEAKER_ATTRIBUTION_MODES]).toEqual([
      "off",
      "simple-labels",
      "trusted-metadata",
    ]);
    expect([...REALTIME_VISUAL_CONTEXT_POLICIES]).toEqual(["off", "adaptive"]);
    expect([...REALTIME_TRANSLATED_VOICE_POLICIES]).toEqual([
      "neutral-system-voice",
      "preserve-source-voice",
    ]);
    expect([...REALTIME_VOICE_CONSENT_STATES]).toEqual([
      "not-required",
      "satisfied",
      "missing",
      "revoked",
    ]);
    expect([...REALTIME_SESSION_STATES]).toEqual([
      "idle",
      "starting",
      "streaming",
      "reconnecting",
      "stopped",
      "closed",
    ]);
    expect([...REALTIME_OPERATIONS]).toEqual([
      "start",
      "configure",
      "append-audio",
      "append-image-frame",
      "stop",
      "reconnect",
      "close",
    ]);
    expect([...REALTIME_AUDIO_FORMATS]).toEqual(["pcm16", "opus"]);
    for (const state of REALTIME_SESSION_STATES) expect(isRealtimeSessionState(state)).toBe(true);
    for (const operation of REALTIME_OPERATIONS) expect(isRealtimeOperation(operation)).toBe(true);
    expect(isRealtimeOperation("resume")).toBe(false); // the plan's reconnect/resume is ONE operation: 'reconnect'
  });
});

// ---------------------------------------------------------------------------
// The operation × state legality table
// ---------------------------------------------------------------------------

describe("R25-A — the operation × state machine legality", () => {
  it("start is legal only from idle (a stopped/closed session never restarts)", () => {
    const legal = realtimeOperationLegalStates().start;
    expect(legal).toEqual(["idle"]);
  });

  it("configure is legal from idle and streaming", () => {
    expect(realtimeOperationLegalStates().configure).toEqual(["idle", "streaming"]);
  });

  it("append-audio is legal from starting and streaming (never idle/stopped/closed)", () => {
    expect(realtimeOperationLegalStates()["append-audio"]).toEqual(["starting", "streaming"]);
  });

  it("append-image-frame is legal from starting and streaming ONLY under an adaptive visual policy", () => {
    expect(realtimeOperationLegalStates()["append-image-frame"]).toEqual([
      "starting",
      "streaming",
    ]);
    // The never-force-visual-upload law (R25-F):
    expect(
      isRealtimeOperationLegal("append-image-frame", "streaming", {
        visualContextPolicy: "adaptive",
      }),
    ).toBe(true);
    expect(
      isRealtimeOperationLegal("append-image-frame", "streaming", {
        visualContextPolicy: "off",
      }),
    ).toBe(false);
    expect(
      isRealtimeOperationLegal("append-image-frame", "starting", {
        visualContextPolicy: "off",
      }),
    ).toBe(false);
  });

  it("stop is legal from starting and streaming; close is legal from every non-closed state", () => {
    expect(realtimeOperationLegalStates().stop).toEqual(["starting", "streaming"]);
    expect(realtimeOperationLegalStates().close).toEqual([
      "idle",
      "starting",
      "streaming",
      "reconnecting",
      "stopped",
    ]);
  });

  it("reconnect is legal only from reconnecting (resume the SAME session, never restart the media)", () => {
    expect(realtimeOperationLegalStates().reconnect).toEqual(["reconnecting"]);
  });

  it("NO operation is legal from closed, and only close is legal from stopped", () => {
    for (const operation of REALTIME_OPERATIONS) {
      expect(isRealtimeOperationLegal(operation, "closed")).toBe(false);
    }
    for (const operation of REALTIME_OPERATIONS) {
      if (operation === "close") continue;
      expect(isRealtimeOperationLegal(operation, "stopped")).toBe(false);
    }
  });

  it("the legality table is total over operations × states (no undefined rows)", () => {
    const table = realtimeOperationLegalStates();
    for (const operation of REALTIME_OPERATIONS) {
      expect(Array.isArray(table[operation])).toBe(true);
    }
  });

  it("the event-driven transitions: session-created → streaming; interruption → reconnecting; terminal → closed", () => {
    expect(REALTIME_EVENT_STATE_TRANSITIONS.onSessionCreated).toBe("streaming");
    expect(REALTIME_EVENT_STATE_TRANSITIONS.onRecoverableInterruption).toBe("reconnecting");
    expect(REALTIME_EVENT_STATE_TRANSITIONS.terminalStates).toEqual(["closed"]);
  });
});

// ---------------------------------------------------------------------------
// Input validation (the legal-audio gate + the consent gate)
// ---------------------------------------------------------------------------

describe("R25-A — session input validation", () => {
  it("accepts the lawful inputs", () => {
    const result = validateRealtimeTranslationSessionInputs(LAWFUL_INPUTS);
    expect(result.ok).toBe(true);
  });

  it("THE LEGAL-AUDIO GATE: refuses inputs without a lawful audio path — fail closed, no override", () => {
    const result = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      sourceMedia: { ...LAWFUL_INPUTS.sourceMedia, audioStreamLegallyAvailable: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const gate = result.issues.find((issue) =>
        issue.path.startsWith("sourceMedia.audioStreamLegallyAvailable"),
      );
      expect(gate).toBeDefined();
      expect(gate?.message).toContain("no bypass");
    }
  });

  it("requires the source media to be named (at least one identity field)", () => {
    const result = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      sourceMedia: { audioStreamLegallyAvailable: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "sourceMedia")).toBe(true);
    }
  });

  it("requires a non-empty target language and rejects empty hints", () => {
    const noTarget = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      targetLanguage: "  ",
    });
    expect(noTarget.ok).toBe(false);
    const badHint = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      sourceLanguageHint: "",
    });
    expect(badHint.ok).toBe(false);
  });

  it("rejects vocabulary drift with actionable field paths", () => {
    const result = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      outputModality: "audio-only",
      subtitleMode: "dual",
      speakerAttribution: "names",
      visualContextPolicy: "always",
      translatedVoicePolicy: "clone",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const path of [
        "outputModality",
        "subtitleMode",
        "speakerAttribution",
        "visualContextPolicy",
        "translatedVoicePolicy",
      ]) {
        expect(result.issues.some((issue) => issue.path === path)).toBe(true);
      }
    }
  });

  it("validates hotword mappings (non-empty terms; optional renderings)", () => {
    const result = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      hotwords: [{ term: "" }, { term: "ok", preferredRendering: "" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "hotwords[0].term")).toBe(true);
      expect(
        result.issues.some((issue) => issue.path === "hotwords[1].preferredRendering"),
      ).toBe(true);
    }
  });

  it("THE CONSENT GATE: voice preservation requires a satisfied consent record", () => {
    const withoutConsent = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      translatedVoicePolicy: "preserve-source-voice",
    });
    expect(withoutConsent.ok).toBe(false);
    if (!withoutConsent.ok) {
      expect(withoutConsent.issues.some((issue) => issue.path === "voiceConsent")).toBe(true);
    }

    const unsatisfied = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      translatedVoicePolicy: "preserve-source-voice",
      voiceConsent: { state: "missing", basis: "n/a", recordedAt: "2026-09-20T00:00:00.000Z" },
    });
    expect(unsatisfied.ok).toBe(false);
    if (!unsatisfied.ok) {
      expect(unsatisfied.issues.some((issue) => issue.path === "voiceConsent.state")).toBe(true);
    }

    const satisfied = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      translatedVoicePolicy: "preserve-source-voice",
      voiceConsent: SATISFIED_CONSENT,
    });
    expect(satisfied.ok).toBe(true);
  });

  it("a satisfied consent record must name its basis and timestamp (never silently synthesized)", () => {
    const noBasis = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      translatedVoicePolicy: "preserve-source-voice",
      voiceConsent: { state: "satisfied", basis: " ", recordedAt: "2026-09-20T00:00:00.000Z" },
    });
    expect(noBasis.ok).toBe(false);
    const noTime = validateRealtimeTranslationSessionInputs({
      ...LAWFUL_INPUTS,
      translatedVoicePolicy: "preserve-source-voice",
      voiceConsent: { state: "satisfied", basis: "ok", recordedAt: "" },
    });
    expect(noTime.ok).toBe(false);
  });

  it("rejects non-object inputs with the root issue", () => {
    const result = validateRealtimeTranslationSessionInputs("translate this");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("");
    }
  });
});

describe("R25-A — session configuration validation", () => {
  it("accepts partial reconfigurations and the empty no-op", () => {
    expect(validateRealtimeSessionConfiguration({}).ok).toBe(true);
    const result = validateRealtimeSessionConfiguration({ subtitleMode: "translated" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subtitleMode).toBe("translated");
    }
  });

  it("rejects invalid reconfiguration values with field paths", () => {
    const result = validateRealtimeSessionConfiguration({
      targetLanguage: "",
      outputModality: "audio",
      hotwords: [{ term: "" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const path of ["targetLanguage", "outputModality", "hotwords[0].term"]) {
        expect(result.issues.some((issue) => issue.path === path)).toBe(true);
      }
    }
  });

  it("voice preservation reconfiguration requires the satisfied consent record too", () => {
    const result = validateRealtimeSessionConfiguration({
      translatedVoicePolicy: "preserve-source-voice",
    });
    expect(result.ok).toBe(false);
    const withConsent = validateRealtimeSessionConfiguration({
      translatedVoicePolicy: "preserve-source-voice",
      voiceConsent: SATISFIED_CONSENT,
    });
    expect(withConsent.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The provider-neutrality law (the frozen surface carries no provider protocol)
// ---------------------------------------------------------------------------

describe("R25-A — the provider-neutrality law", () => {
  const contractsDoc = readFileSync(
    join(import.meta.dir, "..", "..", "..", "docs", "architecture", "contracts.md"),
    "utf8",
  );
  const frozenContracts = readFileSync(
    join(import.meta.dir, "..", "..", "domain", "src", "contracts", "frozen.ts"),
    "utf8",
  );

  it("the frozen realtime contract surface contains NO provider protocol tokens", () => {
    expect(scanRealtimeSessionProviderNeutrality(contractsDoc)).toEqual([]);
    expect(scanRealtimeSessionProviderNeutrality(frozenContracts)).toEqual([]);
  });

  it("the exported session vocabularies contain no provider vocabulary", () => {
    const vocabularyValues = [
      ...REALTIME_EVENT_KINDS,
      ...REALTIME_OPERATIONS,
      ...REALTIME_SESSION_STATES,
      ...REALTIME_OUTPUT_MODALITIES,
      ...REALTIME_SUBTITLE_MODES,
      ...REALTIME_SPEAKER_ATTRIBUTION_MODES,
      ...REALTIME_VISUAL_CONTEXT_POLICIES,
      ...REALTIME_TRANSLATED_VOICE_POLICIES,
      ...REALTIME_VOICE_CONSENT_STATES,
      ...REALTIME_ERROR_KINDS,
      ...REALTIME_AUDIO_FORMATS,
    ].join("\n");
    expect(scanRealtimeSessionProviderNeutrality(vocabularyValues)).toEqual([]);
    // No provider event-name shape sneaks in as a kind either:
    for (const kind of REALTIME_EVENT_KINDS) {
      expect(kind.includes(".")).toBe(false); // provider protocol events are dot-namespaced
      expect(kind.includes("_buffer")).toBe(false);
    }
  });

  it("the scanner DETECTS provider protocol tokens (the law has teeth)", () => {
    const dirty = `const event = { type: "session.update", audio: "input_audio_buffer.append" }`;
    const violations = scanRealtimeSessionProviderNeutrality(dirty);
    expect(violations).toContain("session.update");
    expect(violations).toContain("input_audio_buffer");
    expect(scanRealtimeSessionProviderNeutrality("clean neutral source")).toEqual([]);
  });

  it("the forbidden-token list is the provider protocol vocabulary (case-insensitive by scan)", () => {
    expect(REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS.length).toBeGreaterThan(0);
    expect(scanRealtimeSessionProviderNeutrality("DashScope")).toContain("dashscope");
  });
});

// ---------------------------------------------------------------------------
// The playback law
// ---------------------------------------------------------------------------

describe("R25-A — the never-block-playback law", () => {
  it("mayRealtimeTranslationBlockPlayback is total and always false", () => {
    expect(mayRealtimeTranslationBlockPlayback()).toBe(false);
    expect(mayRealtimeTranslationBlockPlayback()).toBe(false); // total: same answer every call
  });
});

// ---------------------------------------------------------------------------
// The event stream + the session double
// ---------------------------------------------------------------------------

describe("R25-A — the event stream", () => {
  it("delivers pushed events in FIFO order to an async consumer", async () => {
    const { stream, events } = createRealtimeEventStream();
    const received: string[] = [];
    const consumer = (async () => {
      for await (const event of events()) {
        received.push(event.kind);
      }
    })();
    stream.push({
      kind: "session-created",
      sessionId: "s1",
      occurredAt: "2026-09-20T00:00:00.000Z",
      providerId: "p",
      modelId: "m",
      modelRevision: "r",
      effectiveInputs: LAWFUL_INPUTS,
    });
    stream.push({
      kind: "source-transcript-delta",
      sessionId: "s1",
      occurredAt: "2026-09-20T00:00:00.100Z",
      segmentId: "seg-1",
      deltaText: "hello",
      timing: { startedAtMs: 0, endedAtMs: 400 },
    });
    stream.close();
    await consumer;
    expect(received).toEqual(["session-created", "source-transcript-delta"]);
  });

  it("a consumer arriving late sees buffered events, then ends at close", async () => {
    const { stream, events } = createRealtimeEventStream();
    stream.push({
      kind: "usage-telemetry",
      sessionId: "s1",
      occurredAt: "2026-09-20T00:00:00.000Z",
      usage: { inputAudioTokens: 100, textOutputTokens: 10, outputAudioTokens: 0, imageInputTokens: 0 },
    });
    stream.close();
    const received: string[] = [];
    for await (const event of events()) {
      received.push(event.kind);
    }
    expect(received).toEqual(["usage-telemetry"]);
    expect(stream.buffered).toBe(0);
  });

  it("pushing after close throws — events are never dropped silently", () => {
    const { stream } = createRealtimeEventStream();
    stream.close();
    expect(() =>
      stream.push({
        kind: "session-closed",
        sessionId: "s1",
        occurredAt: "2026-09-20T00:00:00.000Z",
        reason: "user-close",
      }),
    ).toThrow(/pushed after close/);
  });

  it("isRealtimeSegmentTiming validates ordered, non-negative timings", () => {
    expect(isRealtimeSegmentTiming({ startedAtMs: 0, endedAtMs: 100 })).toBe(true);
    expect(isRealtimeSegmentTiming({ startedAtMs: 100, endedAtMs: 0 })).toBe(false);
    expect(isRealtimeSegmentTiming({ startedAtMs: -1, endedAtMs: 0 })).toBe(false);
    expect(isRealtimeSegmentTiming({ startedAtMs: 0 })).toBe(false);
  });
});

describe("R25-A — the session double obeys the state machine (the frozen port, no provider)", () => {
  it("walks the lawful lifecycle: open → start → append → stop → close", async () => {
    const session = createRealtimeSessionDouble(LAWFUL_INPUTS);
    expect(session.state).toBe("idle");
    expect(session.sessionId).toBe("realtime-double-session");

    await session.start();
    expect(session.state).toBe("starting");

    await session.appendAudio({ audio: new Uint8Array([1, 2, 3]), mediaPositionMs: 0 });
    await session.appendImageFrame({ frame: new Uint8Array([4, 5, 6]), mediaPositionMs: 500 });

    await session.stop();
    expect(session.state).toBe("stopped");

    await session.close();
    expect(session.state).toBe("closed");
  });

  it("throws on illegal operations (the table has teeth)", async () => {
    const session = createRealtimeSessionDouble(LAWFUL_INPUTS);
    await expect(session.appendAudio({ audio: new Uint8Array(1) })).rejects.toThrow(
      /append-audio.*illegal.*idle/,
    );
    await expect(session.reconnect()).rejects.toThrow(/reconnect.*illegal.*idle/);
    await session.start();
    await session.stop();
    await expect(session.start()).rejects.toThrow(/start.*illegal.*stopped/);
    await expect(session.appendAudio({ audio: new Uint8Array(1) })).rejects.toThrow(
      /append-audio.*illegal.*stopped/,
    );
  });

  it("forbids frame append under a visual-off policy (never force visual upload)", async () => {
    const session = createRealtimeSessionDouble({
      ...LAWFUL_INPUTS,
      visualContextPolicy: "off",
    });
    await session.start();
    await expect(session.appendImageFrame({ frame: new Uint8Array(1) })).rejects.toThrow(
      /append-image-frame/,
    );
    await session.appendAudio({ audio: new Uint8Array(1) }); // audio still fine
    await session.close();
  });
});
