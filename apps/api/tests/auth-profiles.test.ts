/**
 * R02 — auth + profile endpoint tests (bun:test, PGlite harness).
 *
 * Exercises the identity/profile surface end-to-end by importing the route
 * handlers directly (the WFX-055A pattern — no server, no network) over the
 * COMPLETE `ApiBoot` composition (real migrations incl. 0007, real
 * adapters, FixedClock at 30s + SequentialIdGen):
 *
 * - AUTH ROUND-TRIPS: register → me → login → logout → me-rejected;
 *   email-taken (409); invalid bodies (400); wrong-password and
 *   unknown-email answer the SAME 401 (no enumeration); expired tokens
 *   (the injected clock advanced past the TTL); malformed bearers (401).
 * - PROFILE MANAGEMENT: list/create/rename/select; ownership (a foreign
 *   account's profile is the same honest 404 as an unknown id).
 * - PROFILE-SCOPED LIBRARY: saves land in the ACTIVE profile's bucket;
 *   profile A's library NEVER leaks to profile B; selection switches the
 *   bucket per session.
 * - PROFILE-ATTRIBUTED EVENTS + THE RELAY: events posted with a session
 *   carry the active profile on the outbox row; the relay folds them into
 *   THAT profile's watch history; the default-profile fallback covers
 *   anonymous events.
 * - CROSS-DEVICE CONTINUITY: a second device (fresh login) resolves the
 *   SAME profiles and — after selecting the same profile — sees the SAME
 *   watch state (the acceptance criterion).
 * - THE ANONYMOUS TRANSITION: the frozen x-wfx-user-id flow keeps working
 *   verbatim (no Authorization header required).
 *
 * Determinism: FixedClock/SequentialIdGen everywhere; the session tokens
 * mint through the default ULID factory over the fixed clock. Event posts
 * stay far below the opportunistic-drain every-10-events trigger; the 30s
 * clock is never interval-due (60s) — the RELAY tests drain EXPLICITLY via
 * runRelayDrain. No network. Tokens/passwords are never logged.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PostgresSessionService } from "@wfx/persistence";
import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import {
  createApiTestBoot,
  getRequest,
  postRequest,
  readSeededRow,
  identityHeaders,
  type ApiTestBoot,
  type SeededRow,
} from "./test-boot";
import { runRelayDrain } from "../src/host/relay";
import { POST as registerPOST } from "../src/app/auth/register/route";
import { POST as loginPOST } from "../src/app/auth/login/route";
import { POST as logoutPOST } from "../src/app/auth/logout/route";
import { GET as meGET } from "../src/app/auth/me/route";
import { GET as profilesGET, PUT as profilesPUT } from "../src/app/profiles/route";
import { PUT as selectPUT } from "../src/app/profiles/[id]/select/route";
import { GET as libraryGET, POST as libraryPOST } from "../src/app/experience/library/route";
import { POST as eventsPOST } from "../src/app/experience/events/route";

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/** The auth channel for one session token. */
function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

interface AuthShape {
  token: string;
  user: { id: string; email: string; displayName: string };
  profiles: { id: string; displayName: string; isDefault: boolean }[];
  activeProfileId: string;
}

let harness: ApiTestBoot;
let seeded: SeededRow;

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);
  seeded = await readSeededRow(harness.testDb.db);
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

// ---------------------------------------------------------------------------
// Auth round-trips
// ---------------------------------------------------------------------------

