/**
 * @wfx/app-web — the R25 realtime WIRE (R25-D, the web lane's browser ↔
 * bridge transport, bound to the SHARED contracts verbatim).
 *
 * THE BINDING LAW (the dispatch's own words): Worker 1 owns the shared
 * contracts; this lane binds them verbatim and NEVER invents a second
 * vocabulary. After the `wfx/r25/shared` lane landed, this module binds:
 *
 * - the OPERATIONS: the frozen 7-op command surface from `@wfx/domain`
 *   (`start` / `configure` / `append-audio` / `append-image-frame` /
 *   `stop` / `reconnect` / `close`) — the wire's client messages ARE
 *   those operations (plus the session/resume-token routing the bridge's
 *   transport layer needs);
 * - the EVENTS: the frozen 12-kind closed union from `@wfx/domain`
 *   (`session-created` … `session-closed`) — the bridge relays the
 *   domain events VERBATIM over the wire. The ONE transport encoding is
 *   documented here: the domain's `audio: Uint8Array` field serializes
 *   as `audioBase64: string` in JSON transit (binary over a JSON wire);
 *   every other field binds the frozen shapes unchanged
 *   (`occurredAt: string` ISO, `segmentId: string`, `deltaText`,
 *   `timing: RealtimeSegmentTiming`, `usage: RealtimeSessionUsage`, the
 *   closed `errorKind` / close-reason unions);
 * - the VALIDATION: `validateRealtimeTranslationSessionInputs` (the
 *   shared module's own fail-closed gates — the legal-audio gate and
 *   the consent gate included) backs the bridge's session-start;
 * - the COST/ANONYMOUS POLICY: the shared `RealtimeTranslationCostPolicy`
 *   + `DEFAULT_REALTIME_ANONYMOUS_QUOTA` + `resolveRealtimeOutputModality`
 *   + `evaluateRealtimeSessionPolicy` are the bridge's policy engine —
 *   never a second policy.
 *
 * THE TRANSPORT ENVELOPE (the bridge's own, honestly named as transport
 * — never product events): the bridge's connection-management acks
 * (`session-bound` with the resume token + the bridge policy truths,
 * `session-resumed` with the continuity cursor, `refused` for the typed
 * transport-level refusals). Product-level truth rides ONLY the frozen
 * event vocabulary.
 *
 * THE R25-L INSTRUMENTATION (this lane's own observation layer, the
 * J40/J41 telemetry-contract precedent): the client-side marker record
 * + the measured metric set + the pure derivation. These are the
 * product's OBSERVATIONS of the stream, not a session vocabulary.
 *
 * THE PERSISTENCE LAW (§R25-D): the bridge persists ONLY continuity
 * state (the resume token + the last committed segment) and telemetry
 * records. Raw media (audio chunks) is relayed, never stored.
 */

