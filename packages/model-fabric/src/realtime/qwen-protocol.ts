/**
 * @wfx/model-fabric — the Qwen LiveTranslate realtime protocol (R25-C).
 *
 * THE LAW THIS MODULE OWNS (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-C): the ENTIRE
 * Qwen/DashScope realtime-translation protocol lives HERE, inside the
 * model-fabric provider-adapter boundary. The plan's R25-C list is
 * this module's table of contents:
 *
 * - the WebSocket URL + model id (provenance-named, env-overridable
 *   in the adapter config — never a client string, never guessed);
 * - `session.update` serialization (the qwen3.8 parameter family:
 *   `output_modalities`, `audio.input.turn_detection`, `translation`,
 *   `translation.corpus.phrases` hotwords, consent-gated voice
 *   cloning);
 * - `input_audio_buffer.append` / `input_image_buffer.append`
 *   serialization (Base64 payloads);
 * - response event parsing (the server event vocabulary, fail-closed
 *   on unknown frames);
 * - source transcript reconstruction inputs (the
 *   `conversation.item.input_audio_transcription.*` family);
 * - translation delta reconstruction inputs (the `response.text.*` /
 *   `response.audio_transcript.*` / `response.audio.*` families);
 * - audio chunk decoding (Base64 → bytes, pcm16);
 * - speaker-id mapping (the `speaker_detection` diarization truth);
 * - hotword configuration (the normalized vocabulary → the provider's
 *   `corpus.phrases` syntax);
 * - usage accounting inputs (the `response.done` usage shape → the
 *   provider-neutral `RealtimeSessionUsage`);
 * - provider error normalization (provider error codes → the typed
 *   neutral error kinds + honest recovery sentences).
 *
 * THE BOUNDARY LAW (the R25 rejection criteria, encoded): nothing in
 * this module's vocabulary crosses into shared Product/Experience
 * code. This module is exported through the model-fabric public entry
 * ONLY so the adapter, its recorded-frame test doubles, and the
 * server-side bridge (R25-D) can share it — the shared realtime
 * session contract (`session.ts`, `@wfx/domain`) contains none of it,
 * enforced by the forbidden-token scanner. Client code (the browser
 * bundle) never imports this package's adapter path: the bridge owns
 * the browser→WebFlix hop, and the CREDENTIAL never leaves the
 * server environment.
 *
 * PROVENANCE (the research truth, lead-verified 2026-09-20/21 and
 * re-verified live 2026-09-22 against the QwenCloud LiveTranslate
 * client/server events reference): the pinned model is
 * `qwen3.8-livetranslate-flash-realtime` served over a JSON-text-frame
 * WebSocket; the documented endpoint is the QwenCloud MaaS realtime
 * endpoint `wss://maas.qwencloudapi.com/api-ws/v1/realtime?model=…`
 * with `Authorization: Bearer $DASHSCOPE_API_KEY`; the Alibaba Cloud
 * Model Studio international endpoint is the named deployment
 * alternative (the rate-limit + pricing truth's home). Live-endpoint
 * verification runs are the lead's procedure (the R25-C gate law —
 * `scripts/verify-live-qwen-realtime.ts` is the honest harness).
 */

