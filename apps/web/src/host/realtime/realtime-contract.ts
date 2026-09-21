/**
 * @wfx/app-web — the R25 realtime-translation WIRE CONTRACT (R25-D, the
 * web lane's provider-neutral vocabulary).
 *
 * THE LAW THIS MODULE KEEPS (the frozen R25 plan §R25-A/R25-D):
 * the browser talks ONLY to WebFlix's own realtime bridge — never to a
 * provider with a provider credential. The wire vocabulary this bridge
 * speaks is the plan's own session/event grammar, bound VERBATIM (the
 * event names are the plan's list — never a second invented vocabulary):
 *
 * - session-created / source-transcript-delta / source-transcript-final /
 *   translation-delta / translation-segment-final / speaker-attribution /
 *   translated-audio-chunk / timing-metadata / usage-telemetry /
 *   recoverable-error / terminal-error / session-closed;
 * - operations: start / configure / append audio / stop / reconnect.
 *
 * The plan's source/translation TIMING METADATA rides every segment event
 * (media-relative segment spans + the bridge's wall clock) so the R25-L
 * drift metric derives from OBSERVED times, never a fabricated number.
 *
 * PROVIDER NEUTRALITY: no provider name, endpoint, or provider JSON shape
 * appears here — the provider-facing seam is the injected
 * {@link RealtimeProviderSessionFactory} (the Model-Fabric session seam's
 * shape; the fixtures boot wires the deterministic dev provider double,
 * the service boot the registered fabric adapter when Worker 1's R25-A/B/C
 * contract lands). The bridge is transport, policy, and continuity — the
 * provider is behind the seam, always.
 *
 * PERSISTENCE LAW (§R25-D): the bridge persists ONLY continuity state
 * (the resume token + the last committed segment) and telemetry records.
 * Raw media (audio chunks) is relayed, never stored.
 */

// ---------------------------------------------------------------------------
// The shared configuration vocabulary
// ---------------------------------------------------------------------------

/**
 * The target languages the realtime lane offers (the bridge's capability
 * read — the provider's declared directions; in production this list is
 * the Model-Fabric realtime capability's supported language directions,
 * never a hardcoded provider assumption).
 */
export interface RealtimeTargetLanguage {
  readonly code: string;
  readonly label: string;
}

/** The realtime output modalities (§R25-K: text-only is the cost-cheap mode). */
export type RealtimeModality = "text" | "audio";

/**
 * The subtitle mode (§R25-G): translated / original + translated /
 * original (the five plan modes compose: the three subtitle modes here +
 * the audio cluster's original-audio/translated-speech choice + the
 * bilingual transcript surface's aligned view).
 */
export type RealtimeSubtitleMode = "translated" | "bilingual" | "original";

/** The speaker-attribution mode (§R25-G: simple + contextual by default). */
export type RealtimeSpeakerAttribution = "simple";

/**
 * The visual-context policy (§R25-F): "audio-only" is the default and the
 * lane's only wired policy — visual-frame upload is NEVER forced when
 * audio alone suffices (the frozen law).
 */
export type RealtimeVisualContextPolicy = "audio-only";

/**
 * The translated-voice policy (§R25-H): "neutral" is the default. Voice
 * cloning is never enabled silently — this lane ships no clone path at
 * all (the consent/rights gate is the lead's R25-H policy work).
 */
export type RealtimeTranslatedVoice = "neutral";

/** One realtime session's provider-neutral configuration (§R25-A inputs). */
export interface RealtimeSessionConfig {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  /** The runtime's playback session (correlation only — never a media claim). */
  readonly playbackSessionId: string;
  readonly targetLanguage: string;
  readonly sourceLanguageHint?: string;
  readonly modalities: readonly RealtimeModality[];
  readonly subtitleMode: RealtimeSubtitleMode;
  readonly speakerAttribution: RealtimeSpeakerAttribution;
  readonly visualContextPolicy: RealtimeVisualContextPolicy;
  readonly translatedVoice: RealtimeTranslatedVoice;
}

// ---------------------------------------------------------------------------
// The client → bridge wire vocabulary (the plan's operations)
// ---------------------------------------------------------------------------

/** Start a session (§R25-A "start"). */
export interface RealtimeSessionStartMessage {
  readonly kind: "session-start";
  readonly requestId: string;
  readonly session: RealtimeSessionConfig;
}

