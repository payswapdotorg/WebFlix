/**
 * @wfx/persistence — the session service (WFX-052; R02 profile extension).
 *
 * Opaque bearer sessions, honestly stored:
 *
 * - TOKEN: the R02 canonical shape `wfxsess_` + 26-char ULID body (the
 *   domain's `generateUlid` over the INJECTED clock — timestamp-first,
 *   crypto-random body: opaque, not derivable from the user id, unique).
 *   The token is returned to the caller EXACTLY ONCE at creation; it is
 *   never persisted, never logged. The token factory remains the ONLY
 *   randomness-adjacent seam — tests inject deterministic tokens. (The
 *   052 shape — 32 raw random bytes — remains accepted on validation:
 *   stored hashes never expire early; only NEW mints use the R02 shape.)
 * - AT REST: only `sha256(token)` lands in `sessions.token_hash` (UNIQUE).
 *   A database disclosure yields unusable hashes, not usable sessions.
 * - EXPIRY: `expires_at` is checked against the INJECTED clock on every
 *   validation (deterministic tests; the row itself stays for audit until
 *   cleanup).
 * - REVOCATION: setting `revoked_at` — idempotent, auditable, and
 *   `revokeAllSessionsForUser` gives sign-out-everywhere semantics.
 * - TYPED FAILURES: `unknown-token` | `expired` | `revoked` — distinct
 *   reasons, one channel, no exceptions for expected outcomes.
 * - ACTIVE PROFILE (R02): `active_profile_id` is the profile the session
 *   currently operates as (`PUT /profiles/:id/select`). Nullable: a fresh
 *   session resolves to the user's default profile until the user picks
 *   one — per-request resolution, never a hidden mutation. Selection is
 *   OWNERSHIP-CHECKED (a session may only select a profile of its own
 *   user) and carries the typed `unknown-profile` failure.
 *
 * The HTTP/cookie layer that CARRIES these tokens belongs to the web host
 * (later wave); this is the service-function layer the spec asks for.
 */

import { createHash } from "node:crypto";

import { generateUlid } from "@wfx/domain";
import type { Clock, IdGen } from "@wfx/experience";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";

/** A session as callers may see it — never the token or its hash. */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  /** The profile this session operates as (null = the user's default). */
  readonly activeProfileId: string | null;
}

/** The one-time answer of `createSession`: the secret token + the record. */
export interface IssuedSession {
  /** The bearer token. Shown exactly once; store it client-side or lose it. */
  readonly token: string;
  readonly session: SessionRecord;
}

/** Typed validation outcome. */
export type SessionValidation =
  | { ok: true; session: SessionRecord }
  | { ok: false; reason: "unknown-token" }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "revoked" };

/** Typed outcome of {@link PostgresSessionService.setActiveProfile}. */
export type SetActiveProfileResult =
  | { ok: true; session: SessionRecord }
  | { ok: false; reason: "unknown-token" | "expired" | "revoked" }
  | { ok: false; reason: "unknown-profile" };

/** Constructor dependencies. */
export interface SessionServiceOptions {
  readonly db: DbClient;
  readonly ids: IdGen;
  readonly clock: Clock;
  /** Session time-to-live in ms (default 30 days). */
  readonly ttlMs?: number;
  /** Token factory override (tests inject deterministic tokens). */
  readonly tokenFactory?: () => string;
}

/** Default session TTL: 30 days. */
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/** Default token length in bytes (256 bits of entropy — the 052 shape). */
export const SESSION_TOKEN_BYTES = 32;

/** The R02 canonical session-token prefix. */
export const SESSION_TOKEN_PREFIX = "wfxsess_";

/** Is this a structurally canonical R02 token (`wfxsess_` + ULID body)? */
export function isCanonicalSessionToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return false;
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(token.slice(SESSION_TOKEN_PREFIX.length));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

interface SessionSqlRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: unknown;
  expires_at: unknown;
  revoked_at: unknown | null;
  active_profile_id: unknown | null;
}

function mapSession(row: SessionSqlRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: toIsoTimestamp(row.created_at),
    expiresAt: toIsoTimestamp(row.expires_at),
    revokedAt: row.revoked_at === null ? null : toIsoTimestamp(row.revoked_at),
    activeProfileId:
      row.active_profile_id === null || row.active_profile_id === undefined
        ? null
        : String(row.active_profile_id),
  };
}

/** The session service. Construct with { db, ids, clock } — all injected. */
export class PostgresSessionService {
  private readonly db: DbClient;
  private readonly ids: IdGen;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly mintToken: () => string;

