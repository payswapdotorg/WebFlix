/**
 * @wfx/connectors — Google OAuth2 (authorization code flow) for the YouTube
 * connector (WFX-054, Lane B).
 *
 * The flow functions + typed results this connector delivers (the packet is
 * explicit: the HTTP callback/redirect WIRING belongs to the host — a later
 * wave). Everything here implements the documented Google OAuth2 contract:
 *
 * 1. HOST redirects the user to `buildYouTubeAuthorizationUrl(...)` —
 *    accounts.google.com/o/oauth2/v2/auth with response_type=code,
 *    client_id, redirect_uri, the youtube scopes, access_type=offline
 *    (refresh token), prompt=consent (forces a fresh refresh-token
 *    issuance on re-consent), include_granted_scopes=true, and the host's
 *    CSRF `state`.
 * 2. GOOGLE redirects back to redirect_uri?code=…&state=…; the host checks
 *    state and hands the code to `exchangeYouTubeCode(...)`.
 * 3. The exchange POSTs oauth2.googleapis.com/token
 *    (application/x-www-form-urlencoded) and yields a typed
 *    `YouTubeTokenSet` — access token, optional refresh token, scope, and
 *    an ABSOLUTE expiry computed from the injected clock (typed expiry
 *    handling: `isYouTubeTokenExpired` with a safety margin).
 * 4. The host persists the token set through the connector's credential
 *    source (./credentials.ts — AES-256-GCM envelopes via @wfx/persistence
 *    connector-accounts; never plaintext, never env).
 * 5. When the access token expires, `refreshYouTubeToken(...)` rotates it
 *    (grant_type=refresh_token). Google does not usually re-issue the
 *    refresh token, but the contract allows it — when a response carries a
 *    NEW refresh token it replaces the stored one (rotation honored).
 *
 * Error vocabulary (typed, closed — mirroring the SDK's style):
 * - `invalid-config`    — missing/malformed client credentials (wiring bug)
 * - `exchange-rejected` — Google refused the authorization code (400 with
 *                          an `error` field: invalid_grant, redirect_uri_mismatch…)
 * - `refresh-rejected`  — Google refused the refresh token (typically
 *                          invalid_grant: revoked or expired)
 * - `transport`         — network failure / 5xx / timeout (retryable later)
 * - `malformed-response`— 2xx body that is not a documented token payload
 */

import { isRecord } from "@wfx/domain";

import { YOUTUBE_OAUTH_SCOPES } from "./descriptor";
import type { YouTubeHttpTransport } from "./http";
import {
  classifyYouTubeHttpStatus,
  classifyYouTubeTransportFailure,
  isYouTubeErrorBody,
  type YouTubeApiError,
} from "./errors";

// ---------------------------------------------------------------------------
// Endpoints + config (documented constants)
// ---------------------------------------------------------------------------

/** Google OAuth2 authorization endpoint (the user-consent redirect target). */
export const YOUTUBE_OAUTH_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

/** Google OAuth2 token endpoint (exchange + refresh). */
export const YOUTUBE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** The client/redirect configuration the flow needs (host-provided). */
export interface YouTubeOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** Extra, optional authorization parameters. */
export interface YouTubeAuthorizationOptions {
  /** Host-minted CSRF state — echoed by Google on the redirect. */
  readonly state: string;
  /** Override the requested scopes (default: YOUTUBE_OAUTH_SCOPES). */
  readonly scopes?: readonly string[];
  /** `consent` (default) forces refresh-token (re-)issuance; `none`/`select_account` pass through. */
  readonly prompt?: "consent" | "none" | "select_account";
  /** Pass-through login hint (email) when the host knows the account. */
  readonly loginHint?: string;
}

/**
 * The sealed result of a token exchange/refresh: everything needed to call
 * the Data API and to persist through the credential source.
 * `expiresAtMs` is ABSOLUTE epoch milliseconds (obtainedAtMs + expires_in).
 */
export interface YouTubeTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly scope: string;
  readonly expiresAtMs: number;
  readonly obtainedAtMs: number;
}

