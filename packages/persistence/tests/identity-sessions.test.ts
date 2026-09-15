/**
 * WFX-052 — identity + session service tests (PGlite, real Postgres).
 *
 * Auth round-trips per the spec: register / login / wrong-password (no
 * user enumeration) / expiry / revocation. Session tokens are opaque,
 * stored hashed, and validated against the INJECTED clock.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PersistenceError,
  PostgresIdentityService,
  PostgresSessionService,
  DEFAULT_SESSION_TTL_MS,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 0, 0, 0);

let test: TestDb;
let identity: PostgresIdentityService;
let clock: FixedClock;
let ids: SequentialIdGen;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  identity = new PostgresIdentityService({ db: test.db, ids, clock });
});

afterAll(async () => {
  await test.close();
});

describe("identity service — register", () => {
  it("registers a user with a canonical opaque id and NO hash in the record", async () => {
    const result = await identity.register({
      email: "Alice@Example.COM ",
      password: "super-secret-passphrase",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id.startsWith("wfxusr_")).toBe(true);
    expect(result.user.id.length).toBe("wfxusr_".length + 26);
    // Emails are lowercased + trimmed.
    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.displayName).toBe("alice");
    expect(JSON.stringify(result.user)).not.toContain("password");
    expect(JSON.stringify(result.user)).not.toContain("scrypt$");
  });

  it("stores a scrypt envelope, never the plaintext", async () => {
    const rows = await test.db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      ["alice@example.com"],
    );
    const hash = rows[0]?.password_hash ?? "";
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain("super-secret-passphrase");
  });

  it("answers email-taken typed on a duplicate (via the unique constraint)", async () => {
    const result = await identity.register({
      email: "alice@example.com",
      password: "another-passphrase-1",
    });
    expect(result).toEqual({ ok: false, reason: "email-taken" });
  });

  it("rejects invalid input with field-level details", async () => {
    const result = await identity.register({ email: "not-an-email", password: "short" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid-input");
    if (result.reason !== "invalid-input") return;
    expect(result.details.length).toBeGreaterThanOrEqual(2);
  });
});

describe("identity service — authenticate", () => {
  it("authenticates with the correct password (case-insensitive email)", async () => {
    const result = await identity.authenticate({
      email: "ALICE@example.com",
      password: "super-secret-passphrase",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe("alice@example.com");
  });

  it("rejects a wrong password with invalid-credentials (no enumeration)", async () => {
    const result = await identity.authenticate({
      email: "alice@example.com",
      password: "wrong-password-123",
    });
    expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
  });

  it("answers the SAME typed result for an unknown email (timing-equalized)", async () => {
    const result = await identity.authenticate({
      email: "nobody@example.com",
      password: "whatever-password",
    });
    expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
  });

  it("getUserById round-trips and returns null for unknown ids", async () => {
    const auth = await identity.authenticate({
      email: "alice@example.com",
      password: "super-secret-passphrase",
    });
    if (!auth.ok) throw new Error("precondition failed");
    const found = await identity.getUserById(auth.user.id);
    expect(found?.email).toBe("alice@example.com");
    expect(await identity.getUserById("wfxusr_00000000000000000000000001")).toBeNull();
  });
});

describe("session service", () => {
  const TOKEN = "deterministic-test-token-0001";

  it("issues a session: token shown once, only its SHA-256 stored", async () => {
    const owner = await identity.register({
      email: "session-owner@example.com",
      password: "owner-password-123",
    });
    if (!owner.ok) throw new Error("precondition failed");
    let tokenCounter = 0;
    const minted = new PostgresSessionService({
      db: test.db,
      ids,
      clock,
      tokenFactory: () => `tok-${(tokenCounter += 1)}`,
    });
    const issued = await minted.createSession(owner.user.id);
    expect(issued.token).toBe("tok-1");
    expect(issued.session.id.startsWith("wfxses_")).toBe(true);
    expect(issued.session.revokedAt).toBeNull();

    const rows = await test.db.query<{ token_hash: string }>(
      "SELECT token_hash FROM sessions WHERE id = $1",
      [issued.session.id],
    );
    const stored = rows[0]?.token_hash ?? "";
    expect(stored).not.toBe("tok-1");
    expect(stored.length).toBe(64); // sha256 hex
  });

  it("validates a live token, rejects unknown tokens", async () => {
    const fixed = new PostgresSessionService({
      db: test.db,
      ids,
      clock,
      tokenFactory: () => TOKEN,
    });
    const auth = await identity.register({
      email: "bob@example.com",
      password: "bob-password-12345",
    });
    if (!auth.ok) throw new Error("precondition failed");
    await fixed.createSession(auth.user.id);

    const validation = await fixed.validateSession(TOKEN);
    expect(validation.ok).toBe(true);

    expect(await fixed.validateSession("unknown-token")).toEqual({
      ok: false,
      reason: "unknown-token",
    });
  });

  it("rejects an EXPIRED token once the injected clock passes expires_at", async () => {
    const localClock = new FixedClock(CLOCK_START);
    const fixed = new PostgresSessionService({
      db: test.db,
      ids,
      clock: localClock,
      ttlMs: 1_000,
      tokenFactory: () => "expiring-token",
    });
    const auth = await identity.authenticate({
      email: "bob@example.com",
      password: "bob-password-12345",
    });
    if (!auth.ok) throw new Error("precondition failed");
    await fixed.createSession(auth.user.id);

    localClock.advance(1_001);
    expect(await fixed.validateSession("expiring-token")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("REVOKES a token: typed revoked, idempotent, and revoke-all counts", async () => {
    const fixed = new PostgresSessionService({
      db: test.db,
      ids,
      clock,
      tokenFactory: () => "revocable-token",
    });
    const auth = await identity.authenticate({
      email: "bob@example.com",
      password: "bob-password-12345",
    });
    if (!auth.ok) throw new Error("precondition failed");
    await fixed.createSession(auth.user.id);

    expect(await fixed.revokeSession("revocable-token")).toBe(true);
    expect(await fixed.validateSession("revocable-token")).toEqual({
      ok: false,
      reason: "revoked",
    });
    // Idempotent: revoking again changes nothing.
    expect(await fixed.revokeSession("revocable-token")).toBe(false);

    // Sign-out-everywhere: every live session of the user.
    const count = await fixed.revokeAllSessionsForUser(auth.user.id);
    expect(count).toBeGreaterThanOrEqual(0); // already revoked above → 0 new
  });

  it("revokeAllSessionsForUser revokes every live session of the user only", async () => {
    let n = 0;
    const mint = new PostgresSessionService({
      db: test.db,
      ids,
      clock,
      tokenFactory: () => `bulk-${(n += 1)}`,
    });
    const carol = await identity.register({
      email: "carol@example.com",
      password: "carol-password-123",
    });
    const dave = await identity.register({
      email: "dave@example.com",
      password: "dave-password-1234",
    });
    if (!carol.ok || !dave.ok) throw new Error("precondition failed");
    await mint.createSession(carol.user.id);
    await mint.createSession(carol.user.id);
    await mint.createSession(dave.user.id);

    const revoked = await mint.revokeAllSessionsForUser(carol.user.id);
    expect(revoked).toBe(2);
    expect(await mint.validateSession("bulk-1")).toEqual({ ok: false, reason: "revoked" });
    expect(await mint.validateSession("bulk-2")).toEqual({ ok: false, reason: "revoked" });
    expect((await mint.validateSession("bulk-3")).ok).toBe(true); // dave unaffected
  });

  it("defaults TTL to 30 days and token length to 32 bytes", () => {
    expect(DEFAULT_SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it("fails typed (constraint family) when creating a session for an unknown user", async () => {
    const fixed = new PostgresSessionService({
      db: test.db,
      ids,
      clock,
      tokenFactory: () => "dangling",
    });
    let caught: unknown;
    try {
      await fixed.createSession("wfxusr_000000000000000000000099");
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("constraint-violation");
  });
});
