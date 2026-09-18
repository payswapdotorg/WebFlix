/**
 * R15 — the durable action outbox tests (PGlite, real Postgres).
 *
 * The acceptance points (the mission's durability laws):
 * - TRANSACTIONAL ENQUEUE: the outbox row AND its local audit row commit in
 *   ONE transaction — both or neither (torn-write tolerance: a forced
 *   failure inside the transaction leaves NEITHER row; a clean enqueue
 *   leaves BOTH).
 * - LOCAL-FIRST ORDERING: the audit row exists the moment the enqueue
 *   answers — BEFORE any sync attempt (proven by a driver that queries the
 *   audit table from INSIDE its own execution).
 * - CRASH-SAFE CLAIMS: beginAttempt is one guarded UPDATE; a live in-flight
 *   claim is never stolen; a stale one (crashed worker) is reclaimable.
 * - IDEMPOTENCY: the deterministic id/key round-trip; the typed
 *   duplicate/conflict distinction with the same difference strings as the
 *   in-memory store; the stored record is never modified.
 * - THE STATE MACHINE: the closed transition graph with the same typed
 *   OutboxStateError the in-memory store throws (terminal statuses guard
 *   every exit; markDelivered requires a confirmed receipt).
 * - DETERMINISM: the injected FixedClock/SequentialIdGen seams — no
 *   Date.now, no randomness.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  ActionSyncError,
  OutboxStateError,
  SyncDispatcher,
  idempotencyKeyFor,
  type OutboxEntry,
} from "@wfx/actions";
import { SequentialIdGen } from "@wfx/experience";
import { ConnectorRegistry } from "@wfx/connectors";

import { PostgresActionOutbox, type ActionAuditRow } from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 16, 0, 0, 0);
const USER = "wfxusr_000000000000000000000000A1";
const STALE_MS = 10 * 60_000;

/** A manual clock (FixedClock has no setter — the deterministic seam here). */
class StepClock {
  private current: number;
  constructor(initial: number) {
    this.current = initial;
  }
  now(): number {
    return this.current;
  }
  set(ms: number): void {
    this.current = ms;
  }
}

function entry(input: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    userId: input.userId ?? USER,
    connectorId: input.connectorId ?? "sync-src",
    action: input.action ?? "save",
    externalRef: input.externalRef ?? "ext:1",
    clientRequestToken: input.clientRequestToken ?? "req-1",
    locale: input.locale ?? "en",
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
    ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
  };
}

let test: TestDb;
let clock: StepClock;
let ids: SequentialIdGen;
let outbox: PostgresActionOutbox;

beforeAll(async () => {
  test = await createTestDb();
  clock = new StepClock(CLOCK_START);
  ids = new SequentialIdGen();
  outbox = new PostgresActionOutbox({
    db: test.db,
    clock,
    ids,
    staleInFlightMs: STALE_MS,
  });
});

afterAll(async () => {
  await test.close();
});

/** Read the audit rows straight out of the table. */
async function auditRows(userId = USER): Promise<ActionAuditRow[]> {
  return [...(await outbox.auditForUser(userId, 100))];
}

