/**
 * @wfx/app-web — the request-scoped session helper (R21-B).
 *
 * The thin bridge between the Next.js request context and the
 * per-identity host map: server components (pages/loading) read the
 * httpOnly `wfx_session` cookie through `next/headers` and resolve the
 * request's host — anonymous when no cookie (the exact R07 behavior),
 * the identity's host when the cookie's token resolves. Route handlers
 * read the token from the Request itself (`sessionTokenFromRequest`) —
 * this module is the SERVER-COMPONENT path.
 *
 * NOT imported by tests directly (it wraps `next/headers`, which only
 * exists inside a request scope); its logic is covered through the
 * host-map tests (`getWebRuntimeHostForRequest`) and the route tests.
 */

import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "./session-cookie";
import { getWebRuntimeHostForRequest } from "./web-host";
import type { WebRuntimeHost } from "./web-host";

/**
 * The request's session token (the cookie's value) — `undefined` when
 * the request carries no session (the honest anonymous case).
 */
export async function readRequestSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The request-scoped host: the per-identity host map's answer for THIS
 * request's session (anonymous singleton when no cookie; the resolved
 * identity's host when the token is valid — see `web-host.ts`).
 */
export async function getWebRequestHost(): Promise<WebRuntimeHost> {
  const token = await readRequestSessionToken();
  return getWebRuntimeHostForRequest(token);
}
