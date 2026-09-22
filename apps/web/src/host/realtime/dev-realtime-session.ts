/**
 * @wfx/app-web — the DEV REALTIME SESSION (R25-D: the adapter-side
 * implementation of the frozen `RealtimeTranslationSession` port over
 * the deterministic dev provider double's WebSocket).
 *
 * THE BINDING (the shared contract, verbatim): this module implements
 * Worker 1's R25-A session port — `start`/`configure`/`appendAudio`/
 * `appendImageFrame`/`stop`/`reconnect`/`close` + `events()` over the
 * shared `RealtimeEventStream` — driving the provider double's control
 * protocol (start/resume/append/configure/stop) and normalizing its
 * frames into the frozen domain events (the one transport decode:
 * `audioBase64` → the domain's `audio: Uint8Array`).
 *
 * THE STATE MACHINE (the shared table, honored): `idle → starting →
 * streaming` on start/ready; a mid-stream provider close moves to
 * `reconnecting` + a `recoverable-error` (network) — the consumer (the
 * bridge) then drives the domain `reconnect` operation (legal only from
 * `reconnecting`), which resumes the provider session; a terminal
 * provider failure pushes `terminal-error` + `session-closed` and ends
 * in `closed`. No operation is legal from `closed`; nothing here ever
 * touches playback (the shared never-block-playback law).
 */

import type {
  RealtimeAudioChunkInput,
  RealtimeImageFrameInput,
  RealtimeSessionConfiguration,
  RealtimeTranslationEvent,
  RealtimeTranslationSessionInputs,
} from "@wfx/domain";

import { createRealtimeEventStream } from "@wfx/model-fabric";

import {
  base64ToBytes,
  type RealtimeProviderSeamFactory,
  type RealtimeProviderSessionSeam,
  type RealtimeSeamRefusal,
} from "./realtime-wire";
import {
  DEV_REALTIME_PROVIDER_DETAIL,
  DEV_REALTIME_PROVIDER_ID,
  DEV_REALTIME_REPORTED_AVERAGE_LAG_MS,
  DEV_REALTIME_TARGET_LANGUAGES,
  type DevProviderControl,
  type DevProviderStreamFrame,
} from "./dev-realtime-provider";

// ---------------------------------------------------------------------------
// The seam factory (the bridge's injection point)
// ---------------------------------------------------------------------------

/**
 * Create the dev provider SEAM factory — the fixtures boot's
 * implementation of the bridge's provider injection point: every
 * `open(inputs)` connects a REAL WebSocket to the dev provider double,
 * drives the domain port over it, and normalizes its frames into the
 * frozen domain events.
 */
export function createDevRealtimeSeam(providerUrl: string): RealtimeProviderSeamFactory {
  return {
    providerId: DEV_REALTIME_PROVIDER_ID,
    providerDetail: DEV_REALTIME_PROVIDER_DETAIL,
    reportedAverageLagMs: DEV_REALTIME_REPORTED_AVERAGE_LAG_MS,
    targetLanguages: DEV_REALTIME_TARGET_LANGUAGES,
    async open(inputs): Promise<RealtimeProviderSessionSeam | RealtimeSeamRefusal> {
      return await openDevSession(providerUrl, inputs);
    },
  };
}

// ---------------------------------------------------------------------------
// One domain session over the double's WebSocket
// ---------------------------------------------------------------------------

/** The handshake frame the double answers (the double's protocol). */
interface HandshakeFrame {
  readonly kind: "provider-session-ready";
  readonly token: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly sourceStream: string;
  readonly resumed?: boolean;
}

/** The double's terminal frame. */
interface TerminalFrame {
  readonly kind: "provider-terminal";
  readonly errorKind: "provider-failure" | "policy" | "unknown";
  readonly detail: string;
  readonly recovery: string;
}

/** The double's refusal frame. */
interface RefusalFrame {
  readonly kind: "provider-refused";
  readonly errorKind: "policy" | "unsupported-language-direction" | "unknown";
  readonly detail: string;
  readonly recovery: string;
}

/** The domain session state (the frozen union). */
type SessionState =
  | "idle"
  | "starting"
  | "streaming"
  | "reconnecting"
  | "stopped"
  | "closed";