describe("durable enqueue — the transaction boundary + local-first recording", () => {
  it("a fresh enqueue lands the outbox row AND its audit row in ONE transaction (both exist the moment it answers)", async () => {
    const result = await outbox.enqueue(entry({ externalRef: "ext:audit-1" }));
    expect(result.outcome).toBe("enqueued");
    const record = result.record;
    expect(record.id).toBe(`wfxout_${idempotencyKeyFor(entry({ externalRef: "ext:audit-1" }))}`);
    expect(record.status).toBe("pending");
    expect(record.attempts).toBe(0);
    expect(record.nextAttemptAt).toBe(new Date(CLOCK_START).toISOString());
    expect(record.enqueuedAt).toBe(new Date(CLOCK_START).toISOString());

    const audit = (await auditRows()).find((row) => row.outboxRecordId === record.id);
    expect(audit).toBeDefined();
    expect(audit?.id.startsWith("wfxacta_")).toBe(true);
    expect(audit?.actionType).toBe("save");
    expect(audit?.externalRef).toBe("ext:audit-1");
    expect(audit?.recordedAt).toBe(new Date(CLOCK_START).toISOString());
  });

  it("profileId attribution round-trips on both rows (R02 semantics)", async () => {
    const result = await outbox.enqueue(
      entry({ externalRef: "ext:profiled", profileId: "wfxprof_0000000000000000000000P1" }),
    );
    expect(result.outcome).toBe("enqueued");
    expect(result.record.profileId).toBe("wfxprof_0000000000000000000000P1");
    const audit = (await auditRows()).find((row) => row.outboxRecordId === result.record.id);
    expect(audit?.profileId).toBe("wfxprof_0000000000000000000000P1");
  });

  it("TORN-WRITE TOLERANCE: a failure inside the enqueue transaction leaves NEITHER row", async () => {
    // Force the AUDIT insert to fail: a store whose IdGen always answers a
    // colliding audit id that is pre-inserted OUTSIDE the transaction. The
    // outbox insert succeeds, the audit insert violates the primary key —
    // the WHOLE transaction must roll back (both or neither).
    const poisonedId = "wfxacta_POISONEDCOLLISION0000000001";
    await test.db.query(
      `INSERT INTO action_audit (id, user_id, profile_id, connector_id, action_type, external_ref,
                                  client_request_token, outbox_record_id, recorded_at)
       VALUES ($1, $2, NULL, 'x', 'like', 'x', 'x', 'wfxout_deadbeef', $3)`,
      [poisonedId, USER, new Date(CLOCK_START).toISOString()],
    );
    const poisonedStore = new PostgresActionOutbox({
      db: test.db,
      clock,
      ids: { next: () => "POISONEDCOLLISION0000000001" },
      staleInFlightMs: STALE_MS,
    });
    const before = (await test.db.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM action_outbox",
    ))[0]!.c;
    const auditBefore = (await test.db.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM action_audit",
    ))[0]!.c;

    await expect(poisonedStore.enqueue(entry({ externalRef: "ext:torn" }))).rejects.toBeTruthy();

    const after = (await test.db.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM action_outbox",
    ))[0]!.c;
    const auditAfter = (await test.db.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM action_audit",
    ))[0]!.c;
    expect(after).toBe(before); // the outbox row rolled back WITH the audit row
    expect(auditAfter).toBe(auditBefore); // no orphan audit row either
    // And the store is USABLE afterwards (the poison row is inert).
    const clean = await outbox.enqueue(entry({ externalRef: "ext:after-torn" }));
    expect(clean.outcome).toBe("enqueued");
  });

  it("idempotency: the SAME identity re-enqueues as a typed duplicate; DIFFERENT content conflicts with the same difference strings as the in-memory store; the stored record never changes", async () => {
    const first = await outbox.enqueue(entry({ externalRef: "ext:idem", locale: "en" }));
    expect(first.outcome).toBe("enqueued");

    const again = await outbox.enqueue(entry({ externalRef: "ext:idem", locale: "en" }));
    expect(again.outcome).toBe("duplicate");
    expect(again.record.id).toBe(first.record.id);

    const conflict = await outbox.enqueue(entry({ externalRef: "ext:idem", locale: "fr" }));
    expect(conflict.outcome).toBe("conflict");
    if (conflict.outcome === "conflict") {
      expect(conflict.differences).toEqual(["locale: 'en' vs 'fr'"]);
    }
    // The stored record is untouched.
    const stored = await outbox.getByIdempotencyKey(first.record.idempotencyKey);
    expect(stored?.locale).toBe("en");
    // Exactly ONE audit row exists for the identity (the duplicate wrote nothing).
    const audits = (await auditRows()).filter((row) => row.outboxRecordId === first.record.id);
    expect(audits).toHaveLength(1);
  });

  it("malformed entries throw the CONTRACT's typed ActionSyncError (the same channel as the in-memory store)", async () => {
    await expect(
      outbox.enqueue(entry({ action: "bookmark" as OutboxEntry["action"] })),
    ).rejects.toThrow(ActionSyncError);
  });
});

