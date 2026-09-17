/**
 * @wfx/app-api — the HTTP boundary helpers (WFX-055A).
 *
 * One place for the cross-cutting transport laws every route handler
 * shares:
 *
 * - TYPED non-2xx answers: every error body is JSON of the shape
 *   `{ error: <machine-readable kind>, detail: <human-readable, actionable> }`.
 *   The frozen client degrades on any non-2xx or non-JSON, so these bodies
 *   are primarily for OPERATORS (curl, logs, WFX-055B's verification
 *   procedure) — but they stay JSON so nothing downstream chokes.
 * - The BOOT-FAILURE classification: a misconfigured boot
 *   (`ApiConfigError` — missing/malformed env, the fixture crime) or a
 *   broken deployment (052 `config-error` / `migration-error` family) is a
 *   LOUD 500 on every route (the 050/052 loudness law — never a fixture
 *   fallback, never a silent empty). The 052 DEGRADATION family
 *   (`data-source-unavailable`, `connection-timeout`,
 *   `write-quota-exceeded`, classified-`unknown` — e.g. the Neon 5-minute
 *   idle sleep) maps per the WFX-003 law instead: reads ⇒ honest typed
 *   empty 200s, action receipts ⇒ `failed`, the event sink ⇒ 502 (a lost
 *   watch-state event is never a silent success).
 * - JSON body reading with typed garbage detection (the 400 channel).
 *
 * Determinism: no clock, no randomness, no environment reads here. The
 * one wall-clock touch — stamping boot-failure receipts — uses the
 * persistence composition root's `SystemClock`, because when boot itself
 * failed no injected clock exists yet (documented inline).
 */

import { describeThrown } from "@wfx/experience";
import { PersistenceError, SystemClock } from "@wfx/persistence";

import { ApiConfigError } from "./config";

/**
 * The 052 degradation family — the failures the WFX-003 law maps to honest
 * degraded answers instead of loud 5xx (the DB is down or throttling, not
 * misdeployed). Everything else (`config-error`, `migration-error`,
 * `invalid-input`, `constraint-violation`, `credential-decrypt-failed`) is
 * a deploy/config/programmer crime and stays LOUD.
 */
const DEGRADATION_KINDS: ReadonlySet<string> = new Set([
  "data-source-unavailable",
  "connection-timeout",
  "write-quota-exceeded",
  "unknown",
]);

/**
 * The clock used ONLY to stamp the failed receipts a degraded boot
 * produces. When boot succeeded, routes stamp receipts with the injected
 * `boot.ports.clock`; when boot itself failed there is no injected clock
 * yet, and this composition-root clock (the same `SystemClock` the 052
 * boot would have injected) is the honest fallback — the receipt contract
 * requires an `occurredAt`.
 */
const bootFailureClock = new SystemClock();

/** Typed 400 — garbage identity/params/body. */
export function badRequest(detail: string): Response {
  return Response.json({ error: "invalid-request", detail }, { status: 400 });
}

/** Typed 401 — the relay's bearer law. */
export function unauthorized(detail: string): Response {
  return Response.json({ error: "unauthorized", detail }, { status: 401 });
}

/** Typed 500 — a loud boot/config/deploy failure (never a silent empty). */
export function bootFailure(thrown: unknown): Response {
  return Response.json(
    { error: "boot-failed", detail: describeThrown(thrown) },
    { status: 500 },
  );
}

/** Typed 500 — a loud non-boot failure the operator must see. */
export function internalFailure(operation: string, thrown: unknown): Response {
  return Response.json(
    { error: "internal-error", detail: `${operation}: ${describeThrown(thrown)}` },
    { status: 500 },
  );
}

/** Typed 502 — the event sink (or relay dependency) could not be reached. */
export function upstreamFailure(kind: string, detail: string): Response {
  return Response.json({ error: kind, detail }, { status: 502 });
}

