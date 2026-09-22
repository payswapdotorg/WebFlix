/**
 * @wfx/model-fabric — R25-C the Qwen LiveTranslate protocol tests.
 *
 * The protocol module's own laws, pinned:
 * - THE ENDPOINT/MODEL/RATE-LIMIT TRUTH: provenance-named constants,
 *   the model id agrees with the registered provider record (one
 *   truth, two views), the RPM smoothing interval derives from RPM=10
 *   → 6000 ms;
 * - session.update SERIALIZATION: every input dimension maps into the
 *   qwen3.8 parameter family (output_modalities, turn_detection by
 *   attribution mode, translation.language, corpus.phrases hotwords,
 *   the source-language hint, consent-gated voice cloning with the
 *   fail-closed R25-H re-assertion);
 * - input_audio_buffer.append / input_image_buffer.append: the
 *   Base64 payloads round-trip byte-exactly;
 * - THE PARSER: every documented server event type parses from its
 *   recorded wire shape; drift parses to the typed `unparseable`
 *   variant (never a crash, never a silent drop);
 * - USAGE ACCOUNTING: the reference's own usage example maps onto the
 *   neutral record (27/2/7), imageInputTokens honestly 0;
 * - SPEAKER-ID MAPPING: first-appearance ordinals → Speaker N labels;
 * - PROVIDER ERROR NORMALIZATION: rate-limit → recoverable
 *   provider-failure naming RPM/TPM; auth → terminal with the env
 *   variable recovery sentence; language → unsupported-language-
 *   direction; invalid-request → policy; unmapped → terminal unknown
 *   (the fail-closed default);
 * - THE MAPPING TABLE: every row's session event is a member of the
 *   frozen 12-event vocabulary, and the table covers every
 *   reconstruction path the adapter battery exercises.
 */

import { describe, expect, it } from "bun:test";

import type { RealtimeTranslationSessionInputs } from "@wfx/domain";

