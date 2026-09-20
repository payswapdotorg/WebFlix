/**
 * R22-H — the Desktop auth transport tests.
 *
 * The documented endpoint mapping, the typed failure family (the R22-B
 * mapping for register), the bearer-token discipline (the header law:
 * the token rides `Authorization` ONLY — never a URL, never a body),
 * and the payload guards (a non-usable session view / source row /
 * connect answer is a `malformed` failure, never domain data).
 */

import { describe, expect, it } from "bun:test";

import {
  createDesktopAccountRegistrationPort,
  createDesktopAuthTransport,
  type DesktopAuthTransport,
} from "../src/platform/auth-transport";
import type { AccountCreationFailureKind } from "@wfx/client-runtime";
import { jsonResponse, StubFetch } from "./discoverability-harness";
import { makeIssuedSession, makeSession, makeSource, R22_API_BASE, sourcesEnvelope } from "./r22-fixtures";

const TOKEN = "wfxsess_r22testtoken0000000000000000";

function transport(stub: StubFetch): DesktopAuthTransport {
  return createDesktopAuthTransport({ apiBase: R22_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 });
}

function transportWithLog(stub: StubFetch): { client: DesktopAuthTransport; log: readonly { method: string; url: string; bearer: boolean; body: string | undefined }[] } {
  const client = createDesktopAuthTransport({ apiBase: R22_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 });
  return { client, log: client.requests };
}

describe("R22-H — the endpoint mapping (the documented routes)", () => {
  it("register → POST /auth/register, anonymous body, no bearer", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/auth/register"),
      () => jsonResponse({ token: TOKEN, session: makeSession() }),
    );
    const { client, log } = transportWithLog(stub);
    const result = await client.register({
      email: "viewer@example.com",
      password: "correct horse battery",
      displayName: "Viewer",
    });
    expect(result.ok).toBe(true);
    const request = log[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://experience.webflix.invalid/api/auth/register");
    expect(request.bearer).toBe(false);
    expect(JSON.parse(request.body!)).toEqual({
      email: "viewer@example.com",
      password: "correct horse battery",
      displayName: "Viewer",
    });
  });

  it("login → POST /auth/login; me → GET /auth/me with the bearer", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/auth/login"),
      () => jsonResponse({ token: TOKEN, session: makeSession() }),
    );
    stub.script((url) => url.endsWith("/auth/me"), () => jsonResponse(makeSession()));
    const { client, log } = transportWithLog(stub);
    const login = await client.login({ email: "viewer@example.com", password: "correct horse battery" });
    expect(login.ok).toBe(true);
    const me = await client.readSession(TOKEN);
    expect(me.ok).toBe(true);
    expect(log[1]!.bearer).toBe(true);
    expect(log[1]!.url.endsWith("/auth/me")).toBe(true);
  });

  it("the sources read → GET /sources with the bearer; rows cross the guard", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource()])),
    );
    const read = await transport(stub).readSources(TOKEN);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.authenticated).toBe(true);
      expect(read.value.sources.map((row) => row.connectorId)).toEqual(["youtube"]);
    }
    // A garbage row is filtered, never domain data.
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse({ authenticated: true, sources: [{ connectorId: "broken" }] }),
    );
    const filtered = await transport(stub).readSources(TOKEN);
    expect(filtered.ok).toBe(true);
    if (filtered.ok) expect(filtered.value.sources).toHaveLength(0);
  });

  it("the connect routes carry the credential ONLY in the body (never a URL)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({ kind: "local", connectorId: "youtube", authState: "signedIn", accountId: "acct-1", authorizedAt: "2026-09-20T09:00:00.000Z" }),
    );
    stub.script(
      (url) => url.endsWith("/sources/youtube/reauthorize"),
      () => jsonResponse({ kind: "oauth", connectorId: "youtube", authorizationUrl: "https://provider.example/authorize?state=abc", state: "abc", expiresAt: "2026-09-20T09:10:00.000Z" }),
    );
    stub.script(
      (url) => url.endsWith("/sources/youtube/disconnect"),
      () => jsonResponse({ connectorId: "youtube", authState: "signedOut", hadAccount: true }),
    );
    const client = transport(stub);
    const connected = await client.beginConnect(TOKEN, "youtube", "the-access-key");
    expect(connected.ok).toBe(true);
    expect(stub.requests[0]!.url.includes("credential")).toBe(false);
    expect(stub.requests[0]!.url.includes("access-key")).toBe(false);
    expect(JSON.parse(stub.requests[0]!.body!)).toEqual({ credential: "the-access-key" });

    const reauthorized = await client.beginReauthorize(TOKEN, "youtube");
    expect(reauthorized.ok).toBe(true);
    expect(stub.requests[1]!.body).toBeUndefined();

    const disconnected = await client.disconnectSource(TOKEN, "youtube");
    expect(disconnected.ok).toBe(true);
    if (disconnected.ok) expect(disconnected.value.hadAccount).toBe(true);
  });

  it("the model routes map their documented endpoints (R22-I's seam)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/experience/model-providers"),
      () => jsonResponse([
        { id: "wfx-first-party", privacy: "local", capabilities: ["summary"], byomBound: false, costs: {}, availability: "available" },
        { id: "my-openai", privacy: "cloud", capabilities: ["translation"], byomBound: true, costs: { translation: 4 }, availability: "available" },
      ]),
    );
    stub.script(
      (url) => url.startsWith("https://experience.webflix.invalid/api/experience/model-policy"),
      () => jsonResponse(null),
    );
    const client = transport(stub);
    const providers = await client.readModelProviders(TOKEN);
    expect(providers.ok).toBe(true);
    if (providers.ok) expect(providers.value).toHaveLength(2);
    const policy = await client.readModelPolicy(TOKEN, "translation");
    expect(policy.ok).toBe(true);
    if (policy.ok) expect(policy.value).toBeNull();
    expect(stub.requests[1]!.url.endsWith("/experience/model-policy?task=translation")).toBe(true);
  });
});

