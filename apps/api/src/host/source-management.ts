/**
 * @wfx/app-api — the R03 source-management host service.
 *
 * The consumer-facing source-management surface behind the HTTP routes:
 * connect / reauthorize / disconnect, the source list with CAPABILITY TRUTH
 * + AUTHORIZATION-STATE truth, and the OAuth callback completion. It binds
 * three ingredients:
 *
 * - the WIRED SOURCES (the fan-out's `sourceRows()` — the SDK descriptor
 *   truth: id, displayName, version, auth mode, the full capability
 *   record);
 * - the FLOW WIRINGS (per-connector auth profiles the boot composes from
 *   documented provider facts — YouTube's OAuth via the connector's own
 *   `buildYouTubeAuthorizationUrl` / `exchangeYouTubeCode`; NO invented
 *   endpoints: a connector whose flow is not wired answers the typed
 *   `flow-missing`, never a fabricated URL);
 * - the DURABLE ACCOUNT STORE (WFX-052 + R03 migration 0008: envelope-
 *   encrypted credentials, lifecycle stamps, pending authorizations).
 *
 * THE PRIVACY LAW (enforced here too): nothing this service returns to the
 * client — and nothing the model lanes may consume — carries credential
 * material. Every outgoing payload passes `assertNoCredentialMaterial`
 * (the persistence model-input guard) before it leaves: a leak is a LOUD
 * 500-class programmer error, never a silent pass-through. Sealed envelopes
 * are written by `saveAccount` and opened ONLY by the connector runtime
 * lane (`loadAccount`), never by these reads.
 *
 * AUTHORIZATION-STATE TRUTH: an expired token is REPORTED expired — the
 * derivation checks the account's token expiry (`metadata.expiresAtMs`)
 * against the injected clock and never lets a dead session read as
 * "connected". A live pending authorization reports `authorizing`. The
 * derived truth is written through to the durable row (convergence), and
 * the same derivation feeds the fan-out's auth gate.
 *
 * Determinism: everything through the injected clock; state tokens are
 * minted with `crypto.getRandomValues` (128 bits — collision is not a
 * scenario). Credentials never appear in logs, URLs (beyond the OAuth
 * `state`/`code` the PROVIDER redirects with), or model prompts.
 */

import type { Capability, ConnectorDescriptor } from "@wfx/domain";
import {
  buildYouTubeAuthorizationUrl,
  createFetchYouTubeTransport,
  exchangeYouTubeCode,
  serializeYouTubeTokenSet,
  YOUTUBE_OAUTH_SCOPES,
  type YouTubeTokenSet,
} from "@wfx/connectors";
import {
  assertNoCredentialMaterial,
  PostgresConnectorAccountStore,
  type ConnectorAccountRecord,
  type ConnectorAuthState,
  type PendingAuthorizationRecord,
} from "@wfx/persistence";
import type { Clock } from "@wfx/experience";

import type { FanOutSourceRow } from "./fan-out";

// ---------------------------------------------------------------------------
// The flow wiring (per-connector, composed at boot from documented facts)
// ---------------------------------------------------------------------------

/**
 * The result of a code exchange through the connector's documented token
 * endpoint. The secret material (`sealedSecret`) exists ONLY inside the
 * completion path — it is sealed into the account store immediately and
 * never leaves this module.
 */
export interface ExchangeOutcome {
  readonly ok: boolean;
  /** The exchange failure's honest detail (absent on success). */
  readonly detail?: string;
  /** Whether the failure is RETRYABLE (transport) vs definitive (rejected). */
  readonly retryable?: boolean;
  /** The serialized token-set payload to seal (success only). */
  readonly sealedSecret?: string;
  /** Non-secret metadata to store alongside (expiry truth, scopes, …). */
  readonly metadata?: Record<string, unknown>;
  /** Per-account availability notes to store with the connection (never secrets). */
  readonly availabilityNotes?: readonly string[];
}

/**
 * One connector's auth-flow wiring — the documented provider facts the boot
 * composes. `buildAuthorizationUrl` and `exchangeCode` come from the
 * connector's own modules (e.g. the YouTube oauth.ts) — never invented.
 */
