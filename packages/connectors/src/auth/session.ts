/**
 * @wfx/connectors — auth session state machine (WFX-012, Lane B).
 *
 * One `AuthSession` tracks the credential lifecycle of ONE connector:
 *
 * ```text
 *   signedOut ──begin──> authorizing ──complete──> signedIn
 *      ▲  ▲                 │     ▲                  │ │
 *      │  │                 │     │    re-auth       │ │ refresh(now ≥ expiresAt)
 *      │  │  signOut /      │     └──> failed <─────┘ │        (auto)
 *      │  │  abandon        │          (handshake     │
 *      │  └─────────────────┘           failed or     ▼
 *      │                        revoked)           expired
 *      │                                           │
 *      └──────────── signOut / re-auth ────────────┘
 *   failed ──> authorizing (retry) / signedOut (reset)
 * ```
 *
 * Legal transitions only; every illegal transition throws a typed
 * `AuthStateError` (mirrors the SDK's lifecycle.ts: state-machine misuse is
 * a PROGRAMMER error and throws, it is never silently ignored and never
 * degraded into an operational result).
 *
 * Expiry: entering `signedIn` may carry `expiresAt` (epoch ms). `refresh(now)`
 * auto-transitions to `expired` once `now >= expiresAt`; sessions entered
 * without an `expiresAt` never expire. `isUsable(state)` is true only for
 * `signedIn` — `expired`, `failed`, `authorizing` and `signedOut` are all
 * unusable for authenticated operations.
 */

/** States of a connector's auth session. */
export type AuthSessionState =
  | "signedOut"
  | "authorizing"
  | "signedIn"
  | "expired"
  | "failed";

/** Runtime list of the auth session states. */
export const AUTH_SESSION_STATES: readonly AuthSessionState[] = [
  "signedOut",
  "authorizing",
  "signedIn",
  "expired",
  "failed",
] as const;

/** Runtime membership check against the `AuthSessionState` union. */
export function isAuthSessionState(x: unknown): x is AuthSessionState {
  return (
    typeof x === "string" &&
    AUTH_SESSION_STATES.includes(x as AuthSessionState)
  );
}

/** Typed error thrown on illegal auth session transitions. */
export class AuthStateError extends Error {
  /** The state the session was in when the illegal action was attempted. */
  public readonly from: AuthSessionState;
  /** The state that was rejected. */
  public readonly to: AuthSessionState;

  constructor(message: string, from: AuthSessionState, to: AuthSessionState) {
    super(message);
    this.name = "AuthStateError";
    this.from = from;
    this.to = to;
  }
}

/**
 * The closed transition table. Notable decisions:
 * - `signedOut → signedIn` is ILLEGAL: signing in always passes through
 *   `authorizing` (the caller-visible handshake step).
 * - `signedIn → authorizing` is LEGAL: re-authorization (e.g. refreshing an
 *   oauth credential) without signing out first.
 * - `expired`/`failed` may go back to `authorizing` (re-auth / retry) or
 *   `signedOut` (reset), but never directly to `signedIn`.
 */
const LEGAL_TRANSITIONS: Readonly<Record<AuthSessionState, readonly AuthSessionState[]>> =
  Object.freeze({
    signedOut: ["authorizing"],
    authorizing: ["signedIn", "signedOut", "failed"],
    signedIn: ["signedOut", "expired", "failed", "authorizing"],
    expired: ["signedOut", "authorizing"],
    failed: ["signedOut", "authorizing"],
  });

