/**
 * @wfx/connectors — the connector auth service (WFX-012, Lane B).
 *
 * `ConnectorAuthService` binds the three auth ingredients:
 * - a `ConnectorRegistry` — the source of "which connectors exist and which
 *   auth mode do they declare" (descriptor-only rows included);
 * - a `CredentialVault` — where post-handshake secrets live (secrets.ts);
 * - per-connector `AuthSession`s — the credential lifecycle (session.ts);
 * plus the per-connector auth flow details (flows.ts) needed to describe
 * oauth/device handshakes to callers.
 *
 * Product boundary (docs/architecture/product-boundaries.md — Privacy:
 * "Credentials remain in secure provider storage"; and this work item):
 * the service NEVER handles user credentials during a handshake. For
 * oauth/device flows, `beginAuth` hands the CALLER the flow descriptor and
 * a `pendingAuthId`; the caller completes the external handshake (browser
 * visit, device approval, token exchange — all outside this SDK) and then
 * hands the service only the post-handshake secret via
 * `completeAuth(pendingAuthId, secret)`. No network calls, no token
 * exchanges, no credential parsing happen here: the secret is stored
 * opaquely in the vault.
 *
 * Error-channel policy (mirrors result.ts / lifecycle.ts):
 * - OPERATIONAL outcomes are typed `AuthError` results — `unknown-connector`,
 *   `unknown-pending`, `expired-pending`, `wrong-flow`, `flow-missing`,
 *   `invalid-input`. Never thrown, never faked as success.
 * - PROGRAMMER/wiring errors THROW typed errors: `AuthServiceConfigError`
 *   (constructor misuse), `AuthFlowValidationError` (registered flow
 *   details whose kind does not match the descriptor's auth mode), and
 *   `AuthStateError` (a violated session invariant — unreachable in a
 *   correctly wired service, kept loud rather than faked).
 *
 * `ctx.userId` is recorded on pending auths for traceability. The service
 * tracks auth state PER CONNECTOR (single-user assumption per service
 * instance, per the WFX-012 packet); multi-user auth scoping is a future
 * contract change, not something to fake here.
 *
 * R03 — PENDING-AUTHORIZATION SUPPORT (additive): `beginAuth` accepts an
 * optional `{ state }` option — a CALLER-MINTED pending token (hosts that
 * key their pendings durably by the OAuth CSRF state, like the R03 account
 * store, bind the service's pending to that token instead of a
 * service-minted random id) — and `inspectPendingAuth(state)` returns a
 * live pending's info with the same typed `unknown-pending` /
 * `expired-pending` failures `completeAuth` answers. The service stays
 * honest about expiry: an inspected pending past its TTL is deleted, never
 * resurrectable.
 */

import type { ConnectorContext } from "@wfx/domain";

import type { AuthMode } from "../descriptor";
import type { CapabilityMatrixRow, ConnectorRegistry } from "../registry";

import {
  defineAuthFlow,
  flowFor,
  AuthFlowValidationError,
  type AuthFlow,
  type AuthFlowKind,
} from "./flows";
import {
  createInMemoryVault,
  type CredentialVault,
  type SecretHandle,
  type SecretKind,
} from "./secrets";
import { AuthSession, isUsable, type AuthSessionState } from "./session";

// ---------------------------------------------------------------------------
// Typed results
// ---------------------------------------------------------------------------

/**
 * The closed error vocabulary of the auth service (operational outcomes —
 * returned, never thrown):
 * - `unknown-connector` — the connector id is not registered.
 * - `unknown-pending`   — the pendingAuthId was never issued here, or was
 *                         completed, superseded, or signed out.
 * - `expired-pending`   — the pending auth's TTL elapsed before completion.
 * - `wrong-flow`        — the pending's flow accepts no credentials
 *                         (a `none` flow: the connector requires no auth).
 * - `flow-missing`      — oauth/device connector with no registered flow
 *                         details; beginAuth refuses to fabricate endpoints.
 * - `invalid-input`     — malformed ctx/ids/secret.
 */
