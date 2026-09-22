/**
 * @wfx/native-media — the realtime audio capture tap (R25-W3, the plan's
 * R25-E "full-fidelity paths" capture law).
 *
 * THE LAW THIS MODULE KEEPS (docs/plans/2026-09-20-webflix-qwen-livetranslate-
 * plan.md R25-E): the model consumes audio ONLY where WebFlix has LAWFUL and
 * TECHNICAL access to the decoded stream. On the Desktop the lawful capture
 * point is WEBFLIX'S OWN PLAYBACK PIPELINE — the decoded audio the native
 * media stack renders for an authorized session:
 *
 * - `local-session`   — authorized local media opened through the engine;
 * - `torrent-session` — authorized torrent/peer playback the engine serves;
 * - `live-input`      — a WebFlix-controlled live stream input.
 *
 * Provider iframe/embed surfaces NEVER enter this module: their audio is not
 * WebFlix's to capture, and nothing here may be pointed at a restricted
 * surface (the desktop media adapter's capability resolution owns that
 * truth; this module only serves taps for sources the ENGINE truth or the
 * explicit live-input registration knows about).
 *
 * THE TAP SEAM (where the frames come from): the platform's audio stack
 * DECODES and renders the media the engine serves; the decoded frames it
 * renders for one source are pushed into the service-provided sink (the
 * same-process audio graph WebFlix owns — this is not a DRM bypass, it is
 * WebFlix's own decode path). Production wires the shell audio stack's tap
 * callback through {@link NativeAudioTapSource}; tests inject a scripted
 * source. ESCALATION (documented for the lead): the frozen v1 engine stdio
 * wire (engine/process.ts — six ops, JSON lines) carries NO audio channel;
 * the child-process production topology extends with a binary sidecar tap
 * (or the in-process service host composition) when R25 productionizes —
 * the same class of documented R10 gap as the DTO integrity field.
 *
 * HONESTY LAWS (machine-checked, never asserted from code reading):
 *
 * 1. NO FABRICATED FRAMES: every frame relayed to a consumer CAME from the
 *    tap source; the service validates (non-empty, byte-aligned, finite
 *    timeline position, declared format) and STAMPS it with the capture
 *    clock — it never invents samples, positions, or timestamps.
 * 2. NO TAP FOR UNKNOWN SOURCES: a tap on a session the engine truth does
 *    not know (or a live input that was never registered) is refused with
 *    the typed `unknown-source` failure — capture is never a guess, and a
 *    `complete`/`failed` session answers `not-capturable` (there is no
 *    live decoded audio to tap).
 * 3. ONE TAP PER SOURCE, MANY CONSUMERS: the platform tap opens once; the
 *    service fans frames out to every subscriber; the tap closes when the
 *    LAST consumer unsubscribes (never earlier — never a silent stream
 *    loss for the others).
 * 4. MALFORMED FRAMES ARE COUNTED, NEVER RELAYED: playback clocks may jump
 *    on SEEK (a legal re-position) but never go negative or NaN; a frame
 *    that fails validation increments the source's `invalidFrames` and is
 *    dropped — the accounting is the evidence.
 */

import { NativeMediaError } from "../errors";

// ---------------------------------------------------------------------------
// The frame vocabulary (what crosses the tap)
// ---------------------------------------------------------------------------

/** The decoded-audio frame format the tap carries (closed vocabulary). */
export type NativeAudioFrameEncoding = "pcm-s16le" | "pcm-f32le";

/** One validated frame format. */
export interface NativeAudioFrameFormat {
  /** Samples per second (e.g. 48000). */
  readonly sampleRateHz: number;
  /** Channel count (1 = mono, 2 = stereo). */
  readonly channels: number;
  /** The PCM encoding of {@link NativeAudioTapFrame.samples}. */
  readonly encoding: NativeAudioFrameEncoding;
}

/**
 * One decoded audio frame captured from WebFlix's own playback pipeline.
 * `positionMs` is the frame's position on the SOURCE'S OWN playback
 * timeline — the alignment key the realtime translation session's
 * append-audio seam consumes (source/translation drift is measured against
 * it, never corrected by rewriting it).
 */
export interface NativeAudioTapFrame {
  /** The tap source's identity (the engine session id / live input id). */
  readonly sourceId: string;
  /** Which full-fidelity path the frame came from. */
  readonly sourceKind: "local-session" | "torrent-session" | "live-input";
  /** The frame's position on the source's playback timeline (ms, >= 0). */
  readonly positionMs: number;
  /** The frame's format (validated against the tap's declared format). */
  readonly format: NativeAudioFrameFormat;
  /** The decoded PCM bytes (validated non-empty + byte-aligned). */
  readonly samples: Uint8Array;
}

