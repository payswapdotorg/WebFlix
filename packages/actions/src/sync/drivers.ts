/**
 * @wfx/actions — sync drivers, the execution seam (WFX-022, Lane B).
 *
 * The dispatcher (dispatch.ts) NEVER performs I/O and NEVER calls a real
 * connector directly. Every external effect flows through an injected
 * `SyncDriver` — the seam where a real networked connector adapter plugs
 * in. Two drivers ship in this module:
 *
 * - `createConnectorDriver(executor)` — the PRODUCTION seam adapter: it
 *   delegates to a connector's typed `executeActionResult` surface (the
 *   WFX-003 SDK convention) and adds no I/O of its own. Whether the wrapped
 *   connector performs real network calls is a property of THAT connector;
 *   this package stays pure.
 * - `createFixtureDriver(script)` — a TEST FIXTURE returning deterministic
 *   scripted outcomes per idempotency key. NO real network, no timers, no
 *   randomness; the only clock is the injected one (receipt timestamps).
 *
 * Both speak the SDK's result convention verbatim: a driver returns
 * `ConnectorResult<ActionReceipt>` — `{ ok: true, value: receipt }` or
 * `{ ok: false, error: ConnectorError }` with the closed error vocabulary
 * from @wfx/connectors — so a driver is a drop-in wrapper around
 * `executeActionResult` and the dispatcher can classify outcomes by error
 * kind without any driver-specific vocabulary.
 *
 * Honesty laws (fixture):
 * - An UNSCRIPTED idempotency key is a typed non-retryable error naming the
 *   key — never a fabricated success.
 * - A scripted SEQUENCE that runs out of entries is a typed non-retryable
 *   "script exhausted" error — never a repeated or invented outcome.
 * - The driver records every `execute` call (`calls`) so tests can prove
 *   idempotency: one enqueue identity, one delivery.
 */

import type {
  ActionReceipt,
  ConnectorContext,
  ConnectorDescriptor,
  UserAction,
} from "@wfx/domain";
import type { BaseConnector, ConnectorResult } from "@wfx/connectors";
import {
  errResult,
  invalidInput,
  okResult,
  transport,
  unauthorized,
  unsupported,
} from "@wfx/connectors";

import type { Clock } from "./outbox";

// ---------------------------------------------------------------------------
// The driver seam
// ---------------------------------------------------------------------------

/** One dispatch request handed to a driver. */
export interface SyncActionRequest {
  /** The outbox record's idempotency key — the driver's dedupe identity. */
  readonly idempotencyKey: string;
  /** The outbox record id (diagnostics). */
  readonly recordId: string;
  readonly userId: string;
  /** 1-based number of the attempt about to run. */
  readonly attempt: number;
  /** The frozen `ConnectorContext` rebuilt from the record. */
  readonly ctx: ConnectorContext;
  /** The frozen `UserAction` to execute. */
  readonly action: UserAction;
  /**
   * R15: the record's profile attribution (the recording session's active
   * profile) — present when the action was recorded by a profile-scoped
   * session. Drivers whose executor exposes the profile-aware surface
   * route through it (R02 semantics: a save lands in THAT profile's
   * library); plain drivers ignore it.
   */
  readonly profileId?: string;
}

/**
 * The seam where a real networked connector adapter plugs in. Returns the
 * SDK result convention verbatim so the dispatcher classifies outcomes from
 * the closed `ConnectorError` vocabulary. A driver that throws is caught by
 * the dispatcher and recorded as a typed retryable failure — a driver bug
 * never crashes the worker loop.
 */
export interface SyncDriver {
  execute(request: SyncActionRequest): Promise<ConnectorResult<ActionReceipt>>;
}

// ---------------------------------------------------------------------------
// createConnectorDriver — the production seam adapter
// ---------------------------------------------------------------------------

