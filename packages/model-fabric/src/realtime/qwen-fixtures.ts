/**
 * @wfx/model-fabric — the recorded Qwen LiveTranslate provider frames
 * + the deterministic transport double (R25-C TEST FIXTURES).
 *
 * TEST FIXTURES ONLY — NEVER PRODUCTION (the `testing.ts` law: a
 * fixture is never a production provider; the recorded double exists
 * so the adapter is fully unit-testable WITHOUT the live endpoint —
 * the R25-C adapter law #3).
 *
 * THE RECORDED FRAMES: every frame string below is a RECORDED
 * provider frame in the exact documented wire shape (field names,
 * nesting, and the reference's own example values where it gives
 * them — event ids, item ids, response ids, and the usage example
 * 56/47/9 with 20/27 input text/audio and 2/7 output text/audio),
 * from the live-checked QwenCloud LiveTranslate client/server events
 * reference (2026-09-22). The double replays them deterministically,
 * driven by the ADAPTER's own actions (connect → session.created;
 * session.update → session.updated; each audio append → one full
 * recorded utterance cycle with alternating diarized speakers), with
 * scripted failure injection for every recovery path:
 *
 * - `failFirstConnects`    — the network path (connect rejects);
 * - `rateLimitOnConnect`   — the documented rate-limit error frame;
 * - `authErrorOnConnect`   — the invalid-credential error frame;
 * - `dropAfterCycles`      — mid-session transport loss (reconnect);
 * - `closeWithoutFinish`   — the provider closing un-cleanly;
 * - `injectErrorFrame`     — any arbitrary provider error frame;
 * - `audioOutputModality`  — the text+audio cycle family.
 *
 * No real timers: frame delivery is microtask-ordered, so the battery
 * is deterministic and instant. The double logs every client frame it
 * receives (the serialization under test) and every connect attempt
 * (the smoothing/reconnect policy under test).
 */

import { bytesToBase64 } from "./qwen-protocol";
import type {
  QwenRealtimeConnection,
  QwenRealtimeTransport,
} from "./qwen-adapter";

// ---------------------------------------------------------------------------
// The recorded provider frames (verbatim documented shapes)
// ---------------------------------------------------------------------------

/** The recorded session.created frame (the reference's own example shape). */
export const RECORDED_QWEN_SESSION_CREATED = JSON.stringify({
  event_id: "event_sess_created_0001",
  type: "session.created",
  session: {
    id: "sess_recorded_0001",
    object: "realtime.session",
    model: "qwen3.8-livetranslate-flash-realtime",
    input_modalities: ["audio"],
    output_modalities: ["text", "audio"],
    audio: {
      input: {
        format: { type: "pcm", sample_rate: 16000 },
        turn_detection: { type: "speaker_detection", threshold: 0.5, silence_duration_ms: 1000 },
      },
      output: {
        format: { type: "pcm", sample_rate: 24000 },
        voice: "Tina",
      },
    },
    translation: { language: "en" },
  },
});

/** The recorded session.updated echo (sent after the adapter's session.update). */
export const RECORDED_QWEN_SESSION_UPDATED = JSON.stringify({
  event_id: "event_sess_updated_0002",
  type: "session.updated",
  session: {
    id: "sess_recorded_0001",
    object: "realtime.session",
    model: "qwen3.8-livetranslate-flash-realtime",
    input_modalities: ["audio"],
    output_modalities: ["text", "audio"],
    audio: {
      input: {
        format: { type: "pcm", sample_rate: 16000 },
        turn_detection: { type: "speaker_detection", threshold: 0.5, silence_duration_ms: 1000 },
      },
      output: {
        format: { type: "pcm", sample_rate: 24000 },
        voice: "Tina",
      },
    },
    translation: { language: "en" },
  },
});

/** The recorded rate-limit error frame (the documented error shape, rate-limit family). */
export const RECORDED_QWEN_RATE_LIMIT_ERROR = JSON.stringify({
  event_id: "event_ratelimit_0003",
  type: "error",
  error: {
    type: "rate_limit_error",
    code: "requests_exceeded",
    message: "Requests per minute limit exceeded. Please retry later.",
    param: "",
  },
});

