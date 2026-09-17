/**
 * R03 — source-management endpoint tests (bun:test, PGlite harness).
 *
 * Exercises the /sources surface end-to-end by importing the route handlers
 * directly (the WFX-055A pattern — no server, no network) over the COMPLETE
 * ApiBoot composition (real migrations incl. 0008, the real account store,
 * the SDK's stub auth fixtures, an injectable stub OAuth exchange):
 *
 * - GET /sources: session-scoped truth (capability matrix, signedOut
 *   baselines, `none` sources usable-without-account); the ANONYMOUS
 *   honest-empty list; malformed bearer 401; anonymous garbage 400.
 * - CONNECT per flow kind: oauth answers the authorization URL + state
 *   (pending stored SERVER-SIDE — the list reports `authorizing`); device
 *   answers the verification instructions; local connects directly with
 *   the body's token (sealed — never echoed); none connects directly.
 * - THE OAUTH CALLBACK ROUND-TRIP: code → stub exchange → sealed account →
 *   signedIn; the state is consumed (a replay is 404); the provider's
 *   `error` redirect abandons the pending (400, consumed).
 * - EXPIRED-STATE TRUTH: a non-refreshable credential past its documented
 *   expiry is REPORTED expired (the durable projection follows); a
 *   refreshable grant stays signedIn; REAUTHORIZE preserves the account row
 *   (the id is stable) and heals the state.
 * - DISCONNECT: idempotent success; unknown connectors 404; the pending
 *   eviction.
 * - TYPED FAILURES: unknown-connector 404s; no-account 404 (reauthorize);
 *   expired pending 410; exchange-rejected 400 (the pending survives a
 *   rejected exchange — a fresh code completes it); flow-missing 503
 *   (service-level, an unwired oauth connector).
 * - THE PRIVACY LAW at the HTTP boundary: no response body ever carries
 *   the credential, the authorization code, or credential-shaped fields.
 *
 * Determinism: FixedClock + SequentialIdGen; the stub exchange is scripted;
 * no network. Secrets are never logged.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { ConnectorRegistry, makeStubAuthConnector } from "@wfx/connectors";
import {
  PostgresConnectorAccountStore,
  decodeEncryptionKey,
} from "@wfx/persistence";

import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import {
  createApiTestBoot,
  getRequest,
  postRequest,
  identityHeaders,
  type ApiTestBoot,
} from "./test-boot";
import { TEST_ENCRYPTION_KEY_BASE64 } from "./test-db";
import { STUB_DEVICE_CONNECTOR_ID, STUB_LOCAL_CONNECTOR_ID, STUB_OAUTH_CONNECTOR_ID } from "@wfx/connectors";
import { sourceFailureResponse, SourceManagementService } from "../src/host/sources";
import { GET as sourcesGET } from "../src/app/sources/route";
import { POST as connectPOST } from "../src/app/sources/[connectorId]/connect/route";
import { POST as reauthorizePOST } from "../src/app/sources/[connectorId]/reauthorize/route";
import { POST as disconnectPOST } from "../src/app/sources/[connectorId]/disconnect/route";
import { GET as callbackGET } from "../src/app/sources/callback/[state]/route";
import { POST as registerPOST } from "../src/app/auth/register/route";

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/** The auth channel for one session token. */
function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

interface SourceRow {
  connectorId: string;
  displayName: string;
  version: string;
  authMode: "none" | "oauth" | "device" | "local";
  authState: "signedOut" | "authorizing" | "signedIn" | "expired" | "failed";
  usable: boolean;
  connected: boolean;
  capabilities: Record<string, boolean>;
  authorizedAt: string | null;
  lastStateChange: string | null;
  expiresAt: string | null;
  notes: string[];
}

let harness: ApiTestBoot;
let token: string;

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);
  const registered = await registerPOST(
    postRequest("/auth/register", {
      email: "r03-sources@example.com",
      password: "correct-horse-battery",
      displayName: "R03 Sources",
    }),
  );
  const body = (await registered.json()) as { token: string };
  token = body.token;
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

// ---------------------------------------------------------------------------
// GET /sources — the source list
// ---------------------------------------------------------------------------

