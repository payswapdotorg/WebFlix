/**
 * R17 — `POST /experience/actions/retry` (the failed-sync recovery route).
 *
 * THE LAWS UNDER TEST (each with an injected failure and an asserted honest
 * state — never a fabricated success):
 * - IDEMPOTENT RETRY: a terminally `failed` record is re-queued with the
 *   SAME idempotency key (the no-double-fire law — the provider-side
 *   dedupe key is the record's own), a fresh attempt budget, and one
 *   bounded dispatch tick whose honest outcome is answered.
 * - OWNERSHIP: another identity's record answers the typed 403; an unknown
 *   record answers the typed 404; a non-failed record answers the typed
 *   409 (the closed state machine's own law, surfaced — never a silent
 *   overwrite).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type {
  ActionReceipt,
  ConnectorContext,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";
import { BaseConnector } from "@wfx/connectors";
import type { ConnectorPort } from "@wfx/experience";
import { PostgresActionOutbox } from "@wfx/persistence";

import { POST as actionsPOST } from "../src/app/experience/actions/route";
import { POST as retryPOST } from "../src/app/experience/actions/retry/route";
import { resetApiBootForTests, setApiBootForTests } from "../src/host/testing";

import {
  createApiTestBoot,
  identityHeaders,
  postRequest,
  type ApiTestBoot,
} from "./test-boot";

/** The scripted receipt a test schedules for the next execution. */
type ScriptedOutcome =
  | { kind: "confirmed"; externalId?: string }
  | { kind: "failed"; detail?: string };

/**
 * A scripted source connector — TEST FIXTURE (clearly named,
 * `isTestFixture`, never production). Declares like/save; the outcome is
 * scriptable per test (the failure injection).
 */
class ScriptedRetrySourceConnector extends BaseConnector {
  public readonly isTestFixture = true as const;
  private outcome: ScriptedOutcome = { kind: "confirmed" };
  private readonly requests: readonly UserAction[] = [];

  constructor(id = "retry-script") {
    super({
      id,
      version: "0.1.0",
      displayName: "Scripted Retry Source (TEST FIXTURE — never production)",
      capabilities: ["like", "save"],
      auth: "none",
    });
  }

  /** Schedule the next outcome (the injected failure / the honest recovery). */
  script(outcome: ScriptedOutcome): void {
    this.outcome = outcome;
  }

