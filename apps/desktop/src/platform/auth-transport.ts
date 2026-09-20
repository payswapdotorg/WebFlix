/**
 * @wfx/app-desktop — the Desktop account/source transport (R22-H).
 *
 * THE DESKTOP TWIN of the web adapter's `auth-transport.ts` (R21-B): the
 * typed client of the Experience API's account + source-management
 * endpoints, consumed from the Desktop adapter — identical endpoints,
 * IDENTICAL payload guards, the same closed failure family — bound to the
 * R22-B shared seams (`AccountRegistrationPort`) and the R22-H first-run
 * surface. NO second authentication system: the service owns identity;
 * this transport only maps its documented routes:
 *
 * | Operation              | HTTP                                    | Body / auth                        |
 * |------------------------|-----------------------------------------|------------------------------------|
 * | `register`             | `POST {base}/auth/register`             | `{ email, password, displayName? }`|
 * | `login`                | `POST {base}/auth/login`                | `{ email, password }`              |
 * | `readSession`          | `GET  {base}/auth/me`                   | `Authorization: Bearer <token>`    |
 * | `logout`               | `POST {base}/auth/logout`               | `Authorization: Bearer <token>`    |
 * | `selectProfile`        | `PUT  {base}/profiles/:id/select`       | `Authorization: Bearer <token>`    |
 * | `readSources`          | `GET  {base}/sources`                   | `Authorization: Bearer <token>`    |
 * | `beginConnect`         | `POST {base}/sources/:id/connect`       | `{ credential? }` + bearer         |
 * | `beginReauthorize`     | `POST {base}/sources/:id/reauthorize`   | `{ credential? }` + bearer         |
 * | `disconnectSource`     | `POST {base}/sources/:id/disconnect`    | bearer                             |
 *
 * LAWS (the web transport's family, verbatim):
 *
 * - TYPED FAILURES — every operation answers `DesktopAuthResult`; the
 *   failure kinds are closed (the `AuthFailureKind` family) and map onto
 *   the R22-B `AccountCreationFailureKind` for the register path
 *   (`email-taken` verbatim; 400 ⇒ `invalid-input`; transport loss ⇒
 *   `network`; 5xx/408/429 ⇒ `unavailable`; non-usable payload ⇒
 *   `malformed`). Never a silent failure, never a fake session.
 * - THE TOKEN IS A SECRET — it rides the `Authorization` header ONLY,
 *   never a URL, never a rendered payload, never a log line. The
 *   Desktop's storage law for it is the OS keychain
 *   (`auth-session-store.ts` over the shell's keychain area).
 * - SECRETS NEVER COME BACK — every session view crossing this boundary
 *   passes the R22-B structural guards (`isUsableAccountSessionView` /
 *   `isUsableSourceInfo`); a row carrying password or key material is a
 *   `malformed` failure, never domain data.
 * - NO FABRICATED SOURCES — the `GET /sources` envelope's rows are the
 *   ONLY source truth (the server's `{ authenticated, sources }` law);
 *   the transport filters structurally-unusable rows out and never
 *   invents a connector.
 *
 * Determinism: no clock, no randomness; `fetch` is injectable (tests
 * stub it and run offline) — the same discipline as the server-port.
 */

import type { ModelPolicy, ModelTask } from "@wfx/domain";
import { isIso8601, isRecord } from "@wfx/domain";

import type {
  AccountRegistrationPort,
  AccountSessionView,
  ByomBindingCommand,
  ByomBindingHandle,
  IssuedAccountSession,
  ModelPolicyCommand,
  ModelProviderInfo,
  NormalizedRegisterAccountCommand,
  ServerFailureKind,
  SourceInfo,
} from "@wfx/client-runtime";
import {
  accountCreationFailure,
  isUsableAccountSessionView,
  isUsableModelProviderRow,
  isUsableSourceInfo,
} from "@wfx/client-runtime";

// ---------------------------------------------------------------------------
// The typed failure channel (the web transport's closed family, verbatim)
// ---------------------------------------------------------------------------

