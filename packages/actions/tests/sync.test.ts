import { describe, expect, it } from "bun:test";

import type {
  ActionReceipt,
  Capability,
  ConnectorContext,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceConnector,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import {
  BaseConnector,
  ConnectorRegistry,
  REFERENCE_CONNECTOR_ID,
  createReferenceConnector,
  makeStubConnector,
  okResult,
} from "@wfx/connectors";

import {
  ActionOutbox,
  ActionSyncError,
  DEFAULT_RETRY_POLICY,
  OutboxStateError,
  SyncDispatcher,
  SyncLog,
  backoffDelayMs,
  createConnectorDriver,
  createFixtureDriver,
  idempotencyKeyFor,
  reconcile,
  type ActionOutboxStore,
  type EnqueueResult,
  type FixtureScript,
  type OutboxEntry,
  type OutboxRecord,
  type RetryPolicy,
  type SyncDriver,
  type TypedActionExecutor,
} from "../src/index";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

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

const iso = (ms: number): string => new Date(ms).toISOString();

/** Build an outbox entry with defaults (conditional spreads keep exactOptional honest). */
function entry(input: {
  userId?: string;
  connectorId?: string;
  action?: UserAction["type"];
  externalRef?: string;
  clientRequestToken?: string;
  payload?: Record<string, unknown>;
  locale?: string;
  region?: string;
} = {}): OutboxEntry {
  return {
    userId: input.userId ?? "user-1",
    connectorId: input.connectorId ?? "sync-src",
    action: input.action ?? "save",
    externalRef: input.externalRef ?? "ext:1",
    clientRequestToken: input.clientRequestToken ?? "req-1",
    locale: input.locale ?? "en",
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
  };
}

/**
 * A test connector built ON the SDK (never a production source). Declares
 * exactly the capabilities handed in; `onExecuteAction` confirms; the
 * library is scriptable for reconcile tests.
 */
class SyncTestConnector extends BaseConnector {
  public readonly isTestFixture = true as const;
  private readonly libraryEntries: readonly LibraryEntry[];

  constructor(options: {
    id: string;
    capabilities: readonly Capability[];
    library?: readonly LibraryEntry[];
  }) {
    super({
      id: options.id,
      version: "0.1.0",
      displayName: `Sync Test Connector ${options.id} (TEST FIXTURE — never production)`,
      capabilities: [...options.capabilities],
      auth: "none",
    });
    this.libraryEntries = options.library ?? [];
  }

  protected override onSearch(_ctx: ConnectorContext, _query: string): SearchResult[] {
    return [];
  }

  protected override onMetadata(_ctx: ConnectorContext, _ref: string): SourceItem | null {
    return null;
  }

  protected override onResolve(_ctx: ConnectorContext, _ref: string): PlaybackRealization[] {
    return [];
  }

  protected override onExecuteAction(
    _ctx: ConnectorContext,
    action: UserAction,
  ): ActionReceipt {
    return {
      status: "confirmed",
      externalId: `exec-${action.type}-${action.externalRef}`,
      occurredAt: "2024-06-01T00:00:00.000Z",
    };
  }

  protected override onReadLibrary(_ctx: ConnectorContext): LibraryEntry[] {
    return [...this.libraryEntries];
  }
}

/** A raw frozen-interface connector exposing ONLY the plain readLibrary surface. */
function makePlainConnector(options: {
  id: string;
  capabilities: readonly Capability[];
  library: readonly LibraryEntry[];
}): SourceConnector {
  return {
    descriptor: () => ({
      id: options.id,
      version: "0.1.0",
      displayName: `Plain Connector ${options.id}`,
      capabilities: [...options.capabilities],
      auth: "none",
    }),
    search: async () => [],
    metadata: async () => null,
    resolve: async () => [],
    executeAction: async (): Promise<ActionReceipt> => ({
      status: "confirmed",
      occurredAt: "2024-06-01T00:00:00.000Z",
    }),
    readLibrary: async () => [...options.library],
  };
}

/** One full harness: outbox + registry + fixture driver + dispatcher. */
function makeHarness(options: {
  connector: SourceConnector;
  script?: Record<string, FixtureScript>;
  retry?: Partial<RetryPolicy>;
  driver?: SyncDriver;
  clockStart?: number;
}) {
  const clock = new ManualClock(options.clockStart ?? T0);
  const outbox = new ActionOutbox({ clock });
  const registry = new ConnectorRegistry();
  registry.register(options.connector);
  const fixture = createFixtureDriver(options.script ?? {}, clock);
  const driver = options.driver ?? fixture;
  const dispatcher = new SyncDispatcher({
    outbox,
    registry,
    clock,
    resolveDriver: (connectorId) =>
      connectorId === options.connector.descriptor().id ? driver : undefined,
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
  });
  return { clock, outbox, registry, driver: fixture, dispatcher };
}

/** Enqueue an entry (the outbox clock is at T0), returning the record. */
async function enqueue(
  outbox: ActionOutbox,
  input?: Parameters<typeof entry>[0],
): Promise<OutboxRecord> {
  const result: EnqueueResult = await outbox.enqueue(entry(input));
  expect(result.outcome).toBe("enqueued");
  return result.record;
}

// ---------------------------------------------------------------------------
// ActionOutbox — enqueue and idempotency
// ---------------------------------------------------------------------------

describe("ActionOutbox — enqueue and idempotency", () => {
  it("stamps a deterministic id, idempotency key, pending status, zero attempts, and nextAttemptAt = now", async () => {
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const result = await outbox.enqueue(entry());

    expect(result.outcome).toBe("enqueued");
    const record = result.record;
    expect(record.id).toBe(`wfxout_${idempotencyKeyFor(entry())}`);
    expect(record.idempotencyKey).toBe(idempotencyKeyFor(entry()));
    expect(record.status).toBe("pending");
    expect(record.attempts).toBe(0);
    expect(record.nextAttemptAt).toBe(iso(T0));
    expect(record.enqueuedAt).toBe(iso(T0));
    expect(record.action).toEqual({
      type: "save",
      connectorId: "sync-src",
      externalRef: "ext:1",
    });
    expect(await outbox.due(T0)).toEqual([record]);
  });

  it("re-enqueuing the SAME entry returns the SAME record with a typed duplicate marker", async () => {
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    const first = await outbox.enqueue(entry());
    const second = await outbox.enqueue(entry());

    expect(second.outcome).toBe("duplicate");
    expect(second.record.id).toBe(first.record.id);
    expect(second.record).toBe(first.record);
    expect(await outbox.all()).toHaveLength(1);
  });

  it("duplicate enqueue never double-delivers: one driver call for two enqueues", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, driver, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "ok" } },
    });

    const first = await outbox.enqueue(entry());
    const second = await outbox.enqueue(entry());
    expect(second.outcome).toBe("duplicate");

    const report = await dispatcher.tick(T0);
    expect(report.dueCount).toBe(1);
    expect(driver.calls).toHaveLength(1);

    const record = await outbox.get(first.record.id);
    expect(record?.status).toBe("delivered");
    expect(record?.receipt?.status).toBe("confirmed");
    expect(await outbox.all()).toHaveLength(1);
  });

  it("re-enqueue with DIFFERENT content returns a typed conflict marker with differences, record untouched", async () => {
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    const first = await outbox.enqueue(entry());
    const conflicting = await outbox.enqueue(
      entry({ payload: { note: "different" }, locale: "de" }),
    );

    if (conflicting.outcome !== "conflict") {
      throw new Error(`expected a conflict outcome, got '${conflicting.outcome}'`);
    }
    expect(conflicting.record.id).toBe(first.record.id);
    expect(conflicting.differences).toContain("locale: 'en' vs 'de'");
    expect(conflicting.differences.some((difference) => difference.startsWith("payload:"))).toBe(
      true,
    );
    // The stored record is untouched.
    expect((await outbox.get(first.record.id))?.locale).toBe("en");
    expect(await outbox.all()).toHaveLength(1);
  });

  it("idempotency keys separate client request tokens (same action, two requests)", async () => {
    const keyA = idempotencyKeyFor(entry({ clientRequestToken: "req-1" }));
    const keyB = idempotencyKeyFor(entry({ clientRequestToken: "req-2" }));
    expect(keyA).not.toBe(keyB);

    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    await outbox.enqueue(entry({ clientRequestToken: "req-1" }));
    await outbox.enqueue(entry({ clientRequestToken: "req-2" }));
    expect(await outbox.all()).toHaveLength(2);
  });

  it("rejects malformed entries with the typed invalid-input error", async () => {
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    await expect(
      outbox.enqueue(entry({ action: "bookmark" as UserAction["type"] })),
    ).rejects.toThrow(ActionSyncError);
    await expect(outbox.enqueue(entry({ userId: "  " }))).rejects.toThrow(ActionSyncError);
    await expect(outbox.enqueue(entry({ clientRequestToken: "" }))).rejects.toThrow(
      ActionSyncError,
    );
  });
});

