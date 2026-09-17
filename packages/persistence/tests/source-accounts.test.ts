/**
 * R03 — source-management persistence tests (PGlite).
 *
 * Pins the 0008 lifecycle extension of `connector_accounts` and the
 * pending-authorization store, plus THE MODEL-INPUT PRIVACY LAW:
 *
 * - lifecycle stamps: `authorized_at` on sign-in saves + transitions (and
 *   re-authorization upserts refresh it while the account id/created_at
 *   stay stable), `last_state_change` on every state move;
 * - availability notes: write/read round-trip, honest null-miss;
 * - pending authorizations: save → load (typed not-found / expired), the
 *   expiry check against the injected clock, completion (consume-once),
 *   supersession eviction, delete-with-account;
 * - THE PRIVACY LAW: `ModelSafeSourceSummary` is structurally secret-free
 *   (type-level guard), the summaries built from a REAL sealed account
 *   never contain the secret or the envelope material (raw-SQL check), and
 *   `assertNoCredentialMaterial` throws the typed loud error on leaky
 *   shapes (nested, arrays, Maps) while passing clean ones.
 *
 * Determinism: FixedClock + SequentialIdGen; no network (PGlite in-memory).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  CredentialMaterialLeakError,
  PersistenceError,
  PostgresConnectorAccountStore,
  assertNoCredentialMaterial,
  scanForCredentialMaterial,
  toModelSafeSourceSummaries,
  type AssertNoCredentialMaterial,
  type ModelSafeSourceSummary,
} from "../src/index";
import { TEST_ENCRYPTION_KEY, createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 16, 9, 0, 0);
const USER = "wfxusr_000000000000000000000000r03";
const OTHER_USER = "wfxusr_0000000000000000000000r03b";
const SECRET = "ya29.R03-super-secret-oauth-token-value";
const REFRESHED_SECRET = "ya29.R03-ROTATED-token-value";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let accounts: PostgresConnectorAccountStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  accounts = new PostgresConnectorAccountStore({
    db: test.db,
    clock,
    key: TEST_ENCRYPTION_KEY,
    ids,
  });
});

afterAll(async () => {
  await test.close();
});

// ---------------------------------------------------------------------------
// Lifecycle stamps (authorized_at / last_state_change / availability_notes)
// ---------------------------------------------------------------------------

describe("R03 lifecycle stamps (migration 0008)", () => {
  it("a signedIn save stamps authorized_at + last_state_change", async () => {
    const saved = await accounts.saveAccount({
      userId: USER,
      connectorId: "youtube",
      kind: "oauth-token",
      authState: "signedIn",
      secret: SECRET,
      metadata: { expiresAtMs: CLOCK_START + 3_600_000 },
    });
    expect(saved.authorizedAt).toBe(new Date(CLOCK_START).toISOString());
    expect(saved.lastStateChange).toBe(new Date(CLOCK_START).toISOString());
  });

  it("a non-signedIn save leaves authorized_at null but stamps last_state_change", async () => {
    const saved = await accounts.saveAccount({
      userId: USER,
      connectorId: "dailymotion",
      kind: "oauth-token",
      authState: "authorizing",
      secret: SECRET,
    });
    expect(saved.authorizedAt).toBeNull();
    expect(saved.lastStateChange).toBe(new Date(CLOCK_START).toISOString());
  });

  it("RE-AUTHORIZATION upsert preserves the account row and refreshes authorized_at", async () => {
    const first = await accounts.saveAccount({
      userId: USER,
      connectorId: "youtube",
      kind: "oauth-token",
      authState: "signedIn",
      secret: SECRET,
    });
    clock.advance(120_000);
    const second = await accounts.saveAccount({
      userId: USER,
      connectorId: "youtube",
      kind: "oauth-token",
      authState: "signedIn",
      secret: REFRESHED_SECRET,
    });
    expect(second.id).toBe(first.id); // the row is PRESERVED (the spec law)
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.authorizedAt).toBe(new Date(CLOCK_START + 120_000).toISOString());
    expect(second.lastStateChange).toBe(new Date(CLOCK_START + 120_000).toISOString());

    const loaded = await accounts.loadAccount(USER, "youtube");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.account.secret).toBe(REFRESHED_SECRET);
  });

  it("setAuthState stamps last_state_change and refreshes authorized_at only on signedIn", async () => {
    clock.advance(60_000);
    const at = new Date(CLOCK_START + 180_000).toISOString();
    const expired = await accounts.setAuthState(USER, "youtube", "expired");
    expect(expired?.authState).toBe("expired");
    expect(expired?.lastStateChange).toBe(at);
    expect(expired?.authorizedAt).toBe(new Date(CLOCK_START + 120_000).toISOString()); // preserved

    clock.advance(60_000);
    const signedIn = await accounts.setAuthState(USER, "youtube", "signedIn");
    expect(signedIn?.authorizedAt).toBe(new Date(CLOCK_START + 240_000).toISOString());
    expect(signedIn?.lastStateChange).toBe(new Date(CLOCK_START + 240_000).toISOString());
  });

  it("availability notes round-trip and miss honestly for unknown accounts", async () => {
    const updated = await accounts.setAvailabilityNotes(USER, "youtube", [
      "Quota: search costs 100 units of the project's daily quota",
      "OAuth connected — user-scoped operations available",
    ]);
    expect(updated?.availabilityNotes).toEqual([
      "Quota: search costs 100 units of the project's daily quota",
      "OAuth connected — user-scoped operations available",
    ]);
    expect(await accounts.setAvailabilityNotes(USER, "never-connected", [])).toBeNull();

    // saveAccount can also set notes atomically
    const saved = await accounts.saveAccount({
      userId: USER,
      connectorId: "vimeo-r03",
      kind: "oauth-token",
      authState: "signedIn",
      secret: "vimeo-r03-token",
      availabilityNotes: ["connected via OAuth"],
    });
    expect(saved.availabilityNotes).toEqual(["connected via OAuth"]);

    let caught: unknown;
    try {
      await accounts.setAvailabilityNotes(USER, "youtube", ["bad\u0007note"]);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
  });

  it("listForUser carries the lifecycle fields and never the secret", async () => {
    const listed = await accounts.listForUser(USER);
    const youtube = listed.find((row) => row.connectorId === "youtube");
    expect(youtube?.authorizedAt).toBeTypeOf("string");
    expect(youtube?.lastStateChange).toBeTypeOf("string");
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(listed)).not.toContain(REFRESHED_SECRET);
  });
});

// ---------------------------------------------------------------------------
// Pending authorizations
// ---------------------------------------------------------------------------

describe("R03 pending authorizations (the in-flight handshakes)", () => {
  const STATE = "r03-csrf-state-token-0001";

  it("saves and loads a pending authorization", async () => {
    const saved = await accounts.savePendingAuthorization({
      state: STATE,
      userId: USER,
      connectorId: "youtube",
      flowKind: "oauth",
      redirectUri: "https://api.webflix.example/sources/callback",
      expiresAtMs: CLOCK_START + 240_000 + 600_000,
    });
    expect(saved.state).toBe(STATE);
    expect(saved.flowKind).toBe("oauth");
    expect(saved.redirectUri).toBe("https://api.webflix.example/sources/callback");

    const loaded = await accounts.loadPendingAuthorization(STATE);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.pending.userId).toBe(USER);
      expect(loaded.pending.connectorId).toBe("youtube");
    }
  });

  it("answers not-found typed for an unknown state", async () => {
    expect(await accounts.loadPendingAuthorization("never-minted")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("EXPIRY: an expired pending answers the typed expired outcome and is deleted", async () => {
    const expiring = await accounts.savePendingAuthorization({
      state: "r03-csrf-state-token-0002",
      userId: USER,
      connectorId: "youtube",
      flowKind: "oauth",
      expiresAtMs: CLOCK_START + 240_000 + 1_000,
    });
    expect(expiring.state).toBe("r03-csrf-state-token-0002");

    clock.advance(2_000); // now past the expiry
    const loaded = await accounts.loadPendingAuthorization("r03-csrf-state-token-0002");
    expect(loaded).toEqual({
      ok: false,
      reason: "expired",
      expiredAt: new Date(CLOCK_START + 240_000 + 1_000).toISOString(),
    });

    // dead is dead — the row was consumed
    expect(await accounts.loadPendingAuthorization("r03-csrf-state-token-0002")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("completing consumes the pending exactly once", async () => {
    const state = "r03-csrf-state-token-0003";
    await accounts.savePendingAuthorization({
      state,
      userId: USER,
      connectorId: "youtube",
      flowKind: "oauth",
      expiresAtMs: clock.now() + 600_000,
    });
    expect(await accounts.completePendingAuthorization(state)).toBe(true);
    expect(await accounts.completePendingAuthorization(state)).toBe(false);
  });

  it("supersession evicts per (user, connector) and leaves other connectors alone", async () => {
    await accounts.savePendingAuthorization({
      state: "r03-csrf-state-token-0004",
      userId: USER,
      connectorId: "youtube",
      flowKind: "oauth",
      expiresAtMs: clock.now() + 600_000,
    });
    await accounts.savePendingAuthorization({
      state: "r03-csrf-state-token-0005",
      userId: USER,
      connectorId: "youtube",
      flowKind: "oauth",
      expiresAtMs: clock.now() + 600_000,
    });
    await accounts.savePendingAuthorization({
      state: "r03-csrf-state-token-0006",
      userId: USER,
      connectorId: "vimeo-r03",
      flowKind: "oauth",
      expiresAtMs: clock.now() + 600_000,
    });

    // THREE youtube pendings die: 0004 + 0005 here, plus STATE (0001) from
    // the first pending test, still live for (USER, youtube).
    expect(await accounts.evictPendingAuthorizations(USER, "youtube")).toBe(3);
    expect(await accounts.loadPendingAuthorization("r03-csrf-state-token-0004")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect((await accounts.loadPendingAuthorization("r03-csrf-state-token-0006")).ok).toBe(true);
  });

  it("a reused live state throws typed (constraint) — never a silent overwrite", async () => {
    const state = "r03-csrf-state-token-0007";
    await accounts.savePendingAuthorization({
      state,
      userId: USER,
      connectorId: "youtube",
      flowKind: "oauth",
      expiresAtMs: clock.now() + 600_000,
    });
    let caught: unknown;
    try {
      await accounts.savePendingAuthorization({
        state,
        userId: OTHER_USER,
        connectorId: "youtube",
        flowKind: "oauth",
        expiresAtMs: clock.now() + 600_000,
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    // the original pending is untouched
    const loaded = await accounts.loadPendingAuthorization(state);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.pending.userId).toBe(USER);
  });

  it("deleteAccount evicts the account's pendings with it (the disconnect discipline)", async () => {
    const state = "r03-csrf-state-token-0008";
    await accounts.savePendingAuthorization({
      state,
      userId: USER,
      connectorId: "vimeo-r03",
      flowKind: "oauth",
      expiresAtMs: clock.now() + 600_000,
    });
    expect(await accounts.deleteAccount(USER, "vimeo-r03")).toBe(true); // had the account
    expect(await accounts.loadPendingAuthorization(state)).toEqual({ ok: false, reason: "not-found" });
  });

  it("malformed pending input fails typed (invalid-input, nothing written)", async () => {
    let caught: unknown;
    try {
      await accounts.savePendingAuthorization({
        state: "",
        userId: USER,
        connectorId: "youtube",
        flowKind: "magic",
        expiresAtMs: Number.NaN,
      } as unknown as Parameters<PostgresConnectorAccountStore["savePendingAuthorization"]>[0]);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
    expect(await accounts.listPendingAuthorizationsForUser(OTHER_USER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE MODEL-INPUT PRIVACY LAW (the R03 enforcement test)
// ---------------------------------------------------------------------------

describe("R03 model-input privacy law (credentials never feed model inputs)", () => {
  // The TYPE-LEVEL guard: ModelSafeSourceSummary structurally cannot carry
  // credential material. If someone adds a banned field to the summary this
  // assignment stops compiling.
  const _typeGuard: AssertNoCredentialMaterial<ModelSafeSourceSummary> = true;
  void _typeGuard;

  it("TYPE-LEVEL: the summary's key set is free of credential material", () => {
    // The runtime mirror of the compile-time assertion: the summary's own
    // keys (and nested keys) scan clean.
    const sample: ModelSafeSourceSummary = {
      userId: USER,
      connectorId: "youtube",
      authState: "signedIn",
      connected: true,
      authorizedAt: new Date(CLOCK_START).toISOString(),
      lastStateChange: new Date(CLOCK_START).toISOString(),
      availabilityNotes: ["quota: search costs 100 units"],
    };
    expect(scanForCredentialMaterial(sample)).toEqual({ ok: true });
    expect(Object.keys(sample).sort()).toEqual(
      [
        "userId",
        "connectorId",
        "authState",
        "connected",
        "authorizedAt",
        "lastStateChange",
        "availabilityNotes",
      ].sort(),
    );
  });

  it("RUNTIME: summaries built from a REAL sealed account cannot reach the secret", async () => {
    // A real sealed account exists from the lifecycle block (USER/youtube).
    const records = await accounts.listForUser(USER);
    const summaries = toModelSafeSourceSummaries(records);

    const payload = JSON.stringify(summaries);
    expect(payload).not.toContain(SECRET);
    expect(payload).not.toContain(REFRESHED_SECRET);
    // and not the envelope material either
    const raw = await test.db.query<Record<string, unknown>>(
      "SELECT ciphertext, iv, auth_tag FROM connector_accounts WHERE user_id = $1 AND connector_id = $2",
      [USER, "youtube"],
    );
    const row = raw[0];
    expect(row).toBeDefined();
    expect(payload).not.toContain(String(row?.["ciphertext"]));
    expect(payload).not.toContain(String(row?.["iv"]));
    expect(payload).not.toContain(String(row?.["auth_tag"]));

    // The summaries carry the lifecycle truth the model lanes ARE allowed to see
    const youtube = summaries.find((s) => s.connectorId === "youtube");
    expect(youtube?.authState).toBe("signedIn");
    expect(youtube?.connected).toBe(true);
    expect(youtube?.authorizedAt).toBeTypeOf("string");
  });

  it("RUNTIME GUARD: assertNoCredentialMaterial throws the typed loud error on leaky shapes", () => {
    expect(() => assertNoCredentialMaterial({ accessToken: "x" })).toThrow(CredentialMaterialLeakError);
    expect(() => assertNoCredentialMaterial({ nested: { refreshToken: "y" } })).toThrow(
      CredentialMaterialLeakError,
    );
    expect(() => assertNoCredentialMaterial([{ items: [{ secret: "z" }] }])).toThrow(
      CredentialMaterialLeakError,
    );
    expect(() => assertNoCredentialMaterial(new Map([["apiKey", "k"]]))).toThrow(
      CredentialMaterialLeakError,
    );
    // optional fields are leaks too
    expect(() => assertNoCredentialMaterial({ ok: true, clientSecret: undefined })).toThrow(
      CredentialMaterialLeakError,
    );

    // clean shapes pass, including values that merely LOOK secret-ish
    expect(() => assertNoCredentialMaterial({ authState: "signedIn", tokenType: "Bearer" })).not.toThrow();
    expect(() =>
      assertNoCredentialMaterial({ sources: [{ connectorId: "youtube", scopes: ["readonly"] }] }),
    ).not.toThrow();

    // the error names the field + path (actionable diagnostics, no values)
    try {
      assertNoCredentialMaterial({ a: { apiKey: "k" } });
      throw new Error("unreachable: the guard must throw");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(CredentialMaterialLeakError);
      const leak = thrown as CredentialMaterialLeakError;
      expect(leak.field).toBe("apiKey");
      expect(leak.path).toBe("$.a.apiKey");
      expect((leak as PersistenceError).kind).toBe("credential-leak");
      expect(leak.message).not.toContain("k"); // the VALUE never appears
    }
  });

  it("cycles do not crash the scanner and Sets are scanned", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { peer: a };
    a["peer"] = b;
    expect(scanForCredentialMaterial(a)).toEqual({ ok: true });
    expect(() => assertNoCredentialMaterial(new Set([{ password: "p" }]))).toThrow(
      CredentialMaterialLeakError,
    );
  });
});