/**
 * The typed action-execution surface `createConnectorDriver` adapts.
 * Satisfied by every `BaseConnector` (the compile-time assertion below
 * proves it); a structural seam, so exotic connectors that expose the same
 * typed method also plug in without extending the class.
 *
 * R15: the OPTIONAL profile-aware surface. An executor that also exposes
 * `executeActionResultForProfile` (an app-level adapter over an R02
 * profile-scoped source, e.g. the service fan-out's
 * `executeActionForProfile` presented in the typed convention) has it
 * PREFERRED whenever the dispatch request carries a `profileId` — the
 * recorded action settles against the same profile that recorded it.
 */
export interface TypedActionExecutor {
  descriptor(): ConnectorDescriptor;
  executeActionResult(
    ctx: ConnectorContext,
    action: UserAction,
  ): Promise<ConnectorResult<ActionReceipt>>;
  /** Optional R02 profile-scoped surface — preferred when the request carries a profileId. */
  executeActionResultForProfile?(
    ctx: ConnectorContext,
    profileId: string,
    action: UserAction,
  ): Promise<ConnectorResult<ActionReceipt>>;
}

type AssertSatisfiesTypedActionExecutor<T extends TypedActionExecutor> = T;
type _BaseConnectorIsTypedActionExecutor = AssertSatisfiesTypedActionExecutor<BaseConnector>;

/**
 * The PRODUCTION seam adapter: delegate to a connector's typed
 * `executeActionResult` (the WFX-003 SDK result convention — capability
 * gating, input validation, and typed errors all happen inside the
 * connector). This adapter adds no I/O, no timeouts, and no retries of its
 * own: the outbox owns retry policy. Lifecycle errors thrown by the
 * connector propagate to the dispatcher's typed driver-failure path.
 *
 * R15: when the dispatch request carries a `profileId` AND the executor
 * exposes the profile-aware typed surface, THAT surface is used (R02
 * profile attribution preserved through the sync lane).
 */
export function createConnectorDriver(executor: TypedActionExecutor): SyncDriver {
  return {
    async execute(request: SyncActionRequest): Promise<ConnectorResult<ActionReceipt>> {
      if (
        request.profileId !== undefined &&
        executor.executeActionResultForProfile !== undefined
      ) {
        return executor.executeActionResultForProfile(
          request.ctx,
          request.profileId,
          request.action,
        );
      }
      return executor.executeActionResult(request.ctx, request.action);
    },
  };
}

// ---------------------------------------------------------------------------
// createFixtureDriver — the deterministic test double
// ---------------------------------------------------------------------------

/**
 * One scripted outcome (per attempt):
 * - `ok`                  — a receipt (status/externalId/detail overridable;
 *                          default `confirmed`, deterministic external id).
 * - `unsupported`         — typed `unsupported` error naming the action's own
 *                          capability.
 * - `retryable-error`     — typed `transport` error (the canonical retryable
 *                          kind; "timeout" below is the flavored variant).
 * - `non-retryable-error` — typed `invalid-input` error (the canonical
 *                          non-retryable kind in the closed vocabulary).
 * - `unauthorized`        — typed `unauthorized` error (R17: the
 *                          expired/rejected credential injection — the
 *                          dispatcher settles the named terminal failure).
 * - `timeout`             — typed `transport` error whose detail names the
 *                          timeout.
 */
export type FixtureScriptEntry =
  | {
      outcome: "ok";
      receipt?: {
        status?: ActionReceipt["status"];
        externalId?: string;
        detail?: string;
      };
    }
  | { outcome: "unsupported"; reason?: string }
  | { outcome: "retryable-error"; reason?: string }
  | { outcome: "non-retryable-error"; reason?: string }
  | { outcome: "unauthorized"; reason?: string }
  | { outcome: "timeout"; reason?: string };

/**
 * A key's script: a single entry (the SAME outcome for every attempt), or a
 * `{ sequence }` consumed strictly in attempt order (attempt 1 → first
 * entry, attempt 2 → second, …). When a sequence runs out, the driver
 * answers a typed non-retryable "script exhausted" error — never an
 * invented outcome.
 */
export type FixtureScript = FixtureScriptEntry | { sequence: readonly FixtureScriptEntry[] };

/** One recorded fixture invocation (proof of exact call counts). */
export interface FixtureDriverCall {
  readonly idempotencyKey: string;
  readonly recordId: string;
  readonly attempt: number;
  readonly action: UserAction["type"];
}