// ---------------------------------------------------------------------------
// SyncDispatcher — capability honesty
// ---------------------------------------------------------------------------

describe("SyncDispatcher — capability honesty", () => {
  it("read-only REFERENCE connector (WFX-013): every mutating verb lands unsupported (terminal) with the capability named; the driver is never called", async () => {
    // The SDK's REAL read-only reference connector: catalogSearch |
    // metadata | playEmbed | playBrowser | playExternal | availability |
    // libraryRead — and deliberately NO action capability.
    const reference = createReferenceConnector();
    await reference.initialize();
    const { outbox, driver, dispatcher } = makeHarness({
      connector: reference,
      // NO script entries: if the gate ever leaked a call, the unscripted-key
      // error would surface as `failed`, failing this test loudly.
    });

    const verbs: UserAction["type"][] = ["like", "save", "follow", "comment", "download", "transform"];
    for (const verb of verbs) {
      const result = await outbox.enqueue(entry({ action: verb, connectorId: REFERENCE_CONNECTOR_ID }));
      expect(result.outcome).toBe("enqueued");
    }

    const report = await dispatcher.tick(T0);
    expect(report.dueCount).toBe(6);
    expect(report.outcomes.every((outcome) => outcome.to === "unsupported")).toBe(true);

    for (const record of await outbox.all()) {
      expect(record.status).toBe("unsupported");
      expect(record.attempts).toBe(0);
      expect(record.lastCause?.kind).toBe("unsupported-capability");
      if (record.lastCause?.kind === "unsupported-capability") {
        expect(record.lastCause.capability).toBe(record.action.type);
        expect(record.lastCause.detail).toBe(
          `connector 'wfx-reference' does not declare '${record.action.type}'`,
        );
      }
    }

    // Terminal: a later tick does nothing.
    const again = await dispatcher.tick(T0 + 10_000);
    expect(again.dueCount).toBe(0);
    expect(driver.calls).toHaveLength(0);
  });

  it("read-only STUB fixture: the same law holds for every mutating verb", async () => {
    // The SDK's stub fixture: catalogSearch | metadata | playEmbed only.
    const stub = makeStubConnector();
    const { outbox, driver, dispatcher } = makeHarness({
      connector: stub,
      // NO script entries: if the gate ever leaked a call, the unscripted-key
      // error would surface as `failed`, failing this test loudly.
    });

    const verbs: UserAction["type"][] = ["like", "save", "follow", "comment", "download", "transform"];
    for (const verb of verbs) {
      const result = await outbox.enqueue(entry({ action: verb, connectorId: "stub-test" }));
      expect(result.outcome).toBe("enqueued");
    }

    const report = await dispatcher.tick(T0);
    expect(report.dueCount).toBe(6);
    expect(report.outcomes.every((outcome) => outcome.to === "unsupported")).toBe(true);

    for (const record of await outbox.all()) {
      expect(record.status).toBe("unsupported");
      expect(record.attempts).toBe(0);
      expect(record.lastCause?.kind).toBe("unsupported-capability");
      if (record.lastCause?.kind === "unsupported-capability") {
        expect(record.lastCause.capability).toBe(record.action.type);
        expect(record.lastCause.detail).toBe(
          `connector 'stub-test' does not declare '${record.action.type}'`,
        );
      }
    }

    // Terminal: a later tick does nothing.
    const again = await dispatcher.tick(T0 + 10_000);
    expect(again.dueCount).toBe(0);
    expect(driver.calls).toHaveLength(0);
  });

  it("the production seam adapter over the reference connector answers typed unsupported at the SDK level too (belt and braces)", async () => {
    const reference = createReferenceConnector();
    await reference.initialize();
    const driver = createConnectorDriver(reference);
    const result = await driver.execute({
      idempotencyKey: "k",
      recordId: "r",
      userId: "user-1",
      attempt: 1,
      ctx: { userId: "user-1", locale: "en" },
      action: { type: "save", connectorId: REFERENCE_CONNECTOR_ID, externalRef: "ref:movie-aurora" },
    });
    // The SDK's own capability gate (inside executeActionResult) answers
    // typed unsupported BEFORE the read-only hook could ever fake success.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported");
      if (result.error.kind === "unsupported") {
        expect(result.error.capability).toBe("save");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SyncDispatcher — retries and backoff
// ---------------------------------------------------------------------------

describe("SyncDispatcher — retries and backoff", () => {
  it("retryable error: exact backoff schedule base × 2^attempts, then failed-exhausted at the attempts cap", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, driver, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "retryable-error", reason: "flaky transport" } },
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    // Attempt 1 fails at T0 → next attempt at T0 + 100×2^1 = T0+200.
    await dispatcher.tick(T0);
    let current = await outbox.get(record.id);
    expect(current?.status).toBe("pending");
    expect(current?.attempts).toBe(1);
    expect(current?.nextAttemptAt).toBe(iso(T0 + 200));
    expect(current?.lastCause?.kind).toBe("connector-error");

    // Attempt 2 fails at T0+200 → next at T0+200 + 100×2^2 = T0+600.
    await dispatcher.tick(T0 + 200);
    current = await outbox.get(record.id);
    expect(current?.attempts).toBe(2);
    expect(current?.nextAttemptAt).toBe(iso(T0 + 600));

    // Attempt 3 fails at T0+600 → next at T0+600 + 100×2^3 = T0+1400.
    await dispatcher.tick(T0 + 600);
    current = await outbox.get(record.id);
    expect(current?.attempts).toBe(3);
    expect(current?.nextAttemptAt).toBe(iso(T0 + 1400));

    // Attempt 4 fails at T0+1400 → next at T0+1400 + 100×2^4 = T0+3000.
    await dispatcher.tick(T0 + 1400);
    current = await outbox.get(record.id);
    expect(current?.attempts).toBe(4);
    expect(current?.nextAttemptAt).toBe(iso(T0 + 3000));

    // Attempt 5 fails at T0+3000 → attempts cap reached → failed-exhausted.
    const finalReport = await dispatcher.tick(T0 + 3000);
    current = await outbox.get(record.id);
    expect(current?.status).toBe("failed");
    expect(current?.attempts).toBe(5);
    expect(current?.lastCause?.kind).toBe("exhausted");
    if (current?.lastCause?.kind === "exhausted") {
      expect(current.lastCause.attempts).toBe(5);
      expect(current.lastCause.lastCause).toContain("flaky transport");
    }
    expect(finalReport.outcomes[0]?.to).toBe("failed");
    expect(finalReport.outcomes[0]?.cause).toContain("exhausted after 5 attempts");

    // Exactly five driver calls, attempts 1..5 — no hidden sixth attempt.
    expect(driver.calls.map((call) => call.attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it("backoff delay is capped at maxDelayMs", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "retryable-error" } },
      retry: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 300 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0); // delay 100×2^1 = 200 (< cap)
    expect((await outbox.get(record.id))?.nextAttemptAt).toBe(iso(T0 + 200));

    await dispatcher.tick(T0 + 200); // delay 100×2^2 = 400 → capped at 300
    expect((await outbox.get(record.id))?.nextAttemptAt).toBe(iso(T0 + 200 + 300));

    await dispatcher.tick(T0 + 500); // delay 100×2^3 = 800 → capped at 300
    expect((await outbox.get(record.id))?.nextAttemptAt).toBe(iso(T0 + 500 + 300));

    // And the pure function agrees.
    const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 300 };
    expect(backoffDelayMs(policy, 1)).toBe(200);
    expect(backoffDelayMs(policy, 2)).toBe(300);
    expect(backoffDelayMs(policy, 9)).toBe(300);
  });

  it("records not yet due are skipped by tick (no driver calls, no transitions)", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, driver, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "retryable-error" } },
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0); // fails; next attempt at T0+200
    expect((await outbox.get(record.id))?.attempts).toBe(1);

    const early = await dispatcher.tick(T0 + 199); // NOT due yet
    expect(early.dueCount).toBe(0);
    expect(early.outcomes).toHaveLength(0);
    expect(driver.calls).toHaveLength(1);
    expect(await dispatcher.log.size()).toBe(2); // pending→in-flight, in-flight→pending only

    const onTime = await dispatcher.tick(T0 + 200); // exactly due
    expect(onTime.dueCount).toBe(1);
    expect(driver.calls).toHaveLength(2);
  });

  it("non-retryable error: immediate failed terminal with the error stored", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, driver, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "non-retryable-error", reason: "bad action shape" } },
    });
    const record = await enqueue(outbox);

    const report = await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("failed");
    expect(current?.attempts).toBe(1);
    if (current?.lastCause?.kind === "connector-error") {
      const error = current.lastCause.error;
      if (error.kind === "invalid-input") {
        expect(error.detail).toContain("bad action shape");
      } else {
        throw new Error(`expected an invalid-input error, got '${error.kind}'`);
      }
    } else {
      throw new Error("expected a connector-error cause");
    }
    expect(report.outcomes[0]?.to).toBe("failed");
    expect(driver.calls).toHaveLength(1);

    // Terminal: no further attempts.
    await dispatcher.tick(T0 + 120_000);
    expect(driver.calls).toHaveLength(1);
  });

  it("timeout outcome is a retryable transport failure", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "timeout" } },
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("pending");
    expect(current?.attempts).toBe(1);
    expect(current?.nextAttemptAt).toBe(iso(T0 + 200));
    if (current?.lastCause?.kind === "connector-error") {
      const error = current.lastCause.error;
      if (error.kind === "transport") {
        expect(error.detail).toContain("timeout");
      } else {
        throw new Error(`expected a transport error, got '${error.kind}'`);
      }
    } else {
      throw new Error("expected a connector-error cause");
    }
  });

  it("unknown connector is a retryable wiring failure bounded by the attempts cap", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const { outbox, driver, dispatcher } = makeHarness({
      connector,
      retry: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    // Enqueued against a connector id that is NOT registered anywhere.
    const record = await enqueue(outbox, { connectorId: "ghost-src" });

    await dispatcher.tick(T0);
    let current = await outbox.get(record.id);
    expect(current?.status).toBe("pending");
    expect(current?.attempts).toBe(1);
    expect(current?.lastCause?.kind).toBe("wiring");
    expect(driver.calls).toHaveLength(0);

    await dispatcher.tick(T0 + 200);
    current = await outbox.get(record.id);
    expect(current?.status).toBe("failed");
    expect(current?.lastCause?.kind).toBe("exhausted");
  });

  it("registered connector without a wired driver is a retryable wiring failure", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => undefined, // NOTHING wired for anyone
      retry: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("pending");
    expect(current?.attempts).toBe(1);
    if (current?.lastCause?.kind === "wiring") {
      expect(current.lastCause.detail).toContain("no sync driver wired");
    } else {
      throw new Error("expected a wiring cause");
    }

    await dispatcher.tick(T0 + 200);
    const settled = await outbox.get(record.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.lastCause?.kind).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// SyncDispatcher — receipt mapping
// ---------------------------------------------------------------------------

describe("SyncDispatcher — receipt mapping", () => {
  it("confirmed receipt: delivered terminal with the receipt stored", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: {
        [key]: { outcome: "ok", receipt: { externalId: "src-42", detail: "saved at source" } },
      },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("delivered");
    expect(current?.deliveredAt).toBe(iso(T0));
    expect(current?.receipt?.status).toBe("confirmed");
    expect(current?.receipt?.externalId).toBe("src-42");
    expect(current?.receipt?.detail).toBe("saved at source");
  });

  it("local-only receipt: conflict terminal with the receipt stored in the cause", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: {
        [key]: { outcome: "ok", receipt: { status: "local-only", detail: "cached only" } },
      },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("conflict");
    expect(current?.receipt).toBeUndefined(); // receipts are stored on DELIVERY only
    if (current?.lastCause?.kind === "receipt") {
      expect(current.lastCause.receipt.status).toBe("local-only");
      expect(current.lastCause.receipt.detail).toBe("cached only");
    } else {
      throw new Error("expected a receipt cause");
    }
  });

  it("unsupported receipt: unsupported terminal with the receipt stored in the cause", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: {
        [key]: { outcome: "ok", receipt: { status: "unsupported", detail: "target gone" } },
      },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("unsupported");
    expect(current?.attempts).toBe(1);
    if (current?.lastCause?.kind === "receipt") {
      expect(current.lastCause.receipt.status).toBe("unsupported");
    } else {
      throw new Error("expected a receipt cause");
    }
  });

  it("failed receipt: retryable with backoff", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "ok", receipt: { status: "failed" } } },
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("pending");
    expect(current?.attempts).toBe(1);
    expect(current?.nextAttemptAt).toBe(iso(T0 + 200));
    expect(current?.lastCause?.kind).toBe("receipt");
  });

  it("typed unsupported error (capability declared, source still declines): unsupported terminal", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: { [key]: { outcome: "unsupported", reason: "this item is locked" } },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("unsupported");
    if (current?.lastCause?.kind === "connector-error") {
      const error = current.lastCause.error;
      if (error.kind === "unsupported") {
        expect(error.capability).toBe("save");
        expect(error.detail).toContain("this item is locked");
      } else {
        throw new Error(`expected an unsupported error, got '${error.kind}'`);
      }
    } else {
      throw new Error("expected a connector-error cause");
    }
  });

  it("malformed receipt from a driver: failed terminal with an explicit driver cause", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const badDriver: SyncDriver = {
      execute: async () => ({
        ok: true as const,
        value: { status: 42, occurredAt: "not-a-date" } as unknown as ActionReceipt,
      }),
    };
    const { outbox, dispatcher } = makeHarness({ connector, driver: badDriver });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    const current = await outbox.get(record.id);
    expect(current?.status).toBe("failed");
    expect(current?.attempts).toBe(1);
    if (current?.lastCause?.kind === "driver") {
      expect(current.lastCause.detail).toContain("malformed ActionReceipt");
    } else {
      throw new Error("expected a driver cause");
    }
  });

  it("throwing driver: retryable typed failure, eventually failed-exhausted", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const throwingDriver: SyncDriver = {
      execute: async () => {
        throw new Error("adapter crashed");
      },
    };
    const { outbox, dispatcher } = makeHarness({
      connector,
      driver: throwingDriver,
      retry: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    let current = await outbox.get(record.id);
    expect(current?.status).toBe("pending");
    if (current?.lastCause?.kind === "driver") {
      expect(current.lastCause.detail).toContain("adapter crashed");
    } else {
      throw new Error("expected a driver cause");
    }

    await dispatcher.tick(T0 + 200);
    current = await outbox.get(record.id);
    expect(current?.status).toBe("failed");
    expect(current?.lastCause?.kind).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// SyncDispatcher — audit log
// ---------------------------------------------------------------------------

describe("SyncDispatcher — audit log", () => {
  it("golden retry flow records EVERY transition old → new with cause", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, dispatcher } = makeHarness({
      connector,
      script: {
        [key]: {
          sequence: [
            { outcome: "retryable-error", reason: "first flake" },
            { outcome: "retryable-error", reason: "second flake" },
            { outcome: "ok", receipt: { externalId: "src-7" } },
          ],
        },
      },
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    await dispatcher.tick(T0);
    await dispatcher.tick(T0 + 200);
    await dispatcher.tick(T0 + 600);

    const entries = await dispatcher.log.forRecord(record.id);
    expect(entries).toHaveLength(6);
    // pending → in-flight (attempt 1)
    expect(entries[0]?.from).toBe("pending");
    expect(entries[0]?.to).toBe("in-flight");
    expect(entries[0]?.attempt).toBe(1);
    expect(entries[0]?.timestamp).toBe(iso(T0));
    expect(entries[0]?.cause).toBe("dispatch attempt 1");
    // in-flight → pending (retry 1, backoff 200ms)
    expect(entries[1]?.from).toBe("in-flight");
    expect(entries[1]?.to).toBe("pending");
    expect(entries[1]?.attempt).toBe(1);
    expect(entries[1]?.timestamp).toBe(iso(T0));
    expect(entries[1]?.cause).toContain("first flake");
    expect(entries[1]?.cause).toContain("retry scheduled in 200ms");
    // pending → in-flight (attempt 2)
    expect(entries[2]?.from).toBe("pending");
    expect(entries[2]?.to).toBe("in-flight");
    expect(entries[2]?.attempt).toBe(2);
    expect(entries[2]?.timestamp).toBe(iso(T0 + 200));
    // in-flight → pending (retry 2, backoff 400ms)
    expect(entries[3]?.from).toBe("in-flight");
    expect(entries[3]?.to).toBe("pending");
    expect(entries[3]?.attempt).toBe(2);
    expect(entries[3]?.cause).toContain("second flake");
    expect(entries[3]?.cause).toContain("retry scheduled in 400ms");
    // pending → in-flight (attempt 3)
    expect(entries[4]?.from).toBe("pending");
    expect(entries[4]?.to).toBe("in-flight");
    expect(entries[4]?.attempt).toBe(3);
    // in-flight → delivered
    expect(entries[5]?.from).toBe("in-flight");
    expect(entries[5]?.to).toBe("delivered");
    expect(entries[5]?.attempt).toBe(3);
    expect(entries[5]?.timestamp).toBe(iso(T0 + 600));
    expect(entries[5]?.cause).toBe("receipt confirmed (externalId 'src-7')");
  });

  it("capability-gate rejection logs pending → unsupported directly (no attempt burned)", async () => {
    const stub = makeStubConnector();
    const { outbox, dispatcher } = makeHarness({ connector: stub });
    const record = await enqueue(outbox, { action: "like", connectorId: "stub-test" });

    await dispatcher.tick(T0);
    const entries = await dispatcher.log.forRecord(record.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.from).toBe("pending");
    expect(entries[0]?.to).toBe("unsupported");
    expect(entries[0]?.attempt).toBe(0);
    expect(entries[0]?.cause).toContain("capability gate");
    expect(entries[0]?.cause).toContain("does not declare 'like'");
  });

  it("an externally supplied SyncLog is appended to (composition-root ownership)", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const log = new SyncLog();
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => createFixtureDriver({ [key]: { outcome: "ok" } }, clock),
      log,
    });
    await outbox.enqueue(entry());

    await dispatcher.tick(T0);
    expect(dispatcher.log).toBe(log);
    expect(await log.size()).toBe(2);
    expect((await log.entries())[1]?.to).toBe("delivered");
  });
});

