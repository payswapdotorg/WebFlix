/**
 * @wfx/app-web — the auth session cookie law (R21-B).
 *
 * The ONE module that owns the web adapter's session COOKIE:
 *
 * - `wfx_session` — httpOnly, same-site=lax, path=/ — the BEARER token's
 *   carrier between the browser and this host. The token itself NEVER
 *   reaches client JS (httpOnly) and NEVER rides a URL (the frozen
 *   identity law).
 * - The cookie is set ONLY by the typed auth routes (`/api/auth/login`,
 *   `/api/auth/register`) and cleared ONLY by `/api/auth/logout` — never
 *   by a render path.
 * - These helpers are PURE cookie-law utilities (no transport, no state);
 *   the routes compose them with the auth transport (service mode) or
 *   the loud dev persona (fixtures mode).
 */

/** The session cookie's canonical name (the one law, every route). */
export const SESSION_COOKIE_NAME = "wfx_session";

/** The session cookie's attributes (httpOnly: the token never reaches client JS). */
export const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  // NOTE: `secure` is deliberately the deployer's concern (behind HTTPS
  // it should be set); the dev http boot must stay able to carry the
  // cookie. The attributes here are the MINIMUM honest set.
} as const;

/** Build the Set-Cookie header value for a fresh session token. */
export function sessionCookieFor(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Build the Set-Cookie header value that clears the session cookie. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Read the session token from a request's Cookie header (null when absent). */
export function sessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    const name = trimmed.slice(0, equals);
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = trimmed.slice(equals + 1);
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : null;
  }
  return null;
}
