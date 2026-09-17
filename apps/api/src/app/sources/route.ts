/**
 * @wfx/app-api — `GET /sources` (R03 — source management).
 *
 * The user's source list: every wired source's descriptor truth (id,
 * displayName, capability matrix — "see actual capabilities"), the
 * EVALUATED authorization state (an expired token is REPORTED expired,
 * never silently connected), account linkage, authorized-at, and the
 * source-specific availability notes.
 *
 * Identity law (the R02 dual channel):
 * - `Authorization: Bearer wfxsess_…` — the SESSION user's list (their
 *   account linkages; sources they never connected answer signedOut).
 * - Anonymous (no Authorization; the frozen `x-wfx-*` headers) — the
 *   HONEST EMPTY list: the anonymous user has no connected sources, and a
 *   fabricated one is never invented. Identity rides as headers, never in
 *   URLs.
 * - A presented-but-malformed Authorization is a 401 (never silently
 *   ignored); anonymous garbage headers are typed 400s.
 *
 * Degradation law: a LOUD boot failure answers the typed 500; the 052
 * degradation family answers the honest typed empty list on this read
 * (logged, never silent).
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { readBearerToken, readConnectorContext } from "@api/host/identity";
import { resolveScopedIdentity } from "@api/host/session-identity";
import type { SourceSummary } from "@api/host/sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // A presented-but-malformed Authorization is a 401 (never ignored).
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") return unauthorized(bearer.detail);
  // Anonymous requests keep the frozen header law verbatim (absent bearer).
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) return badRequest(anonymous.detail);

  // The anonymous transition: the HONEST EMPTY list — the anonymous user
  // has no connected sources, never a fake one.
  if (bearer.kind === "absent") return Response.json([] as SourceSummary[]);

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources.boot", thrown);
    return Response.json([] as SourceSummary[]); // degrade law: read ⇒ empty
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        logDegradation("sources.session", resolved.detail);
        return Response.json([] as SourceSummary[]); // degrade law
      }
      if (resolved.failure === "bad-request") return badRequest(resolved.detail);
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized("authorization: a bearer session token is required");
    }

    const summaries = await boot.sources.listSources(resolved.identity.user.id);
    // The privacy law, at the boundary: the summaries are metadata-only by
    // construction (the service never handles credential material), and
    // this scan is the belt-and-braces proof — a credential-shaped field
    // name can never ride in a source answer.
    const serialized = JSON.stringify(summaries);
    if (/access_?token|refresh_?token|client_?secret|"(secret|ciphertext|auth_?tag|iv)"/i.test(serialized)) {
      logDegradation("sources", "a source summary carried credential-shaped field names — refusing to answer");
      return upstreamFailure(
        "source-answer-invalid",
        "the source list could not be answered safely (credential-shaped field names refused at the boundary)",
      );
    }
    return Response.json(summaries);
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("sources", thrown);
    return Response.json([] as SourceSummary[]); // degrade law: read ⇒ empty
  }
}