// ---------------------------------------------------------------------------
// SyncDispatcher — golden flow
// ---------------------------------------------------------------------------

describe("SyncDispatcher — golden flow", () => {
  it("enqueue → two retryable failures → success on the third attempt → delivered with receipt stored", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const { outbox, driver, dispatcher } = makeHarness({
      connector,
      script: {
        [key]: {
          sequence: [
            { outcome: "retryable-error", reason: "flake 1" },
            { outcome: "retryable-error", reason: "flake 2" },
            { outcome: "ok", receipt: { externalId: "src-999", detail: "finally saved" } },
          ],
        },
      },
      retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
    });
    const record = await enqueue(outbox);

    const first = await dispatcher.tick(T0);
    expect(first.outcomes[0]?.to).toBe("pending");
    const second = await dispatcher.tick(T0 + 200);
    expect(second.outcomes[0]?.to).toBe("pending");

    const third = await dispatcher.tick(T0 + 600);
    expect(third.outcomes[0]?.to).toBe("delivered");

    const current = await outbox.get(record.id);
    expect(current?.status).toBe("delivered");
    expect(current?.attempts).toBe(3);
    expect(current?.receipt?.externalId).toBe("src-999");
    expect(current?.receipt?.detail).toBe("finally saved");
    // The receipt is stamped by the DRIVER's injected clock (still at T0);
    // delivery bookkeeping (deliveredAt) carries the tick's effective time.
    expect(current?.receipt?.occurredAt).toBe(iso(T0));
    expect(current?.deliveredAt).toBe(iso(T0 + 600));

    // Exactly three driver calls — the golden path burned exactly 3 attempts.
    expect(driver.calls.map((call) => call.attempt)).toEqual([1, 2, 3]);

    // Terminal: a much later tick does nothing.
    const idle = await dispatcher.tick(T0 + 1_000_000);
    expect(idle.dueCount).toBe(0);
    expect(driver.calls).toHaveLength(3);
  });

  it("end-to-end through createConnectorDriver and a real BaseConnector (SDK typed surface)", async () => {
    const connector = new SyncTestConnector({ id: "sdk-src", capabilities: ["save"] });
    await connector.initialize(); // the typed surface requires the operational state.
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: (connectorId) =>
        connectorId === "sdk-src" ? createConnectorDriver(connector) : undefined,
    });

    const result = await outbox.enqueue(entry({ connectorId: "sdk-src" }));
    expect(result.outcome).toBe("enqueued");

    const report = await dispatcher.tick(T0);
    expect(report.outcomes[0]?.to).toBe("delivered");

    const record = await outbox.get(result.record.id);
    expect(record?.status).toBe("delivered");
    expect(record?.receipt?.externalId).toBe("exec-save-ext:1");
    expect(record?.receipt?.status).toBe("confirmed");
  });
});

