/**
 * @wfx/native-media — gateway TEST server (WFX-015, Lane B).
 *
 * ⚠️ TEST INFRASTRUCTURE — NEVER PRODUCTION. ⚠️
 *
 * `startTestGateway(port)` binds the WFX-015 transport-agnostic gateway
 * handler (`createGatewayServer`) to a REAL minimal HTTP server
 * (`Bun.serve` — a bun builtin, zero new dependencies) over a
 * SIMULATION-ENGINE-backed in-memory asset store:
 *
 * - Assets are DETERMINISTIC SYNTHETIC byte patterns: the WFX-014
 *   simulation's pure content generator (`simulatedByte(seed, i)`, seed
 *   derived from the registry key = the URL path) — so integration tests
 *   verify bodies BYTE-EXACT without storing any bytes.
 * - The engine is wrapped in a thin RECORDING wrapper (delegation + a
 *   call trace + read/stat failure hooks), giving tests an observable
 *   engine trace for deadline-aware-pull and idle-close assertions —
 *   without touching the frozen simulation engine.
 * - The handle exposes the gateway (`sweepIdleSessions`, session count)
 *   and the recording engine for direct assertions, plus `stop()` for a
 *   clean teardown (server + gateway sessions + simulation timers).
 *
 * Used by `packages/native-media/tests/gateway.test.ts`. Nothing in this
 * module is ever wired as production: binding the gateway to the REAL
 * engine process is a later integration step.
 */

import {
  createSimulationEngine,
  type SimulatedAsset,
  type SimulationConfig,
  type SimulationEngine,
  type SimulationUpdateListener,
} from "../engine/simulation";

import {
  createGatewayServer,
  type GatewayHttpResponse,
  type GatewayOptions,
  type GatewayServer,
} from "./server";

// ---------------------------------------------------------------------------
// Test assets
// ---------------------------------------------------------------------------

/** One synthetic test asset: registered by URL path == engine localPath. */
export interface TestGatewayAsset {
  /** URL path the asset is served at (also the simulation registry key). */
  path: string;
  /** Total size in bytes (the deterministic pattern spans exactly this). */
  totalBytes: number;
  /** Playback duration in ms (simulation piece-map metadata). */
  durationMs: number;
  /** Number of equal-size pieces (drives the prioritize hint geometry). */
  pieceCount: number;
  /** Content type reported by statMedia / served as Content-Type. */
  contentType: string;
  /** Optional explicit content seed (default: FNV-1a of the path). */
  seed?: number;
}

/** The default synthetic asset set: one video, one audio. */
export const DEFAULT_TEST_ASSETS: readonly TestGatewayAsset[] = [
  {
    path: "/media/test-video.mp4",
    totalBytes: 10_000,
    durationMs: 60_000,
    pieceCount: 10,
    contentType: "video/mp4",
  },
  {
    path: "/media/test-audio.opus",
    totalBytes: 4_096,
    durationMs: 12_000,
    pieceCount: 4,
    contentType: "audio/opus",
  },
];

// ---------------------------------------------------------------------------
// Recording engine wrapper (TEST observability — delegation only)
// ---------------------------------------------------------------------------

/** One recorded state-affecting engine call, in call order. */
export interface RecordedEngineCall {
  /** Monotonic sequence number (1, 2, 3, ...). */
  seq: number;
  /** The engine method name (open/seek/prioritize/pause/resume/close/statMedia/readRange). */
  method: string;
  /** The call arguments verbatim. */
  args: readonly unknown[];
}

/**
 * The recording engine TEST FIXTURE: the simulation engine with a call
 * trace and failure hooks. Pure delegation — no behavior of its own.
 */
