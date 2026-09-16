/**
 * @wfx/app-api — request identity (the transport-contract header law;
 * R02: the session-token upgrade).
 *
 * The frozen web client (`apps/web/src/host/remote-ports.ts`) rides the
 * `ConnectorContext` as REQUEST HEADERS — "identity travels as headers,
 * never in URLs":
 *
 * - `x-wfx-user-id`    — REQUIRED on every endpoint (the ANONYMOUS
 *   transition law: the 050 stopgap `wfx-anonymous` keeps working until
 *   R07 re-points the web app). Absent or garbage ⇒ typed 400.
 * - `x-wfx-session-id` — OPTIONAL (the client sends it on event posts).
 *   When present it must be a sane token; absent ⇒ simply not carried.
 * - `x-wfx-locale`     — OPTIONAL (the client always sends it in practice;
 *   the service defaults to `"en"` when absent). Validated when present.
 * - `x-wfx-region`     — OPTIONAL. Validated when present.
 *
 * R02 — THE BEARER UPGRADE (additive, the anonymous transition preserved):
 * requests may instead (or additionally) carry
 * `Authorization: Bearer wfxsess_…` — an opaque SESSION TOKEN minted by
 * `POST /auth/login`/`register`. `readBearerToken` parses the header PURELY
 * (shape only); token VALIDATION (hash lookup, expiry, revocation, user +
 * active-profile resolution) is `host/session-identity.ts`'s job — it needs
 * the booted services. When BOTH channels are present they must AGREE (a
 * session may not claim another header identity — typed 400).
 *
 * Validation is deliberately shallow and honest: non-empty after trimming,
 * bounded length, no control characters, and for locale/region a
 * tag-shaped charset (`en`, `en-US`, `zh-Hans`, `US`, …). The service does
 * NOT attempt to authenticate the id — that is the session layer's job —
 * it only refuses to route garbage.
 *
 * Determinism: pure header parsing + validation, no clock, no randomness,
 * no environment reads.
 */

import type { ConnectorContext } from "@wfx/domain";

/** The typed outcome of reading identity off one request. */
export type IdentityResult =
  | { readonly ok: true; readonly ctx: ConnectorContext }
  | { readonly ok: false; readonly detail: string };

/** Header name constants (single source of truth for the route handlers). */
export const USER_ID_HEADER = "x-wfx-user-id";
export const SESSION_ID_HEADER = "x-wfx-session-id";
export const LOCALE_HEADER = "x-wfx-locale";
export const REGION_HEADER = "x-wfx-region";
/** R02: the bearer channel (session tokens — see the module doc). */
export const AUTHORIZATION_HEADER = "authorization";

/** The locale this service assumes when the client sends none. */
export const DEFAULT_LOCALE = "en";

/** Max accepted length of the identity tokens (generous, still bounded). */
const MAX_IDENTITY_LENGTH = 128;
/** Max accepted length of the locale/region tags (BCP-47-ish territory). */
const MAX_TAG_LENGTH = 35;

/** Control characters (C0 + DEL) — never legitimate in identity headers. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Locale/region tag shape: alphanumeric runs joined by single hyphens. */
const TAG_SHAPE = /^[A-Za-z0-9]{1,8}(-[A-Za-z0-9]{1,8})*$/;

/** Is this a usable identity token (non-empty, bounded, no control chars)? */
function isUsableToken(value: string): boolean {
  return value.length > 0 && value.length <= MAX_IDENTITY_LENGTH && !CONTROL_CHARS.test(value);
}

/** Is this a usable locale/region tag? */
function isUsableTag(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TAG_LENGTH && TAG_SHAPE.test(value);
}

/** The typed outcome of reading the (optional) locale/region pair. */
export type LocaleRegionResult =
  | { readonly ok: true; readonly locale: string; readonly region?: string }
  | { readonly ok: false; readonly detail: string };

/**
 * Read + validate the OPTIONAL `x-wfx-locale` / `x-wfx-region` headers —
 * the shared half of both identity channels (anonymous headers AND bearer
 * sessions carry locale/region the same way).
 */
