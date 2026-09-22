"use client";

/**
 * @wfx/app-web — the R25 realtime TRANSLATION SESSION CLIENT (R25-G: the
 * player's client-side session controller).
 *
 * THE LAWS THIS MODULE KEEPS:
 * - THE PLAYBACK LAW (§R25-L, structural): the controller has NO
 *   capability over playback — it never calls a playback route; a
 *   translation failure, downgrade, or close changes ONLY the
 *   translation surface's own state (the original captions and the
 *   player keep their truth);
 * - THE ALIGNMENT LAW (§R25-G): the bilingual fold APPENDS the
 *   translation to the source segment row — the source transcript is
 *   never replaced (the artifact surfaces below keep their own truth);
 * - THE BRIDGE LAW (§R25-D): the only socket this module opens is the
 *   WebFlix bridge's (the view's bridgeUrl — the provider's endpoint
 *   never appears in the client);
 * - THE OBSERVATION LAW (R25-L / the J40/J41 telemetry discipline):
 *   every marker records from the PRODUCT's own observation (message
 *   arrivals on the page); the record lives on
 *   `window.__wfxRealtimeTelemetry` (same-origin for the journeys) and
 *   flushes to the bridge's POST /telemetry retention seam at close;
 * - THE RECONNECT LAW (§R25-A reconnect/resume): a dropped client
 *   connection retries onto the retained session (the resume token)
 *   with a bounded backoff — never a media restart, never a silent gap.
 */

import type {
  RealtimeTranslationSessionInputs,
  RealtimeTranslationEvent,
} from "@wfx/domain";

import {
  deriveRealtimeLatencyMetrics,
  type RealtimeLatencyMetrics,
  type RealtimeMarkerRecord,
  type RealtimeSegmentArrivalPair,
  type RealtimeTransportMessage,
} from "@/host/realtime/realtime-wire";

// ---------------------------------------------------------------------------
// The view-model shapes (the folded bilingual surface)
// ---------------------------------------------------------------------------

/** One aligned bilingual segment row (the source + its translation). */
export interface RealtimeSegmentView {
  /** The SOURCE segment id (the row's alignment key). */
  readonly segmentId: string;
  /** The live diarization's simple, contextual label (Speaker 1 / Speaker 2). */
  speakerLabel: string | null;
  speakerChanged: boolean;
  /** The committed source text (deltas accumulate until the final). */
  sourceText: string;
  sourceFinal: boolean;
  /** The accumulated translated text (deltas accumulate until the final). */
  translationText: string;
  translationFinal: boolean;
  /** The media-position timing (the source segment's own span). */
  readonly timing: { readonly startMs: number; readonly endMs: number } | null;
  /** Whether translated-speech audio arrived for this segment. */
  hasAudio: boolean;
}

/** The audio cluster's state (the translated-speech player). */
export interface RealtimeAudioState {
  /** Whether translated speech is enabled (the user's choice). */
  enabled: boolean;
  /** Whether a chunk is currently scheduled/playing. */
  playing: boolean;
  /** How many chunks arrived. */
  chunks: number;
  /** Whether the original audio is ducked under translated speech (WebFlix-owned stages). */
  ducking: boolean;
}

/** The controller's phase (the honest typed states — the session state machine's client view). */
export type RealtimeClientPhase =
  | { readonly phase: "idle" }
  | { readonly phase: "connecting"; readonly targetLanguage: string }
  | {
      readonly phase: "live";
      readonly sessionId: string;
      readonly resumeToken: string;
      readonly targetLanguage: string;
      readonly subtitleMode: "source" | "translated" | "bilingual";
      readonly outputModality: "text" | "text-and-audio";
      readonly provider: { readonly id: string; readonly detail: string } | null;
      readonly reportedAverageLagMs: number | null;
      readonly policy: {
        readonly effectiveOutputModality: "text" | "text-and-audio";
        readonly degradedFromRequested: boolean;
        readonly modalityReason: string;
        readonly maxSessionDurationMs: number;
        readonly durationBasis: string;
      } | null;
      readonly segments: readonly RealtimeSegmentView[];
      /** The last recoverable error (rendered; the stream continues). */
      readonly lastRecoverable: { readonly errorKind: string; readonly detail: string } | null;
      /** Whether a reconnect is in flight (client or provider side). */
      readonly recovering: boolean;
      readonly usage: { inputAudioTokens: number; textOutputTokens: number; outputAudioTokens: number; imageInputTokens: number };
      readonly audio: RealtimeAudioState;
      /** The honest source-stream truth (the fixtures double, loudly labeled). */
      readonly sourceStream: "scripted-dev-double" | "captured-audio" | null;
    }
  | {
      readonly phase: "failed";
      readonly errorKind: string;
      readonly detail: string;
      readonly recovery: string;
      /** The segments retained at failure (the alignment never lost). */
      readonly segments: readonly RealtimeSegmentView[];
    }
  | { readonly phase: "stopped"; readonly reason: string; readonly segments: readonly RealtimeSegmentView[] };

