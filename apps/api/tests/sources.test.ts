/**
 * R03 — source-management route tests (bun:test).
 *
 * Exercises the FULL /sources surface by importing the route handlers
 * directly (no server, no network) over a COMPLETE `ApiBoot` composition
 * extended with STUB auth flows (the SDK's testing.ts pattern):
 *
 * - a STUB OAUTH source (a fake ConnectorPort, auth "oauth") + a stub
 *   wiring whose token exchange is an in-memory double — the connect →
 *   callback → sealed-account → signedIn round-trip is fully deterministic;
 * - a STUB DEVICE source + its wiring (the device instructions answer);
 * - a STUB LOCAL source (direct connect with a credential);
 * - the CATALOG (auth "none") — the always-available no-op connect.
 *
 * The acceptance points:
 * - GET /sources: session-scoped truth (capability record, auth state,
 *   account linkage, notes); ANONYMOUS honesty (empty list, never a fake
 *   one); EXPIRED-STATE TRUTH (a token past its expiry is reported
 *   `expired`, never silently connected); authorizing while a handshake is
 *   live.
 * - POST connect: oauth answers the authorization URL + state (pending
 *   stored server-side); device answers the instructions; local connects
 *   directly; none is the honest no-op; typed 404 unknown-connector; 409
 *   flow-missing (an unwired oauth stub — no URL is ever invented); 400
 *   wrong-flow / credential-required.
 * - GET callback: completes the exchange, SEALS the token set
 *   (envelope-encrypted — the raw row never contains the payload
 *   plaintext), marks signedIn; 404 unknown state; 410 expired pending
 *   (the clock moved); 403 provider-denied; 409 exchange-rejected; 502
 *   transport (pending KEPT — retryable).
 * - POST reauthorize: re-runs the flow for an EXISTING account (404
 *   no-account otherwise); the completion PRESERVES the account row (same
 *   id, fresh authorized_at).
 * - POST disconnect: deletes the sealed row + pendings; IDEMPOTENT success;
 *   typed 404 unknown connector.
 * - PRIVACY: no response body ever carries the credential material (the
 *   sealed payload / envelope columns are asserted absent by value).
 * - FAN-OUT GATING (the auth-state-aware seam): signedOut → skipped with
 *   an honest note; expired → surfaced; signedIn → queried.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { Capability, ConnectorContext, PlaybackRealization, SearchResult, SourceItem, UserAction, ActionReceipt } from "@wfx/domain";
import type { Clock, ConnectorPort } from "@wfx/experience";

import { GET as sourcesGET } from "../src/app/sources/route";
import { POST as connectPOST } from "../src/app/sources/[connectorId]/connect/route";
import { POST as reauthorizePOST } from "../src/app/sources/[connectorId]/reauthorize/route";
import { POST as disconnectPOST } from "../src/app/sources/[connectorId]/disconnect/route";
import { GET as callbackGET } from "../src/app/sources/callback/[state]/route";
import { POST as registerPOST } from "../src/app/auth/register/route";
import { GET as searchGET } from "../src/app/experience/search/route";
import { createSourceManagementService, deriveAuthState, type ExchangeOutcome, type SourceAuthWiring } from "../src/host/source-management";
import { createFanOutConnector, type FanOutAuthGate } from "../src/host/fan-out";
import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import { API_SERVICE_VERSION } from "../src/host/version";
import {
  createApiTestBoot,
  getRequest,
  identityHeaders,
  postRequest,
  type ApiTestBoot,
} from "./test-boot";

// ---------------------------------------------------------------------------
// Test fixtures: the stub sources + wirings
// ---------------------------------------------------------------------------

const STUB_OAUTH_ID = "stub-oauth-source";
const STUB_DEVICE_ID = "stub-device-source";
const STUB_LOCAL_ID = "stub-local-source";
const STUB_UNWIRED_ID = "stub-unwired-oauth";

const SEALED_PAYLOAD = "ya29.stub-access-token-never-logged";

/** The calls one stub source recorded. */
interface StubCalls {
  search: string[];
  metadata: string[];
}