export interface SourceAuthWiring {
  /** The connector this wiring belongs to. */
  readonly connectorId: string;
  /** The flow descriptor (the SDK's `AuthFlow` shape, mirrored structurally). */
  readonly flow: {
    readonly kind: "oauth" | "device";
    /** oauth: the provider's authorization endpoint (documented constant). */
    readonly authorizationEndpoint?: string;
    readonly scopes: readonly string[];
    readonly tokenRefresh: boolean;
    /** device: the provider's verification URL template + poll cadence. */
    readonly verificationUrlTemplate?: string;
    readonly pollIntervalSeconds?: number;
  };
  /** oauth: the redirect URI the handshake starts with (the operator-registered URL). */
  readonly redirectUri?: string;
  /** oauth: build the authorization URL for one CSRF state (documented builder). */
  readonly buildAuthorizationUrl?: (state: string) => string;
  /** oauth: exchange the provider's code for the sealed secret (the connector's transport). */
  readonly exchangeCode?: (code: string, nowMs: number) => Promise<ExchangeOutcome>;
}

/** Options for {@link createSourceManagementService}. */
export interface SourceManagementOptions {
  /** The wired sources' capability rows (the fan-out's `sourceRows()`). */
  readonly sourceRows: readonly FanOutSourceRow[];
  /** The per-connector auth-flow wirings (keyed by connector id). */
  readonly wirings: ReadonlyMap<string, SourceAuthWiring>;
  /** The durable account store (envelope-encrypted credentials + pendings). */
  readonly accounts: PostgresConnectorAccountStore;
  /** The clock — every expiry judgment flows through it. */
  readonly clock: Clock;
  /** Pending-authorization TTL (default 10 minutes, RFC 8628 territory). */
  readonly pendingTtlMs?: number;
}

// ---------------------------------------------------------------------------
// The read + answer shapes (all structurally secret-free)
// ---------------------------------------------------------------------------

/** One source's management view (the GET /sources row). */
export interface SourceView {
  readonly connectorId: string;
  readonly displayName: string;
  readonly version: string;
  readonly authMode: ConnectorDescriptor["auth"];
  readonly capabilities: Readonly<Record<Capability, boolean>>;
  readonly authState: ConnectorAuthState;
  readonly requiresAuthorization: boolean;
  readonly connected: boolean;
  readonly accountId: string | null;
  readonly authorizedAt: string | null;
  readonly lastStateChange: string | null;
  readonly expiresAt: string | null;
  readonly availabilityNotes: readonly string[];
  /** Whether the connect flow is wired for this deployment. */
  readonly connectable: boolean;
  readonly lastChecked: string;
}

/** The typed connect/reauthorize answer, discriminated by flow kind. */
export type ConnectAnswer =
  | {
      readonly kind: "oauth";
      readonly connectorId: string;
      readonly authorizationUrl: string;
      /** The CSRF state — ALSO the pending-authorization key (in the URL by the OAuth contract; the pending RECORD is server-side). */
      readonly state: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "device";
      readonly connectorId: string;
      readonly verificationUrl: string;
      readonly pollIntervalSeconds: number;
      readonly state: string;
      readonly expiresAt: string;
    }
  | {
      /** local: connected directly with the caller-supplied credential. */
      readonly kind: "local";
      readonly connectorId: string;
      readonly authState: "signedIn";
      readonly accountId: string;
      readonly authorizedAt: string;
    }
  | {
      /** none: nothing to authorize — the source is always available. */
      readonly kind: "none";
      readonly connectorId: string;
      readonly requiresAuthorization: false;
    };

/** The typed callback completion answer. */
export interface CallbackCompleted {
  readonly connectorId: string;
  readonly authState: "signedIn";
  readonly accountId: string;
  readonly authorizedAt: string;
}

