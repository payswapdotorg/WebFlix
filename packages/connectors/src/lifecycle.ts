/**
 * @wfx/connectors — connector lifecycle state machine (WFX-003).
 *
 * State machine (the only legal transitions):
 *
 * ```text
 *   registered ──initialize()──> initialized ──dispose()──> disposed
 *        │                            │
 *        └──────────── fail() ────────┘            (both go to `failed`, terminal)
 * ```
 *
 * Illegal transitions are REJECTED with a typed `LifecycleError` — never
 * silently ignored. `disposed` and `failed` are terminal states.
 *
 * Error-channel policy for the whole SDK:
 * - Lifecycle misuse (calling an operation on a disposed/failed connector,
 *   double initialize, ...) is a PROGRAMMER error → throws `LifecycleError`.
 * - Operational failures (unsupported capability, unauthorized, transport,
 *   invalid input) are runtime realities → typed `ConnectorResult` errors
 *   (see result.ts). These two channels never mix.
 */

/** Lifecycle states of a connector instance. */
export type LifecycleState = "registered" | "initialized" | "disposed" | "failed";

/** Typed error thrown on illegal lifecycle usage. */
export class LifecycleError extends Error {
  /** The state the connector was in when the illegal action was attempted. */
  public readonly from: LifecycleState;
  /** The action that was rejected ("initialize" | "dispose" | "fail" | "assertOperational" | ...). */
  public readonly attempted: string;

  constructor(message: string, from: LifecycleState, attempted: string) {
    super(message);
    this.name = "LifecycleError";
    this.from = from;
    this.attempted = attempted;
  }
}

/**
 * Guard helper: assert that a connector state is operational
 * ("initialized"). Throws a typed `LifecycleError` in any other state —
 * wrong-state calls must fail loudly, not limp along.
 */
export function assertOperational(state: LifecycleState): void {
  if (state !== "initialized") {
    throw new LifecycleError(
      `connector is '${state}', not 'initialized' — operation requires an operational connector`,
      state,
      "assertOperational",
    );
  }
}

/** Non-throwing companion of `assertOperational`. */
export function isOperational(state: LifecycleState): boolean {
  return state === "initialized";
}

/**
 * The connector lifecycle state machine.
 *
 * Transitions:
 * - `initialize()`: registered → initialized. Illegal from any other state.
 * - `dispose()`:    initialized → disposed. Illegal from any other state
 *                  (a never-initialized connector has nothing to dispose).
 * - `fail(reason)`: registered | initialized → failed (terminal).
 *                  Illegal from terminal states.
 *
 * Every illegal transition throws `LifecycleError` — never a no-op.
 */
export class ConnectorLifecycle {
  private current: LifecycleState = "registered";
  private failureReason_: string | undefined;

  /** Current state. */
  state(): LifecycleState {
    return this.current;
  }

  /** The recorded reason for a `failed` state, if any. */
  failureReason(): string | undefined {
    return this.failureReason_;
  }

  /** Transition registered → initialized. */
  initialize(): void {
    switch (this.current) {
      case "registered":
        this.current = "initialized";
        return;
      case "initialized":
        throw new LifecycleError("connector is already initialized", this.current, "initialize");
      case "disposed":
        throw new LifecycleError("connector is disposed and cannot be initialized", this.current, "initialize");
      case "failed":
        throw new LifecycleError("connector is failed and cannot be initialized", this.current, "initialize");
    }
  }

  /** Transition initialized → disposed. */
  dispose(): void {
    switch (this.current) {
      case "registered":
        throw new LifecycleError(
          "connector is only registered; initialize it before dispose",
          this.current,
          "dispose",
        );
      case "initialized":
        this.current = "disposed";
        return;
      case "disposed":
        throw new LifecycleError("connector is already disposed", this.current, "dispose");
      case "failed":
        throw new LifecycleError("connector is failed; it cannot be disposed cleanly", this.current, "dispose");
    }
  }

  /** Transition registered | initialized → failed (terminal). */
  fail(reason?: string): void {
    switch (this.current) {
      case "registered":
      case "initialized": {
        this.current = "failed";
        this.failureReason_ = reason;
        return;
      }
      case "disposed":
        throw new LifecycleError("connector is already disposed; cannot fail", this.current, "fail");
      case "failed":
        throw new LifecycleError("connector is already failed", this.current, "fail");
    }
  }
}
