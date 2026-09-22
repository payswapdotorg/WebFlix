/**
 * @wfx/app-web — the R25 realtime-bridge BOOT (R25-D's dev-boot path).
 *
 * THE ONE-BRIDGE LAW: one bridge per process, started idempotently
 * (the globalThis boot promise — the Turbopack per-route module-graph
 * doctrine means instrumentation's module instance and a route's instance
 * may differ; the global object is the ONE shared truth).
 *
 * THE ENV GATE (the honest boot split, the R23 lesson honored):
 * - `WFX_DEV_FIXTURES=1` (the documented dev boot) starts the bridge +
 *   the deterministic dev provider double (dynamically imported — the
 *   production graph never statically reaches the provider double);
 * - `WFX_REALTIME_BRIDGE=1` (the lead's custom deployment verification)
 *   starts the bridge with NO provider factory — the honest typed
 *   no-realtime-provider-registered gap until the fabric route lands;
 * - anything else (the default service/serverless boot) starts NOTHING —
 *   the realtime route view renders the honest bridge-unavailable truth
 *   (the Vercel WebSocket-function deployment is the lead's R25 lane).
 */

import type { RealtimeBridgeStatus } from "./realtime-bridge-state";
import { readRealtimeBridgeStatus, setRealtimeBridgeStatus } from "./realtime-bridge-state";

/** The dev boot's fixed bridge port (overridable for parallel local runs). */
export const REALTIME_BRIDGE_PORT = Number(process.env.WFX_REALTIME_BRIDGE_PORT ?? 3102);

/** The dev boot's fixed dev-provider port. */
export const DEV_REALTIME_PROVIDER_PORT = Number(process.env.WFX_DEV_REALTIME_PROVIDER_PORT ?? 3103);

/** The globalThis boot-guard key (one process, one boot). */
const BOOT_KEY = "__wfxRealtimeBridgeBoot";

type BootGlobal = typeof globalThis & {
  [BOOT_KEY]?: Promise<RealtimeBridgeStatus> | null;
};

/** Whether the environment wants the bridge at all (the honest gate). */
export function realtimeBridgeEnabledForThisBoot(): boolean {
  return process.env.WFX_REALTIME_BRIDGE === "1" || process.env.WFX_DEV_FIXTURES === "1";
}

/**
 * Ensure the bridge is booted (idempotent; the instrumentation hook and
 * the lazy capability route share this one path). Answers the bridge's
 * status truth — running or the honest absent state.
 */
export async function ensureRealtimeBridgeBooted(): Promise<RealtimeBridgeStatus> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    // A build pass never starts servers.
    return readRealtimeBridgeStatus();
  }
  if (!realtimeBridgeEnabledForThisBoot()) {
    setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
    return readRealtimeBridgeStatus();
  }
  const existing = (globalThis as BootGlobal)[BOOT_KEY];
  if (existing !== undefined && existing !== null) {
    return existing;
  }
  const boot = (async (): Promise<RealtimeBridgeStatus> => {
    try {
      if (process.env.WFX_DEV_FIXTURES === "1") {
        // The fixtures boot: the bridge + the deterministic dev provider
        // double (the dynamic imports keep the provider out of every
        // static graph — the R23 lesson).
        const providerModule = await import("./dev-realtime-provider");
        const devProvider = providerModule.startDevRealtimeProvider({
          port: DEV_REALTIME_PROVIDER_PORT,
        });
        const sessionModule = await import("./dev-realtime-session");
        const factory = sessionModule.createDevRealtimeSeam(devProvider.url);
        const bridgeModule = await import("./realtime-bridge");
        bridgeModule.startRealtimeBridge({
          port: REALTIME_BRIDGE_PORT,
          providerSeamFactory: factory,
        });
      } else {
        // The explicit service-side boot: the bridge WITHOUT a provider
        // factory — the honest typed gap (never a silent fixture).
        const bridgeModule = await import("./realtime-bridge");
        bridgeModule.startRealtimeBridge({ port: REALTIME_BRIDGE_PORT });
      }
      return readRealtimeBridgeStatus();
    } catch (error) {
      // A failed boot is the honest absent state — the surfaces render
      // the typed unavailability; playback is never touched.
      setRealtimeBridgeStatus({ running: false, port: null, provider: null, targetLanguages: [] });
      return {
        running: false,
        port: null,
        provider: null,
        targetLanguages: [],
        ...(error instanceof Error ? { note: `the bridge boot failed: ${error.message}` } : {}),
      };
    }
  })();
  (globalThis as BootGlobal)[BOOT_KEY] = boot;
  return boot;
}
