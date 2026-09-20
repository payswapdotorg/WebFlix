/**
 * @wfx/app-web — `GET /api/sources/catalog` (R22-D): the first-connect
 * source catalog read model — the typed chooser data the Settings →
 * Sources empty state renders (the F2 dead-end killer).
 *
 * Answers the R22-A `SourceCatalogView` over the SAME shared runtime
 * sources read the page renders (the convergence law: the normal Home
 * path and the Settings path render the SAME shared source state — no
 * second navigation system, no fabricated catalog). Concretely:
 *
 * - the request-scoped host's `runtime.sources.refresh()` (the honest
 *   `readSources` answer — every WIRED connector, connected or not);
 * - the request session's authenticated truth (the host's own state —
 *   never a guess);
 * - the runtime sources read's section status (in-model degradation:
 *   an error keeps entries visible where the read partially answered;
 *   an empty ready read is the honest empty catalog);
 * - the adapter's platform-truth map (Web's `connectable === false`
 *   rows surface as `unsupported` — the "unsupported is not
 *   undiscoverable" law).
 *
 * HONESTY LAWS (mirrored from the existing /api/sources route):
 * - NO fabricated connectors — entries exist ONLY for observed rows
 *   (the source-catalog module's own law);
 * - an anonymous session carries the sign-in prerequisite and NO
 *   entries (the honest anonymous truth — never a fabricated catalog);
 * - the catalog view is SECRET-FREE by construction (built from the
 *   runtime's sources model — never carries credential material).
 *
 * The endpoint is read-only (the connect/reauthorize/disconnect
 * ACTIONS continue to run through the existing `POST /api/sources`
 * route — the catalog is the chooser's data, not the action path).
 */

import { sourceCatalogView } from "@wfx/client-runtime";

import { getWebRuntimeHostForRequest } from "@/host/web-host";
import { sessionTokenFromRequest } from "@/host/session-cookie";

export const dynamic = "force-dynamic";

/**
 * The Web platform-truth map for the chooser (the "unsupported is not
 * undiscoverable" law — never guessed, never fabricated): a connector
 * unsupported on Web carries the honest reason. The current Web adapter
 * has NO platform-blocked connectors (every wired row that the boot
 * provisions is connectable on Web); the map is therefore empty. The seam
 * exists so a future Desktop-only connector landing on the Web catalog
 * answers the typed `unsupported` state with the recovery next step
 * (the "Use the WebFlix Desktop app" hint).
 */
const WEB_UNSUPPORTED_ON_PLATFORM: ReadonlyMap<string, string> = new Map();

export async function GET(request: Request): Promise<Response> {
  // Route-handler path (the same pattern the session route keeps):
  // read the cookie from the Request, resolve the per-identity host
  // through `getWebRuntimeHostForRequest` (the anonymous singleton when
  // no cookie is present — the exact R07 behavior; the resolved identity's
  // host when the token is valid). The catalog honors the session truth
  // (anonymous ⇒ prerequisite, authenticated ⇒ entries).
  const token = sessionTokenFromRequest(request) ?? undefined;
  const host = await getWebRuntimeHostForRequest(token);
  const model = await host.runtime.sources.refresh();
  const view = sourceCatalogView({
    sources: model.sources,
    authenticated: host.session.state.signedIn,
    status: model.status,
    unsupportedOnPlatform: WEB_UNSUPPORTED_ON_PLATFORM,
  });
  return Response.json({ mode: host.mode, catalog: view });
}