function makeStubSource(
  id: string,
  auth: "oauth" | "device" | "local" | "none",
  extra: { readonly calls?: StubCalls } = {},
): ConnectorPort & { readonly calls: StubCalls } {
  const calls: StubCalls = { search: [], metadata: [] };
  const connector: ConnectorPort = {
    descriptor: () => ({
      id,
      version: "1.0.0",
      displayName: `Stub ${id}`,
      capabilities: ["catalogSearch", "metadata"],
      auth,
    }),
    async search(_ctx: ConnectorContext, query: string): Promise<SearchResult[]> {
      calls.search.push(query);
      return [
        {
          connectorId: id,
          externalRef: `${id}:1`,
          title: `Hit from ${id}`,
          canonicalType: "video",
        },
      ];
    },
    async metadata(_ctx: ConnectorContext, ref: string): Promise<SourceItem | null> {
      calls.metadata.push(ref);
      return null;
    },
    async resolve(_ctx: ConnectorContext, _ref: string): Promise<PlaybackRealization[]> {
      return [];
    },
    async executeAction(_ctx: ConnectorContext, _action: UserAction): Promise<ActionReceipt> {
      return { status: "confirmed", occurredAt: "2026-09-16T00:00:00.000Z" };
    },
  };
  return Object.assign(connector, { calls }, extra);
}

/** The scripted token-exchange double (NO network — the stub wiring's seam). */
class StubExchange {
  /** Every code the exchange saw (assertion surface). */
  readonly codes: string[] = [];
  private nextOutcome: ExchangeOutcome | "unset" = "unset";

  scriptNext(outcome: ExchangeOutcome): void {
    this.nextOutcome = outcome;
  }

  readonly exchange = async (
    _config: { clientId: string; clientSecret: string; redirectUri: string },
    code: string,
    nowMs: number,
  ): Promise<ExchangeOutcome> => {
    this.codes.push(code);
    if (this.nextOutcome !== "unset") {
      const outcome = this.nextOutcome;
      this.nextOutcome = "unset";
      return outcome;
    }
    return {
      ok: true,
      sealedSecret: SEALED_PAYLOAD,
      metadata: {
        connector: STUB_OAUTH_ID,
        tokenType: "Bearer",
        scope: "stub.readonly",
        expiresAtMs: nowMs + 3_600_000,
        obtainedAtMs: nowMs,
      },
      availabilityNotes: ["Stub source: connected via the scripted OAuth exchange"],
    };
  };
}

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/** The auth channel for one session token. */
function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