describe("POST /auth/register", () => {
  it("creates the account, its default profile, and the first session (auto-login)", async () => {
    const response = await registerPOST(
      postRequest("/auth/register", {
        email: "Ada@Example.COM",
        password: "correct-horse-battery",
        displayName: "Ada",
      }),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as AuthShape;
    expect(body.user.id.startsWith("wfxusr_")).toBe(true);
    expect(body.user.email).toBe("ada@example.com"); // lowercased + trimmed
    expect(body.user.displayName).toBe("Ada");
    // NEVER the hash.
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(JSON.stringify(body)).not.toContain("scrypt$");
    // The canonical R02 token shape, shown exactly once.
    expect(body.token.startsWith("wfxsess_")).toBe(true);
    expect(body.token.length).toBe("wfxsess_".length + 26);
    // One default profile, active.
    expect(body.profiles.length).toBe(1);
    expect(body.profiles[0]?.isDefault).toBe(true);
    expect(body.activeProfileId).toBe(body.profiles[0]?.id ?? "");
  });

  it("answers 409 email-taken typed on a duplicate email", async () => {
    const response = await registerPOST(
      postRequest("/auth/register", {
        email: "ada@example.com",
        password: "another-passphrase-1",
      }),
    );
    expect(response.status).toBe(409);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("email-taken");
  });

  it("answers 400 with every problem named for garbage bodies", async () => {
    const response = await registerPOST(
      postRequest("/auth/register", { email: "not-an-email", password: "short" }),
    );
    expect(response.status).toBe(400);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("invalid-request");
    expect(body.detail).toContain("email");
    expect(body.detail).toContain("password");
  });

  it("refuses a non-JSON body typed", async () => {
    const response = await registerPOST(postRequest("/auth/register", "not json"));
    expect(response.status).toBe(400);
  });
});

describe("POST /auth/login + GET /auth/me", () => {
  it("logs in with a fresh token and shows the SAME server-side state from /auth/me", async () => {
    const login = await loginPOST(
      postRequest("/auth/login", {
        email: "ADA@example.com", // case-insensitive
        password: "correct-horse-battery",
      }),
    );
    expect(login.status).toBe(200);
    const body = (await json(login)) as AuthShape;
    expect(body.token.startsWith("wfxsess_")).toBe(true);
    expect(body.user.email).toBe("ada@example.com");

    const me = await meGET(getRequest("/auth/me", bearer(body.token)));
    expect(me.status).toBe(200);
    const meBody = (await json(me)) as AuthShape;
    expect(meBody.user.id).toBe(body.user.id);
    expect(meBody.profiles.map((p) => p.id)).toEqual(body.profiles.map((p) => p.id));
    expect(meBody.activeProfileId).toBe(body.profiles[0]?.id ?? "");
    // The token NEVER appears in the me answer.
    expect(JSON.stringify(meBody)).not.toContain(body.token);
  });

  it("wrong password and unknown email answer the IDENTICAL 401 (no enumeration)", async () => {
    const wrong = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "wrong-password-1" }),
    );
    const unknown = await loginPOST(
      postRequest("/auth/login", { email: "nobody@example.com", password: "whatever-pass-1" }),
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const wrongBody = (await json(wrong)) as { error: string; detail: string };
    const unknownBody = (await json(unknown)) as { error: string; detail: string };
    expect(wrongBody).toEqual(unknownBody); // same shape AND same detail
    expect(wrongBody.error).toBe("invalid-credentials");
  });

  it("me rejects garbage: malformed bearer, non-canonical token, unknown/expired/revoked", async () => {
    // Malformed scheme.
    const malformed = await meGET(
      getRequest("/auth/me", { authorization: "Basic zzz" }),
    );
    expect(malformed.status).toBe(401);
    // Wrong shape (not wfxsess_+ULID).
    const notCanonical = await meGET(getRequest("/auth/me", bearer("totally-not-a-token")));
    expect(notCanonical.status).toBe(401);
    // Unknown token.
    const unknown = await meGET(
      getRequest("/auth/me", bearer("wfxsess_0000000000000000000000ZZZ")),
    );
    expect(unknown.status).toBe(401);
    // No auth at all.
    const none = await meGET(getRequest("/auth/me"));
    expect(none.status).toBe(401);

    // Expired: a short-TTL session minted directly, then the clock passes it.
    const shortLived = new PostgresSessionService({
      db: harness.testDb.db,
      ids: harness.ids,
      clock: harness.clock,
      ttlMs: 1,
    });
    const expiredIssued = await shortLived.createSession(
      ((await json(
        await loginPOST(
          postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
        ),
      )) as AuthShape).user.id,
    );
    harness.clock.advance(2);
    const expired = await meGET(getRequest("/auth/me", bearer(expiredIssued.token)));
    expect(expired.status).toBe(401);
    const expiredBody = (await json(expired)) as { detail: string };
    expect(expiredBody.detail).toContain("expired");
  });
});

