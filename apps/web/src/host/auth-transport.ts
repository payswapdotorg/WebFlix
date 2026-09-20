/**
 * @wfx/app-web — the auth transport (R21-B): identity/session read/write.
 *
 * The typed client of the Experience API's R02 identity endpoints — the
 * REAL profile/session path the Web surfaces bind to (the transport
 * completion that retires the "identity arrives later" mismatch):
 *
 * | Operation        | HTTP                            | Body / auth                       |
 * |------------------|---------------------------------|-----------------------------------|
 * | `login`          | `POST {base}/auth/login`        | `{ email, password }`             |
 * | `register`       | `POST {base}/auth/register`     | `{ email, password, displayName? }` |
 * | `readSession`    | `GET  {base}/auth/me`           | `Authorization: Bearer <token>`   |
 * | `logout`         | `POST {base}/auth/logout`       | `Authorization: Bearer <token>`   |
 * | `selectProfile`  | `PUT  {base}/profiles/:id/select` | `Authorization: Bearer <token>` |
 *
 * LAWS (the same family the ServerPort keeps):
 *
 * - TYPED FAILURES — every operation answers `AuthResult`; the failure
 *   kinds are closed: `network` (transport did not complete),
 *   `unauthorized` (401 — the token was not accepted), 
 *   `invalid-credentials` (login/register 401 — the anti-enumeration
 *   answer), `email-taken` (register 409), `invalid-input` (400),
 *   `unavailable` (5xx/408/429 — the service cannot serve now),
 *   `malformed` (non-JSON or wrong-shaped payloads), `not-found`
 *   (profile select 404). Never a silent failure, never a fake session.
 * - THE TOKEN IS A SECRET — it rides the Authorization header ONLY,
 *   never a URL, never a rendered payload, never a log line. The cookie
 *   discipline (httpOnly, same-origin) is the app routes' concern
 *   (`/api/auth/*`); this transport never touches cookies.
 * - SECRETS NEVER COME BACK — `/auth/me` answers the account view
 *   (user + profiles + activeProfileId), never the password hash; the
 *   guards here enforce that shape before anything becomes domain data.
 * - Determinism: no clock, no randomness; `fetch` is injectable (tests
 *   stub it and run offline).
 */

import { isIso8601, isRecord } from "@wfx/domain";

// ---------------------------------------------------------------------------
// The typed failure channel
// ---------------------------------------------------------------------------

/** The closed auth-transport failure vocabulary. */
export type AuthFailureKind =
  | "network"
  | "unauthorized"
  | "invalid-credentials"
  | "email-taken"
  | "invalid-input"
  | "unavailable"
  | "malformed"
  | "not-found";

/** One typed auth failure. */
export interface AuthFailure {
  readonly kind: AuthFailureKind;
  /** Non-empty human-readable detail (what exactly failed). */
  readonly detail: string;
}

/** The result envelope of every auth operation. */
export type AuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AuthFailure };

// ---------------------------------------------------------------------------
// The session view (the account truth — never secrets)
// ---------------------------------------------------------------------------