// ---------------------------------------------------------------------------
// The tap source seam (the platform's decoded-audio callback)
// ---------------------------------------------------------------------------

/** The typed refusal vocabulary (closed; honest, never a bare throw). */
export type NativeAudioTapRefusal =
  | { readonly kind: "unknown-source"; readonly detail: string }
  | { readonly kind: "not-capturable"; readonly detail: string }
  | { readonly kind: "tap-open-failed"; readonly detail: string };

/** One frame relayed to a tap consumer with the service's arrival stamp. */
export interface StampedAudioTapFrame extends NativeAudioTapFrame {
  /** When the service OBSERVED the frame (the capture clock, ms). */
  readonly capturedAtMs: number;
}

/** A tap consumer's frame notification. */
export interface NativeAudioTapNotification {
  readonly kind: "frame";
  readonly frame: StampedAudioTapFrame;
}

/** The platform tap's open controller (the consumer-facing close). */
export interface NativeAudioTapController {
  /** The tapped source's identity. */
  readonly sourceId: string;
  /**
   * Unsubscribe this consumer (the LAST unsubscribe closes the platform
   * tap — one tap per source, many consumers).
   */
  unsubscribe(): void;
}

/**
 * The service's ingest sink: the platform audio stack pushes decoded
 * frames here (the handle returned by openTap routes the platform's own
 * callback into this sink).
 */
export type NativeAudioTapSink = (frame: NativeAudioTapFrame) => void;

/** One open platform tap (the source hands this back; the service drives it). */
export interface NativeAudioTapHandle {
  /** The tapped source's identity. */
  readonly sourceId: string;
  /** Stop the platform's push into the sink (idempotent). */
  close(): void;
}

/**
 * The platform seam: open a tap on one decoded-audio source, wiring the
 * platform's decoded-frame callback to the service's sink. Production: the
 * shell audio stack's loopback tap. Tests: a scripted source.
 */
export interface NativeAudioTapSource {
  openTap(input: {
    readonly sourceId: string;
    readonly sourceKind: NativeAudioTapFrame["sourceKind"];
    readonly format: NativeAudioFrameFormat;
    readonly sink: NativeAudioTapSink;
  }): Promise<NativeAudioTapHandle | NativeAudioTapRefusal>;
}

// ---------------------------------------------------------------------------
// The capture service (validation + stamping + fan-out)
// ---------------------------------------------------------------------------

/** The engine-session truth the capture service consults (injected). */
export interface CaptureSessionTruth {
  /**
   * The engine's live-truth for one session id: its current state, or
   * `null` when the engine does not know the session (the tap is refused).
   */
  sessionStateOf(
    sourceId: string,
  ): "resolving" | "buffering" | "playing" | "background" | "complete" | "failed" | null;
}

/** Options for {@link createNativeAudioCaptureService}. */
export interface NativeAudioCaptureServiceOptions {
  /** The platform tap source (the shell audio stack's decoded-audio seam). */
  readonly tapSource: NativeAudioTapSource;
  /** The engine-session truth (which sessions exist + their live state). */
  readonly sessionTruth: CaptureSessionTruth;
  /**
   * The live-input registry truth: the live inputs the platform has
   * registered (WebFlix-controlled streams). Live inputs have no engine
   * session — their existence is the registration's truth.
   */
  readonly liveInputTruth?: { readonly isLiveInput: (sourceId: string) => boolean };
  /** The capture clock (arrival stamps; never a hidden wall clock). */
  readonly clock: () => number;
}

/** The per-source capture accounting (the honest statistics). */
export interface NativeCaptureSourceStats {
  readonly sourceId: string;
  readonly sourceKind: NativeAudioTapFrame["sourceKind"];
  /** The declared format of the tap. */
  readonly format: NativeAudioFrameFormat;
  /** Frames RELAYED to consumers (validated + stamped). */
  readonly relayedFrames: number;
  /** Frames DROPPED for being malformed (the typed invalid-frame count). */
  readonly invalidFrames: number;
  /** The live consumer count. */
  readonly consumers: number;
  /** The last relayed frame's playback position (null before the first). */
  readonly lastPositionMs: number | null;
  /** The tap's open truth. */
  readonly open: boolean;
}