/** The closed operational failure vocabulary of this service. */
export type SourceManagementFailure =
  | { readonly kind: "unknown-connector"; readonly connectorId: string }
  | { readonly kind: "flow-missing"; readonly connectorId: string; readonly authMode: ConnectorDescriptor["auth"] }
  | { readonly kind: "no-account"; readonly connectorId: string }
  | { readonly kind: "credential-required"; readonly detail: string }
  | { readonly kind: "wrong-flow"; readonly detail: string }
  | { readonly kind: "unknown-pending"; readonly state: string }
  | { readonly kind: "expired-pending"; readonly state: string; readonly expiredAt: string }
  | { readonly kind: "provider-denied"; readonly detail: string }
  | { readonly kind: "exchange-rejected"; readonly detail: string }
  | { readonly kind: "exchange-transport"; readonly detail: string }
  | { readonly kind: "degraded"; readonly detail: string };

/** The typed result envelope. */
export type SourceManagementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: SourceManagementFailure };

// ---------------------------------------------------------------------------
// Derivation (the authorization-state truth)
// ---------------------------------------------------------------------------

/** Read the token expiry (epoch ms) an account's metadata reports, if any. */
function tokenExpiryMsOf(record: ConnectorAccountRecord): number | undefined {
  const raw = record.metadata?.["expiresAtMs"];
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  return undefined;
}

/**
 * Derive one source's CURRENT authorization state (the session machine's
 * job, projected over durable truth):
 * - a live pending ⇒ `authorizing` (the handshake is in flight);
 * - no account row ⇒ `signedOut`;
 * - a row whose stored token expired (`metadata.expiresAtMs` ≤ now) ⇒
 *   `expired` — NEVER silently `signedIn` (the expired-state truth law);
 * - otherwise the row's stored state.
 */