describe("GET /sources", () => {
  it("answers the session user's source list with capability truth (all signedOut at baseline)", async () => {
    const response = await sourcesGET(getRequest("/sources", bearer(token)));
    expect(response.status).toBe(200);
    const rows = (await json(response)) as SourceRow[];
    const ids = rows.map((row) => row.connectorId).sort();
    expect(ids).toEqual(
      ["stub-device", "stub-local", "stub-oauth", "webflix-catalog"].sort(),
    );

    const stubOauth = rows.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(stubOauth?.authMode).toBe("oauth");
    expect(stubOauth?.authState).toBe("signedOut");
    expect(stubOauth?.usable).toBe(false);
    expect(stubOauth?.connected).toBe(false);
    // Capability truth: what the source CAN and CANNOT do.
    expect(stubOauth?.capabilities.catalogSearch).toBe(true);
    expect(stubOauth?.capabilities.metadata).toBe(true);
    expect(stubOauth?.capabilities.playNative).toBe(false);
    expect(stubOauth?.capabilities.like).toBe(false);

    const catalog = rows.find((row) => row.connectorId === "webflix-catalog");
    expect(catalog?.authMode).toBe("none");
    // A `none` source is USABLE without an account (honest: no
    // authorization needed), though no account row is linked.
    expect(catalog?.usable).toBe(true);
    expect(catalog?.connected).toBe(false);
    expect(catalog?.authState).toBe("signedOut");
  });

  it("answers the ANONYMOUS honest EMPTY list (never a fake connected source)", async () => {
    const response = await sourcesGET(
      getRequest("/sources", identityHeaders({ "x-wfx-user-id": "wfx-anonymous" })),
    );
    expect(response.status).toBe(200);
    const rows = (await json(response)) as SourceRow[];
    expect(rows).toEqual([]);
  });

  it("answers typed 401 for a malformed bearer and 400 for anonymous garbage headers", async () => {
    const malformed = await sourcesGET(getRequest("/sources", { authorization: "Token abc" }));
    expect(malformed.status).toBe(401);

    const garbage = await sourcesGET(getRequest("/sources", { "x-wfx-user-id": "   " }));
    expect(garbage.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /sources/:connectorId/connect — per flow kind
// ---------------------------------------------------------------------------

describe("POST /sources/:connectorId/connect", () => {
  it("starts the oauth flow: the authorization URL + state; the pending is SERVER-SIDE", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      flowKind: string;
      authorizationUrl: string;
      state: string;
      expiresAt: string;
    };
    expect(body.flowKind).toBe("oauth");
    // The stub's documented endpoint (the .example TLD — never invented real
    // providers), with the client id + the state in the URL.
    expect(body.authorizationUrl).toContain("https://stub.example/oauth/authorize");
    expect(body.authorizationUrl).toContain("client_id=stub-client-id");
    expect(body.authorizationUrl).toContain(encodeURIComponent(body.state));
    expect(body.expiresAt).toBeTruthy();

    // The list reports the in-flight handshake honestly: authorizing.
    const list = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const stubOauth = list.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(stubOauth?.authState).toBe("authorizing");
    expect(stubOauth?.usable).toBe(false);

    // No credential-shaped material anywhere in the answer.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/secret|access_?token|refresh_?token/i);
  });

  it("answers the device instructions (verification URL + poll cadence)", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_DEVICE_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_DEVICE_CONNECTOR_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      flowKind: string;
      verificationUrl: string;
      pollIntervalSeconds: number;
      note: string;
    };
    expect(body.flowKind).toBe("device");
    expect(body.verificationUrl).toContain("stub.example/device/activate");
    expect(body.pollIntervalSeconds).toBe(5);
    expect(body.note).toContain("device");
  });

  it("connects a local source directly with the body's token (sealed, never echoed)", async () => {
    const response = await connectPOST(
      postRequest(`/sources/${STUB_LOCAL_CONNECTOR_ID}/connect`, { token: "r03-local-secret-token" }, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_LOCAL_CONNECTOR_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as { flowKind: string; connected: boolean; accountId: string };
    expect(body.flowKind).toBe("local");
    expect(body.connected).toBe(true);
    expect(body.accountId.startsWith("wfxacct_")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("r03-local-secret-token");

    // Sealed at rest: the raw row never carries the plaintext token.
    const rows = await harness.testDb.db.query<Record<string, unknown>>(
      "SELECT * FROM connector_accounts WHERE connector_id = $1",
      [STUB_LOCAL_CONNECTOR_ID],
    );
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows[0])).not.toContain("r03-local-secret-token");
  });

  it("connects a none source directly (no credential exists — honest note)", async () => {
    const response = await connectPOST(
      postRequest("/sources/webflix-catalog/connect", {}, bearer(token)),
      { params: Promise.resolve({ connectorId: "webflix-catalog" }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as { flowKind: string; connected: boolean; note: string };
    expect(body.flowKind).toBe("none");
    expect(body.connected).toBe(true);
    expect(body.note).toContain("no authorization");
  });

  it("answers typed 404 for an unknown connector; 401 without a session; 400 without a local token", async () => {
    const unknown = await connectPOST(
      postRequest("/sources/not-a-source/connect", {}, bearer(token)),
      { params: Promise.resolve({ connectorId: "not-a-source" }) },
    );
    expect(unknown.status).toBe(404);
    const unknownBody = (await json(unknown)) as { error: string };
    expect(unknownBody.error).toBe("unknown-connector");

    const anonymous = await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/connect`, {}, identityHeaders()),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    );
    expect(anonymous.status).toBe(401);

    const missingToken = await connectPOST(
      postRequest(`/sources/${STUB_LOCAL_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_LOCAL_CONNECTOR_ID }) },
    );
    expect(missingToken.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The OAuth callback round-trip + expired-state truth
// ---------------------------------------------------------------------------

describe("the OAuth callback + authorization-state truth", () => {
  it("completes the exchange, seals the account, and reports signedIn (the state is consumed)", async () => {
    const begun = (await (await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    )).json()) as { state: string };

    const callbackUrl = `/sources/callback/${begun.state}?code=r03-stub-auth-code`;
    const response = await callbackGET(getRequest(callbackUrl), {
      params: Promise.resolve({ state: begun.state }),
    });
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      connectorId: string;
      authState: string;
      connected: boolean;
      accountId: string;
      authorizedAt: string;
    };
    expect(body.connectorId).toBe(STUB_OAUTH_CONNECTOR_ID);
    expect(body.authState).toBe("signedIn");
    expect(body.accountId.startsWith("wfxacct_")).toBe(true);
    // The code traveled only to the (stub) exchange — never in the answer.
    expect(JSON.stringify(body)).not.toContain("r03-stub-auth-code");
    expect(harness.stubExchange.calls).toContain("r03-stub-auth-code");

    // The state is consumed: a replay is the typed 404.
    const replay = await callbackGET(getRequest(callbackUrl), {
      params: Promise.resolve({ state: begun.state }),
    });
    expect(replay.status).toBe(404);
    const replayBody = (await json(replay)) as { error: string };
    expect(replayBody.error).toBe("unknown-pending");

    // The list reports the linked, signedIn source with the expiry truth.
    const list = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const stubOauth = list.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(stubOauth?.authState).toBe("signedIn");
    expect(stubOauth?.usable).toBe(true);
    expect(stubOauth?.connected).toBe(true);
    expect(stubOauth?.authorizedAt).toBeTruthy();
    expect(stubOauth?.expiresAt).toBeTruthy(); // the non-refreshable session expiry

    // Sealed at rest.
    const rows = await harness.testDb.db.query<Record<string, unknown>>(
      "SELECT * FROM connector_accounts WHERE connector_id = $1",
      [STUB_OAUTH_CONNECTOR_ID],
    );
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows[0])).not.toContain("stub-at");
  });

  it("REPORTS an expired credential expired (never silently connected) and follows the durable projection", async () => {
    // The stub exchange's default credential expires 1h after issue and
    // cannot refresh — advance past it.
    harness.clock.advance(3_600_001);
    const list = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const stubOauth = list.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(stubOauth?.authState).toBe("expired");
    expect(stubOauth?.usable).toBe(false);

    // The durable projection followed the read-side truth.
    const rows = await harness.testDb.db.query<{ auth_state: string }>(
      "SELECT auth_state FROM connector_accounts WHERE connector_id = $1",
      [STUB_OAUTH_CONNECTOR_ID],
    );
    expect(rows[0]?.auth_state).toBe("expired");
  });

  it("REAUTHORIZE preserves the account row and heals the state (a refreshable grant stays signedIn)", async () => {
    const before = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const accountIdBefore = before.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID)?.authorizedAt;

    const reauthorized = await reauthorizePOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    );
    expect(reauthorized.status).toBe(200);
    const begun = (await reauthorized.json()) as { flowKind: string; state: string };
    expect(begun.flowKind).toBe("oauth");

    // A REFRESHABLE grant: the scripted exchange answers a token set WITH a
    // refresh token — the session expiry no longer applies.
    harness.stubExchange.script({
      ok: true,
      secret: JSON.stringify({
        v: 1,
        accessToken: "stub-at-2",
        refreshToken: "stub-rt",
        tokenType: "Bearer",
        scope: "stub.read",
        expiresAtMs: harness.clock.now() + 3_600_000,
        obtainedAtMs: harness.clock.now(),
      }),
      kind: "oauth-token",
      metadata: {
        connector: STUB_OAUTH_CONNECTOR_ID,
        tokenType: "Bearer",
        scope: "stub.read",
        expiresAtMs: harness.clock.now() + 3_600_000,
        hasRefreshToken: true,
      },
    });

    const completed = await callbackGET(
      getRequest(`/sources/callback/${begun.state}?code=r03-stub-auth-code-2`),
      { params: Promise.resolve({ state: begun.state }) },
    );
    expect(completed.status).toBe(200);
    const answer = (await completed.json()) as { accountId: string; authorizedAt: string };

    // The account row is PRESERVED: the account id is stable, the
    // authorized_at was re-stamped.
    const list = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const stubOauth = list.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(stubOauth?.authState).toBe("signedIn");
    expect(stubOauth?.connected).toBe(true);
    expect(answer.authorizedAt).not.toBe(accountIdBefore);

    // Even past the access-token expiry the refreshable grant stays
    // signedIn (the connector rotates it — that is not expiry).
    harness.clock.advance(3_600_001);
    const afterExpiry = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const refreshed = afterExpiry.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(refreshed?.authState).toBe("signedIn");
    expect(refreshed?.expiresAt).toBeNull();
  });

  it("abandons the pending on the provider's error redirect (consumed, typed 400)", async () => {
    const begun = (await (await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    )).json()) as { state: string };

    const denied = await callbackGET(
      getRequest(`/sources/callback/${begun.state}?error=access_denied`),
      { params: Promise.resolve({ state: begun.state }) },
    );
    expect(denied.status).toBe(400);
    const body = (await json(denied)) as { error: string; detail: string };
    expect(body.error).toBe("provider-denied");
    expect(body.detail).toContain("access_denied");

    // The pending is consumed: the state cannot complete anymore.
    const after = await callbackGET(
      getRequest(`/sources/callback/${begun.state}?code=late-code`),
      { params: Promise.resolve({ state: begun.state }) },
    );
    expect(after.status).toBe(404);
  });

  it("answers 410 for an EXPIRED pending (begin again — never resurrected)", async () => {
    const begun = (await (await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    )).json()) as { state: string };

    // Advance past the pending TTL (the service default: 10 minutes).
    harness.clock.advance(600_001);
    const response = await callbackGET(
      getRequest(`/sources/callback/${begun.state}?code=late-code`),
      { params: Promise.resolve({ state: begun.state }) },
    );
    expect(response.status).toBe(410);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("expired-pending");
  });

  it("answers 400 exchange-rejected and the pending SURVIVES a rejected exchange", async () => {
    const begun = (await (await connectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/connect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    )).json()) as { state: string };

    harness.stubExchange.script({
      ok: false,
      kind: "rejected",
      detail: "invalid_grant: the code was already redeemed",
    });
    const rejected = await callbackGET(
      getRequest(`/sources/callback/${begun.state}?code=stale-code`),
      { params: Promise.resolve({ state: begun.state }) },
    );
    expect(rejected.status).toBe(400);
    const body = (await json(rejected)) as { error: string };
    expect(body.error).toBe("exchange-rejected");

    // The pending is still live: a fresh code from a new consent completes.
    const retry = await callbackGET(
      getRequest(`/sources/callback/${begun.state}?code=fresh-code`),
      { params: Promise.resolve({ state: begun.state }) },
    );
    expect(retry.status).toBe(200);
  });

  it("answers 404 no-account for reauthorize without an account (connect first)", async () => {
    const response = await reauthorizePOST(
      postRequest(`/sources/${STUB_DEVICE_CONNECTOR_ID}/reauthorize`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_DEVICE_CONNECTOR_ID }) },
    );
    expect(response.status).toBe(404);
    const body = (await json(response)) as { error: string };
    expect(body.error).toBe("no-account");
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