/** The closed Desktop auth-transport failure vocabulary. */
export type DesktopAuthFailureKind =
  | "network"
  | "unauthorized"
  | "invalid-credentials"
  | "email-taken"
  | "invalid-input"
  | "unavailable"
  | "malformed"
  | "not-found";

/** One typed Desktop auth failure. */
export interface DesktopAuthFailure {
  readonly kind: DesktopAuthFailureKind;
  /** Non-empty human-readable detail (what exactly failed). */
  readonly detail: string;
}

/** The result envelope of every Desktop auth operation. */
export type DesktopAuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DesktopAuthFailure };

// ---------------------------------------------------------------------------
// The wire shapes (the service's documented answer DTOs — structurally
// validated before anything becomes domain data)
// ---------------------------------------------------------------------------

/** `GET /sources` answer: the anonymous/session envelope. */
interface SourcesEnvelopeDto {
  readonly authenticated: boolean;
  readonly sources: readonly SourceInfo[];
}

/**
 * The typed connect/reauthorize answer (the service's `ConnectAnswer`,
 * discriminated by flow kind — structurally validated here so a garbage
 * answer is a `malformed` failure, never a fabricated flow).
 */
export type DesktopConnectAnswer =
  | {
      readonly kind: "oauth";
      readonly connectorId: string;
      readonly authorizationUrl: string;
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
      readonly kind: "local";
      readonly connectorId: string;
      readonly authState: "signedIn";
      readonly accountId: string;
      readonly authorizedAt: string;
    }
  | {
      readonly kind: "none";
      readonly connectorId: string;
      readonly requiresAuthorization: false;
    };