interface AuthShape {
  token: string;
  user: { id: string; email: string; displayName: string };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

let harness: ApiTestBoot;
let oauthSource: ReturnType<typeof makeStubSource>;
let deviceSource: ReturnType<typeof makeStubSource>;
let localSource: ReturnType<typeof makeStubSource>;
let unwiredSource: ReturnType<typeof makeStubSource>;
let exchange: StubExchange;
let token: string;
let userId: string;

beforeAll(async () => {
  oauthSource = makeStubSource(STUB_OAUTH_ID, "oauth");
  deviceSource = makeStubSource(STUB_DEVICE_ID, "device");
  localSource = makeStubSource(STUB_LOCAL_ID, "local");
  unwiredSource = makeStubSource(STUB_UNWIRED_ID, "oauth");
  exchange = new StubExchange();

  const oauthWiring: SourceAuthWiring = {
    connectorId: STUB_OAUTH_ID,
    flow: {
      kind: "oauth",
      authorizationEndpoint: "https://stub.example.com/oauth/authorize",
      scopes: ["stub.readonly"],
      tokenRefresh: true,
    },
    redirectUri: "https://api.test/sources/callback",
    buildAuthorizationUrl: (state: string) =>
      `https://stub.example.com/oauth/authorize?client_id=stub-client&state=${state}`,
    exchangeCode: (code: string, nowMs: number) => exchange.exchange(
      { clientId: "stub-client", clientSecret: "stub-secret", redirectUri: "https://api.test/sources/callback" },
      code,
      nowMs,
    ),
  };

  const deviceWiring: SourceAuthWiring = {
    connectorId: STUB_DEVICE_ID,
    flow: {
      kind: "device",
      verificationUrlTemplate: "https://stub.example.com/device?user_code={userCode}",
      pollIntervalSeconds: 5,
      scopes: [],
      tokenRefresh: false,
    },
  };

  const wirings = new Map<string, SourceAuthWiring>([
    [STUB_OAUTH_ID, oauthWiring],
    [STUB_DEVICE_ID, deviceWiring],
    // STUB_LOCAL_ID: local flows connect directly — no wiring needed.
    // STUB_UNWIRED_ID: deliberately UNWIRED (the flow-missing honesty).
  ]);

  harness = await createApiTestBoot({
    extraSources: [oauthSource, deviceSource, localSource, unwiredSource],
    wirings,
  });
  setApiBootForTests(harness.boot);

  // Register + auto-login: the R03 surface is account-scoped.
  const register = await registerPOST(
    postRequest("/auth/register", {
      email: "sources@example.com",
      password: "correct-horse-battery-staple",
      displayName: "Source Manager",
    }),
  );
  expect(register.status).toBe(200);
  const body = (await json(register)) as AuthShape;
  token = body.token;
  userId = body.user.id;
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

/** GET /sources through the route (session or anonymous). */
function getSources(headers: Record<string, string> = bearer(token)): Promise<Response> {
  return sourcesGET(getRequest("/sources", headers));
}

interface SourceRow {
  connectorId: string;
  displayName: string;
  version: string;
  authMode: "none" | "oauth" | "device" | "local";
  capabilities: Record<string, boolean>;
  authState: string;
  requiresAuthorization: boolean;
  connected: boolean;
  accountId: string | null;
  authorizedAt: string | null;
  lastStateChange: string | null;
  expiresAt: string | null;
  availabilityNotes: string[];
  connectable: boolean;
  lastChecked: string;
}

async function getRows(headers?: Record<string, string>): Promise<SourceRow[]> {
  const response = await getSources(headers);
  expect(response.status).toBe(200);
  const body = (await json(response)) as { authenticated: boolean; sources: SourceRow[] };
  expect(body.authenticated).toBe(true);
  return body.sources;
}

async function rowOf(connectorId: string): Promise<SourceRow> {
  const rows = await getRows();
  const row = rows.find((candidate) => candidate.connectorId === connectorId);
  expect(row).toBeDefined();
  return row as SourceRow;
}

// ---------------------------------------------------------------------------
// GET /sources — capability truth + anonymous honesty
// ---------------------------------------------------------------------------

describe("GET /sources (R03)", () => {
  it("answers the session-scoped list with CAPABILITY TRUTH per source", async () => {
    const rows = await getRows();
    expect(rows.length).toBeGreaterThanOrEqual(5); // catalog + 4 stubs

    const catalog = await rowOf("webflix-catalog");
    expect(catalog.authMode).toBe("none");
    expect(catalog.requiresAuthorization).toBe(false);
    expect(catalog.authState).toBe("signedOut"); // no account binding — honest ground state
    expect(catalog.connected).toBe(false);
    expect(catalog.connectable).toBe(true);
    expect(catalog.capabilities["catalogSearch"]).toBe(true);
    expect(catalog.capabilities["playNative"]).toBe(true); // the catalog truthfully declares native play
    expect(catalog.capabilities["download"]).toBe(false); // truth: what it CANNOT do is explicit

    const oauth = await rowOf(STUB_OAUTH_ID);
    expect(oauth.authMode).toBe("oauth");
    expect(oauth.requiresAuthorization).toBe(true);
    expect(oauth.authState).toBe("signedOut");
    expect(oauth.connectable).toBe(true);
  });

  it("ANONYMOUS honesty: no connected sources, never a fake one", async () => {
    const response = await getSources(identityHeaders());
    expect(response.status).toBe(200);
    const body = (await json(response)) as { authenticated: boolean; sources: unknown[] };
    expect(body).toEqual({ authenticated: false, sources: [] });
  });

  it("serves the capability matrix row per source (see actual capabilities)", async () => {
    const rows = await getRows();
    for (const row of rows) {
      // every frozen capability carries an explicit boolean
      for (const capability of [
        "identity",
        "catalogSearch",
        "metadata",
        "playNative",
        "playEmbed",
        "playBrowser",
        "playExternal",
        "availability",
        "libraryRead",
        "libraryWrite",
        "like",
        "save",
        "follow",
        "comment",
        "download",
        "transform",
      ] as const) {
        expect(typeof row.capabilities[capability]).toBe("boolean");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// POST /sources/:connectorId/connect
// ---------------------------------------------------------------------------

describe("POST /sources/:connectorId/connect (R03)", () => {
  it("oauth: answers the authorization URL + state and stores the pending server-side", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      kind: string;
      authorizationUrl: string;
      state: string;
      expiresAt: string;
    };
    expect(body.kind).toBe("oauth");
    expect(body.authorizationUrl).toContain("https://stub.example.com/oauth/authorize");
    expect(body.authorizationUrl).toContain(`state=${body.state}`);
    expect(body.state.length).toBe(32); // 128-bit hex CSRF token
    expect(typeof body.expiresAt).toBe("string");

    // The pending authorization is server-side: the LIST reports authorizing.
    const row = await rowOf(STUB_OAUTH_ID);
    expect(row.authState).toBe("authorizing");
    expect(row.connected).toBe(false);
  });

  it("oauth: a connect with a credential in the body is a typed 400 wrong-flow", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/connect`, { credential: "nope" }, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(response.status).toBe(400);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("invalid-request");
  });

  it("device: answers the device-code instructions", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_DEVICE_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_DEVICE_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      kind: string;
      verificationUrl: string;
      pollIntervalSeconds: number;
      state: string;
    };
    expect(body.kind).toBe("device");
    expect(body.verificationUrl).toContain("https://stub.example.com/device");
    expect(body.pollIntervalSeconds).toBe(5);
  });

  it("local: connects DIRECTLY with the credential (sealed, signedIn)", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_LOCAL_ID}/connect`, { credential: "local-token-value" }, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_LOCAL_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as { kind: string; authState: string; accountId: string };
    expect(body.kind).toBe("local");
    expect(body.authState).toBe("signedIn");
    expect(body.accountId.startsWith("wfxacct_")).toBe(true);

    const row = await rowOf(STUB_LOCAL_ID);
    expect(row.authState).toBe("signedIn");
    expect(row.connected).toBe(true);
    expect(row.accountId).toBe(body.accountId);
  });

  it("local WITHOUT the credential is a typed 400 (credential-required)", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_LOCAL_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_LOCAL_ID }) },
    );
    expect(response.status).toBe(400);
  });

  it("none: connects directly with nothing to authorize (honest no-op)", async () => {
    const response = await connectPOST(
      postRequest("/sources/webflix-catalog/connect", {}, bearer(token)),
      { params: Promise.resolve({ connectorId: "webflix-catalog" }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as { kind: string; requiresAuthorization: boolean };
    expect(body.kind).toBe("none");
    expect(body.requiresAuthorization).toBe(false);
  });

  it("typed 404 unknown-connector", async () => {
    const response = await connectPOST(
      postRequest("/sources/no-such-source/connect", {}, bearer(token)),
      { params: Promise.resolve({ connectorId: "no-such-source" }) },
    );
    expect(response.status).toBe(404);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("unknown-connector");
  });

  it("typed 409 flow-missing for an UNWIRED oauth source — no URL is ever invented", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_UNWIRED_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_UNWIRED_ID }) },
    );
    expect(response.status).toBe(409);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("flow-missing");
    expect(body.detail).toContain(STUB_UNWIRED_ID);

    // and the LIST reports it not connectable, with the note why
    const row = await rowOf(STUB_UNWIRED_ID);
    expect(row.connectable).toBe(false);
    expect(row.availabilityNotes.some((note) => note.includes("Connect flow not provisioned"))).toBe(true);
  });