/** The closed OAuth error vocabulary (see module docs). */
export type YouTubeOAuthError =
  | { kind: "invalid-config"; detail: string }
  | { kind: "exchange-rejected"; detail: string; reason?: string }
  | { kind: "refresh-rejected"; detail: string; reason?: string }
  | { kind: "transport"; detail: string }
  | { kind: "malformed-response"; detail: string };

/** The typed result envelope for the OAuth flow functions. */
export type YouTubeOAuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: YouTubeOAuthError };

/** Safety margin applied to expiry checks (tokens go stale early). */
export const YOUTUBE_TOKEN_EXPIRY_MARGIN_MS = 60_000;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function configError(detail: string): YouTubeOAuthResult<never> {
  return { ok: false, error: { kind: "invalid-config", detail } };
}

function validateConfig(config: YouTubeOAuthConfig): string | null {
  if (typeof config.clientId !== "string" || config.clientId.trim().length === 0) {
    return "'clientId' must be a non-empty string (YOUTUBE_CLIENT_ID)";
  }
  if (typeof config.clientSecret !== "string" || config.clientSecret.trim().length === 0) {
    return "'clientSecret' must be a non-empty string (YOUTUBE_CLIENT_SECRET)";
  }
  if (typeof config.redirectUri !== "string" || config.redirectUri.trim().length === 0) {
    return "'redirectUri' must be a non-empty string (YOUTUBE_REDIRECT_URI)";
  }
  if (!/^https?:\/\//.test(config.redirectUri)) {
    return "'redirectUri' must be an absolute http(s) URL";
  }
  return null;
}

/** Encode a single query component (spaces as %20, matching Google's examples). */
function enc(value: string): string {
  return encodeURIComponent(value);
}

// ---------------------------------------------------------------------------
// 1. Authorization URL construction
// ---------------------------------------------------------------------------

/**
 * Build the Google OAuth2 authorization URL (the consent redirect).
 *
 * Parameters (each documented in Google's OAuth2 guide):
 * - response_type=code — the authorization-code flow
 * - client_id, redirect_uri — from the operator's Google Cloud project
 * - scope — the youtube scopes (default: readonly + write, space-separated)
 * - access_type=offline — yields a refresh token
 * - prompt=consent (default) — forces refresh-token (re-)issuance even for
 *   previously-consented accounts
 * - include_granted_scopes=true — incremental authorization safe
 * - state — the host's CSRF token, echoed back on the redirect
 *
 * Returns a typed `invalid-config` result (never a fabricated URL) when the
 * configuration is missing or malformed.
 */
export function buildYouTubeAuthorizationUrl(
  config: YouTubeOAuthConfig,
  options: YouTubeAuthorizationOptions,
  scopes: readonly string[] = YOUTUBE_OAUTH_SCOPES,
): YouTubeOAuthResult<string> {
  const configProblem = validateConfig(config);
  if (configProblem !== null) return configError(configProblem);
  if (typeof options.state !== "string" || options.state.length === 0) {
    return configError("'state' must be a non-empty string (CSRF token)");
  }
  const requestedScopes =
    options.scopes === undefined ? scopes : [...options.scopes];
  if (requestedScopes.length === 0) {
    return configError("'scopes' must not be empty when overridden");
  }
  for (const scope of requestedScopes) {
    if (typeof scope !== "string" || scope.trim().length === 0) {
      return configError("'scopes' contains an empty entry");
    }
  }

  const params: string[] = [
    `response_type=${enc("code")}`,
    `client_id=${enc(config.clientId)}`,
    `redirect_uri=${enc(config.redirectUri)}`,
    `scope=${enc(requestedScopes.join(" "))}`,
    `access_type=${enc("offline")}`,
    `include_granted_scopes=${enc("true")}`,
    `prompt=${enc(options.prompt ?? "consent")}`,
    `state=${enc(options.state)}`,
  ];
  if (options.loginHint !== undefined && options.loginHint.trim().length > 0) {
    params.push(`login_hint=${enc(options.loginHint)}`);
  }
  return { ok: true, value: `${YOUTUBE_OAUTH_AUTHORIZATION_ENDPOINT}?${params.join("&")}` };
}

