/**
 * WFX-052 — scrypt password envelope tests (pure unit).
 *
 * Round-trip, wrong-password, foreign/malformed envelope (fail closed),
 * parameter transparency (stored WITH the hash), and the timing
 * dummy-envelope contract used by the identity service.
 */

import { describe, expect, it } from "bun:test";
import { randomBytes, scryptSync } from "node:crypto";

import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SCRYPT_PARAMS,
  hashPassword,
  verifyPassword,
} from "../src/index";

describe("scrypt password envelope", () => {
  it("round-trips: hash → verify true", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple!", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("stores the format prefix and tuned parameters in the envelope", () => {
    const stored = hashPassword("another-password-123");
    const parts = stored.split("$");
    expect(parts.length).toBe(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBe(SCRYPT_PARAMS.N);
    expect(Number(parts[2])).toBe(SCRYPT_PARAMS.r);
    expect(Number(parts[3])).toBe(SCRYPT_PARAMS.p);
  });

  it("uses a fresh salt per hash (two hashes of the same password differ)", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same-password", a)).toBe(true);
    expect(verifyPassword("same-password", b)).toBe(true);
  });

  it("fails CLOSED on malformed or foreign envelopes (no throw, no accept)", () => {
    expect(verifyPassword("x", "not-an-envelope")).toBe(false);
    expect(verifyPassword("x", "bcrypt$2a$12$...")).toBe(false);
    expect(verifyPassword("x", "scrypt$not$n$1$salt$hash")).toBe(false);
    expect(verifyPassword("x", "scrypt$16384$8$1$###$++++")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "scrypt$0$8$1$c2FsdA==$aGFzaA==")).toBe(false); // N=0
  });

  it("verifies envelopes sealed with OTHER valid parameters (transparent tuning)", () => {
    // Manually seal with a weaker N — verify must honor the STORED params.
    const salt = randomBytes(16);
    const derived = scryptSync("tuned-password", salt, 64, { N: 8192, r: 8, p: 1 });
    const stored = ["scrypt", "8192", "8", "1", salt.toString("base64"), derived.toString("base64")].join("$");
    expect(verifyPassword("tuned-password", stored)).toBe(true);
    expect(verifyPassword("other", stored)).toBe(false);
  });

  it("policy constants are the tuned interactive profile", () => {
    expect(SCRYPT_PARAMS.N).toBe(16_384);
    expect(SCRYPT_PARAMS.r).toBe(8);
    expect(SCRYPT_PARAMS.p).toBe(1);
    expect(SCRYPT_PARAMS.keyLength).toBe(64);
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(8);
    expect(PASSWORD_MAX_LENGTH).toBeLessThanOrEqual(1_000);
  });

  it("the DUMMY envelope is a valid scrypt envelope (usable for timing equalization)", () => {
    expect(DUMMY_PASSWORD_HASH.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("definitely-not-the-dummy-target", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});
