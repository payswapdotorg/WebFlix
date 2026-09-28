/**
 * @wfx/app-web — the session-intent cookie law (R35, the C2 read-path fix).
 *
 * The ONE module that owns the web adapter's SESSION-INTENT COOKIE:
 *
 * - `wfx_session_intent` — httpOnly, same-site=lax, path=/, a SESSION
 *   cookie (no Max-Age/Expires: it dies with the browser session — the
 *   intent's own scope, "ends with this session"). It carries the
 *   viewer's active SESSION-SCOPED recommendation objectives — the plain
 *   strings the Personalize control submits through `POST /api/personalize`
 *   `{kind:"intent"}` — and NOTHING else (no ids, no weights, no durable
 *   scopes: those live in the service's intent store by the IntentStore
 *   law and NEVER ride a cookie).
 *
 * WHY A COOKIE (the C2 root): the IntentStore law keeps `session`-scoped
 * intents OUT of the server's durable records (they are cleared at
 * `endSession` by law, so persisting them would corrupt that truth) —
 * but on the service-mode boot each page render is a COLD runtime whose
 * per-instance intent set is empty, so the watch page's SSR discovery
 * bundle rendered no intent mark after a successful POST (the R34-A
 * ledger's C2: the POST/GET round trip worked — same instance — while
 * the page's read never hydrated). The cookie is the session-scoped
 * carrier the WEB adapter owns (the same law `wfx_session` follows for
 * the bearer): the POST writes it, the clear-intent empties it, and the
 * pages' discovery reads merge it (LOCAL entries win per objective — the
 * same merge law the IntentStore's own `hydrate` follows). Never a
 * fabricated state: the mark renders only when an objective actually
 * rides the request.
 *
 * - The cookie is set ONLY by `/api/personalize` (the intent write +
 *   clear paths); never by a render path (the `wfx_session` law's shape).
 * - Identity NEVER rides it (the frozen transport law: identity travels
 *   as headers — this cookie carries viewer state, not identity).
 * - The payload is structurally guarded on read (a bounded JSON array of
 *   bounded non-empty strings; anything else reads as the honest empty
 *   set — never trusted blindly, never fatal).
 */

/** The session-intent cookie's canonical name (one law, every route). */
export const SESSION_INTENT_COOKIE_NAME = "wfx_session_intent";

/**
 * The cookie's attributes (httpOnly: the objectives never reach client
 * JS; a session cookie — no Max-Age — so it ends with the browser
 * session, exactly the intent's own scope).
 */
export const SESSION_INTENT_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
} as const;

/** The bound on carried objectives (one calm session's set — never unbounded). */
export const SESSION_INTENT_MAX = 8;

/** The bound on one objective's length (the control's own input bound). */
export const SESSION_INTENT_MAX_LENGTH = 120;

/** Build the Set-Cookie header value for the carried objectives. */
export function sessionIntentCookieFor(objectives: readonly string[]): string {
  const body = JSON.stringify(objectives.slice(0, SESSION_INTENT_MAX));
  return `${SESSION_INTENT_COOKIE_NAME}=${encodeURIComponent(body)}; Path=/; HttpOnly; SameSite=Lax`;
}

/** Build the Set-Cookie header value that clears the session-intent cookie. */
export function clearedSessionIntentCookie(): string {
  return `${SESSION_INTENT_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Read the carried objectives off a request's Cookie header (the routes'
 * pure parse — the same shape `sessionTokenFromRequest` follows): split
 * the header, then {@link sessionIntentObjectivesOfValue} guards the
 * payload. A structurally-invalid payload reads as the honest empty set
 * (bounded, deduped, order-stable); never trusted blindly, never fatal.
 */
export function sessionIntentObjectivesFromCookieHeader(
  header: string | null,
): readonly string[] {
  if (header === null) return [];
  let raw: string | null = null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    if (trimmed.slice(0, equals) !== SESSION_INTENT_COOKIE_NAME) continue;
    raw = decodeURIComponent(trimmed.slice(equals + 1));
    break;
  }
  return sessionIntentObjectivesOfValue(raw);
}

/**
 * Guard the cookie's payload (the already-extracted value — the header
 * split and the cookie-store decode are the callers'): a bounded JSON
 * array of bounded non-empty strings, deduped and order-stable. Anything
 * else reads as the honest empty set — never trusted blindly, never
 * fatal, one bad element never poisons the honest rest.
 */
export function sessionIntentObjectivesOfValue(
  value: string | null | undefined,
): readonly string[] {
  if (value === null || value === undefined || value.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return []; // not adapter-written (or tampered): the honest empty set
  }
  if (!Array.isArray(parsed)) return [];
  const objectives: string[] = [];
  for (const candidate of parsed) {
    if (
      typeof candidate !== "string" ||
      candidate.trim().length === 0 ||
      candidate.length > SESSION_INTENT_MAX_LENGTH
    ) {
      continue; // one bad element never poisons the honest rest
    }
    if (!objectives.includes(candidate)) objectives.push(candidate);
    if (objectives.length >= SESSION_INTENT_MAX) break;
  }
  return objectives;
}

/**
 * Merge the runtime's active session objectives with the request-carried
 * ones (dedup by objective — the runtime's own submissions are the
 * freshest truth, the same per-key law the IntentStore's hydrate
 * follows; the carried set fills what this instance's fold never saw).
 * Pure, bounded, order-stable.
 */
export function mergeSessionIntentObjectives(
  active: readonly string[],
  carried: readonly string[],
): readonly string[] {
  const merged: string[] = [];
  for (const objective of [...active, ...carried]) {
    if (objective.trim().length === 0) continue;
    if (!merged.includes(objective)) merged.push(objective);
    if (merged.length >= SESSION_INTENT_MAX) break;
  }
  return merged;
}