/** Reconnect a dropped client connection onto a retained session (§R25-A "reconnect/resume"). */
export interface RealtimeSessionResumeMessage {
  readonly kind: "session-resume";
  readonly sessionId: string;
  readonly resumeToken: string;
}

/**
 * Append captured audio (§R25-A "append audio"). The PRODUCTION capture
 * path (WebFlix-owned stages only — the client island captures the stage
 * element it owns; a provider iframe never yields one). The fixtures boot
 * drives the deterministic scripted source double instead (loudly labeled
 * — never a claimed provider capture).
 */
export interface RealtimeAudioAppendMessage {
  readonly kind: "audio-append";
  readonly sessionId: string;
  /** Base64 PCM16/24000 mono frames. */
  readonly payload: string;
}

/** Configure a live session (§R25-A "configure": modalities / subtitle mode). */
export interface RealtimeConfigureMessage {
  readonly kind: "configure";
  readonly sessionId: string;
  readonly modalities?: readonly RealtimeModality[];
  readonly subtitleMode?: RealtimeSubtitleMode;
}

/** Stop the session (§R25-A "stop"). */
export interface RealtimeStopMessage {
  readonly kind: "stop";
  readonly sessionId: string;
}

/** The client → bridge message union. */
export type RealtimeClientMessage =
  | RealtimeSessionStartMessage
  | RealtimeSessionResumeMessage
  | RealtimeAudioAppendMessage
  | RealtimeConfigureMessage
  | RealtimeStopMessage;

// ---------------------------------------------------------------------------
// The bridge → client wire vocabulary (the plan's events, verbatim names)
// ---------------------------------------------------------------------------

/** session-created — the bridge accepted the session (its identity + policy truths). */
export interface RealtimeSessionCreatedEvent {
  readonly kind: "session-created";
  readonly sessionId: string;
  readonly resumeToken: string;
  readonly session: RealtimeSessionConfig;
  /** The provider identity the fabric seam registered (provider-neutral id). */
  readonly provider: { readonly id: string; readonly detail: string };
  /**
   * The honest source-stream truth: "scripted-dev-double" (the fixtures
   * boot's deterministic double — loudly labeled) or "captured-audio"
   * (the real owned-stage capture path).
   */
  readonly sourceStream: "scripted-dev-double" | "captured-audio";
  /** The realtime envelope's honest latency profile (rendered, never promised). */
  readonly envelope: { readonly averageLaggingMs: string };
  /** The cost policy's truths (§R25-K — typed, informative, never a playback block). */
  readonly costPolicy: {
    readonly sessionDurationCapMs: number;
    readonly audioOutputBudgetMs: number;
    readonly detail: string;
  };
  readonly atMs: number;
}

/** source-transcript-delta — an incremental source transcript fragment. */
export interface RealtimeSourceTranscriptDeltaEvent {
  readonly kind: "source-transcript-delta";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number | null;
  readonly partial: boolean;
  readonly speaker: string | null;
  readonly atMs: number;
}

/** source-transcript-final — a committed source segment. */
export interface RealtimeSourceTranscriptFinalEvent {
  readonly kind: "source-transcript-final";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker: string | null;
  readonly atMs: number;
}

/** translation-delta — an incremental translated fragment (target language). */
export interface RealtimeTranslationDeltaEvent {
  readonly kind: "translation-delta";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly targetLanguage: string;
  readonly text: string;
  readonly partial: boolean;
  readonly atMs: number;
}

/** translation-segment-final — a committed translated segment (the stable segment). */
export interface RealtimeTranslationSegmentFinalEvent {
  readonly kind: "translation-segment-final";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly targetLanguage: string;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker: string | null;
  readonly atMs: number;
}

/** speaker-attribution — the live diarization's simple, contextual label. */
export interface RealtimeSpeakerAttributionEvent {
  readonly kind: "speaker-attribution";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly speaker: string;
  readonly changed: boolean;
  readonly atMs: number;
}

/** translated-audio-chunk — one translated-speech PCM chunk. */
export interface RealtimeTranslatedAudioChunkEvent {
  readonly kind: "translated-audio-chunk";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly seq: number;
  /** Base64 PCM16 mono. */
  readonly payload: string;
  readonly format: "pcm16/24000";
  readonly atMs: number;
}