  constructor(options: SessionServiceOptions) {
    this.db = options.db;
    this.ids = options.ids;
    this.clock = options.clock;
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.mintToken = options.tokenFactory ?? (() => this.defaultToken());
  }

  /**
   * The R02 default mint: `wfxsess_` + ULID body over the INJECTED clock
   * (crypto-random 80-bit body; in-process monotonic within one clock
   * instant — two mints never collide). Opaque, not derivable from any
   * user data.
   */
  private defaultToken(): string {
    return `${SESSION_TOKEN_PREFIX}${generateUlid(this.clock.now())}`;
  }

  /**
   * Mint a session for `userId`. Returns the one-time token and the record.
   * Fails typed (`PersistenceError`) when the user row does not exist —
   * sessions never dangle off unknown users (FK).
   */
  async createSession(userId: string): Promise<IssuedSession> {
    const token = this.mintToken();
    const nowIso = epochMsToIso(this.clock.now());
    const expiresIso = epochMsToIso(this.clock.now() + this.ttlMs);
    const id = `wfxses_${this.ids.next()}`;
    try {
      const rows = await this.db.query<SessionSqlRow>(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, token_hash, created_at, expires_at, revoked_at, active_profile_id`,
        [id, userId, hashToken(token), nowIso, expiresIso],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("createSession: INSERT returned no row");
      }
      return { token, session: mapSession(row) };
    } catch (thrown) {
      throw classifyDriverError(thrown, "createSession");
    }
  }

  /** Validate a bearer token against the injected clock. Typed outcomes. */
  async validateSession(token: string): Promise<SessionValidation> {
    let row: SessionSqlRow | undefined;
    try {
      const rows = await this.db.query<SessionSqlRow>(
        `SELECT id, user_id, token_hash, created_at, expires_at, revoked_at, active_profile_id
         FROM sessions WHERE token_hash = $1`,
        [hashToken(token)],
      );
      row = rows[0];
    } catch (thrown) {
      throw classifyDriverError(thrown, "validateSession");
    }
    if (row === undefined) return { ok: false, reason: "unknown-token" };

    const record = mapSession(row);
    if (record.revokedAt !== null) return { ok: false, reason: "revoked" };
    if (Date.parse(record.expiresAt) <= this.clock.now()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, session: record };
  }

  /** Revoke the session a token belongs to. `true` when a live row was revoked. */
  async revokeSession(token: string): Promise<boolean> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<{ id: string }>(
        `UPDATE sessions SET revoked_at = $2
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id`,
        [hashToken(token), nowIso],
      );
      return rows.length > 0;
    } catch (thrown) {
      throw classifyDriverError(thrown, "revokeSession");
    }
  }

  /** Sign out everywhere: revoke every live session of `userId`. Returns the count. */
  async revokeAllSessionsForUser(userId: string): Promise<number> {
    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<{ id: string }>(
        `UPDATE sessions SET revoked_at = $2
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [userId, nowIso],
      );
      return rows.length;
    } catch (thrown) {
      throw classifyDriverError(thrown, "revokeAllSessionsForUser");
    }
  }

  /**
   * R02: select the session's active profile (`PUT /profiles/:id/select`).
   * OWNERSHIP-CHECKED in the UPDATE itself: the profile row must belong to
   * the token's user — a session can never select another account's
   * profile (the honest `unknown-profile` answer covers both unknown ids
   * and foreign ids — no cross-account probing). A revoked/expired token
   * answers its typed session failure.
   */
  async setActiveProfile(input: {
    token: string;
    profileId: string;
  }): Promise<SetActiveProfileResult> {
    if (typeof input.profileId !== "string" || input.profileId.length === 0) {
      // Caller misuse — typed throw (never a SQL error).
      throw new PersistenceError("invalid-input", "profileId: expected a non-empty string", {
        operation: "sessions.setActiveProfile",
      });
    }
    const validation = await this.validateSession(input.token);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const session = validation.session;

    try {
      const rows = await this.db.query<SessionSqlRow>(
        `UPDATE sessions s SET active_profile_id = $2
         WHERE s.id = $3
           AND EXISTS (
             SELECT 1 FROM profiles p
             WHERE p.id = $2 AND p.user_id = $1
           )
         RETURNING s.id, s.user_id, s.token_hash, s.created_at, s.expires_at,
                   s.revoked_at, s.active_profile_id`,
        [session.userId, input.profileId, session.id],
      );
      const row = rows[0];
      if (row === undefined) return { ok: false, reason: "unknown-profile" };
      return { ok: true, session: mapSession(row) };
    } catch (thrown) {
      throw classifyDriverError(thrown, "sessions.setActiveProfile");
    }
  }
}