describe("R22-H — the typed failure family (the closed vocabulary)", () => {
  it("register 409 → the R22-B email-taken failure with the sign-in-instead recovery", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/auth/register"),
      () => jsonResponse({ error: "conflict", detail: "an account with this email exists" }, 409),
    );
    const port = createDesktopAccountRegistrationPort(transport(stub));
    const outcome = await port.register({ email: "viewer@example.com", password: "correct horse battery" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.kind).toBe("email-taken");
      expect(outcome.failure.recovery.kind).toBe("sign-in-instead");
      expect(outcome.failure.recovery.label).toBe("Sign in instead");
    }
  });

  it("register 400 → invalid-input; 500 → unavailable; transport loss → network; garbage → malformed", async () => {
    const cases: readonly [number | "network" | "garbage", AccountCreationFailureKind][] = [
      [400, "invalid-input"],
      [500, "unavailable"],
      ["network", "network"],
      ["garbage", "malformed"],
    ];
    for (const [scenario, expected] of cases) {
      const stub = new StubFetch();
      if (scenario === "network") {
        stub.script((url) => url.endsWith("/auth/register"), () => {
          throw new TypeError("offline");
        });
      } else if (scenario === "garbage") {
        stub.script((url) => url.endsWith("/auth/register"), () => jsonResponse({ nope: true }));
      } else {
        stub.script(
          (url) => url.endsWith("/auth/register"),
          () => jsonResponse({ error: "bad", detail: "the body" }, scenario),
        );
      }
      const port = createDesktopAccountRegistrationPort(transport(stub));
      const outcome = await port.register({ email: "viewer@example.com", password: "correct horse battery" });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.failure.kind).toBe(expected);
    }
  });

  it("login 401 → invalid-credentials (the anti-enumeration law)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/auth/login"),
      () => jsonResponse({ error: "unauthorized" }, 401),
    );
    const outcome = await transport(stub).login({ email: "viewer@example.com", password: "wrong-password" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.kind).toBe("invalid-credentials");
  });

  it("a session view carrying password material is malformed (the secret law at the boundary)", async () => {
    const stub = new StubFetch();
    const smuggled = makeSession();
    (smuggled.user as unknown as Record<string, unknown>).passwordHash = "$scrypt$leaked";
    stub.script((url) => url.endsWith("/auth/me"), () => jsonResponse(smuggled));
    const outcome = await transport(stub).readSession(TOKEN);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.kind).toBe("malformed");
  });

  it("a connect answer of an unknown flow kind is malformed (never a fabricated flow)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({ kind: "carrier-pigeon" }),
    );
    const outcome = await transport(stub).beginConnect(TOKEN, "youtube");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.kind).toBe("malformed");
  });
});

describe("R22-H — the bearer discipline (the token is a secret)", () => {
  it("every authenticated request carries the bearer header and never leaks the token elsewhere", async () => {
    const stub = new StubFetch();
    stub.script((url) => url.endsWith("/sources"), () => jsonResponse(sourcesEnvelope([])));
    await transport(stub).readSources(TOKEN);
    const request = stub.requests[0]!;
    expect(request.url.includes(TOKEN)).toBe(false);
    expect(request.body === undefined || !request.body.includes(TOKEN)).toBe(true);
  });

  it("an empty token is the typed invalid-input answer (never a request)", async () => {
    const stub = new StubFetch();
    const outcome = await transport(stub).readSources("");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.kind).toBe("invalid-input");
    expect(stub.requests).toHaveLength(0);
  });

  it("the one-time issuance answers exactly the issued session shape", async () => {
    const stub = new StubFetch();
    const issued = makeIssuedSession();
    stub.script((url) => url.endsWith("/auth/register"), () => jsonResponse(issued));
    const outcome = await transport(stub).register({
      email: "viewer@example.com",
      password: "correct horse battery",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.token).toBe(issued.token);
      expect(outcome.value.session.activeProfileId).toBe("wfxprof_main");
    }
  });
});