/**
 * R03: map a source-management failure to its typed HTTP answer. The status
 * code law (documented for the adapters):
 * - 404 `unknown-connector` / `no-account` — the named source (or the
 *   account to reauthorize) does not exist here;
 * - 410 `expired-pending` — the handshake's TTL elapsed (dead is dead);
 * - 409 `flow-missing` / `exchange-rejected` — the deployment cannot run
 *   this flow / the provider definitively refused the code;
 * - 403 `provider-denied` — the user denied consent at the provider;
 * - 400 `credential-required` / `wrong-flow` — the body conflicts with the
 *   flow kind;
 * - 502 `exchange-transport` / `degraded` — retryable upstream failures.
 */
export function sourceFailureResponse(
  failure: import("./source-management").SourceManagementFailure,
): Response {
  switch (failure.kind) {
    case "unknown-connector":
      return Response.json(
        {
          error: "unknown-connector",
          detail: `connector '${failure.connectorId}' is not wired to this service`,
        },
        { status: 404 },
      );
    case "no-account":
      return Response.json(
        {
          error: "no-account",
          detail: `no connected account for '${failure.connectorId}' — connect first (reauthorize is for existing connections)`,
        },
        { status: 404 },
      );
    case "expired-pending":
      return Response.json(
        {
          error: "expired-pending",
          detail: `the authorization handshake expired at ${failure.expiredAt} — start again`,
        },
        { status: 410 },
      );
    case "flow-missing":
      return Response.json(
        {
          error: "flow-missing",
          detail:
            `connector '${failure.connectorId}' declares auth '${failure.authMode}' but this deployment has no ` +
            "provisioned flow wiring for it (operator action required) — no URL is ever invented",
        },
        { status: 409 },
      );
    case "exchange-rejected":
      return Response.json(
        { error: "exchange-rejected", detail: failure.detail },
        { status: 409 },
      );
    case "provider-denied":
      return Response.json({ error: "provider-denied", detail: failure.detail }, { status: 403 });
    case "credential-required":
    case "wrong-flow":
      return Response.json({ error: "invalid-request", detail: failure.detail }, { status: 400 });
    case "unknown-pending":
      return Response.json(
        {
          error: "unknown-pending",
          detail: `no live authorization handshake for state '${failure.state}' — it was never started, completed, or was superseded`,
        },
        { status: 404 },
      );
    case "exchange-transport":
    case "degraded":
      return Response.json({ error: "sources-unavailable", detail: failure.detail }, { status: 502 });
  }
}

/**
 * Is this thrown failure a LOUD one (config crime / bad deploy / bug —
 * 500 territory), as opposed to the 052 degradation family the WFX-003
 * law maps to honest degraded answers?
 */
export function isLoudFailure(thrown: unknown): boolean {
  if (thrown instanceof ApiConfigError) return true;
  if (thrown instanceof PersistenceError) {
    return !DEGRADATION_KINDS.has(thrown.kind);
  }
  return true; // unknown throws are bugs — loud, never silently degraded
}

/** Log a degradation to the server log (the diagnostic channel — never silent). */
export function logDegradation(operation: string, thrown: unknown): void {
  console.error(`[webflix-api] degraded (${operation}): ${describeThrown(thrown)}`);
}

/** Log a boundary drop (an answer element that failed the frozen guards). */
export function logBoundaryDrop(operation: string, detail: string): void {
  console.error(`[webflix-api] dropped at transport boundary (${operation}): ${detail}`);
}

/**
 * Stamp the `occurredAt` of a degraded (failed) receipt when no booted
 * clock is available — see {@link bootFailureClock}.
 */
export function degradedReceiptOccurredAt(): string {
  return new Date(bootFailureClock.now()).toISOString();
}

/** The typed outcome of reading a JSON request body. */
export type BodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly detail: string };

/** Read and JSON-parse a request body; garbage ⇒ a typed `detail`. */
export async function readJsonBody(request: Request): Promise<BodyResult> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, detail: "request body could not be read" };
  }
  if (text.trim().length === 0) {
    return { ok: false, detail: "request body is empty — expected a JSON object" };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (thrown) {
    return { ok: false, detail: `request body is not valid JSON (${describeThrown(thrown)})` };
  }
}