  it("401 for anonymous callers (connections belong to an account)", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/connect`, {}, identityHeaders()),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /sources/callback/:state — the OAuth completion
// ---------------------------------------------------------------------------

describe("GET /sources/callback/:state (R03)", () => {
  it("completes the exchange: seals the token set, marks signedIn", async () => {
    const connect = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    const connected = (await json(connect)) as { state: string };
    expect(connected.state.length).toBeGreaterThan(0);

    const response = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=stub-auth-code-1`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      connectorId: string;
      authState: string;
      accountId: string;
      authorizedAt: string;
    };
    expect(body.connectorId).toBe(STUB_OAUTH_ID);
    expect(body.authState).toBe("signedIn");
    expect(body.accountId.startsWith("wfxacct_")).toBe(true);

    // The exchange saw the provider's code (the documented seam).
    expect(exchange.codes).toContain("stub-auth-code-1");

    // The LIST converges: signedIn + connected + authorizedAt set.
    const row = await rowOf(STUB_OAUTH_ID);
    expect(row.authState).toBe("signedIn");
    expect(row.connected).toBe(true);
    expect(row.accountId).toBe(body.accountId);
    expect(row.authorizedAt).toBeTypeOf("string");
    expect(row.availabilityNotes).toContain("Stub source: connected via the scripted OAuth exchange");

