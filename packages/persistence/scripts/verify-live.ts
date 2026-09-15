/* eslint-disable no-console */
/**
 * WFX-052 — LIVE Neon verification (run with `bun` against the real
 * DATABASE_URL; NEVER part of `bun test` — it touches the production
 * database).
 *
 * Steps (PASS/FAIL printed per step, non-zero exit on any FAIL):
 *  1. env contract      — DATABASE_URL + APP_ENCRYPTION_KEY present + valid
 *  2. connect           — postgres.js against the POOLED Neon endpoint,
 *                         boot probe with ONE bounded cold-start retry
 *                         (scale-to-zero wake-up window)
 *  3. migrations        — the real migration set applied (idempotent: a
 *                         second run verifies and applies nothing)
 *  4. auth round-trip   — register a unique smoke user (scrypt), authenticate
 *  5. outbox round-trip — write a frozen EntertainmentEvent through the
 *                         transactional outbox, read it back, drain it
 *  6. cleanup           — the smoke rows are deleted (the migrations
 *                         bookkeeping rows REMAIN — they are the real
 *                         migration history)
 *
 * The script prints only variable NAMES, never values; the smoke user's
 * email is generated from a fixed prefix + the current minute so repeated
 * runs never collide on the unique email constraint.
 *
 * Usage: source the operator env, then
 *   cd packages/persistence && bun scripts/verify-live.ts
 */

import { randomBytes } from "node:crypto";

import { FixedClock } from "@wfx/experience";

import {
  CryptoUlidIdGen,
  PersistenceConfigError,
  PostgresEventSink,
  PostgresIdentityService,
  drainEventOutbox,
  listOutboxRowsForUser,
  runMigrations,
} from "../src/index";
import { createPostgresClient } from "../src/postgres-client";
import { readPersistenceEnv } from "../src/env";

/** Fixed smoke instant — the script's clock seam (deterministic stamps). */
const SMOKE_CLOCK_START = Date.UTC(2026, 8, 13, 12, 0, 0);
const SMOKE_EMAIL_PREFIX = "wfx052-smoke+";

interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: StepResult[] = [];