/** The account's user view (the API's `UserRecord` projection). */
export interface AuthUserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One profile of the account (the API's `ProfileRecord` projection). */
export interface AuthProfileView {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarSeed: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The authenticated session view: the account + its profiles + the active one. */
export interface AuthSessionView {
  readonly user: AuthUserView;
  readonly profiles: readonly AuthProfileView[];
  readonly activeProfileId: string;
}

/** A freshly issued session (login/register): the token (shown once) + the view. */
export interface IssuedSession {
  readonly token: string;
  readonly session: AuthSessionView;
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/** Options for the transport calls (the injectable fetch seam). */
export interface AuthTransportOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /** The fetch implementation (default: the global `fetch`; tests inject a stub). */
  readonly fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds (default 10 000; `0` disables). */
  readonly timeoutMs?: number;
}

/** The closed login/register body vocabulary builders. */
export interface LoginInput {
  readonly email: string;
  readonly password: string;
}
export interface RegisterInput extends LoginInput {
  readonly displayName?: string;
}

function failureForStatus(status: number, url: string, bodyHint?: string): AuthFailure {
  const detail = `${url} answered HTTP ${status}${bodyHint !== undefined ? ` (${bodyHint})` : ""}`;
  if (status === 401 || status === 403) {
    // The route distinguishes invalid-credentials (login/register) from a
    // rejected token (me/logout/select) by CALLER context; the transport
    // maps per operation below (this branch is the shared detail).
    return { kind: "unauthorized", detail };
  }
  if (status === 409) return { kind: "email-taken", detail };
  if (status === 404) return { kind: "not-found", detail };
  if (status === 400) return { kind: "invalid-input", detail };
  if (status >= 500 || status === 408 || status === 429) {
    return { kind: "unavailable", detail };
  }
  return { kind: "invalid-input", detail };
}

/** One raw request outcome (transport-level, before payload validation). */
type RawOutcome =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: AuthFailure };

async function request(
  options: AuthTransportOptions,
  method: "GET" | "POST" | "PUT",
  path: string,
  init?: { readonly body?: string; readonly token?: string },
): Promise<RawOutcome> {
  const url = new URL(`${options.apiBase.pathname === "/" ? "" : options.apiBase.pathname}${path}`, options.apiBase);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers: Record<string, string> = { accept: "application/json" };
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  if (init?.token !== undefined && init.token.length > 0) {
    headers.authorization = `Bearer ${init.token}`;
  }
  const requestInit: RequestInit = { method, headers };
  if (init?.body !== undefined) requestInit.body = init.body;
  if (timeoutMs > 0) requestInit.signal = AbortSignal.timeout(timeoutMs);
  const fetchImpl = options.fetchImpl ?? ((input, reqInit) => fetch(input, reqInit));
  let response: Response;
  try {
    response = await fetchImpl(url, requestInit);
  } catch (thrown) {
    const name = thrown instanceof Error ? thrown.name : "unknown";
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      ok: false,
      failure: { kind: "network", detail: `${method} ${url} did not complete (${name}: ${message})` },
    };
  }
  if (!response.ok) {
    const bodyError = await response
      .json()
      .then((body) => (isRecord(body) && typeof body.error === "string" ? body.error : undefined))
      .catch(() => undefined);
    return { ok: false, failure: failureForStatus(response.status, url.toString(), bodyError) };
  }
  if (response.status === 204) return { ok: true, body: undefined };
  try {
    return { ok: true, body: await response.json() };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      ok: false,
      failure: { kind: "malformed", detail: `${method} ${url} answered a non-JSON body (${message})` },
    };
  }
}

// — the payload guards (a malformed service answer never becomes identity) —

function isUsableUserView(value: unknown): value is AuthUserView {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.email !== "string" || value.email.length === 0) return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  // The password hash must NEVER ride the user view (the privacy law).
  if ("passwordHash" in value || "password" in value) return false;
  return true;
}

function isUsableProfileView(value: unknown): value is AuthProfileView {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.userId !== "string" || value.userId.length === 0) return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.avatarSeed !== "string") return false;
  if (typeof value.isDefault !== "boolean") return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  return true;
}

function sessionViewOf(body: unknown, operation: string): AuthResult<AuthSessionView> {
  if (!isRecord(body)) {
    return { ok: false, failure: { kind: "malformed", detail: `${operation} answered a non-object payload` } };
  }
  if (!isUsableUserView(body.user)) {
    return {
      ok: false,
      failure: { kind: "malformed", detail: `${operation} answered a payload without a usable user view` },
    };
  }
  if (!Array.isArray(body.profiles) || !body.profiles.every(isUsableProfileView)) {
    return {
      ok: false,
      failure: { kind: "malformed", detail: `${operation} answered a payload without usable profiles` },
    };
  }
  if (typeof body.activeProfileId !== "string" || body.activeProfileId.length === 0) {
    return {
      ok: false,
      failure: { kind: "malformed", detail: `${operation} answered a payload without an active profile id` },
    };
  }
  return {
    ok: true,
    value: {
      user: body.user,
      profiles: body.profiles,
      activeProfileId: body.activeProfileId,
    },
  };
}

function issuedSessionOf(body: unknown, operation: string): AuthResult<IssuedSession> {
  if (!isRecord(body)) {
    return { ok: false, failure: { kind: "malformed", detail: `${operation} answered a non-object payload` } };
  }
  if (typeof body.token !== "string" || !body.token.startsWith("wfxsess_")) {
    return {
      ok: false,
      failure: { kind: "malformed", detail: `${operation} answered a payload without a usable session token` },
    };
  }
  const session = sessionViewOf(body, operation);
  if (!session.ok) return session;
  return { ok: true, value: { token: body.token, session: session.value } };
}