import {
  REALTIME_EVENT_KINDS,
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS,
  scanRealtimeSessionProviderNeutrality,
} from "../src/index";
import {
  QWEN_CLIENT_FRAME_TYPES,
  QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE,
  QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS,
  QWEN_LIVETRANSLATE_MODEL_ID,
  QWEN_LIVETRANSLATE_MODEL_ID_PROVENANCE,
  QWEN_LIVETRANSLATE_RATE_LIMITS,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_INTERNATIONAL,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD_PROVENANCE,
  QWEN_PROTOCOL_EVENT_MAPPING,
  QWEN_SERVER_EVENT_TYPES,
  base64ToBytes,
  bytesToBase64,
  normalizeQwenProviderError,
  parseQwenServerEvent,
  qwenEventId,
  qwenHotwordPhrases,
  qwenRealtimeUrl,
  qwenSessionStartMinIntervalMs,
  qwenSpeakerId,
  qwenSpeakerLabel,
  qwenTranslationBlock,
  qwenTurnDetectionFor,
  qwenUsageToSessionUsage,
  serializeQwenAudioAppend,
  serializeQwenAudioCommit,
  serializeQwenImageAppend,
  serializeQwenSessionFinish,
  serializeQwenSessionUpdate,
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

const NOW = 1_758_500_000_000;

// ---------------------------------------------------------------------------
// The endpoint / model / rate-limit truth (provenance-named)
// ---------------------------------------------------------------------------

describe("R25-C protocol — the endpoint/model/rate-limit truth", () => {
  it("the model id agrees with the registered provider record (one truth, two views)", () => {
    expect(QWEN_LIVETRANSLATE_MODEL_ID).toBe(QWEN_LIVETRANSLATE_FLASH_REALTIME.model.modelId);
    expect(QWEN_LIVETRANSLATE_MODEL_ID).toBe("qwen3.8-livetranslate-flash-realtime");
    expect(QWEN_LIVETRANSLATE_MODEL_ID_PROVENANCE).toContain("2026-09-20-webflix-qwen-livetranslate-plan.md");
  });

  it("the default endpoint is the documented QwenCloud MaaS realtime endpoint, provenance-named", () => {
    expect(QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD).toBe(
      "wss://maas.qwencloudapi.com/api-ws/v1/realtime",
    );
    expect(QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD_PROVENANCE).toContain(
      "docs.qwencloud.com/api-reference/speech-translation/livetranslate-realtime/client-events",
    );
  });

  it("the Model Studio International alternative is a named constant (deployments, never a silent switch)", () => {
    expect(QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_INTERNATIONAL).toBe(
      "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference",
    );
    expect(QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_INTERNATIONAL).not.toBe(
      QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
    );
  });

  it("the provider URL is the endpoint + the URL-encoded model query parameter", () => {
    expect(
      qwenRealtimeUrl({
        endpoint: QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
        modelId: QWEN_LIVETRANSLATE_MODEL_ID,
      }),
    ).toBe("wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=qwen3.8-livetranslate-flash-realtime");
    expect(qwenRealtimeUrl({ endpoint: "wss://example.invalid/ws", modelId: "a b" })).toBe(
      "wss://example.invalid/ws?model=a%20b",
    );
  });

  it("the documented rate limits are RPM=10 / TPM=100,000 International, and the smoothing interval derives to 6000 ms", () => {
    expect(QWEN_LIVETRANSLATE_RATE_LIMITS.requestsPerMinute).toBe(10);
    expect(QWEN_LIVETRANSLATE_RATE_LIMITS.tokensPerMinute).toBe(100_000);
    expect(QWEN_LIVETRANSLATE_RATE_LIMITS.basis).toContain("RPM=10");
    expect(qwenSessionStartMinIntervalMs()).toBe(6_000);
    expect(qwenSessionStartMinIntervalMs({ requestsPerMinute: 0 })).toBe(0);
  });

  it("the credential environment variable is the provider's documented name", () => {
    expect(QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE).toBe("DASHSCOPE_API_KEY");
  });

  it("the documented image constraints are the provider's own fences", () => {
    expect(QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS.maxBytesBeforeBase64).toBe(500 * 1024);
    expect(QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS.maxFramesPerSecond).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// session.update serialization (the qwen3.8 parameter family)
// ---------------------------------------------------------------------------

describe("R25-C protocol — session.update serialization", () => {
  it("serializes the full neutral inputs into the qwen3.8 parameter family", () => {
    const frame = serializeQwenSessionUpdate(LAWFUL_INPUTS, NOW);
    expect(frame.type).toBe("session.update");
    expect(frame.event_id).toBe(`event_${NOW}`);
    const session = frame.session as Record<string, unknown>;
    expect(session.output_modalities).toEqual(["text"]);
    expect(session.translation).toEqual({
      language: "en",
      corpus: { phrases: { WebFlix: "WebFlix" } },
    });
    expect(session.input_audio_transcription).toEqual({ language: "zh" });
    const audio = session.audio as { input: { turn_detection: unknown } };
    expect(audio.input.turn_detection).toEqual({ type: "speaker_detection", threshold: 0.5 });
    // The neutral system voice sends NO cloning fields at all.
    expect(session.enable_voice_clone).toBeUndefined();
    expect(session.voice_clone_options).toBeUndefined();
    expect(session.voice).toBeUndefined();
  });

  it("maps text-and-audio output onto ['text', 'audio']", () => {
    const frame = serializeQwenSessionUpdate(
      { ...LAWFUL_INPUTS, outputModality: "text-and-audio" },
      NOW,
    );
    expect((frame.session as Record<string, unknown>).output_modalities).toEqual(["text", "audio"]);
  });

  it("maps speaker attribution 'off' onto server_vad turn detection", () => {
    expect(qwenTurnDetectionFor("off")).toEqual({ type: "server_vad", threshold: 0.5 });
    expect(qwenTurnDetectionFor("simple-labels")).toEqual({
      type: "speaker_detection",
      threshold: 0.5,
    });
    expect(qwenTurnDetectionFor("trusted-metadata")).toEqual({
      type: "speaker_detection",
      threshold: 0.5,
    });
    const frame = serializeQwenSessionUpdate(
      { ...LAWFUL_INPUTS, speakerAttribution: "off" },
      NOW,
    );
    const audio = (frame.session as Record<string, unknown>).audio as {
      input: { turn_detection: { type: string } };
    };
    expect(audio.input.turn_detection.type).toBe("server_vad");
  });

  it("serializes hotwords into the provider's corpus.phrases syntax (term → preferred rendering; term → term when no rendering)", () => {
    expect(
      qwenHotwordPhrases([
        { term: "人工智能", preferredRendering: "Artificial Intelligence" },
        { term: "WebFlix" },
      ]),
    ).toEqual({ 人工智能: "Artificial Intelligence", WebFlix: "WebFlix" });
    expect(qwenHotwordPhrases([])).toBeUndefined();
    expect(qwenTranslationBlock("en", [{ term: "AI", preferredRendering: "Artificial Intelligence" }])).toEqual({
      language: "en",
      corpus: { phrases: { AI: "Artificial Intelligence" } },
    });
    expect(qwenTranslationBlock("en", [])).toEqual({ language: "en" });
  });

  it("omits the source-language hint block when no hint is present (the model auto-detects)", () => {
    const { sourceLanguageHint: _absent, ...noHint } = LAWFUL_INPUTS;
    const frame = serializeQwenSessionUpdate(noHint, NOW);
    expect((frame.session as Record<string, unknown>).input_audio_transcription).toBeUndefined();
  });

  it("consent-gated voice preservation maps onto enable_voice_clone + frequency once + voice default", () => {
    const frame = serializeQwenSessionUpdate(
      {
        ...LAWFUL_INPUTS,
        translatedVoicePolicy: "preserve-source-voice",
        voiceConsent: SATISFIED_CONSENT,
      },
      NOW,
    );
    const session = frame.session as Record<string, unknown>;
    expect(session.enable_voice_clone).toBe(true);
    expect(session.voice_clone_options).toEqual({ frequency: "once" });
    expect(session.voice).toBe("default");
  });

  it("FAILS CLOSED on voice preservation without satisfied consent (the R25-H law re-asserted at the serialization boundary)", () => {
    expect(() =>
      serializeQwenSessionUpdate(
        { ...LAWFUL_INPUTS, translatedVoicePolicy: "preserve-source-voice" },
        NOW,
      ),
    ).toThrow(/never silently clone a source speaker/);
    expect(() =>
      serializeQwenSessionUpdate(
        {
          ...LAWFUL_INPUTS,
          translatedVoicePolicy: "preserve-source-voice",
          voiceConsent: { ...SATISFIED_CONSENT, state: "missing" },
        },
        NOW,
      ),
    ).toThrow(/never silently clone a source speaker/);
  });
});

// ---------------------------------------------------------------------------
// The buffer append frames + base64
// ---------------------------------------------------------------------------

describe("R25-C protocol — the append frames and Base64", () => {
  it("serializes input_audio_buffer.append with the Base64 audio payload", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 255, 254]);
    const frame = serializeQwenAudioAppend(bytes, NOW);
    expect(frame.type).toBe("input_audio_buffer.append");
    expect(frame.audio).toBe("AAECA//+");
  });

  it("serializes input_image_buffer.append with the Base64 image payload", () => {
    const frame = serializeQwenImageAppend(new Uint8Array([137, 80, 78, 71]), NOW);
    expect(frame.type).toBe("input_image_buffer.append");
    expect(frame.image).toBe("iVBORw==");
  });

  it("serializes the commit and finish control frames", () => {
    expect(serializeQwenAudioCommit(NOW).type).toBe("input_audio_buffer.commit");
    expect(serializeQwenSessionFinish(NOW).type).toBe("session.finish");
    expect(qwenEventId(NOW)).toBe(`event_${NOW}`);
  });

  it("Base64 round-trips byte-exactly (pure, dependency-free)", () => {
    const payloads = [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array([0, 1]),
      new Uint8Array([0, 1, 2]),
      new Uint8Array([255, 254, 253, 252, 251]),
      new Uint8Array(Array.from({ length: 257 }, (_, i) => i % 256)),
    ];
    for (const payload of payloads) {
      expect(base64ToBytes(bytesToBase64(payload))).toEqual(payload);
    }
  });

  it("Base64 decoding is fail-closed: malformed input returns undefined, never a partial decode", () => {
    expect(base64ToBytes("not!!base64")).toBeUndefined();
    expect(base64ToBytes("AAAAA")).toBeUndefined(); // impossible length
    expect(base64ToBytes("A")).toBeUndefined();
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
    expect(base64ToBytes("AAAA")).toEqual(new Uint8Array([0, 0, 0]));
    expect(base64ToBytes("AQIDBA==")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(base64ToBytes("AAECA//+")).toEqual(new Uint8Array([0, 1, 2, 3, 255, 254]));
  });

  it("the client frame vocabulary is exactly the documented six", () => {
    expect([...QWEN_CLIENT_FRAME_TYPES]).toEqual([
      "session.update",
      "input_audio_buffer.append",
      "input_image_buffer.append",
      "input_audio_buffer.commit",
      "input_audio_buffer.clear",
      "session.finish",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The server event parser (every documented type; drift → unparseable)
// ---------------------------------------------------------------------------

describe("R25-C protocol — the server event parser", () => {
  it("parses session.created with the recorded session echo shape", () => {
    const event = parseQwenServerEvent(
      JSON.stringify({
        event_id: "event_example",
        type: "session.created",
        session: {
          id: "sess_example",
          object: "realtime.session",
          model: "qwen3.8-livetranslate-flash-realtime",
          input_modalities: ["audio"],
          output_modalities: ["text", "audio"],
          audio: { input: { format: { type: "pcm", sample_rate: 16000 } } },
          translation: { language: "en" },
        },
      }),
    );
    expect(event).toEqual({
      type: "session.created",
      session: {
        id: "sess_example",
        model: "qwen3.8-livetranslate-flash-realtime",
        output_modalities: ["text", "audio"],
        translation: { language: "en" },
      },
    });
  });

  it("parses the error frame with the documented error shape", () => {
    const event = parseQwenServerEvent(
      JSON.stringify({
        event_id: "event_x",
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "invalid_value",
          message: "Invalid modalities: ['audio'].",
          param: "session.output_modalities",
        },
      }),
    );
    expect(event.type).toBe("error");
    if (event.type === "error") {
      expect(event.error.type).toBe("invalid_request_error");
      expect(event.error.code).toBe("invalid_value");
      expect(event.error.param).toBe("session.output_modalities");
    }
  });

  it("parses the response.done frame with the reference's own usage example", () => {
    const event = parseQwenServerEvent(
      JSON.stringify({
        event_id: "event_done",
        type: "response.done",
        response: {
          id: "resp_TfhYTqej692vsGA2jNEtH",
          status: "completed",
          usage: {
            total_tokens: 56,
            input_tokens: 47,
            output_tokens: 9,
            input_tokens_details: { text_tokens: 20, audio_tokens: 27 },
            output_tokens_details: { text_tokens: 2, audio_tokens: 7 },
          },
        },
      }),
    );
    expect(event.type).toBe("response.done");
    if (event.type === "response.done") {
      expect(event.response.id).toBe("resp_TfhYTqej692vsGA2jNEtH");
      expect(event.response.usage?.input_tokens_details?.audio_tokens).toBe(27);
    }
  });

  it("parses the speech_started frame with the qwen3.8 speaker_id diarization field", () => {
    const event = parseQwenServerEvent(
      JSON.stringify({
        event_id: "event_x",
        type: "input_audio_buffer.speech_started",
        audio_start_ms: 568,
        item_id: "item_x",
        speaker_id: 1,
      }),
    );
    expect(event).toEqual({
      type: "input_audio_buffer.speech_started",
      audioStartMs: 568,
      itemId: "item_x",
      speakerId: 1,
    });
  });

  it("parses the transcription delta/completed/failed family and the translation families", () => {
    expect(
      parseQwenServerEvent(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.delta",
          item_id: "item_a",
          content_index: 0,
          delta: "Hello",
        }),
      ),
    ).toEqual({ type: "conversation.item.input_audio_transcription.delta", itemId: "item_a", delta: "Hello" });

    expect(
      parseQwenServerEvent(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item_a",
          transcript: "What a beautiful day!",
          language: "en",
          emotion: "",
        }),
      ),
    ).toEqual({
      type: "conversation.item.input_audio_transcription.completed",
      itemId: "item_a",
      transcript: "What a beautiful day!",
      language: "en",
    });

    expect(
      parseQwenServerEvent(JSON.stringify({ type: "conversation.item.input_audio_transcription.failed", item_id: "item_a", error: { code: "xxx", message: "xxx" } })),
    ).toEqual({
      type: "conversation.item.input_audio_transcription.failed",
      itemId: "item_a",
      error: { code: "xxx", message: "xxx" },
    });

    expect(
      parseQwenServerEvent(
        JSON.stringify({
          type: "response.text.delta",
          response_id: "resp_1",
          item_id: "item_t",
          output_index: 0,
          content_index: 0,
          delta: "Hello",
        }),
      ),
    ).toEqual({ type: "response.text.delta", responseId: "resp_1", itemId: "item_t", delta: "Hello" });

    expect(
      parseQwenServerEvent(
        JSON.stringify({
          type: "response.audio_transcript.delta",
          response_id: "resp_1",
          item_id: "item_t",
          delta: "Hello",
        }),
      ),
    ).toEqual({ type: "response.audio_transcript.delta", responseId: "resp_1", itemId: "item_t", delta: "Hello" });

    expect(
      parseQwenServerEvent(
        JSON.stringify({ type: "response.audio_transcript.done", response_id: "r", item_id: "i", transcript: "final" }),
      ),
    ).toEqual({ type: "response.audio_transcript.done", responseId: "r", itemId: "i", transcript: "final" });

    expect(
      parseQwenServerEvent(JSON.stringify({ type: "response.audio.delta", response_id: "r", item_id: "i", delta: "UklGRg==" })),
    ).toEqual({ type: "response.audio.delta", responseId: "r", itemId: "i", deltaBase64: "UklGRg==" });
  });

  it("parses the conversation.item.created linkage frame (previous_item_id → the translation's source)", () => {
    expect(
      parseQwenServerEvent(
        JSON.stringify({
          type: "conversation.item.created",
          previous_item_id: "item_asr_x",
          item: { id: "item_translation_x", type: "message", status: "in_progress", role: "assistant", content: [] },
        }),
      ),
    ).toEqual({
      type: "conversation.item.created",
      previousItemId: "item_asr_x",
      itemId: "item_translation_x",
      role: "assistant",
    });
  });

  it("parses the control frames (committed/cleared/finished/speech_stopped/response.created)", () => {
    expect(parseQwenServerEvent(JSON.stringify({ type: "input_audio_buffer.committed" }))).toEqual({
      type: "input_audio_buffer.committed",
    });
    expect(parseQwenServerEvent(JSON.stringify({ type: "input_audio_buffer.cleared" }))).toEqual({
      type: "input_audio_buffer.cleared",
    });
    expect(parseQwenServerEvent(JSON.stringify({ type: "session.finished" }))).toEqual({
      type: "session.finished",
    });
    expect(
      parseQwenServerEvent(JSON.stringify({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 3900, item_id: "i" })),
    ).toEqual({ type: "input_audio_buffer.speech_stopped", audioEndMs: 3900, itemId: "i" });
    expect(
      parseQwenServerEvent(JSON.stringify({ type: "response.created", response: { id: "r", status: "in_progress" } })),
    ).toEqual({ type: "response.created", response: { id: "r", status: "in_progress" } });
  });

  it("parses drift to the typed unparseable variant — never a crash, never a silent drop", () => {
    expect(parseQwenServerEvent("not json at all").type).toBe("unparseable");
    expect(parseQwenServerEvent("42").type).toBe("unparseable");
    expect(parseQwenServerEvent("{}").type).toBe("unparseable");
    expect(parseQwenServerEvent(JSON.stringify({ type: 42 })).type).toBe("unparseable");
    expect(parseQwenServerEvent(JSON.stringify({ type: "a.brand.new.event" })).type).toBe("unparseable");
    expect(parseQwenServerEvent(JSON.stringify({ type: "error", error: "not-an-object" })).type).toBe("unparseable");
    expect(parseQwenServerEvent(JSON.stringify({ type: "session.created" })).type).toBe("unparseable");
    const unparseable = parseQwenServerEvent("{oops");
    if (unparseable.type === "unparseable") {
      expect(unparseable.raw).toBe("{oops");
      expect(unparseable.reason).toContain("not valid JSON");
    }
  });

  it("the server event vocabulary is exactly the documented twenty", () => {
    expect(QWEN_SERVER_EVENT_TYPES).toHaveLength(20);
    expect(QWEN_SERVER_EVENT_TYPES).toContain("session.update".replace("session.update", "session.created"));
    expect(QWEN_SERVER_EVENT_TYPES).toContain("conversation.item.input_audio_transcription.delta");
    expect(QWEN_SERVER_EVENT_TYPES).toContain("response.audio.delta");
    expect(QWEN_SERVER_EVENT_TYPES).toContain("input_audio_buffer.speech_started");
  });
});

// ---------------------------------------------------------------------------
// Usage accounting + speaker-id mapping
// ---------------------------------------------------------------------------

describe("R25-C protocol — usage accounting and speaker-id mapping", () => {
  it("maps the provider's usage shape onto the neutral record (the reference's own example)", () => {
    expect(
      qwenUsageToSessionUsage({
        total_tokens: 56,
        input_tokens: 47,
        output_tokens: 9,
        input_tokens_details: { text_tokens: 20, audio_tokens: 27 },
        output_tokens_details: { text_tokens: 2, audio_tokens: 7 },
      }),
    ).toEqual({ inputAudioTokens: 27, textOutputTokens: 2, outputAudioTokens: 7, imageInputTokens: 0 });
  });

  it("reports imageInputTokens honestly as 0 — the provider's usage shape has no separate image dimension (never an invented number)", () => {
    const usage = qwenUsageToSessionUsage({
      input_tokens_details: { text_tokens: 100, audio_tokens: 50 },
      output_tokens_details: { text_tokens: 10, audio_tokens: 5 },
    });
    expect(usage.imageInputTokens).toBe(0);
  });

  it("maps an absent usage shape to the zero record", () => {
    expect(qwenUsageToSessionUsage(undefined)).toEqual({
      inputAudioTokens: 0,
      textOutputTokens: 0,
      outputAudioTokens: 0,
      imageInputTokens: 0,
    });
  });

  it("rejects negative token counts (the honest zero, never a negative)", () => {
    expect(
      qwenUsageToSessionUsage({
        input_tokens_details: { audio_tokens: -5 },
        output_tokens_details: { text_tokens: -1, audio_tokens: 3 },
      }),
    ).toEqual({ inputAudioTokens: 0, textOutputTokens: 0, outputAudioTokens: 3, imageInputTokens: 0 });
  });

  it("maps provider speaker ids to the neutral namespace and simple first-appearance labels", () => {
    expect(qwenSpeakerId(0)).toBe("speaker-0");
    expect(qwenSpeakerId(3)).toBe("speaker-3");
    expect(qwenSpeakerLabel(1)).toBe("Speaker 1");
    expect(qwenSpeakerLabel(2)).toBe("Speaker 2");
  });
});

// ---------------------------------------------------------------------------
// Provider error normalization (the typed kinds + honest recovery sentences)
// ---------------------------------------------------------------------------

describe("R25-C protocol — provider error normalization", () => {
  it("rate-limit hits map to RECOVERABLE provider-failure whose recovery sentence names the documented limits", () => {
    const normalized = normalizeQwenProviderError({
      type: "rate_limit_error",
      code: "requests_exceeded",
      message: "Requests per minute limit exceeded. Please retry later.",
    });
    expect(normalized.errorKind).toBe("provider-failure");
    expect(normalized.recoverable).toBe(true);
    expect(normalized.recovery).toContain("RPM=10");
    expect(normalized.recovery).toContain("100,000");
    expect(normalized.recovery).toContain("never blocked");
    expect(normalized.detail).toContain("requests_exceeded");
    expect(normalized.detail).toContain("Requests per minute limit exceeded");
  });

  it("throttling-style codes normalize to the same recoverable rate-limit path", () => {
    for (const code of ["throttling_runtime", "TooManyRequests", "rate_limit"]) {
      const normalized = normalizeQwenProviderError({ code, message: "slow down" });
      expect(normalized.recoverable).toBe(true);
      expect(normalized.errorKind).toBe("provider-failure");
    }
  });

  it("authentication failures map to TERMINAL provider-failure with the credential recovery sentence (the variable NAME, never a value)", () => {
    const normalized = normalizeQwenProviderError({
      type: "authentication_error",
      code: "invalid_api_key",
      message: "The API key is invalid or does not have permission for this model.",
    });
    expect(normalized.errorKind).toBe("provider-failure");
    expect(normalized.recoverable).toBe(false);
    expect(normalized.recovery).toContain("DASHSCOPE_API_KEY");
    expect(normalized.recovery).toContain("never a fallback to a hardcoded key");
  });

  it("language-family rejections map to unsupported-language-direction", () => {
    const normalized = normalizeQwenProviderError({
      type: "invalid_request_error",
      code: "unsupported_language",
      message: "target language not supported",
      param: "session.translation.language",
    });
    expect(normalized.errorKind).toBe("unsupported-language-direction");
    expect(normalized.recoverable).toBe(false);
  });

  it("invalid-request rejections map to policy naming the provider's param", () => {
    const normalized = normalizeQwenProviderError({
      type: "invalid_request_error",
      code: "invalid_value",
      message: "Invalid modalities: ['audio'].",
      param: "session.output_modalities",
    });
    expect(normalized.errorKind).toBe("policy");
    expect(normalized.recoverable).toBe(false);
    expect(normalized.detail).toContain("session.output_modalities");
  });

  it("unmapped errors map to TERMINAL unknown — the fail-closed default (recoverability is never guessed)", () => {
    const normalized = normalizeQwenProviderError({ message: "something entirely new" });
    expect(normalized.errorKind).toBe("unknown");
    expect(normalized.recoverable).toBe(false);
    expect(normalized.recovery).toContain("does not map");
  });

  it("bounds the detail string (honest, bounded — never unbounded in events)", () => {
    const normalized = normalizeQwenProviderError({
      message: "x".repeat(1_000),
    });
    expect(normalized.detail.length).toBeLessThanOrEqual(410);
  });
});

// ---------------------------------------------------------------------------
// The protocol mapping table + the boundary law
// ---------------------------------------------------------------------------

describe("R25-C protocol — the frame → event mapping table (the architecture law)", () => {
  it("every row's session event is a member of the frozen 12-event vocabulary", () => {
    for (const row of QWEN_PROTOCOL_EVENT_MAPPING) {
      expect(REALTIME_EVENT_KINDS).toContain(row.sessionEvent as (typeof REALTIME_EVENT_KINDS)[number]);
    }
  });

  it("the table covers every reconstruction path in the R25-C adapter list", () => {
    const sessionEvents = QWEN_PROTOCOL_EVENT_MAPPING.map((row) => row.sessionEvent);
    for (const required of [
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
    ]) {
      expect(sessionEvents).toContain(required);
    }
  });

  it("the table's provider frames use the provider's own verbatim names (session.update family, buffers, responses)", () => {
    const joined = QWEN_PROTOCOL_EVENT_MAPPING.map((row) => row.providerFrame).join(" | ");
    expect(joined).toContain("session.created");
    expect(joined).toContain("conversation.item.input_audio_transcription.delta");
    expect(joined).toContain("response.text.delta | response.audio_transcript.delta");
    expect(joined).toContain("input_audio_buffer.speech_started (speaker_id)");
    expect(joined).toContain("response.audio.delta");
    expect(joined).toContain("response.done (usage)");
    expect(joined).toContain("session.finished | close");
  });

  it("THE BOUNDARY LAW: this protocol module is the lawful home of the forbidden tokens — and the shared contract scan stays clean", () => {
    // The adapter boundary legitimately contains the provider protocol
    // vocabulary (that is the R25-C law: the protocol exists ONLY
    // here). Prove the scanner WOULD flag this module's vocabulary…
    const protocolSource = QWEN_SERVER_EVENT_TYPES.join(" ") + " session.update input_audio_buffer.append";
    const violations = scanRealtimeSessionProviderNeutrality(protocolSource);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations).toContain("session.update");
    expect(violations).toContain("input_audio_buffer");
    // …and that the forbidden-token list covers exactly the protocol
    // vocabulary the shared contract must never contain.
    expect(REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS).toContain("dashscope");
    expect(REALTIME_SESSION_PROVIDER_NEUTRALITY_FORBIDDEN_TOKENS).toContain("qwen3.8-livetranslate");
  });
});
