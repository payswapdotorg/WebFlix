/**
 * @wfx/app-web — the R25 WEBFLIX REALTIME BRIDGE (R25-D, the web lane's
 * WebSocket realtime transport).
 *
 * THE TRANSPORT LAW (§R25-D, frozen):
 *   Browser → WebFlix WebSocket (this bridge) → the provider WebSocket
 *   (through the injected provider-session seam).
 *   NEVER: Browser → the provider with a provider credential.
 *
 * The bridge is the web lane's prototype of the server-side realtime
 * bridge over the local dev server (the mini-service path the dispatch
 * sanctions — one Bun WebSocket server inside the dev process, port 3102,
 * started by instrumentation.ts / the capability route's lazy boot). The
 * provider behind the seam is provider-neutral (the deterministic dev
 * double in the fixtures boot; the Model-Fabric realtime route when
 * Worker 1's contract lands; the honest typed gap when none is
 * registered).
 *
 * WHAT THE BRIDGE OWNS:
 * - typed wire validation (parseRealtimeClientMessage — never a trusted cast);
 * - session identity + the RECONNECTABLE continuity (the resume token,
 *   the retained session window, the last committed segment — §R25-A
 *   reconnect/resume);
 * - the PROVIDER connection lifecycle (create, relay, the provider-drop
 *   reconnect, the terminal failure);
 * - the R25-K cost controls (session duration cap, anonymous session
 *   quota, the audio-output budget's typed text-only downgrade — none of
 *   which ever touch playback);
 * - the R25-L telemetry records (bridge-side observations; the client's
 *   own markers append through POST /telemetry).
 *
 * THE PERSISTENCE LAW (§R25-D): ONLY continuity + telemetry state is kept
 * (in-process). Raw media is relayed, never stored.
 */

import { createServer, type Server as HttpServer } from "node:http";

import { WebSocket as WsServerSocket, WebSocketServer } from "ws";

import type {
  RealtimeBridgeEvent,
  RealtimeProviderResume,
  RealtimeProviderSessionFactory,
  RealtimeProviderSession,
  RealtimeSessionClosedEvent,
  RealtimeSessionConfig,
} from "./realtime-contract";
import { parseRealtimeClientMessage } from "./realtime-contract";
import { setRealtimeBridgeStatus } from "./realtime-bridge-state";

// ---------------------------------------------------------------------------
// The bridge's policy defaults (§R25-K — injectable for tests)
// ---------------------------------------------------------------------------

/** The default bridge port (the dev boot's 3102). */
export const REALTIME_BRIDGE_DEFAULT_PORT = 3102;

/** The client-connection resume window (the continuity retention). */
const CLIENT_RESUME_WINDOW_MS = 30_000;

/** The default session duration cap (§R25-K — a cost control, never a playback block). */
const DEFAULT_SESSION_DURATION_CAP_MS = 240_000;

/** The default per-session audio-output budget (§R25-K's text-only downgrade trigger). */
const DEFAULT_AUDIO_OUTPUT_BUDGET_MS = 30_000;

/** The default anonymous session quota (§R25-K anonymous quotas; frictionless, bounded). */
const DEFAULT_ANONYMOUS_SESSION_QUOTA = 3;

// ---------------------------------------------------------------------------
// The session records
// ---------------------------------------------------------------------------

/** One bridge session's full state (continuity + policy + telemetry). */
interface BridgeSession {
  readonly sessionId: string;
  readonly resumeToken: string;
  config: RealtimeSessionConfig;
  /** "anonymous" or "viewer:<token>" (opaque — the quota key). */
  readonly viewerKey: string;
  provider: RealtimeProviderSession | null;
  /** The provider token for the reconnect resume (continuity). */
  providerToken: string | null;
  client: WsServerSocket | null;
  /** The last committed source segment (the resume cursor). */
  lastCommittedSegmentId: number;
  readonly createdWallMs: number;
  ended: boolean;
  /** The audio-output downgrade truth (the text-only fallback). */
  audioDowngraded: boolean;
  /** Usage totals (the cost accounting). */
  usage: { inputAudioMs: number; outputTextChars: number; outputAudioMs: number };
  /** The bridge-side markers (telemetry). */
  readonly markers: { marker: string; atMs: number }[];
  /** The continuity expiry timer (the client-disconnect retention window). */
  continuityTimer: ReturnType<typeof setTimeout> | null;
  /** The duration-cap timer. */
  capTimer: ReturnType<typeof setTimeout> | null;
}

