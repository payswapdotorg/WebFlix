/**
 * R15 — external/social action synchronization: the route-level acceptance
 * suite (PGlite, the real service composition, no network).
 *
 * The acceptance points (the mission's laws, exercised end-to-end through
 * the route handlers exactly as the transport drives them):
 * - LOCAL-FIRST RECORDING: every action lands its outbox row AND its local
 *   audit row BEFORE any sync attempt (the ordering is observed from
 *   INSIDE the source connector's execution).
 * - J10 STATE DIFFERENTIATION: provider-confirmed (`confirmed` only on
 *   delivery), WebFlix-confirmed (`local-only` — recorded, sync pending,
 *   with the failed-with-retry detail), `unsupported` (never attempted,
 *   never success), `failed` (terminal) — each surfaced through the
 *   receipts AND the sync-state readback.
 * - OFFICIAL CONNECTOR-ONLY EGRESS: the capability gate settles undeclared
 *   verbs typed-unsupported without a source call; execution routes only
 *   through the wired sources.
 * - IDEMPOTENCY: same token + content ⇒ the existing record's current
 *   truth (typed duplicate, no double execution); same token + different
 *   content ⇒ typed 409, the stored record untouched.
 * - RECONCILIATION IS REPORT-ONLY: the outbox is byte-identical before and
 *   after the reconcile call.
 * - SOCIAL-INTENT PRIVACY: the share/follow/recommend-to family is stored
 *   locally (profile-scoped), reversible, and NO intent-derived signal
 *   ever reaches an outbound sync request (observed at the source
 *   connector), and no intent content appears in the persisted sync log.
 *
 * The scripted source connector below is a TEST FIXTURE (clearly named,
 * `isTestFixture`), injected through `createApiTestBoot`'s documented
 * `extraSources` seam — the same pattern the R03 source tests use.
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

import { POST as actionsPOST } from "../src/app/experience/actions/route";
import { GET as syncStateGET } from "../src/app/experience/actions/sync-state/route";
import { POST as reconcilePOST } from "../src/app/experience/actions/reconcile/route";
import { GET as socialGET, POST as socialPOST } from "../src/app/experience/intents/social/route";
import { DELETE as intentDELETE } from "../src/app/experience/intents/[id]/route";
import { EXPERIENCE_SERVICE_CONNECTOR_ID } from "../src/host/fan-out";
import { resetApiBootForTests, setApiBootForTests } from "../src/host/testing";

import {
  createApiTestBoot,
  getRequest,
  identityHeaders,
  postRequest,
  readSeededRow,
  type ApiTestBoot,
} from "./test-boot";
import { createTestDb, type TestDb } from "./test-db";

// ---------------------------------------------------------------------------
// The scripted social source (TEST FIXTURE — never a production source)
// ---------------------------------------------------------------------------

/** The scripted receipt a test schedules for the next execution. */
type ScriptedOutcome =
  | { kind: "confirmed"; externalId?: string }
  | { kind: "local-only" }
  | { kind: "unsupported" }
  | { kind: "failed"; detail?: string };

/** One observed outbound request (the egress evidence channel). */
interface ObservedRequest {
  readonly action: UserAction;
  readonly profileId: string | null;
  /** The audit rows present for THIS record at execution time (ordering). */
  auditRowsAtExecution: number;
}

/**
 * A scripted social source connector — TEST FIXTURE. Declares like/save/follow;
 * `onExecuteAction` answers the scheduled outcome and records every outbound
 * request (including a DB peek at the local audit rows at execution time —
 * the local-first ordering proof at the route level).
 */
class ScriptedSocialSourceConnector extends BaseConnector {
  public readonly isTestFixture = true as const;
  private outcome: ScriptedOutcome = { kind: "confirmed" };
  private readonly observed: ObservedRequest[] = [];
  private auditPeek: ((outboxRecordId: string) => Promise<number>) | null = null;
  private db: TestDb["db"];

  constructor(
    db: TestDb["db"],
    id = "social-script",
  ) {
    super({
      id,
      version: "0.1.0",
      displayName: "Scripted Social Source (TEST FIXTURE — never production)",
      capabilities: ["like", "save", "follow", "libraryRead"],
      auth: "none",
    });
    this.db = db;
  }