function report(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail.length > 0 ? ` — ${detail}` : ""}`);
}

async function main(): Promise<number> {
  // ── 1. env contract ─────────────────────────────────────────────────────
  let databaseUrl: string;
  try {
    const env = readPersistenceEnv(process.env);
    databaseUrl = env.databaseUrl;
    report(
      "env contract (DATABASE_URL + APP_ENCRYPTION_KEY present, 32-byte key decodes)",
      true,
      "variable names verified; values never printed",
    );
  } catch (thrown) {
    const detail =
      thrown instanceof PersistenceConfigError
        ? `missing/invalid: ${thrown.missing.join(", ")}`
        : String(thrown);
    report("env contract (DATABASE_URL + APP_ENCRYPTION_KEY present, 32-byte key decodes)", false, detail);
    return 1;
  }

  // ── 2. connect (one bounded cold-start retry) ───────────────────────────
  const clock = new FixedClock(SMOKE_CLOCK_START);
  const ids = new CryptoUlidIdGen();
  let db;
  try {
    db = await createPostgresClient(databaseUrl, { coldStartRetries: 1 });
    report(
      "connect via DATABASE_URL (postgres.js, pooled endpoint, one bounded cold-start retry)",
      true,
      "boot probe SELECT 1 ok",
    );
  } catch (thrown) {
    report(
      "connect via DATABASE_URL (postgres.js, pooled endpoint, one bounded cold-start retry)",
      false,
      `${(thrown as Error).name}: ${(thrown as Error).message}`,
    );
    return 1;
  }

  let exitCode = 0;
  let userId = ""; // hoisted: the finally-block cleanup references it
  const email = `${SMOKE_EMAIL_PREFIX}${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${randomBytes(3).toString("hex")}@webflix.smoke`;
  try {
    // ── 3. migrations (idempotent) ─────────────────────────────────────────
    try {
      const first = await runMigrations(db);
      const second = await runMigrations(db);
      const idempotent = second.applied.length === 0 && second.verified.length === second.total;
      report(
        "migrations applied (forward-only; second run idempotent)",
        first.total > 0 && idempotent,
        `first run: applied ${first.applied.length}, verified ${first.verified.length}, total ${first.total}; ` +
          `second run: applied ${second.applied.length}, verified ${second.verified.length}`,
      );
    } catch (thrown) {
      report(
        "migrations applied (forward-only; second run idempotent)",
        false,
        `${(thrown as Error).name}: ${(thrown as Error).message}`,
      );
      return 1;
    }

    // ── 4. auth round-trip ─────────────────────────────────────────────────
    const identity = new PostgresIdentityService({ db, ids, clock });
    try {
      const registered = await identity.register({
        email,
        password: "wfx052-smoke-passphrase",
        displayName: "WFX-052 Smoke",
      });
      if (!registered.ok) {
        report("auth round-trip (register + authenticate, scrypt)", false, `register: ${registered.reason}`);
        return 1;
      }
      userId = registered.user.id;

      const authenticated = await identity.authenticate({
        email,
        password: "wfx052-smoke-passphrase",
      });
      const wrongPassword = await identity.authenticate({
        email,
        password: "definitely-wrong-password",
      });
      const ok =
        authenticated.ok &&
        authenticated.user.id === userId &&
        !wrongPassword.ok &&
        wrongPassword.reason === "invalid-credentials";
      report(
        "auth round-trip (register + authenticate, scrypt)",
        ok,
        `user ${userId} registered + authenticated; wrong password correctly rejected`,
      );
      if (!ok) return 1;
    } catch (thrown) {
      report(
        "auth round-trip (register + authenticate, scrypt)",
        false,
        `${(thrown as Error).name}: ${(thrown as Error).message}`,
      );
      return 1;
    }

    // ── 5. outbox round-trip ───────────────────────────────────────────────
    const sink = new PostgresEventSink({ db, clock, ids });
    let eventId = "";
    try {
      const itemBody = ids.next();
      const itemId = `wfxitm_${itemBody}`;
      await sink.emit({
        userId,
        itemId,
        type: "start",
        occurredAt: new Date(SMOKE_CLOCK_START).toISOString(),
        sessionId: `wfxpses_${ids.next()}`,
        payload: { smoke: "wfx-052-verify-live" },
      });

      const listed = await listOutboxRowsForUser(db, userId);
      const row = listed.find((candidate) => candidate.envelope.event.payload?.["smoke"] === "wfx-052-verify-live");
      if (row === undefined) {
        report("event written via outbox + read back + drained", false, "emitted row not found on read-back");
        return 1;
      }
      eventId = row.id;

      const deliveredIds: string[] = [];
      const drain = await drainEventOutbox(db, {
        deliver: async (envelope) => {
          deliveredIds.push(envelope.eventId);
        },
        now: clock.now(),
      });
      const ok =
        deliveredIds.includes(eventId) &&
        drain.delivered >= 1 &&
        (await listOutboxRowsForUser(db, userId)).find((candidate) => candidate.id === eventId)
          ?.status === "delivered";
      report(
        "event written via outbox + read back + drained",
        ok,
        `event ${eventId} (item ${itemId}) written pending, read back, delivered by the relay`,
      );
      if (!ok) return 1;
    } catch (thrown) {
      report(
        "event written via outbox + read back + drained",
        false,
        `${(thrown as Error).name}: ${(thrown as Error).message}`,
      );
      return 1;
    }
  } finally {
    // ── 6. cleanup (smoke rows only; migration history stays) ───────────────
    try {
      await db.query("DELETE FROM event_outbox WHERE user_id = $1", [userId.length > 0 ? userId : "__none__"]);
      await db.query("DELETE FROM sessions WHERE user_id = $1", [userId.length > 0 ? userId : "__none__"]);
      await db.query("DELETE FROM users WHERE email = $1", [email]);
      const left = await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM users WHERE email = $1",
        [email],
      );
      report(
        "cleanup (smoke rows deleted; migration history kept)",
        (left[0]?.count ?? "1") === "0",
        "smoke user, session, and outbox rows removed",
      );
    } catch (thrown) {
      report(
        "cleanup (smoke rows deleted; migration history kept)",
        false,
        `${(thrown as Error).name}: ${(thrown as Error).message}`,
      );
    }
    await db.close();
  }

  exitCode = results.every((result) => result.ok) ? 0 : 1;
  const passed = results.filter((result) => result.ok).length;
  console.log(`\nWFX-052 live verification: ${passed}/${results.length} steps passed.`);
  return exitCode;
}

const exit = await main();
process.exit(exit);
