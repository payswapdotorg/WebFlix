/**
 * @wfx/app-web — the Web session module (R07): the anonymous-mode SEAM.
 *
 * The ONE module that owns the web adapter's session identity. R07 ships
 * the anonymous session mode (the established `x-wfx-user-id:
 * wfx-anonymous` flow, cleanly isolated HERE); R02's identity/profiles
 * lane replaces the internals of this module with the token-based session
 * (server-issued identity, profile selection) WITHOUT ADAPTER SURGERY —
 * every consumer goes through `resolveWebSession()` and
 * `describeSessionState()`, never through the constants themselves.
 *
 * HONESTY LAWS:
 *
 * - The anonymous mode is an EXPLICIT, typed state — never a fake signed-in
 *   profile. `anonymousSessionState()` answers the honest signed-out state
 *   every surface that would show a profile renders ("Signed out —
 *   anonymous session").
 * - The session id is STABLE within the storage window when storage exists
 *   (the kv key `session:id`; the caller names the window truthfully —
 *   browser-durable when localStorage backs the kv, process-lifetime
 *   otherwise) and per-boot minted when it does not. Whichever window
 *   applies is the truth; nothing pretends.
 * - The locale comes from the environment (WFX_LOCALE override, then the
 *   navigator language when a browser context provides one, then `"en"`).
 * - Identity rides as HEADERS on the transport (`x-wfx-user-id`,
 *   `x-wfx-session-id`) — never in URLs (the frozen transport law; the
 *   ServerPort is bound to the context this module resolves).
 *
 * R02 INTEGRATION CONTRACT (what changes, what does not):
 * - `resolveWebSession` keeps its signature; its internals swap the
 *   anonymous constant for the authenticated identity source (token
 *   storage, refresh, profile scoping).
 * - `WebSessionState.signedIn` becomes truthful once R02's auth flows
 *   land; until then it is HONESTLY `false` and surfaces render the
 *   signed-out state.
 */

import type { RuntimeContext, RuntimeIdGen } from "@wfx/client-runtime";

import type { WebEnvironment } from "@/platform/environment";

/** The anonymous user identity (the R07 stopgap — R02 replaces the source). */
export const ANONYMOUS_USER_ID = "wfx-anonymous";

/** The kv key the stable session id is persisted under (when storage exists). */
const SESSION_ID_KEY = "session:id";

/** The environment variable that overrides the locale (deploy law). */
const LOCALE_ENV = "WFX_LOCALE";

/** One resolved web session: the runtime context + the honest state view. */
export interface WebSession {
  /** The identity context the runtime + ServerPort are bound to. */
  readonly context: RuntimeContext;
  /** The honest session-state view every profile-adjacent surface renders. */
  readonly state: WebSessionState;
}

/** The honest session state (the signed-out anonymous mode, named for what it is). */
export interface WebSessionState {
  /** Truthfully `false` in R07 — the anonymous mode is not a signed-in profile. */
  readonly signedIn: boolean;
  /** The user-facing label of the current identity mode. */
  readonly label: string;
  /** The honest, user-facing description (rendered verbatim by surfaces). */
  readonly description: string;
  /** The session id's durability window (the truth about its stability). */
  readonly sessionDurability: "browser-sessions" | "process-lifetime";
}

/** The honest signed-out state (the anonymous mode, named for what it is). */
export function anonymousSessionState(
  sessionDurability: WebSessionState["sessionDurability"],
  extraNote?: string,
): WebSessionState {
  const note =
    extraNote !== undefined && extraNote.length > 0 ? ` ${extraNote}` : "";
  return {
    signedIn: false,
    label: "Signed out",
    description:
      "You are browsing in an anonymous session. WebFlix keeps this session's watch history and library honestly session-scoped — nothing pretends to be a profile." +
      note,
    sessionDurability,
  };
}

/** Options for {@link resolveWebSession}. */
export interface WebSessionOptions {
  /** The id seam (session ids are minted when no stable one is stored). */
  readonly ids: RuntimeIdGen;
  /** The environment variables to read (default: none — tests inject). */
  readonly env?: Record<string, string | undefined>;
  /** The browser environment (locale detection; default: none). */
  readonly environment?: WebEnvironment;
  /**
   * The kv read/write seam the stable session id persists through. When
   * absent, the session id is per-call minted (the caller supplies the
   * durability truth).
   */
  readonly kv?: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  /**
   * The TRUTHFUL durability of `kv` when provided: "browser-sessions"
   * (localStorage-backed) or "process-lifetime". The caller knows which
   * backend it wired; this module never guesses.
   */
  readonly kvDurability?: "browser-sessions" | "process-lifetime";
}

/**
 * Resolve the web session: the anonymous identity (R07) bound to a stable
 * session id within the available storage window, with the honest
 * signed-out state. R02 replaces the internals; the signature is the seam.
 */
export async function resolveWebSession(options: WebSessionOptions): Promise<WebSession> {
  const env = options.env ?? {};
  const environment = options.environment ?? null;
  const kv = options.kv;

  let sessionId: string;
  let durability: WebSessionState["sessionDurability"] = "process-lifetime";
  let note = "";
  if (kv !== undefined) {
    durability = options.kvDurability === "browser-sessions" ? "browser-sessions" : "process-lifetime";
    try {
      const stored = await kv.get(SESSION_ID_KEY);
      if (stored !== null && stored.length > 0) {
        sessionId = stored;
      } else {
        sessionId = options.ids.next();
        await kv.set(SESSION_ID_KEY, sessionId);
      }
    } catch {
      // Storage failed: the honest fallback is a minted per-boot id —
      // never a fabricated "stable" one.
      sessionId = options.ids.next();
      durability = "process-lifetime";
      note = "(Session storage was unavailable — the session id is per-boot.)";
    }
  } else {
    sessionId = options.ids.next();
  }

  return {
    context: {
      userId: ANONYMOUS_USER_ID,
      sessionId,
      locale: resolveLocale(env, environment),
    },
    state: anonymousSessionState(durability, note),
  };
}

/** The locale law: env override, then the navigator language, then "en". */
function resolveLocale(
  env: Record<string, string | undefined>,
  environment: WebEnvironment | null,
): string {
  const override = env[LOCALE_ENV]?.trim();
  if (override !== undefined && override.length > 0) return override;
  const navigatorLanguage = environment?.navigator?.language;
  if (typeof navigatorLanguage === "string" && navigatorLanguage.trim().length > 0) {
    // "en-US" → "en" (the transport carries the primary subtag).
    return navigatorLanguage.trim().split("-")[0] ?? "en";
  }
  return "en";
}