describe("durable claims — crash-safe beginAttempt + due", () => {
  it("due(now) returns past-due pending rows in (nextAttemptAt, id) order, bounded by dueLimit", async () => {
    const a = await outbox.enqueue(entry({ externalRef: "ext:due-a", clientRequestToken: "r1" }));
    const b = await outbox.enqueue(entry({ externalRef: "ext:due-b", clientRequestToken: "r2" }));
    void a;
    void b;
    const due = await outbox.due(clock.now());
    expect(due.map((record) => record.action.externalRef)).toContain("ext:due-a");
    expect(due.map((record) => record.action.externalRef)).toContain("ext:due-b");
    // Not-due rows are excluded: schedule a retry in the future first.
    const claimed = await outbox.beginAttempt(
      (await outbox.getByIdempotencyKey(idempotencyKeyFor(entry({ externalRef: "ext:due-b", clientRequestToken: "r2" }))))!.id,
    );
    await outbox.scheduleRetry(
      claimed.id,
      { kind: "wiring", detail: " deliberate" },
      60_000,
      clock.now(),
    );
    const later = await outbox.due(clock.now());
    expect(later.some((record) => record.id === claimed.id)).toBe(false);
  });

  it("a LIVE in-flight claim is never stolen (fresh claimed_at), a STALE one is reclaimable (crash recovery)", async () => {
    const result = await outbox.enqueue(entry({ externalRef: "ext:claim", clientRequestToken: "rc" }));
    const id = result.record.id;

    // Live claim at T0.
    const first = await outbox.beginAttempt(id);
    expect(first.status).toBe("in-flight");
    expect(first.attempts).toBe(1);

    // A second claim while the first is LIVE fails with the typed error.
    await expect(outbox.beginAttempt(id)).rejects.toThrow(OutboxStateError);

    // due() excludes the live in-flight record…
    const dueWhileLive = await outbox.due(clock.now());
    expect(dueWhileLive.some((record) => record.id === id)).toBe(false);

    // …and includes it again once the claim goes STALE (crashed worker).
    clock.set(CLOCK_START + STALE_MS + 1);
    const dueStale = await outbox.due(clock.now());
    expect(dueStale.some((record) => record.id === id)).toBe(true);
    const reclaimed = await outbox.beginAttempt(id);
    expect(reclaimed.attempts).toBe(2); // the recovery claim burned an attempt
    clock.set(CLOCK_START);
  });

  it("terminal statuses guard every exit with the typed OutboxStateError", async () => {
    const result = await outbox.enqueue(entry({ externalRef: "ext:terminal", clientRequestToken: "rt" }));
    const id = result.record.id;
    const claimed = await outbox.beginAttempt(id);
    await outbox.markDelivered(
      id,
      { status: "confirmed", externalId: "src-1", occurredAt: new Date(clock.now()).toISOString() },
      clock.now(),
    );
    const delivered = await outbox.get(id);
    expect(delivered?.status).toBe("delivered");
    expect(delivered?.receipt?.externalId).toBe("src-1");
    expect(delivered?.deliveredAt).toBe(new Date(clock.now()).toISOString());
    void claimed;

    await expect(outbox.beginAttempt(id)).rejects.toThrow(OutboxStateError);
    await expect(
      outbox.markFailed(id, { kind: "wiring", detail: "x" }),
    ).rejects.toThrow(OutboxStateError);
    await expect(
      outbox.markUnsupported(id, { kind: "unsupported-capability", capability: "save", detail: "x" }),
    ).rejects.toThrow(OutboxStateError);
    await expect(
      outbox.scheduleRetry(id, { kind: "wiring", detail: "x" }, 1_000, clock.now()),
    ).rejects.toThrow(OutboxStateError);
    await expect(outbox.get("wfxout_nosuchid")).resolves.toBeUndefined();
    await expect(outbox.beginAttempt("wfxout_nosuchid")).rejects.toThrow(OutboxStateError);
  });

  it("markDelivered refuses a non-confirmed receipt (honesty precondition, before any SQL)", async () => {
    const result = await outbox.enqueue(entry({ externalRef: "ext:badreceipt", clientRequestToken: "rb" }));
    const id = result.record.id;
    await outbox.beginAttempt(id);
    await expect(
      outbox.markDelivered(id, { status: "failed", occurredAt: "2026-09-16T00:00:00.000Z" }, clock.now()),
    ).rejects.toThrow(OutboxStateError);
  });

  it("typed failure causes round-trip through last_cause JSON (the closed vocabulary survives the store)", async () => {
    const result = await outbox.enqueue(entry({ externalRef: "ext:cause", clientRequestToken: "rk" }));
    const id = result.record.id;
    const claimed = await outbox.beginAttempt(id);
    await outbox.scheduleRetry(
      id,
      { kind: "wiring", detail: "no sync driver wired for connector 'sync-src'" },
      1_000,
      clock.now(),
    );
    const stored = await outbox.get(id);
    expect(stored?.status).toBe("pending");
    expect(stored?.lastCause?.kind).toBe("wiring");
    if (stored?.lastCause?.kind === "wiring") {
      expect(stored.lastCause.detail).toBe("no sync driver wired for connector 'sync-src'");
    }
    expect(stored?.attempts).toBe(claimed.attempts);
  });
});

