/**
 * @wfx/client-runtime — the runtime error-state taxonomy (R01).
 *
 * Typed runtime errors with RECOVERY SEMANTICS. The frozen remediation
 * spec's law: "A missing credential or unavailable realization must never
 * look like silent success." This taxonomy is how the runtime keeps that
 * promise — every failure maps to a kind, a retryability answer, and a
 * recovery hint the UI can act on.
 *
 * CHANNEL LAW (how failures travel — documented, consistent):
 *
 * 1. `invalid-input` — INVALID CALLER INPUT (misuse) — THROWN as
 *    `RuntimeError`. Never a generic `Error` (the same discipline as
 *    `ExperienceError` / `IntentError` elsewhere in the codebase).
 * 2. Watch-state DELIVERY failures — THROWN (the EventSink law: a lost
 *    watch-state event is never a silent success; the event stays queued
 *    in the at-least-once outbox).
 * 3. Capability-unsupported operations — typed IN-BAND states
 *    (`ActionState` `unsupported`, `PlaybackPhase` terminal states,
 *    `unsupported-capability` results) — never a throw, never fake success.
 * 4. Read-model degradation — IN-MODEL section statuses (`loading` /
 *    `error` with a `RuntimeErrorKind`) — a network-down search is an error
 *    section, never a fake empty one.
 */

import type { ServerFailure } from "./server-port";

/** The closed runtime error vocabulary. */
export type RuntimeErrorKind =
  /** Caller misuse (malformed command). Thrown; never retried. */
  | "invalid-input"
  /** The transport did not complete. Retryable when connectivity returns. */
  | "network"
  /** Credential missing/expired/rejected. Recovery: re-authenticate (R02/R03). */
  | "unauthorized"
  /** The service or the requested realization is unavailable. */
  | "unavailable"
  /**
   * The PLATFORM truthfully cannot do this (e.g. native playback on Web).
   * NOT retryable on this platform — an honest terminal state.
   */
  | "unsupported-capability"
  /** The operation succeeded at reduced fidelity (explicit, never silent). */
  | "degraded"
  /** A referenced session/item/action is unknown to this runtime. */
  | "not-found";

/** Every value of `RuntimeErrorKind`, in union order. */
export const RUNTIME_ERROR_KINDS: readonly RuntimeErrorKind[] = [
  "invalid-input",
  "network",
  "unauthorized",
  "unavailable",
  "unsupported-capability",
  "degraded",
  "not-found",
];

/** The recovery action a UI should offer for an error kind. */
export type RecoveryAction =
  /** Retry the operation (e.g. when connectivity returns). */
  | "retry"
  /** Re-authenticate / reconnect the source (R02/R03 flows). */
  | "re-authenticate"
  /** Inspect the platform capability truth — this cannot be retried here. */
  | "inspect-capability"
  /** No recovery action exists (caller misuse, unknown references). */
  | "none";

/** The recovery semantics attached to every runtime error. */
export interface RecoveryHint {
  readonly action: RecoveryAction;
  /** Non-empty, deterministic, human-readable guidance. */
  readonly detail: string;
}

/** The typed runtime error (see module doc for the channel law). */
export class RuntimeError extends Error {
  readonly kind: RuntimeErrorKind;
  readonly retryable: boolean;
  readonly recovery: RecoveryHint;

  constructor(kind: RuntimeErrorKind, detail: string, recovery?: RecoveryHint) {
    super(`client-runtime failure (${kind}): ${detail}`);
    this.name = "RuntimeError";
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
    this.recovery = recovery ?? DEFAULT_RECOVERY[kind];
  }
}

/** A `RuntimeError` type guard for untrusted thrown values. */
export function isRuntimeError(value: unknown): value is RuntimeError {
  return (
    value instanceof RuntimeError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "RuntimeError" &&
      typeof (value as { kind?: unknown }).kind === "string" &&
      (RUNTIME_ERROR_KINDS as readonly string[]).includes((value as { kind: string }).kind))
  );
}

// ---------------------------------------------------------------------------
// Retryability + default recovery semantics (the taxonomy's teeth)
// ---------------------------------------------------------------------------

/** Error kinds where retrying the same operation can plausibly succeed. */
const RETRYABLE_KINDS: ReadonlySet<RuntimeErrorKind> = new Set([
  "network",
  "unavailable",
  "degraded", // retry for full fidelity (the degraded result already succeeded)
]);

/** The default recovery hint per kind (deterministic, actionable). */
const DEFAULT_RECOVERY: Readonly<Record<RuntimeErrorKind, RecoveryHint>> = {
  "invalid-input": { action: "none", detail: "fix the command and retry" },
  network: {
    action: "retry",
    detail: "the request did not complete — retry when connectivity returns",
  },
  unauthorized: {
    action: "re-authenticate",
    detail: "the credential is missing, expired, or rejected — sign in again or reconnect the source",
  },
  unavailable: {
    action: "retry",
    detail: "the service or realization is unavailable right now — retry later",
  },
  "unsupported-capability": {
    action: "inspect-capability",
    detail: "this platform truthfully cannot perform this operation — no retry will change that",
  },
  degraded: {
    action: "retry",
    detail: "the operation continued at reduced fidelity — retry for full quality",
  },
  "not-found": { action: "none", detail: "the referenced session, item, or action is unknown" },
};

// ---------------------------------------------------------------------------
// ServerFailure mapping (transport failures -> runtime taxonomy)
// ---------------------------------------------------------------------------

/**
 * Map a `ServerFailure` to its runtime error kind. Pure and total:
 * - `network`    -> `network`
 * - `unauthorized` -> `unauthorized`
 * - `unavailable`|`malformed` -> `unavailable` (a service answering garbage
 *   is unavailable in practice; the failure detail carries the specifics).
 */
export function serverFailureKind(failure: ServerFailure): RuntimeErrorKind {
  switch (failure.kind) {
    case "network":
      return "network";
    case "unauthorized":
      return "unauthorized";
    case "unavailable":
    case "malformed":
      return "unavailable";
  }
}

/** Build the typed `RuntimeError` for a server failure (detail preserved). */
export function serverFailureError(operation: string, failure: ServerFailure): RuntimeError {
  const kind = serverFailureKind(failure);
  const hint: RecoveryHint =
    kind === "unauthorized"
      ? DEFAULT_RECOVERY.unauthorized
      : kind === "network"
        ? {
            action: "retry",
            detail: `${operation} did not complete — retry when connectivity returns`,
          }
        : {
            action: "retry",
            detail: `${operation} is unavailable right now — retry later`,
          };
  return new RuntimeError(kind, `${operation}: ${failure.detail}`, hint);
}