/** The identity the controller binds the session to. */
export interface RealtimeClientIdentity {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly playbackSessionId: string;
  /** Whether WebFlix owns the stage's media path (the capture path's precondition). */
  readonly webflixOwnsStage: boolean;
  /** The route view's truths (the bridge URL + the languages + the gates). */
  readonly bridgeUrl: string;
  readonly targetLanguages: readonly { readonly code: string; readonly label: string }[];
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

/** The client-side realtime translation session controller. */
export class RealtimeSessionController {
  private phase: RealtimeClientPhase = { phase: "idle" };
  private listeners: (() => void)[] = [];
  private socket: WebSocket | null = null;
  private markers: RealtimeMarkerRecord[] = [];
  private arrivalPairs: RealtimeSegmentArrivalPair[] = [];
  /** The source-final arrival wall time per segment id (the drift pair's input). */
  private sourceFinalArrivals = new Map<string, number>();
  private providerReportedLagMs: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private audioContext: AudioContext | null = null;
  private audioQueue: { readonly base64: string; readonly atMs: number }[] = [];
  private nextAudioAt = 0;
  private identity: RealtimeClientIdentity | null = null;
  private defaultSubtitleMode: "source" | "translated" | "bilingual" = "bilingual";
  private disposed = false;

  /** The current snapshot (useSyncExternalStore's read). */
  getState(): RealtimeClientPhase {
    return this.phase;
  }