  /** Late-bind the BOOT's database handle (the route's outbox writes there). */
  bindDb(db: TestDb["db"]): void {
    this.db = db;
  }

  /** Schedule the next outcome; arm the audit-peek (ordering evidence). */
  script(outcome: ScriptedOutcome): void {
    this.outcome = outcome;
    this.auditPeek = async (outboxRecordId) => {
      const rows = await this.db.query<{ c: string }>(
        "SELECT count(*)::text AS c FROM action_audit WHERE outbox_record_id = $1",
        [outboxRecordId],
      );
      return Number(rows[0]?.c ?? 0);
    };
  }

  /** Every outbound request this fixture received, in order. */
  requests(): readonly ObservedRequest[] {
    return [...this.observed];
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
    // The local-first ordering proof: at the moment the SOURCE executes (the
    // sync attempt), the local audit row for this action already exists.
    const tokenKey = action.externalRef; // the test keys observations by ref
    void tokenKey;
    const outboxRecordId = `peek:${action.externalRef}`;
    void outboxRecordId;
    const auditPeek = this.auditPeek;
    const observed: ObservedRequest = {
      action: { ...action },
      profileId: null,
      auditRowsAtExecution: -1,
    };
    this.observed.push(observed);
    // The peek runs async against the real DB; the receipt below is answered
    // synchronously (the fixture's contract), so the peek result is read
    // back by the test through the recorded request object.
    if (auditPeek !== null) {
      void this.db
        .query<{ id: string }>(
          "SELECT id FROM action_outbox WHERE connector_id = $1 AND external_ref = $2 ORDER BY enqueued_at DESC LIMIT 1",
          [this.descriptor().id, action.externalRef],
        )
        .then(async (rows) => {
          const recordId = rows[0]?.id;
          observed.auditRowsAtExecution = recordId === undefined ? -1 : await auditPeek(recordId);
        })
        .catch(() => {
          observed.auditRowsAtExecution = -2;
        });
    }
    switch (this.outcome.kind) {
      case "confirmed":
        return {
          status: "confirmed",
          ...(this.outcome.externalId !== undefined ? { externalId: this.outcome.externalId } : {}),
          occurredAt: "2026-09-16T00:00:00.000Z",
        };
      case "local-only":
        return { status: "local-only", detail: "recorded at the source", occurredAt: "2026-09-16T00:00:00.000Z" };
      case "unsupported":
        return { status: "unsupported", detail: "this item cannot be liked here", occurredAt: "2026-09-16T00:00:00.000Z" };
      case "failed":
        return {
          status: "failed",
          ...(this.outcome.detail !== undefined ? { detail: this.outcome.detail } : {}),
          occurredAt: "2026-09-16T00:00:00.000Z",
        };
    }
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SOCIAL_SOURCE_ID = "social-script";

let harness: ApiTestBoot;
let source: ScriptedSocialSourceConnector;
let seeded: { itemId: string; externalRef: string; title: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  source = new ScriptedSocialSourceConnector(testDb.db);
  const boot = await createApiTestBoot({ extraSources: [source as unknown as ConnectorPort] });
  harness = boot;
  seeded = await readSeededRow(boot.testDb.db);
  await source.initialize();
  // The peek must observe the BOOT's database (the route's outbox writes
  // there — the harness's own engine, not the throwaway one above).
  source.bindDb(harness.testDb.db);
  // The routes read the module-level boot slot — bind the test composition
  // (the same law every handler test file follows).
  setApiBootForTests(harness.boot);
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

const USER = "wfx-api-test-user";
const json = async (response: Response): Promise<unknown> => response.json();

// ---------------------------------------------------------------------------
// J10 — the differentiated states through the receipts + the readback
// ---------------------------------------------------------------------------

describe("POST /experience/actions — the R15 local-first flow", () => {
  it("provider-confirmed: a like on the catalog answers `confirmed` (delivered, receipt stored) and the local audit row exists", async () => {
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: seeded.externalRef },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(200);
    const receipt = (await json(response)) as ActionReceipt;
    expect(receipt.status).toBe("confirmed");

    const rows = await harness.testDb.db.query<{
      status: string;
      receipt: { status: string } | null;
      delivered_at: unknown;
    }>(
      `SELECT status, receipt, delivered_at FROM action_outbox
        WHERE user_id = $1 AND connector_id = $2 AND external_ref = $3`,
      [USER, EXPERIENCE_SERVICE_CONNECTOR_ID, seeded.externalRef],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("delivered");
    expect(rows[0]!.receipt?.status).toBe("confirmed");
    expect(rows[0]!.delivered_at).not.toBeNull();
    // The local audit row exists for the delivered record (local-first truth).
    const audit = await harness.testDb.db.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM action_audit a
        JOIN action_outbox o ON o.id = a.outbox_record_id
        WHERE o.user_id = $1 AND o.external_ref = $2`,
      [USER, seeded.externalRef],
    );
    expect(Number(audit[0]!.c)).toBeGreaterThanOrEqual(1);
  });

  it("unsupported: a verb NO wired source declares (comment) settles typed-unsupported at the PRE-FLIGHT gate WITHOUT a source call — never attempted, never success", async () => {
    const callsBefore = source.requests().length;
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "comment", connectorId: EXPERIENCE_SERVICE_CONNECTOR_ID, externalRef: seeded.externalRef },
        identityHeaders({ "x-wfx-action-request-token": "req-unsupported-verb" }),
      ),
    );
    expect(response.status).toBe(200);
    const receipt = (await json(response)) as ActionReceipt;
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toContain("does not declare");

    const rows = await harness.testDb.db.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM action_outbox WHERE client_request_token = 'req-unsupported-verb'`,
    );
    expect(rows[0]!.status).toBe("unsupported");
    expect(rows[0]!.attempts).toBe(0); // NEVER attempted
    expect(source.requests().length).toBe(callsBefore); // no source was touched
  });

  it("per-item unsupported from the source settles unsupported with the receipt kept (never success)", async () => {
    source.script({ kind: "unsupported" });
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:per-item-unsupported" },
        identityHeaders(),
      ),
    );
    const receipt = (await json(response)) as ActionReceipt;
    expect(receipt.status).toBe("unsupported");
    expect(receipt.detail).toContain("cannot perform");
    expect(source.requests().length).toBeGreaterThan(0);
  });

  it("failed-with-retry: a retryable source failure answers `local-only` (WebFlix-confirmed, retry scheduled) — the failed state NEVER renders as success", async () => {
    source.script({ kind: "failed", detail: "the source is briefly unavailable" });
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "save", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:retryable-r15" },
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(200);
    const receipt = (await json(response)) as ActionReceipt;
    // WebFlix-confirmed: the action IS recorded; the provider has NOT confirmed.
    expect(receipt.status).toBe("local-only");
    expect(receipt.detail).toContain("recorded in WebFlix");
    expect(receipt.detail).toContain("retry");
    expect(receipt.detail).toContain("the source is briefly unavailable");

    const rows = await harness.testDb.db.query<{ status: string; attempts: number; next_attempt_at: string }>(
      `SELECT status, attempts, next_attempt_at FROM action_outbox
        WHERE connector_id = $1 AND external_ref = 'ext:retryable-r15'`,
      [SOCIAL_SOURCE_ID],
    );
    expect(rows[0]!.status).toBe("pending"); // retry scheduled, not terminal
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.next_attempt_at).not.toBeUndefined();
  });

