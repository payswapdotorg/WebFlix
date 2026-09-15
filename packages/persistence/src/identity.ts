/**
 * @wfx/persistence — the identity service: register + authenticate (WFX-052).
 *
 * Real auth, service-function form (the HTTP/cookie layer belongs to the
 * web host in a later wave — this package delivers typed results):
 *
 * - REGISTER: validates email shape + password policy, lowercases + trims
 *   the email, hashes the password with scrypt (src/passwords.ts), mints a
 *   canonical opaque user id (`wfxusr_` + ULID body from the injected
 *   IdGen), inserts. A taken email is the TYPED result
 *   `{ ok: false, reason: "email-taken" }` — detected via the database's
 *   unique constraint, not a pre-read race.
 * - AUTHENTICATE: fetch by lowercased email; verify with constant-time
 *   scrypt. UNKNOWN EMAIL and WRONG PASSWORD both burn exactly one scrypt
 *   derivation and both answer `{ ok: false, reason: "invalid-credentials" }`
 *   — no user enumeration through timing or through the result shape.
 * - User records handed out NEVER contain the password hash.
 *
 * IDs: `wfxusr_` + 26-char ULID body. The frozen contracts treat `userId`
 * as an opaque string; the prefix keeps operator logs self-describing and
 * the ULID body keeps ids collision-free and sortable.
 */

import type { IdGen, Clock } from "@wfx/experience";

import { classifyDriverError, isUniqueViolation } from "./classify";
import { PersistenceError } from "./errors";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "./passwords";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";

/** A user as the rest of the platform may see it — never the password hash. */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Typed register outcome. */
export type RegisterResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: "email-taken" }
  | { ok: false; reason: "invalid-input"; details: readonly string[] };

/** Typed authenticate outcome. */
export type AuthenticateResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: "invalid-credentials" }
  | { ok: false; reason: "invalid-input"; details: readonly string[] };

/** Constructor dependencies. */
export interface IdentityServiceOptions {
  readonly db: DbClient;
  readonly ids: IdGen;
  readonly clock: Clock;
}

/** Loose-but-honest email shape check (the mail server remains the authority). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserSqlRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: unknown;
  updated_at: unknown;
}

function mapUser(row: UserSqlRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

/** The identity service. Construct with { db, ids, clock } — all injected. */
export class PostgresIdentityService {
  private readonly db: DbClient;
  private readonly ids: IdGen;
  private readonly clock: Clock;

  constructor(options: IdentityServiceOptions) {
    this.db = options.db;
    this.ids = options.ids;
    this.clock = options.clock;
  }

  /** Register a user. See the module docs for the typed outcomes. */
  async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<RegisterResult> {
    const problems: string[] = [];
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) {
      problems.push("email: expected a valid email address");
    }
    if (
      typeof input.password !== "string" ||
      input.password.length < PASSWORD_MIN_LENGTH ||
      input.password.length > PASSWORD_MAX_LENGTH
    ) {
      problems.push(
        `password: expected between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
      );
    }
    const displayName =
      typeof input.displayName === "string" && input.displayName.trim().length > 0
        ? input.displayName.trim()
        : email.split("@")[0] || "user";
    if (problems.length > 0) return { ok: false, reason: "invalid-input", details: problems };

    const nowIso = epochMsToIso(this.clock.now());
    const id = `wfxusr_${this.ids.next()}`;
    try {
      const rows = await this.db.query<UserSqlRow>(
        `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, email, display_name, password_hash, created_at, updated_at`,
        [id, email, displayName, hashPassword(input.password), nowIso],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new PersistenceError("unknown", "register: INSERT returned no row", {
          operation: "register",
        });
      }
      return { ok: true, user: mapUser(row) };
    } catch (thrown) {
      if (isUniqueViolation(thrown)) return { ok: false, reason: "email-taken" };
      throw classifyDriverError(thrown, "register");
    }
  }

  /** Authenticate by email + password. See the module docs (no enumeration). */
  async authenticate(input: {
    email: string;
    password: string;
  }): Promise<AuthenticateResult> {
    const problems: string[] = [];
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email)) problems.push("email: expected a valid email address");
    if (typeof input.password !== "string" || input.password.length === 0) {
      problems.push("password: expected a non-empty string");
    }
    if (problems.length > 0) return { ok: false, reason: "invalid-input", details: problems };

    let row: UserSqlRow | undefined;
    try {
      const rows = await this.db.query<UserSqlRow>(
        `SELECT id, email, display_name, password_hash, created_at, updated_at
         FROM users WHERE email = $1`,
        [email],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "authenticate");
    }

    if (row === undefined) {
      // Equalize timing with the wrong-password path: burn one scrypt
      // derivation against a fixed dummy envelope before answering.
      verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      return { ok: false, reason: "invalid-credentials" };
    }

    if (!verifyPassword(input.password, row.password_hash)) {
      return { ok: false, reason: "invalid-credentials" };
    }
    return { ok: true, user: mapUser(row) };
  }

  /** Fetch one user by id (no hash in the answer). `null` when unknown. */
  async getUserById(userId: string): Promise<UserRecord | null> {
    try {
      const rows = await this.db.query<UserSqlRow>(
        `SELECT id, email, display_name, password_hash, created_at, updated_at
         FROM users WHERE id = $1`,
        [userId],
      );
      const row = rows[0];
      return row === undefined ? null : mapUser(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "getUserById");
    }
  }
}