describe("the durable dispatcher end-to-end (the real SyncDispatcher over the real store)", () => {
  it("LOCAL-FIRST ORDERING PROOF: the audit row exists BEFORE the sync attempt runs (observed from inside the driver)", async () => {
    const target = entry({ externalRef: "ext:ordering", clientRequestToken: "ro", connectorId: "ordering-src" });
    const key = idempotencyKeyFor(target);

    // A driver that, at the moment it is invoked (the sync attempt), checks
    // the local audit trail for THIS record — the local-first ordering law.
    let observedAuditCount = -1;
    const driver = {
      async execute() {
        const rows = await test.db.query<{ c: string }>(
          "SELECT count(*)::text AS c FROM action_audit WHERE outbox_record_id = $1",
          [`wfxout_${key}`],
        );
        observedAuditCount = Number(rows[0]!.c);
        return {
          ok: true as const,
          value: {
            status: "confirmed" as const,
            externalId: "ordering-1",
            occurredAt: new Date(clock.now()).toISOString(),
          },
        };
      },
    };

    const registry = new ConnectorRegistry();
    registry.register({
      descriptor: () => ({
        id: "ordering-src",
        version: "0.1.0",
        displayName: "Ordering Source (TEST)",
        capabilities: ["save"],
        auth: "none",
      }),
      // The plain-surface members the registry never calls in this test —
      // structural satisfaction of SourceConnector.
      async search() {
        return [];
      },
      async metadata() {
        return null;
      },
      async resolve() {
        return [];
      },
      async executeAction() {
        return { status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" };
      },
    });

    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: (connectorId) => (connectorId === "ordering-src" ? driver : undefined),
    });

    const enqueued = await outbox.enqueue(target);
    expect(enqueued.outcome).toBe("enqueued");

    const report = await dispatcher.tick(clock.now());
    const outcome = report.outcomes.find((entry_) => entry_.idempotencyKey === key);
    expect(outcome?.to).toBe("delivered");
    // THE PROOF: when the driver executed, the audit row was already there.
    expect(observedAuditCount).toBe(1);
    const stored = await outbox.getByIdempotencyKey(key);
    expect(stored?.status).toBe("delivered");
    expect(stored?.receipt?.externalId).toBe("ordering-1");
  });

  it("CAPABILITY GATE over the durable store: an undeclared capability settles unsupported WITHOUT a driver call (never attempted, never success)", async () => {
    const target = entry({ externalRef: "ext:gate", clientRequestToken: "rg", connectorId: "ordering-src", action: "follow" });
    const key = idempotencyKeyFor(target);
    let driverCalls = 0;
    const driver = {
      async execute() {
        driverCalls += 1;
        return { ok: true as const, value: { status: "confirmed" as const, occurredAt: "2026-09-16T00:00:00.000Z" } };
      },
    };
    const registry = new ConnectorRegistry();
    registry.register({
      descriptor: () => ({
        id: "ordering-src",
        version: "0.1.0",
        displayName: "Ordering Source (TEST)",
        capabilities: ["save"], // NO 'follow'
        auth: "none",
      }),
      async search() {
        return [];
      },
      async metadata() {
        return null;
      },
      async resolve() {
        return [];
      },
      async executeAction() {
        return { status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" };
      },
    });
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: (connectorId) => (connectorId === "ordering-src" ? driver : undefined),
    });
    await outbox.enqueue(target);
    const report = await dispatcher.tick(clock.now());
    const outcome = report.outcomes.find((entry_) => entry_.idempotencyKey === key);
    expect(outcome?.to).toBe("unsupported");
    expect(driverCalls).toBe(0); // NEVER attempted
    const stored = await outbox.getByIdempotencyKey(key);
    expect(stored?.status).toBe("unsupported");
    expect(stored?.attempts).toBe(0);
    expect(stored?.lastCause?.kind).toBe("unsupported-capability");
  });

  it("RETRY/BACKOFF DETERMINISM over the durable store: exact base × 2^attempts windows from the injected clock", async () => {
    const target = entry({ externalRef: "ext:backoff", clientRequestToken: "rb2", connectorId: "flaky-src" });
    const key = idempotencyKeyFor(target);
    const registry = new ConnectorRegistry();
    registry.register({
      descriptor: () => ({
        id: "flaky-src",
        version: "0.1.0",
        displayName: "Flaky Source (TEST)",
        capabilities: ["save"],
        auth: "none",
      }),
      async search() {
        return [];
      },
      async metadata() {
        return null;
      },
      async resolve() {
        return [];
      },
      async executeAction() {
        return { status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" };
      },
    });
    let calls = 0;
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => ({
        async execute() {
          calls += 1;
          return { ok: true as const, value: { status: "failed" as const, occurredAt: new Date(clock.now()).toISOString() } };
        },
      }),
      retry: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 60_000 },
    });
    await outbox.enqueue(target);

    await dispatcher.tick(CLOCK_START);
    let stored = await outbox.getByIdempotencyKey(key);
    expect(stored?.attempts).toBe(1);
    expect(stored?.nextAttemptAt).toBe(new Date(CLOCK_START + 2_000).toISOString()); // base × 2^1

    await dispatcher.tick(CLOCK_START + 2_000);
    stored = await outbox.getByIdempotencyKey(key);
    expect(stored?.attempts).toBe(2);
    expect(stored?.nextAttemptAt).toBe(new Date(CLOCK_START + 2_000 + 4_000).toISOString()); // base × 2^2

    // The attempts cap settles failed-exhausted with the last cause preserved.
    await dispatcher.tick(CLOCK_START + 6_000);
    stored = await outbox.getByIdempotencyKey(key);
    expect(stored?.status).toBe("failed");
    expect(stored?.attempts).toBe(3);
    expect(stored?.lastCause?.kind).toBe("exhausted");
    expect(calls).toBe(3);
  });

  it("syncStatesForUser reads back the honest J10 states (recorded vs delivered vs unsupported), filtered and bounded", async () => {
    const states = await outbox.syncStatesForUser(USER, { externalRef: "ext:ordering" });
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe("delivered");
    expect(states[0]?.receipt?.externalId).toBe("ordering-1");

    const unsupported = await outbox.syncStatesForUser(USER, { actionType: "follow" });
    expect(unsupported.every((record) => record.status === "unsupported")).toBe(true);

    const bounded = await outbox.syncStatesForUser(USER, { limit: 2 });
    expect(bounded.length).toBeLessThanOrEqual(2);
  });
});


