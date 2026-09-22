/**
 * @wfx/app-web — the R25 WEBFLIX REALTIME BRIDGE (R25-D, the web lane's
 * WebSocket realtime transport, bound to the shared contracts).
 *
 * THE TRANSPORT LAW (§R25-D, frozen):
 *   Browser → WebFlix WebSocket (this bridge) → the provider session
 *   seam (the frozen `RealtimeTranslationSession` port — the shared
 *   R25-A contract; the deterministic dev double in the fixtures boot,
 *   the Model-Fabric-registered adapter in the service boot).
 *   NEVER: Browser → the provider with a provider credential.
 *
 * The bridge is the web lane's prototype of the server-side realtime
 * bridge over the local dev server (the mini-service path the dispatch
 * sanctions — one `ws`-based WebSocket server inside the dev process,
 * port 3102, started by instrumentation.ts). It owns:
 *
 * - typed wire validation (parseRealtimeWireClientMessage — the frozen
 *   OPERATIONS, never a trusted cast) + the SHARED input validation
 *   (`validateRealtimeTranslationSessionInputs` — Worker 1's
 *   fail-closed gates: the legal-audio gate, the consent gate);
 * - session identity + the RECONNECTABLE continuity (the resume token,
 *   the retained session window, the last committed segment — §R25-A
 *   reconnect/resume);
 * - the provider session lifecycle (open/start, the event relay, the
 *   provider-drop `reconnect` operation — legal only from the shared
 *   `reconnecting` state — and the terminal failures);
 * - the R25-K cost controls THROUGH THE SHARED POLICY ENGINE
 *   (`resolveRealtimeOutputModality`, `evaluateRealtimeSessionPolicy`,
 *   `DEFAULT_REALTIME_ANONYMOUS_QUOTA` — never a second policy);
 * - the R25-L telemetry records (bridge-side observations; the client's
 *   own markers append through POST /telemetry).
 *
 * THE PERSISTENCE LAW (§R25-D): ONLY continuity + telemetry state is
 * kept (in-process). Raw media is relayed, never stored.
 *
 * THE PLAYBACK LAW (the shared total law): translation starting,
 * failing, degrading, or ending NEVER blocks, stops, or delays base
 * playback — this bridge has no capability over the media pipeline at
 * all (it never touches a playback route).
 */

import { createServer, type Server as HttpServer } from "node:http";

import { WebSocket as WsServerSocket, WebSocketServer } from "ws";

import type {
  RealtimeSessionUsage,
  RealtimeTranslationEvent,
  RealtimeTranslationSessionInputs,
} from "@wfx/domain";
import {
  DEFAULT_REALTIME_ANONYMOUS_QUOTA,
  realtimeSessionCostUsd,
  resolveRealtimeOutputModality,
  validateRealtimeTranslationSessionInputs,
  type RealtimeTranslationCostPolicy,
} from "@wfx/model-fabric";

import type {
  RealtimeProviderSeamFactory,
  RealtimeProviderSessionSeam,
  RealtimeTransportMessage,
} from "./realtime-wire";
import {
  encodeRealtimeWireEvent,
  parseRealtimeWireClientMessage,
} from "./realtime-wire";
import { setRealtimeBridgeStatus } from "./realtime-bridge-state";

// ---------------------------------------------------------------------------
// The bridge's policy defaults (§R25-K — the SHARED policy, injectable)
// ---------------------------------------------------------------------------

/** The default bridge port (the dev boot's 3102). */
export const REALTIME_BRIDGE_DEFAULT_PORT = 3102;

/** The client-connection resume window (the continuity retention). */
const CLIENT_RESUME_WINDOW_MS = 30_000;

/**
 * THE SCRIPTED CLIENT NETWORK BLIP (the dev double's client-side
 * interruption — the symmetric twin of the scripted provider drop):
 * once per session, after this much live streaming, the bridge closes
 * the CLIENT connection abruptly. The client's reconnect loop, the
 * resume token, the continuity cursor, and the measured reconnect
 * time are ALL the real machinery — only the interruption itself is
 * the modeled network event (the same honesty as the provider drop).
 */
const SCRIPTED_CLIENT_BLIP_AFTER_MS = 24_000;

/**
 * The bridge's session budget ceiling (§R25-K's budget limit — the
 * shared policy's `maxSessionCostUsd`; the DEV prototype's ceiling).
 */
