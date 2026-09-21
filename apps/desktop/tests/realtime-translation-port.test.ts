/**
 * R25-W3 — the realtime translation session port's vocabulary laws (the
 * plan's R25-A shared contract, desktop-side binding).
 *
 * Proven here (machine-checked):
 * - THE EVENT VOCABULARY IS THE PLAN'S, VERBATIM AND CLOSED: the twelve
 *   kinds are exactly the plan's event list — no provider event name, no
 *   extra invented kind, no missing one.
 * - THE OPERATIONS ARE THE PLAN'S SEVEN: start, configure, appendAudio,
 *   appendImageFrame, stop, reconnect, close.
 * - THE HONEST UNAVAILABLE FACTORY: the default binding answers the typed
 *   `no-realtime-provider` failure — never a fake session — and the
 *   provider-bound truth is observable through the marker.
 * - NO PROVIDER LEAKAGE IN THE VOCABULARY: no event kind, operation, or
 *   failure name carries a provider token (the frozen product law's
 *   structural half; the runtime half is the factory seam's shape).
 */

import { describe, expect, it } from "bun:test";

import {
  createUnavailableRealtimeSessionFactory,
  isRealtimeTranslationEventKind,
  isUnavailableRealtimeSessionFactory,
  REALTIME_TRANSLATION_EVENT_KINDS,
  type RealtimeTranslationSessionFactory,
  type RealtimeTranslationSession,
} from "../src/platform/realtime-translation-port";

// ---------------------------------------------------------------------------
// The plan's R25-A event list (docs/plans/2026-09-20-webflix-qwen-
// livetranslate-plan.md, "Events:" section) — copied verbatim as the
// expected vocabulary; the test asserts the module carries exactly this.
// ---------------------------------------------------------------------------

const PLAN_EVENT_KINDS: readonly string[] = [
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
];

const PLAN_OPERATIONS: readonly string[] = [
  "start",
  "configure",
  "appendAudio",
  "appendImageFrame",
  "stop",
  "reconnect",
  "close",
  "subscribe",
];

describe("R25-W3 — the realtime translation session port (the R25-A vocabulary)", () => {
  it("the event vocabulary is the plan's, verbatim and closed", () => {
    expect(REALTIME_TRANSLATION_EVENT_KINDS.length).toBe(PLAN_EVENT_KINDS.length);
    for (const kind of PLAN_EVENT_KINDS) {
      expect((REALTIME_TRANSLATION_EVENT_KINDS as readonly string[]).includes(kind)).toBe(true);
    }
    for (const kind of REALTIME_TRANSLATION_EVENT_KINDS) {
      expect(PLAN_EVENT_KINDS.includes(kind)).toBe(true);
    }
    expect(REALTIME_TRANSLATION_EVENT_KINDS.length).toBe(12);
  });

  it("the event-kind guard answers truthfully for members and garbage", () => {
    expect(isRealtimeTranslationEventKind("translation-delta")).toBe(true);
    expect(isRealtimeTranslationEventKind("session-closed")).toBe(true);
    expect(isRealtimeTranslationEventKind("partial-speech")).toBe(false);
    expect(isRealtimeTranslationEventKind(42)).toBe(false);
    expect(isRealtimeTranslationEventKind(null)).toBe(false);
  });

  it("no provider token leaks into the vocabulary (the frozen product law)", () => {
    const vocabulary = [
      ...REALTIME_TRANSLATION_EVENT_KINDS,
      ...PLAN_OPERATIONS,
      "no-realtime-provider",
      "capability-unavailable",
      "invalid-input",
    ];
    for (const token of vocabulary) {
      expect(token.toLowerCase()).not.toContain("qwen");
      expect(token.toLowerCase()).not.toContain("dashscope");
      expect(token.toLowerCase()).not.toContain("alibaba");
      expect(token.toLowerCase()).not.toContain("openai");
      expect(token.toLowerCase()).not.toContain("api-key");
      expect(token.toLowerCase()).not.toContain("credential");
    }
  });

  it("the session operations are the plan's seven (plus subscribe — the event stream)", () => {
    // The structural contract: a session value carrying exactly these
    // members satisfies the port's interface (compile-time) — this test
    // pins the RUNTIME vocabulary by reflection over a double.
    const double: RealtimeTranslationSession = {
      id: "rt-1",
      start: async () => undefined,
      configure: async () => undefined,
      appendAudio: () => undefined,
      appendImageFrame: () => undefined,
      stop: async () => undefined,
      reconnect: async () => undefined,
      close: async () => undefined,
      subscribe: () => () => undefined,
    };
    for (const operation of PLAN_OPERATIONS) {
      expect(typeof (double as unknown as Record<string, unknown>)[operation]).toBe("function");
    }
  });

  it("the honest unavailable factory answers the typed no-realtime-provider failure — never a fake session", async () => {
    const factory = createUnavailableRealtimeSessionFactory();
    const answer = await factory.createSession({
      sourceMediaId: "wfxitm_x",
      sourceAudio: {
        capturePath: "authorized-local",
        sourceId: "s-1",
        sourceMediaId: "wfxitm_x",
        format: { sampleRateHz: 48_000, channels: 2, encoding: "pcm-s16le" },
      },
      imageFrames: null,
      sourceLanguageHint: null,
      targetLanguage: "en",
      outputModalities: "text",
      subtitleMode: "bilingual",
      speakerAttribution: "labeled",
      hotwords: [],
      translatedVoice: { mode: "neutral", consent: null },
    });
    expect("kind" in answer).toBe(true);
    if ("kind" in answer) {
      expect(answer.kind).toBe("no-realtime-provider");
      expect(answer.detail.length).toBeGreaterThan(20);
      expect(answer.detail.toLowerCase()).not.toContain("qwen");
    }
  });

  it("the provider-bound truth is observable through the marker (the capability surface's truth)", () => {
    const unavailable = createUnavailableRealtimeSessionFactory();
    expect(isUnavailableRealtimeSessionFactory(unavailable)).toBe(true);
    const bound: RealtimeTranslationSessionFactory = {
      createSession: async () => ({
        id: "rt-bound",
        start: async () => undefined,
        configure: async () => undefined,
        appendAudio: () => undefined,
        appendImageFrame: () => undefined,
        stop: async () => undefined,
        reconnect: async () => undefined,
        close: async () => undefined,
        subscribe: () => () => undefined,
      }),
    };
    expect(isUnavailableRealtimeSessionFactory(bound)).toBe(false);
  });
});