import type {
  RealtimeHotwordMapping,
  RealtimeSessionUsage,
  RealtimeSpeakerAttributionMode,
  RealtimeTranslationErrorKind,
  RealtimeTranslationSessionInputs,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// The endpoint + model identity (provenance-named adapter config truth)
// ---------------------------------------------------------------------------

/**
 * The pinned model id of the managed realtime translation specialist —
 * exactly the registered provider record's model identity (one truth,
 * two views; the adapter battery asserts the agreement). Provenance:
 * the R25 plan's lead-verified research summary.
 */
export const QWEN_LIVETRANSLATE_MODEL_ID = "qwen3.8-livetranslate-flash-realtime";

/** Where the model id truth came from (never a guess). */
export const QWEN_LIVETRANSLATE_MODEL_ID_PROVENANCE =
  "docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md — the lead-verified research summary (2026-09-20); agrees with the QwenCloud LiveTranslate API reference (live-checked 2026-09-22)";

/**
 * The documented QwenCloud MaaS realtime WebSocket endpoint the adapter
 * connects to by default (the model rides the `model` query parameter).
 * Provenance: the QwenCloud LiveTranslate client-events reference.
 */
export const QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD =
  "wss://maas.qwencloudapi.com/api-ws/v1/realtime";

/** Where the default endpoint truth came from. */
export const QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD_PROVENANCE =
  "docs.qwencloud.com/api-reference/speech-translation/livetranslate-realtime/client-events — the documented Connect endpoint (live-checked 2026-09-22)";

/**
 * The Alibaba Cloud Model Studio (International) realtime WebSocket
 * endpoint — the named deployment ALTERNATIVE for Model Studio
 * deployments (where the International rate limits and the indicative
 * pricing were documented). Selected through the adapter config's
 * endpoint override or the `QWEN_LIVETRANSLATE_WS_URL` environment
 * variable — never a silent default switch.
 */
export const QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_INTERNATIONAL =
  "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference";

/** Where the Model Studio alternative endpoint truth came from. */
export const QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_PROVENANCE =
  "docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md — the Alibaba Cloud Model Studio production-endpoint research finding (International service, lead-verified 2026-09-20)";

/**
 * The environment variable the adapter's credential path reads. The
 * provider's own documentation names it (`Authorization: Bearer
 * $DASHSCOPE_API_KEY`) on BOTH the QwenCloud and Model Studio
 * services — one name, one truth. The value lives ONLY in the server
 * environment (the operator secrets store / the platform env store);
 * it is never hardcoded, never defaulted, never logged, and never
 * bundled into client code.
 */
export const QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE = "DASHSCOPE_API_KEY";

// ---------------------------------------------------------------------------
// The documented rate limits (the retry/smoothing policy's truth)
// ---------------------------------------------------------------------------

/**
 * The documented International rate limits of the managed realtime
 * translation service — the adapter's retry/smoothing policy honors
 * them exactly (session-start smoothing derived from RPM; the typed
 * recoverable-error recovery hint names them). Reported figures from
 * the lead-verified research; never a guarantee, never a silent cap.
 */
export const QWEN_LIVETRANSLATE_RATE_LIMITS: Readonly<{
  /** Requests per minute (International). */
  readonly requestsPerMinute: number;
  /** Tokens per minute (International). */
  readonly tokensPerMinute: number;
  readonly basis: string;
}> = {
  requestsPerMinute: 10,
  tokensPerMinute: 100_000,
  basis: "the documented International rate limits from the R25 plan's lead-verified research (RPM=10, TPM=100,000) — the adapter smooths session starts to the RPM cadence and maps rate-limit hits to typed recoverable errors with these numbers in the recovery sentence",
};

/** The minimum interval between provider session starts the RPM implies (ms). */
export function qwenSessionStartMinIntervalMs(
  limits: Readonly<{ requestsPerMinute: number }> = QWEN_LIVETRANSLATE_RATE_LIMITS,
): number {
  if (limits.requestsPerMinute <= 0) return 0;
  return Math.ceil(60_000 / limits.requestsPerMinute);
}

// ---------------------------------------------------------------------------
// The documented input/output media truth (pcm16, 16 kHz in / 24 kHz out)
// ---------------------------------------------------------------------------

/**
 * The documented audio I/O truth of the pinned model: raw PCM input at
 * 16 kHz, PCM output at 24 kHz. The neutral `RealtimeTranslatedAudioFormat`
 * vocabulary maps the output side to `'pcm16'`.
 */
export const QWEN_LIVETRANSLATE_AUDIO_IO: Readonly<{
  readonly inputFormat: "pcm";
  readonly inputSampleRateHz: number;
  readonly outputFormat: "pcm";
  readonly outputSampleRateHz: number;
  readonly outputVoiceDefault: string;
  readonly basis: string;
}> = {
  inputFormat: "pcm",
  inputSampleRateHz: 16_000,
  outputFormat: "pcm",
  outputSampleRateHz: 24_000,
  outputVoiceDefault: "Tina",
  basis: "the QwenCloud LiveTranslate server-events reference (session.created defaults: pcm/16 kHz input, pcm/24 kHz output, voice Tina) — live-checked 2026-09-22",
};

/**
 * The documented image-input constraints the adapter enforces honestly
 * (typed refusals, never silent drops): JPEG format, ≤ 500 KiB before
 * Base64, and at most 2 frames per second. The shared adaptive visual
 * sampling policy (6 frames/minute hard ceiling) is far stricter —
 * these limits are the provider's own fence the adapter double-checks.
 */
export const QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS: Readonly<{
  readonly maxBytesBeforeBase64: number;
  readonly maxFramesPerSecond: number;
  readonly acceptedFormats: readonly string[];
  readonly basis: string;
}> = {
  maxBytesBeforeBase64: 500 * 1024,
  maxFramesPerSecond: 2,
  acceptedFormats: ["JPG", "JPEG"],
  basis: "the QwenCloud LiveTranslate client-events reference (input_image_buffer.append limits) — live-checked 2026-09-22",
};

// ---------------------------------------------------------------------------
// The client frame vocabulary (serialization — the provider's own names)
// ---------------------------------------------------------------------------

/** Every client frame type the adapter can send (the documented set). */
export const QWEN_CLIENT_FRAME_TYPES: readonly string[] = [
  "session.update",
  "input_audio_buffer.append",
  "input_image_buffer.append",
  "input_audio_buffer.commit",
  "input_audio_buffer.clear",
  "session.finish",
] as const;

/** The client frame union (typed). */
export type QwenClientFrameType = (typeof QWEN_CLIENT_FRAME_TYPES)[number];

/** The wire shape of one serialized client frame (JSON text frame). */
export interface QwenClientFrame {
  readonly type: QwenClientFrameType;
  readonly event_id?: string;
  readonly session?: Record<string, unknown>;
  readonly audio?: string;
  readonly image?: string;
}

/** The event-id scheme the provider's own examples use (`event_<ms>`). */
export function qwenEventId(nowMs: number): string {
  return `event_${nowMs}`;
}

// ---------------------------------------------------------------------------
// session.update serialization (the qwen3.8 parameter family)
// ---------------------------------------------------------------------------

/**
 * Serialize the provider `session.update` frame from the frozen,
 * provider-neutral session inputs (PURE — the one translation point
 * from the shared vocabulary into the provider's syntax).
 *
 * The qwen3.8 parameter family (per the live-checked reference):
 * - `output_modalities` — `["text"]` or `["text", "audio"]` (the
 *   neutral output-modality union maps 1:1);
 * - `audio.input.turn_detection.type` — `"speaker_detection"` (the
 *   model's realtime diarization, the speaker-attribution source)
 *   when the session wants speaker attribution; `"server_vad"` when
 *   attribution is off;
 * - `translation.language` — the target language;
 * - `translation.corpus.phrases` — the hotword mapping in the
 *   provider's own syntax (the source term → the preferred target
 *   rendering), only when hotwords exist;
 * - `input_audio_transcription.language` — the source-language hint,
 *   only when one is present (the model auto-detects otherwise; the
 *   model's ASR is always on and free);
 * - voice cloning — ONLY under `preserve-source-voice` with a
 *   satisfied consent record (the R25-H law, enforced upstream by the
 *   contract validators; this serializer re-asserts it
 *   fail-closed): `enable_voice_clone: true` with frequency `once`
 *   and voice `default`. The neutral system voice (the default and
 *   the fallback) sends NO cloning fields at all — never a silent
 *   clone.
 *
 * @throws Error when voice preservation is requested without a
 *         satisfied consent record (fail-closed double-check; the
 *         contract validators already reject this — defense in depth).
 */
export function serializeQwenSessionUpdate(
  inputs: RealtimeTranslationSessionInputs,
  nowMs: number,
): QwenClientFrame {
  if (
    inputs.translatedVoicePolicy === "preserve-source-voice" &&
    inputs.voiceConsent?.state !== "satisfied"
  ) {
    throw new Error(
      "qwen-protocol: voice preservation requires a satisfied consent record — never silently clone a source speaker (the R25-H law, re-asserted at the serialization boundary)",
    );
  }

  const session: Record<string, unknown> = {
    output_modalities:
      inputs.outputModality === "text-and-audio" ? ["text", "audio"] : ["text"],
    audio: {
      input: {
        turn_detection: qwenTurnDetectionFor(inputs.speakerAttribution),
      },
    },
    translation: qwenTranslationBlock(inputs.targetLanguage, inputs.hotwords),
  };

  if (inputs.sourceLanguageHint !== undefined && inputs.sourceLanguageHint.length > 0) {
    session.input_audio_transcription = { language: inputs.sourceLanguageHint };
  }

  if (inputs.translatedVoicePolicy === "preserve-source-voice") {
    // The consent gate above guarantees voiceConsent is satisfied here.
    session.enable_voice_clone = true;
    session.voice_clone_options = { frequency: "once" };
    session.voice = "default";
  }

  return { type: "session.update", event_id: qwenEventId(nowMs), session };
}

/** The turn-detection block for the speaker-attribution mode (pure). */
export function qwenTurnDetectionFor(
  speakerAttribution: RealtimeSpeakerAttributionMode,
): { type: "speaker_detection" | "server_vad"; threshold: number } {
  return speakerAttribution === "off"
    ? { type: "server_vad", threshold: 0.5 }
    : { type: "speaker_detection", threshold: 0.5 };
}

/** The translation block: target language + hotword corpus (pure). */
export function qwenTranslationBlock(
  targetLanguage: string,
  hotwords: readonly RealtimeHotwordMapping[],
): Record<string, unknown> {
  const translation: Record<string, unknown> = { language: targetLanguage };
  const phrases = qwenHotwordPhrases(hotwords);
  if (phrases !== undefined) {
    translation.corpus = { phrases };
  }
  return translation;
}

/**
 * Serialize the normalized hotword vocabulary into the provider's own
 * `corpus.phrases` syntax: the source term maps to its preferred
 * target-language rendering (the provider's documented example shape,
 * `{"人工智能": "Artificial Intelligence"}`). Terms without a preferred
 * rendering map to themselves (the provider expects a value; the
 * term is the honest value). PURE; empty input → `undefined` (the
 * corpus block is omitted entirely).
 */
export function qwenHotwordPhrases(
  hotwords: readonly RealtimeHotwordMapping[],
): Record<string, string> | undefined {
  if (hotwords.length === 0) return undefined;
  const phrases: Record<string, string> = {};
  for (const mapping of hotwords) {
    phrases[mapping.term] = mapping.preferredRendering ?? mapping.term;
  }
  return phrases;
}

// ---------------------------------------------------------------------------
// input_audio_buffer.append / input_image_buffer.append serialization
// ---------------------------------------------------------------------------

/** Serialize one audio append frame (Base64 payload — pure). */
export function serializeQwenAudioAppend(audio: Uint8Array, nowMs: number): QwenClientFrame {
  return { type: "input_audio_buffer.append", event_id: qwenEventId(nowMs), audio: bytesToBase64(audio) };
}

/** Serialize one image append frame (Base64 payload — pure). */
export function serializeQwenImageAppend(image: Uint8Array, nowMs: number): QwenClientFrame {
  return { type: "input_image_buffer.append", event_id: qwenEventId(nowMs), image: bytesToBase64(image) };
}

/** Serialize the buffer-commit frame (the manual-mode flush). */
export function serializeQwenAudioCommit(nowMs: number): QwenClientFrame {
  return { type: "input_audio_buffer.commit", event_id: qwenEventId(nowMs) };
}

/** Serialize the end-of-input frame (the documented graceful finish). */
export function serializeQwenSessionFinish(nowMs: number): QwenClientFrame {
  return { type: "session.finish", event_id: qwenEventId(nowMs) };
}

// ---------------------------------------------------------------------------
// Base64 (pure, dependency-free — deterministic everywhere)
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode bytes to a standard Base64 string (pure; no Buffer dependency). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64_ALPHABET[b0 >> 2]!;
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f]! : "=";
  }
  return out;
}

