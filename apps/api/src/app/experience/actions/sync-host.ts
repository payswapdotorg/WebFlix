/**
 * @wfx/app-api — the R15 action-sync lane composition (external/social
 * action synchronization).
 *
 * THE LAWS THIS MODULE KEEPS (docs/architecture/
 * webflix-remediation-architecture.md + the remediation plan's R15 item):
 *
 * - LOCAL-FIRST ACTION TRUTH: every user action is RECORDED FIRST — one
 *   transactional `PostgresActionOutbox.enqueue` that lands the outbox row
 *   AND its local audit row together (the transactional-outbox jobs law).
 *   A recorded action is WebFlix-confirmed; a delivered action is
 *   provider-confirmed — different states, never conflated (J10).
 * - OFFICIAL CONNECTOR-ONLY EGRESS: outbound sync happens ONLY through the
 *   `SyncDispatcher` whose driver seam is `createConnectorDriver` over the
 *   service's wired sources (the fan-out's own routing: named source ids go
 *   to that source, the service id probes in wiring order — the frozen
 *   convention). The capability gate reads the registry's DECLARED
 *   capabilities (per-source truth from `sourceRows()` + the service
 *   union); an undeclared capability settles typed `unsupported` WITHOUT a
 *   driver call — never attempted, never rendered as success.
 * - HONEST FAILURE STATES: retryable failures schedule deterministic
 *   backoff (the dispatcher's injected-clock policy); terminal failures
 *   store the typed cause; every transition appends to the PERSISTED
 *   `PostgresSyncLog` audit trail.
 * - PRIVACY: no credentials or secrets ever enter the outbox rows, the
 *   audit rows, or the sync log (the rows carry action identity + user
 *   content + closed-vocabulary causes only; cause strings come from the
 *   describe* grammars).
 *
 * Statelessness: every piece composes over `boot.persistence.db` + the
 * boot's shared clock/id seams — all state lives in SQL, so the lane is
 * constructed per request (no hidden singletons; the DB is the truth).
 * The one module-level state is the opportunistic-sync throttle (the
 * relay.ts pattern: bounded, best-effort, never blocks a response).
 */

import {
  SyncDispatcher,
  createConnectorDriver,
  describeSyncCause,
  type OutboxRecord,
  type OutboxStatus,
  type SyncDriver,
  type TypedActionExecutor,
} from "@wfx/actions";
import { ConnectorRegistry } from "@wfx/connectors";
import type { ActionReceipt, Capability, UserAction } from "@wfx/domain";
import { isUsableReceipt } from "@wfx/experience";
import {
  PostgresActionOutbox,
  PostgresSyncLog,
  type DbClient,
} from "@wfx/persistence";
import type { Clock, IdGen } from "@wfx/experience";

import type { ApiBoot } from "@api/host/boot";
import type { FanOutConnector, FanOutSourceRow } from "@api/host/fan-out";


// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

