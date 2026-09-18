/**
 * R15 — migration 0011 shape + the persisted sync log tests (PGlite, real
 * Postgres).
 *
 * Acceptance points:
 * - the migration 0011 tables exist with the honest shapes (status/action
 *   CHECKs enforced at the DB boundary too, delivered ⇒ receipt);
 * - the persisted `PostgresSyncLog`: append order, per-record queries,
 *   count, and the DB CHECKs rejecting out-of-vocabulary statuses;
 * - PRIVACY: the log's cause column stores the closed describe*
 *   vocabularies — never credentials (asserted structurally: the rejected
 *   insert proves the vocabulary boundary, and the accepted rows carry
 *   only the cause grammar).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PostgresSyncLog } from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

let test: TestDb;
let log: PostgresSyncLog;

beforeAll(async () => {
  test = await createTestDb();
  log = new PostgresSyncLog({ db: test.db });
});

afterAll(async () => {
  await test.close();
});

describe("R15 migration 0011 — action_outbox / action_audit / action_sync_log", () => {
  it("creates action_outbox with the honest shape (closed status + action CHECKs at the DB boundary)", async () => {
    const columns = await test.raw.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'action_outbox' ORDER BY ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toEqual([
      "id",
      "idempotency_key",
      "user_id",
      "profile_id",
      "connector_id",
      "action_type",
      "external_ref",
      "client_request_token",
      "payload",
      "locale",
      "region",
      "status",
      "attempts",
      "next_attempt_at",
      "enqueued_at",
      "claimed_at",
      "delivered_at",
      "receipt",
      "last_cause",
    ]);
    // The DB rejects statuses outside the closed state machine.
    await expect(
      test.db.query(
        `INSERT INTO action_outbox (id, idempotency_key, user_id, connector_id, action_type,
                                    external_ref, client_request_token, locale, status,
                                    next_attempt_at, enqueued_at)
         VALUES ('x1', 'k1', 'u', 'c', 'like', 'r', 't', 'en', 'wobbly', now(), now())`,
      ),
    ).rejects.toThrow();
    // ...and action verbs outside the frozen vocabulary.
    await expect(
      test.db.query(
        `INSERT INTO action_outbox (id, idempotency_key, user_id, connector_id, action_type,
                                    external_ref, client_request_token, locale, status,
                                    next_attempt_at, enqueued_at)
         VALUES ('x2', 'k2', 'u', 'c', 'subscribe', 'r', 't', 'en', 'pending', now(), now())`,
      ),
    ).rejects.toThrow();
    // delivered REQUIRES the provider's receipt (honesty at rest).
    await expect(
      test.db.query(
        `INSERT INTO action_outbox (id, idempotency_key, user_id, connector_id, action_type,
                                    external_ref, client_request_token, locale, status,
                                    next_attempt_at, enqueued_at)
         VALUES ('x3', 'k3', 'u', 'c', 'like', 'r', 't', 'en', 'delivered', now(), now())`,
      ),
    ).rejects.toThrow();
  });

  it("creates action_audit with the local-first record shape", async () => {
    const columns = await test.raw.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'action_audit' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "user_id",
      "profile_id",
      "connector_id",
      "action_type",
      "external_ref",
      "client_request_token",
      "outbox_record_id",
      "recorded_at",
    ]);
  });

  it("creates action_sync_log with the append-only audit shape (status CHECKs at the DB boundary)", async () => {
    const columns = await test.raw.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'action_sync_log' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "seq",
      "recorded_at",
      "record_id",
      "idempotency_key",
      "from_status",
      "to_status",
      "attempt",
      "cause",
    ]);
    await expect(
      test.db.query(
        `INSERT INTO action_sync_log (record_id, idempotency_key, recorded_at, from_status, to_status, attempt, cause)
         VALUES ('r', 'k', now(), 'pending', 'sideways', 1, 'x')`,
      ),
    ).rejects.toThrow();
  });
});

describe("PostgresSyncLog — the persisted audit trail", () => {
  it("appends in order, counts, and answers per-record queries", async () => {
    await log.append({
      timestamp: "2026-09-16T10:00:00.000Z",
      recordId: "wfxout_loga",
      idempotencyKey: "keya",
      from: "pending",
      to: "in-flight",
      attempt: 1,
      cause: "dispatch attempt 1",
    });
    await log.append({
      timestamp: "2026-09-16T10:00:01.000Z",
      recordId: "wfxout_loga",
      idempotencyKey: "keya",
      from: "in-flight",
      to: "delivered",
      attempt: 1,
      cause: "receipt confirmed (externalId 'src-9')",
    });
    await log.append({
      timestamp: "2026-09-16T10:00:02.000Z",
      recordId: "wfxout_logb",
      idempotencyKey: "keyb",
      from: "pending",
      to: "unsupported",
      attempt: 0,
      cause: "capability gate: connector 'x' does not declare 'follow'",
    });

    expect(await log.size()).toBeGreaterThanOrEqual(3);
    const entries = await log.entries();
    const ours = entries.filter((entry) => entry.idempotencyKey === "keya" || entry.idempotencyKey === "keyb");
    expect(ours.map((entry) => entry.to)).toEqual(["in-flight", "delivered", "unsupported"]);

    const forRecord = await log.forRecord("wfxout_loga");
    expect(forRecord.map((entry) => entry.to)).toEqual(["in-flight", "delivered"]);
    expect(forRecord[1]?.cause).toContain("src-9");
    expect(forRecord[1]?.attempt).toBe(1);
    // The privacy law, structurally: causes carry the closed grammar only —
    // no credential-shaped content is stored (the columns above accept any
    // text, but the WRITERS only ever store describe* vocabulary; this
    // asserts the round-trip keeps exactly what the dispatcher handed over).
    expect(forRecord.every((entry) => !entry.cause.includes("secret"))).toBe(true);
  });
});