import type {
  RealtimeAudioChunkInput,
  RealtimeImageFrameInput,
  RealtimeSessionConfiguration,
  RealtimeSessionUsage,
  RealtimeTranslationErrorKind,
  RealtimeTranslationEvent,
  RealtimeTranslationSessionInputs,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// The wire's event encoding (the ONE documented transport encoding)
// ---------------------------------------------------------------------------

/** The wire form of the translated-audio-chunk (bytes → base64). */
export type RealtimeWireAudioChunk = Omit<
  Extract<RealtimeTranslationEvent, { kind: "translated-audio-chunk" }>,
  "audio"
> & {
  readonly audioBase64: string;
};

/**
 * The wire form of one domain event: every frozen field unchanged, with
 * the single documented transport encoding — `translated-audio-chunk`'s
 * `audio: Uint8Array` serializes as `audioBase64: string` over the JSON
 * wire (decoded back to the domain shape at the receiving boundary).
 */
export type RealtimeWireEvent =
  | Exclude<RealtimeTranslationEvent, { kind: "translated-audio-chunk" }>
  | RealtimeWireAudioChunk;

/** Decode one wire event into the domain event (the audio chunk's base64 → bytes). */
export function decodeRealtimeWireEvent(wire: RealtimeWireEvent): RealtimeTranslationEvent {
  if (wire.kind === "translated-audio-chunk") {
    const { audioBase64, ...rest } = wire;
    return { ...rest, audio: base64ToBytes(audioBase64) };
  }
  return wire;
}

/** Encode one domain event into the wire form (the audio chunk's bytes → base64). */
export function encodeRealtimeWireEvent(event: RealtimeTranslationEvent): RealtimeWireEvent {
  if (event.kind === "translated-audio-chunk") {
    const { audio, ...rest } = event;
    return { ...rest, audioBase64: bytesToBase64(audio) };
  }
  return event;
}

/** Base64 → bytes (the chunk decode half of the transport encoding). */
export function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** Bytes → base64 (the chunk encode half of the transport encoding). */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------
// The client → bridge messages (the frozen OPERATIONS + the transport routing)
// ---------------------------------------------------------------------------

/** `start` — open + start one session (the domain inputs, JSON-shaped). */
export interface RealtimeWireStartMessage {
  readonly op: "start";
  /** The domain session inputs (validated by the SHARED fail-closed validator). */
  readonly inputs: RealtimeTranslationSessionInputs;
}

/** `reconnect` — reattach a dropped client connection onto a retained session (the transport resume). */
export interface RealtimeWireReconnectMessage {
  readonly op: "reconnect";
  readonly sessionId: string;
  /** The bridge's transport resume token (continuity — §R25-A reconnect/resume). */
  readonly resumeToken: string;
}

/** `configure` — the domain mid-session reconfiguration subset. */
export interface RealtimeWireConfigureMessage {
  readonly op: "configure";
  readonly sessionId: string;
  readonly configuration: RealtimeSessionConfiguration;
}

/** `append-audio` — the production capture path (WebFlix-owned stages only). */
export interface RealtimeWireAppendAudioMessage {
  readonly op: "append-audio";
  readonly sessionId: string;
  /** Base64 PCM frames (the wire encoding of the domain's `audio: Uint8Array`). */
  readonly audioBase64: string;
  readonly mediaPositionMs?: number;
}

/** `append-image-frame` — the visual-context path (legal only under an 'adaptive' policy — never forced). */
export interface RealtimeWireAppendImageFrameMessage {
  readonly op: "append-image-frame";
  readonly sessionId: string;
  readonly frameBase64: string;
  readonly mediaPositionMs?: number;
}

/** `stop` / `close` — the domain's end operations. */
export interface RealtimeWireEndMessage {
  readonly op: "stop" | "close";
  readonly sessionId: string;
}

/** The client → bridge message union (the frozen operations, transport-routed). */
export type RealtimeWireClientMessage =
  | RealtimeWireStartMessage
  | RealtimeWireReconnectMessage
  | RealtimeWireConfigureMessage
  | RealtimeWireAppendAudioMessage
  | RealtimeWireAppendImageFrameMessage
  | RealtimeWireEndMessage;

// ---------------------------------------------------------------------------
// The bridge → client transport envelope (connection management, honestly
// named — product truth rides ONLY the frozen event vocabulary)
// ---------------------------------------------------------------------------

/** The bridge's bridge policy truths (derived from the SHARED cost policy — §R25-K). */
export interface RealtimeBridgePolicyTruth {
  /** The effective output modality after the shared policy resolution. */
  readonly effectiveOutputModality: "text" | "text-and-audio";
  /** Whether the policy degraded the requested modality (visible, never silent). */
  readonly degradedFromRequested: boolean;
  /** The shared modality-resolution reason. */
  readonly modalityReason: string;
  /** The session duration limit (ms) — the anonymous quota when the viewer is anonymous. */
  readonly maxSessionDurationMs: number;
  /** The honest basis of the limit (the shared quota's own basis). */
  readonly durationBasis: string;
}

/**
 * `session-bound` — the transport ack for a started session: the
 * bridge's session id + resume token + the policy truths + the honest
 * source-stream truth ("scripted-dev-double" in the fixtures boot —
 * loudly labeled; "captured-audio" on the real owned-stage capture path).
 */
export interface RealtimeTransportSessionBound {
  readonly transport: "session-bound";
  readonly sessionId: string;
  readonly resumeToken: string;
  readonly sourceStream: "scripted-dev-double" | "captured-audio";
  readonly policy: RealtimeBridgePolicyTruth;
  /** The realtime envelope's honest latency profile (rendered, never promised). */
  readonly envelope: { readonly reportedAverageLagMs: number };
}

/** `session-resumed` — the recovery confirmation (the continuity cursor). */
export interface RealtimeTransportSessionResumed {
  readonly transport: "session-resumed";
  readonly sessionId: string;
  readonly recovered: "provider-connection" | "client-connection";
  /** The last committed source segment (the stream's resume cursor). */
  readonly lastCommittedSegmentId: string;
}

/** `refused` — a typed transport-level refusal (the domain errorKind vocabulary). */
export interface RealtimeTransportRefused {
  readonly transport: "refused";
  readonly errorKind: RealtimeTranslationErrorKind;
  readonly detail: string;
  /** The useful next action (the no-dead-end law). */
  readonly recovery: string;
}

/** The bridge → client transport-envelope union. */
export type RealtimeTransportMessage =
  | RealtimeTransportSessionBound
  | RealtimeTransportSessionResumed
  | RealtimeTransportRefused;

// ---------------------------------------------------------------------------
// Wire parsing (typed validation at the bridge boundary — never a trusted cast)
// ---------------------------------------------------------------------------

/** The parsed/validated client message (the typed refusal carries the domain errorKind). */
export type ParsedRealtimeWireClientMessage =
  | RealtimeWireClientMessage
  | { readonly op: "invalid"; readonly detail: string };

/** Parse + structurally validate one client wire message. */
export function parseRealtimeWireClientMessage(raw: string): ParsedRealtimeWireClientMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { op: "invalid", detail: "the message is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { op: "invalid", detail: "the message is not an object" };
  }
  const message = parsed as Record<string, unknown>;
  const op = message["op"];
  const sessionId = typeof message["sessionId"] === "string" ? message["sessionId"] : null;
  if (op === "start") {
    if (typeof message["inputs"] !== "object" || message["inputs"] === null) {
      return { op: "invalid", detail: "start.inputs: expected an object" };
    }
    return { op: "start", inputs: message["inputs"] as RealtimeTranslationSessionInputs };
  }
  if (op === "reconnect") {
    const resumeToken = message["resumeToken"];
    if (sessionId === null || typeof resumeToken !== "string" || resumeToken.length === 0) {
      return { op: "invalid", detail: "reconnect: sessionId and resumeToken are required" };
    }
    return { op: "reconnect", sessionId, resumeToken };
  }
  if (op === "configure") {
    if (sessionId === null) {
      return { op: "invalid", detail: "configure: sessionId is required" };
    }
    if (typeof message["configuration"] !== "object" || message["configuration"] === null) {
      return { op: "invalid", detail: "configure.configuration: expected an object" };
    }
    return {
      op: "configure",
      sessionId,
      configuration: message["configuration"] as RealtimeSessionConfiguration,
    };
  }
  if (op === "append-audio" || op === "append-image-frame") {
    if (sessionId === null) {
      return { op: "invalid", detail: `${op}: sessionId is required` };
    }
    const payloadKey = op === "append-audio" ? "audioBase64" : "frameBase64";
    const payload = message[payloadKey];
    if (typeof payload !== "string" || payload.length === 0) {
      return { op: "invalid", detail: `${op}.${payloadKey}: required` };
    }
    const mediaPositionMs = message["mediaPositionMs"];
    return op === "append-audio"
      ? {
          op,
          sessionId,
          audioBase64: payload,
          ...(typeof mediaPositionMs === "number" && Number.isFinite(mediaPositionMs)
            ? { mediaPositionMs }
            : {}),
        }
      : {
          op,
          sessionId,
          frameBase64: payload,
          ...(typeof mediaPositionMs === "number" && Number.isFinite(mediaPositionMs)
            ? { mediaPositionMs }
            : {}),
        };
  }
  if (op === "stop" || op === "close") {
    if (sessionId === null) {
      return { op: "invalid", detail: `${op}: sessionId is required` };
    }
    return { op, sessionId };
  }
  return { op: "invalid", detail: `unknown operation '${String(op)}'` };
}