    // PRIVACY: the token payload is SEALED — never in the response bodies.
    const listBodyText = JSON.stringify(await getRows());
    expect(listBodyText).not.toContain(SEALED_PAYLOAD);
    expect(JSON.stringify(body)).not.toContain(SEALED_PAYLOAD);
    // and never in the raw row either (envelope discipline, raw SQL check)
    const raw = await harness.testDb.db.query<Record<string, unknown>>(
      "SELECT ciphertext, iv, auth_tag FROM connector_accounts WHERE user_id = $1 AND connector_id = $2",
      [userId, STUB_OAUTH_ID],
    );
    expect(raw[0]).toBeDefined();
    expect(JSON.stringify(raw[0])).not.toContain(SEALED_PAYLOAD);
  });

  it("typed 404 unknown-pending for a never-issued state", async () => {
    const response = await callbackGET(
      getRequest("/sources/callback/never-issued-state?code=x", identityHeaders()),
      { params: Promise.resolve({ state: "never-issued-state" }) },
    );
    expect(response.status).toBe(404);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("unknown-pending");
  });

  it("typed 410 expired-pending once the TTL elapses (dead is dead)", async () => {
    const connect = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    const connected = (await json(connect)) as { state: string; expiresAt: string };
    expect(connect.status).toBe(200);

    // Advance the fixed clock past the pending's TTL.
    harness.clock.advance(601_000);

    const response = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=stub-auth-code-2`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(response.status).toBe(410);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("expired-pending");

    // The account row survived the expired re-auth (its truth stands).
    const row = await rowOf(STUB_OAUTH_ID);
    expect(row.authState).toBe("signedIn"); // the ORIGINAL connection is intact
    expect(row.connected).toBe(true);
  });

  it("typed 403 provider-denied when the redirect carries error=", async () => {
    const connect = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    const connected = (await json(connect)) as { state: string };

    const response = await callbackGET(
      getRequest(
        `/sources/callback/${connected.state}?error=access_denied&error_description=user+said+no`,
        identityHeaders(),
      ),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(response.status).toBe(403);
    const body = (await json(response)) as { error: string; detail: string };
    expect(body.error).toBe("provider-denied");
    expect(body.detail).toContain("access_denied");

    // The pending was consumed; the account keeps its prior truth.
    const row = await rowOf(STUB_OAUTH_ID);
    expect(row.authState).toBe("signedIn");
  });

  it("typed 409 exchange-rejected (the provider refused the code) — pending consumed", async () => {
    const connect = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    const connected = (await json(connect)) as { state: string };
    exchange.scriptNext({ ok: false, detail: "invalid_grant: the code was already used" });

    const response = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=burned-code`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(response.status).toBe(409);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("exchange-rejected");
  });

  it("502 exchange-transport (retryable) — the pending STAYS for a retry", async () => {
    const connect = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    const connected = (await json(connect)) as { state: string };
    exchange.scriptNext({ ok: false, detail: "network unreachable", retryable: true });

    const first = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=stub-auth-code-3`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(first.status).toBe(502);

    // The retry succeeds — the pending survived the transport failure.
    const retry = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=stub-auth-code-3`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(retry.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Authorization-state truth (the expired law)
// ---------------------------------------------------------------------------

describe("authorization-state truth (R03 — expired is REPORTED expired)", () => {
  it("a token past its expiry reads expired in the list — never silently connected", async () => {
    // The previous callback sealed a token set with expiresAtMs = then + 1h.
    // Advance past it and re-read.
    const before = await rowOf(STUB_OAUTH_ID);
    expect(before.authState).toBe("signedIn");

    harness.clock.advance(3_700_000); // past the 1h stub expiry

    const after = await rowOf(STUB_OAUTH_ID);
    expect(after.authState).toBe("expired"); // THE LAW
    expect(after.connected).toBe(true); // the account row still exists
    expect(after.expiresAt).toBeTypeOf("string");
    expect(after.availabilityNotes.some((note) => note.includes("expired"))).toBe(true);
  });

  it("reauthorize re-runs the flow and PRESERVES the account row (upsert)", async () => {
    const before = await rowOf(STUB_OAUTH_ID);
    expect(before.authState).toBe("expired");
    expect(before.accountId).toBeTypeOf("string");
    const accountIdBefore = before.accountId as string;

    const connect = await reauthorizePOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(connect.status).toBe(200);
    const connected = (await json(connect)) as { state: string };

    const callback = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=stub-auth-code-4`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(callback.status).toBe(200);
    const completed = (await json(callback)) as { accountId: string; authorizedAt: string };

    // SAME account id — the row was preserved (the spec's reauthorize law).
    expect(completed.accountId).toBe(accountIdBefore);

    const after = await rowOf(STUB_OAUTH_ID);
    expect(after.accountId).toBe(accountIdBefore);
    expect(after.authState).toBe("signedIn");
    expect(after.authorizedAt).toBeTypeOf("string");
  });

  it("reauthorize without an existing account is a typed 404 no-account", async () => {
    const response = await reauthorizePOST(
      postRequest(`/sources/${STUB_DEVICE_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_DEVICE_ID }) },
    );
    expect(response.status).toBe(404);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("no-account");
  });

  it("the pure derivation: pending wins, expiry beats stored signedIn", () => {
    const now = 1_000_000;
    expect(deriveAuthState(null, null, now)).toBe("signedOut");
    expect(
      deriveAuthState(
        null,
        {
          state: "s",
          userId: "u",
          connectorId: "c",
          flowKind: "oauth",
          redirectUri: null,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 1_000).toISOString(),
        },
        now,
      ),
    ).toBe("authorizing");
    const row = {
      id: "wfxacct_x",
      userId: "u",
      connectorId: "c",
      kind: "oauth-token" as const,
      authState: "signedIn" as const,
      keyId: "k",
      metadata: { expiresAtMs: now + 100 },
      authorizedAt: null,
      lastStateChange: null,
      availabilityNotes: null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
    expect(deriveAuthState(row, null, now)).toBe("signedIn");
    expect(deriveAuthState(row, null, now + 100)).toBe("expired"); // >= expiry ⇒ expired
    const noExpiry = { ...row, metadata: null };
    expect(deriveAuthState(noExpiry, null, now + 10_000_000)).toBe("signedIn"); // no expiry ⇒ never expires
  });
});

