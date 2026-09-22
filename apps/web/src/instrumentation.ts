/**
 * @wfx/app-web — the server-boot instrumentation hook (R25-D).
 *
 * Next.js invokes `register()` once when a new server instance
 * bootstraps. This lane uses it for the R25 realtime bridge's dev-boot
 * start (the mini-service path the R25 plan sanctions for the prototype:
 * the WebFlix WebSocket bridge + — in the fixtures boot — the
 * deterministic dev provider double, both inside the dev process).
 *
 * THE HONEST GATES (see host/realtime/realtime-boot.ts — the one boot
 * path this hook shares with the lazy capability route):
 * - the fixtures boot (`WFX_DEV_FIXTURES=1`) starts bridge + provider
 *   double through dynamic imports (the production graph never
 *   statically reaches the provider double — the R23 lesson);
 * - `WFX_REALTIME_BRIDGE=1` starts the bridge alone (the honest typed
 *   no-provider gap);
 * - every other boot (the default service/serverless path) starts
 *   NOTHING — the realtime surfaces render the honest typed
 *   unavailability, and the Vercel WebSocket-function deployment is the
 *   lead's R25 lane;
 * - a build pass never starts servers (NEXT_PHASE).
 *
 * A failed boot is caught and recorded as the honest absent state —
 * never a crash of the web host itself (base playback is never touched
 * by translation machinery — §R25-L's frozen law).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    // The node runtime only (the edge runtime never serves this lane).
    return;
  }
  try {
    const { ensureRealtimeBridgeBooted } = await import("./host/realtime/realtime-boot");
    await ensureRealtimeBridgeBooted();
  } catch {
    // The honest absent state is realtime-boot's own failure path; a
    // thrown boot never takes the web host down.
  }
}
