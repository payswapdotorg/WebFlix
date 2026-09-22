/**
 * @wfx/app-web — `GET /api/capabilities` (R26-W1): the capability-
 * availability report's typed transport bridge.
 *
 * The UI-bindable capability truth: every capability (semantic search,
 * moment retrieval, multimodal intelligence, realization availability,
 * realtime bridge health, artwork) exposes its SERVED / NOT-SERVED
 * truth through the LIVE transport — derived from THIS host boot's
 * real bindings (`host/capability-availability.ts`), never hardcoded.
 *
 * THE LAW (the contract's own — see
 * `@wfx/platform-contracts/capability-availability.ts`): a capability
 * whose production transport is unavailable must NEVER render as
 * usable — the surface renders the unavailable state BEFORE
 * interaction, or the entry's honest next action. This route is the
 * one read the surfaces consult (the same law the intelligence route
 * keeps: anonymous viewers are served; these are low-cost reads —
 * never a login wall).
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { loadCapabilityAvailabilityReport } from "@/host/capability-availability";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const host = await getWebRuntimeHost();
  const report = await loadCapabilityAvailabilityReport(host);
  return Response.json({ mode: host.mode, kind: "capability-availability", report });
}