const DEFAULT_SESSION_BUDGET_USD = 1.0;

// ---------------------------------------------------------------------------
// The session records
// ---------------------------------------------------------------------------

/** One bridge session's full state (continuity + policy + telemetry). */
interface BridgeSession {
  /** The DOMAIN session id (the bridge's routing key — one id, one truth). */
  readonly sessionId: string;
  readonly resumeToken: string;
  readonly inputs: RealtimeTranslationSessionInputs;
  /** The shared cost policy the session runs under. */
  costPolicy: RealtimeTranslationCostPolicy;
  /** The effective modality after the shared resolution (§R25-K). */
  effectiveOutputModality: "text" | "text-and-audio";
  /** "anonymous" or "viewer:<token>" (opaque — the quota key). */
  readonly viewerKey: string;
  /** The provider session seam (the frozen domain port + extras). */
  seam: RealtimeProviderSessionSeam;
  client: WsServerSocket | null;
  /** The last committed source segment (the resume cursor — the domain segment ids). */
  lastCommittedSegmentId: string;
  readonly createdWallMs: number;
  ended: boolean;
  /** Usage totals (the domain token truth, accumulated for the policy verdicts). */
  usage: RealtimeSessionUsage;
  /** The bridge-side markers (telemetry). */
  readonly markers: { readonly marker: string; readonly atMs: number }[];
  /** The continuity expiry timer (the client-disconnect retention window). */
  continuityTimer: ReturnType<typeof setTimeout> | null;
  /** The duration-cap timer (the shared policy's session limit). */
  capTimer: ReturnType<typeof setTimeout> | null;
  /** The scripted client network blip timer (the dev double's interruption). */
  blipTimer: ReturnType<typeof setTimeout> | null;
  /** Whether the scripted client blip already fired (once per session). */
  clientBlipped: boolean;
  /** The detached relay task (the event pump's stop signal). */
  relayStopped: boolean;
}

/** The per-connection routing state (ws → the session binding + viewer truth). */
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
   * The provider session seam factory (the shared domain port). Absent
   * in the service boot until the fabric route lands — the bridge
   * answers the honest typed refusal (never a fixture fallback).
   */
  readonly providerSeamFactory?: RealtimeProviderSeamFactory | null;
  /** §R25-K policy overrides (tests). */
  readonly sessionBudgetUsd?: number;
  readonly anonymousMaxSessionDurationMs?: number;
  /** Allowed browser origins for the WS upgrade (absent Origin headers — non-browser tooling — pass). */
  readonly allowedOrigins?: readonly string[];
}

/** The running bridge handle. */
export interface RealtimeBridgeHandle {
  readonly port: number;
  readonly url: string;
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
  const sessionBudgetUsd = options.sessionBudgetUsd ?? DEFAULT_SESSION_BUDGET_USD;
  const anonymousMaxSessionDurationMs =
    options.anonymousMaxSessionDurationMs ?? DEFAULT_REALTIME_ANONYMOUS_QUOTA.maxSessionDurationMs;
  const allowedOrigins =
    options.allowedOrigins ?? ["http://localhost:3101", "http://127.0.0.1:3101"];

  const sessions = new Map<string, BridgeSession>();
  /** The ENDED sessions' telemetry records (the retention seam — readable after close). */
  const endedTelemetry: {
    readonly sessionId: string;
    readonly viewer: string;
    readonly targetLanguage: string;
    readonly effectiveOutputModality: string;
    readonly startedAtWallMs: number;
    readonly lastCommittedSegmentId: string;
    readonly usage: RealtimeSessionUsage;
    readonly derivedCostUsd: number;
    readonly markers: readonly { readonly marker: string; readonly atMs: number }[];
    readonly ended: { readonly reason: string; readonly atWallMs: number } | null;
  }[] = [];
  const clientTelemetry: ClientTelemetryAppend[] = [];

  const factory = options.providerSeamFactory ?? null;

  /** The CORS headers for the telemetry seam (read + append; no credentials). */
  const telemetryCors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  /** Record one bridge-side marker (telemetry). */
  const mark = (session: BridgeSession, marker: string): void => {
    session.markers.push({ marker, atMs: Date.now() });
  };

  /** Send one transport envelope message to the session's client (when attached). */
  const sendTransport = (session: BridgeSession, message: RealtimeTransportMessage): void => {
    if (session.client === null || session.client.readyState !== WsServerSocket.OPEN) return;
    try {
      session.client.send(JSON.stringify(message));
    } catch {
      // A dead client socket is the disconnect path's business, not a crash.
    }
  };