/** The per-connection routing state (ws → the bridge data). */
interface BridgeSocketState {
  sessionId: string | null;
  cookieHeader: string;
}

// ---------------------------------------------------------------------------
// The options + handle
// ---------------------------------------------------------------------------

/** The options for {@link startRealtimeBridge}. */
export interface RealtimeBridgeOptions {
  /** The fixed port (default 3102). */
  readonly port?: number;
  /**
   * The provider-session seam (the Model-Fabric shape). Absent in the
   * service boot until Worker 1's contract lands — the bridge answers the
   * honest typed no-realtime-provider-registered gap.
   */
  readonly providerFactory?: RealtimeProviderSessionFactory;
  /** §R25-K policy overrides (tests). */
  readonly sessionDurationCapMs?: number;
  readonly audioOutputBudgetMs?: number;
  readonly anonymousSessionQuota?: number;
  /** Allowed browser origins for the WS upgrade (absent Origin headers — non-browser tooling — pass). */
  readonly allowedOrigins?: readonly string[];
}

/** The running bridge handle. */
export interface RealtimeBridgeHandle {
  readonly port: number;
  readonly url: string;
  /** The health truth (the status module's read). */
  readonly providerId: string | null;
  stop(): Promise<void>;
}

/** The client-marker record appended through POST /telemetry. */
interface ClientTelemetryAppend {
  readonly sessionId: string;
  readonly markers?: { readonly marker: string; readonly atMs: number }[];
  readonly metrics?: Record<string, number | string | null>;
  readonly bridgeUrl?: string;
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/**
 * Start the WebFlix realtime bridge (one per port — idempotent through a
 * process-global guard; the dev-boot doctrine's one-bridge law).
 */
export function startRealtimeBridge(options: RealtimeBridgeOptions = {}): RealtimeBridgeHandle {
  const port = options.port ?? REALTIME_BRIDGE_DEFAULT_PORT;
  const durationCapMs = options.sessionDurationCapMs ?? DEFAULT_SESSION_DURATION_CAP_MS;
  const audioBudgetMs = options.audioOutputBudgetMs ?? DEFAULT_AUDIO_OUTPUT_BUDGET_MS;
  const anonymousQuota = options.anonymousSessionQuota ?? DEFAULT_ANONYMOUS_SESSION_QUOTA;
  const allowedOrigins =
    options.allowedOrigins ?? ["http://localhost:3101", "http://127.0.0.1:3101"];

  const sessions = new Map<string, BridgeSession>();
  /** The ENDED sessions' telemetry records (the retention seam — readable after close). */
  const endedTelemetry: {
    readonly sessionId: string;
    readonly viewer: string;
    readonly config: RealtimeSessionConfig;
    readonly startedAtWallMs: number;
    readonly lastCommittedSegmentId: number;
    readonly audioDowngraded: boolean;
    readonly usage: BridgeSession["usage"];
    readonly markers: readonly { readonly marker: string; readonly atMs: number }[];
    readonly ended: { readonly reason: string; readonly atWallMs: number } | null;
  }[] = [];
  const anonymousCounts = new Map<string, number>();
  const clientTelemetry: ClientTelemetryAppend[] = [];

  const factory = options.providerFactory ?? null;

  /** The CORS headers for the telemetry seam (read + append; no credentials). */
  const telemetryCors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  /** Stamp + relay one bridge event to the session's client (when attached). */
  const relay = (session: BridgeSession, event: RealtimeBridgeEvent): void => {
    if (session.client === null || session.client.readyState !== WsServerSocket.OPEN) return;
    try {
      session.client.send(JSON.stringify(event));
    } catch {
      // A dead client socket is the disconnect path's business, not a crash.
    }
  };

  /** Record one bridge-side marker (telemetry). */
  const mark = (session: BridgeSession, marker: string): void => {
    session.markers.push({ marker, atMs: Date.now() });
  };

  /** Close a session for a typed reason (the single end path). */
  const closeSession = (
    session: BridgeSession,
    reason: RealtimeSessionClosedEvent["reason"],
    detail: string,
  ): void => {
    if (session.ended) return;
    session.ended = true;
    if (session.capTimer !== null) clearTimeout(session.capTimer);
    if (session.continuityTimer !== null) clearTimeout(session.continuityTimer);
    mark(session, "session-closed");
    // THE RETENTION SEAM: the ended session's telemetry record survives
    // (readable through GET /telemetry after the close — the J41-style
    // server seam law; continuity state alone, never raw media).
    endedTelemetry.push({
      sessionId: session.sessionId,
      viewer: session.viewerKey === "anonymous" ? "anonymous" : "authenticated",
      config: session.config,
      startedAtWallMs: session.createdWallMs,
      lastCommittedSegmentId: session.lastCommittedSegmentId,
      audioDowngraded: session.audioDowngraded,
      usage: session.usage,
      markers: [...session.markers],
      ended: { reason, atWallMs: Date.now() },
    });
    relay(session, {
      kind: "session-closed",
      sessionId: session.sessionId,
      reason,
      detail,
      atMs: Date.now(),
    });
    if (session.provider !== null) {
      session.provider.stop();
      session.provider = null;
    }
    sessions.delete(session.sessionId);
  };

  /** Wire a provider session's handlers to one bridge session (the relay + recovery laws). */
  const wireProvider = (session: BridgeSession, provider: RealtimeProviderSession): void => {
    session.provider = provider;
    session.providerToken = provider.token;
    provider.onEvent((event) => {
      if (session.ended) return;
      // The cost policy's audio filter: a downgraded session relays
      // TEXT ONLY (the §R25-K automatic text-only fallback).
      if (event.kind === "translated-audio-chunk" && (session.audioDowngraded || !session.config.modalities.includes("audio"))) {
        return;
      }
      if (event.kind === "usage-telemetry") {
        session.usage.inputAudioMs += event.inputAudioMs;
        session.usage.outputTextChars += event.outputTextChars;
        session.usage.outputAudioMs += event.outputAudioMs;
        // §R25-K — the audio-output budget: when the cumulative output
        // audio would exceed policy, downgrade to text-only (typed,
        // informative, never a playback block — the stream continues).
        if (!session.audioDowngraded && session.usage.outputAudioMs > audioBudgetMs) {
          session.audioDowngraded = true;
          mark(session, "audio-downgraded");
          relay(session, {
            kind: "recoverable-error",
            sessionId: session.sessionId,
            errorKind: "audio-output-budget-reached",
            detail: `translated speech stopped after ${Math.round(audioBudgetMs / 1000)}s of output audio (the cost policy) — the translation continues as text`,
            atMs: Date.now(),
          });
          relay(session, {
            kind: "usage-telemetry",
            sessionId: session.sessionId,
            inputAudioMs: event.inputAudioMs,
            outputTextChars: event.outputTextChars,
            outputAudioMs: event.outputAudioMs,
            audioDowngraded: {
              detail: "text-only from here (the audio-output budget was reached)",
            },
            atMs: Date.now(),
          });
        }
      }
      if (event.kind === "source-transcript-final") {
        session.lastCommittedSegmentId = Math.max(session.lastCommittedSegmentId, event.segmentId);
      }
      // Relay with the bridge's stamps (sessionId + the bridge receive time).
      relay(session, { ...event, sessionId: session.sessionId, atMs: Date.now() });
    });
    provider.onTerminal((failure) => {
      if (session.ended) return;
      mark(session, "terminal-error");
      relay(session, {
        kind: "terminal-error",
        sessionId: session.sessionId,
        errorKind: "provider-failed",
        detail: failure.detail,
        recovery: failure.recovery,
        atMs: Date.now(),
      });
      closeSession(session, "provider-failed", failure.detail);
    });
    provider.onClose(() => {
      if (session.ended || session.provider !== provider) return;
      // THE PROVIDER-DROP RECOVERY (§R25-A reconnect/resume): a mid-stream
      // provider disconnect is RECOVERABLE — the bridge reconnects the
      // provider session with the continuity cursor and resumes.
      mark(session, "provider-disconnected");
      session.provider = null;
      relay(session, {
        kind: "recoverable-error",
        sessionId: session.sessionId,
        errorKind: "provider-disconnected",
        detail: "the provider connection dropped mid-stream — the bridge is reconnecting the session",
        atMs: Date.now(),
      });
      if (factory === null) {
        closeSession(session, "provider-failed", "no provider session factory is registered");
        return;
      }
      const resume: RealtimeProviderResume | undefined =
        session.providerToken === null
          ? undefined
          : {
              providerSessionToken: session.providerToken,
              lastCommittedSegmentId: session.lastCommittedSegmentId,
            };
      void factory
        .createSession(session.config, resume)
        .then((outcome) => {
          if (session.ended) return;
          if ("ok" in outcome) {
            relay(session, {
              kind: "terminal-error",
              sessionId: session.sessionId,
              errorKind: "provider-failed",
              detail: outcome.detail,
              recovery: outcome.recovery,
              atMs: Date.now(),
            });
            closeSession(session, "provider-failed", outcome.detail);
            return;
          }
          wireProvider(session, outcome);
          mark(session, "provider-reconnected");
          relay(session, {
            kind: "session-reconnected",
            sessionId: session.sessionId,
            recovered: "provider-connection",
            lastCommittedSegmentId: session.lastCommittedSegmentId,
            atMs: Date.now(),
          });
        })
        .catch(() => {
          if (session.ended) return;
          closeSession(session, "provider-failed", "the provider reconnect failed");
        });
    });
  };

  /** Start one session (the session-start message's handler). */
  const startSession = (
    ws: WsServerSocket,
    config: RealtimeSessionConfig,
    viewerKey: string,
  ): void => {
    if (factory === null) {
      ws.send(
        JSON.stringify({
          kind: "terminal-error",
          sessionId: "none",
          errorKind: "no-realtime-provider-registered",
          detail: "no realtime translation provider is registered on this host",
          recovery: "A registered Model-Fabric realtime provider serves this lane in service mode — check Model & AI settings.",
          atMs: Date.now(),
        } satisfies RealtimeBridgeEvent),
      );
      return;
    }
    if (viewerKey === "anonymous") {
      const used = anonymousCounts.get(viewerKey) ?? 0;
      if (used >= anonymousQuota) {
        ws.send(
          JSON.stringify({
            kind: "terminal-error",
            sessionId: "none",
            errorKind: "anonymous-quota-reached",
            detail: `this session has started ${used} realtime translations (the anonymous quota)`,
            recovery: "Sign in (optional) for the durable translation lane, or continue watching — original captions stay available.",
            atMs: Date.now(),
          } satisfies RealtimeBridgeEvent),
        );
        return;
      }
      anonymousCounts.set(viewerKey, used + 1);
    }
    const sessionId = `wfxrt_${Math.random().toString(36).slice(2, 12)}`;
    const resumeToken = `wfxres_${Math.random().toString(36).slice(2, 14)}`;
    const session: BridgeSession = {
      sessionId,
      resumeToken,
      config,
      viewerKey,
      provider: null,
      providerToken: null,
      client: ws,
      lastCommittedSegmentId: 0,
      createdWallMs: Date.now(),
      ended: false,
      audioDowngraded: false,
      usage: { inputAudioMs: 0, outputTextChars: 0, outputAudioMs: 0 },
      markers: [{ marker: "session-created", atMs: Date.now() }],
      continuityTimer: null,
      capTimer: null,
    };
    sessions.set(sessionId, session);
    socketStates.set(ws, { sessionId, cookieHeader: socketStates.get(ws)?.cookieHeader ?? "" });
    void factory
      .createSession(config)
      .then((outcome) => {
        if (session.ended) return;
        if ("ok" in outcome) {
          relay(session, {
            kind: "terminal-error",
            sessionId,
            errorKind: outcome.kind,
            detail: outcome.detail,
            recovery: outcome.recovery,
            atMs: Date.now(),
          });
          closeSession(session, "provider-failed", outcome.detail);
          return;
        }
        wireProvider(session, outcome);
        relay(session, {
          kind: "session-created",
          sessionId,
          resumeToken,
          session: config,
          provider: { id: factory.providerId, detail: factory.providerDetail },
          sourceStream: "scripted-dev-double",
          envelope: { averageLaggingMs: "~2,300 ms (the dev provider's modeled profile)" },
          costPolicy: {
            sessionDurationCapMs: durationCapMs,
            audioOutputBudgetMs: audioBudgetMs,
            detail: `the session runs at most ${Math.round(durationCapMs / 1000)}s; translated speech stops after ${Math.round(audioBudgetMs / 1000)}s of output audio (the stream continues as text)`,
          },
          atMs: Date.now(),
        });
        // §R25-K — the duration cap (a typed close, never a playback block).
        session.capTimer = setTimeout(() => {
          if (session.ended) return;
          closeSession(session, "duration-cap", `the session reached its ${Math.round(durationCapMs / 1000)}s duration cap (the cost policy)`);
        }, durationCapMs);
      })
      .catch(() => {
        if (session.ended) return;
        relay(session, {
          kind: "terminal-error",
          sessionId,
          errorKind: "provider-failed",
          detail: "the provider session could not be created",
          recovery: "Try starting the translation again.",
          atMs: Date.now(),
        });
        closeSession(session, "provider-failed", "the provider session could not be created");
      });
  };

  /** The per-socket routing state (ws → the session binding + viewer truth). */
  const socketStates = new WeakMap<WsServerSocket, BridgeSocketState>();

  const httpServer: HttpServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    // THE TELEMETRY SEAM (the retention route — §R25-L): the client's
    // markers append here; the benchmark + the lead read the records.
    if (url.pathname === "/telemetry") {
      if (request.method === "OPTIONS") {
        response.writeHead(204, telemetryCors);
        response.end();
        return;
      }
      if (request.method === "POST") {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        request.on("end", () => {
          try {
            const record = JSON.parse(body) as ClientTelemetryAppend;
            if (typeof record.sessionId === "string" && record.sessionId.length > 0) {
              clientTelemetry.push({
                sessionId: record.sessionId,
                ...(Array.isArray(record.markers) ? { markers: record.markers } : {}),
                ...(record.metrics !== undefined ? { metrics: record.metrics } : {}),
                ...(record.bridgeUrl !== undefined ? { bridgeUrl: record.bridgeUrl } : {}),
              });
            }
            response.writeHead(200, { "content-type": "application/json", ...telemetryCors });
            response.end(JSON.stringify({ ok: true }));
          } catch {
            response.writeHead(400, { "content-type": "application/json", ...telemetryCors });
            response.end(JSON.stringify({ ok: false }));
          }
        });
        return;
      }
      response.writeHead(200, { "content-type": "application/json", ...telemetryCors });
      response.end(
        JSON.stringify({
          ok: true,
          bridge: "wfx-realtime-bridge",
          sessions: [...sessions.values()].map((session) => ({
            sessionId: session.sessionId,
            viewer: session.viewerKey === "anonymous" ? "anonymous" : "authenticated",
            config: {
              targetLanguage: session.config.targetLanguage,
              modalities: session.config.modalities,
              subtitleMode: session.config.subtitleMode,
              externalRef: session.config.externalRef,
            },
            startedAtWallMs: session.createdWallMs,
            lastCommittedSegmentId: session.lastCommittedSegmentId,
            audioDowngraded: session.audioDowngraded,
            usage: session.usage,
            markers: session.markers,
            ended: session.ended,
          })),
          ended: endedTelemetry,
          clientRecords: clientTelemetry,
        }),
      );
      return;
    }
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          bridge: "wfx-realtime-bridge",
          port,
          provider: factory === null ? null : { id: factory.providerId, detail: factory.providerDetail },
          targetLanguages: factory === null ? [] : factory.targetLanguages,
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  // THE WEBSOCKET UPGRADE (the browser's lane — origin-checked, the
  // cookie captured for the viewer key).
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);
    if (url.pathname !== "/") {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      socketStates.set(ws, {
        sessionId: null,
        cookieHeader: request.headers.cookie ?? "",
      });
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WsServerSocket) => {
    // Nothing on open — the first message binds the connection.
    ws.on("message", (data: unknown, _isBinary: boolean) => {
      const message = typeof data === "string" ? data : Buffer.from(data as ArrayBufferLike).toString("utf8");
      handleMessage(ws, message);
    });
    ws.on("close", () => {
      handleClose(ws);
    });
  });

  /** The bridge's client-message handler (the ws event wiring). */
  const handleMessage = (ws: WsServerSocket, message: string): void => {
    {
      const parsed = parseRealtimeClientMessage(message);
      if (parsed.kind === "invalid") {
        ws.send(JSON.stringify({ kind: "terminal-error", sessionId: "none", errorKind: "invalid-input", detail: parsed.detail, recovery: "", atMs: Date.now() } satisfies RealtimeBridgeEvent));
        return;
      }
      // The viewer key: the opaque wfx_session cookie (absent → the
      // anonymous quota key; present → the viewer's own budget lane).
      const socketState = socketStates.get(ws);
      const cookieHeader = socketState?.cookieHeader ?? "";
      const viewerKey = cookieHeader.includes("wfx_session=")
        ? `viewer:${cookieHeader.split("wfx_session=")[1]?.split(";")[0] ?? ""}`
        : "anonymous";
        if (parsed.kind === "session-start") {
          startSession(ws, parsed.session, viewerKey);
          return;
        }
        const session = sessions.get(parsed.sessionId);
        if (session === undefined || session.ended) {
          ws.send(JSON.stringify({ kind: "terminal-error", sessionId: parsed.sessionId, errorKind: "session-expired", detail: "this realtime session is unknown or ended", recovery: "Start the translation again.", atMs: Date.now() } satisfies RealtimeBridgeEvent));
          return;
        }
        if (parsed.kind === "session-resume") {
          // THE CLIENT RECONNECT (§R25-A reconnect/resume): a retained
          // session re-attaches to a new connection through its resume
          // token; the stream continues from the live cursor.
          if (parsed.resumeToken !== session.resumeToken) {
            ws.send(JSON.stringify({ kind: "terminal-error", sessionId: parsed.sessionId, errorKind: "session-expired", detail: "the resume token does not match this session", recovery: "Start the translation again.", atMs: Date.now() } satisfies RealtimeBridgeEvent));
            return;
          }
          session.client = ws;
          const state = socketStates.get(ws);
          if (state !== undefined) {
            state.sessionId = session.sessionId;
          } else {
            socketStates.set(ws, { sessionId: session.sessionId, cookieHeader: "" });
          }
          if (session.continuityTimer !== null) {
            clearTimeout(session.continuityTimer);
            session.continuityTimer = null;
          }
          mark(session, "client-reconnected");
          relay(session, {
            kind: "session-reconnected",
            sessionId: session.sessionId,
            recovered: "client-connection",
            lastCommittedSegmentId: session.lastCommittedSegmentId,
            atMs: Date.now(),
          });
          return;
        }
        if (parsed.kind === "stop") {
          closeSession(session, "stopped", "the viewer stopped the translation");
          return;
        }
        if (parsed.kind === "configure") {
          session.config = {
            ...session.config,
            ...(parsed.modalities !== undefined ? { modalities: parsed.modalities } : {}),
            ...(parsed.subtitleMode !== undefined ? { subtitleMode: parsed.subtitleMode } : {}),
          };
          session.provider?.send({ kind: "provider-configure", modalities: parsed.modalities, subtitleMode: parsed.subtitleMode });
          return;
        }
      if (parsed.kind === "audio-append") {
        // The production capture path's relay (never stored — §R25-D).
        session.provider?.send({ kind: "provider-audio-append", payload: parsed.payload });
        return;
      }
    }
  };
  /** The bridge's close handler (the continuity window's entry). */
  const handleClose = (ws: WsServerSocket): void => {
    const sessionId = socketStates.get(ws)?.sessionId ?? null;
    if (sessionId === null) return;
    const session = sessions.get(sessionId);
    if (session === undefined || session.ended) return;
    if (session.client !== ws) return;
    // THE CONTINUITY WINDOW: the session is retained for the resume;
    // an unresumed session closes (continuity-expired) after it.
    session.client = null;
    mark(session, "client-disconnected");
    if (session.continuityTimer !== null) clearTimeout(session.continuityTimer);
    session.continuityTimer = setTimeout(() => {
      if (session.ended) return;
      closeSession(session, "continuity-expired", "the connection was not re-established within the resume window");
    }, CLIENT_RESUME_WINDOW_MS);
  };

  httpServer.listen(port);

  setRealtimeBridgeStatus({
    running: true,
    port,
    provider: factory === null ? null : { id: factory.providerId, detail: factory.providerDetail },
    targetLanguages: factory === null ? [] : factory.targetLanguages,
  });

  return {
    port,
    url: `ws://localhost:${port}`,
    providerId: factory === null ? null : factory.providerId,
    stop: async (): Promise<void> => {
      for (const session of [...sessions.values()]) {
        closeSession(session, "stopped", "the bridge is shutting down");
      }
      sessions.clear();
      endedTelemetry.length = 0;
      clientTelemetry.length = 0;
      anonymousCounts.clear();
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
    },
  };
}