// ---------------------------------------------------------------------------
// Token responses (shared by exchange + refresh)
// ---------------------------------------------------------------------------

function parseTokenResponse(
  bodyText: string,
  nowMs: number,
): YouTubeOAuthResult<YouTubeTokenSet> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: { kind: "malformed-response", detail: "token response is not JSON" } };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: { kind: "malformed-response", detail: "token response is not an object" } };
  }
  const accessToken = parsed["access_token"];
  const expiresIn = parsed["expires_in"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return {
      ok: false,
      error: { kind: "malformed-response", detail: "token response has no non-empty 'access_token'" },
    };
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return {
      ok: false,
      error: { kind: "malformed-response", detail: "token response has no positive 'expires_in'" },
    };
  }
  const refreshToken = parsed["refresh_token"];
  const scope = parsed["scope"];
  const tokenType = parsed["token_type"];
  const tokenSet: YouTubeTokenSet =
    typeof refreshToken === "string" && refreshToken.length > 0
      ? {
          accessToken,
          refreshToken,
          tokenType: typeof tokenType === "string" ? tokenType : "Bearer",
          scope: typeof scope === "string" ? scope : "",
          expiresAtMs: nowMs + expiresIn * 1000,
          obtainedAtMs: nowMs,
        }
      : {
          accessToken,
          tokenType: typeof tokenType === "string" ? tokenType : "Bearer",
          scope: typeof scope === "string" ? scope : "",
          expiresAtMs: nowMs + expiresIn * 1000,
          obtainedAtMs: nowMs,
        };
  return { ok: true, value: tokenSet };
}

/** Map a failed token-endpoint exchange to the closed OAuth vocabulary. */
function mapTokenEndpointFailure(
  failure: YouTubeApiError,
  phase: "exchange" | "refresh",
): YouTubeOAuthError {
  if (failure.kind === "bad-request" || failure.kind === "unauthorized") {
    // The token endpoint rejects bad codes/grants with HTTP 400 + error=… .
    return {
      kind: phase === "exchange" ? "exchange-rejected" : "refresh-rejected",
      detail: failure.message,
      ...(failure.reason !== undefined ? { reason: failure.reason } : {}),
    };
  }
  if (failure.kind === "malformed-response") {
    return { kind: "malformed-response", detail: failure.message };
  }
  return { kind: "transport", detail: failure.message };
}

/**
 * Extract the OAuth2 error code from the token endpoint's documented error
 * body (`{"error": "invalid_grant", "error_description": "…"}`) — a DIFFERENT
 * shape from the Data API's `error.errors[]` taxonomy, which the shared
 * classifier cannot see (its `error` field is a string, not an object).
 * `reason` carries the code (e.g. "invalid_grant") when present.
 */
function oauthErrorCode(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!isRecord(parsed)) return undefined;
    const code = parsed["error"];
    if (typeof code === "string" && code.length > 0) return code;
    return undefined;
  } catch {
    return undefined;
  }
}

