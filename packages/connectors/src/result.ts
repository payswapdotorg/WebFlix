/**
 * @wfx/connectors — explicit result types for the Connector SDK (WFX-003).
 *
 * Every connector operation returns a `ConnectorResult` instead of throwing.
 * Operational failures (unsupported capability, unauthorized, transport,
 * invalid input) are typed values so callers — including the UI layer — can
 * distinguish "this source cannot do that" from "this source returned
 * nothing". See docs/architecture/product-boundaries.md ("Capability truth").
 *
 * This module is the SDK's error vocabulary. It deliberately mirrors the
 * error kinds required by the WFX-003 task packet; the kinds are closed:
 * lifecycle misuse is a programmer error and throws `LifecycleError`
 * (see lifecycle.ts), never a fake result.
 */

import type { Capability } from "@wfx/domain";

// ---------------------------------------------------------------------------
// Error union
// ---------------------------------------------------------------------------

/** A connector declined an operation it never declared capability for. */
export interface UnsupportedCapabilityError {
  kind: "unsupported";
  capability: Capability;
  detail?: string;
}

/** The connector could not authenticate the user for this operation. */
export interface UnauthorizedError {
  kind: "unauthorized";
  connectorId: string;
}

/** The connector could not complete transport with its source. */
export interface TransportError {
  kind: "transport";
  connectorId: string;
  detail: string;
}

/** The caller supplied arguments the connector cannot accept. */
export interface InvalidInputError {
  kind: "invalid-input";
  detail: string;
}

/**
 * The closed error vocabulary of the Connector SDK.
 *
 * - `unsupported` — the connector does not declare the capability. This is
 *   the honest answer to "can you do this?" and MUST be returned, never
 *   thrown and never papered over with an empty success.
 * - `unauthorized` — the operation needs credentials the connector does not
 *   currently hold.
 * - `transport` — the operation could not be completed against the source.
 * - `invalid-input` — the caller's arguments are malformed.
 */
export type ConnectorError =
  | UnsupportedCapabilityError
  | UnauthorizedError
  | TransportError
  | InvalidInputError;

/**
 * The result envelope for every connector operation.
 * `ok: true` carries the value; `ok: false` carries a typed error.
 */
export type ConnectorResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConnectorError };

// ---------------------------------------------------------------------------
// Error constructors
// ---------------------------------------------------------------------------

/** Construct an `unsupported` error for a capability the connector lacks. */
export function unsupported(
  capability: Capability,
  detail?: string,
): ConnectorError {
  // exactOptionalPropertyTypes: never materialize `detail: undefined`.
  return detail === undefined
    ? { kind: "unsupported", capability }
    : { kind: "unsupported", capability, detail };
}

/** Construct an `unauthorized` error for a connector that lost/never had credentials. */
export function unauthorized(connectorId: string): ConnectorError {
  return { kind: "unauthorized", connectorId };
}

/** Construct a `transport` error with a human-readable detail. */
export function transport(connectorId: string, detail: string): ConnectorError {
  return { kind: "transport", connectorId, detail };
}

/** Construct an `invalid-input` error describing the malformed argument. */
export function invalidInput(detail: string): ConnectorError {
  return { kind: "invalid-input", detail };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Narrow to the `unsupported` error variant. */
export function isUnsupported(
  error: ConnectorError,
): error is UnsupportedCapabilityError {
  return error.kind === "unsupported";
}

/** Narrow to the `unauthorized` error variant. */
export function isUnauthorized(
  error: ConnectorError,
): error is UnauthorizedError {
  return error.kind === "unauthorized";
}

/** Narrow to the `transport` error variant. */
export function isTransport(error: ConnectorError): error is TransportError {
  return error.kind === "transport";
}

/** Narrow to the `invalid-input` error variant. */
export function isInvalidInput(
  error: ConnectorError,
): error is InvalidInputError {
  return error.kind === "invalid-input";
}

/** Runtime-shape validation for values claimed to be a `ConnectorError`. */
export function isConnectorError(x: unknown): x is ConnectorError {
  if (!isRecord(x) || typeof x.kind !== "string") return false;
  switch (x.kind) {
    case "unsupported":
      return typeof x.capability === "string";
    case "unauthorized":
      return typeof x.connectorId === "string";
    case "transport":
      return typeof x.connectorId === "string" && typeof x.detail === "string";
    case "invalid-input":
      return typeof x.detail === "string";
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

/** Wrap a success value in a `ConnectorResult`. */
export function okResult<T>(value: T): ConnectorResult<T> {
  return { ok: true, value };
}

/** Wrap a typed error in a `ConnectorResult`. */
export function errResult<T>(error: ConnectorError): ConnectorResult<T> {
  return { ok: false, error };
}

/** Narrow a `ConnectorResult` to its success branch. */
export function isOk<T>(
  result: ConnectorResult<T>,
): result is { ok: true; value: T } {
  return result.ok;
}

/** Narrow a `ConnectorResult` to its failure branch. */
export function isErr<T>(
  result: ConnectorResult<T>,
): result is { ok: false; error: ConnectorError } {
  return !result.ok;
}

/**
 * Render a one-line, human-readable summary of a typed connector error.
 * Used by the plain (frozen-contract) shim surface to degrade errors into
 * the limited representations the frozen contract allows — the summary
 * always names the kind so a degraded value is never mistaken for success.
 */
export function describeConnectorError(error: ConnectorError): string {
  switch (error.kind) {
    case "unsupported":
      return error.detail === undefined
        ? `unsupported: capability '${error.capability}' is not declared`
        : `unsupported: capability '${error.capability}' is not declared (${error.detail})`;
    case "unauthorized":
      return `unauthorized: connector '${error.connectorId}' has no valid credentials`;
    case "transport":
      return `transport: connector '${error.connectorId}' failed: ${error.detail}`;
    case "invalid-input":
      return `invalid-input: ${error.detail}`;
  }
}
