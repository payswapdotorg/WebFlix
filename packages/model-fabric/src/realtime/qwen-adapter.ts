/**
 * @wfx/model-fabric — the Qwen LiveTranslate provider adapter (R25-C):
 * the `RealtimeTranslationSession` implementation behind Model Fabric.
 *
 * THE LAWS THIS MODULE KEEPS (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — R25-C, the adapter
 * list, verbatim ownership):
 *
 * 1. THE BOUNDARY LAW: the ENTIRE provider protocol vocabulary lives
 *    in `qwen-protocol.ts` (this package's adapter boundary). This
 *    module owns the SESSION MECHANICS — the state machine, the
 *    event reconstruction, the reconnect/resume policy — and speaks
 *    ONLY the frozen provider-neutral event vocabulary outward. No
 *    Qwen type, event name, or protocol JSON crosses into shared
 *    Product/Experience code (the forbidden-token scanner + the
 *    shared contract enforce the other half).
 *
 * 2. THE CREDENTIAL LAW: the API key comes from the SERVER
 *    environment (`DASHSCOPE_API_KEY`, read through
 *    {@link readQwenLiveTranslateCredential} — names the variable,
 *    never the value). An absent/unreadable key is an honest typed
 *    `provider-failure` terminal error with the recovery sentence —
 *    never a crash, never a fallback to a hardcoded key, and the key
 *    never reaches client code (the browser→WebFlix bridge is
 *    R25-D's lane; the adapter runs server-side only).
 *
 * 3. THE TESTABILITY LAW: the WebSocket transport is INJECTABLE
 *    (`QwenRealtimeTransport`); the deterministic recorded-frame
 *    double (`qwen-fixtures.ts`) replays provider frames without the
 *    live endpoint; the clock and the backoff schedule are
 *    injectable, so smoothing/retry policies are instant and
 *    deterministic under test. Every reconstruction path (transcript,
 *    translation, audio decode, speaker mapping, usage) is driven by
 *    recorded frame shapes in the battery.
 *
 * 4. THE RECONNECT LAW: provider transport loss maps to the
 *    session's `reconnecting` state and drives the domain
 *    `reconnect` op — RESUME, never restart: the same session object
 *    re-establishes the connection, re-sends the last configuration,
 *    and replays the bounded audio tail (the replay window). Retries
 *    are bounded with an injectable backoff; the honest give-up is a
 *    typed terminal error (base playback continues — the session is
 *    an overlay with no playback capability, the shared law is
 *    total).
 *
 * 5. THE NEVER-FORCE LAW: image frames are appended ONLY under the
 *    session's `adaptive` visual-context policy — the adapter NEVER
 *    requests frames on its own; a frame under `off` is the typed
 *    refusal, matching the shared operation-legality table. Frames
 *    appended while not yet streaming are BUFFERED (audio first, the
 *    provider's own wire order) — never silently dropped.
 *
 * 6. THE RATE-LIMIT LAW (RPM=10 / TPM=100,000 International, the
 *    lead-verified research truth): session starts are SMOOTHED to
 *    the RPM cadence (a bounded pre-connect wait, injectable clock);
 *    provider rate-limit hits map to the typed `recoverable-error`
 *    (`provider-failure`) whose recovery sentence names the limits —
 *    never a silent drop, never a playback blocker.
 *
 * Live-endpoint integration runs are NOT this lane's gate (no
 * credential in CI): `scripts/verify-live-qwen-realtime.ts` is the
 * honest W2-precedent harness (SKIPPED without the env var), and the
 * live benchmark stays pending the lead's procedure.
 */

import type {
  RealtimeAudioChunkInput,
  RealtimeImageFrameInput,
  RealtimeSegmentTiming,
  RealtimeSessionConfiguration,
  RealtimeSessionUsage,
  RealtimeTranslationErrorKind,
  RealtimeTranslationEvent,
  RealtimeTranslationOperation,
  RealtimeTranslationSessionFactory,
  RealtimeTranslationSession,
  RealtimeTranslationSessionInputs,
  RealtimeTranslationSessionState,
} from "@wfx/domain";

import {
  QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS,
  QWEN_LIVETRANSLATE_MODEL_ID,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
  QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE,
  base64ToBytes,
  normalizeQwenProviderError,
  parseQwenServerEvent,
  qwenSpeakerId,
  qwenSpeakerLabel,
  qwenSessionStartMinIntervalMs,
  qwenUsageToSessionUsage,
  serializeQwenAudioAppend,
  serializeQwenImageAppend,
  serializeQwenSessionFinish,
  serializeQwenSessionUpdate,
  type QwenClientFrame,
  type QwenResponseUsage,
  type QwenServerEvent,
} from "./qwen-protocol";
import {
  QWEN_LIVETRANSLATE_FLASH_REALTIME,
  REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
} from "./provider";
import {
  createRealtimeEventStream,
  isRealtimeOperationLegal,
  validateRealtimeSessionConfiguration,
  validateRealtimeTranslationSessionInputs,
  type RealtimeEventStream,
  type RealtimeInputIssue,
} from "./session";

// ---------------------------------------------------------------------------
// The injectable transport seam (the testability law, structural)
// ---------------------------------------------------------------------------

/**
 * One live provider connection (the injectable seam's connection
 * half). The production implementation wraps a WebSocket; the
 * recorded-frame double replays provider frames. Text frames only —
 * the documented protocol is JSON text frames.
 */
export interface QwenRealtimeConnection {
  /** Send one JSON text frame. Must not throw on backpressure. */
  send(text: string): void;
  /** Register the server-frame handler (exactly one). */
  onMessage(handler: (text: string) => void): void;
  /** Register the un-clean close handler (exactly one). */
  onClose(handler: (code: number, reason: string) => void): void;
  /** Close the connection (idempotent). */
  close(): void;
}

/** The injectable WebSocket transport seam (connect = one provider session). */
export interface QwenRealtimeTransport {
  /**
   * Open one provider connection. Rejects on transport failure (the
   * adapter's bounded-retry path). The authorization header VALUE is
   * the credential — it exists ONLY here, never in events, logs, or
   * error messages.
   */
  connect(request: {
    readonly url: string;
    readonly authorizationHeader: string;
  }): Promise<QwenRealtimeConnection>;
}

/**
 * The production WebSocket transport (Bun's native WebSocket with
 * per-connection headers). NOT unit-tested against the live endpoint
 * — the recorded double is the battery's transport; this transport
 * is exercised by the lead's live verification procedure only.
 */