/** Pure check: is `from → to` a legal transition? */
export function canTransition(
  from: AuthSessionState,
  to: AuthSessionState,
): boolean {
  if (!isAuthSessionState(from) || !isAuthSessionState(to)) return false;
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Is `state` usable for authenticated operations? True only for `signedIn`.
 * (Whether a connector needs auth at all is a descriptor-level question —
 * see flows.ts / service.ts; this helper speaks only for the session.)
 */
export function isUsable(state: AuthSessionState): boolean {
  return state === "signedIn";
}

/** Options accepted by `AuthSession.transition`, per target state. */
export interface TransitionOptions {
  /**
   * Session expiry (epoch milliseconds). Only valid when entering
   * `signedIn`; omitted means the sign-in never expires.
   */
  expiresAt?: number;
  /**
   * Why the session failed. Only valid when entering `failed`.
   */
  failureReason?: string;
}

/**
 * The per-connector auth session state machine.
 *
 * Illegal transitions throw `AuthStateError` — never a no-op. State-extras
 * (`expiresAt`, `failureReason`) are reset on every transition unless
 * re-supplied for the matching target state.
 */
export class AuthSession {
  #state: AuthSessionState = "signedOut";
  #expiresAt: number | undefined;
  #failureReason: string | undefined;

  /** Current state. */
  state(): AuthSessionState {
    return this.#state;
  }

  /** The sign-in expiry (epoch ms), or `undefined` when there is none. */
  expiresAt(): number | undefined {
    return this.#expiresAt;
  }

  /** The recorded failure reason, or `undefined` outside the `failed` state. */
  failureReason(): string | undefined {
    return this.#failureReason;
  }

  /**
   * Transition to `to`.
   *
   * @param to       target state (runtime-validated; unknown states throw).
   * @param options  `expiresAt` when entering `signedIn`, `failureReason`
   *                 when entering `failed` — anything else is rejected.
   * @throws AuthStateError on an illegal transition, an unknown state, or
   *         options that do not belong to the target state.
   */
  transition(to: AuthSessionState, options?: TransitionOptions): void {
    if (!isAuthSessionState(to)) {
      throw new AuthStateError(
        `unknown auth session state '${String(to)}'`,
        this.#state,
        to,
      );
    }
    if (options !== undefined && !isPlainObject(options)) {
      throw new AuthStateError(
        "transition options must be an object",
        this.#state,
        to,
      );
    }
    if (!canTransition(this.#state, to)) {
      throw new AuthStateError(
        `illegal auth session transition '${this.#state}' → '${to}'`,
        this.#state,
        to,
      );
    }

    const expiresAt = options?.expiresAt;
    if (expiresAt !== undefined && to !== "signedIn") {
      throw new AuthStateError(
        "'expiresAt' is only valid when entering 'signedIn'",
        this.#state,
        to,
      );
    }
    if (
      expiresAt !== undefined &&
      (typeof expiresAt !== "number" ||
        !Number.isFinite(expiresAt) ||
        expiresAt < 0)
    ) {
      throw new AuthStateError(
        "'expiresAt' must be a finite non-negative epoch-milliseconds number",
        this.#state,
        to,
      );
    }

    const failureReason = options?.failureReason;
    if (failureReason !== undefined && to !== "failed") {
      throw new AuthStateError(
        "'failureReason' is only valid when entering 'failed'",
        this.#state,
        to,
      );
    }
    if (
      failureReason !== undefined &&
      (typeof failureReason !== "string" || failureReason.trim().length === 0)
    ) {
      throw new AuthStateError(
        "'failureReason' must be a non-empty string",
        this.#state,
        to,
      );
    }

    this.#state = to;
    this.#expiresAt = to === "signedIn" ? expiresAt : undefined;
    this.#failureReason = to === "failed" ? failureReason : undefined;
  }

  /**
   * Refresh the session against a clock: auto-transition `signedIn →
   * expired` once `now >= expiresAt`. Idempotent; returns the (possibly
   * new) current state. With `now` omitted the wall clock is used —
   * orchestrators with an injected clock (see service.ts) always pass it.
   */
  refresh(now?: number): AuthSessionState {
    const at = now ?? Date.now();
    if (
      this.#state === "signedIn" &&
      this.#expiresAt !== undefined &&
      at >= this.#expiresAt
    ) {
      this.transition("expired");
    }
    return this.#state;
  }

  /**
   * Refresh (with the same clock rules as `refresh`), then report whether
   * the session is usable — i.e. `signedIn` and not past expiry.
   */
  isUsable(now?: number): boolean {
    return this.refresh(now) === "signedIn";
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