/** The recorded invalid-credential error frame (the auth family). */
export const RECORDED_QWEN_AUTH_ERROR = JSON.stringify({
  event_id: "event_auth_0004",
  type: "error",
  error: {
    type: "authentication_error",
    code: "invalid_api_key",
    message: "The API key is invalid or does not have permission for this model.",
    param: "",
  },
});

/** The recorded invalid-request error frame (the config-rejection family). */
export const RECORDED_QWEN_INVALID_REQUEST_ERROR = JSON.stringify({
  event_id: "event_invalid_0005",
  type: "error",
  error: {
    type: "invalid_request_error",
    code: "invalid_value",
    message: "Invalid modalities: ['audio']. Supported combinations are: ['text'] and ['audio', 'text'].",
    param: "session.output_modalities",
  },
});

/** The recorded session.finished frame (the graceful end-of-input ack). */
export const RECORDED_QWEN_SESSION_FINISHED = JSON.stringify({
  event_id: "event_sess_finished_0006",
  type: "session.finished",
});

/**
 * The recorded usage numbers (the reference's response.done usage
 * example, verbatim): total 56, input 47 (text 20 / audio 27),
 * output 9 (text 2 / audio 7). The neutral usage record these map
 * onto: inputAudioTokens 27, textOutputTokens 2, outputAudioTokens 7.
 */
export const RECORDED_QWEN_USAGE_EXAMPLE: Readonly<{
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  inputTextTokens: number;
  inputAudioTokens: number;
  outputTextTokens: number;
  outputAudioTokens: number;
}> = {
  totalTokens: 56,
  inputTokens: 47,
  outputTokens: 9,
  inputTextTokens: 20,
  inputAudioTokens: 27,
  outputTextTokens: 2,
  outputAudioTokens: 7,
};

/** A deterministic tiny PCM payload for translated-audio-chunk decoding tests. */
export const RECORDED_QWEN_AUDIO_PAYLOAD_BYTES: Readonly<Uint8Array> = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x10, 0x00, 0x01, 0x00, 0x80, 0x3e, 0x00, 0x00,
  0x00, 0x3e, 0x00, 0x00, 0x04, 0x00, 0x20, 0x00, 0x64, 0x61, 0x74, 0x61,
]);

/** The recorded frame as the Base64 string the provider sends. */
export const RECORDED_QWEN_AUDIO_DELTA_BASE64: string = bytesToBase64(
  RECORDED_QWEN_AUDIO_PAYLOAD_BYTES,
);

/**
 * Build ONE recorded utterance cycle for a given diarized speaker and
 * modality — the frames the provider emits around one detected
 * utterance (speech_started with the speaker id → source transcript
 * deltas → completed with detected language → the translation item
 * linked through previous_item_id → translation deltas → done → the
 * response with its usage). All field shapes are the documented ones;
 * ids are cycle-indexed so multi-cycle sessions stay deterministic.
 *
 * PURE (a frame factory over the recorded shapes).
 */