/** `POST /sources/:id/disconnect` answer. */
export interface DesktopDisconnectView {
  readonly connectorId: string;
  readonly authState: "signedOut";
  readonly hadAccount: boolean;
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

/** The login input (the wire body `POST /auth/login` takes). */
export interface DesktopLoginInput {
  readonly email: string;
  readonly password: string;
}

/** Options for the transport (the injectable seams — the R08 discipline). */
export interface DesktopAuthTransportOptions {
  /** The validated base URL of the Experience API (`WFX_API_BASE`). */
  readonly apiBase: URL;
  /** The fetch implementation (default: the global `fetch`; tests inject a stub). */
  readonly fetchImpl?: FetchLike;
  /** Per-request timeout in milliseconds (default 10 000; `0` disables). */
  readonly timeoutMs?: number;
}

/** The narrow fetch seam the transport consumes (the server-port's law). */
export type DesktopAuthFetchLike = FetchLike;

/** One observed request (tests assert the header/URL discipline). */
export interface DesktopAuthRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly bearer: boolean;
  readonly body: string | undefined;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RequestOutcome {
  readonly ok: boolean;
  readonly status: number;
  readonly value: unknown;
  readonly failure: DesktopAuthFailure | null;
}

/**
 * The Desktop account/source transport. Constructed by the composition
 * root (or tests); every operation is a pure round trip over the
 * documented endpoints with the typed failure mapping.
 */
export interface DesktopAuthTransport {
  /** The observed request log (the header/URL discipline is test-pinned). */
  readonly requests: readonly DesktopAuthRequestRecord[];
  /** Create the account: `POST /auth/register` → the auto-logged-in session. */
  register(command: NormalizedRegisterAccountCommand): Promise<DesktopAuthResult<IssuedAccountSession>>;
  /** Sign in: `POST /auth/login` → the issued session. */
  login(input: DesktopLoginInput): Promise<DesktopAuthResult<IssuedAccountSession>>;
  /** Read the authenticated session: `GET /auth/me` (the continuity probe). */
  readSession(token: string): Promise<DesktopAuthResult<AccountSessionView>>;
  /** Sign out: `POST /auth/logout` (revokes the token). */
  logout(token: string): Promise<DesktopAuthResult<{ revoked: boolean }>>;
  /** Switch the active profile: `PUT /profiles/:id/select`. */
  selectProfile(token: string, profileId: string): Promise<DesktopAuthResult<AccountSessionView>>;
  /**
   * The session-scoped source-management truth: `GET /sources`. The
   * anonymous transition answers the honest `{ authenticated: false,
   * sources: [] }` envelope — never a fabricated list.
   */
  readSources(token: string): Promise<DesktopAuthResult<SourcesEnvelopeDto>>;
  /** Begin a connect: `POST /sources/:id/connect` (the flow answer). */
  beginConnect(
    token: string,
    connectorId: string,
    credential?: string,
  ): Promise<DesktopAuthResult<DesktopConnectAnswer>>;
  /** Re-run the flow for an existing connection: `POST /sources/:id/reauthorize`. */
  beginReauthorize(
    token: string,
    connectorId: string,
    credential?: string,
  ): Promise<DesktopAuthResult<DesktopConnectAnswer>>;
  /** Disconnect: `POST /sources/:id/disconnect` (idempotent success). */
  disconnectSource(token: string, connectorId: string): Promise<DesktopAuthResult<DesktopDisconnectView>>;
  // — the model-management routes (R22-I: the account's provider/policy truth) —
  /** The provider registry (session-scoped: the account's BYOM rows + first-party): `GET /experience/model-providers`. */
  readModelProviders(token: string): Promise<DesktopAuthResult<readonly ModelProviderInfo[]>>;
  /** One task's stored policy (the honest null when unset): `GET /experience/model-policy?task=`. */
  readModelPolicy(token: string, task: ModelTask): Promise<DesktopAuthResult<ModelPolicy | null>>;
  /** Write one task's policy: `PUT /experience/model-policy`. */
  writeModelPolicy(token: string, command: ModelPolicyCommand): Promise<DesktopAuthResult<void>>;
  /** Store a BYOM binding (the key sealed server-side; the answer is the secret-free handle): `PUT /experience/model-providers/byom/:providerId`. */
  bindByomProvider(token: string, command: ByomBindingCommand): Promise<DesktopAuthResult<ByomBindingHandle>>;
  /** DELETE one BYOM binding (the vault's delete discipline). */
  unbindByomProvider(token: string, providerId: string): Promise<DesktopAuthResult<void>>;
}

function failureOf(kind: DesktopAuthFailureKind, detail: string): DesktopAuthFailure {
  return { kind, detail };
}

/** The R22-B mapping: the transport's failure onto the journey's vocabulary. */
function accountCreationFailureOf(failure: DesktopAuthFailure): ReturnType<typeof accountCreationFailure> {
  const kind =
    failure.kind === "email-taken"
      ? "email-taken"
      : failure.kind === "invalid-input"
        ? "invalid-input"
        : failure.kind === "network"
          ? "network"
          : failure.kind === "unavailable"
            ? "unavailable"
            : "malformed";
  const detail =
    kind === "email-taken"
      ? "An account with this email already exists."
      : kind === "invalid-input"
        ? failure.detail
        : kind === "network"
          ? "WebFlix couldn't reach the service."
          : kind === "unavailable"
            ? "The service can't create accounts right now."
            : "The service answered unexpectedly — no account was created.";
  // The shared R22-B derivation owns the recovery vocabulary (the parity
  // law — this adapter never forks it).
  return accountCreationFailure(kind, detail);
}

/** Validate one claimed issued-session DTO (the structural secret law). */
function issuedSessionOf(value: unknown, what: string): DesktopAuthResult<IssuedAccountSession> {
  if (!isRecord(value)) {
    return { ok: false, failure: failureOf("malformed", `${what} answered a non-object payload`) };
  }
  const token = value.token;
  if (typeof token !== "string" || token.length === 0) {
    return {
      ok: false,
      failure: failureOf("malformed", `${what} answered a payload without the session token truth`),
    };
  }
  if (!isUsableAccountSessionView(value.session)) {
    return {
      ok: false,
      failure: failureOf("malformed", `${what} answered a non-usable session view (the guard rejects secret material)`),
    };
  }
  return { ok: true, value: { token, session: value.session } };
}

function sessionViewOf(value: unknown, what: string): DesktopAuthResult<AccountSessionView> {
  if (!isUsableAccountSessionView(value)) {
    return {
      ok: false,
      failure: failureOf("malformed", `${what} answered a non-usable session view (the guard rejects secret material)`),
    };
  }
  return { ok: true, value };
}

/** Validate one claimed connect answer (a garbage answer is malformed). */
function connectAnswerOf(value: unknown, what: string): DesktopAuthResult<DesktopConnectAnswer> {
  if (!isRecord(value)) {
    return { ok: false, failure: failureOf("malformed", `${what} answered a non-object payload`) };
  }
  switch (value.kind) {
    case "oauth":
      if (
        typeof value.authorizationUrl !== "string" ||
        !/^https?:\/\//i.test(value.authorizationUrl) ||
        typeof value.state !== "string" ||
        value.state.length === 0 ||
        typeof value.expiresAt !== "string"
      ) {
        return {
          ok: false,
          failure: failureOf("malformed", `${what} answered an oauth flow without its url/state/expiry truth`),
        };
      }
      return {
        ok: true,
        value: {
          kind: "oauth",
          connectorId: typeof value.connectorId === "string" ? value.connectorId : "",
          authorizationUrl: value.authorizationUrl,
          state: value.state,
          expiresAt: value.expiresAt,
        },
      };
    case "device":
      if (
        typeof value.verificationUrl !== "string" ||
        value.verificationUrl.length === 0 ||
        typeof value.state !== "string" ||
        value.state.length === 0 ||
        typeof value.expiresAt !== "string" ||
        typeof value.pollIntervalSeconds !== "number" ||
        !Number.isFinite(value.pollIntervalSeconds) ||
        value.pollIntervalSeconds <= 0
      ) {
        return {
          ok: false,
          failure: failureOf("malformed", `${what} answered a device flow without its url/cadence/expiry truth`),
        };
      }
      return {
        ok: true,
        value: {
          kind: "device",
          connectorId: typeof value.connectorId === "string" ? value.connectorId : "",
          verificationUrl: value.verificationUrl,
          pollIntervalSeconds: value.pollIntervalSeconds,
          state: value.state,
          expiresAt: value.expiresAt,
        },
      };
    case "local":
      if (
        value.authState !== "signedIn" ||
        typeof value.accountId !== "string" ||
        value.accountId.length === 0 ||
        typeof value.authorizedAt !== "string"
      ) {
        return {
          ok: false,
          failure: failureOf("malformed", `${what} answered a local-flow completion without its account truth`),
        };
      }
      return {
        ok: true,
        value: {
          kind: "local",
          connectorId: typeof value.connectorId === "string" ? value.connectorId : "",
          authState: "signedIn",
          accountId: value.accountId,
          authorizedAt: value.authorizedAt,
        },
      };
    case "none":
      return {
        ok: true,
        value: {
          kind: "none",
          connectorId: typeof value.connectorId === "string" ? value.connectorId : "",
          requiresAuthorization: false,
        },
      };
    default:
      return {
        ok: false,
        failure: failureOf("malformed", `${what} answered an unknown connect-flow kind '${String(value.kind)}'`),
      };
  }
}

/**
 * Create the Desktop account/source transport over the documented
 * endpoints. Pure round trips: no clock, no ids, no state beyond the
 * request log the tests pin the discipline with.
 */
export function createDesktopAuthTransport(
  options: DesktopAuthTransportOptions,
): DesktopAuthTransport {
  const base = options.apiBase;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const requests: DesktopAuthRequestRecord[] = [];

  function endpoint(path: string, query?: URLSearchParams): string {
    const url = new URL(`${base.pathname === "/" ? "" : base.pathname}${path}`, base);
    if (query !== undefined) {
      for (const [key, value] of query.entries()) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async function request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    token: string | null,
    body?: string,
    query?: URLSearchParams,
  ): Promise<RequestOutcome> {
    const url = endpoint(path, query);
    requests.push({
      method,
      url,
      bearer: token !== null,
      body,
    });
    const headers: Record<string, string> = { accept: "application/json" };
    if (token !== null) headers["authorization"] = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (timeoutMs > 0) init.signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (thrown) {
      const name = thrown instanceof Error ? thrown.name : "unknown";
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return {
        ok: false,
        status: 0,
        value: null,
        failure: failureOf("network", `${method} ${url} did not complete (${name}: ${message})`),
      };
    }
    if (!response.ok) {
      const kind: DesktopAuthFailureKind =
        response.status === 409
          ? "email-taken"
          : response.status === 400
            ? "invalid-input"
            : response.status === 401 || response.status === 403
              ? "unauthorized"
              : response.status === 404
                ? "not-found"
                : response.status >= 500 || response.status === 408 || response.status === 429
                  ? "unavailable"
                  : "malformed";
      let detail = `${method} ${url} answered ${response.status}`;
      const text = await response.text().catch(() => "");
      if (text.length > 0) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (isRecord(parsed) && typeof parsed.error === "string") {
            detail = `${detail}: ${parsed.error}`;
            if (typeof parsed.detail === "string" && parsed.detail.length > 0) {
              detail = `${detail} — ${parsed.detail}`;
            }
          }
        } catch {
          detail = `${detail}: ${text.slice(0, 200)}`;
        }
      }
      return { ok: false, status: response.status, value: null, failure: failureOf(kind, detail) };
    }
    if (response.status === 204) {
      return { ok: true, status: response.status, value: undefined, failure: null };
    }
    const text = await response.text().catch(() => "");
    if (text.length === 0) {
      return { ok: true, status: response.status, value: undefined, failure: null };
    }
    try {
      return { ok: true, status: response.status, value: JSON.parse(text), failure: null };
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      return {
        ok: false,
        status: response.status,
        value: null,
        failure: failureOf("malformed", `${method} ${url} answered non-JSON (${message})`),
      };
    }
  }

