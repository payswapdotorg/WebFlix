/**
 * @wfx/app-api — `GET /sources` (R03 — source management).
 *
 * The user's source list: every wired source's descriptor truth (id,
 * displayName, version, the FULL capability record — what each source CAN
 * and CANNOT do), the derived authorization state (signedOut / authorizing
 * / signedIn / expired / failed — an expired token is REPORTED expired,
 * never silently connected), account linkage, last-connected/authorized-at,
 * and per-source availability notes.
 *
 * Identity: session-scoped (`Authorization: Bearer wfxsess_…`) OR the
 * anonymous transition — the anonymous user has NO connected sources, and
 * the answer is the HONEST EMPTY list (`{ authenticated: false, sources: [] }`),
 * never a fabricated one.
 *
 * The privacy law at the boundary: the outgoing payload passes the
 * persistence model-input guard (`assertNoCredentialMaterial` — applied
 * inside the service; a leak is a loud 500, never a silent pass-through).
 *
 * Typed answers: 200 (list); 400/401 (identity law); 500 loud boot
 * failures; 502 the degradation family.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { describeThrown } from "@wfx/experience";
import { resolveScopedIdentity } from "@api/host/session-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.list.boot", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        return upstreamFailure("sources-unavailable", resolved.detail);
      }
      return unauthorized(resolved.detail);
    }

    // The anonymous transition: NO connected sources, honestly. The
    // session-scoped read answers the full management view.
    if (resolved.identity.mode !== "session") {
      return Response.json({ authenticated: false, sources: [] });
    }

    const listed = await boot.sourceManagement.listSources(resolved.identity.user.id);
    if (!listed.ok) {
      const detail =
        listed.failure.kind === "degraded"
          ? listed.failure.detail
          : `the source list could not be read (${listed.failure.kind})`;
      logDegradation("sources.list", new Error(detail));
      return upstreamFailure("sources-unavailable", detail);
    }
    return Response.json({ authenticated: true, sources: listed.value });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.list", thrown);
    return upstreamFailure("sources-unavailable", describeThrown(thrown));
  }
}
