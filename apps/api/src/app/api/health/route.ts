/**
 * @wfx/app-api — the health endpoint (WFX-055A).
 *
 * `GET /api/health` → `{ ok: true, service: "webflix-api", version }`.
 *
 * The WFX-056 deployment-verification convention (the web host's twin):
 * a cheap, deterministic answer that proves the SERVICE process is
 * serving. It deliberately does NOT probe the database or the connectors
 * — those are the experience endpoints' surfaces; this one answers for
 * the service host itself. `force-dynamic` + the Node.js runtime, like
 * every route in this service (no pages, no caching, no edge).
 */

import { API_SERVICE_NAME, API_SERVICE_VERSION } from "@api/host/version";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Response {
  return Response.json({
    ok: true,
    service: API_SERVICE_NAME,
    version: API_SERVICE_VERSION,
  });
}