export function recordedQwenUtteranceCycle(input: {
  readonly cycleIndex: number;
  readonly speakerId: number;
  readonly audioOutput: boolean;
  readonly sourceText: string;
  readonly translationText: string;
  readonly sourceLanguage?: string;
}): readonly string[] {
  const n = input.cycleIndex;
  const itemId = `item_asr_${n}`;
  const translationItemId = `item_translation_${n}`;
  const responseId = `resp_${n}`;
  const frames: string[] = [
    JSON.stringify({
      event_id: `event_speech_started_${n}`,
      type: "input_audio_buffer.speech_started",
      audio_start_ms: 1200 + n * 3000,
      item_id: itemId,
      speaker_id: input.speakerId,
    }),
    JSON.stringify({
      event_id: `event_transcription_delta_${n}a`,
      type: "conversation.item.input_audio_transcription.delta",
      item_id: itemId,
      content_index: 0,
      delta: input.sourceText.slice(0, Math.ceil(input.sourceText.length / 2)),
    }),
    JSON.stringify({
      event_id: `event_transcription_delta_${n}b`,
      type: "conversation.item.input_audio_transcription.delta",
      item_id: itemId,
      content_index: 0,
      delta: input.sourceText.slice(Math.ceil(input.sourceText.length / 2)),
    }),
    JSON.stringify({
      event_id: `event_speech_stopped_${n}`,
      type: "input_audio_buffer.speech_stopped",
      audio_end_ms: 2700 + n * 3000,
      item_id: itemId,
    }),
    JSON.stringify({
      event_id: `event_transcription_completed_${n}`,
      type: "conversation.item.input_audio_transcription.completed",
      item_id: itemId,
      content_index: 0,
      transcript: input.sourceText,
      language: input.sourceLanguage ?? "zh",
      emotion: "",
    }),
    JSON.stringify({
      event_id: `event_item_created_${n}`,
      type: "conversation.item.created",
      previous_item_id: itemId,
      item: {
        id: translationItemId,
        object: "realtime.item",
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      },
    }),
    JSON.stringify({
      event_id: `event_translation_delta_${n}a`,
      type: input.audioOutput ? "response.audio_transcript.delta" : "response.text.delta",
      response_id: responseId,
      item_id: translationItemId,
      output_index: 0,
      content_index: 0,
      delta: input.translationText.slice(0, Math.ceil(input.translationText.length / 2)),
    }),
    JSON.stringify({
      event_id: `event_translation_delta_${n}b`,
      type: input.audioOutput ? "response.audio_transcript.delta" : "response.text.delta",
      response_id: responseId,
      item_id: translationItemId,
      output_index: 0,
      content_index: 0,
      delta: input.translationText.slice(Math.ceil(input.translationText.length / 2)),
    }),
  ];

  if (input.audioOutput) {
    frames.push(
      JSON.stringify({
        event_id: `event_audio_delta_${n}`,
        type: "response.audio.delta",
        response_id: responseId,
        item_id: translationItemId,
        output_index: 0,
        content_index: 0,
        delta: RECORDED_QWEN_AUDIO_DELTA_BASE64,
      }),
      JSON.stringify({
        event_id: `event_audio_done_${n}`,
        type: "response.audio.done",
        response_id: responseId,
        item_id: translationItemId,
        output_index: 0,
        content_index: 0,
      }),
      JSON.stringify({
        event_id: `event_audio_transcript_done_${n}`,
        type: "response.audio_transcript.done",
        response_id: responseId,
        item_id: translationItemId,
        output_index: 0,
        content_index: 0,
        transcript: input.translationText,
      }),
    );
  } else {
    frames.push(
      JSON.stringify({
        event_id: `event_translation_done_${n}`,
        type: "response.text.done",
        response_id: responseId,
        item_id: translationItemId,
        output_index: 0,
        content_index: 0,
        text: input.translationText,
      }),
    );
  }

  frames.push(
    JSON.stringify({
      event_id: `event_response_done_${n}`,
      type: "response.done",
      response: {
        id: responseId,
        object: "realtime.response",
        conversation_id: `conv_${n}`,
        status: "completed",
        modalities: input.audioOutput ? ["text", "audio"] : ["text"],
        voice: "Tina",
        output_audio_format: "pcm16",
        output: [],
        usage: {
          total_tokens: RECORDED_QWEN_USAGE_EXAMPLE.totalTokens,
          input_tokens: RECORDED_QWEN_USAGE_EXAMPLE.inputTokens,
          output_tokens: RECORDED_QWEN_USAGE_EXAMPLE.outputTokens,
          input_tokens_details: {
            text_tokens: RECORDED_QWEN_USAGE_EXAMPLE.inputTextTokens,
            audio_tokens: RECORDED_QWEN_USAGE_EXAMPLE.inputAudioTokens,
          },
          output_tokens_details: {
            text_tokens: RECORDED_QWEN_USAGE_EXAMPLE.outputTextTokens,
            audio_tokens: RECORDED_QWEN_USAGE_EXAMPLE.outputAudioTokens,
          },
        },
      },
    }),
  );
  return frames;
}

/**
 * THE COMPLETE RECORDED SESSION FLOW (two diarized utterance cycles,
 * text-only output): the frame sequence a real session produces for
 * two alternating speakers, including the diarization linkage. The
 * deterministic double replays exactly this shape.
 */
export const RECORDED_QWEN_SESSION_FLOW: readonly string[] = [
  ...recordedQwenUtteranceCycle({
    cycleIndex: 0,
    speakerId: 0,
    audioOutput: false,
    sourceText: "今天天气真好，我们去公园散步吧。",
    translationText: "The weather is really nice today; let's take a walk in the park.",
    sourceLanguage: "zh",
  }),
  ...recordedQwenUtteranceCycle({
    cycleIndex: 1,
    speakerId: 1,
    audioOutput: false,
    sourceText: "好主意！我还想买点咖啡。",
    translationText: "Great idea! I'd also like to grab some coffee.",
    sourceLanguage: "zh",
  }),
];