/**
 * timing-metadata — the source/translation timing pair (§R25-A "source/
 * translation timing metadata"; the R25-L drift derivation's input).
 */
export interface RealtimeTimingMetadataEvent {
  readonly kind: "timing-metadata";
  readonly sessionId: string;
  readonly segmentId: number;
  readonly sourceStartMs: number;
  readonly sourceFinalAtMs: number;
  readonly translationFinalAtMs: number;
  readonly atMs: number;
}

/** usage-telemetry — the session's usage/cost truth (§R25-A "usage/cost telemetry"). */
export interface RealtimeUsageTelemetryEvent {
  readonly kind: "usage-telemetry";
  readonly sessionId: string;
  readonly inputAudioMs: number;
  readonly outputTextChars: number;
  readonly outputAudioMs: number;
  /** Present when the cost policy downgraded audio output to text-only (§R25-K). */
  readonly audioDowngraded?: { readonly detail: string };
  readonly atMs: number;
}

/** recoverable-error — a typed transient failure (the stream continues). */
export interface RealtimeRecoverableErrorEvent {
  readonly kind: "recoverable-error";
  readonly sessionId: string;
  readonly errorKind:
    | "provider-disconnected"
    | "client-reconnect-required"
    | "audio-output-budget-reached";
  readonly detail: string;
  readonly atMs: number;
}

/**
 * session-reconnected — the bridge's RECOVERY CONFIRMATION (the bridge's
 * own management event — the plan's recoverable-error carries what
 * happened; this carries the observed recovery, for the R25-L
 * reconnect-time metric).
 */
export interface RealtimeSessionReconnectedEvent {
  readonly kind: "session-reconnected";
  readonly sessionId: string;
  readonly recovered: "provider-connection" | "client-connection";
  /** The last committed segment the stream resumed from (continuity truth). */
  readonly lastCommittedSegmentId: number;
  readonly atMs: number;
}

/** terminal-error — a typed terminal failure (§R25-A "terminal error"). */
export interface RealtimeTerminalErrorEvent {
  readonly kind: "terminal-error";
  readonly sessionId: string;
  readonly errorKind:
    | "no-realtime-provider-registered"
    | "provider-failed"
    | "session-expired"
    | "anonymous-quota-reached"
    | "invalid-input";
  readonly detail: string;
  readonly recovery: string;
  readonly atMs: number;
}

/** session-closed — the session ended (the typed reason). */
export interface RealtimeSessionClosedEvent {
  readonly kind: "session-closed";
  readonly sessionId: string;
  readonly reason:
    | "stopped"
    | "duration-cap"
    | "provider-failed"
    | "audio-output-budget-reached"
    | "continuity-expired";
  readonly detail: string;
  readonly atMs: number;
}

/** The bridge → client event union (the plan's event list, verbatim names). */
export type RealtimeBridgeEvent =
  | RealtimeSessionCreatedEvent
  | RealtimeSourceTranscriptDeltaEvent
  | RealtimeSourceTranscriptFinalEvent
  | RealtimeTranslationDeltaEvent
  | RealtimeTranslationSegmentFinalEvent
  | RealtimeSpeakerAttributionEvent
  | RealtimeTranslatedAudioChunkEvent
  | RealtimeTimingMetadataEvent
  | RealtimeUsageTelemetryEvent
  | RealtimeRecoverableErrorEvent
  | RealtimeSessionReconnectedEvent
  | RealtimeTerminalErrorEvent
  | RealtimeSessionClosedEvent;

// ---------------------------------------------------------------------------
// The provider-facing seam (the Model-Fabric session seam's shape)
// ---------------------------------------------------------------------------

/**
 * One provider realtime session behind the seam (the shape Worker 1's
 * R25-A contract + R25-C adapter will bind; the fixtures boot wires the
 * deterministic dev provider double to it — see dev-realtime-provider.ts).
 *
 * The provider session speaks the SAME normalized event vocabulary
 * (a subset of {@link RealtimeBridgeEvent}'s stream events — the adapter
 * normalizes provider frames into these shapes; the bridge relays them).
 */