/** The composed R15 sync lane over one service boot. */
export interface ActionSyncLane {
  /** The durable outbox (the transactional record store). */
  readonly outbox: PostgresActionOutbox;
  /** The durable worker (capability gate + driver seam + retries + audit). */
  readonly dispatcher: SyncDispatcher;
  /** The dispatcher's retry policy (receipt wording for pending retries). */
  readonly retryPolicy: { readonly maxAttempts: number };
  /** The capability-truth registry (per-source declared capabilities + the union). */
  readonly registry: ConnectorRegistry;
  /** The drivers seam (createConnectorDriver over the wired sources ONLY). */
  readonly resolveDriver: (connectorId: string) => SyncDriver | undefined;
  /** The db + seams (for the routes' direct audit/sync-state reads). */
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

/**
 * Build the R15 sync lane for one boot: the durable outbox, the registry
 * (per-source declared capabilities + the service union — the gate truth),
 * and the dispatcher wired through `createConnectorDriver` ONLY.
 */
export function getActionSync(boot: ApiBoot): ActionSyncLane {
  const db = boot.persistence.db;
  const clock = boot.ports.clock;
  const ids = boot.ports.ids;
  const outbox = new PostgresActionOutbox({ db, clock, ids });
  const log = new PostgresSyncLog({ db });

  // The capability truth: each wired source's DECLARED capabilities (the
  // fan-out's sourceRows) plus the service binding itself (the union
  // descriptor). Execution always routes through the FAN-OUT (official
  // connectors only — named ids to that source, the service id in probe
  // order), presented to the drivers seam in the typed executor convention.
  const registry = new ConnectorRegistry();
  const fanout = boot.connector;
  const executors = new Map<string, TypedActionExecutor>();
  for (const row of fanout.sourceRows()) {
    const executor = executorOverFanout(fanout, row);
    executors.set(row.id, executor);
    registry.register(sourceConnectorView(fanout, row));
  }
  registry.register(fanout); // the service binding (its own union descriptor)
  executors.set(fanout.descriptor().id, executorOverFanout(fanout, null));

  const resolveDriver = (connectorId: string): SyncDriver | undefined => {
    const executor = executors.get(connectorId);
    return executor === undefined ? undefined : createConnectorDriver(executor);
  };
  const dispatcher = new SyncDispatcher({ outbox, registry, clock, resolveDriver, log });

  return {
    outbox,
    dispatcher,
    retryPolicy: dispatcher.retryPolicy,
    registry,
    resolveDriver,
    db,
    clock,
    ids,
  };
}

/**
 * The typed action-executor view over the fan-out for one registration id:
 * the plain frozen receipts the fan-out answers are surfaced in the SDK's
 * ok-result convention (the dispatcher's receipt mapping settles them);
 * thrown errors stay thrown (the dispatcher's typed driver-failure path).
 * The optional profile-aware surface preserves R02 attribution: a
 * profile-recorded action settles against THAT profile.
 */
function executorOverFanout(
  fanout: FanOutConnector,
  row: FanOutSourceRow | null,
): TypedActionExecutor {
  return {
    descriptor: () =>
      row === null
        ? fanout.descriptor()
        : {
            id: row.id,
            version: row.version,
            displayName: row.displayName,
            capabilities: declaredCapabilities(row),
            auth: row.auth,
          },
    executeActionResult: async (ctx, action) => {
      const receipt = await fanout.executeAction(ctx, action);
      if (!isUsableReceipt(receipt)) {
        // The fan-out's own contract guarantees usable receipts; a violation
        // is surfaced honestly (the dispatcher also validates).
        return {
          ok: false,
          error: {
            kind: "invalid-input" as const,
            detail: `the service connector answered a malformed ActionReceipt for '${action.connectorId}'`,
          },
        };
      }
      return { ok: true, value: receipt };
    },
    executeActionResultForProfile: async (ctx, profileId, action) => {
      const receipt = await fanout.executeActionForProfile(ctx, profileId, action);
      if (!isUsableReceipt(receipt)) {
        return {
          ok: false,
          error: {
            kind: "invalid-input" as const,
            detail: `the service connector answered a malformed ActionReceipt for '${action.connectorId}'`,
          },
        };
      }
      return { ok: true, value: receipt };
    },
  };
}

/** The declared-capability list of one source row (the truth-record → list). */
function declaredCapabilities(row: FanOutSourceRow): Capability[] {
  const declared: Capability[] = [];
  for (const [capability, isDeclared] of Object.entries(row.capabilities)) {
    if (isDeclared) declared.push(capability as Capability);
  }
  return declared;
}

/**
 * A full `SourceConnector` VIEW of the fan-out under one source row's
 * descriptor — what the registry stores so `registry.get(id)` answers the
 * per-source capability truth for the dispatcher's pre-flight gate. Every
 * operation delegates to the fan-out (official connectors only).
 */
function sourceConnectorView(fanout: FanOutConnector, row: FanOutSourceRow) {
  const executor = executorOverFanout(fanout, row);
  return {
    descriptor: executor.descriptor,
    search: fanout.search.bind(fanout),
    metadata: fanout.metadata.bind(fanout),
    resolve: fanout.resolve.bind(fanout),
    executeAction: fanout.executeAction.bind(fanout),
    readLibrary: fanout.readLibrary.bind(fanout),
    writeLibrary: fanout.writeLibrary.bind(fanout),
  };
}

// ---------------------------------------------------------------------------
// The honest receipt mapping (J10: recorded ≠ provider-confirmed)
// ---------------------------------------------------------------------------

/**
 * Map one outbox record's current state to the frozen `ActionReceipt`
 * vocabulary — the J10 differentiation law:
 * - `delivered`   ⇒ `confirmed` (provider-confirmed — the only success).
 * - `unsupported` ⇒ `unsupported` (NEVER success).
 * - `failed`      ⇒ `failed` (NEVER success).
 * - `conflict`    ⇒ `local-only` (recorded here AND at the source without
 *   external confirmation — reconciliation is caller policy).
 * - `pending` / `in-flight` ⇒ `local-only` (WebFlix-confirmed: recorded,
 *   external sync pending — with the retry detail when one is scheduled).
 */
export function receiptForRecord(
  record: OutboxRecord,
  nowIso: string,
  maxAttempts: number,
): ActionReceipt {
  switch (record.status) {
    case "delivered":
      return {
        status: "confirmed",
        ...(record.receipt?.externalId !== undefined ? { externalId: record.receipt.externalId } : {}),
        occurredAt: record.deliveredAt ?? nowIso,
      };
    case "unsupported": {
      const cause = record.lastCause === undefined ? undefined : describeSyncCause(record.lastCause);
      return {
        status: "unsupported",
        detail:
          cause === undefined
            ? "this source cannot perform that action — recorded in WebFlix, never synchronized"
            : `this source cannot perform that action (recorded in WebFlix, not synchronized): ${cause}`,
        occurredAt: nowIso,
      };
    }
    case "failed": {
      const cause = record.lastCause === undefined ? undefined : describeSyncCause(record.lastCause);
      return {
        status: "failed",
        detail: cause === undefined ? "external synchronization failed" : cause,
        occurredAt: nowIso,
      };
    }
    case "conflict": {
      const cause = record.lastCause === undefined ? undefined : describeSyncCause(record.lastCause);
      return {
        status: "local-only",
        detail:
          "recorded in WebFlix and at the source without external confirmation — reconciliation pending" +
          (cause === undefined ? "" : ` (${cause})`),
        occurredAt: nowIso,
      };
    }
    case "in-flight":
      return {
        status: "local-only",
        detail: "recorded in WebFlix — external synchronization in progress",
        occurredAt: nowIso,
      };
    case "pending":
      return {
        status: "local-only",
        detail:
          record.lastCause === undefined
            ? "recorded in WebFlix — external sync pending"
            : `recorded in WebFlix — external sync pending (retry ${Math.min(record.attempts, maxAttempts)}/${maxAttempts} scheduled; last failure: ${describeSyncCause(record.lastCause)})`,
        occurredAt: nowIso,
      };
  }
}

/** The J10 sync-state view of one record (the readback surface's row). */
export interface SyncStateView {
  readonly recordId: string;
  readonly idempotencyKey: string;
  readonly connectorId: string;
  readonly actionType: UserAction["type"];
  readonly externalRef: string;
  readonly clientRequestToken: string;
  readonly profileId?: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly recordedAt: string;
  readonly nextAttemptAt: string;
  readonly deliveredAt?: string;
  readonly externalId?: string;
  /** The described last cause (closed vocabulary — never credentials). */
  readonly cause?: string;
}

/** Render one record as the sync-state view. */
export function syncStateViewOf(record: OutboxRecord): SyncStateView {
  return {
    recordId: record.id,
    idempotencyKey: record.idempotencyKey,
    connectorId: record.connectorId,
    actionType: record.action.type,
    externalRef: record.action.externalRef,
    clientRequestToken: record.clientRequestToken,
    ...(record.profileId !== undefined ? { profileId: record.profileId } : {}),
    status: record.status,
    attempts: record.attempts,
    recordedAt: record.enqueuedAt,
    nextAttemptAt: record.nextAttemptAt,
    ...(record.deliveredAt !== undefined ? { deliveredAt: record.deliveredAt } : {}),
    ...(record.receipt?.externalId !== undefined ? { externalId: record.receipt.externalId } : {}),
    ...(record.lastCause !== undefined ? { cause: describeSyncCause(record.lastCause) } : {}),
  };
}

// ---------------------------------------------------------------------------
// The opportunistic sync lane (the relay.ts pattern)
// ---------------------------------------------------------------------------

/** At most one opportunistic sync drain per interval per instance. */
const OPPORTUNISTIC_SYNC_MIN_INTERVAL_MS = 60_000;
/** Bound each opportunistic drain (the durable store's dueLimit). */
const OPPORTUNISTIC_SYNC_LIMIT = 20;

let lastOpportunisticSyncMs = 0;
let opportunisticSyncInFlight = false;

/**
 * Nudge a bounded best-effort sync drain (called by the read-side routes
 * after answering). Fire-and-forget: NEVER delays the response, NEVER
 * throws into the caller, throttled per instance. Pending records with
 * scheduled retries get their next attempt through this lane (and through
 * the inline tick every POST /experience/actions performs).
 */
export function scheduleOpportunisticSync(boot: ApiBoot): void {
  const clock = boot.ports.clock;
  const now = clock.now();
  if (now - lastOpportunisticSyncMs < OPPORTUNISTIC_SYNC_MIN_INTERVAL_MS) return;
  if (opportunisticSyncInFlight) return;
  lastOpportunisticSyncMs = now;
  opportunisticSyncInFlight = true;

  const lane = getActionSync(boot);
  const outbox = new PostgresActionOutbox({
    db: lane.db,
    clock: lane.clock,
    ids: lane.ids,
    dueLimit: OPPORTUNISTIC_SYNC_LIMIT,
  });
  void new SyncDispatcher({
    outbox,
    registry: lane.registry,
    clock: lane.clock,
    resolveDriver: lane.resolveDriver,
    log: new PostgresSyncLog({ db: lane.db }),
  })
    .tick(now)
    .then((report) => {
      if (report.outcomes.length > 0) {
        console.error(
          `[webflix-api] opportunistic action sync: due=${report.dueCount} outcomes=${report.outcomes.length}`,
        );
      }
    })
    .catch((thrown: unknown) => {
      // Best-effort by contract — the inline ticks and later requests remain the floor.
      console.error(`[webflix-api] opportunistic action sync failed: ${String(thrown)}`);
    })
    .finally(() => {
      opportunisticSyncInFlight = false;
    });
}