async function postTokenEndpoint(
  transport: YouTubeHttpTransport,
  form: Record<string, string>,
  nowMs: number,
  phase: "exchange" | "refresh",
): Promise<YouTubeOAuthResult<YouTubeTokenSet>> {
  const body = Object.entries(form)
    .map(([key, value]) => `${enc(key)}=${enc(value)}`)
    .join("&");
  let reply;
  try {
    reply = await transport.request({
      method: "POST",
      url: YOUTUBE_OAUTH_TOKEN_ENDPOINT,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
  } catch (thrown) {
    const network = classifyYouTubeTransportFailure(thrown);
    return { ok: false, error: { kind: "transport", detail: network.message } };
  }
  if (reply.status < 200 || reply.status >= 300) {
    const failure = classifyYouTubeHttpStatus(reply.status, reply.bodyText);
    const mapped = mapTokenEndpointFailure(failure, phase);
    // The token endpoint speaks OAuth2 error codes, not the Data API's
    // error.errors[] taxonomy — enrich the rejection with the OAuth code
    // (invalid_grant, redirect_uri_mismatch, …) when the body carries one.
    if (
      (mapped.kind === "exchange-rejected" || mapped.kind === "refresh-rejected") &&
      mapped.reason === undefined
    ) {
      const code = oauthErrorCode(reply.bodyText);
      if (code !== undefined) return { ok: false, error: { ...mapped, reason: code } };
    }
    return { ok: false, error: mapped };
  }
  // The token endpoint's error bodies share the documented Google shape;
  // a 2xx with an error body is a contract break — surface it honestly.
  try {
    const parsed: unknown = JSON.parse(reply.bodyText);
    if (isYouTubeErrorBody(parsed)) {
      return {
        ok: false,
        error: { kind: "malformed-response", detail: "2xx token response carries an error body" },
      };
    }
  } catch {
    return { ok: false, error: { kind: "malformed-response", detail: "token response is not JSON" } };
  }
  return parseTokenResponse(reply.bodyText, nowMs);
}

// ---------------------------------------------------------------------------
// 2. Code exchange
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for a token set (grant_type=
 * authorization_code). `nowMs` is the injected clock — the token set's
 * absolute expiry is derived from it (typed expiry handling downstream).
 *
 * Typed failures: `invalid-config`, `exchange-rejected` (Google refused the
 * code — invalid_grant, redirect_uri_mismatch, …), `transport`,
 * `malformed-response`.
 */
export async function exchangeYouTubeCode(
  config: YouTubeOAuthConfig,
  transport: YouTubeHttpTransport,
  code: string,
  nowMs: number,
): Promise<YouTubeOAuthResult<YouTubeTokenSet>> {
  const configProblem = validateConfig(config);
  if (configProblem !== null) return configError(configProblem);
  if (typeof code !== "string" || code.trim().length === 0) {
    return configError("'code' must be a non-empty string");
  }
  return postTokenEndpoint(
    transport,
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    nowMs,
    "exchange",
  );
}

// ---------------------------------------------------------------------------
// 3. Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an access token (grant_type=refresh_token). When the response
 * carries a NEW refresh token it is part of the returned set — callers
 * persist the whole set, so rotation is honored (the credential source's
 * `store` replaces the previous set atomically).
 *
 * Typed failures: `invalid-config`, `refresh-rejected` (typically
 * invalid_grant: the refresh token was revoked or expired — the caller
 * should treat the account as signed out), `transport`, `malformed-response`.
 */
export async function refreshYouTubeToken(
  config: Pick<YouTubeOAuthConfig, "clientId" | "clientSecret">,
  transport: YouTubeHttpTransport,
  refreshToken: string,
  nowMs: number,
): Promise<YouTubeOAuthResult<YouTubeTokenSet>> {
  if (
    typeof config.clientId !== "string" ||
    config.clientId.trim().length === 0 ||
    typeof config.clientSecret !== "string" ||
    config.clientSecret.trim().length === 0
  ) {
    return configError("'clientId'/'clientSecret' must be non-empty strings");
  }
  if (typeof refreshToken !== "string" || refreshToken.trim().length === 0) {
    return configError("'refreshToken' must be a non-empty string");
  }
  return postTokenEndpoint(
    transport,
    {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    },
    nowMs,
    "refresh",
  );
}

// ---------------------------------------------------------------------------
// 4. Typed expiry
// ---------------------------------------------------------------------------

/**
 * Whether a token set is (or will soon be) expired at `nowMs`. A 60-second
 * safety margin is applied so a token checked as fresh does not die in
 * flight (typed expiry handling — callers never parse timestamps).
 */
export function isYouTubeTokenExpired(
  tokens: YouTubeTokenSet,
  nowMs: number,
  marginMs: number = YOUTUBE_TOKEN_EXPIRY_MARGIN_MS,
): boolean {
  return nowMs >= tokens.expiresAtMs - marginMs;
}
