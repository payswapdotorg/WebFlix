/**
 * @wfx/app-web — the R37 livechat-bridge BOOT (the R25-D realtime-boot
 * law, followed verbatim).
 *
 * THE ONE-BRIDGE LAW: one livechat bridge per process, started
 * idempotently (the globalThis boot promise — the Turbopack per-route
 * module-graph doctrine means instrumentation's module instance and a
 * route's instance may differ; the global object is the ONE shared
 * truth).
 *
 * THE ENV GATE (the honest boot split, the R23 lesson honored):
 * - `WFX_DEV_FIXTURES=1` (the documented dev boot) starts the bridge +
 *   the deterministic dev chat double (the live fixture entries injected
 *   as the item lookup — through dynamic imports the service graph
 *   never statically reaches);
 * - `WFX_LIVECHAT_BRIDGE=1` (the lead's custom deployment verification)
 *   starts the bridge with NO item lookup — every join answers the
 *   honest `unknown-item` refusal until a real live catalog seam lands;
 * - anything else (the default service/serverless boot) starts NOTHING —
 *   the live-chat surfaces render the honest typed bridge-unavailable
 *   truth.
 *
 * A build pass never starts servers (NEXT_PHASE). A failed boot is the
 * honest absent state — never a crash of the web host itself.
 */

import type { LiveChatBridgeStatus } from "./livechat-bridge-state";
import { readLiveChatBridgeStatus, setLiveChatBridgeStatus } from "./livechat-bridge-state";

/** The dev boot's fixed livechat bridge port (overridable for parallel local runs). */
export const LIVECHAT_BRIDGE_PORT = Number(process.env.WFX_LIVECHAT_BRIDGE_PORT ?? 3104);

/** The globalThis boot-guard key (one process, one boot). */
const BOOT_KEY = "__wfxLiveChatBridgeBoot";

type BootGlobal = typeof globalThis & {
  [BOOT_KEY]?: Promise<LiveChatBridgeStatus> | null;
};

/** Whether the environment wants the livechat bridge at all (the honest gate). */
export function liveChatBridgeEnabledForThisBoot(): boolean {
  return process.env.WFX_LIVECHAT_BRIDGE === "1" || process.env.WFX_DEV_FIXTURES === "1";
}

/**
 * The fixtures boot's item lookup: the LIVE FIXTURE ENTRIES injected as
 * the bridge's catalog seam (the dynamic import keeps the fixture
 * closure — PGlite and the BYOF machinery — out of every static graph;
 * the R23 lesson). The designation derives through the connector layer's
 * ONE derivation (the surfaces' truth, never guessed).
 */
async function createFixtureItemLookup(): Promise<
  import("./livechat-bridge").LiveChatBridgeItemLookup
> {
  const fixtures = await import("@/host/byof/byof-fixtures");
  const entries = fixtures.LIVE_FIXTURE_ENTRIES;
  return {
    item(externalRef) {
      const entry = fixtures.liveFixtureEntryOf(externalRef);
      if (entry === null) return null;
      return {
        title: entry.title,
        designation: fixtures.liveFixtureDesignationOf(entry),
      };
    },
    refs() {
      return entries.map((entry) => entry.externalRef);
    },
  };
}

/**
 * Ensure the livechat bridge is booted (idempotent; the instrumentation
 * hook and any lazy route share this one path). Answers the bridge's
 * status truth — running or the honest absent state.
 */
export async function ensureLiveChatBridgeBooted(): Promise<LiveChatBridgeStatus> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    // A build pass never starts servers.
    return readLiveChatBridgeStatus();
  }
  if (!liveChatBridgeEnabledForThisBoot()) {
    setLiveChatBridgeStatus({ running: false, port: null, provider: null });
    return readLiveChatBridgeStatus();
  }
  const existing = (globalThis as BootGlobal)[BOOT_KEY];
  if (existing !== undefined && existing !== null) {
    return existing;
  }
  const boot = (async (): Promise<LiveChatBridgeStatus> => {
    try {
      const bridgeModule = await import("./livechat-bridge");
      if (process.env.WFX_DEV_FIXTURES === "1") {
        // The fixtures boot: the bridge + the live fixture entries as the
        // item lookup (the deterministic dev chat double serves them).
        const items = await createFixtureItemLookup();
        bridgeModule.startLiveChatBridge({ port: LIVECHAT_BRIDGE_PORT, items });
      } else {
        // The explicit service-side boot: the bridge WITHOUT an item
        // lookup — the honest typed gap (never a silent fixture).
        bridgeModule.startLiveChatBridge({ port: LIVECHAT_BRIDGE_PORT });
      }
      return readLiveChatBridgeStatus();
    } catch (error) {
      // A failed boot is the honest absent state — the surfaces render
      // the typed unavailability; playback is never touched.
      setLiveChatBridgeStatus({ running: false, port: null, provider: null });
      return {
        running: false,
        port: null,
        provider: null,
        ...(error instanceof Error ? { note: `the livechat bridge boot failed: ${error.message}` } : {}),
      };
    }
  })();
  (globalThis as BootGlobal)[BOOT_KEY] = boot;
  return boot;
}