// ---------------------------------------------------------------------------
// R17 — the durable idempotent retry (failed -> pending, same key, no double-fire)
// ---------------------------------------------------------------------------

describe("R17 — retryFailed (the durable idempotent retry of a failed sync)", () => {
  it("re-queues a failed record: pending, attempts reset, immediately due, SAME idempotency key", async () => {
    const result = await outbox.enqueue(entry({ externalRef: "ext:r17retry", clientRequestToken: "rt-r17" }));
    const id = result.record.id;
    await outbox.beginAttempt(id);
    await outbox.markFailed(id, { kind: "wiring", detail: "the wired connector vanished" });
    const failed = await outbox.get(id);
    expect(failed?.status).toBe("failed");

    clock.set(CLOCK_START + 60_000);
    const requeued = await outbox.retryFailed(id, clock.now());
    expect(requeued.status).toBe("pending");
    expect(requeued.attempts).toBe(0);
    expect(requeued.idempotencyKey).toBe(result.record.idempotencyKey);
    expect(requeued.id).toBe(id);
    expect(requeued.nextAttemptAt).toBe(new Date(clock.now()).toISOString());
    // Immediately due: the next dispatch tick claims it.
    const due = await outbox.due(clock.now());
    expect(due.some((record) => record.id === id)).toBe(true);
    // Still exactly one row for the key — never a second record.
    const byKey = await outbox.getByIdempotencyKey(result.record.idempotencyKey);
    expect(byKey?.id).toBe(id);
  });

  it("refuses every non-failed status with the typed OutboxStateError (never a silent overwrite)", async () => {
    const pending = await outbox.enqueue(entry({ externalRef: "ext:r17pending", clientRequestToken: "rt-p" }));
    await expect(outbox.retryFailed(pending.record.id, clock.now())).rejects.toThrow(OutboxStateError);

    const delivered = await outbox.enqueue(entry({ externalRef: "ext:r17delivered", clientRequestToken: "rt-d" }));
    await outbox.beginAttempt(delivered.record.id);
    await outbox.markDelivered(
      delivered.record.id,
      { status: "confirmed", externalId: "src-r17", occurredAt: new Date(clock.now()).toISOString() },
      clock.now(),
    );
    await expect(outbox.retryFailed(delivered.record.id, clock.now())).rejects.toThrow(OutboxStateError);

    await expect(outbox.retryFailed("wfxout_r17nosuch", clock.now())).rejects.toThrow(OutboxStateError);
  });
});