// ---------------------------------------------------------------------------
// The deterministic transport double (TEST FIXTURE — never production)
// ---------------------------------------------------------------------------

/** One client frame the double received (the serialization under test). */
export interface RecordedQwenClientFrame {
  /** The frame as the adapter serialized it (the exact JSON text). */
  readonly text: string;
  /** The parsed type field (for convenient assertions). */
  readonly type: string;
}

/** One connect attempt the double observed. */
export interface RecordedQwenConnect {
  readonly url: string;
  readonly authorizationHeader: string;
  readonly attempt: number;
}

/** The scripted behaviors the double can inject (every recovery path). */
export interface RecordedQwenTransportScript {
  /** How many times connect() REJECTS before succeeding (the network path). Default 0. */
  readonly failFirstConnects?: number;
  /** Replay the rate-limit error frame right after session.created (the RPM path). Default false. */
  readonly rateLimitOnConnect?: boolean;
  /** Replay the invalid-credential error frame right after session.created. Default false. */
  readonly authErrorOnConnect?: boolean;
  /** Drop the connection (un-clean close) after N completed utterance cycles (the reconnect path). Default: never. */
  readonly dropAfterCycles?: number;
  /** Close the connection with session.finished NEVER sent (the un-clean provider close). Default false. */
  readonly closeWithoutFinish?: boolean;
  /** Replay an arbitrary error frame right after session.created (config-rejection path). */
  readonly injectErrorFrame?: string;
  /** The output-modality family the utterance cycles use. Default "text". */
  readonly audioOutputModality?: "text" | "text-and-audio";
  /** The utterance cycle content (deterministic; two cycles by default). */
  readonly cycles?: readonly {
    speakerId: number;
    sourceText: string;
    translationText: string;
    sourceLanguage?: string;
  }[];
}

/** The deterministic double's observable state (the assertions' surface). */
export interface RecordedQwenTransportDouble {
  readonly transport: QwenRealtimeTransport;
  /** Every client frame received, in order (the exact serialized JSON). */
  readonly sentFrames: readonly RecordedQwenClientFrame[];
  /** Every connect attempt, in order (URL + auth header shape). */
  readonly connects: readonly RecordedQwenConnect[];
  /** How many utterance cycles have been delivered. */
  readonly deliveredCycles: () => number;
  /** Whether the connection is currently open. */
  readonly isOpen: () => boolean;
  /** The frames the double delivered, in order (observability). */
  readonly deliveredFrames: readonly string[];
}

/**
 * Create the deterministic recorded-frame transport double (TEST
 * FIXTURE — never production). The double implements the injectable
 * `QwenRealtimeTransport` seam: connect() replays the recorded
 * session.created (+ any scripted error), the adapter's session.update
 * is answered with the recorded session.updated echo, and each
 * input_audio_buffer.append drives one recorded utterance cycle
 * (speaker alternation scripted). Microtask delivery — no real
 * timers, fully deterministic.
 */