export function readLocaleAndRegion(headers: Headers): LocaleRegionResult {
  let locale = DEFAULT_LOCALE;
  const rawLocale = headers.get(LOCALE_HEADER);
  if (rawLocale !== null) {
    const candidate = rawLocale.trim();
    if (!isUsableTag(candidate)) {
      return {
        ok: false,
        detail: `${LOCALE_HEADER}: when present, expected a locale tag like 'en' or 'en-US' (alphanumeric runs joined by hyphens, at most ${MAX_TAG_LENGTH} characters)`,
      };
    }
    locale = candidate;
  }

  let region: string | undefined;
  const rawRegion = headers.get(REGION_HEADER);
  if (rawRegion !== null) {
    const candidate = rawRegion.trim();
    if (!isUsableTag(candidate)) {
      return {
        ok: false,
        detail: `${REGION_HEADER}: when present, expected a region tag like 'US' (alphanumeric runs joined by hyphens, at most ${MAX_TAG_LENGTH} characters)`,
      };
    }
    region = candidate;
  }

  return { ok: true, locale, ...(region !== undefined ? { region } : {}) };
}

/** The typed outcome of parsing the Authorization header. */
export type BearerTokenResult =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly detail: string }
  | { readonly kind: "present"; readonly token: string };

/**
 * R02: parse the `Authorization` header PURELY — shape only (Bearer scheme
 * + a bounded non-empty token). VALIDATION (hash lookup, expiry,
 * revocation) belongs to the session layer. A malformed authorization is
 * a 401, never silently ignored: presented-but-broken credentials are
 * rejected, not dropped.
 */
export function readBearerToken(headers: Headers): BearerTokenResult {
  const raw = headers.get(AUTHORIZATION_HEADER);
  if (raw === null) return { kind: "absent" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "absent" };
  const schemeMatch = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (schemeMatch === null) {
    return {
      kind: "malformed",
      detail: "authorization: expected 'Bearer <session token>' (the R02 session channel)",
    };
  }
  const token = (schemeMatch[1] ?? "").trim();
  if (token.length === 0 || token.length > MAX_IDENTITY_LENGTH || CONTROL_CHARS.test(token)) {
    return {
      kind: "malformed",
      detail: "authorization: the bearer token is empty or malformed",
    };
  }
  return { kind: "present", token };
}

/**
 * Read and validate the `ConnectorContext` off a request's headers (the
 * ANONYMOUS channel — the frozen transport law, unchanged).
 *
 * @returns the context on success, or a typed `detail` naming the exact
 * header and problem — the message the 400 answer carries.
 */
export function readConnectorContext(headers: Headers): IdentityResult {
  const rawUserId = headers.get(USER_ID_HEADER);
  if (rawUserId === null) {
    return {
      ok: false,
      detail: `${USER_ID_HEADER}: required identity header is absent (identity travels as headers, never in URLs)`,
    };
  }
  const userId = rawUserId.trim();
  if (!isUsableToken(userId)) {
    return {
      ok: false,
      detail: `${USER_ID_HEADER}: expected a non-empty token of at most ${MAX_IDENTITY_LENGTH} characters without control characters`,
    };
  }

  const rawSessionId = headers.get(SESSION_ID_HEADER);
  if (rawSessionId !== null) {
    const sessionId = rawSessionId.trim();
    if (!isUsableToken(sessionId)) {
      return {
        ok: false,
        detail: `${SESSION_ID_HEADER}: when present, expected a non-empty token of at most ${MAX_IDENTITY_LENGTH} characters without control characters`,
      };
    }
  }

  const localeRegion = readLocaleAndRegion(headers);
  if (!localeRegion.ok) return { ok: false, detail: localeRegion.detail };

  const ctx: ConnectorContext = {
    userId,
    locale: localeRegion.locale,
    ...(localeRegion.region !== undefined ? { region: localeRegion.region } : {}),
  };
  return { ok: true, ctx };
}