  function requireToken(token: string): DesktopAuthFailure | null {
    if (typeof token !== "string" || token.length === 0) {
      return failureOf("invalid-input", "token: expected a non-empty session token");
    }
    return null;
  }

  return {
    requests,

    async register(command) {
      const outcome = await request("POST", "/auth/register", null, JSON.stringify(command));
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return issuedSessionOf(outcome.value, "POST /auth/register");
    },

    async login(input) {
      const outcome = await request("POST", "/auth/login", null, JSON.stringify(input));
      if (!outcome.ok) {
        // The anti-enumeration law: login 401 is invalid-credentials (the
        // same honest answer for unknown email and wrong password).
        if (outcome.failure?.kind === "unauthorized") {
          return {
            ok: false,
            failure: failureOf("invalid-credentials", "email or password is incorrect"),
          };
        }
        return { ok: false, failure: outcome.failure! };
      }
      return issuedSessionOf(outcome.value, "POST /auth/login");
    },

    async readSession(token) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request("GET", "/auth/me", token);
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return sessionViewOf(outcome.value, "GET /auth/me");
    },

    async logout(token) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request("POST", "/auth/logout", token, JSON.stringify({}));
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      if (!isRecord(outcome.value) || typeof outcome.value.revoked !== "boolean") {
        return {
          ok: false,
          failure: failureOf("malformed", "POST /auth/logout answered a payload without the revoked truth"),
        };
      }
      return { ok: true, value: { revoked: outcome.value.revoked } };
    },

    async selectProfile(token, profileId) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      if (typeof profileId !== "string" || profileId.length === 0) {
        return {
          ok: false,
          failure: failureOf("invalid-input", "profileId: expected a non-empty profile id"),
        };
      }
      const outcome = await request(
        "PUT",
        `/profiles/${encodeURIComponent(profileId)}/select`,
        token,
        JSON.stringify({}),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return sessionViewOf(outcome.value, "PUT /profiles/:id/select");
    },

    async readSources(token) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request("GET", "/sources", token);
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      if (!isRecord(outcome.value)) {
        return {
          ok: false,
          failure: failureOf("malformed", "GET /sources answered a non-object payload (expected the { authenticated, sources } envelope)"),
        };
      }
      const authenticated = outcome.value.authenticated;
      const sources = outcome.value.sources;
      if (typeof authenticated !== "boolean" || !Array.isArray(sources)) {
        return {
          ok: false,
          failure: failureOf("malformed", "GET /sources answered an envelope without the authenticated/sources truth"),
        };
      }
      const usable = sources.filter((source): source is SourceInfo => isUsableSourceInfo(source));
      return { ok: true, value: { authenticated, sources: usable } };
    },

    async beginConnect(token, connectorId, credential) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const body = credential !== undefined ? JSON.stringify({ credential }) : undefined;
      const outcome = await request(
        "POST",
        `/sources/${encodeURIComponent(connectorId)}/connect`,
        token,
        body,
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return connectAnswerOf(outcome.value, "POST /sources/:id/connect");
    },

    async beginReauthorize(token, connectorId, credential) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const body = credential !== undefined ? JSON.stringify({ credential }) : undefined;
      const outcome = await request(
        "POST",
        `/sources/${encodeURIComponent(connectorId)}/reauthorize`,
        token,
        body,
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return connectAnswerOf(outcome.value, "POST /sources/:id/reauthorize");
    },

    async disconnectSource(token, connectorId) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request(
        "POST",
        `/sources/${encodeURIComponent(connectorId)}/disconnect`,
        token,
        JSON.stringify({}),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      if (
        !isRecord(outcome.value) ||
        outcome.value.authState !== "signedOut" ||
        typeof outcome.value.hadAccount !== "boolean"
      ) {
        return {
          ok: false,
          failure: failureOf("malformed", "POST /sources/:id/disconnect answered a payload without the disconnect truth"),
        };
      }
      return {
        ok: true,
        value: {
          connectorId: typeof outcome.value.connectorId === "string" ? outcome.value.connectorId : connectorId,
          authState: "signedOut",
          hadAccount: outcome.value.hadAccount,
        },
      };
    },

    async readModelProviders(token) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request("GET", "/experience/model-providers", token);
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      if (!Array.isArray(outcome.value)) {
        return {
          ok: false,
          failure: failureOf("malformed", "GET /experience/model-providers answered a non-array payload"),
        };
      }
      // The R22-C structural guard (the shared parity law — garbage rows
      // never become provider entries, and rows carrying key material are
      // rejected outright).
      const usable = outcome.value.filter((row): row is ModelProviderInfo => isUsableModelProviderRow(row));
      return { ok: true, value: usable };
    },

    async readModelPolicy(token, task) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request(
        "GET",
        "/experience/model-policy",
        token,
        undefined,
        new URLSearchParams({ task }),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      if (outcome.value === null || outcome.value === undefined) {
        return { ok: true, value: null };
      }
      if (!isUsableModelPolicy(outcome.value)) {
        return {
          ok: false,
          failure: failureOf(
            "malformed",
            `GET /experience/model-policy answered a malformed ModelPolicy (task '${task}')`,
          ),
        };
      }
      return { ok: true, value: outcome.value };
    },

    async writeModelPolicy(token, command) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request(
        "PUT",
        "/experience/model-policy",
        token,
        JSON.stringify(command),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return { ok: true, value: undefined };
    },

    async bindByomProvider(token, command) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request(
        "PUT",
        `/experience/model-providers/byom/${encodeURIComponent(command.providerId)}`,
        token,
        JSON.stringify({
          endpointUrl: command.endpointUrl,
          key: command.key,
          ...(command.metadata !== undefined ? { metadata: command.metadata } : {}),
          ...(command.capabilities !== undefined ? { capabilities: command.capabilities } : {}),
          ...(command.costPerCall !== undefined ? { costPerCall: command.costPerCall } : {}),
        }),
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      if (!isUsableByomHandle(outcome.value)) {
        return {
          ok: false,
          failure: failureOf(
            "malformed",
            "PUT /experience/model-providers/byom answered a malformed binding handle",
          ),
        };
      }
      return { ok: true, value: outcome.value };
    },

    async unbindByomProvider(token, providerId) {
      const invalid = requireToken(token);
      if (invalid !== null) return { ok: false, failure: invalid };
      const outcome = await request(
        "DELETE",
        `/experience/model-providers/byom/${encodeURIComponent(providerId)}`,
        token,
      );
      if (!outcome.ok) return { ok: false, failure: outcome.failure! };
      return { ok: true, value: undefined };
    },
  };
}