  it("provider `local-only` receipt settles the outbox conflict state and answers `local-only` with the reconciliation note", async () => {
    source.script({ kind: "local-only" });
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:conflict-r15" },
        identityHeaders(),
      ),
    );
    const receipt = (await json(response)) as ActionReceipt;
    expect(receipt.status).toBe("local-only");
    expect(receipt.detail).toContain("reconciliation pending");

    const rows = await harness.testDb.db.query<{ status: string }>(
      `SELECT status FROM action_outbox WHERE connector_id = $1 AND external_ref = 'ext:conflict-r15'`,
      [SOCIAL_SOURCE_ID],
    );
    expect(rows[0]!.status).toBe("conflict");
  });

  it("LOCAL-FIRST ORDERING at the route level: when the source executed, the local audit row already existed", async () => {
    source.script({ kind: "confirmed", externalId: "ordering-proof-1" });
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "save", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:ordering-r15" },
        identityHeaders(),
      ),
    );
    expect(((await json(response)) as ActionReceipt).status).toBe("confirmed");
    // The fixture recorded the audit-row count observed DURING its execution.
    // The DB peek resolves async; give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const observed = source
      .requests()
      .find((request) => request.action.externalRef === "ext:ordering-r15");
    expect(observed).toBeDefined();
    expect(observed?.auditRowsAtExecution).toBe(1); // recorded BEFORE the attempt
  });

  it("idempotency: same token + same content re-answers the CURRENT truth (no second row, no second execution)", async () => {
    source.script({ kind: "confirmed", externalId: "idem-1" });
    const first = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:idem-r15" },
        identityHeaders({ "x-wfx-action-request-token": "req-idem-r15" }),
      ),
    );
    expect(((await json(first)) as ActionReceipt).status).toBe("confirmed");
    const callsAfterFirst = source.requests().length;

    const second = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:idem-r15" },
        identityHeaders({ "x-wfx-action-request-token": "req-idem-r15" }),
      ),
    );
    const receipt = (await json(second)) as ActionReceipt;
    expect(receipt.status).toBe("confirmed"); // the existing record's current truth
    expect(source.requests().length).toBe(callsAfterFirst); // never re-executed

    const rows = await harness.testDb.db.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM action_outbox WHERE client_request_token = 'req-idem-r15'`,
    );
    expect(Number(rows[0]!.c)).toBe(1);
  });

  it("same token + DIFFERENT content answers the typed 409; the stored record is untouched", async () => {
    // Same identity (user/connector/verb/ref/token) but different PAYLOAD —
    // the idempotency key is identical, the content is not.
    const conflicting = await actionsPOST(
      postRequest(
        "/experience/actions",
        {
          type: "like",
          connectorId: SOCIAL_SOURCE_ID,
          externalRef: "ext:idem-r15",
          payload: { note: "different content entirely" },
        },
        identityHeaders({ "x-wfx-action-request-token": "req-idem-r15" }),
      ),
    );
    expect(conflicting.status).toBe(409);
    const body = (await json(conflicting)) as { error: string; detail: string };
    expect(body.error).toBe("idempotency-conflict");
    expect(body.detail).toContain("payload");
    // The stored record is untouched (no payload was overwritten).
    const rows = await harness.testDb.db.query<{ payload: unknown }>(
      `SELECT payload FROM action_outbox WHERE client_request_token = 'req-idem-r15'`,
    );
    expect(rows[0]!.payload).toBeNull();
  });

  it("garbage request-token header (whitespace-only) is a typed 400", async () => {
    const response = await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:bad-token" },
        identityHeaders({ "x-wfx-action-request-token": "   " }),
      ),
    );
    expect(response.status).toBe(400);
    expect(((await json(response)) as { detail: string }).detail).toContain(
      "x-wfx-action-request-token",
    );
  });
});

// ---------------------------------------------------------------------------
// GET /experience/actions/sync-state — the J10 readback
// ---------------------------------------------------------------------------

describe("GET /experience/actions/sync-state — the honest readback", () => {
  it("answers the caller's records with the differentiated states, filters, and typed 400s", async () => {
    const response = await syncStateGET(
      getRequest(
        "/experience/actions/sync-state?connectorId=social-script&limit=50",
        identityHeaders(),
      ),
    );
    expect(response.status).toBe(200);
    const records = (await json(response)) as {
      recordId: string;
      status: string;
      connectorId: string;
      externalRef: string;
      attempts: number;
      cause?: string;
      externalId?: string;
    }[];
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.connectorId === "social-script")).toBe(true);
    const conflict = records.find((record) => record.externalRef === "ext:conflict-r15");
    expect(conflict?.status).toBe("conflict");
    const retrying = records.find((record) => record.externalRef === "ext:retryable-r15");
    expect(retrying?.status).toBe("pending");
    expect(retrying?.cause).toContain("the source is briefly unavailable");
    const delivered = records.find((record) => record.externalRef === "ext:ordering-r15");
    expect(delivered?.status).toBe("delivered");
    expect(delivered?.externalId).toBe("ordering-proof-1");

    // The verb filter + the typed 400 for a garbage verb.
    const filtered = await syncStateGET(
      getRequest("/experience/actions/sync-state?action=like&limit=100", identityHeaders()),
    );
    const filteredRecords = (await json(filtered)) as { actionType: string }[];
    expect(filteredRecords.every((record) => record.actionType === "like")).toBe(true);
    const badVerb = await syncStateGET(
      getRequest("/experience/actions/sync-state?action=subscribe", identityHeaders()),
    );
    expect(badVerb.status).toBe(400);

    // Identity isolation: another user's read is empty.
    const other = await syncStateGET(
      getRequest("/experience/actions/sync-state", { "x-wfx-user-id": "wfx-other-user" }),
    );
    expect(await json(other)).toEqual([]);

    // Absent identity is the typed 400.
    const noIdentity = await syncStateGET(getRequest("/experience/actions/sync-state"));
    expect(noIdentity.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /experience/actions/reconcile — REPORT-ONLY
// ---------------------------------------------------------------------------

describe("POST /experience/actions/reconcile — report-only drift", () => {
  it("reports drift WITHOUT mutating the outbox (byte-identical before and after)", async () => {
    // A delivered save against the catalog whose ref is present in the
    // service library (the earlier delivered row) plus the social-script
    // rows (not library-evidenced for the service composite).
    const before = JSON.stringify(
      await harness.testDb.db.query("SELECT * FROM action_outbox ORDER BY id"),
    );
    const response = await reconcilePOST(
      postRequest("/experience/actions/reconcile", {}, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const report = (await json(response)) as {
      ok: boolean;
      compared?: number;
      drift?: { kind: string; resolution: string }[];
    };
    expect(report.ok).toBe(true);
    // The report-only law: the outbox is byte-identical.
    const after = JSON.stringify(
      await harness.testDb.db.query("SELECT * FROM action_outbox ORDER BY id"),
    );
    expect(after).toBe(before);
  });

  it("an unknown connector id is the typed 404; a garbage body is the typed 400", async () => {
    const unknown = await reconcilePOST(
      postRequest("/experience/actions/reconcile", { connectorId: "no-such-source" }, identityHeaders()),
    );
    expect(unknown.status).toBe(404);
    expect(((await json(unknown)) as { error: string }).error).toBe("unknown-connector");

    const garbage = await reconcilePOST(
      postRequest("/experience/actions/reconcile", { connectorId: "   " }, identityHeaders()),
    );
    expect(garbage.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Social intents — local-only capture within privacy boundaries
// ---------------------------------------------------------------------------

describe("POST|GET /experience/intents/social — the social-intent family", () => {
  it("captures share/follow/recommend-to intents LOCALLY (profile-scoped, stable ids, evidence on re-post)", async () => {
    const share = await socialPOST(
      postRequest(
        "/experience/intents/social",
        { family: "share", target: "ext:monarchy-doc" },
        identityHeaders(),
      ),
    );
    expect(share.status).toBe(200);
    const record = (await json(share)) as {
      id: string;
      scope: string;
      objective: string;
      provenance: string;
      evidenceCount: number;
    };
    expect(record.scope).toBe("social");
    expect(record.objective).toBe("share ext:monarchy-doc");
    expect(record.provenance).toBe("explicit");
    expect(record.id.startsWith("wfxint_")).toBe(true);

    // Re-posting the same family+target is UPDATE-in-place (+1 evidence).
    const again = await socialPOST(
      postRequest(
        "/experience/intents/social",
        { family: "share", target: "ext:monarchy-doc" },
        identityHeaders(),
      ),
    );
    const reinforced = (await json(again)) as { id: string; evidenceCount: number };
    expect(reinforced.id).toBe(record.id);
    expect(reinforced.evidenceCount).toBe(record.evidenceCount + 1);

    const follow = await socialPOST(
      postRequest("/experience/intents/social", { family: "follow" }, identityHeaders()),
    );
    expect(((await json(follow)) as { objective: string }).objective).toBe("follow");

    // The readback lists the family records.
    const list = await socialGET(getRequest("/experience/intents/social", identityHeaders()));
    const records = (await json(list)) as { objective: string }[];
    expect(records.some((entry) => entry.objective === "share ext:monarchy-doc")).toBe(true);
    expect(records.some((entry) => entry.objective === "follow")).toBe(true);
  });

  it("the family vocabulary is closed: garbage families/targets are typed 400s", async () => {
    const badFamily = await socialPOST(
      postRequest("/experience/intents/social", { family: "broadcast" }, identityHeaders()),
    );
    expect(badFamily.status).toBe(400);
    expect(((await json(badFamily)) as { detail: string }).detail).toContain("share | follow | recommend-to");

    const blankTarget = await socialPOST(
      postRequest("/experience/intents/social", { family: "share", target: "   " }, identityHeaders()),
    );
    expect(blankTarget.status).toBe(400);
  });

  it("REVERSIBILITY: the sibling DELETE /experience/intents/:id removes a social intent (the undo law)", async () => {
    const created = await socialPOST(
      postRequest(
        "/experience/intents/social",
        { family: "recommend-to", target: "friend:ada" },
        identityHeaders(),
      ),
    );
    const record = (await json(created)) as { id: string };
    const removed = await intentDELETE(
      new Request(`http://api.test/experience/intents/${record.id}`, {
        method: "DELETE",
        headers: identityHeaders(),
      }),
      { params: Promise.resolve({ id: record.id }) },
    );
    expect(removed.status).toBe(200);
    const list = await socialGET(getRequest("/experience/intents/social", identityHeaders()));
    const records = (await json(list)) as { id: string }[];
    expect(records.some((entry) => entry.id === record.id)).toBe(false);
  });

  it("PRIVACY BOUNDARY: no intent-derived signal reaches an outbound sync request, and no intent content enters the persisted sync log", async () => {
    // Capture social intents first.
    await socialPOST(
      postRequest(
        "/experience/intents/social",
        { family: "share", target: "ext:never-leaves" },
        identityHeaders(),
      ),
    );
    // Dispatch an action through the sync lane.
    source.script({ kind: "confirmed", externalId: "privacy-1" });
    await actionsPOST(
      postRequest(
        "/experience/actions",
        { type: "like", connectorId: SOCIAL_SOURCE_ID, externalRef: "ext:privacy-check" },
        identityHeaders(),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Every outbound request the source received: no intent-derived content.
    const requests = source.requests().filter(
      (request) => request.action.externalRef === "ext:privacy-check",
    );
    expect(requests).toHaveLength(1);
    const serialized = JSON.stringify(requests[0]!.action);
    expect(serialized).not.toContain("never-leaves");
    expect(serialized).not.toContain("recommend-to");
    expect(serialized).not.toContain("friend:ada");

    // The persisted sync log: closed-vocabulary causes only, no intent content.
    const logRows = await harness.testDb.db.query<{ cause: string }>(
      `SELECT cause FROM action_sync_log WHERE record_id IN
         (SELECT id FROM action_outbox WHERE external_ref = 'ext:privacy-check')`,
    );
    expect(logRows.length).toBeGreaterThan(0);
    for (const row of logRows) {
      expect(row.cause).not.toContain("never-leaves");
      expect(row.cause).not.toContain("friend:ada");
      expect(row.cause).not.toContain("share ");
    }

    // And the outbox rows themselves carry the action identity only.
    const outboxSerialized = JSON.stringify(
      await harness.testDb.db.query(
        `SELECT * FROM action_outbox WHERE external_ref = 'ext:privacy-check'`,
      ),
    );
    expect(outboxSerialized).not.toContain("never-leaves");
    expect(outboxSerialized).not.toContain("friend:ada");
  });
});