export function createWebSocketQwenTransport(options: {
  readonly connectTimeoutMs?: number;
} = {}): QwenRealtimeTransport {
  const timeoutMs = options.connectTimeoutMs ?? 10_000;
  return {
    async connect(request) {
      return await new Promise<QwenRealtimeConnection>((resolve, reject) => {
        // Bun's WebSocket accepts a headers option (undici-style).
        // The DOM typings don't model it — the cast is deliberate and
        // documented; the header value never leaves this function.
        const socket = new WebSocket(request.url, {
          headers: { Authorization: request.authorizationHeader },
        } as unknown as string);
        const timer = setTimeout(() => {
          try {
            socket.close();
          } catch {
            // already closed
          }
          reject(new Error(`qwen realtime connect timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        socket.onopen = () => {
          clearTimeout(timer);
          const connection: QwenRealtimeConnection = {
            send(text) {
              if (socket.readyState === 1) socket.send(text);
            },
            onMessage(handler) {
              socket.onmessage = (event: MessageEvent) => {
                const data = event.data;
                if (typeof data === "string") handler(data);
              };
            },
            onClose(handler) {
              socket.onclose = (event: CloseEvent) => handler(event.code, event.reason);
            },
            close() {
              try {
                socket.close();
              } catch {
                // already closed
              }
            },
          };
          resolve(connection);
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("qwen realtime websocket transport error"));
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The injectable clock + backoff (deterministic policies under test)
// ---------------------------------------------------------------------------

/** The clock seam: wall time + bounded sleeps (injectable — instant under test). */
export interface QwenAdapterClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** The real clock (production default). */
export function createRealQwenAdapterClock(): QwenAdapterClock {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/** The backoff seam: the delay before retry attempt N (injectable). */
export interface QwenBackoffSchedule {
  delayMsForAttempt(attempt: number): number;
}

/** The default backoff: 250ms × 2^attempt, capped at 8s (bounded, documented). */
export function createDefaultQwenBackoffSchedule(): QwenBackoffSchedule {
  return {
    delayMsForAttempt: (attempt) => Math.min(250 * 2 ** Math.max(0, attempt), 8_000),
  };
}

// ---------------------------------------------------------------------------
// The credential path (the server-environment law)
// ---------------------------------------------------------------------------

/** The typed outcome of reading the provider credential from an env bag. */
export type QwenCredentialStatus =
  | { readonly ok: true; readonly apiKey: string }
  | {
      readonly ok: false;
      readonly variable: string;
      readonly recovery: string;
    };

/**
 * Read the provider credential from the server environment (PURE;
 * names-only honesty — the VALUE is never echoed, logged, or
 * embedded in errors). An absent or blank value is the honest typed
 * `not provisioned` answer; there is NO fallback credential anywhere
 * in this package, by law.
 */
export function readQwenLiveTranslateCredential(
  env: Record<string, string | undefined>,
): QwenCredentialStatus {
  const value = env[QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE];
  if (typeof value === "string" && value.trim().length > 0) {
    return { ok: true, apiKey: value.trim() };
  }
  return {
    ok: false,
    variable: QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE,
    recovery:
      `set ${QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE} in the server environment (the operator secrets store or the platform env store) — ` +
      "the provider credential never lives in code, never ships to the client, and its absence is never a fallback to a hardcoded key",
  };
}

// ---------------------------------------------------------------------------
// The adapter configuration
// ---------------------------------------------------------------------------

/** The Qwen LiveTranslate adapter's configuration (all knobs injectable). */
export interface QwenLiveTranslateAdapterConfig {
  /** The provider credential (REQUIRED — from the server environment). */
  readonly apiKey: string;
  /**
   * The WebSocket endpoint base (the model rides the `model` query
   * parameter). Default: the documented QwenCloud MaaS realtime
   * endpoint; the Model Studio International alternative is the named
   * constant for those deployments, and the `QWEN_LIVETRANSLATE_WS_URL`
   * environment override reaches this same knob.
   */
  readonly endpoint?: string;
  /** The pinned model id (default: the registered record's model identity). */
  readonly modelId?: string;
  /** The model revision reported in the neutral session-created event. */
  readonly modelRevision?: string;
  /** The INJECTABLE transport (the recorded double under test). */
  readonly transport: QwenRealtimeTransport;
  /** The injectable clock (default: the real clock). */
  readonly clock?: QwenAdapterClock;
  /** The injectable backoff schedule (default: bounded exponential). */
  readonly backoff?: QwenBackoffSchedule;
  /**
   * The total budget of provider-connection retries (initial connect
   * AND reconnects share it — the honest bound). Default 5.
   */
  readonly maxReconnectAttempts?: number;
  /**
   * Session-start smoothing: the minimum interval between provider
   * session starts (derived from RPM=10 by default → 6000 ms). The
   * smoothing wait is BOUNDED by this interval.
   */
  readonly sessionStartMinIntervalMs?: number;
  /** The reconnect resume window: how much appended audio to replay (ms, wall-clock since append). Default 8000. */
  readonly audioReplayWindowMs?: number;
  /** How long stop() waits for the graceful provider finish ack. Default 15000. */
  readonly stopAckTimeoutMs?: number;
  /** How long a connect attempt waits for the provider handshake frames. Default 10000. */
  readonly connectAckTimeoutMs?: number;
}

interface ResolvedQwenConfig {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly transport: QwenRealtimeTransport;
  readonly clock: QwenAdapterClock;
  readonly backoff: QwenBackoffSchedule;
  readonly maxReconnectAttempts: number;
  readonly sessionStartMinIntervalMs: number;
  readonly audioReplayWindowMs: number;
  readonly stopAckTimeoutMs: number;
  readonly connectAckTimeoutMs: number;
}

function resolveQwenConfig(config: QwenLiveTranslateAdapterConfig): ResolvedQwenConfig {
  return {
    apiKey: config.apiKey,
    endpoint: config.endpoint ?? QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
    modelId: config.modelId ?? QWEN_LIVETRANSLATE_MODEL_ID,
    modelRevision: config.modelRevision ?? QWEN_LIVETRANSLATE_FLASH_REALTIME.model.revision,
    transport: config.transport,
    clock: config.clock ?? createRealQwenAdapterClock(),
    backoff: config.backoff ?? createDefaultQwenBackoffSchedule(),
    maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
    sessionStartMinIntervalMs:
      config.sessionStartMinIntervalMs ?? qwenSessionStartMinIntervalMs(),
    audioReplayWindowMs: config.audioReplayWindowMs ?? 8_000,
    stopAckTimeoutMs: config.stopAckTimeoutMs ?? 15_000,
    connectAckTimeoutMs: config.connectAckTimeoutMs ?? 10_000,
  };
}

/** The provider URL the transport connects to (endpoint + the model query parameter). */
export function qwenRealtimeUrl(config: {
  readonly endpoint: string;
  readonly modelId: string;
}): string {
  return `${config.endpoint}?model=${encodeURIComponent(config.modelId)}`;
}

// ---------------------------------------------------------------------------
// The typed adapter errors (operation-legality + configuration misuse)
// ---------------------------------------------------------------------------

/** An operation-legality violation (the shared state machine's law, re-asserted). */
export class QwenAdapterOperationError extends Error {
  constructor(
    readonly operation: RealtimeTranslationOperation,
    readonly state: RealtimeTranslationSessionState,
    message: string,
  ) {
    super(message);
    this.name = "QwenAdapterOperationError";
  }
}

/** An invalid session-configuration payload (field-path issues attached). */
export class QwenAdapterConfigurationError extends Error {
  constructor(readonly issues: readonly RealtimeInputIssue[]) {
    super(
      `invalid realtime session configuration: ${issues
        .map((issue) => `${issue.path || "<root>"} — ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "QwenAdapterConfigurationError";
  }
}

/** An invalid session-inputs payload at the factory seam (fail-closed). */
export class QwenAdapterInputError extends Error {
  constructor(readonly issues: readonly RealtimeInputIssue[]) {
    super(
      `invalid realtime translation session inputs: ${issues
        .map((issue) => `${issue.path || "<root>"} — ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "QwenAdapterInputError";
  }
}

/** The typed close reasons of the neutral session-closed event. */
type QwenCloseReason =
  | "user-stop"
  | "user-close"
  | "terminal-error"
  | "policy"
  | "provider-closed";

/** One normalized provider error (already mapped to the typed vocabulary). */
interface NormalizedProviderError {
  readonly errorKind: RealtimeTranslationErrorKind;
  readonly detail: string;
  readonly recovery: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// The session implementation
// ---------------------------------------------------------------------------

interface SegmentTimingRecord {
  startedAtMs: number;
  endedAtMs: number;
}

/** One buffered audio chunk (the reconnect replay window). */
interface BufferedAudioChunk {
  readonly audio: Uint8Array;
  readonly appendedAtWallMs: number;
}

/** One pending wait for a provider frame (the handshake seam). */
interface WaiterEntry {
  readonly accepts: readonly string[];
  finish: (outcome: WaitOutcome) => void;
}

/** The outcome of one bounded wait for provider frames. */
type WaitOutcome =
  | { readonly kind: "frame"; readonly type: string }
  | { readonly kind: "failure"; readonly reason: string };

/** One full connect+configure attempt's typed outcome. */
type ProviderSessionAttempt =
  | { readonly ok: true }
  | { readonly ok: false; readonly terminal: true; error: NormalizedProviderError }
  | {
      readonly ok: false;
      readonly terminal: false;
      readonly detail: string;
      readonly recovery: string;
    };

/**
 * The Qwen LiveTranslate realtime translation session — the frozen
 * `RealtimeTranslationSession` port implemented over the provider
 * protocol. One instance per open() call; the neutral event stream
 * carries the reconstructed vocabulary; the state machine is the
 * frozen shared one (legality re-asserted on every operation).
 */
class QwenLiveTranslateSession implements RealtimeTranslationSession {
  private readonly config: ResolvedQwenConfig;
  private readonly stream: RealtimeEventStream;
  private readonly eventsIterable: () => AsyncIterable<RealtimeTranslationEvent>;
  private readonly startGate: QwenSessionStartGate;

  private sessionState: RealtimeTranslationSessionState = "idle";
  private inputs: RealtimeTranslationSessionInputs;
  private connection: QwenRealtimeConnection | null = null;
  private narrativeClosed = false;
  private stopping = false;

  // reconnect/resume machinery (the shared bounded budget)
  private retryBudgetUsed = 0;
  private reconnectTriggered = false;
  private reconnectTrigger: (() => void) | null = null;

  // the replay window + the pending (unsent) frames — never silently dropped
  private readonly replayBuffer: BufferedAudioChunk[] = [];
  private readonly pendingImageFrames: Uint8Array[] = [];
  private audioAppendCount = 0;

  // reconstruction state
  private readonly speakerOrdinalByProviderId = new Map<number, number>();
  private readonly speakerByItemId = new Map<string, number>();
  private readonly timingByItemId = new Map<string, SegmentTimingRecord>();
  private readonly sourceItemByTranslationItem = new Map<string, string>();

  // usage + telemetry
  private usageTotals: RealtimeSessionUsage = {
    inputAudioTokens: 0,
    textOutputTokens: 0,
    outputAudioTokens: 0,
    imageInputTokens: 0,
  };
  private audioChunkSequence = 0;
  private startWallMs = 0;
  private firstSourceTranscriptDeltaWallMs: number | null = null;
  private firstTranslationDeltaWallMs: number | null = null;
  private firstTranslatedAudioChunkWallMs: number | null = null;
  private readonly timingFirstsEmitted = {
    transcript: false,
    translation: false,
    audio: false,
  };

  // the pending handshake waits + the paired normalized error (one at a time)
  private readonly waiters: WaiterEntry[] = [];
  private lastNormalizedError: NormalizedProviderError | null = null;

  /**
   * Read (not narrow) the paired normalized error — a reader method
   * so TypeScript's property flow-narrowing (which persists across
   * awaits after the null-clearing assignment) cannot produce the
   * spurious `never` narrowing at the call sites.
   */
  private takeLastNormalizedError(): NormalizedProviderError | null {
    return this.lastNormalizedError;
  }

  constructor(
    readonly sessionId: string,
    inputs: RealtimeTranslationSessionInputs,
    config: ResolvedQwenConfig,
    startGate: QwenSessionStartGate,
    stream: RealtimeEventStream,
    events: () => AsyncIterable<RealtimeTranslationEvent>,
  ) {
    this.inputs = inputs;
    this.config = config;
    this.startGate = startGate;
    this.stream = stream;
    this.eventsIterable = events;
  }

  get state(): RealtimeTranslationSessionState {
    return this.sessionState;
  }

  events(): AsyncIterable<RealtimeTranslationEvent> {
    return this.eventsIterable();
  }

  // -----------------------------------------------------------------------
  // start (connect + handshake + the rate-limit smoothing)
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    this.assertLegalOperation("start");

    // THE CREDENTIAL LAW: an empty/absent key at this seam is the
    // honest typed provider-failure with the recovery sentence —
    // never a crash, never a hardcoded fallback.
    if (this.config.apiKey.trim().length === 0) {
      this.sessionState = "starting";
      this.emitTerminalError(
        "provider-failure",
        `the provider credential was not provisioned for this adapter instance (${QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE} is empty or absent in the server environment)`,
        `set ${QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE} in the server environment — the adapter never falls back to a hardcoded key and base playback is never blocked`,
      );
      return;
    }

    this.sessionState = "starting";
    this.startWallMs = this.config.clock.now();

    // THE RATE-LIMIT LAW (session-start smoothing): RPM=10 ⇒ one
    // provider session start per 6000 ms across the FACTORY (the
    // shared gate). The wait is bounded by the interval itself.
    await this.startGate.awaitTurn(this.config.clock, this.config.sessionStartMinIntervalMs);
    if (this.sessionState !== "starting") return; // closed while smoothing

    while (this.sessionState === "starting") {
      const attempt = await this.attemptProviderSessionStart();
      if (attempt.ok) break;
      if (this.sessionState !== "starting") return; // closed/stopped meanwhile
      if (attempt.terminal) {
        this.emitTerminalError(attempt.error.errorKind, attempt.error.detail, attempt.error.recovery);
        return;
      }
      if (this.retryBudgetUsed >= this.config.maxReconnectAttempts) {
        this.emitTerminalError(
          "network",
          `the provider transport connection could not be established after ${this.config.maxReconnectAttempts + 1} attempts`,
          "the translation overlay ended honestly — base playback and the original captions continue (the shared law is total); check the provider endpoint/credential and start a new session",
        );
        return;
      }
      this.retryBudgetUsed += 1;
      this.emitEvent({
        kind: "recoverable-error",
        sessionId: this.sessionId,
        occurredAt: this.nowIso(),
        errorKind: "network",
        detail: attempt.detail,
        recovery: attempt.recovery,
      });
      await this.config.clock.sleep(this.config.backoff.delayMsForAttempt(this.retryBudgetUsed - 1));
    }
    if (this.sessionState !== "starting") return;

    // The session is live: the neutral session-created event carries
    // the effective inputs (the configured truth), then streaming.
    this.emitEvent({
      kind: "session-created",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      providerId: REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
      modelId: this.config.modelId,
      modelRevision: this.config.modelRevision,
      effectiveInputs: this.inputs,
    });
    this.sessionState = "streaming";

    // Flush anything buffered while 'starting' (the shared state
    // machine allows append-audio/append-image-frame during
    // starting — buffered, never dropped): audio first (the
    // provider's own wire order), then the pending frames.
    await this.flushBufferedMedia();
  }

  // -----------------------------------------------------------------------
  // configure (mid-session reconfiguration with the honest ack/revert)
  // -----------------------------------------------------------------------

  async configure(configuration: RealtimeSessionConfiguration): Promise<void> {
    this.assertLegalOperation("configure");
    const validation = validateRealtimeSessionConfiguration(configuration);
    if (!validation.ok) {
      throw new QwenAdapterConfigurationError(validation.issues);
    }

    const previous = this.inputs;
    this.inputs = { ...this.inputs, ...validation.value };

    if (this.sessionState === "idle") return; // pre-start wiring: applied at start

    // Mid-session: send the new full configuration; on provider
    // rejection REVERT locally (the effective config never silently
    // diverges) and surface the typed recoverable error.
    this.lastNormalizedError = null;
    this.sendFrame(serializeQwenSessionUpdate(this.inputs, this.config.clock.now()));
    const outcome = await this.waitFor(
      ["session.updated", "error"],
      this.config.connectAckTimeoutMs,
      () => "the provider did not acknowledge the session configuration within the timeout",
    );
    if (outcome.kind === "frame" && outcome.type === "session.updated") return;
    this.inputs = previous; // the honest revert — the old config still governs
    const normalized = this.takeLastNormalizedError();
    this.emitEvent({
      kind: "recoverable-error",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      errorKind: normalized?.errorKind ?? "network",
      detail:
        normalized?.detail ??
        (outcome.kind === "frame" ? "the provider rejected the session configuration" : outcome.reason),
      recovery:
        normalized?.recovery ??
        "the previous session configuration remains in effect (the adapter reverts the rejected change); adjust the configuration and retry",
    });
  }

  // -----------------------------------------------------------------------
  // append-audio (the input buffer + the replay window)
  // -----------------------------------------------------------------------

  async appendAudio(chunk: RealtimeAudioChunkInput): Promise<void> {
    this.assertLegalOperation("append-audio");

    // The replay window (the reconnect resume tail — resume, never restart).
    this.replayBuffer.push({ audio: chunk.audio, appendedAtWallMs: this.config.clock.now() });
    this.trimReplayWindow();

    if (this.sessionState === "streaming" && this.connection !== null) {
      this.sendFrame(serializeQwenAudioAppend(chunk.audio, this.config.clock.now()));
    }
    // 'starting'/'reconnecting': the chunk stays buffered — start()
    // flushes it once streaming; the resume loop replays the window.
  }

  // -----------------------------------------------------------------------
  // append-image-frame (the never-force law + the provider's own fences)
  // -----------------------------------------------------------------------

  async appendImageFrame(frame: RealtimeImageFrameInput): Promise<void> {
    this.assertLegalOperation("append-image-frame");

    // THE NEVER-FORCE LAW: frames flow ONLY under the adaptive policy.
    if (this.inputs.visualContextPolicy === "off") {
      throw new QwenAdapterOperationError(
        "append-image-frame",
        this.sessionState,
        "the session's visual-context policy is 'off' — image frames are never forced (the R25-F law; the adapter never requests frames on its own)",
      );
    }

    // The provider's documented fences, enforced with TYPED events
    // (never silent drops): size and audio-first ordering.
    if (frame.frame.byteLength > QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS.maxBytesBeforeBase64) {
      this.emitEvent({
        kind: "recoverable-error",
        sessionId: this.sessionId,
        occurredAt: this.nowIso(),
        errorKind: "policy",
        detail: `the appended image frame is ${frame.frame.byteLength} bytes — the provider documents a maximum of ${QWEN_LIVETRANSLATE_IMAGE_CONSTRAINTS.maxBytesBeforeBase64} bytes before Base64 encoding`,
        recovery:
          "sample the frame at the documented 480p/720p recommendation before appending; the frame was not sent (never a silent drop) and the session continues",
      });
      return;
    }
    if (this.audioAppendCount === 0 && this.replayBuffer.length === 0) {
      this.emitEvent({
        kind: "recoverable-error",
        sessionId: this.sessionId,
        occurredAt: this.nowIso(),
        errorKind: "policy",
        detail:
          "the provider requires at least one audio chunk before any image frame — the frame was not sent",
        recovery:
          "append audio first (the provider documents images as visual CONTEXT for the audio stream); the frame was not sent (never a silent drop)",
      });
      return;
    }

    if (this.sessionState === "streaming" && this.connection !== null) {
      this.sendFrame(serializeQwenImageAppend(frame.frame, this.config.clock.now()));
    } else {
      // Buffered (starting/reconnecting) — flushed after the audio,
      // the provider's own wire order; never silently dropped.
      this.pendingImageFrames.push(frame.frame);
    }
  }

  // -----------------------------------------------------------------------
  // stop (the graceful provider finish + the typed close)
  // -----------------------------------------------------------------------

  async stop(): Promise<void> {
    this.assertLegalOperation("stop");
    this.stopping = true;

    if (this.connection === null || this.sessionState !== "streaming") {
      // Never connected (or still handshaking): the honest typed close.
      this.finishNarrative("user-stop");
      this.sessionState = "stopped";
      return;
    }

    this.sendFrame(serializeQwenSessionFinish(this.config.clock.now()));
    // Await the graceful finish ack (bounded; transport loss resolves
    // honestly — we asked to stop, the narrative closes regardless).
    await this.waitFor(["session.finished"], this.config.stopAckTimeoutMs, () =>
      "the provider did not acknowledge session.finish within the stop timeout",
    );
    this.connection?.close();
    this.connection = null;
    this.finishNarrative("user-stop");
    this.sessionState = "stopped";
  }

  // -----------------------------------------------------------------------
  // reconnect (the domain resume op — resume, never restart)
  // -----------------------------------------------------------------------

  async reconnect(): Promise<void> {
    this.assertLegalOperation("reconnect");
    // Legal only from 'reconnecting': short-circuit the pending
    // backoff wait so the resume attempt runs NOW (the caller saw
    // the network come back, e.g. the bridge after a J43-style
    // interruption).
    this.reconnectTriggered = true;
    this.reconnectTrigger?.();
  }

  // -----------------------------------------------------------------------
  // close (immediate teardown + the typed close reason)
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    this.assertLegalOperation("close");
    this.stopping = true;
    this.connection?.close();
    this.connection = null;
    if (this.sessionState !== "stopped") {
      // An active narrative: emit the user-close reason with the
      // final usage, then close the event stream.
      this.finishNarrative("user-close");
    }
    this.sessionState = "closed";
  }

  // -----------------------------------------------------------------------
  // The provider-session attempt (connect + configure + ack)
  // -----------------------------------------------------------------------

  /**
   * ONE connect+configure attempt (shared by the initial start loop
   * and the reconnect resume loop — one budget, one policy):
   * connect → await session.created → send session.update → await
   * session.updated (or the typed provider error).
   */
  private async attemptProviderSessionStart(): Promise<ProviderSessionAttempt> {
    try {
      const connection = await this.config.transport.connect({
        url: qwenRealtimeUrl({ endpoint: this.config.endpoint, modelId: this.config.modelId }),
        authorizationHeader: `Bearer ${this.config.apiKey}`,
      });
      if (this.sessionState !== "starting" && this.sessionState !== "reconnecting") {
        connection.close();
        return { ok: false, terminal: false, detail: "abandoned", recovery: "" };
      }
      this.connection = connection;
      connection.onMessage((text) => this.handleServerFrame(text));
      connection.onClose((code, reason) => this.handleTransportLoss(code, reason));

      const created = await this.waitFor(
        ["session.created"],
        this.config.connectAckTimeoutMs,
        () => "the provider did not send its session handshake frame within the connect timeout",
      );
      if (created.kind === "failure") {
        this.teardownConnection();
        return {
          ok: false,
          terminal: false,
          detail: `the provider session handshake did not complete (${created.reason})`,
          recovery: `retrying with bounded exponential backoff (attempt budget ${this.config.maxReconnectAttempts}); base playback is never blocked`,
        };
      }

      this.lastNormalizedError = null;
      this.sendFrame(serializeQwenSessionUpdate(this.inputs, this.config.clock.now()));
      const ack = await this.waitFor(
        ["session.updated", "error"],
        this.config.connectAckTimeoutMs,
        () => "the provider did not acknowledge the session configuration within the timeout",
      );
      if (ack.kind === "frame" && ack.type === "session.updated") {
        return { ok: true };
      }
      this.teardownConnection();
      if (ack.kind === "frame" && ack.type === "error") {
        const normalized = this.takeLastNormalizedError();
        // The provider answered the configuration with an error
        // frame: the normalized typed outcome drives retry/terminal.
        if (normalized !== null) {
          if (normalized.recoverable) {
            return {
              ok: false,
              terminal: false,
              detail: normalized.detail,
              recovery: normalized.recovery,
            };
          }
          return { ok: false, terminal: true, error: normalized };
        }
      }
      return {
        ok: false,
        terminal: false,
        detail: `the provider session configuration was not acknowledged (${ack.kind === "failure" ? ack.reason : "an error frame arrived"})`,
        recovery: `retrying with bounded exponential backoff (attempt budget ${this.config.maxReconnectAttempts}); base playback is never blocked`,
      };
    } catch (error) {
      this.teardownConnection();
      return {
        ok: false,
        terminal: false,
        detail: `the provider transport connect attempt failed (${error instanceof Error ? error.message : "unknown transport error"})`,
        recovery: `retrying with bounded exponential backoff (attempt budget ${this.config.maxReconnectAttempts}); base playback is never blocked`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // The transport-loss + reconnect machinery
  // -----------------------------------------------------------------------

  private handleTransportLoss(code: number, _reason: string): void {
    // Fail every pending handshake wait (the retry loops observe it).
    this.failWaiters(`the provider transport connection was lost (close code ${code})`);
    if (this.stopping) return; // stop()/close() own the narrative
    if (this.sessionState === "closed" || this.sessionState === "stopped") return;
    if (this.sessionState === "reconnecting") return; // the resume loop owns it
    if (this.sessionState === "idle" || this.sessionState === "starting") return; // the start loop owns it

    // streaming → reconnecting: the typed recoverable error + the
    // resume loop (resume, never restart).
    this.connection = null;
    this.sessionState = "reconnecting";
    this.emitEvent({
      kind: "recoverable-error",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      errorKind: "network",
      detail: `the provider transport connection was lost (close code ${code})`,
      recovery:
        "the adapter is resuming the SAME session — re-establishing the connection, re-sending the session configuration, and replaying the bounded audio tail (resume, never restart); base playback is never blocked",
    });
    void this.runReconnectLoop();
  }

  private async runReconnectLoop(): Promise<void> {
    while (this.sessionState === "reconnecting") {
      if (this.retryBudgetUsed >= this.config.maxReconnectAttempts) {
        // THE HONEST GIVE-UP: a typed terminal error; base playback
        // continues (the session is an overlay with no playback
        // capability — the shared law is total).
        this.emitTerminalError(
          "network",
          `the provider transport connection could not be re-established after ${this.retryBudgetUsed} bounded retry attempts`,
          "the translation overlay ended honestly — base playback and the original captions continue (the shared law is total); start a new session when the network recovers",
        );
        return;
      }

      const delayMs = this.config.backoff.delayMsForAttempt(this.retryBudgetUsed);
      if (delayMs > 0) {
        await this.raceDelayOrTrigger(delayMs);
      }
      if (this.sessionState !== "reconnecting") return; // closed during the wait
      this.reconnectTriggered = false;

      const attempt = await this.attemptProviderSessionStart();
      if (this.sessionState !== "reconnecting") return; // closed during the attempt
      if (attempt.ok) {
        this.sessionState = "streaming";
        // Replay the bounded media tail (resume, never restart).
        await this.flushBufferedMedia();
        return;
      }
      if (attempt.terminal) {
        this.emitTerminalError(attempt.error.errorKind, attempt.error.detail, attempt.error.recovery);
        return;
      }
      this.retryBudgetUsed += 1;
      this.emitEvent({
        kind: "recoverable-error",
        sessionId: this.sessionId,
        occurredAt: this.nowIso(),
        errorKind: "network",
        detail: attempt.detail,
        recovery: attempt.recovery,
      });
    }
  }

  private async raceDelayOrTrigger(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.reconnectTrigger = null;
        resolve();
      };
      this.reconnectTrigger = finish;
      void this.config.clock.sleep(delayMs).then(finish);
      if (this.reconnectTriggered) {
        // A reconnect() call already arrived: run now.
        finish();
      }
    });
  }

  private teardownConnection(): void {
    this.connection?.close();
    this.connection = null;
  }

  // -----------------------------------------------------------------------
  // The wait machinery (frame-accepting, loss-failing, timeout-bounded)
  // -----------------------------------------------------------------------

  /**
   * Wait until a provider frame of one of `accepts` arrives (resolving
   * with the frame outcome), or the timeout/transport-loss fires
   * (resolving with the honest failure reason — never a rejection:
   * the retry loops observe failures as data). Real timers gate the
   * watchdog only; frame delivery always beats a ≥1ms timer under the
   * recorded double — deterministic.
   */
  private waitFor(
    accepts: readonly string[],
    timeoutMs: number,
    onTimeout: () => string,
  ): Promise<WaitOutcome> {
    return new Promise<WaitOutcome>((resolve) => {
      let settled = false;
      const entry: WaiterEntry = {
        accepts,
        finish: (outcome: WaitOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const index = this.waiters.indexOf(entry);
          if (index >= 0) this.waiters.splice(index, 1);
          resolve(outcome);
        },
      };
      this.waiters.push(entry);
      const timer = setTimeout(() => {
        entry.finish({ kind: "failure", reason: onTimeout() });
      }, Math.max(1, timeoutMs));
    });
  }

  private failWaiters(reason: string): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.finish({ kind: "failure", reason });
    }
  }

  private acceptWaiters(type: string): void {
    // Serve the FIRST waiter whose accepts list includes this frame
    // type, in FIFO order (the handshake waits are sequential by
    // construction).
    const index = this.waiters.findIndex((waiter) => waiter.accepts.includes(type));
    if (index < 0) return;
    const [waiter] = this.waiters.splice(index, 1);
    waiter?.finish({ kind: "frame", type });
  }

  // -----------------------------------------------------------------------
  // The server-frame dispatch (the reconstruction heart)
  // -----------------------------------------------------------------------

  private handleServerFrame(text: string): void {
    if (this.narrativeClosed) return; // the narrative is complete; stale frames are inert
    const event: QwenServerEvent = parseQwenServerEvent(text);
    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.acceptWaiters(event.type);
        return;
      case "session.finished":
        this.acceptWaiters("session.finished");
        return;
      case "error": {
        const normalized = normalizeQwenProviderError(event.error);
        this.lastNormalizedError = normalized;
        this.acceptWaiters("error");
        if (this.waiters.length === 0) {
          // An error frame with nobody waiting on it (mid-stream):
          // recoverable → the typed notice (the session continues);
          // terminal → the honest typed end.
          if (normalized.recoverable) {
            this.emitEvent({
              kind: "recoverable-error",
              sessionId: this.sessionId,
              occurredAt: this.nowIso(),
              errorKind: normalized.errorKind,
              detail: normalized.detail,
              recovery: normalized.recovery,
            });
          } else {
            this.emitTerminalError(normalized.errorKind, normalized.detail, normalized.recovery);
          }
        }
        return;
      }
      case "response.created":
      case "response.audio.done":
      case "input_audio_buffer.committed":
      case "input_audio_buffer.cleared":
        return; // lifecycle noise — no neutral vocabulary to map
      case "input_audio_buffer.speech_started":
        this.onSpeechStarted(event.audioStartMs, event.itemId, event.speakerId);
        return;
      case "input_audio_buffer.speech_stopped":
        this.onSpeechStopped(event.audioEndMs, event.itemId);
        return;
      case "conversation.item.input_audio_transcription.delta":
        this.onTranscriptionDelta(event.itemId, event.delta);
        return;
      case "conversation.item.input_audio_transcription.completed":
        this.onTranscriptionCompleted(event.itemId, event.transcript, event.language);
        return;
      case "conversation.item.input_audio_transcription.failed": {
        const normalized = normalizeQwenProviderError(event.error);
        this.emitEvent({
          kind: "recoverable-error",
          sessionId: this.sessionId,
          occurredAt: this.nowIso(),
          errorKind: normalized.errorKind,
          detail: `the provider's source-transcription failed for one utterance: ${normalized.detail}`,
          recovery:
            "the translation continues for subsequent utterances — the failed segment simply has no source transcript (per-item failure, never a session kill); base playback is never blocked",
        });
        return;
      }
      case "conversation.item.created":
        if (event.previousItemId !== undefined) {
          this.sourceItemByTranslationItem.set(event.itemId, event.previousItemId);
        }
        return;
      case "response.text.delta":
      case "response.audio_transcript.delta":
        this.onTranslationDelta(event.itemId, event.delta);
        return;
      case "response.text.done":
        this.onTranslationFinal(event.itemId, event.text);
        return;
      case "response.audio_transcript.done":
        this.onTranslationFinal(event.itemId, event.transcript);
        return;
      case "response.audio.delta":
        this.onTranslatedAudioDelta(event.itemId, event.deltaBase64);
        return;
      case "response.done":
        this.onResponseDone(event.response.usage);
        return;
      case "unparseable":
        this.emitEvent({
          kind: "recoverable-error",
          sessionId: this.sessionId,
          occurredAt: this.nowIso(),
          errorKind: "unknown",
          detail: `an unparsable provider frame arrived (${event.reason}) — recorded honestly, never silently dropped`,
          recovery:
            "the adapter's protocol vocabulary may lag the provider's evolution; the session continues and the raw frame is available in diagnostics",
        });
        return;
    }
  }

  // --- the reconstruction paths (each documented frame → each neutral event) ---

  private onSpeechStarted(
    audioStartMs: number,
    itemId: string,
    speakerId: number | undefined,
  ): void {
    const timing =
      this.timingByItemId.get(itemId) ?? { startedAtMs: audioStartMs, endedAtMs: audioStartMs };
    timing.startedAtMs = audioStartMs;
    this.timingByItemId.set(itemId, timing);

    if (speakerId === undefined) return;
    this.speakerByItemId.set(itemId, speakerId);

    if (this.inputs.speakerAttribution === "off") return; // attribution disabled

    // First-appearance ordinal → the simple contextual label (R25-G).
    let ordinal = this.speakerOrdinalByProviderId.get(speakerId);
    if (ordinal === undefined) {
      ordinal = this.speakerOrdinalByProviderId.size + 1;
      this.speakerOrdinalByProviderId.set(speakerId, ordinal);
    }
    this.emitEvent({
      kind: "speaker-attribution",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      speakerId: qwenSpeakerId(speakerId),
      label: qwenSpeakerLabel(ordinal),
      segmentId: itemId,
      // Server diarization is honest separation, NOT trusted source
      // metadata — the label grammar stays simple (R25-G) and
      // trustedSource stays false (the adapter never fabricates
      // trusted metadata).
      trustedSource: false,
    });
  }

  private onSpeechStopped(audioEndMs: number, itemId: string): void {
    const timing =
      this.timingByItemId.get(itemId) ?? { startedAtMs: audioEndMs, endedAtMs: audioEndMs };
    timing.endedAtMs = Math.max(timing.startedAtMs, audioEndMs);
    this.timingByItemId.set(itemId, timing);
  }

  private onTranscriptionDelta(itemId: string, delta: string): void {
    this.emitEvent({
      kind: "source-transcript-delta",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      segmentId: itemId,
      deltaText: delta,
      timing: this.timingFor(itemId),
    });
    if (!this.timingFirstsEmitted.transcript) {
      this.timingFirstsEmitted.transcript = true;
      this.firstSourceTranscriptDeltaWallMs = this.config.clock.now();
      this.emitTimingMetadata();
    }
  }

  private onTranscriptionCompleted(
    itemId: string,
    transcript: string,
    language: string | undefined,
  ): void {
    const speakerProviderId = this.speakerByItemId.get(itemId);
    this.emitEvent({
      kind: "source-transcript-final",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      segmentId: itemId,
      text: transcript,
      timing: this.timingFor(itemId),
      ...(language !== undefined ? { sourceLanguage: language } : {}),
      ...(speakerProviderId !== undefined && this.inputs.speakerAttribution !== "off"
        ? { speakerId: qwenSpeakerId(speakerProviderId) }
        : {}),
    });
  }

  private onTranslationDelta(itemId: string, delta: string): void {
    const sourceSegmentId = this.sourceItemByTranslationItem.get(itemId);
    this.emitEvent({
      kind: "translation-delta",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      segmentId: itemId,
      ...(sourceSegmentId !== undefined ? { sourceSegmentId } : {}),
      targetLanguage: this.inputs.targetLanguage,
      deltaText: delta,
    });
    if (!this.timingFirstsEmitted.translation) {
      this.timingFirstsEmitted.translation = true;
      this.firstTranslationDeltaWallMs = this.config.clock.now();
      this.emitTimingMetadata();
    }
  }

  private onTranslationFinal(itemId: string, text: string): void {
    const sourceSegmentId = this.sourceItemByTranslationItem.get(itemId);
    this.emitEvent({
      kind: "translation-segment-final",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      segmentId: itemId,
      ...(sourceSegmentId !== undefined ? { sourceSegmentId } : {}),
      targetLanguage: this.inputs.targetLanguage,
      text,
      timing:
        sourceSegmentId !== undefined ? this.timingFor(sourceSegmentId) : this.timingFor(itemId),
    });
  }

  private onTranslatedAudioDelta(itemId: string, deltaBase64: string): void {
    const decoded = base64ToBytes(deltaBase64);
    if (decoded === undefined) {
      this.emitEvent({
        kind: "recoverable-error",
        sessionId: this.sessionId,
        occurredAt: this.nowIso(),
        errorKind: "unknown",
        detail:
          "a translated-audio chunk arrived with a malformed Base64 payload — the chunk was not silently passed through",
        recovery:
          "the chunk was dropped with this typed notice (never a silent drop); the translated-audio overlay continues with the next chunk",
      });
      return;
    }
    const sourceSegmentId = this.sourceItemByTranslationItem.get(itemId);
    this.audioChunkSequence += 1;
    this.emitEvent({
      kind: "translated-audio-chunk",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      sequence: this.audioChunkSequence,
      audio: decoded,
      format: "pcm16",
      timing:
        sourceSegmentId !== undefined ? this.timingFor(sourceSegmentId) : this.timingFor(itemId),
    });
    if (!this.timingFirstsEmitted.audio) {
      this.timingFirstsEmitted.audio = true;
      this.firstTranslatedAudioChunkWallMs = this.config.clock.now();
      this.emitTimingMetadata();
    }
  }

  private onResponseDone(usage: QwenResponseUsage | undefined): void {
    const reported = qwenUsageToSessionUsage(usage);
    // Accumulate the provider-reported truth (monotonic totals; cost
    // derivation NEVER happens here — that is the cost model's law).
    this.usageTotals = {
      inputAudioTokens: this.usageTotals.inputAudioTokens + reported.inputAudioTokens,
      textOutputTokens: this.usageTotals.textOutputTokens + reported.textOutputTokens,
      outputAudioTokens: this.usageTotals.outputAudioTokens + reported.outputAudioTokens,
      imageInputTokens: this.usageTotals.imageInputTokens + reported.imageInputTokens,
    };
    this.emitEvent({
      kind: "usage-telemetry",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      usage: this.usageTotals,
    });
  }

  private emitTimingMetadata(): void {
    const since = (wallMs: number | null): number | undefined =>
      wallMs === null || this.startWallMs === 0 ? undefined : Math.max(0, wallMs - this.startWallMs);
    const firstSourceTranscriptDeltaMs = since(this.firstSourceTranscriptDeltaWallMs);
    const firstTranslationDeltaMs = since(this.firstTranslationDeltaWallMs);
    const firstTranslatedAudioChunkMs = since(this.firstTranslatedAudioChunkWallMs);
    this.emitEvent({
      kind: "timing-metadata",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      ...(firstSourceTranscriptDeltaMs !== undefined ? { firstSourceTranscriptDeltaMs } : {}),
      ...(firstTranslationDeltaMs !== undefined ? { firstTranslationDeltaMs } : {}),
      ...(firstTranslatedAudioChunkMs !== undefined ? { firstTranslatedAudioChunkMs } : {}),
      ...(firstSourceTranscriptDeltaMs !== undefined && firstTranslationDeltaMs !== undefined
        ? {
            sourceToTranslationLagMs: Math.max(
              0,
              firstTranslationDeltaMs - firstSourceTranscriptDeltaMs,
            ),
          }
        : {}),
    });
  }

  // -----------------------------------------------------------------------
  // The shared helpers
  // -----------------------------------------------------------------------

  private timingFor(itemId: string): RealtimeSegmentTiming {
    const record = this.timingByItemId.get(itemId);
    if (record === undefined) return { startedAtMs: 0, endedAtMs: 0 };
    return { startedAtMs: record.startedAtMs, endedAtMs: record.endedAtMs };
  }

  private trimReplayWindow(): void {
    const cutoff = this.config.clock.now() - this.config.audioReplayWindowMs;
    while (this.replayBuffer.length > 0 && this.replayBuffer[0]!.appendedAtWallMs < cutoff) {
      this.replayBuffer.shift();
    }
  }

  /** Flush buffered audio (the resume tail), then pending image frames (audio-first wire order). */
  private async flushBufferedMedia(): Promise<void> {
    for (const chunk of [...this.replayBuffer]) {
      if (this.connection === null || this.sessionState !== "streaming") return;
      this.sendFrame(serializeQwenAudioAppend(chunk.audio, this.config.clock.now()));
      await this.config.clock.sleep(0); // yield between frames
    }
    for (const frame of this.pendingImageFrames.splice(0)) {
      if (this.connection === null || this.sessionState !== "streaming") {
        // Re-buffer what could not be sent (never a silent drop).
        this.pendingImageFrames.push(frame);
        return;
      }
      this.sendFrame(serializeQwenImageAppend(frame, this.config.clock.now()));
    }
  }

  private sendFrame(frame: QwenClientFrame): void {
    if (this.connection === null) return;
    try {
      this.connection.send(JSON.stringify(frame));
      if (frame.type === "input_audio_buffer.append") {
        this.audioAppendCount += 1;
      }
    } catch (error) {
      // A send failure is transport loss: the reconnect path owns it.
      void error;
      this.handleTransportLoss(1006, "send failure");
    }
  }

  private assertLegalOperation(operation: RealtimeTranslationOperation): void {
    if (
      !isRealtimeOperationLegal(operation, this.sessionState, {
        visualContextPolicy: this.inputs.visualContextPolicy,
      })
    ) {
      throw new QwenAdapterOperationError(
        operation,
        this.sessionState,
        `operation '${operation}' is illegal in session state '${this.sessionState}' (the frozen realtime state machine)`,
      );
    }
  }

  private emitTerminalError(
    errorKind: RealtimeTranslationErrorKind,
    detail: string,
    recovery: string,
  ): void {
    this.emitEvent({
      kind: "terminal-error",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      errorKind,
      detail,
    });
    void recovery; // the recovery sentence lives on the paired recoverable-error/registration path
    this.teardownConnection();
    this.finishNarrative("terminal-error");
    this.sessionState = "closed";
  }

  private finishNarrative(reason: QwenCloseReason): void {
    if (this.narrativeClosed) return;
    this.narrativeClosed = true;
    this.emitEvent({
      kind: "session-closed",
      sessionId: this.sessionId,
      occurredAt: this.nowIso(),
      reason,
      finalUsage: this.usageTotals,
    });
    this.stream.close();
  }

  private emitEvent(event: RealtimeTranslationEvent): void {
    if (this.narrativeClosed) {
      // The stream's own law: never push after close. The state
      // machine + the handleServerFrame guard make this unreachable
      // in correct wiring — fail fast if it ever happens.
      throw new Error(
        `qwen adapter wiring bug: event '${event.kind}' emitted after the session narrative closed — events must never be dropped silently`,
      );
    }
    this.stream.push(event);
  }

  private nowIso(): string {
    return new Date(this.config.clock.now()).toISOString();
  }
}

// ---------------------------------------------------------------------------
// The session-start gate (the RPM smoothing, factory-scoped)
// ---------------------------------------------------------------------------

/**
 * The factory-scoped session-start gate: consecutive provider session
 * starts are spaced to the RPM cadence (6000 ms at RPM=10). The wait
 * is BOUNDED by the interval (never longer), uses the injectable
 * clock, and never fails — smoothing is policy, not error.
 */
class QwenSessionStartGate {
  private lastStartAtMs: number | null = null;

  async awaitTurn(clock: QwenAdapterClock, minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) {
      this.lastStartAtMs = clock.now();
      return;
    }
    const now = clock.now();
    if (this.lastStartAtMs !== null) {
      const elapsed = now - this.lastStartAtMs;
      if (elapsed < minIntervalMs) {
        await clock.sleep(Math.min(minIntervalMs - elapsed, minIntervalMs));
      }
    }
    this.lastStartAtMs = clock.now();
  }
}

// ---------------------------------------------------------------------------
// The factory (the RealtimeTranslationSessionFactory implementation)
// ---------------------------------------------------------------------------

/**
 * Create the Qwen LiveTranslate `RealtimeTranslationSessionFactory` —
 * the adapter's factory seam. `open()` validates the inputs against
 * the frozen fail-closed contract (the legal-audio gate, the consent
 * gate, the vocabulary members) BEFORE any session exists; the
 * session's own state machine + event reconstruction are
 * `QwenLiveTranslateSession`'s.
 */
export function createQwenLiveTranslateSessionFactory(
  config: QwenLiveTranslateAdapterConfig,
): {
  readonly factory: RealtimeTranslationSessionFactory;
  /** Observability: the endpoint/model pair this factory binds (provenance-named). */
  readonly boundEndpoint: string;
  readonly boundModelId: string;
} {
  const resolved = resolveQwenConfig(config);
  const gate = new QwenSessionStartGate();
  let sessionCounter = 0;

  const factory: RealtimeTranslationSessionFactory = {
    async open(inputs: RealtimeTranslationSessionInputs) {
      const validation = validateRealtimeTranslationSessionInputs(inputs);
      if (!validation.ok) {
        throw new QwenAdapterInputError(validation.issues);
      }
      sessionCounter += 1;
      const { stream, events } = createRealtimeEventStream();
      const sessionId = `qwen-live-${resolved.clock.now()}-${sessionCounter}`;
      return new QwenLiveTranslateSession(
        sessionId,
        validation.value,
        resolved,
        gate,
        stream,
        events,
      );
    },
  };

  return {
    factory,
    boundEndpoint: resolved.endpoint,
    boundModelId: resolved.modelId,
  };
}

// ---------------------------------------------------------------------------
// The env-wired specialist construction (the registration path)
// ---------------------------------------------------------------------------

/** The typed outcome of constructing the Qwen specialist from the server environment. */
export type QwenSpecialistConstruction =
  | {
      readonly ok: true;
      readonly registration: {
        readonly providerId: string;
        readonly descriptor: typeof QWEN_LIVETRANSLATE_FLASH_REALTIME;
        readonly factory: RealtimeTranslationSessionFactory;
        readonly endpoint: string;
        readonly modelId: string;
      };
    }
  | {
      readonly ok: false;
      readonly credential: { readonly variable: string; readonly recovery: string };
    };

/**
 * Construct the Qwen LiveTranslate specialist registration from the
 * SERVER environment (the credential path — the bridge lane calls
 * this server-side only). An absent credential is the honest typed
 * NOT-REGISTERED answer carrying the recovery sentence: the router
 * then reports the honest gap instead of routing to a provider that
 * cannot run, and nothing crashes.
 *
 * The optional endpoint override honors the
 * `QWEN_LIVETRANSLATE_WS_URL` environment variable (deployments
 * against the Model Studio international endpoint, provenance-named
 * in the protocol module).
 */
export function createQwenLiveTranslateSpecialist(
  env: Record<string, string | undefined>,
  deps: {
    readonly transport: QwenRealtimeTransport;
    readonly clock?: QwenAdapterClock;
    readonly backoff?: QwenBackoffSchedule;
    readonly maxReconnectAttempts?: number;
    readonly sessionStartMinIntervalMs?: number;
  },
): QwenSpecialistConstruction {
  const credential = readQwenLiveTranslateCredential(env);
  if (!credential.ok) {
    return { ok: false, credential };
  }
  const endpointOverride = env["QWEN_LIVETRANSLATE_WS_URL"];
  const { factory, boundEndpoint, boundModelId } = createQwenLiveTranslateSessionFactory({
    apiKey: credential.apiKey,
    ...(endpointOverride !== undefined && endpointOverride.trim().length > 0
      ? { endpoint: endpointOverride.trim() }
      : {}),
    transport: deps.transport,
    ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
    ...(deps.backoff !== undefined ? { backoff: deps.backoff } : {}),
    ...(deps.maxReconnectAttempts !== undefined
      ? { maxReconnectAttempts: deps.maxReconnectAttempts }
      : {}),
    ...(deps.sessionStartMinIntervalMs !== undefined
      ? { sessionStartMinIntervalMs: deps.sessionStartMinIntervalMs }
      : {}),
  });
  return {
    ok: true,
    registration: {
      providerId: REALTIME_TRANSLATION_SPECIALIST_PROVIDER_ID,
      descriptor: QWEN_LIVETRANSLATE_FLASH_REALTIME,
      factory,
      endpoint: boundEndpoint,
      modelId: boundModelId,
    },
  };
}
