/**
 * @wfx/app-web — the health endpoint (WFX-050).
 *
 * `GET /api/health` → `{ ok: true, service: "webflix-web", version }`.
 *
 * The WFX-056 deployment-verification probe: a cheap, dependency-free,
 * deterministic answer that proves the web host process is serving. It
 * deliberately does NOT probe the Experience API or the database — those
 * are the service lanes' health surfaces; this one answers for the web
 * host itself.
 *
 * The `@/` alias (tsconfig `paths` → `./src/*`) is the App Router depth
 * convention: route files sit up to five directories deep, where relative
 * escapes would violate the lane rule (imports must stay inside the
 * package). The alias targets THIS package's own `src/` — never another
 * lane's.
 */

import { WEB_HOST_SERVICE, WEB_HOST_VERSION } from "@/host/version";

export function GET(): Response {
  return Response.json({
    ok: true,
    service: WEB_HOST_SERVICE,
    version: WEB_HOST_VERSION,
  });
}