export type AuthError =
  | { kind: "unknown-connector"; connectorId: string }
  | { kind: "unknown-pending"; pendingAuthId: string }
  | { kind: "expired-pending"; pendingAuthId: string; expiredAt: number }
  | {
      kind: "wrong-flow";
      pendingAuthId: string;
      flowKind: AuthFlowKind;
      detail: string;
    }
  | { kind: "flow-missing"; connectorId: string; authMode: AuthMode }
  | { kind: "invalid-input"; detail: string };

/** The result envelope for auth service operations. */
export type AuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthError };

function ok<T>(value: T): AuthResult<T> {
  return { ok: true, value };
}

function err<T>(error: AuthError): AuthResult<T> {
  return { ok: false, error };
}

function invalidAuthInput(detail: string): AuthError {
  return { kind: "invalid-input", detail };
}

// ---------------------------------------------------------------------------
// Outcome payloads
// ---------------------------------------------------------------------------

/**
 * A begun (in-flight) auth attempt: the flow the CALLER must follow plus
 * the opaque id used to complete it. Issued by `beginAuth`; the pending
 * expires at `expiresAt` (epoch ms).
 */
export interface PendingAuthInfo {
  /** Opaque id for `completeAuth` (and only for that). */
  readonly pendingAuthId: string;
  /** The connector being authorized. */
  readonly connectorId: string;
  /** The user (from `ctx`) who began the attempt — traceability only. */
  readonly userId: string;
  /** The flow describing the handshake the caller must complete. */
  readonly flow: AuthFlow;
  /** When this pending expires (epoch ms). */
  readonly expiresAt: number;
}

/** A completed auth: the session is signed in and the secret is stored. */
export interface CompletedAuthInfo {
  /** The connector that was authorized. */
  readonly connectorId: string;
  /** The flow kind that completed. */
  readonly flowKind: AuthFlowKind;
  /** Always `"signedIn"` on success. */
  readonly session: AuthSessionState;
  /** The session's expiry (epoch ms) when a sessionTtlMs is configured. */
  readonly expiresAt?: number;
  /** The vault handle of the stored credential (opaque, non-secret). */
  readonly handle: SecretHandle;
}

/** A signed-out connector: credentials deleted, session reset. */
export interface SignedOutInfo {
  /** The connector that was signed out. */
  readonly connectorId: string;
  /** Always `"signedOut"` on success. */
  readonly session: AuthSessionState;
  /** How many vault credentials were deleted. */
  readonly secretsDeleted: number;
}

/** The current auth state of one connector. */
export interface ConnectorAuthStatus {
  /** The connector this status describes. */
  readonly connectorId: string;
  /** The descriptor's declared auth mode. */
  readonly authMode: AuthMode;
  /** The session state (already refreshed against the clock). */
  readonly session: AuthSessionState;
  /**
   * Whether the connector is usable for authenticated operations: true for
   * `auth: "none"` connectors (no credentials required), otherwise only
   * while the session is `signedIn`.
   */
  readonly usable: boolean;
  /** The session's expiry (epoch ms), when one is set. */
  readonly expiresAt?: number;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** Default pending-auth TTL: 10 minutes (comparable to RFC 8628 device
 *  code validity windows). */
const DEFAULT_PENDING_TTL_MS = 600_000;

const PENDING_ID_BYTES = 16;

/** Typed error for `ConnectorAuthService` constructor misuse. */
export class AuthServiceConfigError extends Error {
  constructor(message: string) {
    super(`invalid auth service configuration: ${message}`);
    this.name = "AuthServiceConfigError";
  }
}

/**
 * Constructor options for `ConnectorAuthService`.
 *
 * `flows` carries the per-connector auth flow DETAILS keyed by connector
 * id (validated at construction via `defineAuthFlow`). The frozen
 * descriptor declares only the auth MODE; oauth/device endpoints are
 * provider-specific facts the app wiring must supply. Without them,
 * `beginAuth` returns the typed `flow-missing` error — never a fabricated
 * endpoint.
 */
export interface ConnectorAuthServiceOptions {
  /** The connector registry (single source of connector truth). */
  registry: ConnectorRegistry;
  /**
   * The credential vault. Defaults to `createInMemoryVault()` — see the
   * secrets.ts PRODUCTION WARNING: production wiring must back this with a
   * real secret manager.
   */
  vault?: CredentialVault;
  /** Auth flow details per connector id, validated at construction. */
  flows?: Readonly<Record<string, unknown>>;
  /** Session lifetime (ms) after sign-in; omitted → sessions never expire. */
  sessionTtlMs?: number;
  /** Pending-auth lifetime (ms); default 600_000 (10 minutes). */
  pendingTtlMs?: number;
  /** Injectable clock (epoch ms); default `Date.now`. */
  clock?: () => number;
}

/** Internal bookkeeping for an in-flight auth attempt. */
interface PendingAuth {
  readonly pendingAuthId: string;
  readonly connectorId: string;
  readonly userId: string;
  readonly flow: AuthFlow;
  readonly expiresAt: number;
}

/**
 * The connector auth service: begin/complete handshakes per flow kind,
 * sign out, and inspect auth state — with vault + sessions + registry
 * bound together and every operational failure a typed `AuthError`.
 */
export class ConnectorAuthService {
  private readonly registry: ConnectorRegistry;
  private readonly vault: CredentialVault;
  private readonly flows = new Map<string, AuthFlow>();
  private readonly sessions = new Map<string, AuthSession>();
  private readonly pendings = new Map<string, PendingAuth>();
  private readonly sessionTtlMs: number | undefined;
  private readonly pendingTtlMs: number;
  private readonly clock: () => number;

