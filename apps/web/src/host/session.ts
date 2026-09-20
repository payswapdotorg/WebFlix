/**
 * @wfx/app-web — the Web session module (R07; R21-B identity completion).
 *
 * The ONE module that owns the web adapter's session identity. Two honest
 * modes, one signature:
 *
 * - ANONYMOUS (the R07 mode): the established `x-wfx-user-id:
 *   wfx-anonymous` flow — cleanly isolated HERE, an EXPLICIT typed state
 *   (never a fake signed-in profile).
 * - AUTHENTICATED (R21-B): the resolved account identity from the R02
 *   service transport (`host/auth-transport.ts`) or the dev-fixture
 *   persona (`host/auth-fixtures.ts`) — the active profile rides the
 *   runtime context (`profileId`), the bearer token rides the
 *   ServerPort binding, and every profile-aware operation scopes to the
 *   account's server-side state (cross-device continuity).
 *
 * R21-B NOTE — the stale-copy law: this module's anonymous description
 * previously read "Sign-in and profiles arrive with the identity lane
 * (R02)". R02 is an ACCEPTED lane with a live service; the copy died at
 * its source. The honest anonymous state now names the real path
 * (signing in) instead of a completed lane's "later".
 *
 * HONESTY LAWS:
 *
 * - The anonymous mode is an EXPLICIT, typed state — never a fake
 *   signed-in profile.
 * - The authenticated mode binds ONLY a transport-RESOLVED identity (the
 *   auth transport's `/auth/me` truth or the loud dev persona) — this
 *   module never fabricates an account.
 * - A stored sign-in that the service does not accept degrades HONESTLY
 *   to the named signed-out state with its reason — nothing pretends.
 * - The session id is STABLE within the storage window when storage
 *   exists (the kv key `session:id`; the caller names the window
 *   truthfully) and per-boot minted when it does not.
 * - The locale comes from the environment (WFX_LOCALE override, then the
 *   navigator language when a browser context provides one, then `"en"`).
 * - Identity rides as HEADERS on the transport (`x-wfx-user-id`,
 *   `x-wfx-session-id`; the bearer token on the port binding) — never in
 *   URLs (the frozen transport law).
 */

import type { RuntimeContext, RuntimeIdGen } from "@wfx/client-runtime";

import type { WebEnvironment } from "@/platform/environment";

/** The anonymous user identity (the anonymous mode's stable handle). */
export const ANONYMOUS_USER_ID = "wfx-anonymous";

/** The kv key the stable session id is persisted under (when storage exists). */
const SESSION_ID_KEY = "session:id";

/** The environment variable that overrides the locale (deploy law). */
const LOCALE_ENV = "WFX_LOCALE";

/**
 * A transport-RESOLVED authenticated identity (never fabricated here):
 * what `auth-transport.ts`'s `authReadSession` answers for a valid token
 * (or the loud dev persona's view in fixtures mode).
 */
export interface AuthenticatedIdentity {
  /** The account's user view (id, email, displayName). */
  readonly user: { readonly id: string; readonly displayName: string; readonly email?: string };
  /** The account's profiles (the switch affordance's data). */
  readonly profiles: readonly { readonly id: string; readonly displayName: string }[];
  /** The session's active profile (the runtime context's `profileId`). */
  readonly activeProfileId: string;
}

/** One resolved web session: the runtime context + the honest state view. */
export interface WebSession {
  /** The identity context the runtime + ServerPort are bound to. */
  readonly context: RuntimeContext;
  /** The honest session-state view every profile-adjacent surface renders. */
  readonly state: WebSessionState;
}

/**
 * The honest session state. `signedIn` is true ONLY for a
 * transport-resolved identity — never a guess, never a fixture in
 * service mode.
 */
export interface WebSessionState {
  /** True iff an authenticated identity is bound (the account's own truth). */
  readonly signedIn: boolean;
  /** The user-facing label of the current identity mode. */
  readonly label: string;
  /** The honest, user-facing description (rendered verbatim by surfaces). */
  readonly description: string;
  /** The session id's durability window (the truth about its stability). */
  readonly sessionDurability: "browser-sessions" | "process-lifetime";
  /** Present iff signed in: the active profile + the switch affordance's data. */
  readonly profile?: {
    readonly activeProfileId: string;
    readonly activeProfileName: string;
    readonly profiles: readonly { readonly id: string; readonly displayName: string }[];
  };
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
      "You are browsing in an anonymous session. Sign in to bring your history, watchlist, and profiles across devices — until then, this session stays honestly session-scoped and nothing pretends to be a profile." +
      note,
    sessionDurability,
  };
}

/**
 * The honest signed-in state (a transport-RESOLVED identity only — the
 * active profile's truth with the switch affordance's data).
 */
export function authenticatedSessionState(
  identity: AuthenticatedIdentity,
  sessionDurability: WebSessionState["sessionDurability"],
): WebSessionState {
  const active = identity.profiles.find(
    (profile) => profile.id === identity.activeProfileId,
  );
  return {
    signedIn: true,
    label: active?.displayName ?? identity.user.displayName,
    description: `Signed in as ${identity.user.displayName}${
      active !== undefined ? ` — watching as ${active.displayName}` : ""
    }. Your profiles, history, and saved items follow this account on every device.`,
    sessionDurability,
    profile: {
      activeProfileId: identity.activeProfileId,
      activeProfileName: active?.displayName ?? identity.activeProfileId,
      profiles: [...identity.profiles],
    },
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
  /**
   * R21-B: the transport-RESOLVED authenticated identity. When present,
   * the session binds the account (context userId + profileId; the
   * signed-in state view). When absent, the anonymous mode answers
   * honestly. This module never resolves the identity itself — the auth
   * transport (service mode) or the loud dev persona (fixtures mode)
   * does, and hands the RESOLVED truth here.
   */
  readonly identity?: AuthenticatedIdentity;
}

/**
 * Resolve the web session: the identity binding (authenticated when a
 * RESOLVED identity is supplied; the honest anonymous mode otherwise)
 * bound to a stable session id within the available storage window.
 */
export async function resolveWebSession(options: WebSessionOptions): Promise<WebSession> {
  const env = options.env ?? {};
  const environment = options.environment ?? null;
  const kv = options.kv;
  const identity = options.identity;

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

  if (identity !== undefined) {
    return {
      context: {
        userId: identity.user.id,
        sessionId,
        locale: resolveLocale(env, environment),
        profileId: identity.activeProfileId,
      },
      state: authenticatedSessionState(identity, durability),
    };
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