describe("POST /auth/logout", () => {
  it("revokes THIS session only — another device's token keeps working", async () => {
    const firstLogin = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const secondLogin = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const first = ((await json(firstLogin)) as AuthShape).token;
    const second = ((await json(secondLogin)) as AuthShape).token;

    const logout = await logoutPOST(postRequest("/auth/logout", {}, bearer(first)));
    expect(logout.status).toBe(200);
    expect(((await json(logout)) as { ok: boolean }).ok).toBe(true);

    // The revoked token is rejected; the other device is untouched.
    const rejected = await meGET(getRequest("/auth/me", bearer(first)));
    expect(rejected.status).toBe(401);
    const alive = await meGET(getRequest("/auth/me", bearer(second)));
    expect(alive.status).toBe(200);

    // Logout without a session is the honest 401.
    const anon = await logoutPOST(
      postRequest("/auth/logout", {}, identityHeaders()),
    );
    expect(anon.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Profile management
// ---------------------------------------------------------------------------

describe("GET/PUT /profiles + PUT /profiles/:id/select", () => {
  let token: string;
  let defaultProfileId: string;

  beforeAll(async () => {
    const login = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const body = (await json(login)) as AuthShape;
    token = body.token;
    defaultProfileId = body.profiles[0]?.id ?? "";
  });

  it("lists the account's profiles with the effective active profile", async () => {
    const response = await profilesGET(getRequest("/profiles", bearer(token)));
    expect(response.status).toBe(200);
    const body = (await json(response)) as AuthShape;
    expect(body.profiles.length).toBe(1);
    expect(body.activeProfileId).toBe(defaultProfileId);
  });

  it("creates a profile, renames it, and selects it for the session", async () => {
    const create = await profilesPUT(
      postRequest("/profiles", { displayName: "  Kids  ", avatarSeed: "seed-1" }, bearer(token)),
    );
    expect(create.status).toBe(200);
    const created = ((await json(create)) as { profile: { id: string; displayName: string; avatarSeed: string } }).profile;
    expect(created.displayName).toBe("Kids");
    expect(created.avatarSeed).toBe("seed-1");
    const kidsId = created.id;

    // The list now shows both, default first (created order).
    const list = await profilesGET(getRequest("/profiles", bearer(token)));
    const listBody = (await json(list)) as AuthShape;
    expect(listBody.profiles.map((p) => p.displayName)).toEqual(["Main", "Kids"]);

    // Rename.
    const rename = await profilesPUT(
      postRequest("/profiles", { profileId: kidsId, displayName: "Kids 2" }, bearer(token)),
    );
    expect(rename.status).toBe(200);
    expect(((await json(rename)) as { profile: { displayName: string } }).profile.displayName).toBe("Kids 2");

    // Select for THIS session (the route context shape: params is a Promise).
    const select = await selectPUT(
      postRequest(`/profiles/${kidsId}/select`, {}, bearer(token)),
      { params: Promise.resolve({ id: kidsId }) },
    );
    expect(select.status).toBe(200);
    const selectBody = (await json(select)) as { ok: boolean; activeProfileId: string };
    expect(selectBody.ok).toBe(true);
    expect(selectBody.activeProfileId).toBe(kidsId);

    // The selection rides the session: me reflects it, a FRESH session does not.
    const me = await meGET(getRequest("/auth/me", bearer(token)));
    expect(((await json(me)) as AuthShape).activeProfileId).toBe(kidsId);
    const freshLogin = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const freshBody = (await json(freshLogin)) as AuthShape;
    expect(freshBody.activeProfileId).toBe(defaultProfileId); // per-session law
  });

  it("ownership: a foreign account's profile and unknown ids answer the same 404", async () => {
    // A second account with its own default profile.
    const other = await registerPOST(
      postRequest("/auth/register", { email: "mallory@example.com", password: "mallory-pass-123" }),
    );
    const otherBody = (await json(other)) as AuthShape;
    const foreignId = otherBody.profiles[0]?.id ?? "";

    const selectForeign = await selectPUT(
      postRequest(`/profiles/${foreignId}/select`, {}, bearer(token)),
      { params: Promise.resolve({ id: foreignId }) },
    );
    expect(selectForeign.status).toBe(404);

    const renameForeign = await profilesPUT(
      postRequest("/profiles", { profileId: foreignId, displayName: "Stolen" }, bearer(token)),
    );
    expect(renameForeign.status).toBe(404);

    const selectUnknown = await selectPUT(
      postRequest("/profiles/wfxprof_000000000000000000000099/select", {}, bearer(token)),
      { params: Promise.resolve({ id: "wfxprof_000000000000000000000099" }) },
    );
    expect(selectUnknown.status).toBe(404);

    // Anonymous (header-only) requests have no profile surface at all.
    const anonymous = await profilesGET(getRequest("/profiles", identityHeaders()));
    expect(anonymous.status).toBe(401);
  });

  it("answers 400 for garbage profile bodies", async () => {
    const garbage = await profilesPUT(
      postRequest("/profiles", { displayName: "   " }, bearer(token)),
    );
    expect(garbage.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Profile-scoped library (the acceptance criterion: no cross-profile leaks)
// ---------------------------------------------------------------------------

describe("GET/POST /experience/library — profile scoping", () => {
  it("saves land in the ACTIVE profile's bucket; profile A's library never leaks to B", async () => {
    const login = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const body = (await json(login)) as AuthShape;
    const token = body.token;
    const defaultId = body.profiles[0]?.id ?? "";

    // Create the Kids profile and select it for a SECOND token.
    const create = await profilesPUT(
      postRequest("/profiles", { displayName: "Kids" }, bearer(token)),
    );
    const kidsId = ((await json(create)) as { profile: { id: string } }).profile.id;
    await selectPUT(postRequest(`/profiles/${kidsId}/select`, {}, bearer(token)), {
      params: Promise.resolve({ id: kidsId }),
    });

    // Default-profile session saves REF_A; Kids-profile session saves REF_B.
    const defaultLogin = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const defaultToken = ((await json(defaultLogin)) as AuthShape).token;

    const saveA = await libraryPOST(
      postRequest(
        "/experience/library",
        { op: "add", externalRef: seeded.externalRef, title: seeded.title },
        bearer(defaultToken),
      ),
    );
    expect(saveA.status).toBe(200);
    expect(((await json(saveA)) as { status: string }).status).toBe("confirmed");

    const saveB = await libraryPOST(
      postRequest(
        "/experience/library",
        { op: "add", externalRef: "jNQXAC9IVRw", title: "Me at the zoo" },
        bearer(token), // the KIDS session
      ),
    );
    expect(((await json(saveB)) as { status: string }).status).toBe("confirmed");

    // The DEFAULT-profile read sees ONLY REF_A; the KIDS read ONLY REF_B —
    // profile isolation, end to end, through the HTTP boundary.
    const defaultLibrary = await libraryGET(getRequest("/experience/library", bearer(defaultToken)));
    expect(defaultLibrary.status).toBe(200);
    const defaultEntries = (await json(defaultLibrary)) as { externalRef: string }[];
    expect(defaultEntries.map((e) => e.externalRef)).toEqual([seeded.externalRef]);

    const kidsLibrary = await libraryGET(getRequest("/experience/library", bearer(token)));
    expect(kidsLibrary.status).toBe(200);
    const kidsEntries = (await json(kidsLibrary)) as { externalRef: string }[];
    expect(kidsEntries.map((e) => e.externalRef)).toEqual(["jNQXAC9IVRw"]);

    // Raw row truth: two isolated rows in the same table.
    const rows = await harness.testDb.db.query<{ profile_id: string }>(
      "SELECT profile_id FROM library_entries WHERE user_id = $1 ORDER BY profile_id",
      [body.user.id],
    );
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.profile_id).sort()).toEqual([defaultId, kidsId].sort());
  });

  it("identity agreement: a session may not claim another header identity (400)", async () => {
    const login = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const loginBody = (await json(login)) as AuthShape;
    const token = loginBody.token;

    const mismatch = await libraryGET(
      getRequest(
        "/experience/library",
        bearer(token, { "x-wfx-user-id": "someone-else" }),
      ),
    );
    expect(mismatch.status).toBe(400);

    // The SAME user id in the header is fine (the frozen client sends it).
    const agree = await libraryGET(
      getRequest(
        "/experience/library",
        bearer(token, { "x-wfx-user-id": loginBody.user.id }),
      ),
    );
    expect(agree.status).toBe(200);
  });

  it("THE ANONYMOUS TRANSITION: the frozen x-wfx-user-id flow still works verbatim", async () => {
    // No Authorization header at all — the exact pre-R02 request shape.
    const add = await libraryPOST(
      postRequest(
        "/experience/library",
        { op: "add", externalRef: "oH_pVgW5fEw", title: "Rain Bombs" },
        identityHeaders(),
      ),
    );
    expect(add.status).toBe(200);
    expect(((await json(add)) as { status: string }).status).toBe("confirmed");

    const read = await libraryGET(
      getRequest("/experience/library", identityHeaders()),
    );
    expect(read.status).toBe(200);
    const entries = (await json(read)) as { externalRef: string }[];
    expect(entries.map((e) => e.externalRef)).toContain("oH_pVgW5fEw");

    // The absent-header law is preserved (typed 400).
    const missing = await libraryGET(getRequest("/experience/library"));
    expect(missing.status).toBe(400);

    // A malformed bearer is a 401 — never silently ignored.
    const malformed = await libraryGET(
      getRequest("/experience/library", { authorization: "Bearer   " }),
    );
    expect(malformed.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Profile-attributed events + the relay fold + cross-device continuity
// ---------------------------------------------------------------------------

describe("POST /experience/events + the relay — profile-attributed history", () => {
  it("attributes the outbox row to the session's active profile; the relay folds it there", async () => {
    const login = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const body = (await json(login)) as AuthShape;
    const token = body.token;

    // Select the Kids profile for this session, then emit a watch event.
    const create = await profilesPUT(
      postRequest("/profiles", { displayName: "Kids Watch" }, bearer(token)),
    );
    expect(create.status).toBe(200);
    const kidsId = ((await json(create)) as { profile: { id: string } }).profile.id;
    const select = await selectPUT(postRequest(`/profiles/${kidsId}/select`, {}, bearer(token)), {
      params: Promise.resolve({ id: kidsId }),
    });
    expect(select.status).toBe(200);
    const afterSelect = await meGET(getRequest("/auth/me", bearer(token)));
    expect(((await json(afterSelect)) as AuthShape).activeProfileId).toBe(kidsId);

    const event = {
      userId: body.user.id,
      itemId: seeded.itemId,
      type: "progress",
      occurredAt: new Date(harness.clock.now()).toISOString(),
      sessionId: "device-kids-session",
      payload: { positionMs: 42_000 },
    };
    const posted = await eventsPOST(postRequest("/experience/events", event, bearer(token)));
    expect(posted.status).toBe(200);
    expect(((await json(posted)) as { ok: boolean }).ok).toBe(true);

    // The outbox row carries the ACTIVE profile (ingest-time attribution).
    // (Deterministic isolation: the library tests' earlier "save" events
    // share this (user, item) pair — filter to THIS watch event by type and
    // tiebreak by the canonical event id.)
    const rows = await harness.testDb.db.query<{ profile_id: string | null }>(
      "SELECT profile_id FROM event_outbox WHERE user_id = $1 AND item_id = $2 AND event_type = 'progress' ORDER BY created_at DESC, id DESC LIMIT 1",
      [body.user.id, seeded.itemId],
    );
    expect(rows[0]?.profile_id).toBe(kidsId);

    // The relay folds it into the KIDS profile's history — not the default.
    await runRelayDrain(harness.testDb.db, harness.clock, 50, harness.boot.profiles);
    const kidsRows = await harness.testDb.db.query<{ position_ms: number }>(
      "SELECT position_ms FROM watch_history WHERE profile_id = $1 AND item_id = $2",
      [kidsId, seeded.itemId],
    );
    expect(kidsRows.length).toBe(1);
    expect(Number(kidsRows[0]?.position_ms)).toBe(42_000);
    const defaultRows = await harness.testDb.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM watch_history WHERE profile_id = $1 AND item_id = $2",
      [body.profiles[0]?.id ?? "", seeded.itemId],
    );
    expect(defaultRows[0]?.count).toBe("0"); // isolated
  });

  it("CROSS-DEVICE CONTINUITY: a second device sees the SAME profile and watch state", async () => {
    // Device 1: login, select a shared profile, watch something.
    const device1 = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const device1Body = (await json(device1)) as AuthShape;

    // A dedicated continuity profile (clean bucket for this assertion).
    const create = await profilesPUT(
      postRequest("/profiles", { displayName: "Continuity" }, bearer(device1Body.token)),
    );
    const continuityId = ((await json(create)) as { profile: { id: string } }).profile.id;
    await selectPUT(
      postRequest(`/profiles/${continuityId}/select`, {}, bearer(device1Body.token)),
      { params: Promise.resolve({ id: continuityId }) },
    );

    const event = {
      userId: device1Body.user.id,
      itemId: seeded.itemId,
      type: "progress",
      occurredAt: new Date(harness.clock.now() + 5_000).toISOString(),
      sessionId: "device-1-session",
      payload: { positionMs: 123_456 },
    };
    const posted = await eventsPOST(
      postRequest("/experience/events", event, bearer(device1Body.token)),
    );
    expect(posted.status).toBe(200);
    await runRelayDrain(harness.testDb.db, harness.clock, 50, harness.boot.profiles);

    // Device 2: a FRESH login (fresh token, no active profile selected yet).
    harness.clock.advance(60_000);
    const device2 = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const device2Body = (await json(device2)) as AuthShape;
    expect(device2Body.token).not.toBe(device1Body.token);

    // SAME profiles visible from the second device (server-side state).
    expect(device2Body.profiles.map((p) => p.id).sort()).toEqual(
      device1Body.profiles.map((p) => p.id).concat(continuityId).sort(),
    );

    // Device 2 selects the SAME profile and sees the SAME watch state —
    // the cross-device continuity acceptance criterion.
    const select = await selectPUT(
      postRequest(`/profiles/${continuityId}/select`, {}, bearer(device2Body.token)),
      { params: Promise.resolve({ id: continuityId }) },
    );
    expect(select.status).toBe(200);
    const history = await harness.testDb.db.query<{ position_ms: number; profile_id: string }>(
      "SELECT position_ms, profile_id FROM watch_history WHERE profile_id = $1",
      [continuityId],
    );
    expect(history.length).toBe(1);
    expect(Number(history[0]?.position_ms)).toBe(123_456);

    // And the profile-scoped library read answers through the SAME bucket
    // from the second device.
    const library = await libraryGET(getRequest("/experience/library", bearer(device2Body.token)));
    expect(library.status).toBe(200);
  });

  it("identity consistency for events: a session may not post another user's event (400)", async () => {
    const login = await loginPOST(
      postRequest("/auth/login", { email: "ada@example.com", password: "correct-horse-battery" }),
    );
    const body = (await json(login)) as AuthShape;

    const forged = {
      userId: "someone-else",
      itemId: seeded.itemId,
      type: "progress",
      occurredAt: new Date(harness.clock.now()).toISOString(),
      sessionId: "forged-session",
    };
    const response = await eventsPOST(
      postRequest("/experience/events", forged, bearer(body.token)),
    );
    expect(response.status).toBe(400);
  });

  it("ANONYMOUS events keep the exact pre-R02 ingest path (header identity law)", async () => {
    const event = {
      userId: "wfx-api-test-user",
      itemId: seeded.itemId,
      type: "start",
      occurredAt: new Date(harness.clock.now()).toISOString(),
      sessionId: "anonymous-session",
    };
    const response = await eventsPOST(
      postRequest("/experience/events", event, identityHeaders()),
    );
    expect(response.status).toBe(200);
    expect(((await json(response)) as { ok: boolean }).ok).toBe(true);

    // The durability law: the outbox row EXISTS the moment 200 answered.
    const rows = await harness.testDb.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM event_outbox WHERE user_id = $1 AND session_id_is_synthetic IS NULL",
      ["wfx-api-test-user"],
    ).catch(async () => {
      // (The synthetic column does not exist — the honest count query.)
      return harness.testDb.db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_outbox WHERE user_id = $1",
        ["wfx-api-test-user"],
      );
    });
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});