  constructor(options: ConnectorAuthServiceOptions) {
    if (!isPlainObject(options)) {
      throw new AuthServiceConfigError("an options object is required");
    }
    const { registry, vault, flows, sessionTtlMs, pendingTtlMs, clock } = options;

    if (
      !isPlainObject(registry) ||
      typeof (registry as { capabilityMatrix?: unknown }).capabilityMatrix !==
        "function"
    ) {
      throw new AuthServiceConfigError("'registry' must be a ConnectorRegistry");
    }
    this.registry = registry;

    const resolvedVault = vault ?? createInMemoryVault();
    if (
      !isPlainObject(resolvedVault) ||
      typeof (resolvedVault as { store?: unknown }).store !== "function" ||
      typeof (resolvedVault as { retrieve?: unknown }).retrieve !== "function" ||
      typeof (resolvedVault as { delete?: unknown }).delete !== "function" ||
      typeof (resolvedVault as { list?: unknown }).list !== "function"
    ) {
      throw new AuthServiceConfigError(
        "'vault' must implement the CredentialVault interface",
      );
    }
    this.vault = resolvedVault;

    if (flows !== undefined) {
      if (!isPlainObject(flows)) {
        throw new AuthServiceConfigError(
          "'flows' must be a record keyed by connector id",
        );
      }
      for (const id of Object.keys(flows)) {
        let flow: AuthFlow;
        try {
          flow = defineAuthFlow(flows[id]);
        } catch (cause) {
          if (cause instanceof AuthFlowValidationError) {
            throw new AuthFlowValidationError(
              `flow details registered for connector '${id}': ${cause.message}`,
            );
          }
          throw cause;
        }
        this.flows.set(id, flow);
      }
    }

    if (
      sessionTtlMs !== undefined &&
      (!Number.isInteger(sessionTtlMs) || sessionTtlMs <= 0)
    ) {
      throw new AuthServiceConfigError(
        "'sessionTtlMs' must be a positive integer (milliseconds)",
      );
    }
    this.sessionTtlMs = sessionTtlMs;

    if (
      pendingTtlMs !== undefined &&
      (!Number.isInteger(pendingTtlMs) || pendingTtlMs <= 0)
    ) {
      throw new AuthServiceConfigError(
        "'pendingTtlMs' must be a positive integer (milliseconds)",
      );
    }
    this.pendingTtlMs = pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;

    if (clock !== undefined && typeof clock !== "function") {
      throw new AuthServiceConfigError(
        "'clock' must be a function returning epoch milliseconds",
      );
    }
    this.clock = clock ?? defaultClock;
  }