export interface RecordingEngine extends SimulationEngine {
  /** Every state-affecting engine call, in order (bookkeeping calls excluded). */
  readonly trace: readonly RecordedEngineCall[];
  /** The wrapped SIMULATION engine (for direct fixture assertions/disposal). */
  readonly simulation: SimulationEngine;
  /** TEST HOOK: while set, every `readRange` rejects with this error. */
  failReads: Error | undefined;
  /** TEST HOOK: while set, every `statMedia` rejects with this error. */
  failStats: Error | undefined;
}

/** Wrap a simulation engine with recording + failure hooks (TEST/DEV only). */
export function wrapRecordingEngine(simulation: SimulationEngine): RecordingEngine {
  const trace: RecordedEngineCall[] = [];
  let seq = 0;
  const record = (method: string, args: readonly unknown[]): void => {
    seq += 1;
    trace.push({ seq, method, args });
  };
  const wrapper: RecordingEngine = {
    isSimulation: true,
    simulation,
    get trace(): readonly RecordedEngineCall[] {
      return trace;
    },
    failReads: undefined,
    failStats: undefined,
    async open(input: {
      magnet?: string;
      torrentBytes?: Uint8Array;
      localPath?: string;
    }) {
      record("open", [input]);
      return simulation.open(input);
    },
    async seek(sessionId: string, positionMs: number) {
      record("seek", [sessionId, positionMs]);
      return simulation.seek(sessionId, positionMs);
    },
    async prioritize(
      sessionId: string,
      deadlines: { piece: number; deadlineMs: number }[],
    ) {
      record("prioritize", [sessionId, deadlines]);
      return simulation.prioritize(sessionId, deadlines);
    },
    async pause(sessionId: string) {
      record("pause", [sessionId]);
      return simulation.pause(sessionId);
    },
    async resume(sessionId: string) {
      record("resume", [sessionId]);
      return simulation.resume(sessionId);
    },
    async close(sessionId: string) {
      record("close", [sessionId]);
      return simulation.close(sessionId);
    },
    async statMedia(sessionId: string) {
      record("statMedia", [sessionId]);
      if (wrapper.failStats !== undefined) {
        throw wrapper.failStats;
      }
      return simulation.statMedia(sessionId);
    },
    async readRange(sessionId: string, startByte: number, endByte: number) {
      record("readRange", [sessionId, startByte, endByte]);
      if (wrapper.failReads !== undefined) {
        throw wrapper.failReads;
      }
      return simulation.readRange(sessionId, startByte, endByte);
    },
    onUpdate(listener: SimulationUpdateListener) {
      // Bookkeeping (no engine-state effect): not recorded.
      return simulation.onUpdate(listener);
    },
    snapshot(sessionId: string) {
      // Bookkeeping (no engine-state effect): not recorded.
      return simulation.snapshot(sessionId);
    },
    dispose() {
      simulation.dispose();
    },
  };
  return wrapper;
}

/** The calls of one method from a trace, in order. */
export function callsOf(
  trace: readonly RecordedEngineCall[],
  method: string,
): readonly RecordedEngineCall[] {
  return trace.filter((call) => call.method === method);
}

// ---------------------------------------------------------------------------
// Test server options + handle
// ---------------------------------------------------------------------------

/** Options for {@link startTestGateway}. */
export interface TestGatewayOptions {
  /** Synthetic asset set. Default: {@link DEFAULT_TEST_ASSETS}. */
  assets?: readonly TestGatewayAsset[];
  /** Throughput/tick overrides for the backing simulation engine. */
  simulation?: Omit<SimulationConfig, "assets">;
  /** Gateway options (clock injection, deadlines, idle timeout, ...). */
  gateway?: GatewayOptions;
}