export function createRecordedQwenTransport(
  script: RecordedQwenTransportScript = {},
): RecordedQwenTransportDouble {
  const sentFrames: RecordedQwenClientFrame[] = [];
  const connects: RecordedQwenConnect[] = [];
  const deliveredFrames: string[] = [];
  const cycles =
    script.cycles ??
    [
      {
        speakerId: 0,
        sourceText: "今天天气真好，我们去公园散步吧。",
        translationText: "The weather is really nice today; let's take a walk in the park.",
        sourceLanguage: "zh",
      },
      {
        speakerId: 1,
        sourceText: "好主意！我还想买点咖啡。",
        translationText: "Great idea! I'd also like to grab some coffee.",
        sourceLanguage: "zh",
      },
    ];
  const audioOutput = script.audioOutputModality === "text-and-audio";
  let connectAttempt = 0;
  let cycleCursor = 0;
  let deliveredCycleCount = 0;
  let open = false;

  const deliver = (connection: FakeConnection, frame: string): void => {
    deliveredFrames.push(frame);
    connection.emitMessage(frame);
  };

  class FakeConnection implements QwenRealtimeConnection {
    private messageHandler: ((text: string) => void) | undefined;
    private closeHandler: ((code: number, reason: string) => void) | undefined;
    private closed = false;

    send(text: string): void {
      if (this.closed) return;
      let type = "";
      try {
        const parsed = JSON.parse(text) as { type?: unknown };
        type = typeof parsed.type === "string" ? parsed.type : "";
      } catch {
        type = "";
      }
      sentFrames.push({ text, type });
      void this.handleSent(type);
    }

    onMessage(handler: (text: string) => void): void {
      this.messageHandler = handler;
    }

    onClose(handler: (code: number, reason: string) => void): void {
      this.closeHandler = handler;
    }

    close(): void {
      if (this.closed) return;
      this.closed = true;
      open = false;
    }

    emitMessage(frame: string): void {
      if (this.closed) return;
      // Microtask delivery — deterministic ordering without real timers.
      void Promise.resolve().then(() => {
        if (this.closed) return;
        this.messageHandler?.(frame);
      });
    }

    emitClose(code: number, reason: string): void {
      if (this.closed) return;
      this.closed = true;
      open = false;
      void Promise.resolve().then(() => {
        this.closeHandler?.(code, reason);
      });
    }

    private async handleSent(type: string): Promise<void> {
      // One microtask hop so the adapter's send() returns first.
      await Promise.resolve();
      if (this.closed) return;
      if (type === "session.update") {
        deliver(this, RECORDED_QWEN_SESSION_UPDATED);
        return;
      }
      if (type === "input_audio_buffer.append") {
        if (cycleCursor >= cycles.length) return; // no more scripted speech
        const cycle = cycles[cycleCursor]!;
        cycleCursor += 1;
        const frames = recordedQwenUtteranceCycle({
          cycleIndex: deliveredCycleCount,
          speakerId: cycle.speakerId,
          audioOutput,
          sourceText: cycle.sourceText,
          translationText: cycle.translationText,
          ...(cycle.sourceLanguage !== undefined ? { sourceLanguage: cycle.sourceLanguage } : {}),
        });
        for (const frame of frames) {
          await Promise.resolve();
          if (this.closed) return;
          deliver(this, frame);
        }
        deliveredCycleCount += 1;
        if (
          script.dropAfterCycles !== undefined &&
          deliveredCycleCount >= script.dropAfterCycles
        ) {
          this.emitClose(1006, "recorded transport loss");
        }
        return;
      }
      if (type === "session.finish") {
        if (script.closeWithoutFinish === true) {
          this.emitClose(1000, "recorded provider close without finish");
          return;
        }
        deliver(this, RECORDED_QWEN_SESSION_FINISHED);
        this.closed = true;
        open = false;
        return;
      }
      // input_image_buffer.append / commits carry no scripted reply
      // (the documented protocol sends none for them).
    }
  }

  const transport: QwenRealtimeTransport = {
    async connect(request: { url: string; authorizationHeader: string }) {
      connectAttempt += 1;
      connects.push({
        url: request.url,
        authorizationHeader: request.authorizationHeader,
        attempt: connectAttempt,
      });
      if (
        script.failFirstConnects !== undefined &&
        connectAttempt <= script.failFirstConnects
      ) {
        throw new Error(`recorded connect failure #${connectAttempt}`);
      }
      const connection = new FakeConnection();
      open = true;
      deliver(connection, RECORDED_QWEN_SESSION_CREATED);
      if (script.injectErrorFrame !== undefined) {
        deliver(connection, script.injectErrorFrame);
      }
      if (script.rateLimitOnConnect === true) {
        deliver(connection, RECORDED_QWEN_RATE_LIMIT_ERROR);
      }
      if (script.authErrorOnConnect === true) {
        deliver(connection, RECORDED_QWEN_AUTH_ERROR);
      }
      return connection;
    },
  };

  return {
    transport,
    sentFrames,
    connects,
    deliveredCycles: () => deliveredCycleCount,
    isOpen: () => open,
    deliveredFrames,
  };
}

/** Brand check: the double is a TEST FIXTURE, never production wiring. */
export const RECORDED_QWEN_TRANSPORT_IS_TEST_FIXTURE = true as const;