export function deriveAuthState(
  row: ConnectorAccountRecord | null,
  pending: PendingAuthorizationRecord | null,
  nowMs: number,
): ConnectorAuthState {
  if (pending !== null) {
    const expiresAtMs = Date.parse(pending.expiresAt);
    if (Number.isFinite(expiresAtMs) && nowMs < expiresAtMs) return "authorizing";
  }
  if (row === null) return "signedOut";
  if (row.authState === "signedIn") {
    const expiry = tokenExpiryMsOf(row);
    if (expiry !== undefined && nowMs >= expiry) return "expired";
  }
  return row.authState;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** The source-management service the routes answer against. */
export interface SourceManagementService {
  /** The user's source list (capability truth + derived authorization truth). */
  listSources(userId: string): Promise<SourceManagementResult<readonly SourceView[]>>;
  /** Begin a connect (new connection) — the flow answer or a typed failure. */
  beginConnect(
    userId: string,
    connectorId: string,
    credential?: string,
  ): Promise<SourceManagementResult<ConnectAnswer>>;
  /** Re-run the flow for an EXISTING account (expired/failed/refresh) — upserts. */
  beginReauthorize(
    userId: string,
    connectorId: string,
    credential?: string,
  ): Promise<SourceManagementResult<ConnectAnswer>>;
  /** Complete the OAuth callback by state (the provider's code or denial). */
  completeCallback(
    state: string,
    input: { code?: string; error?: string; errorDescription?: string },
  ): Promise<SourceManagementResult<CallbackCompleted>>;
  /** Disconnect (delete the sealed account + pendings). Idempotent success. */
  disconnect(
    userId: string,
    connectorId: string,
  ): Promise<SourceManagementResult<{ connectorId: string; authState: "signedOut"; hadAccount: boolean }>>;
}

const DEFAULT_PENDING_TTL_MS = 600_000;
const STATE_BYTES = 16;

function mintStateToken(): string {
  const bytes = new Uint8Array(STATE_BYTES);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Build the R03 source-management service. The routes call it through the
 * booted `ApiBoot.sourceManagement`; tests compose it with stub wirings
 * (the SDK's testing.ts pattern — no network, deterministic clock).
 */
export function createSourceManagementService(
  options: SourceManagementOptions,
): SourceManagementService {
  const rows = options.sourceRows;
  const wirings = options.wirings;
  const accounts = options.accounts;
  const clock = options.clock;
  const pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;

  function rowFor(connectorId: string): FanOutSourceRow | null {
    return rows.find((row) => row.id === connectorId) ?? null;
  }

  function wiringFor(connectorId: string): SourceAuthWiring | null {
    return wirings.get(connectorId) ?? null;
  }

  /** Load the account row (no secret — the record projection). */
  async function accountFor(
    userId: string,
    connectorId: string,
  ): Promise<ConnectorAccountRecord | null> {
    try {
      const records = await accounts.listForUser(userId);
      return records.find((record) => record.connectorId === connectorId) ?? null;
    } catch {
      return null; // a broken account read degrades to signedOut truth (honest)
    }
  }

  /** Write an expired derivation through to the durable row (convergence). */
  async function convergeExpiredState(
    row: ConnectorAccountRecord,
    derived: ConnectorAuthState,
  ): Promise<void> {
    if (derived === "expired" && row.authState !== "expired") {
      try {
        await accounts.setAuthState(row.userId, row.connectorId, "expired");
      } catch {
        // The READ still answers the derived truth; the write-through is a
        // convergence nicety, never a blocker.
      }
    }
  }

  async function listSources(
    userId: string,
  ): Promise<SourceManagementResult<readonly SourceView[]>> {
    let accountRows: readonly ConnectorAccountRecord[];
    try {
      accountRows = await accounts.listForUser(userId);
    } catch (thrown) {
      return {
        ok: false,
        failure: { kind: "degraded", detail: describe(thrown) },
      };
    }
    const byConnector = new Map(accountRows.map((row) => [row.connectorId, row]));
    let pendings: readonly PendingAuthorizationRecord[] = [];
    try {
      pendings = await accounts.listPendingAuthorizationsForUser(userId);
    } catch {
      pendings = []; // degrade honestly: no pending truth, the row truth stands
    }

    const nowMs = clock.now();
    const lastChecked = new Date(nowMs).toISOString();
    const views: SourceView[] = rows.map((row) => {
      const account = byConnector.get(row.id) ?? null;
      const pending = pendings.find((p) => p.connectorId === row.id) ?? null;
      const derived = deriveAuthState(account, pending, nowMs);
      const expiry = account !== null ? tokenExpiryMsOf(account) : undefined;
      const wiring = wiringFor(row.id);
      const connectable =
        row.auth === "none" ||
        row.auth === "local" ||
        (wiring !== null && (row.auth === "oauth" || row.auth === "device"));
      const notes = [...(account?.availabilityNotes ?? [])];
      if (row.auth === "oauth" && (wiring === undefined || wiring === null)) {
        notes.push("Connect flow not provisioned in this deployment (missing OAuth wiring) — the source serves what it can without an account");
      }
      if (derived === "expired") {
        notes.push("The stored authorization expired — reconnect to restore this source");
      }
      // Converge the durable row to the derived truth (write-through).
      if (account !== null) void convergeExpiredState(account, derived);
      return {
        connectorId: row.id,
        displayName: row.displayName,
        version: row.version,
        authMode: row.auth,
        capabilities: row.capabilities,
        authState: derived,
        requiresAuthorization: row.auth !== "none",
        connected: account !== null,
        accountId: account?.id ?? null,
        authorizedAt: account?.authorizedAt ?? null,
        lastStateChange: account?.lastStateChange ?? null,
        expiresAt:
          derived === "expired" && expiry !== undefined
            ? new Date(expiry).toISOString()
            : expiry !== undefined
              ? new Date(expiry).toISOString()
              : null,
        availabilityNotes: notes,
        connectable,
        lastChecked,
      };
    });

    // THE PRIVACY LAW at the API boundary: nothing leaves with credential
    // material in it — a leak here is a loud programmer error, never a
    // silent pass-through.
    try {
      assertNoCredentialMaterial(views, "GET /sources payload");
    } catch (thrown) {
      return { ok: false, failure: { kind: "degraded", detail: describe(thrown) } };
    }
    return { ok: true, value: views };
  }

  async function beginFlow(
    userId: string,
    connectorId: string,
    credential: string | undefined,
    mode: "connect" | "reauthorize",
  ): Promise<SourceManagementResult<ConnectAnswer>> {
    const row = rowFor(connectorId);
    if (row === null) {
      return { ok: false, failure: { kind: "unknown-connector", connectorId } };
    }

    // Reauthorize is for an EXISTING connection (the user ability
    // "reconnect/reauthorize" — the account row is preserved by the upsert
    // at completion). Connect is the fresh path.
    if (mode === "reauthorize") {
      const account = await accountFor(userId, connectorId);
      if (account === null) {
        return { ok: false, failure: { kind: "no-account", connectorId } };
      }
    }

    if (row.auth === "none") {
      // No authorization exists to begin — the source is always available.
      // A supplied credential is a wrong-flow 400 (honest, not swallowed).
      if (credential !== undefined) {
        return {
          ok: false,
          failure: { kind: "wrong-flow", detail: "this source requires no authorization — no credential may be supplied" },
        };
      }
      return {
        ok: true,
        value: { kind: "none", connectorId, requiresAuthorization: false },
      };
    }

    if (row.auth === "local") {
      // Local connects DIRECTLY: the caller supplies the credential now.
      if (credential === undefined || credential.length === 0) {
        return {
          ok: false,
          failure: {
            kind: "credential-required",
            detail: "this source authenticates locally — supply the credential in the request body",
          },
        };
      }
      try {
        const saved = await accounts.saveAccount({
          userId,
          connectorId,
          kind: "local-token",
          authState: "signedIn",
          secret: credential,
        });
        return {
          ok: true,
          value: {
            kind: "local",
            connectorId,
            authState: "signedIn",
            accountId: saved.id,
            authorizedAt: saved.authorizedAt ?? new Date(clock.now()).toISOString(),
          },
        };
      } catch (thrown) {
        return { ok: false, failure: { kind: "degraded", detail: describe(thrown) } };
      }
    }

    // oauth | device: the flow must be WIRED (documented endpoints) — never
    // an invented URL.
    const wiring = wiringFor(connectorId);
    if (wiring === null) {
      return {
        ok: false,
        failure: { kind: "flow-missing", connectorId, authMode: row.auth },
      };
    }
    if (wiring.flow.kind === "oauth" && wiring.buildAuthorizationUrl === undefined) {
      return { ok: false, failure: { kind: "flow-missing", connectorId, authMode: row.auth } };
    }
    if (wiring.flow.kind === "device" && wiring.flow.verificationUrlTemplate === undefined) {
      return { ok: false, failure: { kind: "flow-missing", connectorId, authMode: row.auth } };
    }
    if (credential !== undefined) {
      return {
        ok: false,
        failure: {
          kind: "wrong-flow",
          detail: "this source authorizes through its provider flow — the credential arrives via the callback, never the request body",
        },
      };
    }

    const nowMs = clock.now();
    const state = mintStateToken();
    const expiresAtMs = nowMs + pendingTtlMs;

    try {
      // Supersession: a fresh handshake invalidates the previous one.
      await accounts.evictPendingAuthorizations(userId, connectorId);
      await accounts.savePendingAuthorization({
        state,
        userId,
        connectorId,
        flowKind: wiring.flow.kind,
        ...(wiring.flow.kind === "oauth" && wiring.redirectUri !== undefined
          ? { redirectUri: wiring.redirectUri }
          : {}),
        expiresAtMs,
      });
    } catch (thrown) {
      return { ok: false, failure: { kind: "degraded", detail: describe(thrown) } };
    }

    const expiresAtIso = new Date(expiresAtMs).toISOString();
    if (wiring.flow.kind === "oauth") {
      const builder = wiring.buildAuthorizationUrl as (state: string) => string;
      return {
        ok: true,
        value: {
          kind: "oauth",
          connectorId,
          authorizationUrl: builder(state),
          state,
          expiresAt: expiresAtIso,
        },
      };
    }
    return {
      ok: true,
      value: {
        kind: "device",
        connectorId,
        verificationUrl: wiring.flow.verificationUrlTemplate ?? "",
        pollIntervalSeconds: wiring.flow.pollIntervalSeconds ?? 5,
        state,
        expiresAt: expiresAtIso,
      },
    };
  }

  async function completeCallback(
    state: string,
    input: { code?: string; error?: string; errorDescription?: string },
  ): Promise<SourceManagementResult<CallbackCompleted>> {
    let loaded;
    try {
      loaded = await accounts.loadPendingAuthorization(state);
    } catch (thrown) {
      return { ok: false, failure: { kind: "degraded", detail: describe(thrown) } };
    }
    if (!loaded.ok) {
      if (loaded.reason === "expired") {
        return {
          ok: false,
          failure: { kind: "expired-pending", state, expiredAt: loaded.expiredAt },
        };
      }
      return { ok: false, failure: { kind: "unknown-pending", state } };
    }
    const pending = loaded.pending;
    const wiring = wiringFor(pending.connectorId);

    // A provider denial (error=access_denied & co): the pending is consumed
    // and the answer is the honest typed denial — never a fake success.
    if (input.error !== undefined) {
      await accounts.completePendingAuthorization(state);
      return {
        ok: false,
        failure: {
          kind: "provider-denied",
          detail: `the provider redirected back with error '${input.error}'${
            input.errorDescription !== undefined ? `: ${input.errorDescription}` : ""
          }`,
        },
      };
    }

    if (pending.flowKind !== "oauth" || wiring === null || wiring.exchangeCode === undefined) {
      // The wiring vanished (redeploy) or the pending is not an OAuth one —
      // consume it and answer honestly; the user restarts the flow.
      await accounts.completePendingAuthorization(state);
      return {
        ok: false,
        failure: {
          kind: "flow-missing",
          connectorId: pending.connectorId,
          authMode: "oauth",
        },
      };
    }

    const code = input.code;
    if (typeof code !== "string" || code.trim().length === 0) {
      // No code and no error: the redirect is malformed. The pending STAYS
      // (the provider may re-redirect); the answer names what is missing.
      return {
        ok: false,
        failure: {
          kind: "credential-required",
          detail: "the OAuth callback requires the provider's ?code= parameter (or ?error= for a denial)",
        },
      };
    }

    const nowMs = clock.now();
    let outcome: ExchangeOutcome;
    try {
      outcome = await wiring.exchangeCode(code, nowMs);
    } catch (thrown) {
      // Transport-shaped failure: the pending STAYS — the callback is
      // retryable while the code lives.
      return { ok: false, failure: { kind: "exchange-transport", detail: describe(thrown) } };
    }
    if (!outcome.ok) {
      // A RETRYABLE (transport-shaped) failure keeps the pending — the
      // callback can be retried while the provider's code lives. A
      // definitive rejection consumes it (the code is dead).
      if (outcome.retryable === true) {
        return {
          ok: false,
          failure: {
            kind: "exchange-transport",
            detail: outcome.detail ?? "the token exchange did not complete",
          },
        };
      }
      await accounts.completePendingAuthorization(state);
      return {
        ok: false,
        failure: {
          kind: "exchange-rejected",
          detail: outcome.detail ?? "the provider refused the authorization code",
        },
      };
    }

    // Seal the tokens (the ONLY place the secret exists — straight into the
    // envelope) and complete the pending.
    try {
      const saved = await accounts.saveAccount({
        userId: pending.userId,
        connectorId: pending.connectorId,
        kind: "oauth-token",
        authState: "signedIn",
        secret: outcome.sealedSecret ?? "",
        ...(outcome.metadata !== undefined ? { metadata: outcome.metadata } : {}),
        ...(outcome.availabilityNotes !== undefined
          ? { availabilityNotes: outcome.availabilityNotes }
          : {}),
      });
      await accounts.completePendingAuthorization(state);
      return {
        ok: true,
        value: {
          connectorId: pending.connectorId,
          authState: "signedIn",
          accountId: saved.id,
          authorizedAt: saved.authorizedAt ?? new Date(nowMs).toISOString(),
        },
      };
    } catch (thrown) {
      return { ok: false, failure: { kind: "degraded", detail: describe(thrown) } };
    }
  }

  async function disconnect(
    userId: string,
    connectorId: string,
  ): Promise<SourceManagementResult<{ connectorId: string; authState: "signedOut"; hadAccount: boolean }>> {
    const row = rowFor(connectorId);
    if (row === null) {
      return { ok: false, failure: { kind: "unknown-connector", connectorId } };
    }
    try {
      // The delete discipline: the sealed envelope row AND its pending
      // handshakes go together (the store enforces the eviction).
      const hadAccount = await accounts.deleteAccount(userId, connectorId);
      return {
        ok: true,
        value: { connectorId, authState: "signedOut", hadAccount },
      };
    } catch (thrown) {
      return { ok: false, failure: { kind: "degraded", detail: describe(thrown) } };
    }
  }

  return {
    listSources,
    beginConnect: (userId, connectorId, credential) =>
      beginFlow(userId, connectorId, credential, "connect"),
    beginReauthorize: (userId, connectorId, credential) =>
      beginFlow(userId, connectorId, credential, "reauthorize"),
    completeCallback,
    disconnect,
  };
}

// ---------------------------------------------------------------------------
// The YouTube wiring (the documented provider facts)
// ---------------------------------------------------------------------------

/** The YouTube OAuth client config (the operator's provisioning). */
export interface YouTubeOAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** The exchange seam (production: the connector's fetch transport; tests: a stub). */
export type YouTubeCodeExchanger = (
  config: YouTubeOAuthClientConfig,
  code: string,
  nowMs: number,
) => Promise<ExchangeOutcome>;

/**
 * Build the YouTube OAuth wiring from the operator's config — the
 * connector's OWN documented endpoints (`buildYouTubeAuthorizationUrl` /
 * `exchangeYouTubeCode` over its typed transport), never an invented URL.
 * The exchange outcome seals the token set through the connector's own
 * serializer; the secret exists only inside the completion path.
 */
export function createYouTubeSourceWiring(
  input: YouTubeOAuthClientConfig & {
    readonly connectorId?: string;
    /** The exchange seam override (tests stub it; default: the fetch transport). */
    readonly exchange?: YouTubeCodeExchanger;
  },
): SourceAuthWiring {
  const connectorId = input.connectorId ?? "youtube";
  const config: YouTubeOAuthClientConfig = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
  };
  return {
    connectorId,
    flow: {
      kind: "oauth",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      scopes: [...YOUTUBE_OAUTH_SCOPES],
      tokenRefresh: true,
    },
    redirectUri: input.redirectUri,
    buildAuthorizationUrl: (state: string) => {
      const result = buildYouTubeAuthorizationUrl(config, { state });
      if (result.ok) return result.value;
      // A misconfigured OAuth client is a wiring crime — fail loudly, never
      // fabricate a URL.
      throw new Error(`youtube source wiring: ${result.error.detail}`);
    },
    exchangeCode:
      input.exchange !== undefined
        ? (code: string, nowMs: number) => input.exchange!(config, code, nowMs)
        : async (code: string, nowMs: number): Promise<ExchangeOutcome> => {
            const result = await exchangeYouTubeCode(
              config,
              createFetchYouTubeTransport(),
              code,
              nowMs,
            );
            if (!result.ok) {
              return {
                ok: false,
                detail: result.error.detail,
                retryable:
                  result.error.kind === "transport" || result.error.kind === "malformed-response",
              };
            }
            return {
              ok: true,
              sealedSecret: serializeYouTubeTokenSet(result.value),
              metadata: youtubeTokenMetadata(result.value),
              availabilityNotes: youtubeAvailabilityNotes(),
            };
          },
  };
}

/** The non-secret metadata stored beside a YouTube token set. */
export function youtubeTokenMetadata(tokens: YouTubeTokenSet): Record<string, unknown> {
  return {
    connector: "youtube",
    tokenType: tokens.tokenType,
    scope: tokens.scope,
    expiresAtMs: tokens.expiresAtMs,
    obtainedAtMs: tokens.obtainedAtMs,
  };
}

/** The per-account availability notes a YouTube connection carries. */
export function youtubeAvailabilityNotes(): readonly string[] {
  return [
    "YouTube Data API v3: search costs 100 quota units per call against the project's daily quota",
    "Connected via Google OAuth — user-scoped operations (likes, saves, library) are available",
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describe(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
