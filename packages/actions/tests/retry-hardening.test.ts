/**
 * R17 — failed external action syncs: the named failure + the IDEMPOTENT
 * retry (no silent drops, no double-fires).
 *
 * THE INJECTED FAILURES:
 * - an `unauthorized` driver error (the expired/rejected credential) settles
 *   the record terminally `failed` with the NAMED credential cause — never
 *   a burn-to-exhaustion retry loop (a dead credential never succeeds on
 *   retry);
 * - retries-exhausted transport failures settle `failed` with the
 *   `exhausted` cause;
 * and THE HONEST RECOVERY under test: `retryFailed` re-queues the SAME
 * record (SAME idempotency key — the provider-side dedupe holds, so the
 * retried dispatch can never double-fire), resets the attempt budget, and
 * the next dispatch delivers. Illegal transitions stay typed errors.
 */

import { describe, expect, it } from "bun:test";

import type { UserAction } from "@wfx/domain";
import { ConnectorRegistry } from "@wfx/connectors";

import {
  ActionOutbox,
  OutboxStateError,
  SyncDispatcher,
  createFixtureDriver,
  idempotencyKeyFor,
  type EnqueueResult,
  type OutboxEntry,
  type OutboxRecord,
} from "../src/index";

const T0 = 1_700_000_000_000;

/** Deterministic manual clock — the ONLY time source in these tests. */
class ManualClock {
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

/** Build an outbox entry with defaults. */
function entry(input: {
  userId?: string;
  connectorId?: string;
  action?: UserAction["type"];
  externalRef?: string;
  clientRequestToken?: string;
  payload?: Record<string, unknown>;
} = {}): OutboxEntry {
  return {
    userId: input.userId ?? "user-1",
    connectorId: input.connectorId ?? "sync-src",
    action: input.action ?? "save",
    externalRef: input.externalRef ?? "ext:1",
    clientRequestToken: input.clientRequestToken ?? "req-1",
    locale: "en",
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  };
}

/** A connector-declaring registry over a minimal descriptor (capability truth only). */
function registryOver(connectorId: string, capabilities: readonly string[]): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.register({
    descriptor: () => ({
      id: connectorId,
      version: "0.1.0",
      displayName: `R17 Test Connector ${connectorId} (TEST FIXTURE — never production)`,
      capabilities: [...capabilities] as never[],
      auth: "none",
    }),
    search: async () => [],
    metadata: async () => null,
    resolve: async () => [],
    executeAction: async () => {
      throw new Error("the fixture driver owns execution in these tests");
    },
  });
  return registry;
}

/** Enqueue an entry (the outbox clock is at its start), returning the record. */
async function enqueueRecord(
  outbox: ActionOutbox,
  input?: Parameters<typeof entry>[0],
): Promise<OutboxRecord> {
  const result: EnqueueResult = await outbox.enqueue(entry(input));
  expect(result.outcome).toBe("enqueued");
  return result.record;
}

/** The R17 harness: outbox + registry + scripted fixture driver + dispatcher. */
function harness(script: Record<string, unknown>, retry?: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }) {
  const clock = new ManualClock(T0);
  const outbox = new ActionOutbox({ clock });
  const registry = registryOver("sync-src", ["save"]);
  const driver = createFixtureDriver(script as never, clock);
  const dispatcher = new SyncDispatcher({
    outbox,
    registry,
    clock,
    resolveDriver: (connectorId) => (connectorId === "sync-src" ? driver : undefined),
    ...(retry !== undefined ? { retry } : {}),
  });
  return { clock, outbox, driver, dispatcher };
}

