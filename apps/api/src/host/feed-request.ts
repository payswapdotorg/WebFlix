/**
 * @wfx/app-api — the feed-import routes' request identity resolution
 * (R20-H).
 *
 * The ONE resolver every `/feeds/**` route funnels through — the same law
 * the profile-scoped R06 routes follow, specialized for the feed surface:
 *
 * - SESSION MODE: `Authorization: Bearer wfxsess_…` — validated through
 *   `resolveScopedIdentity` (hash lookup, expiry, revocation, header
 *   agreement) with the session's ACTIVE profile scoping every feed row;
 * - ANONYMOUS MODE: the frozen `x-wfx-*` header law verbatim
 *   (`readConnectorContext`), with the effective profile key resolved by
 *   the persistence layer (`resolveEffectiveProfileKey` — the legacy
 *   pseudo bucket for the 050 anonymous stopgap, the user's default
 *   profile once one exists);
 * - a MALFORMED bearer is a 401 (presented-but-broken credentials are
 *   rejected, never silently ignored);
 * - DB-down during resolution is the 052 degradation family — the caller
 *   maps it to the typed 502 (a feed read failure is an ERROR STATE,
 *   never a fabricated empty panel — the R01 typed-failure law the BYOF
 *   surface inherits).
 *
 * Determinism: no clock/randomness of its own — everything resolves
 * through the booted services' injected seams. Tokens are NEVER logged.
 */

import type { ConnectorContext } from "@wfx/domain";

import type { ApiBoot } from "./boot";
import { badRequest, isLoudFailure, logDegradation, unauthorized } from "./http";
import { readBearerToken, readConnectorContext } from "./identity";
import { resolveScopedIdentity } from "./session-identity";

/** The identity every feed operation is scoped to. */
export interface FeedRequestIdentity {
  readonly userId: string;
  readonly profileId: string;
  readonly ctx: ConnectorContext;
}

/**
 * The typed resolution outcome: either the scoped identity, or the exact
 * `Response` the route must answer (the typed 400/401/502 channel — never
 * a throw across the seam).
 */
export type FeedRequestIdentityResult =
  | { readonly ok: true; readonly identity: FeedRequestIdentity }
  | { readonly ok: false; readonly response: Response };

/**
 * Resolve one feed request's identity across both channels. The
 * `operation` name rides the degradation log line (the diagnostic
 * channel).
 */
export async function resolveFeedIdentity(
  operation: string,
  request: Request,
  boot: ApiBoot,
): Promise<FeedRequestIdentityResult> {
  const bearer = readBearerToken(request.headers);
  if (bearer.kind === "malformed") {
    return { ok: false, response: unauthorized(bearer.detail) };
  }
  const anonymous = bearer.kind === "absent" ? readConnectorContext(request.headers) : null;
  if (anonymous !== null && !anonymous.ok) {
    return { ok: false, response: badRequest(anonymous.detail) };
  }

  if (bearer.kind === "present") {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        logDegradation(`${operation}.session`, resolved.detail);
        return {
          ok: false,
          response: Response.json({ error: "feeds-unavailable", detail: resolved.detail }, { status: 502 }),
        };
      }
      if (resolved.failure === "bad-request") {
        return { ok: false, response: badRequest(resolved.detail) };
      }
      return { ok: false, response: unauthorized(resolved.detail) };
    }
    if (resolved.identity.mode !== "session") {
      return {
        ok: false,
        response: unauthorized("authorization: a bearer session token is required"),
      };
    }
    return {
      ok: true,
      identity: {
        userId: resolved.identity.user.id,
        profileId: resolved.identity.profileId,
        ctx: resolved.identity.ctx,
      },
    };
  }

  // The anonymous transition — the persistence layer resolves the
  // effective profile key (the default profile once one exists, the
  // legacy pseudo bucket for the anonymous stopgap).
  if (anonymous === null || !anonymous.ok) {
    return { ok: false, response: badRequest("x-wfx-user-id: required identity header is absent") };
  }
  try {
    const profileId = await boot.profiles.resolveEffectiveProfileKey(anonymous.ctx.userId);
    return {
      ok: true,
      identity: { userId: anonymous.ctx.userId, profileId, ctx: anonymous.ctx },
    };
  } catch (thrown) {
    logDegradation(`${operation}.profile`, thrown);
    return {
      ok: false,
      response: Response.json(
        { error: "feeds-unavailable", detail: "the profile service is unavailable right now" },
        { status: 502 },
      ),
    };
  }
}

/**
 * The boot-failure classification every feed route opens with (the
 * loudness law — loud 500 for config crimes, the typed 502 for the 052
 * degradation family). Answers the exact `Response`, or `null` when the
 * boot succeeded.
 */
export function feedBootFailure(operation: string, thrown: unknown): Response | null {
  if (!isLoudFailure(thrown)) {
    logDegradation(`${operation}.boot`, thrown);
    return Response.json(
      { error: "feeds-unavailable", detail: "the feed-import service is unavailable right now" },
      { status: 502 },
    );
  }
  return null;
}