/** The fixture driver: a `SyncDriver` plus test observability. */
export interface FixtureDriver extends SyncDriver {
  /** Brand: this object is a TEST FIXTURE, never a production driver. */
  readonly isTestFixture: true;
  /** Every `execute` invocation the fixture received, in order. */
  readonly calls: readonly FixtureDriverCall[];
}

/** ISO timestamp from explicit epoch milliseconds (deterministic). */
function isoOf(now: number): string {
  return new Date(now).toISOString();
}

/** Build the scripted receipt (defaults: confirmed + deterministic external id). */
function fixtureReceipt(
  override: { status?: ActionReceipt["status"]; externalId?: string; detail?: string } | undefined,
  request: SyncActionRequest,
  clock: Clock,
): ActionReceipt {
  const receipt: ActionReceipt = {
    status: override?.status ?? "confirmed",
    occurredAt: isoOf(clock.now()),
  };
  const externalId = override?.externalId ?? `fixture:${request.idempotencyKey.slice(0, 12)}`;
  receipt.externalId = externalId;
  if (override?.detail !== undefined) {
    receipt.detail = override.detail;
  }
  return receipt;
}

/**
 * Create the deterministic scripted driver TEST FIXTURE. NO real network,
 * no timers, no randomness. The clock (receipt `occurredAt` stamps) is
 * injected and defaults to a FIXED epoch-zero clock so even the default is
 * deterministic — never a hidden wall clock.
 */
export function createFixtureDriver(
  script: Record<string, FixtureScript>,
  clock: Clock = { now: () => 0 },
): FixtureDriver {
  if (typeof script !== "object" || script === null || Array.isArray(script)) {
    throw new Error(
      `createFixtureDriver: script must be an object keyed by idempotency key, got ${String(script)}`,
    );
  }
  const calls: FixtureDriverCall[] = [];
  const consumed = new Map<string, number>();
  const fixture: FixtureDriver = {
    isTestFixture: true,
    get calls(): readonly FixtureDriverCall[] {
      return [...calls];
    },
    async execute(request: SyncActionRequest): Promise<ConnectorResult<ActionReceipt>> {
      calls.push({
        idempotencyKey: request.idempotencyKey,
        recordId: request.recordId,
        attempt: request.attempt,
        action: request.action.type,
      });

      const scripted: FixtureScript | undefined = script[request.idempotencyKey];
      if (scripted === undefined) {
        return errResult(
          invalidInput(
            `fixture driver: no scripted outcome for idempotency key '${request.idempotencyKey}'`,
          ),
        );
      }

      let entry: FixtureScriptEntry;
      if ("sequence" in scripted) {
        const index = consumed.get(request.idempotencyKey) ?? 0;
        consumed.set(request.idempotencyKey, index + 1);
        const scriptedAttempt: FixtureScriptEntry | undefined = scripted.sequence[index];
        if (scriptedAttempt === undefined) {
          return errResult(
            invalidInput(
              `fixture driver: script exhausted for idempotency key '${request.idempotencyKey}' after ${index} scripted attempt(s)`,
            ),
          );
        }
        entry = scriptedAttempt;
      } else {
        entry = scripted;
      }

      switch (entry.outcome) {
        case "ok":
          return okResult(fixtureReceipt(entry.receipt, request, clock));
        case "unsupported":
          return errResult(
            unsupported(
              request.action.type,
              entry.reason ?? `fixture: '${request.action.type}' is unsupported here`,
            ),
          );
        case "retryable-error":
          return errResult(
            transport(
              request.action.connectorId,
              entry.reason ?? "fixture: deliberate retryable failure",
            ),
          );
        case "non-retryable-error":
          return errResult(
            invalidInput(entry.reason ?? "fixture: deliberate non-retryable failure"),
          );
        case "unauthorized":
          return errResult(unauthorized(request.action.connectorId));
        case "timeout":
          return errResult(
            transport(
              request.action.connectorId,
              entry.reason ?? "fixture: simulated driver timeout",
            ),
          );
      }
    },
  };
  return fixture;
}
