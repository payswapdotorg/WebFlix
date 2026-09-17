/**
 * @wfx/app-api — the source-management service (R03).
 *
 * The consumer-facing source-management truth over the connector SDK's
 * contracts (the registry's capability truth, the flow descriptors, the
 * AuthSession state machine) and the 052+R03 durable account store:
 *
 * - CONNECT / REAUTHORIZE / DISCONNECT per auth flow kind:
 *   - `oauth` — begin answers the provider's AUTHORIZATION URL (built by
 *     the connector's documented builder — never an invented endpoint) plus
 *     the opaque `state`; the pending authorization (user, connector, flow,
 *     expiry) is persisted SERVER-SIDE (migration 0008), never in URLs.
 *     The callback completes the exchange through the connector's
 *     documented token endpoint + transport and seals the credential with
 *     AES-256-GCM in the account store.
 *   - `device` — begin answers the flow's device-code instructions (the
 *     verification URL + poll cadence the SDK's flow descriptor carries)
 *     and persists the pending; completion of a device handshake is the
 *     HOST wiring's lane (no wired connector implements device issuance —
 *     honestly documented, never faked).
 *   - `local` — connects DIRECTLY with the caller-supplied token (sealed
 *     like any credential).
 *   - `none` — connects directly; no credential exists and none is stored
 *     (the source is always usable — the summary says so honestly).
 * - AUTHORIZATION-STATE TRUTH: the SDK's `AuthSession` state machine is
 *   the evaluator — a signedIn account whose stored credential cannot
 *   self-refresh and is past its documented expiry is REPORTED `expired`
 *   (and the durable projection is updated to match), never silently
 *   "connected". A refreshable grant stays signedIn (the connector rotates
 *   it at call time — that is not expiry).
 * - THE PRIVACY LAW: no method on this service exposes credential
 *   material. `listSources` answers metadata-only summaries (the account
 *   store's SAFE-VIEW vocabulary); the OAuth wiring hands the exchanged
 *   secret straight to the account store's seal; nothing credential-shaped
 *   is logged, answered, or handed to a model lane.
 *
 * Multi-user law (why this is NOT `ConnectorAuthService`): the SDK service
 * is single-user-per-instance by its own frozen docs; this service owns
 * per-USER state through the DURABLE store (one account row per
 * userId+connectorId) and evaluates state through the SDK's PURE pieces
 * (registry rows, flow descriptors, the AuthSession machine) — no shared
 * in-memory auth state, no cross-user bleed.
 *
 * Determinism: every timestamp derives from the injected clock; every id
 * and state token from the injected id seam; no wall clock, no randomness,
 * no network of its own (the OAuth wiring's transport is injected).
 */

import type { Capability } from "@wfx/domain";
import {
  AuthSession,
  ConnectorRegistry,
  flowFor,
  type AuthFlow,
} from "@wfx/connectors";
import {
  PersistenceError,
  type ConnectorAccountRecord,
  type ConnectorCredentialKind,
  type PendingAuthorizationRecord,
  type PostgresConnectorAccountStore,
} from "@wfx/persistence";
import type { Clock } from "@wfx/experience";

// ---------------------------------------------------------------------------
// Types (the API's source-management vocabulary)
// ---------------------------------------------------------------------------

/** The authorization-state vocabulary (mirrors the SDK's AuthSessionState). */
export type SourceAuthSessionState =
  | "signedOut"
  | "authorizing"
  | "signedIn"
  | "expired"
  | "failed";