export type RealtimeProviderStreamEvent = Extract<
  RealtimeBridgeEvent,
  | RealtimeSourceTranscriptDeltaEvent
  | RealtimeSourceTranscriptFinalEvent
  | RealtimeTranslationDeltaEvent
  | RealtimeTranslationSegmentFinalEvent
  | RealtimeSpeakerAttributionEvent
  | RealtimeTranslatedAudioChunkEvent
  | RealtimeTimingMetadataEvent
  | RealtimeUsageTelemetryEvent
>;

/** The provider session the bridge drives. */
export interface RealtimeProviderSession {
  /** The provider-neutral provider id (registered through the seam). */
  readonly providerId: string;
  /** The provider-side session token (the bridge's resume continuity key). */
  readonly token: string;
  /** Send one typed control message (JSON-serializable, seam-defined). */
  send(message: unknown): void;
  /** Subscribe to the session's normalized stream events. */
  onEvent(handler: (event: RealtimeProviderStreamEvent) => void): () => void;
  /** Subscribe to the session's typed failure (terminal) — the stream ends. */
  onTerminal(handler: (failure: { readonly errorKind: string; readonly detail: string; readonly recovery: string }) => void): () => void;
  /** Subscribe to the transport-level close (recoverable — the bridge reconnects). */
  onClose(handler: () => void): () => void;
  /** Stop the provider session. */
  stop(): void;
}

/** The typed refusal the seam answers when it cannot create a session. */
export interface RealtimeProviderRefusal {
  readonly ok: false;
  readonly kind: "no-realtime-provider-registered" | "invalid-input" | "anonymous-quota-reached";
  readonly detail: string;
  readonly recovery: string;
}

/** The resume continuity the bridge hands the seam when reconnecting a provider session. */
export interface RealtimeProviderResume {
  /** The provider-side session token from the dropped session. */
  readonly providerSessionToken: string;
  /** The last committed source segment (the stream resumes after it). */
  readonly lastCommittedSegmentId: number;
}

/**
 * The provider session factory — the SEAM the bridge consumes. In the
 * fixtures boot the deterministic dev provider double; in the service
 * boot the Model-Fabric realtime route (Worker 1's R25-B extension; until
 * it lands the service boot wires NO factory and the bridge answers the
 * honest typed no-realtime-provider-registered gap — never a fixture
 * fallback in service mode).
 */
export interface RealtimeProviderSessionFactory {
  readonly providerId: string;
  readonly providerDetail: string;
  readonly targetLanguages: readonly RealtimeTargetLanguage[];
  createSession(
    config: RealtimeSessionConfig,
    resume?: RealtimeProviderResume,
  ): Promise<RealtimeProviderSession | RealtimeProviderRefusal>;
}

// ---------------------------------------------------------------------------
// The R25-L web latency metrics (the honest measurement vocabulary)
// ---------------------------------------------------------------------------