  /**
   * Begin an auth attempt for `connectorId`.
   *
   * Returns the flow the CALLER must follow plus a `pendingAuthId`. For
   * `oauth`/`device` the caller completes the external handshake and then
   * calls `completeAuth(pendingAuthId, secret)`; for `local` the caller
   * collects the credential and completes directly. For `none` the flow is
   * `{ kind: 'none' }` — the returned pending exists only so completing it
   * yields the typed `wrong-flow` error (the connector requires no auth).
   *
   * A new begin supersedes any previous pending for the connector (the old
   * pendingAuthId becomes unknown). For non-`none` flows the session moves
   * to `authorizing` (legal from signedOut/signedIn/expired/failed).
   *
   * R03: `options.state` — a caller-minted pending token (e.g. the OAuth
   * CSRF state a host keys its DURABLE pendings by). When supplied, it
   * BECOMES the `pendingAuthId` (validated: non-empty, bounded, no control
   * characters, and not already a live pending id — a live token is never
   * silently taken over).
   *
   * Typed errors: `unknown-connector`, `flow-missing` (oauth/device
   * without registered details), `invalid-input`.
   *
   * @throws AuthFlowValidationError when registered flow details do not
   *         match the descriptor's auth mode (wiring error — loud, not a
   *         faked result).
   */
  beginAuth(
    ctx: ConnectorContext,
    connectorId: string,
    options?: { readonly state?: string },
  ): AuthResult<PendingAuthInfo> {
    const inputError = validateContext(ctx) ?? validateNonEmpty("connectorId", connectorId);
    if (inputError !== null) return err(inputError);

    if (options !== undefined && !isPlainObject(options)) {
      return err(invalidAuthInput("'options' must be an object when present"));
    }
    const callerState = options?.state;
    if (callerState !== undefined && !isUsablePendingToken(callerState)) {
      return err(
        invalidAuthInput(
          "'options.state': expected a non-empty token of at most 128 characters without control characters",
        ),
      );
    }

    const row = this.rowFor(connectorId);
    if (row === null) {
      return err({ kind: "unknown-connector", connectorId });
    }

    const details = this.flows.get(connectorId);
    if ((row.auth === "oauth" || row.auth === "device") && details === undefined) {
      return err({ kind: "flow-missing", connectorId, authMode: row.auth });
    }
    const flow = flowFor(row, details);

    const now = this.now();
    if (callerState !== undefined && this.pendings.has(callerState)) {
      return err(
        invalidAuthInput(
          "'options.state': the token is already a live pending auth id — mint a fresh one (a live handshake is never silently taken over)",
        ),
      );
    }
    const pendingAuthId = callerState ?? this.newPendingId();
    const expiresAt = now + this.pendingTtlMs;

    this.evictPendings(connectorId);

    const session = this.sessionFor(connectorId);
    session.refresh(now);
    if (flow.kind !== "none" && session.state() !== "authorizing") {
      session.transition("authorizing");
    }

    const pending: PendingAuth = {
      pendingAuthId,
      connectorId,
      userId: ctx.userId,
      flow,
      expiresAt,
    };
    this.pendings.set(pendingAuthId, pending);

    return ok({ pendingAuthId, connectorId, userId: ctx.userId, flow, expiresAt });
  }

  /**
   * R03: inspect a live pending auth by its id (service-minted OR the
   * caller-supplied `state`). Answers the same typed failures
   * `completeAuth` answers — `unknown-pending` (never issued / completed /
   * superseded / signed out) and `expired-pending` (the TTL elapsed — the
   * pending is deleted, dead is dead). Read-only: it does NOT complete or
   * consume the pending.
   */
  inspectPendingAuth(pendingAuthId: string): AuthResult<PendingAuthInfo> {
    const idError = validateNonEmpty("pendingAuthId", pendingAuthId);
    if (idError !== null) return err(idError);

    const pending = this.pendings.get(pendingAuthId);
    if (pending === undefined) {
      return err({ kind: "unknown-pending", pendingAuthId });
    }

    const now = this.now();
    if (now >= pending.expiresAt) {
      this.pendings.delete(pendingAuthId);
      return err({ kind: "expired-pending", pendingAuthId, expiredAt: pending.expiresAt });
    }

    return ok({
      pendingAuthId: pending.pendingAuthId,
      connectorId: pending.connectorId,
      userId: pending.userId,
      flow: pending.flow,
      expiresAt: pending.expiresAt,
    });
  }