  /** Subscribe to phase changes (the store contract). */
  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  private emitChange(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Bind the controller to one player surface (the island's mount). */
  bind(identity: RealtimeClientIdentity): void {
    if (this.disposed) return;
    this.identity = identity;
    if (this.phase.phase === "idle") {
      this.emitChange();
    }
  }

  /** The in-page telemetry record (the journey's same-origin read). */
  telemetrySnapshot(): {
    readonly sessionId: string | null;
    readonly bridgeUrl: string | null;
    readonly markers: readonly RealtimeMarkerRecord[];
    readonly metrics: RealtimeLatencyMetrics | null;
    readonly segments: number;
  } {
    const metrics =
      this.markers.length > 0 ? deriveRealtimeLatencyMetrics(this.markers, this.arrivalPairs, this.providerReportedLagMs) : null;
    return {
      sessionId: this.liveSessionId(),
      bridgeUrl: this.identity?.bridgeUrl ?? null,
      markers: [...this.markers],
      metrics,
      segments: "segments" in this.phase ? this.phase.segments.length : 0,
    };
  }

  private liveSessionId(): string | null {
    if (this.phase.phase === "live") return this.phase.sessionId;
    return this.lastSessionId;
  }

  private lastSessionId: string | null = null;

  private mark(marker: RealtimeMarkerRecord["marker"], note?: string): void {
    this.markers.push({ marker, atMs: Date.now(), ...(note !== undefined ? { note } : {}) });
    this.publishTelemetry();
  }

  /** Publish the in-page telemetry record (window.__wfxRealtimeTelemetry). */
  private publishTelemetry(): void {
    if (typeof window === "undefined") return;
    const snapshot = this.telemetrySnapshot();
    (window as typeof window & { __wfxRealtimeTelemetry?: unknown }).__wfxRealtimeTelemetry = {
      ...snapshot,
      phase: this.phase.phase,
      bridgeConnected: this.socket !== null && this.socket.readyState === WebSocket.OPEN,
      targetLanguage: this.phase.phase === "live" ? this.phase.targetLanguage : null,
    };
  }

  // -----------------------------------------------------------------------
  // The start / stop / configure surface (the chrome row + the island)
  // -----------------------------------------------------------------------

  /** Start a session targeting one language (the Translate → [language] control). */
  start(targetLanguage: string, subtitleMode?: "source" | "translated" | "bilingual"): void {
    if (this.disposed || this.identity === null) return;
    if (this.phase.phase === "live" || this.phase.phase === "connecting") return;
    if (subtitleMode !== undefined) this.defaultSubtitleMode = subtitleMode;
    this.markers = [];
    this.arrivalPairs = [];
    this.sourceFinalArrivals.clear();
    this.providerReportedLagMs = null;
    this.lastSessionId = null;
    this.audioQueue = [];
    this.phase = { phase: "connecting", targetLanguage };
    this.emitChange();
    this.mark("session-start-requested", targetLanguage);
    this.openSocket((socket) => {
      const inputs: RealtimeTranslationSessionInputs = {
        sourceMedia: {
          itemId: this.identity!.itemId,
          connectorId: this.identity!.connectorId,
          externalRef: this.identity!.externalRef,
          audioStreamLegallyAvailable: true,
        },
        targetLanguage,
        outputModality: "text",
        subtitleMode: this.defaultSubtitleMode,
        speakerAttribution: "simple-labels",
        visualContextPolicy: "off",
        hotwords: [],
        translatedVoicePolicy: "neutral-system-voice",
      };
      socket.send(JSON.stringify({ op: "start", inputs }));
    });
  }

  /** Change the subtitle mode (the row's mode buttons — the domain configure op). */
  setSubtitleMode(subtitleMode: "source" | "translated" | "bilingual"): void {
    this.defaultSubtitleMode = subtitleMode;
    if (this.phase.phase !== "live" || this.socket === null) return;
    this.socket.send(
      JSON.stringify({ op: "configure", sessionId: this.phase.sessionId, configuration: { subtitleMode } }),
    );
    this.phase = { ...this.phase, subtitleMode };
    this.emitChange();
  }

  /**
   * Enable/disable translated speech (the audio cluster — the domain
   * configure op). Enabling also primes the audio player (the user's
   * click is the AudioContext's gesture).
   */
  setTranslatedSpeech(enabled: boolean): void {
    if (this.phase.phase !== "live" || this.socket === null) return;
    const nextModality: "text" | "text-and-audio" = enabled ? "text-and-audio" : "text";
    this.socket.send(
      JSON.stringify({
        op: "configure",
        sessionId: this.phase.sessionId,
        configuration: { outputModality: nextModality },
      }),
    );
    this.phase = {
      ...this.phase,
      outputModality: nextModality,
      audio: { ...this.phase.audio, enabled },
    };
    if (!enabled) {
      this.audioQueue = [];
      this.applyDucking(false);
    } else if (this.audioContext === null) {
      try {
        this.audioContext = new AudioContext();
        void this.audioContext.resume();
      } catch {
        // The platform refused the audio context — the typed note renders.
      }
    }
    this.emitChange();
  }

  /** Stop the session (the row's stop control — the domain stop op). */
  stop(): void {
    if (this.phase.phase !== "live" || this.socket === null) {
      this.phase = { phase: "idle" };
      this.emitChange();
      return;
    }
    const sessionId = this.phase.sessionId;
    const segments = this.phase.segments;
    try {
      this.socket.send(JSON.stringify({ op: "stop", sessionId }));
    } catch {
      // The close below is the truth.
    }
    this.phase = { phase: "stopped", reason: "stopped by the viewer", segments };
    this.closeSocket();
    this.mark("session-closed");
    this.flushTelemetryToBridge();
    this.emitChange();
  }

  /** Reset to idle (the failure surface's dismiss). */
  reset(): void {
    this.closeSocket();
    this.phase = { phase: "idle" };
    this.markers = [];
    this.arrivalPairs = [];
    this.sourceFinalArrivals.clear();
    this.publishTelemetry();
    this.emitChange();
  }

  /** Dispose (the island's unmount). */
  dispose(): void {
    this.disposed = true;
    this.closeSocket();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.audioContext !== null) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.applyDucking(false);
  }

  // -----------------------------------------------------------------------
  // The WebSocket lifecycle (the reconnect law)
  // -----------------------------------------------------------------------

  private openSocket(onOpen: (socket: WebSocket) => void): void {
    if (this.identity === null) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.identity.bridgeUrl);
    } catch {
      this.phase = {
        phase: "failed",
        errorKind: "network",
        detail: "the realtime bridge could not be reached",
        recovery: "Try starting the translation again.",
        segments: [],
      };
      this.emitChange();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.disposed) return;
      onOpen(socket);
    });
    socket.addEventListener("message", (event) => {
      if (this.disposed) return;
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as { event?: RealtimeTranslationEvent } | RealtimeTransportMessage;
        if ("event" in parsed && parsed.event !== undefined) {
          this.onDomainEvent(parsed.event);
        } else if ("transport" in parsed) {
          this.onTransportMessage(parsed as RealtimeTransportMessage);
        }
      } catch {
        // A malformed frame is dropped; the protocol's own typed events govern.
      }
    });
    socket.addEventListener("close", () => {
      if (this.disposed) return;
      this.onSocketClosed();
    });
  }

  /** The client connection dropped: the bounded resume retry (never a media restart). */
  private onSocketClosed(): void {
    if (this.phase.phase !== "live") {
      this.socket = null;
      return;
    }
    this.socket = null;
    this.mark("client-disconnected");
    this.phase = { ...this.phase, recovering: true };
    this.publishTelemetry();
    this.emitChange();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.disposed || this.phase.phase !== "live") return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed || this.phase.phase !== "live") return;
      this.mark("reconnect-requested");
      const sessionId = this.phase.sessionId;
      const resumeToken = this.phase.resumeToken;
      this.openSocket((socket) => {
        socket.send(JSON.stringify({ op: "reconnect", sessionId, resumeToken }));
      });
      // The bounded retry loop (a 1.2 s cadence; the retry continues until
      // the phase ends — the journey's offline window resolves within it).
      this.scheduleReconnect();
    }, 1_200);
  }

  // -----------------------------------------------------------------------
  // The transport envelope + the domain event fold
  // -----------------------------------------------------------------------

  private onTransportMessage(message: RealtimeTransportMessage): void {
    if (message.transport === "session-bound") {
      this.lastSessionId = message.sessionId;
      if (this.phase.phase === "connecting") {
        this.mark("session-bound");
        this.phase = {
          phase: "live",
          sessionId: message.sessionId,
          resumeToken: message.resumeToken,
          targetLanguage: this.phase.targetLanguage,
          subtitleMode: this.defaultSubtitleMode,
          outputModality: "text",
          provider: null,
          reportedAverageLagMs: message.envelope.reportedAverageLagMs,
          policy: message.policy,
          segments: [],
          lastRecoverable: null,
          recovering: false,
          usage: { inputAudioTokens: 0, textOutputTokens: 0, outputAudioTokens: 0, imageInputTokens: 0 },
          audio: { enabled: false, playing: false, chunks: 0, ducking: false },
          sourceStream: message.sourceStream,
        };
        this.emitChange();
      }
      return;
    }
    if (message.transport === "session-resumed") {
      this.mark("reconnected", message.recovered);
      if (this.phase.phase === "live") {
        this.phase = { ...this.phase, recovering: false };
        this.emitChange();
      }
      return;
    }
    if (message.transport === "refused") {
      this.mark("terminal-error", message.errorKind);
      this.phase = {
        phase: "failed",
        errorKind: message.errorKind,
        detail: message.detail,
        recovery: message.recovery,
        segments: this.phase.phase === "live" ? this.phase.segments : [],
      };
      this.closeSocket();
      this.flushTelemetryToBridge();
      this.emitChange();
    }
  }

  private onDomainEvent(event: RealtimeTranslationEvent): void {
    // The first-arrival markers (the R25-L observation layer).
    if (event.kind === "source-transcript-delta") {
      if (!this.markers.some((entry) => entry.marker === "first-source-transcript-delta")) {
        this.mark("first-source-transcript-delta");
      }
    }
    if (event.kind === "translation-delta") {
      if (!this.markers.some((entry) => entry.marker === "first-translation-delta")) {
        this.mark("first-translation-delta");
      }
    }
    if (event.kind === "translated-audio-chunk") {
      if (!this.markers.some((entry) => entry.marker === "first-translated-audio-chunk")) {
        this.mark("first-translated-audio-chunk");
      }
    }
    if (event.kind === "translation-segment-final") {
      if (!this.markers.some((entry) => entry.marker === "first-stable-segment")) {
        this.mark("first-stable-segment");
      }
    }

    if (this.phase.phase !== "live") return;
    const segments = [...this.phase.segments];
    const bySourceId = (segmentId: string): RealtimeSegmentView | undefined =>
      segments.find((segment) => segment.segmentId === segmentId);

    switch (event.kind) {
      case "session-created": {
        this.mark("session-created", event.providerId);
        this.phase = {
          ...this.phase,
          provider: { id: event.providerId, detail: `${event.modelId} @ ${event.modelRevision}` },
        };
        break;
      }
      case "source-transcript-delta": {
        const row = bySourceId(event.segmentId);
        if (row === undefined) {
          segments.push({
            segmentId: event.segmentId,
            speakerLabel: null,
            speakerChanged: false,
            sourceText: event.deltaText,
            sourceFinal: false,
            translationText: "",
            translationFinal: false,
            timing: { startMs: event.timing.startedAtMs, endMs: event.timing.endedAtMs },
            hasAudio: false,
          });
        } else if (!row.sourceFinal) {
          row.sourceText = row.sourceText + event.deltaText;
        }
        break;
      }
      case "source-transcript-final": {
        this.sourceFinalArrivals.set(event.segmentId, Date.now());
        const row = bySourceId(event.segmentId);
        if (row === undefined) {
          segments.push({
            segmentId: event.segmentId,
            speakerLabel: null,
            speakerChanged: false,
            sourceText: event.text,
            sourceFinal: true,
            translationText: "",
            translationFinal: false,
            timing: { startMs: event.timing.startedAtMs, endMs: event.timing.endedAtMs },
            hasAudio: false,
          });
        } else {
          row.sourceText = event.text;
          row.sourceFinal = true;
        }
        break;
      }
      case "speaker-attribution": {
        if (event.segmentId === undefined) break;
        const row = bySourceId(event.segmentId);
        if (row !== undefined) {
          row.speakerChanged = row.speakerLabel !== null && row.speakerLabel !== event.label;
          row.speakerLabel = event.label;
        }
        break;
      }
      case "translation-delta": {
        const sourceId = event.sourceSegmentId ?? event.segmentId;
        const row = bySourceId(sourceId);
        if (row !== undefined) {
          row.translationText = row.translationText + event.deltaText;
        }
        break;
      }
      case "translation-segment-final": {
        const sourceId = event.sourceSegmentId ?? event.segmentId;
        const row = bySourceId(sourceId);
        if (row !== undefined) {
          row.translationText = event.text;
          row.translationFinal = true;
        }
        // The drift observation (the source-final arrival → the
        // translation-final arrival, per aligned segment).
        const sourceFinalAtMs = this.sourceFinalArrivals.get(sourceId);
        if (sourceFinalAtMs !== undefined) {
          this.arrivalPairs.push({ segmentId: sourceId, sourceFinalAtMs, translationFinalAtMs: Date.now() });
        }
        break;
      }
      case "translated-audio-chunk": {
        // The audio cluster: queue the chunk (played when enabled; the
        // §R25-K downgrade filters them bridge-side before they land).
        this.audioQueue.push({ base64: (event as unknown as { audioBase64?: string }).audioBase64 ?? "", atMs: Date.now() });
        if (this.phase.audio.enabled) {
          this.playQueuedAudio();
        }
        this.phase = {
          ...this.phase,
          audio: { ...this.phase.audio, chunks: this.phase.audio.chunks + 1 },
        };
        break;
      }
      case "timing-metadata": {
        if (event.sourceToTranslationLagMs !== undefined) {
          this.providerReportedLagMs = event.sourceToTranslationLagMs;
        }
        break;
      }
      case "usage-telemetry": {
        this.phase = {
          ...this.phase,
          usage: {
            inputAudioTokens: this.phase.usage.inputAudioTokens + event.usage.inputAudioTokens,
            textOutputTokens: this.phase.usage.textOutputTokens + event.usage.textOutputTokens,
            outputAudioTokens: this.phase.usage.outputAudioTokens + event.usage.outputAudioTokens,
            imageInputTokens: this.phase.usage.imageInputTokens + event.usage.imageInputTokens,
          },
        };
        break;
      }
      case "recoverable-error": {
        this.mark("recoverable-error", event.errorKind);
        this.phase = {
          ...this.phase,
          lastRecoverable: { errorKind: event.errorKind, detail: event.detail },
          // A 'network' recoverable during a live socket is the provider
          // side's reconnect (the bridge drives it); the surface shows it.
          recovering: event.errorKind === "network" ? true : this.phase.recovering,
        };
        break;
      }
      case "terminal-error": {
        this.mark("terminal-error", event.errorKind);
        this.phase = {
          phase: "failed",
          errorKind: event.errorKind,
          detail: event.detail,
          recovery: "Start the translation again — original captions remain available.",
          segments,
        };
        this.closeSocket();
        this.flushTelemetryToBridge();
        break;
      }
      case "session-closed": {
        this.mark("session-closed", event.reason);
        this.phase = { phase: "stopped", reason: event.reason, segments };
        this.closeSocket();
        this.flushTelemetryToBridge();
        break;
      }
      default: {
        break;
      }
    }
    if (this.phase.phase === "live") {
      this.phase = { ...this.phase, segments };
    }
    this.publishTelemetry();
    this.emitChange();
  }

  private markerAt(marker: RealtimeMarkerRecord["marker"]): number | null {
    const found = this.markers.find((entry) => entry.marker === marker);
    return found === undefined ? null : found.atMs;
  }

  // -----------------------------------------------------------------------
  // The translated-speech player (real PCM16/24000 playback)
  // -----------------------------------------------------------------------

  /** Play the queued chunks sequentially (WebAudio; the enable click primed the context). */
  private playQueuedAudio(): void {
    if (this.audioContext === null) return;
    if (this.phase.phase !== "live" || !this.phase.audio.enabled) return;
    const context = this.audioContext;
    while (this.audioQueue.length > 0) {
      const chunk = this.audioQueue.shift();
      if (chunk === undefined) break;
      try {
        const bytes = pcm16BytesFromBase64(chunk.base64);
        const samples = bytes.length / 2;
        if (samples === 0) continue;
        const buffer = context.createBuffer(1, samples, 24_000);
        const channel = buffer.getChannelData(0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let index = 0; index < samples; index += 1) {
          channel[index] = view.getInt16(index * 2, true) / 32768;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const startAt = Math.max(context.currentTime + 0.02, this.nextAudioAt);
        source.start(startAt);
        this.nextAudioAt = startAt + buffer.duration;
      } catch {
        // A malformed chunk is skipped; the stream's own typed events govern.
      }
    }
    this.applyDucking(true);
    if (this.phase.phase === "live") {
      this.phase = { ...this.phase, audio: { ...this.phase.audio, playing: true } };
      this.emitChange();
    }
  }

  /**
   * THE DUCKING TRUTH: on WebFlix-owned stages the original audio ducks
   * under the translated speech (a volume reduction on the stage's own
   * media elements — the honest mechanism, applied only where WebFlix
   * owns the media path; provider rungs keep their own audio).
   */
  private applyDucking(ducked: boolean): void {
    if (typeof document === "undefined") return;
    if (this.identity?.webflixOwnsStage !== true) return;
    const stage = document.querySelector<HTMLElement>("[data-wfx-player-stagewrap]");
    const media = stage?.querySelectorAll("video, audio");
    if (media === undefined || media === null) return;
    for (const element of Array.from(media)) {
      const mediaElement = element as HTMLMediaElement & {
        __wfxRealtimeDucked?: boolean;
        __wfxRealtimePreDuckVolume?: number;
      };
      if (ducked && mediaElement.__wfxRealtimeDucked !== true) {
        mediaElement.__wfxRealtimeDucked = true;
        mediaElement.__wfxRealtimePreDuckVolume = mediaElement.volume;
        mediaElement.volume = Math.min(mediaElement.volume, 0.25);
      } else if (!ducked && mediaElement.__wfxRealtimeDucked === true) {
        mediaElement.__wfxRealtimeDucked = false;
        const preDuck = mediaElement.__wfxRealtimePreDuckVolume;
        mediaElement.volume = preDuck === undefined ? 1 : preDuck;
      }
    }
  }

  // -----------------------------------------------------------------------
  // The retention seam (the telemetry flush)
  // -----------------------------------------------------------------------

  private closeSocket(): void {
    if (this.socket !== null) {
      try {
        this.socket.close();
      } catch {
        // Already closed.
      }
      this.socket = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Flush the marker record to the bridge's retention seam (POST /telemetry). */
  private flushTelemetryToBridge(): void {
    if (typeof fetch !== "function" || this.identity === null) return;
    if (this.markers.length === 0) return;
    const snapshot = this.telemetrySnapshot();
    const body = JSON.stringify({
      sessionId: snapshot.sessionId ?? "unknown",
      markers: snapshot.markers,
      metrics: snapshot.metrics,
      bridgeUrl: this.identity.bridgeUrl,
    });
    const url = this.identity.bridgeUrl.replace(/^ws/, "http") + "/telemetry";
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }
}

/** Decode base64 PCM16 → bytes (the client-side half of the transport encoding — browser-safe). */
function pcm16BytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// The stable idle snapshot (useSyncExternalStore's caching law)
// ---------------------------------------------------------------------------

/** The STABLE idle snapshot (getServerSnapshot/getSnapshot must return cached references). */
const IDLE_PHASE_SNAPSHOT: RealtimeClientPhase = { phase: "idle" };

/** The idle-snapshot reader (the stable reference, always). */
export function idleRealtimePhaseSnapshot(): RealtimeClientPhase {
  return IDLE_PHASE_SNAPSHOT;
}

/** The stable snapshot reader for a possibly-absent controller (the hydration-safe form). */
export function realtimePhaseSnapshotOf(controller: RealtimeSessionController | null): RealtimeClientPhase {
  return controller === null ? IDLE_PHASE_SNAPSHOT : controller.getState();
}

// ---------------------------------------------------------------------------
// The singleton (the chrome row + the island share ONE controller)
// ---------------------------------------------------------------------------

let activeController: RealtimeSessionController | null = null;

/** The player surface's active controller (the chrome row + the island's shared truth). */
export function getActiveRealtimeSessionController(): RealtimeSessionController | null {
  return activeController;
}

// The ACTIVE-PHASE PROXY STORE (the chrome row's subscription seam): the
// row subscribes to the ACTIVE controller's phase — resolved at
// read/subscribe time, never a stale render-time capture (the island
// binds the controller after the row's first render; the store
// re-renders the row when the binding lands and forwards every phase
// change from then on).
const phaseListeners = new Set<() => void>();
let forwardedController: RealtimeSessionController | null = null;
let unsubscribeForwarded: (() => void) | null = null;

function forwardPhaseChanges(controller: RealtimeSessionController | null): void {
  if (controller === forwardedController) return;
  if (unsubscribeForwarded !== null) {
    unsubscribeForwarded();
    unsubscribeForwarded = null;
  }
  forwardedController = controller;
  if (controller !== null) {
    unsubscribeForwarded = controller.subscribe(() => {
      for (const listener of [...phaseListeners]) listener();
    });
  }
}

function notifyPhaseListeners(): void {
  for (const listener of [...phaseListeners]) listener();
}

/** Subscribe to the ACTIVE controller's phase changes (the proxy store). */
export function subscribeActiveRealtimePhase(listener: () => void): () => void {
  phaseListeners.add(listener);
  return () => {
    phaseListeners.delete(listener);
  };
}

/** Read the ACTIVE controller's phase (resolved at read time — the proxy store's snapshot). */
export function getActiveRealtimePhase(): RealtimeClientPhase {
  return realtimePhaseSnapshotOf(activeController);
}

/** Bind the surface's controller (the island's mount — one per player surface). */
export function setActiveRealtimeSessionController(controller: RealtimeSessionController | null): void {
  if (activeController !== null && controller !== null && activeController !== controller) {
    activeController.dispose();
  }
  activeController = controller;
  forwardPhaseChanges(controller);
  notifyPhaseListeners();
}

/** Create the surface's controller (the island's construction). */
export function createRealtimeSessionController(): RealtimeSessionController {
  return new RealtimeSessionController();
}