/** One source's management truth (the GET /sources row). */
export interface SourceSummary {
  readonly connectorId: string;
  readonly displayName: string;
  readonly version: string;
  readonly authMode: "none" | "oauth" | "device" | "local";
  readonly authState: SourceAuthSessionState;
  /** Usable for authenticated operations (auth:none is always usable). */
  readonly usable: boolean;
  /** Whether the user has a linked account row. */
  readonly connected: boolean;
  /** The capability truth row — EVERY frozen capability, declared = true. */
  readonly capabilities: Record<Capability, boolean>;
  /** ISO instant of the current credential's authorization, when linked. */
  readonly authorizedAt: string | null;
  /** ISO instant of the last authorization-state change, when known. */
  readonly lastStateChange: string | null;
  /** ISO instant of the stored authorization's session expiry, when set. */
  readonly expiresAt: string | null;
  /** Source-specific availability notes (non-secret, client-visible). */
  readonly notes: string[];
}

/** The typed failure vocabulary of the source-management operations. */
export type SourceError =
  | { kind: "unknown-connector"; connectorId: string }
  | { kind: "no-account"; connectorId: string }
  | { kind: "flow-missing"; connectorId: string; detail: string }
  | { kind: "invalid-input"; detail: string }
  /** The callback's state token matches no live pending (never issued /
   * consumed / superseded). */
  | { kind: "unknown-pending"; detail: string }
  /** The pending authorization's TTL elapsed — begin the flow again. */
  | { kind: "expired-pending"; expiredAt: string }
  /** The provider REFUSED the authorization code (retry: connect again). */
  | { kind: "exchange-rejected"; detail: string }
  /** The token exchange transport failed (retryable later). */
  | { kind: "exchange-transport"; detail: string }
  | { kind: "store-error"; detail: string };

/** The typed result envelope of the source-management operations. */
export type SourceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SourceError };

/** A begun oauth handshake: the URL to visit + the opaque state. */
export interface OAuthConnectAnswer {
  readonly flowKind: "oauth";
  readonly connectorId: string;
  /** The provider's authorization URL (the connector's documented builder). */
  readonly authorizationUrl: string;
  /** The opaque state token (the callback key; CSRF token in the URL). */
  readonly state: string;
  /** When the pending authorization expires (ISO). */
  readonly expiresAt: string;
}

/** A begun device handshake: the provider's verification instructions. */
export interface DeviceConnectAnswer {
  readonly flowKind: "device";
  readonly connectorId: string;
  /** The verification URL the user visits to approve (the flow's template). */
  readonly verificationUrl: string;
  /** The provider's documented poll cadence (seconds). */
  readonly pollIntervalSeconds: number;
  readonly state: string;
  readonly expiresAt: string;
  /** The honest completion note (device-code issuance is the host's lane). */
  readonly note: string;
}

/** A direct connection (local/none flows — no external handshake). */
export interface DirectConnectAnswer {
  readonly flowKind: "local" | "none";
  readonly connectorId: string;
  readonly connected: true;
  /** The linked account id (local); null for `none` (no account exists). */
  readonly accountId: string | null;
  readonly authorizedAt: string | null;
  readonly note: string;
}

/** The connect/reauthorize answer (per flow kind). */
export type ConnectAnswer = OAuthConnectAnswer | DeviceConnectAnswer | DirectConnectAnswer;

/** The disconnect answer (idempotent by design). */
export interface DisconnectAnswer {
  readonly connectorId: string;
  readonly authState: "signedOut";
  readonly disconnected: true;
  /** Whether an account row was actually removed (false = already gone). */
  readonly deletedAccount: boolean;
}

/** The OAuth callback completion answer. */
export interface CallbackAnswer {
  readonly connectorId: string;
  readonly authState: "signedIn";
  readonly connected: true;
  readonly accountId: string;
  readonly authorizedAt: string;
}

// ---------------------------------------------------------------------------
// The OAuth wiring seam (per-connector, injected at boot)
// ---------------------------------------------------------------------------

/** The typed outcome of one authorization-code exchange. */
export type CodeExchangeOutcome =
  | {
      ok: true;
      /** The serialized credential payload (the account store seals it). */
      readonly secret: string;
      /** The credential kind the account row records. */
      readonly kind: ConnectorCredentialKind;
      /** Non-secret account metadata (guarded at the store boundary). */
      readonly metadata: Record<string, unknown>;
    }
  | {
      ok: false;
      /** `rejected` — the provider refused the code (retry: connect again). */
      readonly kind: "rejected" | "transport" | "malformed";
      readonly detail: string;
    };