  /**
   * Complete a pending auth with the post-handshake secret (opaque to this
   * service; for `userpass` flows the caller encodes the pair however the
   * provider requires).
   *
   * Stores (rotating) the credential in the vault, transitions the session
   * to `signedIn` (with a `sessionTtlMs`-derived expiry when configured),
   * and evicts the pending.
   *
   * Typed errors: `unknown-pending`, `expired-pending`, `wrong-flow`
   * (completing a `none` flow), `invalid-input` (empty ids/secret).
   *
   * @throws AuthStateError if the service's session invariant was violated
   *         (a live completable pending implies an authorizing session) —
   *         a bug that must fail loudly, never a faked success.
   */
  completeAuth(pendingAuthId: string, secret: string): AuthResult<CompletedAuthInfo> {
    const idError = validateNonEmpty("pendingAuthId", pendingAuthId);
    if (idError !== null) return err(idError);
    const secretError = validateNonEmpty("secret", secret);
    if (secretError !== null) return err(secretError);

    const pending = this.pendings.get(pendingAuthId);
    if (pending === undefined) {
      return err({ kind: "unknown-pending", pendingAuthId });
    }

    const now = this.now();
    if (now >= pending.expiresAt) {
      this.pendings.delete(pendingAuthId);
      return err({ kind: "expired-pending", pendingAuthId, expiredAt: pending.expiresAt });
    }

    if (pending.flow.kind === "none") {
      return err({
        kind: "wrong-flow",
        pendingAuthId,
        flowKind: "none",
        detail:
          "flow kind 'none' accepts no credentials — the connector declares no authentication",
      });
    }

    // Rotate: the fresh credential replaces any stored credential of the
    // same kind for this connector.
    const kind = secretKindForFlow(pending.flow);
    for (const existing of this.vault.list(pending.connectorId)) {
      if (existing.kind === kind) this.vault.delete(existing);
    }
    const handle = this.vault.store(pending.connectorId, kind, secret);

    const session = this.sessionFor(pending.connectorId);
    const sessionExpiresAt =
      this.sessionTtlMs === undefined ? undefined : now + this.sessionTtlMs;
    if (sessionExpiresAt === undefined) {
      session.transition("signedIn");
    } else {
      session.transition("signedIn", { expiresAt: sessionExpiresAt });
    }

    this.pendings.delete(pendingAuthId);

    const value: CompletedAuthInfo =
      sessionExpiresAt === undefined
        ? {
            connectorId: pending.connectorId,
            flowKind: pending.flow.kind,
            session: session.state(),
            handle,
          }
        : {
            connectorId: pending.connectorId,
            flowKind: pending.flow.kind,
            session: session.state(),
            handle,
            expiresAt: sessionExpiresAt,
          };
    return ok(value);
  }

  /**
   * Sign out `connectorId`: evicts live pendings, deletes ALL vault
   * credentials for the connector, and resets the session to `signedOut`
   * (idempotent — signing out an already-signed-out connector succeeds and
   * deletes nothing).
   *
   * Typed errors: `unknown-connector`, `invalid-input`.
   */
  signOut(connectorId: string): AuthResult<SignedOutInfo> {
    const inputError = validateNonEmpty("connectorId", connectorId);
    if (inputError !== null) return err(inputError);

    const row = this.rowFor(connectorId);
    if (row === null) {
      return err({ kind: "unknown-connector", connectorId });
    }

    const now = this.now();

    this.evictPendings(connectorId);

    let secretsDeleted = 0;
    for (const handle of this.vault.list(connectorId)) {
      if (this.vault.delete(handle)) secretsDeleted++;
    }

    const session = this.sessionFor(connectorId);
    session.refresh(now);
    if (session.state() !== "signedOut") {
      session.transition("signedOut");
    }

    return ok({ connectorId, session: session.state(), secretsDeleted });
  }