describe("POST /sources/:connectorId/disconnect", () => {
  it("disconnects (account deleted, state signedOut) and is IDEMPOTENT", async () => {
    const first = await disconnectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/disconnect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    );
    expect(first.status).toBe(200);
    const body = (await json(first)) as {
      connectorId: string;
      authState: string;
      disconnected: boolean;
      deletedAccount: boolean;
    };
    expect(body.authState).toBe("signedOut");
    expect(body.disconnected).toBe(true);
    expect(body.deletedAccount).toBe(true);

    const list = (await (await sourcesGET(getRequest("/sources", bearer(token)))).json()) as SourceRow[];
    const stubOauth = list.find((row) => row.connectorId === STUB_OAUTH_CONNECTOR_ID);
    expect(stubOauth?.authState).toBe("signedOut");
    expect(stubOauth?.connected).toBe(false);

    // Idempotent: a second disconnect is a success with nothing to delete.
    const second = await disconnectPOST(
      postRequest(`/sources/${STUB_OAUTH_CONNECTOR_ID}/disconnect`, {}, bearer(token)),
      { params: Promise.resolve({ connectorId: STUB_OAUTH_CONNECTOR_ID }) },
    );
    expect(second.status).toBe(200);
    const secondBody = (await json(second)) as { deletedAccount: boolean };
    expect(secondBody.deletedAccount).toBe(false);

    // The sealed credential is GONE (the delete discipline).
    const rows = await harness.testDb.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM connector_accounts WHERE connector_id = $1",
      [STUB_OAUTH_CONNECTOR_ID],
    );
    expect(rows[0]?.count).toBe("0");
  });

  it("answers typed 404 for an unknown connector and 401 without a session", async () => {
    const unknown = await disconnectPOST(
      postRequest("/sources/not-a-source/disconnect", {}, bearer(token)),
      { params: Promise.resolve({ connectorId: "not-a-source" }) },
    );
    expect(unknown.status).toBe(404);

    const anonymous = await disconnectPOST(
      postRequest(`/sources/${STUB_LOCAL_CONNECTOR_ID}/disconnect`, {}, identityHeaders()),
      { params: Promise.resolve({ connectorId: STUB_LOCAL_CONNECTOR_ID }) },
    );
    expect(anonymous.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The flow-missing honesty (service level) + the privacy law at the boundary
// ---------------------------------------------------------------------------

describe("flow-missing honesty (an oauth connector without client wiring)", () => {
  it("answers the typed flow-missing failure — never a fabricated URL", async () => {
    const registry = new ConnectorRegistry();
    registry.register(makeStubAuthConnector("oauth", { id: "stub-oauth-unwired" }));
    const service = new SourceManagementService({
      registry,
      accounts: new PostgresConnectorAccountStore({
        db: harness.testDb.db,
        clock: harness.clock,
        ids: harness.ids,
        key: decodeEncryptionKey(TEST_ENCRYPTION_KEY_BASE64),
      }),
      flows: {},
      oauthWirings: {},
      clock: harness.clock,
      ids: harness.ids,
    });

    const outcome = await service.connect("wfxusr_r03unwiredtest0000000001", "stub-oauth-unwired");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("flow-missing");

    // The HTTP mapping: 503, honest unavailability.
    const response = sourceFailureResponse(outcome.error);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("flow-missing");

    // The source list carries the honest note for the unwired connector.
    const summaries = await service.listSources("wfxusr_r03unwiredtest0000000001");
    expect(summaries.length).toBe(1);
    expect(summaries[0]?.notes.join(" ")).toContain("oauth client not configured");
  });
});

describe("the privacy law at the HTTP boundary", () => {
  it("no /sources answer ever carries credential material", async () => {
    const listResponse = await sourcesGET(getRequest("/sources", bearer(token)));
    const serialized = JSON.stringify(await listResponse.json());
    expect(serialized).not.toContain("r03-local-secret-token");
    expect(serialized).not.toContain("stub-at");
    expect(serialized).not.toContain("stub-rt");
    expect(serialized).not.toContain("r03-stub-auth-code");
    expect(serialized).not.toMatch(/"(secret|ciphertext|auth_?tag|access_?token|refresh_?token|client_?secret)"/i);
  });
});
