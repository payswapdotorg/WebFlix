/**
 * WFX-052 — credential envelope encryption + connector accounts tests
 * (PGlite for the account store; pure unit for the envelope).
 *
 * The spec's acceptance points: credential encrypt/decrypt round-trip, TAMPER
 * detection, wrong-key behavior (rotation), and no plaintext at rest.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  CredentialDecryptError,
  PersistenceConfigError,
  PersistenceError,
  PostgresConnectorAccountStore,
  decodeEncryptionKey,
  keyIdFor,
  openSecret,
  sealSecret,
} from "../src/index";
import {
  OTHER_ENCRYPTION_KEY,
  TEST_ENCRYPTION_KEY,
  TEST_ENCRYPTION_KEY_BASE64,
  createTestDb,
  type TestDb,
} from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 10, 0, 0);
const USER = "wfxusr_00000000000000000000000001";
const SECRET = "ya29.super-secret-oauth-token-value";

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

describe("decodeEncryptionKey (APP_ENCRYPTION_KEY contract)", () => {
  it("decodes base64 and hex forms to exactly 32 bytes", () => {
    expect(decodeEncryptionKey(TEST_ENCRYPTION_KEY_BASE64)).toEqual(TEST_ENCRYPTION_KEY);
    const hex = Array.from(TEST_ENCRYPTION_KEY, (byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(decodeEncryptionKey(hex)).toEqual(TEST_ENCRYPTION_KEY);
  });

  it("rejects wrong-length and malformed keys typed (naming the variable)", () => {
    expect(() => decodeEncryptionKey("c2hvcnQ=")).toThrow(PersistenceConfigError);
    expect(() => decodeEncryptionKey("zzzz")).toThrow(PersistenceConfigError);
    expect(() => decodeEncryptionKey("")).toThrow(PersistenceConfigError);
    try {
      decodeEncryptionKey("c2hvcnQ=");
    } catch (thrown) {
      expect((thrown as PersistenceConfigError).missing).toContain("APP_ENCRYPTION_KEY");
    }
  });

  it("keyIdFor is a stable fingerprint that differs per key", () => {
    expect(keyIdFor(TEST_ENCRYPTION_KEY)).toBe(keyIdFor(TEST_ENCRYPTION_KEY));
    expect(keyIdFor(TEST_ENCRYPTION_KEY)).not.toBe(keyIdFor(OTHER_ENCRYPTION_KEY));
    expect(keyIdFor(TEST_ENCRYPTION_KEY)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("envelope seal/open (AES-256-GCM)", () => {
  it("round-trips a secret under the sealing key", () => {
    const sealed = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    expect(sealed.ciphertext.length).toBeGreaterThan(0);
    expect(openSecret(TEST_ENCRYPTION_KEY, sealed)).toBe(SECRET);
  });

  it("uses a FRESH IV per seal (identical secrets differ at rest)", () => {
    const a = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    const b = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(openSecret(TEST_ENCRYPTION_KEY, a)).toBe(SECRET);
    expect(openSecret(TEST_ENCRYPTION_KEY, b)).toBe(SECRET);
  });

  it("DETECTS ciphertext tampering (typed CredentialDecryptError)", () => {
    const sealed = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    const flipped = sealed.ciphertext.slice(0, -2) + (sealed.ciphertext.endsWith("AA") ? "BB" : "AA");
    expect(() => openSecret(TEST_ENCRYPTION_KEY, { ...sealed, ciphertext: flipped })).toThrow(
      CredentialDecryptError,
    );
  });

  it("DETECTS auth-tag and IV tampering", () => {
    const sealed = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    expect(() => openSecret(TEST_ENCRYPTION_KEY, { ...sealed, authTag: "AAAA".repeat(4) })).toThrow(
      CredentialDecryptError,
    );
    expect(() => openSecret(TEST_ENCRYPTION_KEY, { ...sealed, iv: "AAAAAAAAAAAAAAAA" })).toThrow(
      CredentialDecryptError,
    );
  });

  it("fails typed under a DIFFERENT key (rotation without re-seal)", () => {
    const sealed = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    expect(() => openSecret(OTHER_ENCRYPTION_KEY, sealed)).toThrow(CredentialDecryptError);
  });

  it("rejects truncated base64 fields typed", () => {
    const sealed = sealSecret(TEST_ENCRYPTION_KEY, SECRET);
    expect(() => openSecret(TEST_ENCRYPTION_KEY, { ...sealed, iv: "not-base64!!" })).toThrow(
      CredentialDecryptError,
    );
  });
});

describe("connector account store", () => {
  it("saveAccount + loadAccount round-trip the credential", async () => {
    const saved = await accounts.saveAccount({
      userId: USER,
      connectorId: "youtube",
      kind: "oauth-token",
      authState: "signedIn",
      secret: SECRET,
      metadata: { scope: "youtube.readonly" },
    });
    expect(saved.id.startsWith("wfxacct_")).toBe(true);
    expect(saved.authState).toBe("signedIn");
    expect(saved.keyId).toBe(keyIdFor(TEST_ENCRYPTION_KEY));
    // The record handed out NEVER contains the secret.
    expect(JSON.stringify(saved)).not.toContain(SECRET);

    const loaded = await accounts.loadAccount(USER, "youtube");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.account.secret).toBe(SECRET);
    expect(loaded.account.kind).toBe("oauth-token");
    expect(loaded.account.metadata).toEqual({ scope: "youtube.readonly" });
  });

  it("stores NO plaintext secret anywhere in the row (raw SQL check)", async () => {
    const rows = await test.db.query<Record<string, unknown>>(
      "SELECT * FROM connector_accounts WHERE user_id = $1 AND connector_id = $2",
      [USER, "youtube"],
    );
    const row = rows[0];
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(String(row?.["ciphertext"])).not.toBe(SECRET);
  });

  it("re-saving rotates the credential and keeps the account id stable", async () => {
    const first = await accounts.saveAccount({
      userId: USER,
      connectorId: "youtube",
      kind: "oauth-token",
      authState: "signedIn",
      secret: SECRET,
    });
    const second = await accounts.saveAccount({
      userId: USER,
      connectorId: "youtube",
      kind: "oauth-token",
      authState: "signedIn",
      secret: "ya29.ROTATED-refreshed-token",
    });
    expect(second.id).toBe(first.id); // one account per (user, connector)

    const loaded = await accounts.loadAccount(USER, "youtube");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.account.secret).toBe("ya29.ROTATED-refreshed-token");
  });

  it("answers key-mismatch typed when a DIFFERENT key sealed the row", async () => {
    await accounts.saveAccount({
      userId: USER,
      connectorId: "vimeo",
      kind: "oauth-token",
      authState: "signedIn",
      secret: "vimeo-secret-token",
    });
    const rotated = new PostgresConnectorAccountStore({
      db: test.db,
      clock,
      key: OTHER_ENCRYPTION_KEY,
      ids,
    });
    const loaded = await rotated.loadAccount(USER, "vimeo");
    expect(loaded).toEqual({
      ok: false,
      reason: "key-mismatch",
      storedKeyId: keyIdFor(TEST_ENCRYPTION_KEY),
      expectedKeyId: keyIdFor(OTHER_ENCRYPTION_KEY),
    });
  });

  it("answers decrypt-failed typed for a TAMPERED envelope", async () => {
    await accounts.saveAccount({
      userId: USER,
      connectorId: "twitch",
      kind: "oauth-token",
      authState: "signedIn",
      secret: "twitch-secret-token",
    });
    await test.db.query(
      `UPDATE connector_accounts SET ciphertext = 'AAAA' || substring(ciphertext from 5) WHERE user_id = $1 AND connector_id = $2`,
      [USER, "twitch"],
    );
    const loaded = await accounts.loadAccount(USER, "twitch");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toBe("decrypt-failed");
  });

  it("answers not-found for an unknown (user, connector) pair", async () => {
    expect(await accounts.loadAccount(USER, "never-connected")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("setAuthState updates only the projection; listForUser leaks no secrets", async () => {
    const updated = await accounts.setAuthState(USER, "youtube", "expired");
    expect(updated?.authState).toBe("expired");
    expect(await accounts.setAuthState(USER, "never-connected", "signedIn")).toBeNull();

    const listed = await accounts.listForUser(USER);
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(listed)).not.toContain("ya29.ROTATED");
  });

  it("deleteAccount removes the row and reports honestly", async () => {
    expect(await accounts.deleteAccount(USER, "twitch")).toBe(true);
    expect(await accounts.deleteAccount(USER, "twitch")).toBe(false);
    expect(await accounts.loadAccount(USER, "twitch")).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects malformed input typed (invalid-input, no row written)", async () => {
    let caught: unknown;
    try {
      await accounts.saveAccount({
        userId: "",
        connectorId: "youtube",
        kind: "magic-token",
        authState: "somewhere",
        secret: "",
      } as unknown as Parameters<PostgresConnectorAccountStore["saveAccount"]>[0]);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");

    let stateCaught: unknown;
    try {
      await accounts.setAuthState(USER, "youtube", "sleeping" as never);
    } catch (thrown) {
      stateCaught = thrown;
    }
    expect(stateCaught).toBeInstanceOf(PersistenceError);
  });

  it("rejects a construction with a non-32-byte key typed (config-error)", () => {
    let caught: unknown;
    try {
      new PostgresConnectorAccountStore({
        db: test.db,
        clock,
        key: new Uint8Array(16),
        ids,
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("config-error");
  });
});