/** The running test gateway: a real local HTTP server + typed handles. */
export interface TestGatewayHandle {
  /** The actual bound port (useful when `port: 0` auto-assigns). */
  port: number;
  /** Base URL for fetch calls (`http://127.0.0.1:<port>`). */
  baseUrl: string;
  /** The recording engine (trace + failure hooks) — TEST assertions. */
  engine: RecordingEngine;
  /** The gateway server (sweeps, session count) — TEST assertions. */
  gateway: GatewayServer;
  /** The registered synthetic assets. */
  assets: readonly TestGatewayAsset[];
  /** Stop the HTTP server, close gateway sessions, dispose the simulation. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// startTestGateway
// ---------------------------------------------------------------------------

/**
 * Start the TEST gateway (TEST/DEV ONLY — NEVER PRODUCTION): a real
 * `Bun.serve` HTTP server binding the WFX-015 gateway handler over a
 * simulation-engine-backed in-memory asset store with deterministic
 * synthetic byte patterns. `port: 0` auto-assigns a free port (the actual
 * port is on the handle).
 */
export function startTestGateway(
  port: number,
  options: TestGatewayOptions = {},
): TestGatewayHandle {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`startTestGateway: port must be 0..65535 (got ${String(port)})`);
  }
  if (typeof options !== "object" || options === null) {
    throw new Error("startTestGateway: options must be an object");
  }
  const assets: readonly TestGatewayAsset[] = options.assets ?? DEFAULT_TEST_ASSETS;

  // The in-memory asset store: URL path == simulation registry key ==
  // engine localPath. Content is the pure deterministic pattern.
  const registry = new Map<string, SimulatedAsset>();
  const assetSpecs: Record<string, { source: { localPath: string }; pieceCount: number }> = {};
  for (const asset of assets) {
    const simulated: SimulatedAsset = {
      totalBytes: asset.totalBytes,
      durationMs: asset.durationMs,
      pieceCount: asset.pieceCount,
      contentType: asset.contentType,
      ...(asset.seed === undefined ? {} : { seed: asset.seed }),
    };
    registry.set(asset.path, simulated);
    assetSpecs[asset.path] = {
      source: { localPath: asset.path },
      pieceCount: asset.pieceCount,
    };
  }

  const simulation = createSimulationEngine({
    ...(options.simulation ?? {}),
    assets: registry,
  });
  const engine = wrapRecordingEngine(simulation);
  const gateway = createGatewayServer(engine, {
    ...(options.gateway ?? {}),
    assets: assetSpecs,
  });

  const server = Bun.serve({
    port,
    idleTimeout: 10,
    fetch(request: Request): Promise<Response> {
      return handleHttp(request, gateway);
    },
  });

  const boundPort = server.port;
  if (boundPort === undefined) {
    server.stop(true);
    simulation.dispose();
    throw new Error("startTestGateway: the HTTP server did not report a bound port");
  }

  let stopped = false;
  return {
    port: boundPort,
    baseUrl: `http://127.0.0.1:${boundPort}`,
    engine,
    gateway,
    assets,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await server.stop(true);
      await gateway.dispose();
      simulation.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP glue: Request -> GatewayHttpRequest, GatewayHttpResponse -> Response
// ---------------------------------------------------------------------------

/** Normalize a web-standard Request into the transport-agnostic shape. */
async function handleHttp(
  request: Request,
  gateway: GatewayServer,
): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    // Repeated header lines combine with commas — two `Range` lines then
    // parse as a multi-range and answer the typed scope cut (never silent).
    headers[lower] = lower in headers ? `${headers[lower]},${value}` : value;
  });
  const response = await gateway.handle({
    method: request.method,
    path: url.pathname,
    headers,
  });
  return serialize(response);
}

/** Serialize a typed gateway response into a web-standard Response. */
function serialize(response: GatewayHttpResponse): Response {
  const headers = new Headers(response.headers);
  if (response.body === undefined) {
    return new Response(undefined, { status: response.status, headers });
  }
  // The DOM lib's BodyInit demands an ArrayBuffer-backed view (TS 5.9
  // TypedArray generics); gateway bodies are always freshly allocated by
  // engine range reads, so this narrowing cast is copy-free and sound.
  const body = response.body as Uint8Array<ArrayBuffer>;
  return new Response(body, { status: response.status, headers });
}
