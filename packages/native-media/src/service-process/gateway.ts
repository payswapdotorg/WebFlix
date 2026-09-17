/**
 * @wfx/native-media — the PRODUCTION range gateway (R10).
 *
 * The local HTTP media server: a REAL `Bun.serve` listener on the
 * loopback (`127.0.0.1`, an ephemeral kernel-assigned port by default or
 * a configured one) serving `GET /media/<assetId>` with full byte-range
 * semantics — 200/206/304/416/404/405, `Range`/`If-None-Match` parsing,
 * deterministic `ETag`s, `Content-Range` — over the REAL stored asset
 * bytes. It is built from the PURE pieces of `gateway/server.ts` (the
 * transport-agnostic verdict stage) plus the REAL engine's range-access
 * extension; `gateway/test-server.ts` (the simulation-backed TEST
 * binding) remains TEST/DEV-only and is never imported here (enforced by
 * the production import-guard test).
 *
 * Differences from the TEST gateway, all production-motivated:
 * - The engine is the REAL engine (`RealEngine`) — bytes come off the
 *   disk through real range reads, never a synthetic pattern.
 * - The asset map is LIVE: it is seeded from the asset store at start
 *   and grows as the store persists new assets (background completion
 *   makes an asset servable the moment it lands — no restart needed).
 *   The pure server resolves paths per request against the map it was
 *   handed, so a live Map is honored without touching its frozen code.
 * - The piece geometry passed to the pure server (for its deadline-aware
 *   pull hint) is derived per asset from the store metadata with the
 *   SAME formula the engine uses (`max(1, floor(size / readChunkBytes))`).
 *
 * Loopback + port policy (documented): the listener binds `127.0.0.1`
 * ONLY (never `0.0.0.0` — local media serving is not a network service),
 * `port: 0` asks the kernel for an ephemeral port (tests and the default;
 * the actual port is reported on the handle and written to
 * `engine-info.json` under the store root so a spawner can discover it),
 * and a configured port is used verbatim (a bind failure fails startup
 * honestly with a typed error — never a silent retry on another port).
 */

import { NativeMediaError } from "../errors";
import {
  createGatewayServer,
  type GatewayAssetSpec,
  type GatewayHttpResponse,
  type GatewayOptions,
  type GatewayServer,
} from "../gateway/server";
import type { RealEngine } from "./engine";
import { NOMINAL_PIECE_BYTES } from "../scheduler/model";

// ---------------------------------------------------------------------------
// Options + handle
// ---------------------------------------------------------------------------

/** Options for {@link startProductionGateway}. */
export interface ProductionGatewayOptions {
  /**
   * The port to bind. `0` (the default) asks the kernel for an ephemeral
   * port — the actual port is on the handle.
   */
  readonly port?: number;
  /** The bind hostname. Default `127.0.0.1` (loopback ONLY, by law). */
  readonly hostname?: string;
  /** Extra options forwarded to the pure gateway server (deadlines, idle sweep...). */
  readonly gateway?: GatewayOptions;
}

/** The running production gateway. */
export interface ProductionGatewayHandle {
  /** The ACTUAL bound port (kernel-assigned when `0` was requested). */
  readonly port: number;
  /** The bind hostname (loopback). */
  readonly hostname: string;
  /** `http://<hostname>:<port>` — the base URL for media fetches. */
  readonly baseUrl: string;
  /** The URL path one asset is served at: `/media/<assetId>`. */
  assetUrl(assetId: string): string;
  /** The LIVE asset map (entries appear as the store persists assets). */
  readonly assets: Map<string, GatewayAssetSpec>;
  /** The pure gateway server (idle sweeps, session counts). */
  readonly server: GatewayServer;
  /** Stop the listener and close every gateway session. Idempotent. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Start the production range gateway over the REAL engine and its asset
 * store: a loopback `Bun.serve` listener serving `/media/<assetId>` with
 * Range/ETag/416 semantics over the real stored bytes. Throws a typed
 * `IO_ERROR` when the configured port cannot be bound — never a silent
 * fallback port.
 */
export function startProductionGateway(
  engine: RealEngine,
  options: ProductionGatewayOptions = {},
): ProductionGatewayHandle {
  if (typeof options !== "object" || options === null) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "startProductionGateway: options must be an object",
    });
  }
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: `startProductionGateway: port must be 0..65535 (got ${String(port)})`,
    });
  }
  const hostname = options.hostname ?? "127.0.0.1";
  if (typeof hostname !== "string" || hostname.trim().length === 0) {
    throw new NativeMediaError("INVALID_INPUT", {
      detail: "startProductionGateway: hostname must be a non-empty string",
    });
  }

  // The LIVE asset map: seeded from the store, grown by the service host
  // as assets persist. The pure server resolves per request, so a Map
  // handed to it stays live without any frozen-code change.
  const assets = new Map<string, GatewayAssetSpec>();
  for (const meta of engine.store.listAssets()) {
    assets.set(mediaPath(meta.assetId), specFor(engine, meta.assetId, meta.sizeBytes));
  }

  const server = createGatewayServer(engine, {
    ...(options.gateway ?? {}),
    assets,
  });

  let http: ReturnType<typeof Bun.serve>;
  let boundPort: number;
  try {
    http = Bun.serve({
      port,
      hostname,
      idleTimeout: 30,
      fetch(request: Request): Promise<Response> {
        return handleHttp(request, server);
      },
    });
    const reported = http.port;
    if (reported === undefined || !Number.isSafeInteger(reported)) {
      void http.stop(true);
      throw new NativeMediaError("IO_ERROR", {
        detail: "startProductionGateway: the listener did not report a bound port",
      });
    }
    boundPort = reported;
  } catch (e) {
    if (e instanceof NativeMediaError) throw e;
    throw new NativeMediaError("IO_ERROR", {
      detail: `startProductionGateway: binding ${hostname}:${port} failed: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }

  let stopped = false;
  return {
    port: boundPort,
    hostname,
    baseUrl: `http://${hostname}:${boundPort}`,
    assetUrl(assetId: string) {
      return mediaPath(assetId);
    },
    assets,
    server,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      await http.stop(true);
      await server.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The URL path one asset is served at. */
function mediaPath(assetId: string): string {
  return `/media/${assetId}`;
}

/**
 * The gateway asset spec for one stored asset: the REAL content path as
 * the engine source, plus the piece geometry derived with the engine's
 * formula (so the pure server's deadline-aware pull hint addresses the
 * same pieces the engine reads).
 */
function specFor(
  engine: RealEngine,
  assetId: string,
  sizeBytes: number,
): GatewayAssetSpec {
  return {
    source: { localPath: engine.store.contentPath(assetId) },
    pieceCount: Math.max(1, Math.floor(sizeBytes / NOMINAL_PIECE_BYTES)),
  };
}

// ---------------------------------------------------------------------------
// HTTP glue (Request -> GatewayHttpRequest, GatewayHttpResponse -> Response)
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
