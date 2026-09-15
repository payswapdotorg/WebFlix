/**
 * @wfx/persistence — the environment contract (WFX-052).
 *
 * Canonical variable names come from the repo's `.env.example` /
 * docs/infrastructure/environment-inventory.md (WFX-053):
 *
 * - `DATABASE_URL`      — Neon PostgreSQL, POOLED endpoint (the runtime
 *   default; the direct endpoint is operator-held for DDL only).
 * - `APP_ENCRYPTION_KEY` — 32-byte secret (base64 or hex) for AES-256-GCM
 *   envelope encryption of credentials at rest.
 *
 * The degradation contract's law: "a failing `DATABASE_URL` is a startup
 * error (typed, loud), never a switch to dev fixtures." This module makes
 * that structural — there is no fixture fallback anywhere in this package;
 * `readPersistenceEnv` either returns a valid env or throws
 * `PersistenceConfigError` NAMING the offending variables. Values are never
 * logged, echoed, or embedded in error messages — only variable names.
 */

import { decodeEncryptionKey } from "./envelope-crypto";
import { PersistenceConfigError } from "./errors";

/** The two required app-runtime variables of the persistence layer. */
export interface PersistenceEnv {
  /** The PostgreSQL connection string (pooled Neon endpoint). */
  readonly databaseUrl: string;
  /** The raw APP_ENCRYPTION_KEY value (base64 or hex) — not decoded here. */
  readonly encryptionKey: string;
}

/** Minimal env bag shape (Node/Bun `process.env` satisfies this). */
export type EnvBag = Record<string, string | undefined>;

function readRequired(env: EnvBag, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PersistenceConfigError(
      `${name} is required at production boot and is missing or empty. ` +
        "WebFlix has no fixture fallback for persistence — set it in the deployment's environment " +
        "(see docs/infrastructure/environment-inventory.md). " +
        "Local development uses WFX_DEV_FIXTURES in the web host; it never reaches this package.",
      [name],
    );
  }
  return value.trim();
}

/** Validate a PostgreSQL connection-string scheme (postgres:// or postgresql://). */
export function assertPostgresUrl(url: string, variable = "DATABASE_URL"): void {
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new PersistenceConfigError(
      `${variable} must be a PostgreSQL connection string starting with postgres:// or postgresql:// ` +
        `(got a value with a different scheme — values are never logged).`,
      [variable],
    );
  }
}

/** Require and validate `DATABASE_URL`. Throws `PersistenceConfigError` naming it. */
export function requireDatabaseUrl(env: EnvBag): string {
  const url = readRequired(env, "DATABASE_URL");
  assertPostgresUrl(url, "DATABASE_URL");
  return url;
}

/** Require `APP_ENCRYPTION_KEY` (presence only; decoding validates length). */
export function requireEncryptionKey(env: EnvBag): string {
  return readRequired(env, "APP_ENCRYPTION_KEY");
}

/**
 * Read and validate the full persistence env. Throws a single typed
 * `PersistenceConfigError` naming EVERY missing/invalid variable so a
 * misconfigured deploy is fixed in one round.
 */
export function readPersistenceEnv(env: EnvBag): PersistenceEnv {
  const missing: string[] = [];

  const rawUrl = env["DATABASE_URL"];
  const hasUrl = typeof rawUrl === "string" && rawUrl.trim().length > 0;
  if (!hasUrl) missing.push("DATABASE_URL");

  const rawKey = env["APP_ENCRYPTION_KEY"];
  const hasKey = typeof rawKey === "string" && rawKey.trim().length > 0;
  if (!hasKey) missing.push("APP_ENCRYPTION_KEY");

  if (missing.length > 0) {
    throw new PersistenceConfigError(
      `missing required persistence environment variables: ${missing.join(", ")}. ` +
        "Production boot requires both (Neon pooled endpoint + 32-byte credential-encryption key). " +
        "There is no fixture fallback — see docs/infrastructure/degradation-behavior.md.",
      missing,
    );
  }

  const databaseUrl = (rawUrl as string).trim();
  assertPostgresUrl(databaseUrl, "DATABASE_URL");

  const encryptionKey = (rawKey as string).trim();
  // Fail fast on a key that cannot be 32 bytes — the same check
  // `decodeEncryptionKey` performs, here at boot instead of at first
  // credential use.
  decodeEncryptionKey(encryptionKey);

  return { databaseUrl, encryptionKey };
}