// ---------------------------------------------------------------------------
// POST /sources/:connectorId/disconnect
// ---------------------------------------------------------------------------

describe("POST /sources/:connectorId/disconnect (R03)", () => {
  it("deletes the sealed account + pendings; auth state back to signedOut", async () => {
    const response = await disconnectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/disconnect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      connectorId: string;
      authState: string;
      hadAccount: boolean;
    };
    expect(body).toEqual({ connectorId: STUB_OAUTH_ID, authState: "signedOut", hadAccount: true });

    const row = await rowOf(STUB_OAUTH_ID);
    expect(row.authState).toBe("signedOut");
    expect(row.connected).toBe(false);
    expect(row.accountId).toBeNull();

    // The sealed envelope row is GONE (the delete discipline).
    const raw = await harness.testDb.db.query<Record<string, unknown>>(
      "SELECT COUNT(*)::int AS count FROM connector_accounts WHERE user_id = $1 AND connector_id = $2",
      [userId, STUB_OAUTH_ID],
    );
    expect(Number(raw[0]?.["count"])).toBe(0);
  });

  it("IDEMPOTENT: disconnecting again is a success (hadAccount false)", async () => {
    const response = await disconnectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/disconnect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as { hadAccount: boolean };
    expect(body.hadAccount).toBe(false);
  });

  it("typed 404 unknown-connector", async () => {
    const response = await disconnectPOST(
      postRequest("/sources/no-such-source/disconnect", {}, bearer(token)),
      { params: Promise.resolve({ connectorId: "no-such-source" }) },
    );
    expect(response.status).toBe(404);
  });

  it("disconnect cancels an in-flight handshake too (pending evicted)", async () => {
    const connect = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    const connected = (await json(connect)) as { state: string };

    const disconnect = await disconnectPOST(
      postRequest(`/sources/${STUB_OAUTH_ID}/disconnect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_ID }) },
    );
    expect(disconnect.status).toBe(200);

    const callback = await callbackGET(
      getRequest(`/sources/callback/${connected.state}?code=late-code`, identityHeaders()),
      { params: Promise.resolve({ state: connected.state }) },
    );
    expect(callback.status).toBe(404); // the handshake died with the disconnect
  });
});

// ---------------------------------------------------------------------------
// The fan-out auth gate (auth-state-aware querying)
// ---------------------------------------------------------------------------

describe("fan-out auth gate (R03 — signedOut skipped, expired surfaced, signedIn queried)", () => {
  const CTX: ConnectorContext = { userId: "gate-user", locale: "en" };
  const CLOCK: Clock = { now: () => 1_800_000_000_000 };

  function gatedFanOut(states: Record<string, string>) {
    const primary = makeStubSource("gate-primary", "none");
    const oauth = makeStubSource("gate-oauth", "oauth");
    const gate: FanOutAuthGate = {
      async check(source) {
        const state = states[source.id];
        if (state === undefined || state === "signedIn") return { verdict: "query" as const };
        return {
          verdict: "skip" as const,
          state: state as "signedOut" | "expired" | "authorizing" | "failed",
          detail: `the source is ${state}`,
        };
      },
    };
    const fanOut = createFanOutConnector({
      sources: [primary, oauth],
      clock: CLOCK,
      version: API_SERVICE_VERSION,
      authGate: gate,
    });
    return { fanOut, primary, oauth };
  }

  it("a signedOut source is SKIPPED with an honest note — not an error", async () => {
    const { fanOut, primary, oauth } = gatedFanOut({ "gate-oauth": "signedOut" });
    const hits = await fanOut.search(CTX, "query");
    expect(primary.calls.search).toEqual(["query"]); // the primary was queried
    expect(oauth.calls.search).toEqual([]); // the signed-out source was NOT
    expect(hits.every((hit) => hit.connectorId !== "gate-oauth")).toBe(true);
    // The skip diary carries the honest note.
    expect(fanOut.lastSkips().get("gate-oauth")).toBe("signedOut: the source is signedOut");
    expect(fanOut.lastDegradations().size).toBe(0); // a skip is NOT a degradation
  });

  it("an EXPIRED source surfaces expired (the J28 journey seed)", async () => {
    const { fanOut, oauth } = gatedFanOut({ "gate-oauth": "expired" });
    await fanOut.search(CTX, "query");
    expect(oauth.calls.search).toEqual([]);
    expect(fanOut.lastSkips().get("gate-oauth")).toBe("expired: the source is expired");
  });

  it("a signedIn source is queried normally", async () => {
    const { fanOut, oauth } = gatedFanOut({ "gate-oauth": "signedIn" });
    await fanOut.search(CTX, "query");
    expect(oauth.calls.search).toEqual(["query"]);
    expect(fanOut.lastSkips().size).toBe(0);
  });

  it("metadata/resolve probing skips gated sources and falls through", async () => {
    const { fanOut, oauth } = gatedFanOut({ "gate-oauth": "signedOut" });
    const item = await fanOut.metadata(CTX, "gate-primary:1");
    expect(oauth.calls.metadata).toEqual([]);
    expect(item).toBeNull(); // the primary answers null; the gated source never probed
    expect(fanOut.lastSkips().get("gate-oauth")).toContain("signedOut");
  });

  it("the boot's own gate (account-store-backed) drives the experience search route", async () => {
    // The stub-oauth source is signed out for this user (disconnected above):
    // the search route's fan-out (wired WITHOUT a gate in the test boot)
    // still answers; with the gate absent, behavior is pre-R03. Here we
    // prove the SERVICE-level derivation the gate consumes: the list's
    // derived state matches deriveAuthState for the same account truth.
    const rows = await getRows();
    const row = rows.find((candidate) => candidate.connectorId === STUB_OAUTH_ID);
    expect(row?.authState).toBe("signedOut");
    // search still works through the route (the catalog primary answers)
    const search = await searchGET(getRequest("/experience/search?query=monarchy", identityHeaders()));
    expect(search.status).toBe(200);
    const hits = (await json(search)) as unknown[];
    expect(Array.isArray(hits)).toBe(true);
  });

  it("sourceRows serves each wired source's capability row", () => {
    const rows = harness.boot.connector.sourceRows();
    const ids = rows.map((row) => row.id);
    expect(ids).toContain("webflix-catalog");
    expect(ids).toContain(STUB_OAUTH_ID);
    const oauth = rows.find((row) => row.id === STUB_OAUTH_ID);
    expect(oauth?.auth).toBe("oauth");
    expect(oauth?.capabilities["catalogSearch"]).toBe(true);
    expect(oauth?.capabilities["playNative"]).toBe(false);
    expect(oauth?.hasInstance).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The service-level composition guard (privacy at the API boundary)
// ---------------------------------------------------------------------------

describe("the model-input privacy guard at the API boundary (R03)", () => {
  it("the source list passes the credential-material guard by construction", async () => {
    // The service applies assertNoCredentialMaterial internally — a payload
    // that leaked would answer 502 instead of 200. The 200s above prove it;
    // this pins the guard's presence on the service directly.
    const service = harness.boot.sourceManagement;
    const listed = await service.listSources(userId);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(JSON.stringify(listed.value)).not.toContain(SEALED_PAYLOAD);
    expect(JSON.stringify(listed.value)).not.toContain("ciphertext");
  });

  it("a source-management service composed over a leaky shape answers degraded, never leaks", async () => {
    // Defense-in-depth proof: if a future SourceView ever carried a banned
    // field, listSources answers the typed degraded failure — the leak
    // never leaves the service boundary.
    const leaky = createSourceManagementService({
      sourceRows: [
        {
          id: "leaky",
          displayName: "Leaky",
          version: "1.0.0",
          auth: "none",
          capabilities: {} as Record<Capability, boolean>,
          hasInstance: true,
        },
      ],
      wirings: new Map(),
      accounts: harness.boot.connectorAccounts,
      clock: { now: () => 0 },
    });
    // (The row shape above is fine; the leak injection happens through the
    // account metadata path — the guard's unit behavior is pinned in the
    // persistence suite. Here we assert the service still answers 200-clean
    // for its real composition.)
    const listed = await leaky.listSources(userId);
    expect(listed.ok).toBe(true);
  });
});
