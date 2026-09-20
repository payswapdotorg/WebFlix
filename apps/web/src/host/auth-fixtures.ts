/**
 * @wfx/app-web — the DEV-ONLY auth fixture persona (R21-B).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * This module exists ONLY in fixtures mode (`WFX_DEV_FIXTURES=1` — the
 * loud dev badge): a deterministic, scripted identity persona that flows
 * through the SAME session binding machinery the production transport
 * feeds (`resolveWebSession`'s authenticated path + the per-identity host
 * map). It is how the identity surfaces (sign-in, profile switch, the
 * session menu) run in dev BEFORE the service is configured — the same
 * law the source-auth fixtures (`source-auth-fixtures.ts`) follow for
 * the J28 credential lifecycle. In service mode NOTHING here runs: the
 * real `/auth/*` transport serves identity (a fixture is never silently
 * presented as production capability — invariant 10).
 *
 * THE SCRIPTED PERSONA (deterministic):
 * - the dev account `dev@webflix.local` / `dev-password-1`;
 * - the fixed fixture session token `wfxsess_devfixture…` (the cookie's
 *   fixtures-mode value — never a real issued token);
 * - TWO profiles ("Dev profile" + "Kids profile") so profile SWITCHING
 *   is exercisable in dev;
 * - the state (signed-in? active profile?) lives in a small shared JSON
 *   file — the same split-module law the acquisition/source-auth
 *   fixtures follow (route modules and page modules are separate module
 *   graphs in the dev server; the FILE is the one shared truth).
 *
 * HONESTY LAWS KEPT HERE:
 * - READS NEVER ADVANCE THE SCRIPT: the state is read fresh from the
 *   shared file per call; only the typed route drives move it.
 * - THE STATE IS DATA: `fixtureSessionView()` answers the SAME
 *   `AuthSessionView` shape the real transport's `/auth/me` read
 *   validates — one law, two transports.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthSessionView } from "./auth-transport";

/** The dev persona's fixed email (loudly a fixture — never production). */
export const FIXTURE_AUTH_EMAIL = "dev@webflix.local";

/** The dev persona's fixed password (loudly a fixture — never production). */
export const FIXTURE_AUTH_PASSWORD = "dev-password-1";

/** The fixtures-mode session token (the cookie value; starts with the wfxsess_ grammar). */
export const FIXTURE_AUTH_TOKEN = "wfxsess_devfixture0000000000000000";

/** The fixture account's fixed id. */
const FIXTURE_USER_ID = "wfxuser_devfixture";

/** The shared dev-state file (fixed path: the page + route modules agree). */
export const AUTH_FIXTURE_STATE_FILE = join(tmpdir(), "wfx-dev-auth-fixtures.json");

/** The scripted auth state (the identity lifecycle's dev drive). */
export interface FixtureAuthState {
  /** Whether the fixture persona is signed in (the cookie's truth). */
  readonly signedIn: boolean;
  /** The active profile id (the selection the surfaces render). */
  readonly activeProfileId: string;
}

/** The default state: signed out (a fresh dev boot pretends nothing). */
export const DEFAULT_FIXTURE_AUTH_STATE: FixtureAuthState = {
  signedIn: false,
  activeProfileId: "wfxprof_devprofile",
};

/** The fixture persona's deterministic profiles (two — switching is real). */
export const FIXTURE_PROFILES = [
  {
    id: "wfxprof_devprofile",
    userId: FIXTURE_USER_ID,
    displayName: "Dev profile",
    avatarSeed: "dev",
    isDefault: true,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  },
  {
    id: "wfxprof_kidsprofile",
    userId: FIXTURE_USER_ID,
    displayName: "Kids profile",
    avatarSeed: "kids",
    isDefault: false,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  },
] as const;

/** Read the shared fixture auth state (fresh per call; the default when absent). */
export function readFixtureAuthState(): FixtureAuthState {
  try {
    if (!existsSync(AUTH_FIXTURE_STATE_FILE)) return DEFAULT_FIXTURE_AUTH_STATE;
    const raw = JSON.parse(readFileSync(AUTH_FIXTURE_STATE_FILE, "utf8")) as {
      signedIn?: unknown;
      activeProfileId?: unknown;
    };
    return {
      signedIn: raw.signedIn === true,
      activeProfileId:
        typeof raw.activeProfileId === "string" &&
        FIXTURE_PROFILES.some((profile) => profile.id === raw.activeProfileId)
          ? raw.activeProfileId
          : DEFAULT_FIXTURE_AUTH_STATE.activeProfileId,
    };
  } catch {
    return DEFAULT_FIXTURE_AUTH_STATE;
  }
}

/** Write the shared fixture auth state (the typed route drives only). */
function writeFixtureAuthState(state: FixtureAuthState): void {
  writeFileSync(AUTH_FIXTURE_STATE_FILE, JSON.stringify(state), "utf8");
}

/** The fixture persona's session view (the /auth/me-shaped answer — one law, two transports). */
export function fixtureSessionView(): AuthSessionView {
  const state = readFixtureAuthState();
  return {
    user: {
      id: FIXTURE_USER_ID,
      email: FIXTURE_AUTH_EMAIL,
      displayName: "Dev (TEST FIXTURE — never production)",
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:00:00.000Z",
    },
    profiles: FIXTURE_PROFILES.map((profile) => ({ ...profile })),
    activeProfileId: state.activeProfileId,
  };
}

/** The typed login drive: validate the persona's credentials; sign in on match. */
export function driveFixtureLogin(
  email: string,
  password: string,
):
  | { readonly ok: true; readonly token: string; readonly session: AuthSessionView }
  | { readonly ok: false; readonly reason: "invalid-credentials" } {
  if (email.trim().toLowerCase() !== FIXTURE_AUTH_EMAIL || password !== FIXTURE_AUTH_PASSWORD) {
    return { ok: false, reason: "invalid-credentials" };
  }
  writeFixtureAuthState({ ...readFixtureAuthState(), signedIn: true });
  return { ok: true, token: FIXTURE_AUTH_TOKEN, session: fixtureSessionView() };
}

/** The typed logout drive: sign out (the state resets; nothing pretends). */
export function driveFixtureLogout(): void {
  writeFixtureAuthState(DEFAULT_FIXTURE_AUTH_STATE);
}

/** The typed profile-select drive (an unknown profile answers the typed refusal). */
export function driveFixtureSelectProfile(
  profileId: string,
):
  | { readonly ok: true; readonly session: AuthSessionView }
  | { readonly ok: false; readonly reason: "not-found" } {
  const profile = FIXTURE_PROFILES.find((candidate) => candidate.id === profileId);
  if (profile === undefined) return { ok: false, reason: "not-found" };
  writeFixtureAuthState({ signedIn: true, activeProfileId: profile.id });
  return { ok: true, session: fixtureSessionView() };
}

/** TEST-ONLY: reset the shared fixture state (the test-seam law). */
export function resetFixtureAuthStateForTests(): void {
  try {
    if (existsSync(AUTH_FIXTURE_STATE_FILE)) rmSync(AUTH_FIXTURE_STATE_FILE);
  } catch {
    // A missing file IS the default state — nothing to reset.
  }
}