/** The realtime audio capture service. */
export interface NativeAudioCaptureService {
  /**
   * Open a tap on one source and subscribe a consumer to its frames.
   * Refused typed when the engine truth does not know the session (or the
   * live input is not registered) — capture is never a guess.
   */
  subscribe(
    input: {
      readonly sourceId: string;
      readonly sourceKind: NativeAudioTapFrame["sourceKind"];
      readonly format: NativeAudioFrameFormat;
    },
    consumer: (notification: NativeAudioTapNotification) => void,
  ): Promise<NativeAudioTapController | NativeAudioTapRefusal>;

  /** The per-source accounting (every tap open on this service). */
  statistics(): readonly NativeCaptureSourceStats[];

  /** Close every tap (the shutdown law — idempotent). */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Validation (law 1 + law 4 — no fabricated frames, no malformed relays)
// ---------------------------------------------------------------------------

/**
 * Validate one incoming frame against its tap's declared shape. Returns a
 * typed rejection detail (the frame is counted + dropped, never relayed)
 * or `null` when the frame is honest.
 */
export function validateTapFrame(
  frame: NativeAudioTapFrame,
  expected: { readonly sourceId: string; readonly format: NativeAudioFrameFormat },
): string | null {
  if (frame === null || typeof frame !== "object") return "the frame is not an object";
  if (frame.sourceId !== expected.sourceId) {
    return `the frame's sourceId '${String(frame.sourceId)}' does not match the tap's '${expected.sourceId}'`;
  }
  const position = frame.positionMs;
  if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
    return `the frame's positionMs is not a finite non-negative number (${String(position)})`;
  }
  const samples = frame.samples;
  if (!(samples instanceof Uint8Array) || samples.length === 0) {
    return "the frame carries no samples";
  }
  const bytesPerSample = expected.format.encoding === "pcm-s16le" ? 2 : 4;
  if (samples.length % (bytesPerSample * expected.format.channels) !== 0) {
    return `the frame's sample bytes (${samples.length}) are not aligned to ${expected.format.encoding} x ${expected.format.channels} channel(s)`;
  }
  const format = frame.format;
  if (
    format?.sampleRateHz !== expected.format.sampleRateHz ||
    format?.channels !== expected.format.channels ||
    format?.encoding !== expected.format.encoding
  ) {
    return "the frame's format does not match the tap's declared format";
  }
  return null;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

interface SourceRecord {
  readonly sourceId: string;
  readonly sourceKind: NativeAudioTapFrame["sourceKind"];
  readonly format: NativeAudioFrameFormat;
  readonly platformHandle: NativeAudioTapHandle;
  readonly consumers: Set<(notification: NativeAudioTapNotification) => void>;
  relayedFrames: number;
  invalidFrames: number;
  lastPositionMs: number | null;
  open: boolean;
}

/**
 * Create the realtime audio capture service. Pure validation + stamping +
 * fan-out over the injected tap source and session truth: no product
 * policy, no provider knowledge (the realtime translation session seam is
 * the desktop adapter's composition), no invented frames.
 */
export function createNativeAudioCaptureService(
  options: NativeAudioCaptureServiceOptions,
): NativeAudioCaptureService {
  const sources = new Map<string, SourceRecord>();

  function closeRecord(record: SourceRecord): void {
    if (!record.open) return;
    record.open = false;
    record.consumers.clear();
    sources.delete(record.sourceId);
    try {
      record.platformHandle.close();
    } catch {
      // Best-effort teardown of the platform tap.
    }
  }

  return {
    async subscribe(
      input: {
        readonly sourceId: string;
        readonly sourceKind: NativeAudioTapFrame["sourceKind"];
        readonly format: NativeAudioFrameFormat;
      },
      consumer: (notification: NativeAudioTapNotification) => void,
    ): Promise<NativeAudioTapController | NativeAudioTapRefusal> {
      if (typeof input?.sourceId !== "string" || input.sourceId.length === 0) {
        return { kind: "unknown-source", detail: "subscribe: sourceId must be a non-empty string" };
      }
      if (typeof consumer !== "function") {
        return { kind: "tap-open-failed", detail: "subscribe: consumer must be a function" };
      }
      const format = input.format;
      if (
        !Number.isFinite(format?.sampleRateHz) ||
        (format?.sampleRateHz ?? 0) < 1 ||
        (format?.channels !== 1 && format?.channels !== 2) ||
        (format?.encoding !== "pcm-s16le" && format?.encoding !== "pcm-f32le")
      ) {
        return {
          kind: "tap-open-failed",
          detail: `subscribe: the format is not a valid capture format (got ${String(format?.sampleRateHz)}Hz x ${String(format?.channels)}ch ${String(format?.encoding)})`,
        };
      }

      // LAW 2 — no tap for unknown sources. Live inputs consult the
      // registration truth; engine sessions consult the engine truth and
      // must be a LIVE state (a completed/failed session has no decoded
      // audio to tap — the honest refusal).
      if (input.sourceKind === "live-input") {
        const registered = options.liveInputTruth?.isLiveInput(input.sourceId) ?? false;
        if (!registered) {
          return {
            kind: "unknown-source",
            detail: `subscribe: live input '${input.sourceId}' is not registered — a WebFlix-controlled live input must be registered before it can be tapped`,
          };
        }
      } else {
        const state = options.sessionTruth.sessionStateOf(input.sourceId);
        if (state === null) {
          return {
            kind: "unknown-source",
            detail: `subscribe: the engine does not know session '${input.sourceId}' — capture is refused for sources the native media service does not own`,
          };
        }
        if (state === "complete" || state === "failed") {
          return {
            kind: "not-capturable",
            detail: `subscribe: session '${input.sourceId}' is ${state} — there is no live decoded audio to capture`,
          };
        }
      }

      // LAW 3 — one tap per source, many consumers: an existing open tap
      // adds the consumer; the platform tap opens only for the first.
      const existing = sources.get(input.sourceId);
      if (existing !== undefined && existing.open) {
        existing.consumers.add(consumer);
        return {
          sourceId: existing.sourceId,
          unsubscribe: (): void => {
            existing.consumers.delete(consumer);
            if (existing.consumers.size === 0) closeRecord(existing);
          },
        };
      }

      // The service's ingest sink: validate, stamp, fan out (laws 1 + 4).
      const sink: NativeAudioTapSink = (frame: NativeAudioTapFrame): void => {
        const record = sources.get(input.sourceId);
        if (record === undefined || !record.open || record.consumers.size === 0) return;
        const rejection = validateTapFrame(frame, {
          sourceId: record.sourceId,
          format: record.format,
        });
        if (rejection !== null) {
          record.invalidFrames += 1;
          return;
        }
        const stamped: StampedAudioTapFrame = { ...frame, capturedAtMs: options.clock() };
        record.relayedFrames += 1;
        record.lastPositionMs = frame.positionMs;
        for (const target of record.consumers) {
          target({ kind: "frame", frame: stamped });
        }
      };

      const opened = await options.tapSource.openTap({
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        format,
        sink,
      });
      if ("kind" in opened) return opened;

      const record: SourceRecord = {
        sourceId: input.sourceId,
        sourceKind: input.sourceKind,
        format,
        platformHandle: opened,
        consumers: new Set([consumer]),
        relayedFrames: 0,
        invalidFrames: 0,
        lastPositionMs: null,
        open: true,
      };
      sources.set(input.sourceId, record);

      return {
        sourceId: opened.sourceId,
        unsubscribe: (): void => {
          record.consumers.delete(consumer);
          if (record.consumers.size === 0) closeRecord(record);
        },
      };
    },

    statistics(): readonly NativeCaptureSourceStats[] {
      return [...sources.values()].map((record) => ({
        sourceId: record.sourceId,
        sourceKind: record.sourceKind,
        format: record.format,
        relayedFrames: record.relayedFrames,
        invalidFrames: record.invalidFrames,
        consumers: record.consumers.size,
        lastPositionMs: record.lastPositionMs,
        open: record.open,
      }));
    },

    dispose(): void {
      for (const record of [...sources.values()]) {
        closeRecord(record);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The error mapping (the native-media typed-error bridge)
// ---------------------------------------------------------------------------

/**
 * Map a capture refusal onto the package's typed `NativeMediaError` (the
 * closed code vocabulary consumers of the service process already speak).
 */
export function captureRefusalToError(refusal: NativeAudioTapRefusal): NativeMediaError {
  switch (refusal.kind) {
    case "unknown-source":
      return new NativeMediaError("NOT_FOUND", { detail: refusal.detail });
    case "not-capturable":
      return new NativeMediaError("INVALID_INPUT", { detail: refusal.detail });
    case "tap-open-failed":
      return new NativeMediaError("IO_ERROR", { detail: refusal.detail });
  }
}