  /**
   * The current auth state of `connectorId` (the session is refreshed
   * against the clock first, so `signedIn` sessions past their expiry
   * report `expired`). `usable` is true for `auth: "none"` connectors
   * (no credentials required) and otherwise only for `signedIn`.
   *
   * Typed errors: `unknown-connector`, `invalid-input`.
   */
  authState(connectorId: string): AuthResult<ConnectorAuthStatus> {
    const inputError = validateNonEmpty("connectorId", connectorId);
    if (inputError !== null) return err(inputError);

    const row = this.rowFor(connectorId);
    if (row === null) {
      return err({ kind: "unknown-connector", connectorId });
    }

    const session = this.sessionFor(connectorId);
    const state = session.refresh(this.now());
    const usable = row.auth === "none" ? true : isUsable(state);

    const sessionExpiresAt = session.expiresAt();
    const value: ConnectorAuthStatus =
      sessionExpiresAt === undefined
        ? { connectorId, authMode: row.auth, session: state, usable }
        : {
            connectorId,
            authMode: row.auth,
            session: state,
            usable,
            expiresAt: sessionExpiresAt,
          };
    return ok(value);
  }

  // --- internals -------------------------------------------------------------

  private now(): number {
    return this.clock();
  }

  private newPendingId(): string {
    let id = randomHex(PENDING_ID_BYTES);
    while (this.pendings.has(id)) id = randomHex(PENDING_ID_BYTES);
    return id;
  }

  /**
   * Find the registry row for `connectorId` (covers instance AND
   * descriptor-only registrations — auth begins before any instance is
   * wired), or `null` when the connector is unknown.
   */
  private rowFor(connectorId: string): CapabilityMatrixRow | null {
    for (const row of this.registry.capabilityMatrix()) {
      if (row.id === connectorId) return row;
    }
    return null;
  }

  private sessionFor(connectorId: string): AuthSession {
    const existing = this.sessions.get(connectorId);
    if (existing !== undefined) return existing;
    const session = new AuthSession();
    this.sessions.set(connectorId, session);
    return session;
  }

  /** Evict every live pending for `connectorId` (supersession / sign-out). */
  private evictPendings(connectorId: string): void {
    for (const [id, pending] of this.pendings) {
      if (pending.connectorId === connectorId) this.pendings.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function defaultClock(): number {
  return Date.now();
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Map a completable flow to the vault credential kind it stores. */
function secretKindForFlow(flow: AuthFlow): SecretKind {
  switch (flow.kind) {
    case "oauth":
      return "oauth-token";
    case "device":
      return "device-token";
    case "local":
      return flow.method === "token" ? "local-token" : "local-userpass";
    case "none":
      // Unreachable in practice: completeAuth rejects 'none' flows before
      // storing anything. Fail loudly rather than invent a kind.
      throw new Error("internal invariant: 'none' flows store no credentials");
  }
}

function validateContext(ctx: unknown): AuthError | null {
  if (!isPlainObject(ctx)) {
    return invalidAuthInput("'ctx' must be a ConnectorContext object");
  }
  if (typeof ctx.userId !== "string" || ctx.userId.trim().length === 0) {
    return invalidAuthInput("'ctx.userId' must be a non-empty string");
  }
  if (typeof ctx.locale !== "string" || ctx.locale.trim().length === 0) {
    return invalidAuthInput("'ctx.locale' must be a non-empty string");
  }
  if (ctx.region !== undefined && typeof ctx.region !== "string") {
    return invalidAuthInput("'ctx.region' must be a string when present");
  }
  return null;
}

function validateNonEmpty(field: string, value: unknown): AuthError | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidAuthInput(`'${field}' must be a non-empty string`);
  }
  return null;
}

/** R03: is this a usable caller-minted pending token (the state option)? */
function isUsablePendingToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001F\u007F]/.test(value)
  );
}
