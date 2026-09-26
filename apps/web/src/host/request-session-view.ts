/**
 * @wfx/app-web — the page-level session view read (R28-B).
 *
 * THE HONEST SESSION TRUTH FOR SURFACES: the pages render through the
 * ANONYMOUS host singleton by design (the one-runtime-at-boot law), so a
 * page that needs the SIGN-IN truth (the comments composer's gate — the
 * corpus's logged-out behavior) reads it here: the request's session
 * cookie resolved through the SAME machinery `/api/auth/session` uses
 * (the fixtures persona's scripted state, or the real `/auth/me`
 * continuity probe) — never a fabricated profile, never a second session
 * store. An absent/rejected token answers the honest signed-out view.
 */

import { cookies } from "next/headers";

import { authReadSession } from "@/host/auth-transport";
import type { HostConfig } from "@/host/config";
import {
  FIXTURE_AUTH_TOKEN,
  fixtureSessionView,
  readFixtureAuthState,
} from "@/host/auth-fixtures";
import { SESSION_COOKIE_NAME } from "@/host/session-cookie";

/** The page-level session view (the composer gate's input). */
export interface RequestSessionView {
  readonly signedIn: boolean;
  /** The active profile's display name, present iff signed in. */
  readonly profileName?: string;
  /**
   * R30-B — the account-menu fields (present iff signed in): the corpus
   * account menu's header + the Switch-account affordance need the
   * account's own identity data (the email — WebFlix's real identity
   * datum where the corpus carries a handle; the profiles + the active
   * selection — the real switch write's inputs). The composer gate's
   * use (signedIn + profileName) is unchanged — a pure widening.
   */
  readonly account?: {
    /** The account's email (the real identity datum — never a fabricated handle). */
    readonly email?: string;
    /** The account's profiles (the Switch account row's data). */
    readonly profiles: readonly { readonly id: string; readonly displayName: string }[];
    /** The session's active profile id. */
    readonly activeProfileId: string;
  };
}

/** The honest signed-out view (never a fake profile). */
const SIGNED_OUT: RequestSessionView = { signedIn: false };

/** The account fields of one resolved session view (R30-B — the widening). */
function accountOf(
  user: { readonly email?: string },
  profiles: readonly { readonly id: string; readonly displayName: string }[],
  activeProfileId: string,
): NonNullable<RequestSessionView["account"]> {
  return {
    profiles: profiles.map((profile) => ({ id: profile.id, displayName: profile.displayName })),
    activeProfileId,
    ...(user.email !== undefined && user.email.length > 0 ? { email: user.email } : {}),
  };
}

/** Read the request's session truth (the page-level /api/auth/session logic). */
export async function readRequestSessionView(config: HostConfig): Promise<RequestSessionView> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "";
  if (token.length === 0) return SIGNED_OUT;

  // Fixtures mode: the loud dev persona's scripted state.
  if (config.mode === "fixtures") {
    if (token !== FIXTURE_AUTH_TOKEN || readFixtureAuthState().signedIn !== true) {
      return SIGNED_OUT;
    }
    const view = fixtureSessionView();
    const active = view.profiles.find((profile) => profile.id === view.activeProfileId);
    return {
      signedIn: true,
      ...(active !== undefined ? { profileName: active.displayName } : {}),
      account: accountOf(view.user, view.profiles, view.activeProfileId),
    };
  }

  // Service mode: the REAL continuity probe (the same transport the route uses).
  const result = await authReadSession({ apiBase: config.apiBase }, token);
  if (!result.ok) return SIGNED_OUT;
  const active = result.value.profiles.find((profile) => profile.id === result.value.activeProfileId);
  return {
    signedIn: true,
    ...(active !== undefined ? { profileName: active.displayName } : {}),
    account: accountOf(result.value.user, result.value.profiles, result.value.activeProfileId),
  };
}