describe("R17 — unauthorized driver errors settle the named terminal failure", () => {
  it("an unauthorized error settles failed TERMINALLY (no retry burn) with the named credential cause", async () => {
    const key = idempotencyKeyFor(entry());
    const { outbox, driver, dispatcher } = harness(
      { [key]: { outcome: "unauthorized" } },
      { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    );

    const record = await enqueueRecord(outbox);
    const report = await dispatcher.tick();
    expect(report.outcomes).toHaveLength(1);
    expect(driver.calls).toHaveLength(1); // EXACTLY one attempt — no burn

    const after = await outbox.get(record.id);
    expect(after!.status).toBe("failed");
    expect(after!.attempts).toBe(1);
    expect(after!.lastCause).toBeDefined();
    expect(after!.lastCause!.kind).toBe("connector-error");
    if (after!.lastCause!.kind === "connector-error") {
      expect(after!.lastCause!.error.kind).toBe("unauthorized");
      if (after!.lastCause!.error.kind === "unauthorized") {
        expect(after!.lastCause!.error.connectorId).toBe("sync-src");
      }
    }
    // The audit names the credential recovery path.
    const outcome = report.outcomes[0]!;
    expect(outcome.to).toBe("failed");
    expect(outcome.cause).toContain("unauthorized");
    expect(outcome.cause).toContain("reconnect the source");
  });

  it("the named failure is recoverable through the idempotent retry after reauthorization", async () => {
    const key = idempotencyKeyFor(entry());
    // Unauthorized once, then (after the operator's reauthorization) ok.
    const { clock, outbox, driver, dispatcher } = harness(
      { [key]: { sequence: [{ outcome: "unauthorized" }, { outcome: "ok" }] } },
      { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    );

    const record = await enqueueRecord(outbox);
    await dispatcher.tick();
    expect((await outbox.get(record.id))!.status).toBe("failed");

    // THE IDEMPOTENT RETRY: same record, same key, fresh budget.
    const requeued = await outbox.retryFailed(record.id, clock.now());
    expect(requeued.status).toBe("pending");
    expect(requeued.attempts).toBe(0);
    expect(requeued.idempotencyKey).toBe(record.idempotencyKey);
    expect(requeued.id).toBe(record.id);

    const report = await dispatcher.tick();
    expect(report.outcomes).toHaveLength(1);
    const after = await outbox.get(record.id);
    expect(after!.status).toBe("delivered");
    expect(after!.receipt?.status).toBe("confirmed");
    // NO DOUBLE-FIRE: exactly two dispatch invocations total (the failed
    // attempt + the retried one), BOTH carrying the SAME idempotency key.
    expect(driver.calls).toHaveLength(2);
    expect(new Set(driver.calls.map((call) => call.idempotencyKey)).size).toBe(1);
  });
});

describe("R17 — retryFailed (the closed transition law)", () => {
  it("re-queues an EXHAUSTED record with the same key and a fresh budget, then delivers", async () => {
    const key = idempotencyKeyFor(entry());
    const { clock, outbox, driver, dispatcher } = harness(
      {
        [key]: {
          sequence: [
            { outcome: "retryable-error" },
            { outcome: "retryable-error" },
            { outcome: "retryable-error" },
            { outcome: "retryable-error" },
            { outcome: "retryable-error" },
            { outcome: "ok" }, // the retried cycle succeeds
          ],
        },
      },
      { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    );

    const record = await enqueueRecord(outbox);
    // Burn the full budget deterministically.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      clock.set(T0 + 10_000 * (attempt + 1));
      await dispatcher.tick();
    }
    const exhausted = await outbox.get(record.id);
    expect(exhausted!.status).toBe("failed");
    expect(exhausted!.attempts).toBe(5);
    expect(exhausted!.lastCause!.kind).toBe("exhausted");

    const requeued = await outbox.retryFailed(record.id, clock.now());
    expect(requeued.status).toBe("pending");
    expect(requeued.attempts).toBe(0);
    expect(requeued.idempotencyKey).toBe(record.idempotencyKey);

    await dispatcher.tick();
    const after = await outbox.get(record.id);
    expect(after!.status).toBe("delivered");
    expect(driver.calls).toHaveLength(6);
    expect(new Set(driver.calls.map((call) => call.idempotencyKey)).size).toBe(1);
  });

  it("refuses every non-failed status (the typed OutboxStateError — never a silent overwrite)", async () => {
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const record = await enqueueRecord(outbox); // pending
    await expect(outbox.retryFailed(record.id, clock.now())).rejects.toBeInstanceOf(OutboxStateError);

    const unknown = await outbox.retryFailed("wfxout_nope", clock.now()).catch((thrown) => thrown);
    expect(unknown).toBeInstanceOf(OutboxStateError);
  });

  it("a delivered record can never be retried (terminal stays terminal)", async () => {
    const key = idempotencyKeyFor(entry());
    const { clock, outbox, dispatcher } = harness({ [key]: { outcome: "ok" } });
    const record = await enqueueRecord(outbox);
    await dispatcher.tick();
    expect((await outbox.get(record.id))!.status).toBe("delivered");
    await expect(outbox.retryFailed(record.id, clock.now())).rejects.toBeInstanceOf(OutboxStateError);
  });

  it("the re-queued record keeps its identity fields verbatim (never a second record)", async () => {
    const key = idempotencyKeyFor(entry({ payload: { note: "keep-me" } }));
    const { clock, outbox, dispatcher } = harness({ [key]: { outcome: "non-retryable-error" } });
    const record = await enqueueRecord(outbox, { payload: { note: "keep-me" } });
    await dispatcher.tick();
    expect((await outbox.get(record.id))!.status).toBe("failed");

    const requeued = await outbox.retryFailed(record.id, clock.now());
    expect(requeued.action).toEqual(record.action);
    expect(requeued.connectorId).toBe(record.connectorId);
    expect(requeued.userId).toBe(record.userId);
    expect(requeued.clientRequestToken).toBe(record.clientRequestToken);
    expect(requeued.enqueuedAt).toBe(record.enqueuedAt);
    // Still exactly ONE record in the store.
    expect((await outbox.all()).length).toBe(1);
  });
});
