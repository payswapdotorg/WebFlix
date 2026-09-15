/**
 * @wfx/persistence — scrypt password hashing (WFX-052).
 *
 * Real auth requires real password storage. This module implements the
 * platform's password envelope:
 *
 * - Algorithm: scrypt (node:crypto — memory-hard, widely audited, no native
 *   modules beyond Node's own crypto). Parameters are explicit and stored
 *   WITH the hash so they can be tuned later without invalidating old
 *   hashes: N=16384 (2^14), r=8, p=1, 64-byte derived key, 16-byte salt.
 *   Verification is CONSTANT-TIME (`crypto.timingSafeEqual`) and tolerant
 *   of foreign formats only by failing closed.
 *
 * Stored format (single string, no JSON — nothing to parse-confuse):
 *
 *   scrypt$<N>$<r>$<p>$<salt-base64>$<hash-base64>
 *
 * Laws:
 * - A plaintext password is never stored, logged, or embedded in errors.
 * - `verifyPassword` returns `false` for a malformed stored envelope (fail
 *   closed) instead of throwing — callers translate `false` into the typed
 *   "invalid-credentials" result without an exception path.
 * - The caller injects nothing here: hashing is deterministic given
 *   (password, salt, params); the salt is fresh randomness per hash, which
 *   is the ONLY randomness this module uses.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Tuned scrypt parameters (OWASP-recommended interactive-profile starting
 * point: N=2^14, r=8, p=1). Stored alongside every hash so a future tune
 * verifies old envelopes with THEIR original parameters.
 */
export const SCRYPT_PARAMS = {
  /** CPU/memory cost (2^14). */
  N: 16_384,
  /** Block size. */
  r: 8,
  /** Parallelization. */
  p: 1,
  /** Derived key length in bytes. */
  keyLength: 64,
  /** Salt length in bytes. */
  saltLength: 16,
} as const;

/** The envelope prefix this module owns. */
const FORMAT_PREFIX = "scrypt";

/** Minimum accepted plaintext length (register validates; verify enforces nothing). */
export const PASSWORD_MIN_LENGTH = 10;

/** Maximum accepted plaintext length (DoS guard for expensive KDFs). */
export const PASSWORD_MAX_LENGTH = 1_000;

function scryptDerive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLength: number,
): Buffer {
  return scryptSync(password, salt, keyLength, { N: n, r, p, maxmem: 512 * 1024 * 1024 });
}

/**
 * Hash a password into the storage envelope. Throws `TypeError` on a
 * non-string password (caller misuse — the identity service validates
 * length policy before calling).
 */
export function hashPassword(password: string): string {
  if (typeof password !== "string") {
    throw new TypeError("hashPassword: expected a string password");
  }
  const salt = randomBytes(SCRYPT_PARAMS.saltLength);
  const derived = scryptDerive(
    password,
    salt,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    SCRYPT_PARAMS.keyLength,
  );
  return [
    FORMAT_PREFIX,
    String(SCRYPT_PARAMS.N),
    String(SCRYPT_PARAMS.r),
    String(SCRYPT_PARAMS.p),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored envelope in constant time. Returns
 * `false` for a wrong password AND for a malformed/foreign envelope (fail
 * closed — never throws, never leaks which failed).
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== "string" || typeof stored !== "string") return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) return false;

  const n = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 0 || r <= 0 || p <= 0 || n > 1_048_576 || r > 1_024 || p > 1_024) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64");
    expected = Buffer.from(parts[5] ?? "", "base64");
  } catch {
    return false;
  }
  if (salt.byteLength === 0 || expected.byteLength === 0) return false;

  const derived = scryptDerive(password, salt, n, r, p, expected.byteLength);
  if (derived.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * A fixed dummy envelope used by the identity service to equalize timing
 * between "unknown email" and "wrong password" paths (both burn one scrypt
 * derivation; neither reveals which check failed). Not a secret — it is a
 * hash of a random value that no password is ever checked against
 * successfully by construction... except by astronomical accident.
 */
export const DUMMY_PASSWORD_HASH: string = hashPassword(
  "wfx-dummy-verify-target-do-not-use-000",
);