// ---------------------------------------------------------------------------
// reconcile — drift detection (reporting only)
// ---------------------------------------------------------------------------

describe("reconcile — drift detection", () => {
  const PRESENT: LibraryEntry = {
    connectorId: "recon-src",
    externalRef: "ext:present",
    title: "Present Remotely",
  };

  it("connector without libraryRead: typed unsupported report", async () => {
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    const connector = new SyncTestConnector({ id: "recon-src", capabilities: ["save"] });
    await connector.initialize();

    const report = await reconcile(outbox, connector, "user-1");
    expect(report.ok).toBe(false);
    if (!report.ok && report.reason === "unsupported") {
      expect(report.capability).toBe("libraryRead");
      expect(report.detail).toContain("does not declare 'libraryRead'");
    } else {
      throw new Error("expected an unsupported report");
    }
  });

  it("delivered-local / absent-remote drift is flagged with a re-enqueue suggestion", async () => {
    const key = idempotencyKeyFor(entry({ connectorId: "recon-src", externalRef: "ext:absent" }));
    const connector = new SyncTestConnector({
      id: "recon-src",
      capabilities: ["save", "like", "libraryRead"],
      library: [PRESENT],
    });
    await connector.initialize();
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => createFixtureDriver({ [key]: { outcome: "ok" } }, clock),
    });
    await outbox.enqueue(entry({ connectorId: "recon-src", externalRef: "ext:absent" }));
    await dispatcher.tick(T0);

    const before = JSON.stringify(await outbox.all());
    const report = await reconcile(outbox, connector, "user-1");
    const after = JSON.stringify(await outbox.all());

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.surface).toBe("typed");
      expect(report.remoteRefs).toEqual(["ext:present"]);
      expect(report.drift).toHaveLength(1);
      const drift = report.drift[0];
      expect(drift?.kind).toBe("delivered-local-absent-remote");
      expect(drift?.resolution).toBe("re-enqueue");
      expect(drift?.externalRef).toBe("ext:absent");
      expect(drift?.action).toBe("save");
    } else {
      throw new Error("expected a success report");
    }
    // NO auto-mutation: the outbox is byte-identical after reconciliation.
    expect(after).toBe(before);
  });

  it("absent-local / present-remote drift (failed local) is flagged with an accept-remote suggestion", async () => {
    const key = idempotencyKeyFor(entry({ connectorId: "recon-src", externalRef: "ext:present" }));
    const connector = new SyncTestConnector({
      id: "recon-src",
      capabilities: ["save", "like", "libraryRead"],
      library: [PRESENT],
    });
    await connector.initialize();
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () =>
        createFixtureDriver({ [key]: { outcome: "non-retryable-error" } }, clock),
    });
    await outbox.enqueue(entry({ connectorId: "recon-src", externalRef: "ext:present" }));
    await dispatcher.tick(T0);
    expect((await outbox.all())[0]?.status).toBe("failed");

    const before = JSON.stringify(await outbox.all());
    const report = await reconcile(outbox, connector, "user-1");
    const after = JSON.stringify(await outbox.all());

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.drift).toHaveLength(1);
      const drift = report.drift[0];
      expect(drift?.kind).toBe("absent-local-present-remote");
      expect(drift?.resolution).toBe("accept-remote");
      expect(drift?.externalRef).toBe("ext:present");
    } else {
      throw new Error("expected a success report");
    }
    expect(after).toBe(before);
  });

  it("delivered and present remotely: no drift", async () => {
    const key = idempotencyKeyFor(entry({ connectorId: "recon-src", externalRef: "ext:present" }));
    const connector = new SyncTestConnector({
      id: "recon-src",
      capabilities: ["save", "libraryRead"],
      library: [PRESENT],
    });
    await connector.initialize();
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => createFixtureDriver({ [key]: { outcome: "ok" } }, clock),
    });
    await outbox.enqueue(entry({ connectorId: "recon-src", externalRef: "ext:present" }));
    await dispatcher.tick(T0);

    const report = await reconcile(outbox, connector, "user-1");
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.drift).toHaveLength(0);
      expect(report.compared).toBe(1);
    } else {
      throw new Error("expected a success report");
    }
  });

  it("reconciles against the REAL reference connector (WFX-013): unsupported-local / present-remote drift over fixture library data, outbox untouched", async () => {
    // A save for a ref the reference connector's fixture library already
    // contains — but the reference connector is read-only, so the dispatcher's
    // capability gate settles the record `unsupported` locally. Reconcile
    // must FLAG the disagreement and suggest accept-remote, never mutate.
    const reference = createReferenceConnector();
    await reference.initialize();
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(reference);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => undefined, // read-only source: no driver ever wires up
    });
    await outbox.enqueue(
      entry({ connectorId: REFERENCE_CONNECTOR_ID, externalRef: "ref:movie-aurora" }),
    );
    await dispatcher.tick(T0);
    expect((await outbox.all())[0]?.status).toBe("unsupported");

    const before = JSON.stringify(await outbox.all());
    const report = await reconcile(outbox, reference, "user-1");
    const after = JSON.stringify(await outbox.all());

    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.surface).toBe("typed");
      // The reference fixture library: ref:audio-aurora-score,
      // ref:movie-aurora, ref:series-lighthouse (sorted).
      expect(report.remoteRefs).toEqual([
        "ref:audio-aurora-score",
        "ref:movie-aurora",
        "ref:series-lighthouse",
      ]);
      expect(report.drift).toHaveLength(1);
      const drift = report.drift[0];
      expect(drift?.kind).toBe("absent-local-present-remote");
      expect(drift?.resolution).toBe("accept-remote");
      expect(drift?.externalRef).toBe("ref:movie-aurora");
      expect(drift?.action).toBe("save");
    } else {
      throw new Error("expected a success report");
    }
    // NO auto-mutation: the outbox is byte-identical after reconciliation.
    expect(after).toBe(before);
  });

  it("non-library-evidenced verbs (like) drift with a manual suggestion when compared", async () => {
    const key = idempotencyKeyFor(entry({ connectorId: "recon-src", action: "like", externalRef: "ext:absent" }));
    const connector = new SyncTestConnector({
      id: "recon-src",
      capabilities: ["save", "like", "libraryRead"],
      library: [PRESENT],
    });
    await connector.initialize();
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => createFixtureDriver({ [key]: { outcome: "ok" } }, clock),
    });
    await outbox.enqueue(entry({ connectorId: "recon-src", action: "like", externalRef: "ext:absent" }));
    await dispatcher.tick(T0);

    // Default verbs (["save"]) do not compare likes at all.
    const defaultReport = await reconcile(outbox, connector, "user-1");
    expect(defaultReport.ok).toBe(true);
    if (defaultReport.ok) {
      expect(defaultReport.compared).toBe(0);
      expect(defaultReport.drift).toHaveLength(0);
    } else {
      throw new Error("expected a success report");
    }

    // Widened explicitly: absence in a library proves nothing about a like.
    const widened = await reconcile(outbox, connector, "user-1", { verbs: ["like"] });
    expect(widened.ok).toBe(true);
    if (widened.ok) {
      expect(widened.drift).toHaveLength(1);
      expect(widened.drift[0]?.kind).toBe("delivered-local-absent-remote");
      expect(widened.drift[0]?.resolution).toBe("manual");
    } else {
      throw new Error("expected a success report");
    }
  });

  it("pending records are never reported as drift", async () => {
    const connector = new SyncTestConnector({
      id: "recon-src",
      capabilities: ["save", "libraryRead"],
      library: [PRESENT],
    });
    await connector.initialize();
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    // Never dispatched: still pending, still being worked.
    await outbox.enqueue(entry({ connectorId: "recon-src", externalRef: "ext:absent" }));

    const report = await reconcile(outbox, connector, "user-1");
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.compared).toBe(1);
      expect(report.drift).toHaveLength(0);
    } else {
      throw new Error("expected a success report");
    }
  });

  it("plain-surface connector (readLibrary only, no typed surface) reconciles with the surface marker", async () => {
    const plain = makePlainConnector({
      id: "plain-src",
      capabilities: ["save", "libraryRead"],
      library: [PRESENT],
    });
    const key = idempotencyKeyFor(entry({ connectorId: "plain-src", externalRef: "ext:absent" }));
    const clock = new ManualClock(T0);
    const outbox = new ActionOutbox({ clock });
    const registry = new ConnectorRegistry();
    registry.register(plain);
    const dispatcher = new SyncDispatcher({
      outbox,
      registry,
      clock,
      resolveDriver: () => createFixtureDriver({ [key]: { outcome: "ok" } }, clock),
    });
    await outbox.enqueue(entry({ connectorId: "plain-src", externalRef: "ext:absent" }));
    await dispatcher.tick(T0);

    const report = await reconcile(outbox, plain, "user-1");
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.surface).toBe("plain");
      expect(report.drift).toHaveLength(1);
      expect(report.drift[0]?.kind).toBe("delivered-local-absent-remote");
      expect(report.drift[0]?.resolution).toBe("re-enqueue");
    } else {
      throw new Error("expected a success report");
    }
  });

  it("typed read failure is a typed connector-failed report — never fake empty drift", async () => {
    class FailingLibraryConnector extends SyncTestConnector {
      protected override onReadLibrary(): LibraryEntry[] {
        throw new Error("library exploded");
      }
    }
    const connector = new FailingLibraryConnector({
      id: "recon-src",
      capabilities: ["save", "libraryRead"],
    });
    await connector.initialize();
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });

    const report = await reconcile(outbox, connector, "user-1");
    expect(report.ok).toBe(false);
    if (!report.ok && report.reason === "connector-failed") {
      if (report.error.kind === "transport") {
        expect(report.error.detail).toContain("library exploded");
      } else {
        throw new Error(`expected a transport error, got '${report.error.kind}'`);
      }
    } else {
      throw new Error("expected a connector-failed report");
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism — no randomness, no hidden clock", () => {
  it("two identical runs produce byte-identical records and audit logs", async () => {
    const runGoldenFlow = async (): Promise<{ records: string; log: string }> => {
      const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
      const key = idempotencyKeyFor(entry());
      const { outbox, dispatcher } = makeHarness({
        connector,
        script: {
          [key]: {
            sequence: [
              { outcome: "retryable-error" },
              { outcome: "ok", receipt: { externalId: "src-1" } },
            ],
          },
        },
        retry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10_000 },
      });
      await outbox.enqueue(entry());
      await dispatcher.tick(T0);
      await dispatcher.tick(T0 + 200);
      return {
        records: JSON.stringify(await outbox.all()),
        log: JSON.stringify(await dispatcher.log.entries()),
      };
    };

    const first = await runGoldenFlow();
    const second = await runGoldenFlow();
    expect(second.records).toBe(first.records);
    expect(second.log).toBe(first.log);
  });

  it("the default retry policy matches the task packet defaults", async () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(5);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(1_000);
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// R15 — profile attribution + the durable-store contract
// ---------------------------------------------------------------------------

describe("R15 — profile attribution through the sync lane", () => {
  it("enqueue stores the profileId; a DIFFERENT profileId on the same identity is a typed conflict", async () => {
    const outbox = new ActionOutbox({ clock: new ManualClock(T0) });
    const first = await outbox.enqueue({ ...entry(), profileId: "prof-1" });
    expect(first.outcome).toBe("enqueued");
    expect(first.record.profileId).toBe("prof-1");

    const same = await outbox.enqueue({ ...entry(), profileId: "prof-1" });
    expect(same.outcome).toBe("duplicate");

    const other = await outbox.enqueue({ ...entry(), profileId: "prof-2" });
    expect(other.outcome).toBe("conflict");
    if (other.outcome === "conflict") {
      expect(other.differences.join(" ")).toContain("profileId");
    }
    // The stored record is untouched.
    expect((await outbox.get(first.record.id))?.profileId).toBe("prof-1");
  });

  it("the dispatch request carries the record's profileId; a profileId-less record omits the field", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const requests: (string | undefined)[] = [];
    const { outbox, dispatcher } = makeHarness({
      connector,
      driver: {
        async execute(request) {
          requests.push(request.profileId);
          return okResult({
            status: "confirmed",
            occurredAt: "2024-06-01T00:00:00.000Z",
          });
        },
      },
    });
    await outbox.enqueue({ ...entry(), profileId: "prof-9" });
    await outbox.enqueue({ ...entry(), clientRequestToken: "req-noprofile" });

    await dispatcher.tick(T0);
    expect(requests).toEqual(["prof-9", undefined]);
    expect((await outbox.all()).every((record) => record.status === "delivered")).toBe(true);
  });

  it("createConnectorDriver prefers the profile-aware typed surface when the request carries a profileId", async () => {
    const calls: string[] = [];
    const confirmed: ActionReceipt = { status: "confirmed", occurredAt: "2024-06-01T00:00:00.000Z" };
    const executor: TypedActionExecutor = {
      descriptor: () => ({
        id: "profiled-src",
        version: "0.1.0",
        displayName: "Profiled Source",
        capabilities: ["save"],
        auth: "none",
      }),
      executeActionResult: async () => {
        calls.push("plain");
        return okResult(confirmed);
      },
      executeActionResultForProfile: async (_ctx, profileId, _action) => {
        calls.push(`profile:${profileId}`);
        return okResult(confirmed);
      },
    };
    const driver = createConnectorDriver(executor);
    const ctx: ConnectorContext = { userId: "user-1", locale: "en" };
    const action: UserAction = { type: "save", connectorId: "profiled-src", externalRef: "ext:1" };

    await driver.execute({
      idempotencyKey: "k1",
      recordId: "r1",
      userId: "user-1",
      attempt: 1,
      ctx,
      action,
      profileId: "prof-7",
    });
    await driver.execute({
      idempotencyKey: "k2",
      recordId: "r2",
      userId: "user-1",
      attempt: 1,
      ctx,
      action,
    });
    expect(calls).toEqual(["profile:prof-7", "plain"]);
  });

  it("a store transition superseded by a concurrent worker (OutboxStateError) is audited, never a crash, never fake success", async () => {
    const connector = new SyncTestConnector({ id: "sync-src", capabilities: ["save"] });
    const key = idempotencyKeyFor(entry());
    const clock = new ManualClock(T0);
    const base = new ActionOutbox({ clock });

    /** A store whose beginAttempt always loses the claim to a concurrent worker. */
    const racingStore: ActionOutboxStore = {
      enqueue: (e) => base.enqueue(e),
      due: (now) => base.due(now),
      get: (id) => base.get(id),
      getByIdempotencyKey: (k) => base.getByIdempotencyKey(k),
      all: () => base.all(),
      beginAttempt: async () => {
        throw new OutboxStateError(
          "beginAttempt: cannot transition a record in status 'delivered' (allowed from: pending | in-flight)",
        );
      },
      scheduleRetry: (id, cause, delayMs, now) => base.scheduleRetry(id, cause, delayMs, now),
      markDelivered: (id, receipt, now) => base.markDelivered(id, receipt, now),
      markUnsupported: (id, cause) => base.markUnsupported(id, cause),
      markConflict: (id, cause) => base.markConflict(id, cause),
      markFailed: (id, cause) => base.markFailed(id, cause),
      retryFailed: (id, now) => base.retryFailed(id, now),
    };

    const registry = new ConnectorRegistry();
    registry.register(connector);
    const dispatcher = new SyncDispatcher({
      outbox: racingStore,
      registry,
      clock,
      resolveDriver: () => createFixtureDriver({ [key]: { outcome: "ok" } }, clock),
    });
    await base.enqueue(entry());

    const report = await dispatcher.tick(T0);
    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0];
    expect(outcome?.cause).toContain("superseded by a concurrent dispatch");
    expect(outcome?.to).toBe("pending"); // the record's real state — no fake success
    const entries = await dispatcher.log.forRecord((await base.all())[0]!.id);
    expect(entries[entries.length - 1]?.cause).toContain("superseded");
  });
});