  /** Relay one domain event to the session's client (the wire encoding). */
  const relayEvent = (session: BridgeSession, event: RealtimeTranslationEvent): void => {
    if (session.client === null || session.client.readyState !== WsServerSocket.OPEN) return;
    try {
      session.client.send(JSON.stringify({ event: encodeRealtimeWireEvent(event) }));
    } catch {
      // The disconnect path's business, never a crash.
    }
  };

  /** The event pump: consume the domain session's stream until it ends. */
  const pumpEvents = (session: BridgeSession): void => {
    void (async () => {
      try {
        for await (const event of session.seam.session.events()) {
          if (session.relayStopped || session.ended) return;
          // The usage/cost accumulation (the domain token truth).
          if (event.kind === "usage-telemetry") {
            session.usage = {
              inputAudioTokens: session.usage.inputAudioTokens + event.usage.inputAudioTokens,
              textOutputTokens: session.usage.textOutputTokens + event.usage.textOutputTokens,
              outputAudioTokens: session.usage.outputAudioTokens + event.usage.outputAudioTokens,
              imageInputTokens: session.usage.imageInputTokens + event.usage.imageInputTokens,
            };
          }
          if (event.kind === "source-transcript-final") {
            session.lastCommittedSegmentId = event.segmentId;
          }
          // The §R25-K audio-output filter: the shared modality resolution
          // says text-only → the audio chunks never reach the client (the
          // automatic text-only fallback, visible through the policy
          // reason the session-bound ack carried).
          if (
            event.kind === "translated-audio-chunk" &&
            session.effectiveOutputModality !== "text-and-audio"
          ) {
            continue;
          }
          relayEvent(session, event);
          // The §R25-K budget verdict: the shared policy evaluation on the
          // accumulated usage (degrade to text-only when the budget is
          // gone — the session continues as text; the shared
          // never-block-playback law holds).
          if (event.kind === "usage-telemetry") {
            const resolution = resolveRealtimeOutputModality({
              policy: { ...session.costPolicy, requestedOutputModality: session.costPolicy.requestedOutputModality },
              usageSoFar: session.usage,
            });
            if (
              session.effectiveOutputModality === "text-and-audio" &&
              resolution.outputModality === "text"
            ) {
              session.effectiveOutputModality = "text";
              mark(session, "audio-downgraded");
              relayEvent(session, {
                kind: "recoverable-error",
                sessionId: session.sessionId,
                occurredAt: new Date().toISOString(),
                errorKind: "policy",
                detail: `translated speech stopped by the cost policy (${resolution.reason})`,
                recovery: "The translation continues as text; original captions remain available.",
              });
            }
          }
        }
      } catch {
        // The stream ending (the provider session's own close path) — the
        // session's terminal events already relayed; nothing more to do.
      }
    })();
  };

  /** Close a session for a domain reason (the single end path). */
  const closeSession = (
    session: BridgeSession,
    reason: "user-stop" | "user-close" | "terminal-error" | "policy" | "provider-closed",
    _detail: string,
  ): void => {
    if (session.ended) return;
    session.ended = true;
    session.relayStopped = true;
    if (session.capTimer !== null) clearTimeout(session.capTimer);
    if (session.continuityTimer !== null) clearTimeout(session.continuityTimer);
    if (session.blipTimer !== null) clearTimeout(session.blipTimer);
    mark(session, "session-closed");
    // THE RETENTION SEAM: the ended session's telemetry record survives
    // (readable through GET /telemetry after the close — the J41-style
    // server seam law; continuity state alone, never raw media).
    endedTelemetry.push({
      sessionId: session.sessionId,
      viewer: session.viewerKey === "anonymous" ? "anonymous" : "authenticated",
      targetLanguage: session.inputs.targetLanguage,
      effectiveOutputModality: session.effectiveOutputModality,
      startedAtWallMs: session.createdWallMs,
      lastCommittedSegmentId: session.lastCommittedSegmentId,
      usage: session.usage,
      derivedCostUsd: realtimeSessionCostUsd(session.usage),
      markers: [...session.markers],
      ended: { reason, atWallMs: Date.now() },
    });
    // The domain close event (the frozen vocabulary).
    relayEvent(session, {
      kind: "session-closed",
      sessionId: session.sessionId,
      occurredAt: new Date().toISOString(),
      reason,
    });
    void session.seam.session.close().catch(() => undefined);
    sessions.delete(session.sessionId);
  };