/** The client-side marker record (the product's own observation). */
export interface RealtimeMarkerRecord {
  readonly marker:
    | "session-start-requested"
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
   * The source/translation drift: the mean of (translationFinalAt −
   * sourceFinalAt) over the segments that carried timing metadata (the
   * observed lagging, honest — never the provider's marketing number).
   */
  readonly driftMs: number | null;
}

/** One observed segment's timing pair (the drift input, from timing-metadata). */
export interface RealtimeSegmentTimingPair {
  readonly segmentId: number;
  readonly sourceFinalAtMs: number;
  readonly translationFinalAtMs: number;
}

/** Derive the R25-L web metrics from the observed markers + timing pairs (pure). */
export function deriveRealtimeLatencyMetrics(
  markers: readonly RealtimeMarkerRecord[],
  timings: readonly RealtimeSegmentTimingPair[],
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
  if (timings.length > 0) {
    let total = 0;
    for (const pair of timings) {
      total += Math.max(0, pair.translationFinalAtMs - pair.sourceFinalAtMs);
    }
    driftMs = Math.round(total / timings.length);
  }
  return {
    firstSourceTranscriptDeltaMs: sinceStart(firstSource),
    firstTranslatedTextDeltaMs: sinceStart(firstTranslation),
    firstTranslatedSpeechChunkMs: firstAudio === null ? null : sinceStart(firstAudio),
    stableSegmentMs: sinceStart(firstStable),
    reconnectTimeMs:
      disconnected === null || reconnected === null ? null : Math.max(0, reconnected - disconnected),
    driftMs,
  };
}

// ---------------------------------------------------------------------------
// Wire parsing (typed validation at the bridge boundary)
// ---------------------------------------------------------------------------

/** The parsed/validated client message (never a trusted cast). */
export function parseRealtimeClientMessage(raw: string): RealtimeClientMessage | { kind: "invalid"; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", detail: "the message is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "invalid", detail: "the message is not an object" };
  }
  const message = parsed as Record<string, unknown>;
  const kind = message["kind"];
  if (kind === "session-start") {
    const session = message["session"];
    if (typeof session !== "object" || session === null) {
      return { kind: "invalid", detail: "session-start.session: expected an object" };
    }
    const config = session as Record<string, unknown>;
    const stringField = (name: string): string | null => {
      const value = config[name];
      return typeof value === "string" && value.length > 0 ? value : null;
    };
    const externalRef = stringField("externalRef");
    const targetLanguage = stringField("targetLanguage");
    if (externalRef === null || targetLanguage === null) {
      return { kind: "invalid", detail: "session-start.session: externalRef and targetLanguage are required" };
    }
    const modalitiesRaw = config["modalities"];
    const modalities: RealtimeModality[] = [];
    if (Array.isArray(modalitiesRaw)) {
      for (const entry of modalitiesRaw) {
        if (entry === "text" || entry === "audio") {
          if (!modalities.includes(entry)) modalities.push(entry);
        }
      }
    }
    if (modalities.length === 0) modalities.push("text");
    const subtitleMode = config["subtitleMode"];
    const resolvedSubtitleMode: RealtimeSubtitleMode =
      subtitleMode === "translated" || subtitleMode === "bilingual" || subtitleMode === "original"
        ? subtitleMode
        : "bilingual";
    return {
      kind: "session-start",
      requestId: typeof message["requestId"] === "string" ? message["requestId"] : "",
      session: {
        itemId: stringField("itemId") ?? "",
        connectorId: stringField("connectorId") ?? "",
        externalRef,
        playbackSessionId: stringField("playbackSessionId") ?? "none",
        targetLanguage,
        ...(typeof config["sourceLanguageHint"] === "string" ? { sourceLanguageHint: config["sourceLanguageHint"] as string } : {}),
        modalities,
        subtitleMode: resolvedSubtitleMode,
        speakerAttribution: "simple",
        visualContextPolicy: "audio-only",
        translatedVoice: "neutral",
      },
    };
  }
  if (kind === "session-resume") {
    const sessionId = message["sessionId"];
    const resumeToken = message["resumeToken"];
    if (typeof sessionId !== "string" || typeof resumeToken !== "string") {
      return { kind: "invalid", detail: "session-resume: sessionId and resumeToken are required" };
    }
    return { kind: "session-resume", sessionId, resumeToken };
  }
  if (kind === "audio-append") {
    const sessionId = message["sessionId"];
    const payload = message["payload"];
    if (typeof sessionId !== "string" || typeof payload !== "string" || payload.length === 0) {
      return { kind: "invalid", detail: "audio-append: sessionId and payload are required" };
    }
    return { kind: "audio-append", sessionId, payload };
  }
  if (kind === "configure") {
    const sessionId = message["sessionId"];
    if (typeof sessionId !== "string") {
      return { kind: "invalid", detail: "configure: sessionId is required" };
    }
    const modalitiesRaw = message["modalities"];
    const modalities = Array.isArray(modalitiesRaw)
      ? modalitiesRaw.filter((entry): entry is RealtimeModality => entry === "text" || entry === "audio")
      : undefined;
    const subtitleMode = message["subtitleMode"];
    return {
      kind: "configure",
      sessionId,
      ...(modalities !== undefined && modalities.length > 0 ? { modalities } : {}),
      ...(subtitleMode === "translated" || subtitleMode === "bilingual" || subtitleMode === "original"
        ? { subtitleMode }
        : {}),
    };
  }
  if (kind === "stop") {
    const sessionId = message["sessionId"];
    if (typeof sessionId !== "string") {
      return { kind: "invalid", detail: "stop: sessionId is required" };
    }
    return { kind: "stop", sessionId };
  }
  return { kind: "invalid", detail: `unknown message kind '${String(kind)}'` };
}
