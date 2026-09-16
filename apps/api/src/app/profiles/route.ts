/**
 * @wfx/app-api — `GET` + `PUT /profiles` (R02 — identity and profiles).
 *
 * BOTH methods require `Authorization: Bearer wfxsess_…` (profiles are an
 * ACCOUNT property — the anonymous stopgap has none; the frozen experience
 * endpoints keep the anonymous transition instead).
 *
 * - `GET /profiles` → `{ profiles, activeProfileId }` — the account's
 *   profiles (default materialized on first read for pre-R02 accounts) +
 *   this session's EFFECTIVE profile (its selection or the default).
 * - `PUT /profiles` → create OR rename, discriminated by the body:
 *   `{ displayName, avatarSeed? }` CREATES a profile;
 *   `{ profileId, displayName }` RENAMES one (identity immutable — display
 *   name only). Answers the created/renamed `ProfileRecord`.
 *
 * Typed answers: 400 invalid-request (garbage body); 401 (session law);
 * 404 profile-not-found (rename); 500 loud boot failures; 502 the
 * degradation family.
 */

import { getApiBoot, type ApiBoot } from "@api/host/boot";
import {
  badRequest,
  bootFailure,
  isLoudFailure,
  logDegradation,
  readJsonBody,
  unauthorized,
  upstreamFailure,
} from "@api/host/http";
import { parseProfileMutationBody } from "@api/host/validate";
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
    logDegradation("profiles.list.boot", thrown);
    return upstreamFailure("profiles-unavailable", describeThrown(thrown));
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        return upstreamFailure("profiles-unavailable", resolved.detail);
      }
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized("authorization: a bearer session token is required");
    }

    const profiles = await boot.profiles.listProfiles(resolved.identity.user.id);
    return Response.json({ profiles, activeProfileId: resolved.identity.profileId });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("profiles.list", thrown);
    return upstreamFailure("profiles-unavailable", describeThrown(thrown));
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return badRequest(body.detail);

  const parsed = parseProfileMutationBody(body.value);
  if (!parsed.ok) return badRequest(parsed.problems.join("; "));

  let boot: ApiBoot;
  try {
    boot = await getApiBoot();
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("profiles.mutate.boot", thrown);
    return upstreamFailure("profiles-unavailable", describeThrown(thrown));
  }

  try {
    const resolved = await resolveScopedIdentity(request.headers, boot);
    if (!resolved.ok) {
      if (resolved.failure === "degraded") {
        return upstreamFailure("profiles-unavailable", resolved.detail);
      }
      return unauthorized(resolved.detail);
    }
    if (resolved.identity.mode !== "session") {
      return unauthorized("authorization: a bearer session token is required");
    }
    const user = resolved.identity.user;

    if (parsed.value.kind === "create") {
      const created = await boot.profiles.createProfile({
        userId: user.id,
        displayName: parsed.value.displayName,
        ...(parsed.value.avatarSeed !== undefined
          ? { avatarSeed: parsed.value.avatarSeed }
          : {}),
      });
      if (!created.ok) {
        if (created.reason === "invalid-input") return badRequest(created.details.join("; "));
        // user-not-found cannot honestly happen in session mode (the
        // account was just resolved) — loud.
        return upstreamFailure("profiles-unavailable", "the account vanished mid-request");
      }
      return Response.json({ profile: created.profile });
    }

    // Rename — OWNERSHIP-CHECKED: a profile id of ANOTHER account answers
    // the same honest 404 as an unknown id (no cross-account probing).
    const target = await boot.profiles.getProfile(parsed.value.profileId ?? "");
    if (target === null || target.userId !== user.id) {
      return Response.json(
        { error: "profile-not-found", detail: "no such profile under this account" },
        { status: 404 },
      );
    }
    const renamed = await boot.profiles.renameProfile({
      profileId: target.id,
      displayName: parsed.value.displayName,
    });
    if (!renamed.ok) {
      if (renamed.reason === "invalid-input") return badRequest(renamed.details.join("; "));
      return Response.json(
        { error: "profile-not-found", detail: "no such profile under this account" },
        { status: 404 },
      );
    }
    return Response.json({ profile: renamed.profile });
  } catch (thrown) {
    if (isLoudFailure(thrown)) return bootFailure(thrown);
    logDegradation("profiles.mutate", thrown);
    return upstreamFailure("profiles-unavailable", describeThrown(thrown));
  }
}
