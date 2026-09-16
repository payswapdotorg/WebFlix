/**
 * @wfx/app-api — the R02 session-scoped request identity resolver.
 *
 * The profile-scoped twin of `readConnectorContext` (the anonymous channel):
 * resolves ONE request's identity across BOTH channels —
 *
 * - SESSION MODE: `Authorization: Bearer wfxsess_…` — the token is
 *   validated against the booted session service (hash lookup, expiry,
 *   revocation — the typed 401s), the user record is resolved, the
 *   `x-wfx-user-id` header (when ALSO present) must AGREE with the
 *   session's user (a request may not claim another identity — 400), and
 *   the request's ACTIVE PROFILE is resolved per-request from the
 *   session's `active_profile_id`, falling back to the user's DEFAULT
 *   profile (materialized on first use — the lazy legacy migration).
 * - ANONYMOUS MODE: no Authorization header — the frozen `x-wfx-*` law
 *   verbatim (`readConnectorContext`), profileId null (the persistence
 *   layer resolves the default-profile fallback per store; the anonymous
 *   transition keeps working exactly as before R02 — R07 re-points the web
 *   app later).
 *
 * A MALFORMED Authorization header is a 401 (presented-but-broken
 * credentials are rejected, never silently ignored). Database-down during
 * token validation is the 052 degradation family — the caller maps it per
 * its own degradation law (reads ⇒ empty 200, writes ⇒ failed receipts,
 * events ⇒ 502), so the resolver answers the typed `degraded` failure
 * instead of throwing across the seam.
 *
 * Determinism: no clock/randomness of its own — everything resolves through
 * the booted services' injected seams. Tokens are NEVER logged.
 */

import type { ConnectorContext } from "@wfx/domain";
import type {
  PostgresIdentityService,
  PostgresProfileService,
  PostgresSessionService,
  SessionRecord,
  UserRecord,
} from "@wfx/persistence";
import { isCanonicalSessionToken } from "@wfx/persistence";

import {
  readBearerToken,
  readConnectorContext,
  readLocaleAndRegion,
  USER_ID_HEADER,
} from "./identity";

/** One resolved request identity (either channel). */
export type ScopedIdentity =
  | {
      readonly mode: "session";
      /** The frozen context (session user id + locale/region headers). */
      readonly ctx: ConnectorContext;
      readonly session: SessionRecord;
      readonly user: UserRecord;
      /** The session's ACTIVE profile id (never null in this mode). */
      readonly profileId: string;
      /** The raw bearer token (for logout/selection; never logged). */
      readonly token: string;
    }
  | {
      readonly mode: "anonymous";
      readonly ctx: ConnectorContext;
      /** No session ⇒ no profile context (stores resolve the fallback). */
      readonly profileId: null;
      readonly token: null;
    };

/** The typed resolution outcome. */
export type ScopedIdentityResult =
  | { readonly ok: true; readonly identity: ScopedIdentity }
  | { readonly ok: false; readonly failure: "bad-request" | "unauthorized" | "degraded"; readonly detail: string };

/** The booted services the resolver needs (a narrow structural seam). */
export interface ScopedIdentityServices {
  readonly identity: PostgresIdentityService;
  readonly sessions: PostgresSessionService;
  readonly profiles: PostgresProfileService;
}

/**
 * Resolve one request's identity across both channels. Order of laws:
 * malformed bearer ⇒ 401; absent bearer ⇒ the anonymous header law (400s);
 * invalid/expired/revoked token ⇒ 401 with the typed reason; header/session
 * identity mismatch ⇒ 400; DB-down ⇒ `degraded` (caller maps).
 */
export async function resolveScopedIdentity(
  headers: Headers,
  services: ScopedIdentityServices,
): Promise<ScopedIdentityResult> {
  const bearer = readBearerToken(headers);

  if (bearer.kind === "malformed") {
    return { ok: false, failure: "unauthorized", detail: bearer.detail };
  }

  if (bearer.kind === "absent") {
    // The anonymous transition — the frozen transport law, verbatim.
    const anonymous = readConnectorContext(headers);
    if (!anonymous.ok) return { ok: false, failure: "bad-request", detail: anonymous.detail };
    return {
      ok: true,
      identity: { mode: "anonymous", ctx: anonymous.ctx, profileId: null, token: null },
    };
  }

  // Session mode: shape-check the token (the canonical R02 shape), then
  // validate against the booted service.
  if (!isCanonicalSessionToken(bearer.token)) {
    return {
      ok: false,
      failure: "unauthorized",
      detail: "authorization: the bearer token is not a canonical session token (wfxsess_ prefix + ULID body)",
    };
  }

  let session: SessionRecord;
  try {
    const validation = await services.sessions.validateSession(bearer.token);
    if (!validation.ok) {
      return {
        ok: false,
        failure: "unauthorized",
        detail: `authorization: session token rejected (${validation.reason})`,
      };
    }
    session = validation.session;
  } catch {
    // DB-down during validation — the degradation family; the caller maps.
    return {
      ok: false,
      failure: "degraded",
      detail: "authorization: the session service is unavailable right now",
    };
  }

  let user: UserRecord | null;
  try {
    user = await services.identity.getUserById(session.userId);
  } catch {
    return {
      ok: false,
      failure: "degraded",
      detail: "authorization: the identity service is unavailable right now",
    };
  }
  if (user === null) {
    // A session whose user row vanished (deleted mid-flight) — honest 401.
    return {
      ok: false,
      failure: "unauthorized",
      detail: "authorization: the session's account no longer exists",
    };
  }

  // Identity agreement: a session may not claim another header identity.
  const headerUserId = headers.get(USER_ID_HEADER);
  if (headerUserId !== null && headerUserId.trim() !== session.userId) {
    return {
      ok: false,
      failure: "bad-request",
      detail: `${USER_ID_HEADER}: does not match the bearer session's user (identity may not disagree across channels)`,
    };
  }

  // Locale/region ride as headers in BOTH channels (validated the same).
  const localeRegion = readLocaleAndRegion(headers);
  if (!localeRegion.ok) return { ok: false, failure: "bad-request", detail: localeRegion.detail };

  // The ACTIVE PROFILE — per-request resolution: the session's selection
  // or the user's default (materialized on first use).
  let profileId: string;
  try {
    if (session.activeProfileId !== null) {
      profileId = session.activeProfileId;
    } else {
      const ensured = await services.profiles.ensureDefaultProfile(user.id);
      if (!ensured.ok) {
        // The user row existed a moment ago (resolved above); the FK firing
        // now means the account vanished mid-request — honest 401.
        return {
          ok: false,
          failure: "unauthorized",
          detail: "authorization: the session's account no longer exists",
        };
      }
      profileId = ensured.profile.id;
    }
  } catch {
    return {
      ok: false,
      failure: "degraded",
      detail: "authorization: the profile service is unavailable right now",
    };
  }

  const ctx: ConnectorContext = {
    userId: session.userId,
    locale: localeRegion.locale,
    ...(localeRegion.region !== undefined ? { region: localeRegion.region } : {}),
  };
  return {
    ok: true,
    identity: { mode: "session", ctx, session, user, profileId, token: bearer.token },
  };
}
