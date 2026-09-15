/**
 * WFX-052 — the env contract tests (pure unit, no database).
 *
 * The degradation contract's law: a missing `DATABASE_URL` /
 * `APP_ENCRYPTION_KEY` at production boot is a TYPED, LOUD startup error
 * naming the variables — never a fixture fallback, never a silent default.
 */

import { describe, expect, it } from "bun:test";

import {
  PersistenceConfigError,
  readPersistenceEnv,
  requireDatabaseUrl,
  requireEncryptionKey,
} from "../src/index";
import { TEST_ENCRYPTION_KEY_BASE64 } from "./test-db";

describe("readPersistenceEnv", () => {
  it("names BOTH missing variables in one typed error", () => {
    let caught: unknown;
    try {
      readPersistenceEnv({});
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceConfigError);
    const error = caught as PersistenceConfigError;
    expect(error.missing).toContain("DATABASE_URL");
    expect(error.missing).toContain("APP_ENCRYPTION_KEY");
    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("APP_ENCRYPTION_KEY");
    expect(error.kind).toBe("config-error");
  });

  it("names only the missing one when the other is present", () => {
    let caught: unknown;
    try {
      readPersistenceEnv({ DATABASE_URL: "postgres://user:pw@host/db" });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceConfigError);
    expect((caught as PersistenceConfigError).missing).toEqual(["APP_ENCRYPTION_KEY"]);

    caught = undefined;
    try {
      readPersistenceEnv({ APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64 });
    } catch (thrown) {
      caught = thrown;
    }
    expect((caught as PersistenceConfigError).missing).toEqual(["DATABASE_URL"]);
  });

  it("treats blank/whitespace values as missing", () => {
    let caught: unknown;
    try {
      readPersistenceEnv({ DATABASE_URL: "   ", APP_ENCRYPTION_KEY: "" });
    } catch (thrown) {
      caught = thrown;
    }
    expect((caught as PersistenceConfigError).missing).toContain("DATABASE_URL");
    expect((caught as PersistenceConfigError).missing).toContain("APP_ENCRYPTION_KEY");
  });

  it("rejects a non-PostgreSQL URL scheme, naming DATABASE_URL", () => {
    let caught: unknown;
    try {
      readPersistenceEnv({
        DATABASE_URL: "mysql://user:pw@host/db",
        APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceConfigError);
    const error = caught as PersistenceConfigError;
    expect(error.missing).toContain("DATABASE_URL");
    expect(error.message).toContain("postgres://");
    // The value itself is never echoed.
    expect(error.message).not.toContain("mysql://user:pw@host/db");
  });

  it("rejects an APP_ENCRYPTION_KEY that does not decode to 32 bytes", () => {
    let caught: unknown;
    try {
      readPersistenceEnv({
        DATABASE_URL: "postgres://user:pw@host/db",
        APP_ENCRYPTION_KEY: "c2hvcnQta2V5", // "short-key" — 9 bytes
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceConfigError);
    const error = caught as PersistenceConfigError;
    expect(error.missing).toContain("APP_ENCRYPTION_KEY");
    expect(error.message).toContain("32-byte");
  });

  it("returns the validated env on the happy path (base64 or hex key)", () => {
    const fromBase64 = readPersistenceEnv({
      DATABASE_URL: "postgres://user:pw@host/db?sslmode=require",
      APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
    });
    expect(fromBase64.databaseUrl).toBe("postgres://user:pw@host/db?sslmode=require");
    expect(fromBase64.encryptionKey).toBe(TEST_ENCRYPTION_KEY_BASE64);

    const hexKey = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0")).join("");
    const fromHex = readPersistenceEnv({
      DATABASE_URL: "postgresql://u:p@h/d",
      APP_ENCRYPTION_KEY: hexKey,
    });
    expect(fromHex.encryptionKey).toBe(hexKey);
  });

  it("requireDatabaseUrl / requireEncryptionKey enforce the same laws individually", () => {
    expect(() => requireDatabaseUrl({})).toThrow(PersistenceConfigError);
    expect(() => requireDatabaseUrl({ DATABASE_URL: "postgres://ok" })).not.toThrow();
    expect(() => requireEncryptionKey({})).toThrow(PersistenceConfigError);
  });
});