/** Open one dev session (the factory's per-session path). */
async function openDevSession(
  providerUrl: string,
  inputs: RealtimeTranslationSessionInputs,
): Promise<RealtimeProviderSessionSeam | RealtimeSeamRefusal> {
  let socket: WebSocket;
  try {
    socket = new WebSocket(providerUrl);
  } catch (error) {
    return {
      ok: false,
      errorKind: "network",
      detail: `the provider endpoint refused the connection (${error instanceof Error ? error.message : String(error)})`,
      recovery: "Check the realtime provider registration in Model & AI settings.",
    };
  }
  // Connect the socket but do NOT start the session yet (the domain's
  // open → start two-step: the factory opens, start() begins).
  const connected = await new Promise<boolean>((resolve) => {
    socket.addEventListener("open", () => resolve(true), { once: true });
    socket.addEventListener("error", () => resolve(false), { once: true });
  });
  if (!connected) {
    return {
      ok: false,
      errorKind: "network",
      detail: "the provider endpoint could not be reached",
      recovery: "Check the realtime provider registration in Model & AI settings.",
    };
  }

  const sessionId = `wfxrt_${Math.random().toString(36).slice(2, 12)}`;
  const { stream, events } = createRealtimeEventStream();
  const stateListeners: ((state: SessionState) => void)[] = [];
  let state: SessionState = "idle";
  let providerToken: string | null = null;
  let lastCommittedSegmentId = "";
  let started = false;
  let stopped = false;

  const setState = (next: SessionState): void => {
    state = next;
    for (const listener of [...stateListeners]) listener(next);
  };

  const push = (event: RealtimeTranslationEvent): void => {
    stream.push(event);
  };

  /** Decode one double frame into the domain event (the transport decode). */
  const decodeFrame = (frame: DevProviderStreamFrame): RealtimeTranslationEvent => {
    if (frame.kind === "translated-audio-chunk") {
      const chunk = frame as Extract<RealtimeTranslationEvent, { kind: "translated-audio-chunk" }> & {
        audioBase64?: string;
      };
      const { audioBase64, ...rest } = chunk;
      return { ...rest, audio: base64ToBytes(audioBase64 ?? "") };
    }
    return { ...frame, sessionId };
  };

  /** Await the double's next control frame (ready/refused/terminal). */
  const awaitControlFrame = <T>(
    predicate: (frame: unknown) => T | null,
    timeoutMs: number,
  ): Promise<T | "timeout" | "socket-closed"> =>
    new Promise((resolve) => {
      const onMessage = (event: MessageEvent): void => {
        if (typeof event.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const match = predicate(parsed);
        if (match !== null) {
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("close", onClose);
          clearTimeout(timer);
          resolve(match);
        }
      };
      const onClose = (): void => {
        socket.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve("socket-closed");
      };
      const timer = setTimeout(() => {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        resolve("timeout");
      }, timeoutMs);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose, { once: true });
    });

  const seam: RealtimeProviderSessionSeam = {
    session: {
      sessionId,
      get state(): SessionState {
        return state;
      },
      async start(): Promise<void> {
        if (started) return;
        started = true;
        setState("starting");
        socket.send(JSON.stringify({ kind: "provider-session-start", inputs } satisfies DevProviderControl));
        const frame = await awaitControlFrame<HandshakeFrame>(
          (candidate) => {
            const record = candidate as Record<string, unknown>;
            return record["kind"] === "provider-session-ready"
              ? (candidate as unknown as HandshakeFrame)
              : null;
          },
          10_000,
        );
        if (frame === "timeout" || frame === "socket-closed" || frame.kind !== "provider-session-ready") {
          setState("closed");
          push({
            kind: "terminal-error",
            sessionId,
            occurredAt: new Date().toISOString(),
            errorKind: "provider-failure",
            detail: "the provider session did not start (no handshake — try starting the translation again)",
          });
          push({
            kind: "session-closed",
            sessionId,
            occurredAt: new Date().toISOString(),
            reason: "terminal-error",
          });
          stream.close();
          socket.close();
          return;
        }
        providerToken = frame.token;
        // The domain's session-created event (the frozen shape: the
        // provider/model identity + the effective inputs).
        push({
          kind: "session-created",
          sessionId,
          occurredAt: new Date().toISOString(),
          providerId: frame.providerId,
          modelId: frame.modelId,
          modelRevision: frame.modelRevision,
          effectiveInputs: inputs,
        });
        setState("streaming");
      },
      async configure(configuration: RealtimeSessionConfiguration): Promise<void> {
        if (state === "closed") return;
        socket.send(
          JSON.stringify({
            kind: "provider-configure",
            ...(configuration.outputModality !== undefined ? { outputModality: configuration.outputModality } : {}),
          } satisfies DevProviderControl),
        );
      },
      async appendAudio(chunk: RealtimeAudioChunkInput): Promise<void> {
        if (state !== "streaming" && state !== "starting") return;
        socket.send(
          JSON.stringify({
            kind: "provider-audio-append",
            payloadBase64: Buffer.from(chunk.audio).toString("base64"),
            ...(chunk.mediaPositionMs !== undefined ? { mediaPositionMs: chunk.mediaPositionMs } : {}),
          } satisfies DevProviderControl),
        );
      },
      async appendImageFrame(frame: RealtimeImageFrameInput): Promise<void> {
        // The web lane's visual policy is 'off' by default (visual-frame
        // upload never forced — the frozen law); the seam is wired for
        // the domain operation but the dev double carries no visual path.
        void frame;
      },
      async stop(): Promise<void> {
        if (state === "closed" || state === "stopped") return;
        stopped = true;
        socket.send(JSON.stringify({ kind: "provider-stop" } satisfies DevProviderControl));
        setState("stopped");
        push({
          kind: "session-closed",
          sessionId,
          occurredAt: new Date().toISOString(),
          reason: "user-stop",
        });
        stream.close();
        socket.close();
      },
      async reconnect(): Promise<void> {
        if (state !== "reconnecting" || providerToken === null) return;
        // Resume over a FRESH provider connection (the double's resume
        // handshake — the continuity cursor drives the script's resume).
        const resumeUrl = providerUrl;
        const resumeSocket: WebSocket = new WebSocket(resumeUrl);
        const connected = await new Promise<boolean>((resolve) => {
          resumeSocket.addEventListener("open", () => resolve(true), { once: true });
          resumeSocket.addEventListener("error", () => resolve(false), { once: true });
        });
        if (!connected) {
          return;
        }
        resumeSocket.send(
          JSON.stringify({
            kind: "provider-session-resume",
            token: providerToken,
            lastCommittedSegmentId,
          } satisfies DevProviderControl),
        );
        const frame = await awaitControlFrameOn(
          resumeSocket,
          (candidate) => {
            const record = candidate as Record<string, unknown>;
            return record["kind"] === "provider-session-ready"
              ? (candidate as unknown as HandshakeFrame)
              : null;
          },
          10_000,
        );
        if (frame === "timeout" || frame === "socket-closed" || frame.kind !== "provider-session-ready") {
          return;
        }
        // Swap the stream wiring onto the resumed socket (the named
        // handlers detach from the dropped socket and attach to the
        // resumed one — one stream, one continuity).
        socket.removeEventListener("message", onStreamMessage);
        socket.removeEventListener("close", onStreamClose);
        socket.close();
        socket = resumeSocket;
        wireStream(resumeSocket);
        setState("streaming");
      },
      async close(): Promise<void> {
        if (state === "closed") return;
        stopped = true;
        setState("closed");
        push({
          kind: "session-closed",
          sessionId,
          occurredAt: new Date().toISOString(),
          reason: "user-close",
        });
        stream.close();
        socket.close();
      },
      events,
    },
    get providerToken(): string {
      return providerToken ?? "";
    },
    onStateChange(handler: (state: SessionState) => void): () => void {
      stateListeners.push(handler);
      return () => {
        const index = stateListeners.indexOf(handler);
        if (index >= 0) stateListeners.splice(index, 1);
      };
    },
  };

  // The stream message/close wiring (named for the reconnect swap).
  const onStreamMessage = (event: MessageEvent): void => {
    if (typeof event.data !== "string") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const kind = parsed["kind"];
    if (kind === "provider-terminal") {
      const frame = parsed as unknown as TerminalFrame;
      setState("closed");
      push({
        kind: "terminal-error",
        sessionId,
        occurredAt: new Date().toISOString(),
        errorKind: "provider-failure",
        detail: frame.detail,
      });
      push({
        kind: "session-closed",
        sessionId,
        occurredAt: new Date().toISOString(),
        reason: "terminal-error",
      });
      stream.close();
      socket.close();
      return;
    }
    if (kind === "provider-refused") {
      const frame = parsed as unknown as RefusalFrame;
      setState("closed");
      push({
        kind: "terminal-error",
        sessionId,
        occurredAt: new Date().toISOString(),
        errorKind: "provider-failure",
        detail: frame.detail,
      });
      push({
        kind: "session-closed",
        sessionId,
        occurredAt: new Date().toISOString(),
        reason: "terminal-error",
      });
      stream.close();
      socket.close();
      return;
    }
    if (typeof kind === "string" && kind !== "provider-session-ready") {
      if (kind === "source-transcript-final") {
        const segmentId = parsed["segmentId"];
        if (typeof segmentId === "string") {
          lastCommittedSegmentId = segmentId;
        }
      }
      push(decodeFrame(parsed as unknown as DevProviderStreamFrame));
    }
  };

  const onStreamClose = (): void => {
    if (state === "closed" || state === "stopped" || stopped) return;
    if (state === "streaming" || state === "starting") {
      setState("reconnecting");
      push({
        kind: "recoverable-error",
        sessionId,
        occurredAt: new Date().toISOString(),
        errorKind: "network",
        detail: "the provider connection dropped mid-stream — the session can reconnect and resume",
        recovery: "The bridge drives the reconnect operation; the session resumes from the last committed segment.",
      });
    }
  };

  const wireStream = (target: WebSocket): void => {
    target.addEventListener("message", onStreamMessage);
    target.addEventListener("close", onStreamClose, { once: true });
  };

  // Initial wiring (the reconnect path swaps it onto the resumed socket).
  wireStream(socket);

  return seam;
}

/** Await one control frame on a SPECIFIC socket (the resume handshake). */
function awaitControlFrameOn<T>(
  target: WebSocket,
  predicate: (frame: unknown) => T | null,
  timeoutMs: number,
): Promise<T | "timeout" | "socket-closed"> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const match = predicate(parsed);
      if (match !== null) {
        target.removeEventListener("message", onMessage);
        target.removeEventListener("close", onClose);
        clearTimeout(timer);
        resolve(match);
      }
    };
    const onClose = (): void => {
      target.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve("socket-closed");
    };
    const timer = setTimeout(() => {
      target.removeEventListener("message", onMessage);
      target.removeEventListener("close", onClose);
      resolve("timeout");
    }, timeoutMs);
    target.addEventListener("message", onMessage);
    target.addEventListener("close", onClose, { once: true });
  });
}