// ---------------------------------------------------------------------------
// The provider-side session seam (the domain port — Worker 1's frozen shape)
// ---------------------------------------------------------------------------

/**
 * The provider session seam the bridge consumes: the frozen
 * `RealtimeTranslationSession` port (the domain shape, Worker 1's
 * R25-A) plus the adapter-side observability the bridge's transport
 * needs (the provider token for resume + the state-change notice).
 * In the fixtures boot the deterministic dev provider double implements
 * it (see dev-realtime-session.ts); in the service boot the
 * Model-Fabric-registered adapter binds it when Worker 1's R25-C lands.
 */
export interface RealtimeProviderSessionSeam {
  /** The frozen session port (the domain surface, verbatim). */
  readonly session: {
    readonly sessionId: string;
    readonly state:
      | "idle"
      | "starting"
      | "streaming"
      | "reconnecting"
      | "stopped"
      | "closed";
    start(): Promise<void>;
    configure(configuration: RealtimeSessionConfiguration): Promise<void>;
    appendAudio(chunk: RealtimeAudioChunkInput): Promise<void>;
    appendImageFrame(frame: RealtimeImageFrameInput): Promise<void>;
    stop(): Promise<void>;
    reconnect(): Promise<void>;
    close(): Promise<void>;
    events(): AsyncIterable<RealtimeTranslationEvent>;
  };
  /** The provider-side session token (the bridge's provider-resume continuity key). */
  readonly providerToken: string;
  /**
   * The adapter-side state-change notice (the bridge drives the domain
   * 'reconnect' operation when the adapter enters 'reconnecting', and
   * relays the transport recovery confirmation when it re-streams).
   */
  onStateChange(handler: (state: RealtimeProviderSessionSeam["session"]["state"]) => void): () => void;
}

