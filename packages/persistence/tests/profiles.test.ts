/**
 * R02 — profile service + profile-scoped data tests (PGlite, real Postgres).
 *
 * The spec's acceptance points, at the persistence layer:
 * - profile CRUD with one designated default per user (structurally);
 * - the LAZY LEGACY MIGRATION: materialize the default profile on first
 *   resolution and attribute existing userId-keyed rows to it;
 * - the legacy pseudo bucket for unregistered ids (anonymous transition);
 * - PROFILE-SCOPED HISTORY/LIBRARY ISOLATION: profile A's data never leaks
 *   to profile B (same user, same item — two isolated rows);
 * - session tokens: the R02 canonical `wfxsess_` shape, hashed at rest,
 *   expiry + revocation, and ownership-checked active-profile selection;
 * - CROSS-DEVICE CONTINUITY: two sessions, same profile, shared watch state.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PersistenceError,
  PostgresIdentityService,
  PostgresIntentStore,
  PostgresLibraryStore,
  PostgresProfileService,
  PostgresRecommendationStateStore,
  PostgresSessionService,
  PostgresWatchHistoryStore,
  isCanonicalSessionToken,
  legacyProfileKey,
  PROFILE_ID_PREFIX,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 16, 12, 0, 0);
const ITEM_A = "wfxitm_00000000000000000000000001";
const ITEM_B = "wfxitm_00000000000000000000000002";
const ITEM_C = "wfxitm_00000000000000000000000003";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let identity: PostgresIdentityService;
let sessions: PostgresSessionService;
let profiles: PostgresProfileService;
let watch: PostgresWatchHistoryStore;
let library: PostgresLibraryStore;
let intents: PostgresIntentStore;
let state: PostgresRecommendationStateStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  identity = new PostgresIdentityService({ db: test.db, ids, clock });
  sessions = new PostgresSessionService({ db: test.db, ids, clock });
  profiles = new PostgresProfileService({ db: test.db, ids, clock });
  watch = new PostgresWatchHistoryStore({ db: test.db, clock, ids });
  library = new PostgresLibraryStore({ db: test.db, clock, ids });
  intents = new PostgresIntentStore({ db: test.db, ids, clock });
  state = new PostgresRecommendationStateStore({ db: test.db, clock, ids });
});

afterAll(async () => {
  await test.close();
});

// ---------------------------------------------------------------------------
// Session tokens — the R02 canonical shape + selection
// ---------------------------------------------------------------------------

describe("session tokens — the R02 canonical shape", () => {
  it("mints `wfxsess_` + ULID tokens by default: unique, opaque, never stored raw", async () => {
    const registered = await identity.register({
      email: "token-shape@example.com",
      password: "token-shape-pass-1",
    });
    if (!registered.ok) throw new Error("precondition failed");

    const minted: string[] = [];
    // The harness-level default service mints through the DEFAULT path.
    const first = await sessions.createSession(registered.user.id);
    const second = await sessions.createSession(registered.user.id);
    minted.push(first.token, second.token);

    for (const token of minted) {
      expect(isCanonicalSessionToken(token)).toBe(true);
      expect(token.startsWith("wfxsess_")).toBe(true);
      expect(token.length).toBe("wfxsess_".length + 26);
    }
    // Two mints under the same fixed clock instant never collide.
    expect(minted[0]).not.toBe(minted[1]);
    // A token is never derivable from the user id it belongs to.
    expect(minted[0]).not.toContain(registered.user.id);

    // Only the SHA-256 hash is stored.
    const rows = await test.db.query<{ token_hash: string }>(
      "SELECT token_hash FROM sessions WHERE id = $1",
      [first.session.id],
    );
    expect(rows[0]?.token_hash).not.toBe(first.token);
    expect(rows[0]?.token_hash?.length).toBe(64);
    // Validation round-trips with the active profile surfaced.
    const validation = await sessions.validateSession(first.token);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.session.userId).toBe(registered.user.id);
      expect(validation.session.activeProfileId).toBeNull();
    }
  });

  it("setActiveProfile is OWNERSHIP-CHECKED: another account's profile is unknown", async () => {
    const alice = await identity.register({
      email: "alice-profiles@example.com",
      password: "alice-profiles-1",
    });
    const bob = await identity.register({
      email: "bob-profiles@example.com",
      password: "bob-profiles-1",
    });
    if (!alice.ok || !bob.ok) throw new Error("precondition failed");

    const aliceSession = await sessions.createSession(alice.user.id);
    const bobProfile = await profiles.ensureDefaultProfile(bob.user.id);
    if (!bobProfile.ok) throw new Error("precondition failed");

    // Alice cannot select Bob's profile.
    const cross = await sessions.setActiveProfile({
      token: aliceSession.token,
      profileId: bobProfile.profile.id,
    });
    expect(cross).toEqual({ ok: false, reason: "unknown-profile" });

    // A garbage profile id is the same honest answer.
    const garbage = await sessions.setActiveProfile({
      token: aliceSession.token,
      profileId: "wfxprof_000000000000000000000099",
    });
    expect(garbage).toEqual({ ok: false, reason: "unknown-profile" });

    // Her OWN profile selects fine and rides the session record.
    const aliceProfile = await profiles.ensureDefaultProfile(alice.user.id);
    if (!aliceProfile.ok) throw new Error("precondition failed");
    const selected = await sessions.setActiveProfile({
      token: aliceSession.token,
      profileId: aliceProfile.profile.id,
    });
    expect(selected.ok).toBe(true);
    if (selected.ok) {
      expect(selected.session.activeProfileId).toBe(aliceProfile.profile.id);
    }
    const revalidated = await sessions.validateSession(aliceSession.token);
    expect(revalidated.ok).toBe(true);
    if (revalidated.ok) {
      expect(revalidated.session.activeProfileId).toBe(aliceProfile.profile.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Profile CRUD + the default designation
// ---------------------------------------------------------------------------

describe("profile service — records and the designated default", () => {
  it("materializes ONE default profile per registered user (idempotent, canonical id)", async () => {
    const registered = await identity.register({
      email: "defaults@example.com",
      password: "defaults-pass-123",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;

    const first = await profiles.ensureDefaultProfile(userId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    expect(first.profile.id.startsWith(PROFILE_ID_PREFIX)).toBe(true);
    expect(first.profile.id.length).toBe(PROFILE_ID_PREFIX.length + 26);
    expect(first.profile.userId).toBe(userId);
    expect(first.profile.isDefault).toBe(true);
    expect(first.profile.displayName.length).toBeGreaterThan(0);
    expect(first.profile.avatarSeed.length).toBeGreaterThan(0);

    // Idempotent: the second call returns the SAME profile, created=false.
    const second = await profiles.ensureDefaultProfile(userId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.profile.id).toBe(first.profile.id);

    // The structural one-default-per-user law.
    const defaults = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM profiles WHERE user_id = $1 AND is_default",
      [userId],
    );
    expect(defaults[0]?.count).toBe("1");
  });

  it("answers the typed user-not-found for an unregistered id", async () => {
    const result = await profiles.ensureDefaultProfile("wfxusr_000000000000000000000099");
    expect(result).toEqual({ ok: false, reason: "user-not-found" });
  });

  it("creates additional (non-default) profiles, validates input, and renames", async () => {
    const registered = await identity.register({
      email: "multi-profile@example.com",
      password: "multi-profiles-1",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;
    await profiles.ensureDefaultProfile(userId);

    const kids = await profiles.createProfile({
      userId,
      displayName: "  Kids  ",
      avatarSeed: "seed-kids",
    });
    expect(kids.ok).toBe(true);
    if (kids.ok) {
      expect(kids.profile.displayName).toBe("Kids");
      expect(kids.profile.avatarSeed).toBe("seed-kids");
      expect(kids.profile.isDefault).toBe(false);
    }

    // A second explicit avatar-free profile seeds from its own id.
    const guest = await profiles.createProfile({ userId, displayName: "Guest" });
    expect(guest.ok).toBe(true);
    if (guest.ok) expect(guest.profile.avatarSeed).toBe(guest.profile.id);

    // Listing: deterministic created order, default first-created.
    const listed = await profiles.listProfiles(userId);
    expect(listed.length).toBe(3);
    expect(listed[0]?.isDefault).toBe(true);
    expect(listed.map((p) => p.displayName)).toEqual(["Main", "Kids", "Guest"]);

    // Typed invalid input: blank + oversized names, oversized seed.
    const bad = await profiles.createProfile({ userId, displayName: "   " });
    expect(bad.ok).toBe(false);
    if (!bad.ok && bad.reason === "invalid-input") {
      expect(bad.details.length).toBeGreaterThan(0);
    }
    const longName = await profiles.createProfile({
      userId,
      displayName: "x".repeat(65),
    });
    expect(longName.ok).toBe(false);

    // Unknown account: the FK's honest answer.
    const orphan = await profiles.createProfile({
      userId: "wfxusr_000000000000000000000098",
      displayName: "Nobody",
    });
    expect(orphan).toEqual({ ok: false, reason: "user-not-found" });

    // Rename round-trip + typed not-found.
    if (kids.ok) {
      const renamed = await profiles.renameProfile({
        profileId: kids.profile.id,
        displayName: "Kids 2",
      });
      expect(renamed.ok).toBe(true);
      if (renamed.ok) expect(renamed.profile.displayName).toBe("Kids 2");
      const missing = await profiles.renameProfile({
        profileId: "wfxprof_000000000000000000000097",
        displayName: "Ghost",
      });
      expect(missing).toEqual({ ok: false, reason: "not-found" });
    }
  });

  it("profile records never expose secrets (there are none to expose)", async () => {
    const registered = await identity.register({
      email: "no-secrets@example.com",
      password: "no-secrets-pass-1",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const ensured = await profiles.ensureDefaultProfile(registered.user.id);
    if (!ensured.ok) throw new Error("precondition failed");
    const serialized = JSON.stringify(ensured.profile);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("scrypt$");
  });
});

// ---------------------------------------------------------------------------
// The effective-profile key + the lazy legacy migration
// ---------------------------------------------------------------------------

describe("the effective profile key + the lazy legacy migration", () => {
  it("routes UNREGISTERED ids to the legacy pseudo bucket with no writes", async () => {
    const key = await profiles.resolveEffectiveProfileKey("wfx-anonymous");
    expect(key).toBe(legacyProfileKey("wfx-anonymous"));
    const rows = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM profiles WHERE user_id = $1",
      ["wfx-anonymous"],
    );
    expect(rows[0]?.count).toBe("0");
  });

  it("materializes the default profile for a REGISTERED user and attributes legacy rows", async () => {
    const registered = await identity.register({
      email: "legacy-migration@example.com",
      password: "legacy-migr-123",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;

    // Pre-R02 rows: userId-keyed, profile_id NULL, written the legacy way.
    await test.db.query(
      `INSERT INTO watch_history (user_id, profile_id, item_id, position_ms, completed, last_event_type, created_at, updated_at)
       VALUES ($1, NULL, $2, 1000, false, 'progress', $3, $3)`,
      [userId, ITEM_A, new Date(CLOCK_START).toISOString()],
    );
    await test.db.query(
      `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at)
       VALUES ($1, NULL, 'webflix-catalog', 'legacy-ref', 'Legacy Save', $2)`,
      [userId, new Date(CLOCK_START).toISOString()],
    );

    // First profile-scoped resolution: materialize + attribute.
    const key = await profiles.resolveEffectiveProfileKey(userId);
    expect(key.startsWith(PROFILE_ID_PREFIX)).toBe(true);

    // The legacy rows are now attributed to the materialized profile.
    const watchRow = await test.db.query<{ profile_id: string }>(
      "SELECT profile_id FROM watch_history WHERE user_id = $1 AND item_id = $2",
      [userId, ITEM_A],
    );
    expect(watchRow[0]?.profile_id).toBe(key);
    const libraryRow = await test.db.query<{ profile_id: string }>(
      "SELECT profile_id FROM library_entries WHERE user_id = $1",
      [userId],
    );
    expect(libraryRow[0]?.profile_id).toBe(key);

    // Legacy-keyed reads now resolve THROUGH the profile (bit-for-bit view).
    const entry = await watch.get(userId, ITEM_A);
    expect(entry?.positionMs).toBe(1000);
    expect(entry?.profileId).toBe(key);
    const saved = await library.list(userId, "webflix-catalog");
    expect(saved.length).toBe(1);
    expect(saved[0]?.externalRef).toBe("legacy-ref");
  });

  it("upserts legacy (NULL-profile) rows correctly under the pseudo bucket", async () => {
    // The transition law: pre-migration rows keep upsert semantics under
    // the pseudo key — no duplicates, positions fold into ONE row.
    const anon = "wfx-anonymous";
    await watch.record({
      userId: anon,
      itemId: ITEM_C,
      eventType: "progress",
      positionMs: 500,
      completed: false,
      sessionId: "legacy-session",
    });
    await watch.record({
      userId: anon,
      itemId: ITEM_C,
      eventType: "progress",
      positionMs: 900,
      completed: false,
      sessionId: "legacy-session",
    });
    const rows = await test.db.query<{ count: string; profile_id: string | null }>(
      "SELECT count(*)::text AS count, max(profile_id) AS profile_id FROM watch_history WHERE user_id = $1 AND item_id = $2",
      [anon, ITEM_C],
    );
    expect(rows[0]?.count).toBe("1");
    expect(rows[0]?.profile_id).toBe(legacyProfileKey(anon));
    const entry = await watch.get(anon, ITEM_C);
    expect(entry?.positionMs).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// Profile-scoped isolation (the acceptance criterion)
// ---------------------------------------------------------------------------

describe("profile-scoped history/library isolation", () => {
  it("profile A's history NEVER leaks to profile B (same user, same item)", async () => {
    const registered = await identity.register({
      email: "isolation@example.com",
      password: "isolation-12345",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;
    const ensured = await profiles.ensureDefaultProfile(userId);
    if (!ensured.ok) throw new Error("precondition failed");
    const profileA = ensured.profile.id;
    const kids = await profiles.createProfile({ userId, displayName: "Kids" });
    if (!kids.ok) throw new Error("precondition failed");
    const profileB = kids.profile.id;

    // Profile A watches BOTH items; profile B watches only ITEM_A — the
    // same item under a different profile must be an INDEPENDENT row.
    await watch.record({
      userId,
      profileId: profileA,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 10_000,
      completed: false,
      sessionId: "session-a",
    });
    await watch.record({
      userId,
      profileId: profileA,
      itemId: ITEM_B,
      eventType: "complete",
      positionMs: 500,
      completed: true,
      sessionId: "session-a",
    });
    await watch.record({
      userId,
      profileId: profileB,
      itemId: ITEM_A,
      eventType: "progress",
      positionMs: 42,
      completed: false,
      sessionId: "session-b",
    });

    const aHistory = await watch.listRecentForProfile(profileA);
    expect(aHistory.map((e) => e.itemId).sort()).toEqual([ITEM_A, ITEM_B]);
    expect(aHistory.find((e) => e.itemId === ITEM_A)?.positionMs).toBe(10_000);

    const bHistory = await watch.listRecentForProfile(profileB);
    expect(bHistory.length).toBe(1);
    expect(bHistory[0]?.itemId).toBe(ITEM_A);
    expect(bHistory[0]?.positionMs).toBe(42); // NOT A's 10_000 — isolated

    // The default-profile fallback resolves to THIS user's default (A) —
    // the same bucket A wrote — while a THIRD profile sees nothing.
    const legacyView = await watch.listRecent(userId);
    expect(legacyView.length).toBe(2);
    const guest = await profiles.createProfile({ userId, displayName: "Guest" });
    if (guest.ok) {
      expect((await watch.listRecentForProfile(guest.profile.id)).length).toBe(0);
    }

    // Raw row count: 3 isolated rows for one (user, item-A-twice) pattern.
    const rows = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM watch_history WHERE user_id = $1",
      [userId],
    );
    expect(rows[0]?.count).toBe("3");
  });

  it("profile A's library NEVER leaks to profile B", async () => {
    const registered = await identity.register({
      email: "library-isolation@example.com",
      password: "library-isol-123",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;
    const ensured = await profiles.ensureDefaultProfile(userId);
    if (!ensured.ok) throw new Error("precondition failed");
    const profileA = ensured.profile.id;
    const kids = await profiles.createProfile({ userId, displayName: "Kids" });
    if (!kids.ok) throw new Error("precondition failed");
    const profileB = kids.profile.id;

    await library.addWithin(test.db, {
      userId,
      profileId: profileA,
      connectorId: "webflix-catalog",
      command: { op: "add", externalRef: "ref-a-1", title: "A Save" },
    });
    await library.addWithin(test.db, {
      userId,
      profileId: profileB,
      connectorId: "webflix-catalog",
      command: { op: "add", externalRef: "ref-b-1", title: "B Save" },
    });

    const aLibrary = await library.listForProfile(profileA, "webflix-catalog");
    expect(aLibrary.length).toBe(1);
    expect(aLibrary[0]?.externalRef).toBe("ref-a-1");

    const bLibrary = await library.listForProfile(profileB, "webflix-catalog");
    expect(bLibrary.length).toBe(1);
    expect(bLibrary[0]?.externalRef).toBe("ref-b-1");

    // The same externalRef under two profiles = two isolated rows.
    await library.addWithin(test.db, {
      userId,
      profileId: profileB,
      connectorId: "webflix-catalog",
      command: { op: "add", externalRef: "ref-a-1", title: "Same ref, other profile" },
    });
    expect((await library.listForProfile(profileA, "webflix-catalog")).length).toBe(1);
    expect((await library.listForProfile(profileB, "webflix-catalog")).length).toBe(2);
  });

  it("intents and recommendation policy are profile-scoped too", async () => {
    const registered = await identity.register({
      email: "policy-isolation@example.com",
      password: "policy-isol-123",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;
    const ensured = await profiles.ensureDefaultProfile(userId);
    if (!ensured.ok) throw new Error("precondition failed");
    const profileA = ensured.profile.id;
    const kids = await profiles.createProfile({ userId, displayName: "Kids" });
    if (!kids.ok) throw new Error("precondition failed");
    const profileB = kids.profile.id;

    const stamp = new Date(CLOCK_START).toISOString();
    const intentId = (n: number) =>
      `wfxint_${String(n).padStart(26, "0")}` as Parameters<
        PostgresIntentStore["upsertIntentForProfile"]
      >[0]["id"];
    const mkIntent = (n: number, objective: string, weight: number) => ({
      id: intentId(n),
      userId,
      scope: "persistent" as const,
      objective,
      weight,
      confidence: 1,
      provenance: "explicit" as const,
      createdAt: stamp,
      updatedAt: stamp,
      lastReinforcedAt: stamp,
      evidenceCount: 1,
    });

    await intents.upsertIntentForProfile(mkIntent(41, "cozy-comedy", 0.9), profileA);
    await intents.upsertIntentForProfile(mkIntent(42, "kids-cartoons", 0.8), profileB);

    expect((await intents.listForProfile(profileA)).map((i) => i.objective)).toEqual([
      "cozy-comedy",
    ]);
    expect((await intents.listForProfile(profileB)).map((i) => i.objective)).toEqual([
      "kids-cartoons",
    ]);

    const policyA = {
      id: "wfxpol_00000000000000000000000001",
      userId,
      objectives: [],
      exploration: 0.4,
      novelty: 0.6,
      socialInfluence: 0.2,
      attentionMode: "balanced" as const,
    };
    const policyB = { ...policyA, id: "wfxpol_00000000000000000000000002", attentionMode: "immersive" as const };
    await state.saveForProfile({ userId, profileId: profileA, policy: policyA });
    await state.saveForProfile({ userId, profileId: profileB, policy: policyB });

    const loadedA = await state.loadForProfile(profileA);
    const loadedB = await state.loadForProfile(profileB);
    expect(loadedA.found).toBe(true);
    if (loadedA.state) expect(loadedA.state.policy.attentionMode).toBe("balanced");
    expect(loadedB.found).toBe(true);
    if (loadedB.state) expect(loadedB.state.policy.attentionMode).toBe("immersive");
    expect((await state.loadForProfile(legacyProfileKey(userId))).found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-device continuity (the acceptance criterion)
// ---------------------------------------------------------------------------

describe("cross-device continuity — two sessions, one profile, shared state", () => {
  it("a second device (fresh login) sees the SAME profile and watch state", async () => {
    const registered = await identity.register({
      email: "continuity@example.com",
      password: "continuity-123",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;

    // Device 1 logs in, selects the Kids profile, watches.
    const ensured = await profiles.ensureDefaultProfile(userId);
    if (!ensured.ok) throw new Error("precondition failed");
    const kids = await profiles.createProfile({ userId, displayName: "Kids" });
    if (!kids.ok) throw new Error("precondition failed");

    const device1 = await sessions.createSession(userId);
    const selected = await sessions.setActiveProfile({
      token: device1.token,
      profileId: kids.profile.id,
    });
    expect(selected.ok).toBe(true);

    await watch.record({
      userId,
      profileId: kids.profile.id,
      itemId: ITEM_B,
      eventType: "progress",
      positionMs: 123_456,
      completed: false,
      sessionId: "device-1-session",
    });

    // Device 2 logs in LATER (a fresh session — a fresh token).
    clock.advance(60_000);
    const device2 = await sessions.createSession(userId);
    expect(device2.token).not.toBe(device1.token);
    const device2Validation = await sessions.validateSession(device2.token);
    expect(device2Validation.ok).toBe(true);

    // Same profiles are visible from the second device (server-side state).
    const profilesFromDevice2 = await profiles.listProfiles(userId);
    expect(profilesFromDevice2.map((p) => p.displayName).sort()).toEqual(["Kids", "Main"]);

    // The watch state recorded under the shared profile is visible: the
    // effective-key resolution (device 2 has no active profile selected →
    // default) is NOT the shared profile — continuity requires selecting
    // the same profile, exactly like the product's profile picker.
    const defaultHistory = await watch.listRecentForProfile(ensured.profile.id);
    expect(defaultHistory.length).toBe(0);
    const kidsHistoryDevice2 = await watch.listRecentForProfile(kids.profile.id);
    expect(kidsHistoryDevice2.length).toBe(1);
    expect(kidsHistoryDevice2[0]?.itemId).toBe(ITEM_B);
    expect(kidsHistoryDevice2[0]?.positionMs).toBe(123_456);

    // And device 2 can select the same profile for its own session.
    const selected2 = await sessions.setActiveProfile({
      token: device2.token,
      profileId: kids.profile.id,
    });
    expect(selected2.ok).toBe(true);
    if (selected2.ok) {
      expect(selected2.session.activeProfileId).toBe(kids.profile.id);
    }
  });

  it("revoking device 1's token does not disturb device 2 (per-session tokens)", async () => {
    const registered = await identity.register({
      email: "revoke-device@example.com",
      password: "revoke-device-1",
    });
    if (!registered.ok) throw new Error("precondition failed");
    const userId = registered.user.id;

    const device1 = await sessions.createSession(userId);
    const device2 = await sessions.createSession(userId);

    expect(await sessions.revokeSession(device1.token)).toBe(true);
    expect((await sessions.validateSession(device1.token)).ok).toBe(false);
    expect((await sessions.validateSession(device2.token)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The seams law (materialization requires the injected seams)
// ---------------------------------------------------------------------------

describe("the profile service seams law", () => {
  it("materialization without the ids/clock seams answers the typed config-error", async () => {
    const seamLess = new PostgresProfileService({ db: test.db });
    let caught: unknown;
    try {
      await seamLess.ensureDefaultProfile("wfx-anonymous");
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("config-error");
    // Reads still work without the seams.
    expect(await seamLess.getDefaultProfile("wfx-anonymous")).toBeNull();
    expect(await seamLess.resolveEffectiveProfileKey("wfx-anonymous")).toBe(
      legacyProfileKey("wfx-anonymous"),
    );
  });
});
