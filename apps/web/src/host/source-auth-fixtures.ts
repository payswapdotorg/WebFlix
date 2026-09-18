/**
 * @wfx/app-web — the DEV-ONLY source-auth fixture feed (R17).
 *
 * ⚠️ TEST/DEV ONLY — the 050 environment law ⚠️
 *
 * This module exists ONLY in fixtures mode (`WFX_DEV_FIXTURES=1` — the loud
 * dev badge): a deterministic, scripted source-authorization lifecycle that
 * flows through the REAL runtime source-state machinery
 * (`ServerPort.readSources` → `runtime.sources` → the settings sources
 * surface) — the SAME code path the production transport's /sources read
 * feeds. It is how the J28 web journey (credential expiry → the named
 * expired state → the typed unauthorized read → reauthorize → recovery) is
 * browser-validated before the service lane serves real OAuth. In service
 * mode NOTHING here runs: the reads answer nothing from this module and the
 * surfaces render their honest service-mode states (a fixture is never
 * silently presented as production capability — invariant 10).
 *
 * THE SCRIPTED LIFECYCLE (the J28 states, deterministic):
 * - `signedIn` (the default): the fixture catalog's own source, healthy —
 *   reads work exactly as they always did.
 * - `expired` (the dev `expire` drive): the stored authorization elapsed.
 *   The SourceInfo carries the NAMED `expired` auth state, the past
 *   `expiresAt`, the honest availability note — and EVERY source read
 *   (resolve/metadata/search) answers the TYPED `unauthorized` failure
 *   with the classified credential state (never a silent fallback, never a
 *   fake success).
 * - `signedOut` (the dev `disconnect` drive): no connection (the honest
 *   empty truth — reads answer the typed `missing` credential failure).
 *
 * HONESTY LAWS KEPT HERE:
 * - READS NEVER ADVANCE THE SCRIPT: the state is read fresh from the
 *   shared file per call; only the typed POST actions move it.
 * - THE STATE IS DATA: the drive answers typed `SourceInfo` rows (the
 *   server's /sources row shape) — the runtime validates them exactly as
 *   it validates the real transport's rows.
 * - THE DEV-SERVER SPLIT-MODULE REALITY: the same file-backed cursor law
 *   the acquisition fixtures follow (route modules and page modules are
 *   separate module graphs in the Turbopack dev server — the state lives
 *   in a small JSON file they share).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SourceInfo } from "@wfx/client-runtime";

/** The fixture catalog's own connector (the source every fixture item uses). */
export const FIXTURE_SOURCE_CONNECTOR_ID = "fake-source";

/** The shared dev-state file (fixed path: the page + route modules agree). */
export const SOURCE_AUTH_FIXTURE_STATE_FILE = join(
  tmpdir(),
  "wfx-dev-source-auth-fixtures.json",
);

/** The scripted authorization states (the J28 lifecycle vocabulary). */
export type FixtureSourceAuthState = "signedIn" | "expired" | "signedOut";

/** The typed drive result. */
export type SourceAuthDriveResult =
  | { readonly ok: true; readonly source: SourceInfo }
  | { readonly ok: false; readonly status: number; readonly error: string };

/** The drive actions the fixtures-mode POST accepts. */
export type SourceAuthDriveAction = "expire" | "reauthorize" | "connect" | "disconnect";

