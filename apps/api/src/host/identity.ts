/**
 * @wfx/app-api — request identity (the transport-contract header law).
 *
 * The frozen web client (`apps/web/src/host/remote-ports.ts`) rides the
 * `ConnectorContext` as REQUEST HEADERS — "identity travels as headers,
 * never in URLs":
 *
 * - `x-wfx-user-id`    — REQUIRED on every endpoint. The client always
 *   sends it (today the 050 anonymous stopgap `wfx-anonymous`; later the
 *   auth lane's session-scoped ids). Absent or garbage ⇒ typed 400.
 * - `x-wfx-session-id` — OPTIONAL (the client sends it on event posts).
 *   When present it must be a sane token; absent ⇒ simply not carried.
 * - `x-wfx-locale`     — OPTIONAL (the client always sends it in practice;
 *   the service defaults to `"en"` when absent). Validated when present.
 * - `x-wfx-region`     — OPTIONAL. Validated when present.
 *
 * Validation is deliberately shallow and honest: non-empty after trimming,
 * bounded length, no control characters, and for locale/region a
 * tag-shaped charset (`en`, `en-US`, `zh-Hans`, `US`, …). The service does
 * NOT attempt to authenticate the id — that is the auth lane's job — it
 * only refuses to route garbage.
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

/**
 * Read and validate the `ConnectorContext` off a request's headers.
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

  const ctx: ConnectorContext = { userId, locale, ...(region !== undefined ? { region } : {}) };
  return { ok: true, ctx };
}