  /** Every outbound request this fixture received, in order. */
  outbound(): readonly UserAction[] {
    return [...this.requests];
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

  protected override onExecuteAction(_ctx: ConnectorContext, action: UserAction): ActionReceipt {
    (this.requests as UserAction[]).push({ ...action });
    switch (this.outcome.kind) {
      case "confirmed":
        return {
          status: "confirmed",
          ...(this.outcome.externalId !== undefined ? { externalId: this.outcome.externalId } : {}),
          occurredAt: "2026-09-18T00:00:00.000Z",
        };
      case "failed":
        return {
          status: "failed",
          ...(this.outcome.detail !== undefined ? { detail: this.outcome.detail } : {}),
          occurredAt: "2026-09-18T00:00:00.000Z",
        };
    }
  }
}

let harness: ApiTestBoot;
let source: ScriptedRetrySourceConnector;

beforeAll(async () => {
  source = new ScriptedRetrySourceConnector();
  const boot = await createApiTestBoot({ extraSources: [source as unknown as ConnectorPort] });
  harness = boot;
  await source.initialize();
  setApiBootForTests(harness.boot);
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

/** A fresh outbox handle over the SAME durable store the routes read. */
function durableOutbox(): PostgresActionOutbox {
  return new PostgresActionOutbox({
    db: harness.boot.persistence.db,
    clock: harness.boot.ports.clock,
    ids: harness.boot.ports.ids,
  });
}

/** Record one action through the real route, then force it terminally failed in the durable store. */
async function recordThenForceFailed(externalRef: string): Promise<string> {
  source.script({ kind: "failed", detail: "the source is briefly unavailable" });
  const response = await actionsPOST(
    postRequest(
      "/experience/actions",
      { type: "save", connectorId: "retry-script", externalRef },
      identityHeaders(),
    ),
  );
  expect(response.status).toBe(200); // recorded local-first (the receipt is the honest failed state)
  const outbox = durableOutbox();
  const all = await outbox.all();
  const record = all.find((row) => row.action.externalRef === externalRef);
  expect(record).toBeDefined();
  // Force the terminal failed state through the store's own law (the
  // scripted retry-exhaustion shortcut — the same transition the
  // dispatcher's cap would produce).
  await outbox.beginAttempt(record!.id);
  await outbox.markFailed(record!.id, {
    kind: "exhausted",
    attempts: 5,
    lastCause: "receipt status 'failed': the source is briefly unavailable",
  });
  return record!.id;
}

describe("POST /experience/actions/retry — the R17 idempotent retry", () => {
  it("re-queues a failed record (same idempotency key) and answers the tick's honest outcome — delivered, no double-fire", async () => {
    const recordId = await recordThenForceFailed("ext:r17-delivered");

    // The operator reauthorizes/fixes the source; the retry then delivers.
    source.script({ kind: "confirmed", externalId: "src-r17-1" });
    const before = durableOutbox();
    const beforeRecord = await before.get(recordId);
    const response = await retryPOST(
      postRequest("/experience/actions/retry", { recordId }, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      record: { recordId: string; status: string; idempotencyKey: string; externalId?: string };
      tick: { dueCount: number; outcomes: number };
    };
    expect(body.ok).toBe(true);
    expect(body.record.recordId).toBe(recordId);
    expect(body.record.status).toBe("delivered"); // the tick's honest outcome
    expect(body.record.idempotencyKey).toBe(beforeRecord!.idempotencyKey); // SAME key — no double-fire
    expect(body.record.externalId).toBe("src-r17-1");
    expect(body.tick.outcomes).toBeGreaterThanOrEqual(1);

    // The outbound egress observed exactly the scripted attempts for this
    // record: the original failed one + the single retried one.
    const saves = source.outbound().filter((action) => action.externalRef === "ext:r17-delivered");
    expect(saves.length).toBe(2);
  });

  it("a NON-failed record answers the typed 409 (the closed state machine's law, surfaced)", async () => {
    // Record one action whose sync attempt fails RETRYABLY: the route's
    // bounded tick leaves it `pending` (a backoff scheduled) — not failed.
    source.script({ kind: "failed", detail: "the source is briefly unavailable" });
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "save", connectorId: "retry-script", externalRef: "ext:r17-pending" },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(200);
    const outbox = durableOutbox();
    const record = (await outbox.all()).find((row) => row.action.externalRef === "ext:r17-pending");

    const retry = await retryPOST(
      postRequest("/experience/actions/retry", { recordId: record!.id }, identityHeaders()),
    );
    expect(retry.status).toBe(409);
    const body = (await retry.json()) as { error: string; detail: string };
    expect(body.error).toBe("not-retryable");
    expect(body.detail).toContain("'pending'");
  });

  it("an unknown record answers the typed 404; another identity's record answers the typed 403", async () => {
    const unknown = await retryPOST(
      postRequest("/experience/actions/retry", { recordId: "wfxout_nope" }, identityHeaders()),
    );
    expect(unknown.status).toBe(404);

    const recordId = await recordThenForceFailed("ext:r17-foreign");
    const foreign = await retryPOST(
      postRequest(
        "/experience/actions/retry",
        { recordId },
        identityHeaders({ "x-wfx-user-id": "wfx-api-other-user" }),
      ),
    );
    expect(foreign.status).toBe(403);
    const body = (await foreign.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("a malformed body answers the typed 400", async () => {
    const bad = await retryPOST(
      postRequest("/experience/actions/retry", { nope: true }, identityHeaders()),
    );
    expect(bad.status).toBe(400);
  });
});