const T0 = Date.parse("2026-09-18T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/** The deterministic capability truth of the fixture catalog's source. */
const FIXTURE_SOURCE_CAPABILITIES: Readonly<Record<string, boolean>> = {
  identity: false,
  catalogSearch: true,
  metadata: true,
  playNative: false,
  playEmbed: true,
  playBrowser: true,
  playExternal: true,
  availability: true,
  libraryRead: false,
  libraryWrite: false,
  like: false,
  save: false,
  follow: false,
  comment: false,
  download: false,
  transform: false,
};

/** Build the scripted `SourceInfo` for one authorization state (pure). */
export function fixtureSourceInfoOf(state: FixtureSourceAuthState): SourceInfo {
  const base: SourceInfo = {
    connectorId: FIXTURE_SOURCE_CONNECTOR_ID,
    displayName: "Fake Source (TEST FIXTURE — never production)",
    version: "1.0.0",
    authMode: "oauth",
    capabilities: { ...FIXTURE_SOURCE_CAPABILITIES } as SourceInfo["capabilities"],
    authState: state,
    requiresAuthorization: true,
    connected: state === "signedIn",
    accountId: state === "signedOut" ? null : "wfxacct_fixture0000000000000A",
    authorizedAt: state === "signedOut" ? null : iso(T0 - 3_600_000),
    lastStateChange: iso(T0),
    expiresAt:
      state === "signedIn"
        ? iso(T0 + 30 * 24 * 3_600_000) // a month out — healthy
        : state === "expired"
          ? iso(T0 - 1_000) // just elapsed — the named expired state
          : null,
    availabilityNotes:
      state === "expired"
        ? ["The stored authorization expired — reconnect to restore this source."]
        : state === "signedOut"
          ? ["This source is not connected."]
          : [],
    lastChecked: iso(T0),
  };
  return base;
}

/** Read the current scripted authorization state (missing/corrupt ⇒ signedIn). */
export function readFixtureSourceAuthState(): FixtureSourceAuthState {
  if (!existsSync(SOURCE_AUTH_FIXTURE_STATE_FILE)) return "signedIn";
  try {
    const parsed = JSON.parse(readFileSync(SOURCE_AUTH_FIXTURE_STATE_FILE, "utf8")) as {
      authState?: unknown;
    };
    if (
      parsed.authState === "signedIn" ||
      parsed.authState === "expired" ||
      parsed.authState === "signedOut"
    ) {
      return parsed.authState;
    }
    return "signedIn";
  } catch {
    return "signedIn"; // a corrupt file is the pristine state (dev harness)
  }
}

/** Persist the scripted authorization state (best-effort — dev harness only). */
function writeFixtureSourceAuthState(state: FixtureSourceAuthState): void {
  try {
    writeFileSync(SOURCE_AUTH_FIXTURE_STATE_FILE, JSON.stringify({ authState: state }, null, 2));
  } catch {
    // A failed write leaves the previous state (dev harness only).
  }
}

/**
 * Whether the fixture source's reads must fail with the TYPED unauthorized
 * credential failure right now (the J28 "typed unauthorized read"): an
 * EXPIRED authorization never silently degrades to working reads — and a
 * SIGNED-OUT source honestly refuses too (the `missing` classification).
 */
export function fixtureSourceReadFailure():
  | { kind: "unauthorized"; detail: string; credential: { state: "expired" | "missing"; connectorId: string } }
  | null {
  const state = readFixtureSourceAuthState();
  if (state === "expired") {
    return {
      kind: "unauthorized",
      detail: "the stored authorization for this source expired — every read is refused until it is reconnected",
      credential: { state: "expired", connectorId: FIXTURE_SOURCE_CONNECTOR_ID },
    };
  }
  if (state === "signedOut") {
    return {
      kind: "unauthorized",
      detail: "this source is not connected — connect it to read from it",
      credential: { state: "missing", connectorId: FIXTURE_SOURCE_CONNECTOR_ID },
    };
  }
  return null;
}

/**
 * Drive the scripted authorization lifecycle (the fixtures-mode POST path):
 * the typed actions + the clearly-labeled dev `expire` step, persisted to
 * the SHARED state file. READS NEVER ADVANCE.
 */
export function driveSourceAuthFixture(input: {
  readonly action: SourceAuthDriveAction | string;
}): SourceAuthDriveResult {
  const current = readFixtureSourceAuthState();
  switch (input.action) {
    case "expire": {
      // The clearly-labeled DEV control (J28's deterministic expiry).
      if (current === "signedOut") {
        return { ok: false, status: 409, error: "the source is disconnected — connect it first" };
      }
      if (current === "expired") {
        return { ok: true, source: fixtureSourceInfoOf("expired") }; // idempotent
      }
      writeFixtureSourceAuthState("expired");
      return { ok: true, source: fixtureSourceInfoOf("expired") };
    }
    case "reauthorize": {
      // The re-auth recovery path: preserved account, fresh authorization.
      if (current === "signedIn") {
        return { ok: false, status: 409, error: "the source's authorization is current — nothing to reconnect" };
      }
      writeFixtureSourceAuthState("signedIn");
      return { ok: true, source: fixtureSourceInfoOf("signedIn") };
    }
    case "connect": {
      if (current === "signedIn") {
        return { ok: false, status: 409, error: "the source is already connected" };
      }
      writeFixtureSourceAuthState("signedIn");
      return { ok: true, source: fixtureSourceInfoOf("signedIn") };
    }
    case "disconnect": {
      if (current === "signedOut") {
        return { ok: true, source: fixtureSourceInfoOf("signedOut") }; // idempotent
      }
      writeFixtureSourceAuthState("signedOut");
      return { ok: true, source: fixtureSourceInfoOf("signedOut") };
    }
    default:
      return { ok: false, status: 400, error: `unknown source action '${String(input.action)}'` };
  }
}

/** TEST-ONLY: reset the fixture source-auth state to pristine (signedIn). */
export function resetSourceAuthFixturesForTests(): void {
  try {
    rmSync(SOURCE_AUTH_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // An absent file is already pristine.
  }
}