/**
 * One connector's OAuth client wiring — the operator-provisioned client
 * config plus the connector's OWN documented URL builder and token
 * exchange (via its transport). Built at boot; the service never invents
 * endpoints, never sees the client secret except by passing it through to
 * the connector's exchange function, and never logs it.
 */
export interface OAuthWiring {
  readonly connectorId: string;
  /** The provider client id (public — it appears in the authorization URL). */
  readonly clientId: string;
  /** The registered redirect URI (echoed by the provider with the code). */
  readonly redirectUri: string;
  /** Build the provider's documented authorization URL for a state token. */
  buildAuthorizationUrl(state: string): string;
  /** Exchange the authorization code via the connector's token endpoint. */
  exchangeCode(code: string): Promise<CodeExchangeOutcome>;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** Default pending-authorization TTL: 10 minutes (the SDK's default). */
const DEFAULT_PENDING_TTL_MS = 600_000;

/** Constructor options. */
export interface SourceManagementOptions {
  /** The registry (capability truth — the single source of what exists). */
  readonly registry: ConnectorRegistry;
  /**
   * The durable account store. Constructed inline when only the store
   * options are supplied (the boot's shape); tests pass a real instance.
   */
  readonly accounts: PostgresConnectorAccountStore;
  /** Per-connector auth-flow details (the SDK's flow descriptors). */
  readonly flows?: Readonly<Record<string, AuthFlow>>;
  /** Per-connector OAuth client wirings (absent = connect unavailable). */
  readonly oauthWirings?: Readonly<Record<string, OAuthWiring>>;
  readonly clock: Clock;
  /** The id seam — mints account ids AND opaque pending-state tokens. */
  readonly ids: { next(): string };
  /** Pending-authorization TTL (ms); default 600_000. */
  readonly pendingTtlMs?: number;
}

/** The source-management service (see the module doc). */
export class SourceManagementService {
  private readonly registry: ConnectorRegistry;
  private readonly accounts: PostgresConnectorAccountStore;
  private readonly flows: Readonly<Record<string, AuthFlow>>;
  private readonly oauthWirings: Readonly<Record<string, OAuthWiring>>;
  private readonly clock: Clock;
  private readonly ids: { next(): string };
  private readonly pendingTtlMs: number;

  constructor(options: SourceManagementOptions) {
    this.registry = options.registry;
    this.accounts = options.accounts;
    this.flows = options.flows ?? {};
    this.oauthWirings = options.oauthWirings ?? {};
    this.clock = options.clock;
    this.ids = options.ids;
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  }

  // — the source list ——————————————————————————————————————————————————

  /**
   * The user's source list: every registered connector's descriptor truth
   * joined with the user's account linkage and the EVALUATED authorization
   * state. Sorted by connector id (the registry's deterministic order).
   */
  async listSources(userId: string): Promise<readonly SourceSummary[]> {
    const rows = this.registry.capabilityMatrix().filter((row) => row.hasInstance);
    const accounts = await this.accountRowsFor(userId);
    const nowMs = this.clock.now();

    const summaries: SourceSummary[] = [];
    for (const row of rows) {
      const account = accounts.get(row.id) ?? null;
      const evaluated = await this.evaluateState(userId, row.id, row.auth, account, nowMs);
      // A source with no account but a LIVE pending is honestly
      // `authorizing` — the handshake is in flight (the state machine's
      // begin → authorizing law, projected from the durable pending).
      const authorizing =
        account === null && (await this.livePendingFor(userId, row.id)) !== null;
      const authState: SourceAuthSessionState =
        account === null ? (authorizing ? "authorizing" : "signedOut") : evaluated.state;
      const notes = this.notesFor(row.id, row.auth, account);
      summaries.push({
        connectorId: row.id,
        displayName: row.displayName,
        version: row.version,
        authMode: row.auth,
        authState,
        usable: row.auth === "none" ? true : authState === "signedIn",
        connected: account !== null,
        capabilities: { ...row.capabilities },
        authorizedAt: account?.authorizedAt ?? null,
        lastStateChange: account?.lastStateChange ?? null,
        expiresAt: evaluated.expiresAt,
        notes,
      });
    }
    return summaries;
  }

  /** The live pending for one pair (store failures degrade to null). */
  private async livePendingFor(
    userId: string,
    connectorId: string,
  ): Promise<PendingAuthorizationRecord | null> {
    try {
      return await this.accounts.livePendingFor(userId, connectorId);
    } catch {
      return null;
    }
  }

  /**
   * The per-source auth-state gate the fan-out consumes (R03 §4): a
   * signedOut/expired/authorizing/failed source is skipped with an honest
   * per-source note; a signedIn (or `none`) source is queried.
   */
  async authGateFor(userId: string): Promise<ReadonlyMap<string, GateRow>> {
    const summaries = await this.listSources(userId);
    const gate = new Map<string, GateRow>();
    for (const summary of summaries) {
      const detail =
        summary.authState === "expired"
          ? `the stored authorization expired${summary.expiresAt !== null ? ` at ${summary.expiresAt}` : ""} — reauthorize the source`
          : undefined;
      gate.set(summary.connectorId, {
        connectorId: summary.connectorId,
        session: summary.authState,
        usable: summary.usable,
        ...(detail !== undefined ? { detail } : {}),
      });
    }
    return gate;
  }

  // — connect / reauthorize ———————————————————————————————————————————

  /**
   * Begin connecting `connectorId` (a fresh authorization). For oauth this
   * answers the authorization URL + the pending state; for device the
   * verification instructions; for local/none the direct connection.
   */
  async connect(
    userId: string,
    connectorId: string,
    input?: { readonly token?: string },
  ): Promise<SourceResult<ConnectAnswer>> {
    return this.beginFlow(userId, connectorId, input);
  }

  /**
   * Re-run the flow for an existing account (reconnect/reauthorize — the
   * user ability). The account row is PRESERVED: completion upserts the
   * credential in place (the store's one-row-per-(user,connector) law).
   */
  async reauthorize(
    userId: string,
    connectorId: string,
    input?: { readonly token?: string },
  ): Promise<SourceResult<ConnectAnswer>> {
    const row = this.rowFor(connectorId);
    if (row === null) {
      return this.unknownConnector(connectorId);
    }
    const account = await this.accountRowFor(userId, connectorId);
    if (account === null) {
      return {
        ok: false,
        error: {
          kind: "no-account",
          connectorId,
        },
      };
    }
    return this.beginFlow(userId, connectorId, input);
  }

  // — disconnect ——————————————————————————————————————————————————————

  /**
   * Disconnect `connectorId`: the account row is deleted (the sealed
   * credential goes with it — the store's delete discipline), every live
   * pending for the pair is evicted, and the state is honestly
   * `signedOut`. IDEMPOTENT: disconnecting a disconnected source is a
   * success.
   */
  async disconnect(userId: string, connectorId: string): Promise<SourceResult<DisconnectAnswer>> {
    const row = this.rowFor(connectorId);
    if (row === null) {
      return this.unknownConnector(connectorId);
    }
    try {
      const deletedAccount = await this.accounts.deleteAccount(userId, connectorId);
      await this.accounts.deletePendingAuthorizationsFor(userId, connectorId);
      return {
        ok: true,
        value: {
          connectorId,
          authState: "signedOut",
          disconnected: true,
          deletedAccount,
        },
      };
    } catch (thrown) {
      return this.storeError("disconnect", thrown);
    }
  }

  // — the OAuth callback ——————————————————————————————————————————————

  /**
   * Complete the OAuth handshake a provider redirected back: load the
   * pending by its opaque state (typed not-found / expired), exchange the
   * code through the connector's documented token endpoint, seal the
   * credential in the account store (upsert — the account row is
   * preserved across reauthorizations), consume the pending.
   */
  async completeOAuthCallback(
    state: string,
    code: string,
  ): Promise<SourceResult<CallbackAnswer>> {
    if (typeof state !== "string" || state.trim().length === 0) {
      return { ok: false, error: { kind: "invalid-input", detail: "state: expected the callback's opaque state token" } };
    }
    if (typeof code !== "string" || code.trim().length === 0) {
      return { ok: false, error: { kind: "invalid-input", detail: "code: expected the provider's authorization code (or use the error channel)" } };
    }

    let pending: PendingAuthorizationRecord;
    try {
      const loaded = await this.accounts.loadPendingAuthorization(state);
      if (!loaded.ok) {
        if (loaded.reason === "not-found") {
          return {
            ok: false,
            error: {
              kind: "unknown-pending",
              detail:
                "the state token matches no live pending authorization — it was never issued, was already consumed, or was superseded by a newer begin",
            },
          };
        }
        return {
          ok: false,
          error: {
            kind: "expired-pending",
            expiredAt: loaded.expiredAt,
          },
        };
      }
      pending = loaded.pending;
    } catch (thrown) {
      return this.storeError("callback.loadPending", thrown);
    }

    if (pending.flowKind !== "oauth") {
      return {
        ok: false,
        error: {
          kind: "invalid-input",
          detail: `the pending authorization for connector '${pending.connectorId}' is a '${pending.flowKind}' flow — only oauth flows complete via the callback route`,
        },
      };
    }

    const wiring = this.oauthWirings[pending.connectorId];
    if (wiring === undefined) {
      return {
        ok: false,
        error: {
          kind: "flow-missing",
          connectorId: pending.connectorId,
          detail: `the oauth client wiring for connector '${pending.connectorId}' is not provisioned — the operator must configure it before the handshake can complete`,
        },
      };
    }

    let exchange: CodeExchangeOutcome;
    try {
      exchange = await wiring.exchangeCode(code);
    } catch (thrown) {
      exchange = {
        ok: false,
        kind: "transport",
        detail: thrown instanceof Error ? thrown.message : String(thrown),
      };
    }
    if (!exchange.ok) {
      // The provider refused the code or the transport failed: the pending
      // stays live (a retry with a fresh code from the same consent is
      // possible until it expires) and the failure is typed, never faked.
      return {
        ok: false,
        error: {
          kind: exchange.kind === "transport" ? "exchange-transport" : "exchange-rejected",
          detail: `the code exchange failed (${exchange.kind}): ${exchange.detail}`,
        },
      };
    }

    try {
      const record = await this.accounts.saveAccount({
        userId: pending.userId,
        connectorId: pending.connectorId,
        kind: exchange.kind,
        authState: "signedIn",
        secret: exchange.secret,
        metadata: exchange.metadata,
      });
      await this.accounts.deletePendingAuthorization(state);
      return {
        ok: true,
        value: {
          connectorId: pending.connectorId,
          authState: "signedIn",
          connected: true,
          accountId: record.id,
          authorizedAt: record.authorizedAt ?? new Date(this.clock.now()).toISOString(),
        },
      };
    } catch (thrown) {
      return this.storeError("callback.complete", thrown);
    }
  }

  /**
   * Abandon a pending authorization (the provider redirected back with
   * `error=access_denied` or similar): the pending is consumed and the
   * failure is typed honestly. Never a fabricated success.
   */
  async abandonPending(state: string, _providerError: string): Promise<SourceResult<{ connectorId: string | null }>> {
    if (typeof state !== "string" || state.trim().length === 0) {
      return { ok: false, error: { kind: "invalid-input", detail: "state: expected the callback's opaque state token" } };
    }
    let connectorId: string | null = null;
    try {
      const loaded = await this.accounts.loadPendingAuthorization(state);
      if (loaded.ok) {
        connectorId = loaded.pending.connectorId;
        await this.accounts.deletePendingAuthorization(state);
      }
    } catch (thrown) {
      return this.storeError("callback.abandon", thrown);
    }
    return { ok: true, value: { connectorId } };
  }

  // — internals ————————————————————————————————————————————————————————

  /** The shared connect/reauthorize flow beginning. */
  private async beginFlow(
    userId: string,
    connectorId: string,
    input?: { readonly token?: string },
  ): Promise<SourceResult<ConnectAnswer>> {
    const row = this.rowFor(connectorId);
    if (row === null) {
      return this.unknownConnector(connectorId);
    }

    const details = this.flows[connectorId];
    let flow: AuthFlow;
    try {
      // flowFor refuses to fabricate oauth/device endpoints — a missing
      // registration surfaces as the typed AuthFlowValidationError, mapped
      // to the honest flow-missing answer below.
      flow = flowFor(row, details);
    } catch {
      return {
        ok: false,
        error: {
          kind: "flow-missing",
          connectorId,
          detail: `connector '${connectorId}' declares auth '${row.auth}' but no flow details are registered for it — the operator must provision the flow wiring`,
        },
      };
    }

    switch (flow.kind) {
      case "oauth": {
        const wiring = this.oauthWirings[connectorId];
        if (wiring === undefined) {
          return {
            ok: false,
            error: {
              kind: "flow-missing",
              connectorId,
              detail:
                `the oauth client wiring for connector '${connectorId}' is not provisioned ` +
                "(the operator must configure the provider client credentials and the registered redirect URI)",
            },
          };
        }
        const state = this.ids.next();
        const expiresAtMs = this.clock.now() + this.pendingTtlMs;
        try {
          await this.accounts.savePendingAuthorization({
            userId,
            connectorId,
            state,
            flowKind: "oauth",
            expiresAtMs,
            metadata: { flowKind: "oauth", clientId: wiring.clientId },
          });
        } catch (thrown) {
          return this.storeError("connect.pending", thrown);
        }
        return {
          ok: true,
          value: {
            flowKind: "oauth",
            connectorId,
            authorizationUrl: wiring.buildAuthorizationUrl(state),
            state,
            expiresAt: new Date(expiresAtMs).toISOString(),
          },
        };
      }

      case "device": {
        // The device-code instructions the flow descriptor carries. The
        // device CODE itself is issued by the provider's device-code
        // endpoint — no wired connector implements device issuance, so the
        // answer is honestly the instructions + the pending, never a
        // fabricated code.
        const state = this.ids.next();
        const expiresAtMs = this.clock.now() + this.pendingTtlMs;
        try {
          await this.accounts.savePendingAuthorization({
            userId,
            connectorId,
            state,
            flowKind: "device",
            expiresAtMs,
            metadata: { flowKind: "device" },
          });
        } catch (thrown) {
          return this.storeError("connect.pending", thrown);
        }
        return {
          ok: true,
          value: {
            flowKind: "device",
            connectorId,
            verificationUrl: flow.verificationUrlTemplate,
            pollIntervalSeconds: flow.pollIntervalSeconds,
            state,
            expiresAt: new Date(expiresAtMs).toISOString(),
            note:
              "visit the verification URL and approve the device code the provider shows — " +
              "the code is issued by the provider's device endpoint (host wiring), never fabricated here",
          },
        };
      }

      case "local": {
        if (flow.method !== "token") {
          return {
            ok: false,
            error: {
              kind: "invalid-input",
              detail: `connector '${connectorId}' uses the '${flow.method}' local method, which this endpoint does not collect — provide the documented credential shape`,
            },
          };
        }
        const token = input?.token;
        if (typeof token !== "string" || token.length === 0) {
          return {
            ok: false,
            error: {
              kind: "invalid-input",
              detail: "token: required for local-auth connectors (the credential this source connects with)",
            },
          };
        }
        try {
          const record = await this.accounts.saveAccount({
            userId,
            connectorId,
            kind: "local-token",
            authState: "signedIn",
            secret: token,
            metadata: { method: "token", flowKind: "local" },
          });
          return {
            ok: true,
            value: {
              flowKind: "local",
              connectorId,
              connected: true,
              accountId: record.id,
              authorizedAt: record.authorizedAt,
              note: "connected with the supplied local credential (sealed AES-256-GCM at rest)",
            },
          };
        } catch (thrown) {
          return this.storeError("connect.local", thrown);
        }
      }

      case "none": {
        // No credential exists and none is stored — the source is always
        // usable; "connecting" it is the honest no-op that says so.
        return {
          ok: true,
          value: {
            flowKind: "none",
            connectorId,
            connected: true,
            accountId: null,
            authorizedAt: null,
            note: "this source needs no authorization — it is always available",
          },
        };
      }
    }
  }

  /**
   * Evaluate the EFFECTIVE authorization state of one account through the
   * SDK's AuthSession state machine: a signedIn account whose stored
   * credential cannot self-refresh and is past its documented expiry is
   * REPORTED expired (and the durable projection updated), never silently
   * "connected".
   */
  private async evaluateState(
    userId: string,
    connectorId: string,
    authMode: "none" | "oauth" | "device" | "local",
    account: ConnectorAccountRecord | null,
    nowMs: number,
  ): Promise<{ state: SourceAuthSessionState; expiresAt: string | null }> {
    if (account === null) {
      return { state: "signedOut", expiresAt: null };
    }
    if (account.authState !== "signedIn") {
      // expired/failed/authorizing projections are honored as stored —
      // they never self-heal on a read.
      return { state: account.authState, expiresAt: null };
    }

    // The session expiry the stored credential implies: only a credential
    // that CANNOT self-refresh expires with its access token (a refreshable
    // grant stays signedIn — the connector rotates it at call time).
    const metadata = account.metadata ?? {};
    const expiresAtMs = metadata["expiresAtMs"];
    const hasRefreshToken = metadata["hasRefreshToken"] === true;
    const sessionExpiryMs =
      typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) && !hasRefreshToken
        ? expiresAtMs
        : undefined;

    if (sessionExpiryMs === undefined) {
      return { state: "signedIn", expiresAt: null };
    }

    // The SDK's session state machine does the evaluation — this IS the
    // "expired is REPORTED expired (the session state machine's job)" law.
    const session = new AuthSession();
    session.transition("authorizing");
    session.transition("signedIn", { expiresAt: sessionExpiryMs });
    const state = session.refresh(nowMs);
    if (state === "expired") {
      // Keep the durable projection truthful (best effort — a store
      // failure never blocks the honest read).
      try {
        await this.accounts.setAuthState(userId, connectorId, "expired");
      } catch {
        // The read already carries the truth; the projection catches up
        // on the next write path.
      }
      return { state: "expired", expiresAt: new Date(sessionExpiryMs).toISOString() };
    }
    return { state: "signedIn", expiresAt: new Date(sessionExpiryMs).toISOString() };
  }

  /** The per-source availability notes (quota/health truth, non-secret). */
  private notesFor(
    connectorId: string,
    authMode: "none" | "oauth" | "device" | "local",
    account: ConnectorAccountRecord | null,
  ): string[] {
    const notes: string[] = [];
    if ((authMode === "oauth" || authMode === "device") && this.flows[connectorId] === undefined) {
      notes.push("auth flow not wired — connecting is unavailable (operator configuration)");
    }
    if (authMode === "oauth" && this.oauthWirings[connectorId] === undefined) {
      notes.push("oauth client not configured — connecting is unavailable (operator configuration)");
    }
    if (account?.health !== null && account !== null) {
      const health = account.health;
      if (health?.quota !== undefined) notes.push(`quota: ${health.quota.note}`);
      if (health?.lastDegradation !== undefined) {
        notes.push(`last degradation: ${health.lastDegradation.detail}`);
      }
      if (health?.notes !== undefined) notes.push(...health.notes);
    }
    return notes;
  }

  private rowFor(connectorId: string) {
    for (const row of this.registry.capabilityMatrix()) {
      if (row.id === connectorId) return row;
    }
    return null;
  }

  private async accountRowsFor(userId: string): Promise<Map<string, ConnectorAccountRecord>> {
    try {
      const rows = await this.accounts.listForUser(userId);
      const map = new Map<string, ConnectorAccountRecord>();
      for (const row of rows) map.set(row.connectorId, row);
      return map;
    } catch {
      // A store failure degrades to the honest no-accounts view: every
      // connected source answers signedOut rather than a fabricated state.
      return new Map();
    }
  }

  private async accountRowFor(
    userId: string,
    connectorId: string,
  ): Promise<ConnectorAccountRecord | null> {
    try {
      const rows = await this.accounts.listForUser(userId);
      for (const row of rows) {
        if (row.connectorId === connectorId) return row;
      }
      return null;
    } catch {
      return null;
    }
  }

  private unknownConnector(connectorId: string): SourceResult<never> {
    return {
      ok: false,
      error: {
        kind: "unknown-connector",
        connectorId,
      },
    };
  }

  private storeError(operation: string, thrown: unknown): SourceResult<never> {
    const detail =
      thrown instanceof PersistenceError
        ? `${operation}: ${thrown.message}`
        : `${operation}: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
    return { ok: false, error: { kind: "store-error", detail } };
  }
}

/** One row of the fan-out's auth gate (see `authGateFor`). */
export interface GateRow {
  readonly connectorId: string;
  readonly session: SourceAuthSessionState;
  readonly usable: boolean;
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// The HTTP mapping (the lead-ratified convention: typed failures)
// ---------------------------------------------------------------------------

/**
 * Map one {@link SourceError} to its typed HTTP answer (the route handlers'
 * single shared mapping — machine-readable `error` kind + actionable
 * `detail`, never a bare 500 for an operational outcome):
 * - `unknown-connector` / `no-account` / `unknown-pending` → 404
 * - `expired-pending` → 410 Gone (begin the flow again — never resurrected)
 * - `flow-missing` → 503 (operator configuration, honest unavailability)
 * - `invalid-input` / `exchange-rejected` → 400
 * - `exchange-transport` / `store-error` → 502 (retryable upstream)
 */
export function sourceFailureResponse(error: SourceError): Response {
  switch (error.kind) {
    case "unknown-connector": {
      return Response.json(
        {
          error: "unknown-connector",
          detail: `connector '${error.connectorId}' is not a wired source of this service`,
        },
        { status: 404 },
      );
    }
    case "no-account": {
      return Response.json(
        {
          error: "no-account",
          detail: `connector '${error.connectorId}' has no connected account to reauthorize — connect it first`,
        },
        { status: 404 },
      );
    }
    case "unknown-pending": {
      return Response.json(
        { error: "unknown-pending", detail: error.detail },
        { status: 404 },
      );
    }
    case "expired-pending": {
      return Response.json(
        {
          error: "expired-pending",
          detail: `the pending authorization expired at ${error.expiredAt} — connect the source again`,
        },
        { status: 410 },
      );
    }
    case "flow-missing": {
      return Response.json(
        { error: "flow-missing", detail: error.detail },
        { status: 503 },
      );
    }
    case "invalid-input": {
      return Response.json({ error: "invalid-request", detail: error.detail }, { status: 400 });
    }
    case "exchange-rejected": {
      return Response.json({ error: "exchange-rejected", detail: error.detail }, { status: 400 });
    }
    case "exchange-transport": {
      return Response.json({ error: "exchange-unavailable", detail: error.detail }, { status: 502 });
    }
    case "store-error": {
      return Response.json({ error: "source-store-unavailable", detail: error.detail }, { status: 502 });
    }
  }
}