/** Validate a login body (the typed pre-flight — caller misuse). */
function assertCredentialInput(input: LoginInput): AuthFailure | null {
  const problems: string[] = [];
  if (typeof input?.email !== "string" || input.email.trim().length === 0) {
    problems.push("email: expected a non-empty string");
  }
  if (typeof input?.password !== "string" || input.password.length === 0) {
    problems.push("password: expected a non-empty string");
  }
  if (problems.length > 0) return { kind: "invalid-input", detail: problems.join("; ") };
  return null;
}

// — the operations —

/** Sign in: `POST /auth/login` → the freshly issued session (token shown once). */
export async function authLogin(
  options: AuthTransportOptions,
  input: LoginInput,
): Promise<AuthResult<IssuedSession>> {
  const invalid = assertCredentialInput(input);
  if (invalid !== null) return { ok: false, failure: invalid };
  const outcome = await request(options, "POST", "/auth/login", {
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (!outcome.ok) {
    // The anti-enumeration law: login 401 is invalid-credentials (the
    // same honest answer for unknown email and wrong password).
    if (outcome.failure.kind === "unauthorized") {
      return { ok: false, failure: { kind: "invalid-credentials", detail: "email or password is incorrect" } };
    }
    return outcome;
  }
  return issuedSessionOf(outcome.body, "POST /auth/login");
}

/** Create an account: `POST /auth/register` → the auto-logged-in session. */
export async function authRegister(
  options: AuthTransportOptions,
  input: RegisterInput,
): Promise<AuthResult<IssuedSession>> {
  const invalid = assertCredentialInput(input);
  if (invalid !== null) return { ok: false, failure: invalid };
  const outcome = await request(options, "POST", "/auth/register", {
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      ...(input.displayName !== undefined && input.displayName.trim().length > 0
        ? { displayName: input.displayName.trim() }
        : {}),
    }),
  });
  if (!outcome.ok) return outcome;
  return issuedSessionOf(outcome.body, "POST /auth/register");
}

/** Read the authenticated session: `GET /auth/me` (the cross-device continuity probe). */
export async function authReadSession(
  options: AuthTransportOptions,
  token: string,
): Promise<AuthResult<AuthSessionView>> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, failure: { kind: "invalid-input", detail: "token: expected a non-empty session token" } };
  }
  const outcome = await request(options, "GET", "/auth/me", { token });
  if (!outcome.ok) return outcome;
  return sessionViewOf(outcome.body, "GET /auth/me");
}

/** Sign out: `POST /auth/logout` (revokes the session token). */
export async function authLogout(
  options: AuthTransportOptions,
  token: string,
): Promise<AuthResult<{ revoked: boolean }>> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, failure: { kind: "invalid-input", detail: "token: expected a non-empty session token" } };
  }
  const outcome = await request(options, "POST", "/auth/logout", { token });
  if (!outcome.ok) return outcome;
  if (!isRecord(outcome.body) || typeof outcome.body.revoked !== "boolean") {
    return {
      ok: false,
      failure: { kind: "malformed", detail: "POST /auth/logout answered a payload without the revoked truth" },
    };
  }
  return { ok: true, value: { revoked: outcome.body.revoked } };
}

/** Switch the session's active profile: `PUT /profiles/:id/select`. */
export async function authSelectProfile(
  options: AuthTransportOptions,
  token: string,
  profileId: string,
): Promise<AuthResult<AuthSessionView>> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, failure: { kind: "invalid-input", detail: "token: expected a non-empty session token" } };
  }
  if (typeof profileId !== "string" || profileId.length === 0) {
    return { ok: false, failure: { kind: "invalid-input", detail: "profileId: expected a non-empty profile id" } };
  }
  const outcome = await request(options, "PUT", `/profiles/${encodeURIComponent(profileId)}/select`, {
    token,
    body: JSON.stringify({}),
  });
  if (!outcome.ok) return outcome;
  return sessionViewOf(outcome.body, "PUT /profiles/:id/select");
}