// ---------------------------------------------------------------------------
// The R22-B port binding (the EXISTING transport, typed — no second system)
// ---------------------------------------------------------------------------

/**
 * Bind the Desktop transport's register operation onto the shared
 * `AccountRegistrationPort` (the R22-B seam `createAccountCreationJourney`
 * consumes). The failure mapping is the R22-B law: `email-taken` verbatim,
 * 400 ⇒ `invalid-input`, transport loss ⇒ `network`, 5xx/408/429 ⇒
 * `unavailable`, non-usable payload ⇒ `malformed` — the SAME mapping the
 * Web adapter applies (the parity law).
 */
export function createDesktopAccountRegistrationPort(
  transport: DesktopAuthTransport,
): AccountRegistrationPort {
  return {
    async register(command) {
      const outcome = await transport.register(command);
      if (!outcome.ok) {
        return { ok: false, failure: accountCreationFailureOf(outcome.failure) };
      }
      return { ok: true, value: outcome.value };
    },
  };
}

/** Re-export the runtime's failure-kind check for consumers/tests. */
export { isUsableAccountSessionView as isUsableDesktopAuthSessionView };

// ---------------------------------------------------------------------------
// The model-route transport guards (the frozen shapes)
// ---------------------------------------------------------------------------

/** The frozen ModelTask mirror (the transport guard's membership list). */
const MODEL_TASKS: readonly string[] = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
];