/** The typed refusal the seam answers when a session cannot open. */
export interface RealtimeSeamRefusal {
  readonly ok: false;
  readonly errorKind: RealtimeTranslationErrorKind;
  readonly detail: string;
  readonly recovery: string;
}

/**
 * The provider session seam FACTORY (the bridge's injection point — the
 * Model-Fabric realtime route's shape): opens one domain session for
 * the validated inputs, or answers the typed refusal.
 */
export interface RealtimeProviderSeamFactory {
  /** The provider-neutral provider id (registered through the seam). */
  readonly providerId: string;
  /** The honest provider detail sentence (the loud dev badge in the fixtures boot). */
  readonly providerDetail: string;
  /** The provider's reported average lag (the envelope truth, rendered never promised). */
  readonly reportedAverageLagMs: number;
  /** The provider's declared target languages (the honest direction truth). */
  readonly targetLanguages: readonly { readonly code: string; readonly label: string }[];
  open(
    inputs: RealtimeTranslationSessionInputs,
  ): Promise<RealtimeProviderSessionSeam | RealtimeSeamRefusal>;
}

// ---------------------------------------------------------------------------
// The R25-L web latency metrics (this lane's observation layer)
// ---------------------------------------------------------------------------

/** The client-side marker record (the product's own observation — the J40/J41 discipline). */
export interface RealtimeMarkerRecord {
  readonly marker:
    | "session-start-requested"
    | "session-bound"
    | "session-created"
    | "first-source-transcript-delta"
    | "first-translation-delta"
    | "first-translated-audio-chunk"
    | "first-stable-segment"
    | "client-disconnected"
    | "reconnect-requested"
    | "reconnected"
    | "recoverable-error"
    | "terminal-error"
    | "session-closed";
  readonly atMs: number;
  readonly note?: string;
}