  /** Start one session (the start operation's handler). */
  const startSession = (
    ws: WsServerSocket,
    inputs: RealtimeTranslationSessionInputs,
    viewerKey: string,
    socketState: BridgeSocketState,
  ): void => {
    if (factory === null) {
      ws.send(
        JSON.stringify({
          transport: "refused",
          errorKind: "provider-failure",
          detail: "no realtime translation provider is registered on this host",
          recovery: "A registered Model-Fabric realtime provider serves this lane in service mode — check Model & AI settings.",
        } satisfies RealtimeTransportMessage),
      );
      return;
    }
    // THE SHARED VALIDATION (Worker 1's fail-closed gates — the
    // legal-audio gate + the consent gate included, verbatim).
    const validation = validateRealtimeTranslationSessionInputs(inputs);
    if (!validation.ok) {
      ws.send(
        JSON.stringify({
          transport: "refused",
          errorKind: "policy",
          detail: `the session inputs were refused: ${validation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; ")}`,
          recovery: "Choose a way of watching whose audio WebFlix can lawfully reach, or adjust the requested mode.",
        } satisfies RealtimeTransportMessage),
      );
      return;
    }
    // The requested modality → the SHARED resolution (§R25-K: the
    // automatic text-only fallback with the honest reason).
    const requestedPolicy: RealtimeTranslationCostPolicy = {
      requestedOutputModality: inputs.outputModality,
      maxSessionCostUsd: sessionBudgetUsd,
      ...(viewerKey === "anonymous"
        ? {
            anonymousQuota: {
              maxSessionDurationMs: anonymousMaxSessionDurationMs,
              basis: DEFAULT_REALTIME_ANONYMOUS_QUOTA.basis,
            },
          }
        : {}),
      autoFallbackToTextOnly: true,
    };
    const modality = resolveRealtimeOutputModality({
      policy: requestedPolicy,
      usageSoFar: {
        inputAudioTokens: 0,
        textOutputTokens: 0,
        outputAudioTokens: 0,
        imageInputTokens: 0,
      },
    });
    const effectiveInputs: RealtimeTranslationSessionInputs = {
      ...inputs,
      outputModality: modality.outputModality,
    };
    const durationLimitMs =
      viewerKey === "anonymous" ? anonymousMaxSessionDurationMs : anonymousMaxSessionDurationMs * 2;
    void factory
      .open(effectiveInputs)
      .then((outcome) => {
        if ("ok" in outcome) {
          ws.send(
            JSON.stringify({
              transport: "refused",
              errorKind: outcome.errorKind,
              detail: outcome.detail,
              recovery: outcome.recovery,
            } satisfies RealtimeTransportMessage),
          );
          return;
        }
        const seam: RealtimeProviderSessionSeam = outcome;
        const sessionId = seam.session.sessionId;
        const resumeToken = `wfxres_${Math.random().toString(36).slice(2, 14)}`;
        const session: BridgeSession = {
          sessionId,
          resumeToken,
          inputs: effectiveInputs,
          costPolicy: requestedPolicy,
          effectiveOutputModality: modality.outputModality,
          viewerKey,
          seam,
          client: ws,
          lastCommittedSegmentId: "",
          createdWallMs: Date.now(),
          ended: false,
          usage: { inputAudioTokens: 0, textOutputTokens: 0, outputAudioTokens: 0, imageInputTokens: 0 },
          markers: [{ marker: "session-created", atMs: Date.now() }],
          continuityTimer: null,
          capTimer: null,
          blipTimer: null,
          clientBlipped: false,
          relayStopped: false,
        };
        sessions.set(sessionId, session);
        socketState.sessionId = sessionId;
        // THE PROVIDER-DROP RECOVERY (the domain reconnect operation): the
        // seam enters 'reconnecting' (a recoverable provider disconnect)
        // → the bridge drives 'reconnect' (legal only from that state) →
        // the transport recovery confirmation relays when it re-streams.
        seam.onStateChange((state) => {
          if (session.ended) return;
          if (state === "reconnecting") {
            mark(session, "provider-disconnected");
            void seam.session.reconnect().catch(() => undefined);
          }
          if (state === "streaming") {
            if (session.markers.some((entry) => entry.marker === "provider-disconnected")) {
              mark(session, "provider-reconnected");
              sendTransport(session, {
                transport: "session-resumed",
                sessionId,
                recovered: "provider-connection",
                lastCommittedSegmentId: session.lastCommittedSegmentId,
              });
            }
          }
        });
        // THE TRANSPORT ACK (the bridge's own management facts): the
        // resume token + the SHARED policy's truths + the honest
        // source-stream truth (the fixtures double, loudly labeled).
        sendTransport(session, {
          transport: "session-bound",
          sessionId,
          resumeToken,
          sourceStream: "scripted-dev-double",
          policy: {
            effectiveOutputModality: modality.outputModality,
            degradedFromRequested: modality.degradedFromRequested,
            modalityReason: modality.reason,
            maxSessionDurationMs: durationLimitMs,
            durationBasis:
              viewerKey === "anonymous"
                ? DEFAULT_REALTIME_ANONYMOUS_QUOTA.basis
                : "the signed-in session limit (twice the anonymous quota)",
          },
          envelope: { reportedAverageLagMs: factory.reportedAverageLagMs },
        });
        // Start the domain session + pump its events.
        void seam.session
          .start()
          .then(() => {
            pumpEvents(session);
            // §R25-K — the duration limit (a typed close, never a playback block).
            session.capTimer = setTimeout(() => {
              if (session.ended) return;
              closeSession(
                session,
                "policy",
                `the session reached its ${Math.round(durationLimitMs / 1000)}s duration limit (the cost policy)`,
              );
            }, durationLimitMs);
            // THE SCRIPTED CLIENT NETWORK BLIP (the dev double's
            // client-side interruption — once, after the stream has
            // run long enough for the journey to have observed the
            // speaker change + the translated speech).
            session.blipTimer = setTimeout(() => {
              if (session.ended || session.clientBlipped || session.client === null) return;
              session.clientBlipped = true;
              mark(session, "client-blip");
              // The abrupt close (a network-like drop — the client's
              // reconnect loop + the resume run for real).
              session.client.terminate();
            }, SCRIPTED_CLIENT_BLIP_AFTER_MS);
          })
          .catch(() => {
            if (session.ended) return;
            closeSession(session, "terminal-error", "the provider session could not start");
          });
      })
      .catch(() => {
        ws.send(
          JSON.stringify({
            transport: "refused",
            errorKind: "provider-failure",
            detail: "the provider session could not be created",
            recovery: "Try starting the translation again.",
          } satisfies RealtimeTransportMessage),
        );
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
          provider: factory === null ? null : { id: factory.providerId, detail: factory.providerDetail },
          sessions: [...sessions.values()].map((session) => ({
            sessionId: session.sessionId,
            viewer: session.viewerKey === "anonymous" ? "anonymous" : "authenticated",
            targetLanguage: session.inputs.targetLanguage,
            effectiveOutputModality: session.effectiveOutputModality,
            startedAtWallMs: session.createdWallMs,
            lastCommittedSegmentId: session.lastCommittedSegmentId,
            usage: session.usage,
            derivedCostUsd: realtimeSessionCostUsd(session.usage),
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
    const parsed = parseRealtimeWireClientMessage(message);
    const socketState = socketStates.get(ws);
    if (socketState === undefined) {
      return;
    }
    if (parsed.op === "invalid") {
      ws.send(
        JSON.stringify({
          transport: "refused",
          errorKind: "unknown",
          detail: parsed.detail,
          recovery: "",
        } satisfies RealtimeTransportMessage),
      );
      return;
    }
    // The viewer key: the opaque wfx_session cookie (absent → the
    // anonymous quota lane; present → the viewer's own policy lane).
    const cookieHeader = socketState.cookieHeader;
    const viewerKey = cookieHeader.includes("wfx_session=")
      ? `viewer:${cookieHeader.split("wfx_session=")[1]?.split(";")[0] ?? ""}`
      : "anonymous";
    if (parsed.op === "start") {
      startSession(ws, parsed.inputs, viewerKey, socketState);
      return;
    }
    const session = sessions.get(parsed.sessionId);
    if (session === undefined || session.ended) {
      ws.send(
        JSON.stringify({
          transport: "refused",
          errorKind: "unknown",
          detail: "this realtime session is unknown or ended",
          recovery: "Start the translation again.",
        } satisfies RealtimeTransportMessage),
      );
      return;
    }
    if (parsed.op === "reconnect") {
      // THE CLIENT RECONNECT (§R25-A reconnect/resume): a retained
      // session re-attaches to a new connection through its resume
      // token; the stream continues from the live cursor.
      if (parsed.resumeToken !== session.resumeToken) {
        ws.send(
          JSON.stringify({
            transport: "refused",
            errorKind: "unknown",
            detail: "the resume token does not match this session",
            recovery: "Start the translation again.",
          } satisfies RealtimeTransportMessage),
        );
        return;
      }
      session.client = ws;
      socketState.sessionId = session.sessionId;
      socketState.cookieHeader = cookieHeader;
      if (session.continuityTimer !== null) {
        clearTimeout(session.continuityTimer);
        session.continuityTimer = null;
      }
      mark(session, "client-reconnected");
      sendTransport(session, {
        transport: "session-resumed",
        sessionId: session.sessionId,
        recovered: "client-connection",
        lastCommittedSegmentId: session.lastCommittedSegmentId,
      });
      return;
    }
    if (parsed.op === "stop" || parsed.op === "close") {
      closeSession(
        session,
        parsed.op === "stop" ? "user-stop" : "user-close",
        parsed.op === "stop"
          ? "the viewer stopped the translation"
          : "the viewer closed the translation session",
      );
      return;
    }
    if (parsed.op === "configure") {
      // The domain configure operation (the shared state legality: idle
      // or streaming) — the modality change re-runs the SHARED policy
      // resolution (§R25-K).
      const configuration = parsed.configuration;
      if (configuration.outputModality !== undefined) {
        const resolution = resolveRealtimeOutputModality({
          policy: { ...session.costPolicy, requestedOutputModality: configuration.outputModality },
          usageSoFar: session.usage,
        });
        session.effectiveOutputModality = resolution.outputModality;
        session.costPolicy = {
          ...session.costPolicy,
          requestedOutputModality: configuration.outputModality,
        };
        void session.seam.session
          .configure({ ...configuration, outputModality: resolution.outputModality })
          .catch(() => undefined);
      } else {
        void session.seam.session.configure(configuration).catch(() => undefined);
      }
      return;
    }
    if (parsed.op === "append-audio") {
      // The production capture path's relay (never stored — §R25-D).
      void session.seam.session
        .appendAudio({
          audio: Buffer.from(parsed.audioBase64, "base64"),
          ...(parsed.mediaPositionMs !== undefined ? { mediaPositionMs: parsed.mediaPositionMs } : {}),
        })
        .catch(() => undefined);
      return;
    }
    if (parsed.op === "append-image-frame") {
      // The never-force law: image frames are appended ONLY under an
      // 'adaptive' visual-context policy (the shared state legality).
      if (session.inputs.visualContextPolicy !== "adaptive") {
        ws.send(
          JSON.stringify({
            transport: "refused",
            errorKind: "policy",
            detail: "this session's visual-context policy is 'off' — image frames are never forced",
            recovery: "",
          } satisfies RealtimeTransportMessage),
        );
        return;
      }
      void session.seam.session
        .appendImageFrame({
          frame: Buffer.from(parsed.frameBase64, "base64"),
          ...(parsed.mediaPositionMs !== undefined ? { mediaPositionMs: parsed.mediaPositionMs } : {}),
        })
        .catch(() => undefined);
      return;
    }
  };

  /** The bridge's close handler (the continuity window's entry). */
  const handleClose = (ws: WsServerSocket): void => {
    const socketState = socketStates.get(ws);
    const sessionId = socketState?.sessionId ?? null;
    if (sessionId === null) return;
    const session = sessions.get(sessionId);
    if (session === undefined || session.ended) return;
    if (session.client !== ws) return;
    // THE CONTINUITY WINDOW: the session is retained for the resume;
    // an unresumed session closes (policy) after it.
    session.client = null;
    mark(session, "client-disconnected");
    if (session.continuityTimer !== null) clearTimeout(session.continuityTimer);
    session.continuityTimer = setTimeout(() => {
      if (session.ended) return;
      closeSession(session, "policy", "the connection was not re-established within the resume window");
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
        closeSession(session, "provider-closed", "the bridge is shutting down");
      }
      sessions.clear();
      endedTelemetry.length = 0;
      clientTelemetry.length = 0;
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
    },
  };
}
