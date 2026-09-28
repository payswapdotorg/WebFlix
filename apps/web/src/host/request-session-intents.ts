/**
 * @wfx/app-web — the request-scoped session-intent read (R35, the C2
 * read-path fix).
 *
 * The thin bridge between the Next.js request context and the
 * session-intent cookie law: server components (pages) read the
 * httpOnly `wfx_session_intent` cookie through `next/headers` and hand
 * the carried objectives to the discovery loaders — the same
 * request-scoped shape `request-session.ts` follows for the auth cookie.
 *
 * NOT imported by tests directly (it wraps `next/headers`, which only
 * exists inside a request scope); the cookie law itself is covered by
 * the pure `session-intent-cookie.ts` seam, and the composition through
 * the REAL pages by the route/loader tests.
 */

import { cookies } from "next/headers";

import { SESSION_INTENT_COOKIE_NAME, sessionIntentObjectivesOfValue } from "./session-intent-cookie";

/**
 * The request's carried session-intent objectives (the cookie's payload,
 * structurally guarded). Outside a request scope — or when the request
 * carries no cookie — the honest EMPTY set answers (the caller's runtime
 * fold is then the whole truth; never a fabricated objective).
 */
export async function readRequestSessionIntents(): Promise<readonly string[]> {
  try {
    const store = await cookies();
    return sessionIntentObjectivesOfValue(store.get(SESSION_INTENT_COOKIE_NAME)?.value);
  } catch {
    // No request scope (a tool/test calling the loader directly): the
    // honest empty set — the runtime fold answers on its own.
    return [];
  }
}