/** The R25-L web metric set (§R25-L, measured — never copied from marketing). */
export interface RealtimeLatencyMetrics {
  /** session-start → the first source-transcript-delta arrival. */
  readonly firstSourceTranscriptDeltaMs: number | null;
  /** session-start → the first translation-delta arrival. */
  readonly firstTranslatedTextDeltaMs: number | null;
  /** session-start → the first translated-audio-chunk arrival (null when text-only). */
  readonly firstTranslatedSpeechChunkMs: number | null;
  /** session-start → the first translation-segment-final arrival (the stable segment). */
  readonly stableSegmentMs: number | null;
  /** disconnect → reconnected (the R25-L reconnect time; null when no interruption). */
  readonly reconnectTimeMs: number | null;
  /**
   * The observed source/translation drift: the mean of
   * (translation-segment-final arrival − source-transcript-final
   * arrival) over the aligned segments (the OBSERVED lagging — never
   * the provider's reported number, which is recorded alongside).
   */
  readonly driftMs: number | null;
  /** The provider-REPORTED average lag (the domain timing-metadata truth, honest provenance). */
  readonly providerReportedLagMs: number | null;
}

/** One observed segment's arrival pair (the drift input). */
export interface RealtimeSegmentArrivalPair {
  readonly segmentId: string;
  readonly sourceFinalAtMs: number;
  readonly translationFinalAtMs: number;
}

/** Derive the R25-L web metrics from the observed markers + arrival pairs (pure). */
export function deriveRealtimeLatencyMetrics(
  markers: readonly RealtimeMarkerRecord[],
  arrivals: readonly RealtimeSegmentArrivalPair[],
  providerReportedLagMs: number | null = null,
): RealtimeLatencyMetrics {
  const at = (marker: RealtimeMarkerRecord["marker"]): number | null => {
    const found = markers.find((record) => record.marker === marker);
    return found === undefined ? null : found.atMs;
  };
  const start = at("session-start-requested");
  const sinceStart = (to: number | null): number | null =>
    start === null || to === null ? null : Math.max(0, to - start);
  const firstSource = at("first-source-transcript-delta");
  const firstTranslation = at("first-translation-delta");
  const firstAudio = at("first-translated-audio-chunk");
  const firstStable = at("first-stable-segment");
  const disconnected = at("client-disconnected");
  const reconnected = at("reconnected");
  let driftMs: number | null = null;
  if (arrivals.length > 0) {
    let total = 0;
    for (const pair of arrivals) {
      total += Math.max(0, pair.translationFinalAtMs - pair.sourceFinalAtMs);
    }
    driftMs = Math.round(total / arrivals.length);
  }
  return {
    firstSourceTranscriptDeltaMs: sinceStart(firstSource),
    firstTranslatedTextDeltaMs: sinceStart(firstTranslation),
    firstTranslatedSpeechChunkMs: firstAudio === null ? null : sinceStart(firstAudio),
    stableSegmentMs: sinceStart(firstStable),
    reconnectTimeMs:
      disconnected === null || reconnected === null ? null : Math.max(0, reconnected - disconnected),
    driftMs,
    providerReportedLagMs,
  };
}

/** The typed summary of one session's usage (the domain's token truth, accumulated). */
export interface RealtimeUsageSummary extends RealtimeSessionUsage {
  /** The derived session cost (USD, the shared cost model — §R25-K). */
  readonly derivedCostUsd: number;
}

/** Sum the domain usage records into the session summary (pure). */
export function sumRealtimeUsage(
  records: readonly RealtimeSessionUsage[],
  derivedCostUsd: number,
): RealtimeUsageSummary {
  const total = {
    inputAudioTokens: 0,
    textOutputTokens: 0,
    outputAudioTokens: 0,
    imageInputTokens: 0,
  };
  for (const record of records) {
    total.inputAudioTokens += record.inputAudioTokens;
    total.textOutputTokens += record.textOutputTokens;
    total.outputAudioTokens += record.outputAudioTokens;
    total.imageInputTokens += record.imageInputTokens;
  }
  return { ...total, derivedCostUsd };
}