const BASE64_REVERSE: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET[i]!] = i;
  }
  return table;
})();

/**
 * Decode a standard Base64 string to bytes (pure). Fail-closed: any
 * character outside the alphabet (padding excepted) or an impossible
 * length returns `undefined` — never a silent partial decode.
 */
export function base64ToBytes(encoded: string): Uint8Array | undefined {
  const cleaned = encoded.replace(/\s+/g, "");
  if (cleaned.length === 0) return new Uint8Array(0);
  if (cleaned.length % 4 !== 0) return undefined;
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  const charCount = cleaned.length - padding;
  const out = new Uint8Array(Math.floor((charCount * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < charCount; i++) {
    const char = cleaned[i]!;
    const value = BASE64_REVERSE[char];
    if (value === undefined) return undefined;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The server event vocabulary (parsing — the provider's own names)
// ---------------------------------------------------------------------------

/** Every server event type the pinned model's protocol defines. */
export const QWEN_SERVER_EVENT_TYPES: readonly string[] = [
  "error",
  "session.created",
  "session.updated",
  "session.finished",
  "response.created",
  "response.done",
  "response.text.delta",
  "response.text.done",
  "response.audio_transcript.delta",
  "response.audio_transcript.done",
  "response.audio.delta",
  "response.audio.done",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.committed",
  "input_audio_buffer.cleared",
  "conversation.item.created",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
] as const;

/** The server event union (typed, one variant per documented event). */
export type QwenServerEvent =
  | { type: "error"; error: QwenProviderError }
  | { type: "session.created"; session: QwenSessionConfigEcho }
  | { type: "session.updated"; session: QwenSessionConfigEcho }
  | { type: "session.finished" }
  | { type: "response.created"; response: { id: string; status: string } }
  | { type: "response.done"; response: { id: string; status: string; usage?: QwenResponseUsage | undefined } }
  | { type: "response.text.delta"; responseId: string; itemId: string; delta: string }
  | { type: "response.text.done"; responseId: string; itemId: string; text: string }
  | {
      type: "response.audio_transcript.delta";
      responseId: string;
      itemId: string;
      delta: string;
    }
  | { type: "response.audio_transcript.done"; responseId: string; itemId: string; transcript: string }
  | { type: "response.audio.delta"; responseId: string; itemId: string; deltaBase64: string }
  | { type: "response.audio.done"; responseId: string; itemId: string }
  | {
      type: "input_audio_buffer.speech_started";
      audioStartMs: number;
      itemId: string;
      speakerId?: number;
    }
  | { type: "input_audio_buffer.speech_stopped"; audioEndMs: number; itemId: string }
  | { type: "input_audio_buffer.committed" }
  | { type: "input_audio_buffer.cleared" }
  | { type: "conversation.item.created"; previousItemId?: string; itemId: string; role: string }
  | {
      type: "conversation.item.input_audio_transcription.delta";
      itemId: string;
      delta: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      itemId: string;
      transcript: string;
      language?: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.failed";
      itemId: string;
      error: QwenProviderError;
    }
  | { type: "unparseable"; raw: string; reason: string };

/**
 * The provider error shape (`error` frames and item-level failures):
 * `{ type, code, message, param? }` — verbatim from the reference.
 * (Optional fields carry `| undefined` explicitly: the parser assigns
 * possibly-undefined values under `exactOptionalPropertyTypes`.)
 */
export interface QwenProviderError {
  readonly type?: string | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly param?: string | undefined;
}

/** The `session.created`/`session.updated` session echo (the fields the adapter reads). */
export interface QwenSessionConfigEcho {
  readonly id: string;
  readonly model?: string | undefined;
  readonly output_modalities?: readonly string[] | undefined;
  readonly translation?: { readonly language?: string | undefined } | undefined;
}

/** The `response.done` usage shape (the provider-reported token truth). */
export interface QwenResponseUsage {
  readonly total_tokens?: number | undefined;
  readonly input_tokens?: number | undefined;
  readonly output_tokens?: number | undefined;
  readonly input_tokens_details?:
    | { readonly text_tokens?: number | undefined; readonly audio_tokens?: number | undefined }
    | undefined;
  readonly output_tokens_details?:
    | { readonly text_tokens?: number | undefined; readonly audio_tokens?: number | undefined }
    | undefined;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse one server text frame into the typed event union (PURE,
 * fail-closed). Unknown event types, non-JSON payloads, and
 * shape-drifted frames parse to the typed `unparseable` variant
 * carrying the raw payload and the reason — the adapter surfaces
 * those as typed `unknown` errors, NEVER silently dropped, never a
 * crash.
 */
export function parseQwenServerEvent(raw: string): QwenServerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: "unparseable", raw, reason: "the frame is not valid JSON" };
  }
  if (!isRecord(parsed)) {
    return { type: "unparseable", raw, reason: "the frame is not a JSON object" };
  }
  const type = parsed.type;
  if (typeof type !== "string") {
    return { type: "unparseable", raw, reason: "the frame carries no string 'type'" };
  }

  switch (type) {
    case "error": {
      const error = isRecord(parsed.error) ? qwenProviderError(parsed.error) : undefined;
      if (error === undefined) {
        return { type: "unparseable", raw, reason: "the error frame carries no usable error object" };
      }
      return { type: "error", error };
    }
    case "session.created":
    case "session.updated": {
      const session = isRecord(parsed.session) ? parsed.session : undefined;
      const id = session !== undefined ? readString(session, "id") : undefined;
      if (session === undefined || id === undefined) {
        return { type: "unparseable", raw, reason: `the ${type} frame carries no session.id` };
      }
      const translation = isRecord(session.translation) ? session.translation : undefined;
      return {
        type,
        session: {
          id,
          model: readString(session, "model"),
          output_modalities: Array.isArray(session.output_modalities)
            ? (session.output_modalities as unknown[]).filter((x): x is string => typeof x === "string")
            : undefined,
          translation: {
            language: translation !== undefined ? readString(translation, "language") : undefined,
          },
        },
      };
    }
    case "session.finished":
      return { type: "session.finished" };
    case "response.created":
    case "response.done": {
      const response = isRecord(parsed.response) ? parsed.response : undefined;
      const id = response !== undefined ? readString(response, "id") : undefined;
      if (response === undefined || id === undefined) {
        return { type: "unparseable", raw, reason: `the ${type} frame carries no response.id` };
      }
      if (type === "response.created") {
        return { type, response: { id, status: readString(response, "status") ?? "in_progress" } };
      }
      const usage = isRecord(response.usage) ? qwenResponseUsage(response.usage) : undefined;
      return {
        type: "response.done",
        response: { id, status: readString(response, "status") ?? "completed", usage },
      };
    }
    case "response.text.delta":
    case "response.audio_transcript.delta": {
      const delta = readString(parsed, "delta");
      const itemId = readString(parsed, "item_id");
      if (delta === undefined || itemId === undefined) {
        return { type: "unparseable", raw, reason: `the ${type} frame carries no string delta/item_id` };
      }
      return {
        type,
        responseId: readString(parsed, "response_id") ?? "",
        itemId,
        delta,
      };
    }
    case "response.text.done": {
      const itemId = readString(parsed, "item_id");
      if (itemId === undefined) {
        return { type: "unparseable", raw, reason: "the response.text.done frame carries no item_id" };
      }
      return {
        type: "response.text.done",
        responseId: readString(parsed, "response_id") ?? "",
        itemId,
        text: readString(parsed, "text") ?? "",
      };
    }
    case "response.audio_transcript.done": {
      const itemId = readString(parsed, "item_id");
      if (itemId === undefined) {
        return {
          type: "unparseable",
          raw,
          reason: "the response.audio_transcript.done frame carries no item_id",
        };
      }
      return {
        type: "response.audio_transcript.done",
        responseId: readString(parsed, "response_id") ?? "",
        itemId,
        transcript: readString(parsed, "transcript") ?? "",
      };
    }
    case "response.audio.delta": {
      const itemId = readString(parsed, "item_id");
      const delta = readString(parsed, "delta");
      if (itemId === undefined || delta === undefined) {
        return { type: "unparseable", raw, reason: "the response.audio.delta frame carries no item_id/delta" };
      }
      return { type: "response.audio.delta", responseId: readString(parsed, "response_id") ?? "", itemId, deltaBase64: delta };
    }
    case "response.audio.done": {
      const itemId = readString(parsed, "item_id");
      if (itemId === undefined) {
        return { type: "unparseable", raw, reason: "the response.audio.done frame carries no item_id" };
      }
      return { type: "response.audio.done", responseId: readString(parsed, "response_id") ?? "", itemId };
    }
    case "input_audio_buffer.speech_started": {
      const itemId = readString(parsed, "item_id");
      if (itemId === undefined) {
        return {
          type: "unparseable",
          raw,
          reason: "the input_audio_buffer.speech_started frame carries no item_id",
        };
      }
      const speakerId = readNumber(parsed, "speaker_id");
      return {
        type: "input_audio_buffer.speech_started",
        audioStartMs: readNumber(parsed, "audio_start_ms") ?? 0,
        itemId,
        ...(speakerId !== undefined ? { speakerId } : {}),
      };
    }
    case "input_audio_buffer.speech_stopped": {
      const itemId = readString(parsed, "item_id");
      if (itemId === undefined) {
        return {
          type: "unparseable",
          raw,
          reason: "the input_audio_buffer.speech_stopped frame carries no item_id",
        };
      }
      return {
        type: "input_audio_buffer.speech_stopped",
        audioEndMs: readNumber(parsed, "audio_end_ms") ?? 0,
        itemId,
      };
    }
    case "input_audio_buffer.committed":
    case "input_audio_buffer.cleared":
      return { type };
    case "conversation.item.created": {
      const item = isRecord(parsed.item) ? parsed.item : undefined;
      const itemId = item !== undefined ? readString(item, "id") : undefined;
      if (itemId === undefined) {
        return { type: "unparseable", raw, reason: "the conversation.item.created frame carries no item.id" };
      }
      const previousItemId = readString(parsed, "previous_item_id");
      return {
        type: "conversation.item.created",
        ...(previousItemId !== undefined ? { previousItemId } : {}),
        itemId,
        role: (item !== undefined ? readString(item, "role") : undefined) ?? "assistant",
      };
    }
    case "conversation.item.input_audio_transcription.delta": {
      const itemId = readString(parsed, "item_id");
      const delta = readString(parsed, "delta");
      if (itemId === undefined || delta === undefined) {
        return {
          type: "unparseable",
          raw,
          reason: "the transcription.delta frame carries no item_id/delta",
        };
      }
      return { type: "conversation.item.input_audio_transcription.delta", itemId, delta };
    }
    case "conversation.item.input_audio_transcription.completed": {
      const itemId = readString(parsed, "item_id");
      if (itemId === undefined) {
        return {
          type: "unparseable",
          raw,
          reason: "the transcription.completed frame carries no item_id",
        };
      }
      const language = readString(parsed, "language");
      return {
        type: "conversation.item.input_audio_transcription.completed",
        itemId,
        transcript: readString(parsed, "transcript") ?? "",
        ...(language !== undefined ? { language } : {}),
      };
    }
    case "conversation.item.input_audio_transcription.failed": {
      const itemId = readString(parsed, "item_id");
      const error = isRecord(parsed.error) ? qwenProviderError(parsed.error) : undefined;
      if (itemId === undefined || error === undefined) {
        return {
          type: "unparseable",
          raw,
          reason: "the transcription.failed frame carries no item_id/error",
        };
      }
      return { type: "conversation.item.input_audio_transcription.failed", itemId, error };
    }
    default:
      return {
        type: "unparseable",
        raw,
        reason: `unknown server event type '${type}' — the adapter's protocol vocabulary does not know it`,
      };
  }
}

function qwenProviderError(record: Record<string, unknown>): QwenProviderError {
  return {
    type: readString(record, "type"),
    code: readString(record, "code"),
    message: readString(record, "message"),
    param: readString(record, "param"),
  };
}

function qwenResponseUsage(record: Record<string, unknown>): QwenResponseUsage {
  const inputDetails = isRecord(record.input_tokens_details) ? record.input_tokens_details : undefined;
  const outputDetails = isRecord(record.output_tokens_details) ? record.output_tokens_details : undefined;
  return {
    total_tokens: readNumber(record, "total_tokens"),
    input_tokens: readNumber(record, "input_tokens"),
    output_tokens: readNumber(record, "output_tokens"),
    input_tokens_details: {
      text_tokens: inputDetails !== undefined ? readNumber(inputDetails, "text_tokens") : undefined,
      audio_tokens: inputDetails !== undefined ? readNumber(inputDetails, "audio_tokens") : undefined,
    },
    output_tokens_details: {
      text_tokens: outputDetails !== undefined ? readNumber(outputDetails, "text_tokens") : undefined,
      audio_tokens: outputDetails !== undefined ? readNumber(outputDetails, "audio_tokens") : undefined,
    },
  };
}
// ---------------------------------------------------------------------------
// Usage accounting (the provider-reported token truth → the neutral record)
// ---------------------------------------------------------------------------

/**
 * Map the provider's `response.done` usage shape onto the frozen
 * provider-neutral `RealtimeSessionUsage` (PURE — token counts are
 * provider-reported truth; MONETARY COST IS NEVER DERIVED HERE, that
 * stays in the realtime cost model by law).
 *
 * Honest limitation, recorded: the provider's documented usage shape
 * breaks tokens out as input text/audio and output text/audio — it
 * does NOT report image-input tokens as a separate dimension, so
 * `imageInputTokens` is `0` (the documented image billing basis —
 * 0.5 tokens per 32×32 pixels — is a rate-card concern, not a
 * reported count; the adapter reports what the provider reports,
 * never an invented number).
 */
export function qwenUsageToSessionUsage(usage: QwenResponseUsage | undefined): RealtimeSessionUsage {
  if (usage === undefined) {
    return { inputAudioTokens: 0, textOutputTokens: 0, outputAudioTokens: 0, imageInputTokens: 0 };
  }
  return {
    inputAudioTokens: nonNegative(usage.input_tokens_details?.audio_tokens),
    textOutputTokens: nonNegative(usage.output_tokens_details?.text_tokens),
    outputAudioTokens: nonNegative(usage.output_tokens_details?.audio_tokens),
    imageInputTokens: 0,
  };
}

function nonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

// ---------------------------------------------------------------------------
// Speaker-id mapping (the diarization truth → simple contextual labels)
// ---------------------------------------------------------------------------

/**
 * The provider speaker-id namespace: diarization ids are non-negative
 * integers. The neutral session vocabulary carries string speaker
 * ids; the adapter maps the provider's id to the neutral
 * `speaker-{providerId}` form (provider-neutral on the wire — the
 * neutral contract's example grammar is `Speaker 1 / Speaker 2`
 * labels, which {@link qwenSpeakerLabel} derives).
 */
export function qwenSpeakerId(speakerId: number): string {
  return `speaker-${speakerId}`;
}

/**
 * The R25-G label law: simple, contextual labels — `Speaker 1`,
 * `Speaker 2`, … — assigned by FIRST APPEARANCE order (provider ids
 * are stable integers but their numbering is the provider's
 * internal truth; first-appearance ordinals are the honest
 * human-facing grammar). PURE.
 */
export function qwenSpeakerLabel(ordinal: number): string {
  return `Speaker ${ordinal}`;
}

// ---------------------------------------------------------------------------
// Provider error normalization (typed kinds + honest recovery sentences)
// ---------------------------------------------------------------------------

/** The typed outcome of normalizing one provider error. */
export interface QwenNormalizedError {
  /** The neutral error kind the provider error maps to. */
  readonly errorKind: RealtimeTranslationErrorKind;
  /** The honest detail (the provider's own message, bounded). */
  readonly detail: string;
  /** The honest recovery sentence (actionable, never silent). */
  readonly recovery: string;
  /** Is the error RECOVERABLE (retry/smoothing may fix it)? */
  readonly recoverable: boolean;
}

/** Bound an error detail string (honest, bounded — never unbounded in events). */
function boundDetail(text: string): string {
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

/**
 * Normalize one provider error into the typed neutral vocabulary
 * (PURE, total over the documented error space):
 *
 * - RATE LIMIT hits (`rate_limit`/`throttling`/`TooManyRequests`
 *   families) → RECOVERABLE `provider-failure` whose recovery
 *   sentence names the documented International limits (RPM=10,
 *   TPM=100,000) and the adapter's smoothing — never a silent drop,
 *   never a playback blocker;
 * - AUTHENTICATION/PERMISSION failures → terminal `provider-failure`
 *   with the credential recovery sentence (the env variable NAME,
 *   never a value);
 * - UNSUPPORTED LANGUAGE / invalid translation target → terminal
 *   `unsupported-language-direction`;
 * - other INVALID REQUEST config rejections → terminal `policy`
 *   naming the provider's param;
 * - the item-level ASR failure (`input_audio_transcription.failed`)
 *   is normalized the same way but the ADAPTER treats it as
 *   recoverable (translation can continue without that segment's
 *   source transcript);
 * - anything unmapped → terminal `unknown` carrying the provider's
 *   own message — the fail-closed default: the adapter never GUESSES
 *   recoverability.
 */
export function normalizeQwenProviderError(error: QwenProviderError): QwenNormalizedError {
  const type = (error.type ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  const message = error.message ?? "the provider returned an error without a message";
  const detail = boundDetail(
    `qwen3.8-livetranslate-flash-realtime error${error.code !== undefined ? ` (code '${error.code}')` : ""}${error.param !== undefined ? ` on '${error.param}'` : ""}: ${message}`,
  );

  const isRateLimit =
    type.includes("rate_limit") ||
    code.includes("rate_limit") ||
    code.includes("ratelimit") ||
    code.includes("throttl") ||
    code.includes("too_many_requests") ||
    code.includes("toomanyrequests") ||
    message.toLowerCase().includes("rate limit");
  if (isRateLimit) {
    return {
      errorKind: "provider-failure",
      detail,
      recovery: `the provider's documented International rate limits (RPM=${QWEN_LIVETRANSLATE_RATE_LIMITS.requestsPerMinute}, TPM=${QWEN_LIVETRANSLATE_RATE_LIMITS.tokensPerMinute.toLocaleString("en-US")}) were hit — the adapter retries with backoff and smooths session starts to the RPM cadence; base playback is never blocked`,
      recoverable: true,
    };
  }

  const isAuth =
    type.includes("authentication") ||
    type.includes("permission") ||
    code.includes("invalid_api_key") ||
    code.includes("unauthorized") ||
    (code.includes("access") && code.includes("denied"));
  if (isAuth) {
    return {
      errorKind: "provider-failure",
      detail,
      recovery: `the provider rejected the credential — set ${QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE} in the server environment (the operator secrets store or the platform env store); the key never lives in code and this failure is never a fallback to a hardcoded key`,
      recoverable: false,
    };
  }

  const isLanguage =
    code.includes("unsupported_language") ||
    code.includes("language_not_supported") ||
    (error.param !== undefined && error.param.includes("language"));
  if (isLanguage) {
    return {
      errorKind: "unsupported-language-direction",
      detail,
      recovery:
        "choose a documented target language for this provider (the registered capability profile records the honest marker-language coverage); base playback and the original captions continue",
      recoverable: false,
    };
  }

  if (type.includes("invalid_request") || code.includes("invalid_value") || code.includes("invalid")) {
    return {
      errorKind: "policy",
      detail,
      recovery:
        "the provider rejected the session configuration — adjust the session configuration (the provider's error names the offending parameter) and start a new session; base playback is never blocked",
      recoverable: false,
    };
  }

  return {
    errorKind: "unknown",
    detail,
    recovery:
      "the provider returned an error the adapter's protocol vocabulary does not map — recorded honestly rather than guessed; the session ends typed and base playback continues",
    recoverable: false,
  };
}

// ---------------------------------------------------------------------------
// The protocol mapping table (documentation-as-law, machine-read by tests)
// ---------------------------------------------------------------------------

/**
 * THE PROVIDER FRAME → SESSION EVENT MAPPING TABLE (the R25-C
 * architecture, verbatim names both sides — the adapter battery
 * asserts every row is implemented and the table covers every
 * reconstruction path):
 *
 * | provider frame (verbatim)                                  | session event (verbatim)        |
 * |------------------------------------------------------------|---------------------------------|
 * | `session.created`                                          | `session-created`               |
 * | `conversation.item.input_audio_transcription.delta`        | `source-transcript-delta`       |
 * | `conversation.item.input_audio_transcription.completed`    | `source-transcript-final`       |
 * | `conversation.item.input_audio_transcription.failed`       | `recoverable-error` (per-item)  |
 * | `response.text.delta` / `response.audio_transcript.delta`  | `translation-delta`             |
 * | `response.text.done` / `response.audio_transcript.done`    | `translation-segment-final`     |
 * | `input_audio_buffer.speech_started` (speaker_id)           | `speaker-attribution`           |
 * | `response.audio.delta`                                     | `translated-audio-chunk`        |
 * | (adapter-derived: the measured firsts)                     | `timing-metadata`               |
 * | `response.done` (usage)                                    | `usage-telemetry`               |
 * | rate-limit `error` / transport loss                        | `recoverable-error`             |
 * | fatal `error` / retries exhausted                          | `terminal-error`                |
 * | `session.finished` / close                                 | `session-closed`                |
 */
export const QWEN_PROTOCOL_EVENT_MAPPING: ReadonlyArray<{
  readonly providerFrame: string;
  readonly sessionEvent: string;
  readonly reconstructionPath: string;
}> = [
  {
    providerFrame: "session.created",
    sessionEvent: "session-created",
    reconstructionPath: "the provider session id + model echo become the neutral session identity; starting → streaming",
  },
  {
    providerFrame: "conversation.item.input_audio_transcription.delta",
    sessionEvent: "source-transcript-delta",
    reconstructionPath: "per item_id deltas append in arrival order; timing from the speech_started record",
  },
  {
    providerFrame: "conversation.item.input_audio_transcription.completed",
    sessionEvent: "source-transcript-final",
    reconstructionPath: "the final transcript + detected language; speakerId via the diarization mapping",
  },
  {
    providerFrame: "conversation.item.input_audio_transcription.failed",
    sessionEvent: "recoverable-error",
    reconstructionPath: "per-item ASR failure — translation continues; the honest typed notice, never a session kill",
  },
  {
    providerFrame: "response.text.delta | response.audio_transcript.delta",
    sessionEvent: "translation-delta",
    reconstructionPath: "per item_id deltas append in arrival order; sourceSegmentId via conversation.item.created's previous_item_id",
  },
  {
    providerFrame: "response.text.done | response.audio_transcript.done",
    sessionEvent: "translation-segment-final",
    reconstructionPath: "the final translation text for the item",
  },
  {
    providerFrame: "input_audio_buffer.speech_started (speaker_id)",
    sessionEvent: "speaker-attribution",
    reconstructionPath: "provider speaker id → first-appearance ordinal → the simple Speaker N label (trustedSource false — server diarization)",
  },
  {
    providerFrame: "response.audio.delta",
    sessionEvent: "translated-audio-chunk",
    reconstructionPath: "Base64-decoded PCM16 24 kHz bytes with a per-session monotonic sequence",
  },
  {
    providerFrame: "(adapter-derived from the measured firsts)",
    sessionEvent: "timing-metadata",
    reconstructionPath: "first transcript delta / first translation delta / first audio chunk, measured against session start",
  },
  {
    providerFrame: "response.done (usage)",
    sessionEvent: "usage-telemetry",
    reconstructionPath: "provider-reported token counts accumulate into the neutral usage record; cost derivation stays in the cost model",
  },
  {
    providerFrame: "rate-limit error | transport loss",
    sessionEvent: "recoverable-error",
    reconstructionPath: "typed provider-failure/network with the honest recovery sentence; bounded retries with injectable backoff",
  },
  {
    providerFrame: "fatal error | retries exhausted",
    sessionEvent: "terminal-error",
    reconstructionPath: "the honest give-up: the translation overlay ends typed; base playback continues (the shared law is total)",
  },
  {
    providerFrame: "session.finished | close",
    sessionEvent: "session-closed",
    reconstructionPath: "the typed close reason + the final accumulated usage",
  },
];