const MODEL_PRIVACIES: readonly string[] = ["local-only", "trusted-cloud", "any-cloud"];

/** Transport guard for one usable `ModelPolicy` (the frozen shape). */
function isUsableModelPolicy(value: unknown): value is ModelPolicy {
  if (!isRecord(value)) return false;
  if (!MODEL_TASKS.includes(value.task as ModelTask)) return false;
  if (value.preferredProvider !== undefined && typeof value.preferredProvider !== "string") {
    return false;
  }
  if (
    !Array.isArray(value.fallbackProviders) ||
    !value.fallbackProviders.every((provider) => typeof provider === "string" && provider.length > 0)
  ) {
    return false;
  }
  if (!MODEL_PRIVACIES.includes(value.privacy as ModelPolicy["privacy"])) return false;
  if (
    value.maxCostPerOperation !== undefined &&
    (typeof value.maxCostPerOperation !== "number" ||
      !Number.isFinite(value.maxCostPerOperation) ||
      value.maxCostPerOperation < 0)
  ) {
    return false;
  }
  return true;
}

/** Transport guard for one usable BYOM binding handle (secret-free). */
function isUsableByomHandle(value: unknown): value is ByomBindingHandle {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.providerId !== "string" || value.providerId.length === 0) return false;
  if (typeof value.endpointUrl !== "string" || value.endpointUrl.length === 0) return false;
  if (typeof value.keyId !== "string" || value.keyId.length === 0) return false;
  if (value.metadata !== null && !isRecord(value.metadata)) return false;
  if (typeof value.createdAt !== "string" || !isIso8601(value.createdAt)) return false;
  if (typeof value.updatedAt !== "string" || !isIso8601(value.updatedAt)) return false;
  return true;
}

/** Narrow a transport failure onto the ServerPort family (diagnostics). */
export function serverFailureKindOf(failure: DesktopAuthFailure): ServerFailureKind {
  switch (failure.kind) {
    case "network":
      return "network";
    case "unauthorized":
      return "unauthorized";
    case "not-found":
    case "unavailable":
      return "unavailable";
    default:
      return "malformed";
  }
}
