/**
 * R22-H — the Desktop source connect flow tests (the adapter-owned
 * native flows over the simulated shell).
 *
 * - the OAUTH flow: the contained authorization surface opens with cookie
 *   isolation + `purpose: "authorization"`; the provider's redirect to
 *   the service's callback route completes the flow (the adapter
 *   OBSERVES the navigation — never steers); the surface closes; the
 *   fresh sources read VERIFIES the connected truth (never an assumed
 *   success); a surface closed before the callback is the typed
 *   `dismissed` non-event;
 * - the DEVICE flow: the instructions view carries the verification URL
 *   + the poll cadence; polls settle only on the server-side transition
 *   or the pending's honest expiry;
 * - the LOCAL flow: the direct answer still VERIFIES through the read;
 * - the NONE flow: connects directly (nothing to authorize), verified;
 * - every failed/denied/expired state carries the typed recovery next
 *   action (the R17 vocabulary);
 * - a second start for a LIVE flow answers the live view (no duplicate
 *   surfaces); cancel closes the live surface (no leaked windows).
 */

import { describe, expect, it } from "bun:test";

import { createDesktopSourceConnectFlow } from "../src/platform/source-connect-flow";
import type { DesktopSourceFlowView } from "../src/platform/source-connect-flow";
import { createDesktopAuthTransport } from "../src/platform/auth-transport";
import { jsonResponse, StubFetch } from "./discoverability-harness";
import { SimShell } from "./shell-simulator";
import { makeSource, R22_API_BASE, R22_T0, sourcesEnvelope } from "./r22-fixtures";

const TOKEN = "wfxsess_r22testtoken0000000000000000";

function flowWith(stub: StubFetch, shell = new SimShell()) {
  const transport = createDesktopAuthTransport({ apiBase: R22_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 });
  const flow = createDesktopSourceConnectFlow({
    shell,
    transport,
    now: () => new Date(R22_T0).toISOString(),
  });
  return { flow, shell, transport };
}

describe("R22-H — the oauth flow (the contained authorization surface)", () => {
  it("opens the isolated authorization surface and completes on the callback navigation", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=abc123",
        state: "abc123",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ authState: "signedIn", connected: true, accountId: "acct-1" })])),
    );
    const { flow, shell } = flowWith(stub);

    const started = await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    expect(started.ok).toBe(true);
    expect(started.view.state).toBe("authorization-surface");
    expect(started.view.surfaceId).not.toBeNull();
    expect(started.view.method).toBe("provider-signin");
    // The isolated surface law: the open request carried the truth.
    expect(shell.pickRequests).toHaveLength(0); // no file dialog touched

    // The provider redirects the surface to the service's callback route
    // (the simulator's navigated event — the adapter observes it).
    const terminal = flow.waitForTerminal("youtube");
    await shell.surfaceNavigate(started.view.surfaceId!, `${R22_API_BASE.toString()}/sources/callback/abc123?code=the-code&state=abc123`);
    const settled = await terminal;
    expect(settled.state).toBe("completed");
    expect(settled.row?.authState).toBe("signedIn");
    expect(settled.recovery).toBeNull();
    // The surface was closed (no leaked authorization windows).
    expect(settled.surfaceId).toBeNull();
  });

  it("the cookie-isolation + authorization purpose ride the open request (the browser-host law)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=abc123",
        state: "abc123",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
    const opened: unknown[] = [];
    const shell = new SimShell();
    const originalOpen = shell.surfaceOpen.bind(shell);
    shell.surfaceOpen = async (request) => {
      opened.push(request);
      return originalOpen(request);
    };
    const { flow } = flowWith(stub, shell);
    await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toEqual({
      url: "https://provider.example/authorize?state=abc123",
      restrictCookies: "isolate",
      purpose: "authorization",
    });
  });

  it("the user closing the surface before the callback is the typed dismissed non-event", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=abc123",
        state: "abc123",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
    const { flow, shell } = flowWith(stub);
    const started = await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    const terminal = flow.waitForTerminal("youtube");
    await shell.surfaceClose(started.view.surfaceId!);
    const settled = await terminal;
    expect(settled.state).toBe("dismissed");
    expect(settled.row).toBeNull();
    expect(settled.stateDetail.includes("nothing was connected")).toBe(true);
  });

  it("a provider denial (the row stays unsigned) settles denied with the reauthorize recovery", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=abc123",
        state: "abc123",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ authState: "failed" })])),
    );
    const { flow, shell } = flowWith(stub);
    const started = await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    const terminal = flow.waitForTerminal("youtube");
    await shell.surfaceNavigate(started.view.surfaceId!, `${R22_API_BASE.toString()}/sources/callback/abc123?error=access_denied`);
    const settled = await terminal;
    expect(settled.state).toBe("denied");
    expect(settled.recovery?.kind).toBe("reauthorize");
  });
});

describe("R22-H — the device flow (the host-driven polls)", () => {
  function deviceScript(stub: StubFetch) {
    stub.script(
      (url) => url.endsWith("/sources/studio/connect"),
      () => jsonResponse({
        kind: "device",
        connectorId: "studio",
        verificationUrl: "https://provider.example/device",
        pollIntervalSeconds: 5,
        state: "def456",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
  }

  it("the instructions view carries the verification URL + the cadence truth", async () => {
    const stub = new StubFetch();
    deviceScript(stub);
    const { flow } = flowWith(stub);
    const started = await flow.start({ token: TOKEN, connectorId: "studio", methodHint: "device-code" });
    expect(started.ok).toBe(true);
    expect(started.view.state).toBe("awaiting-provider");
    expect(started.view.verificationUrl).toBe("https://provider.example/device");
    expect(started.view.pollIntervalSeconds).toBe(5);
    expect(started.view.method).toBe("device-code");
  });

  it("a poll settles completed when the server-side transition landed", async () => {
    const stub = new StubFetch();
    deviceScript(stub);
    let approved = false;
    stub.script((url) => url.endsWith("/sources"), () =>
      jsonResponse(
        sourcesEnvelope([
          makeSource({
            connectorId: "studio",
            authMode: "device",
            authState: approved ? "signedIn" : "authorizing",
            connected: approved,
          }),
        ]),
      ),
    );
    const { flow } = flowWith(stub);
    await flow.start({ token: TOKEN, connectorId: "studio", methodHint: "device-code" });
    const first = await flow.poll("studio");
    expect(first.state).toBe("awaiting-provider");
    approved = true;
    const second = await flow.poll("studio");
    expect(second.state).toBe("completed");
    expect(second.row?.authState).toBe("signedIn");
  });

  it("a poll after the pending's expiry settles expired with the honest retry", async () => {
    const stub = new StubFetch();
    deviceScript(stub);
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ connectorId: "studio", authMode: "device", authState: "signedOut" })])),
    );
    const pastExpiry = createDesktopSourceConnectFlow({
      shell: new SimShell(),
      transport: createDesktopAuthTransport({ apiBase: R22_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 }),
      // The now stamp is PAST the pending's expiry — the honest expiry.
      now: () => new Date(R22_T0 + 20 * 60 * 1000).toISOString(),
    });
    await pastExpiry.start({ token: TOKEN, connectorId: "studio", methodHint: "device-code" });
    const polled = await pastExpiry.poll("studio");
    expect(polled.state).toBe("expired");
    expect(polled.recovery?.kind).toBe("reauthorize");
  });
});

describe("R22-H — the direct flows (local credential / no sign-in)", () => {
  it("the local flow verifies the connection through the fresh management read", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/archive/connect"),
      () => jsonResponse({
        kind: "local",
        connectorId: "archive",
        authState: "signedIn",
        accountId: "acct-2",
        authorizedAt: "2026-09-20T09:00:00.000Z",
      }),
    );
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ connectorId: "archive", authMode: "local", authState: "signedIn", connected: true })])),
    );
    const { flow } = flowWith(stub);
    const started = await flow.start({
      token: TOKEN,
      connectorId: "archive",
      credential: "the-access-key",
      methodHint: "access-key",
    });
    expect(started.ok).toBe(true);
    expect(started.view.state).toBe("completed");
    expect(started.view.row?.authState).toBe("signedIn");
    expect(started.view.method).toBe("access-key");
    // The credential crossed the command body once (never a URL).
    const connect = stub.requests.find((request) => request.url.endsWith("/sources/archive/connect"))!;
    expect(JSON.parse(connect.body!)).toEqual({ credential: "the-access-key" });
  });

  it("the no-signin flow connects directly and verifies", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/public-domain/connect"),
      () => jsonResponse({ kind: "none", connectorId: "public-domain", requiresAuthorization: false }),
    );
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ connectorId: "public-domain", authMode: "none", authState: "signedIn", requiresAuthorization: false, connected: true })])),
    );
    const { flow } = flowWith(stub);
    const started = await flow.start({ token: TOKEN, connectorId: "public-domain", methodHint: "no-signin" });
    expect(started.ok).toBe(true);
    expect(started.view.state).toBe("completed");
    expect(started.view.method).toBe("no-signin");
  });

  it("a direct answer the read does not confirm settles denied (never an assumed success)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/archive/connect"),
      () => jsonResponse({
        kind: "local",
        connectorId: "archive",
        authState: "signedIn",
        accountId: "acct-2",
        authorizedAt: "2026-09-20T09:00:00.000Z",
      }),
    );
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ connectorId: "archive", authMode: "local", authState: "failed" })])),
    );
    const { flow } = flowWith(stub);
    const started = await flow.start({ token: TOKEN, connectorId: "archive", credential: "bad-key", methodHint: "access-key" });
    expect(started.ok).toBe(false);
    expect(started.view.state).toBe("denied");
  });
});

describe("R22-H — the flow discipline (live flows, cancel, failures)", () => {
  it("a failed begin carries the typed recovery and never opens a surface", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({ error: "unauthorized", detail: "the session was not accepted" }, 401),
    );
    const { flow, shell } = flowWith(stub);
    const started = await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    expect(started.ok).toBe(false);
    expect(started.view.state).toBe("failed");
    expect(started.view.recovery?.kind).toBe("sign-in-again");
    expect(started.view.surfaceId).toBeNull();
    expect(shell.pickRequests).toHaveLength(0);
  });

  it("a second start for a LIVE flow answers the live view (no duplicate surfaces)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=abc123",
        state: "abc123",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
    const { flow } = flowWith(stub);
    const first = await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    const second = await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    expect(second.view.state).toBe("authorization-surface");
    expect(second.view.surfaceId).toBe(first.view.surfaceId);
    // Only ONE connect round trip happened (the live flow stands).
    expect(stub.requests.filter((request) => request.url.endsWith("/connect"))).toHaveLength(1);
  });

  it("cancel closes the live surface and answers the typed dismissed view", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/youtube/connect"),
      () => jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=abc123",
        state: "abc123",
        expiresAt: "2026-09-20T09:10:00.000Z",
      }),
    );
    const { flow } = flowWith(stub);
    await flow.start({ token: TOKEN, connectorId: "youtube", methodHint: "provider-signin" });
    const cancelled = await flow.cancel("youtube");
    expect(cancelled.state).toBe("dismissed");
    expect(cancelled.surfaceId).toBeNull();
  });

  it("the flows()/flow() views carry the observed rows (the surface observes them into the runtime)", async () => {
    const stub = new StubFetch();
    stub.script(
      (url) => url.endsWith("/sources/archive/connect"),
      () => jsonResponse({
        kind: "local",
        connectorId: "archive",
        authState: "signedIn",
        accountId: "acct-2",
        authorizedAt: "2026-09-20T09:00:00.000Z",
      }),
    );
    stub.script(
      (url) => url.endsWith("/sources"),
      () => jsonResponse(sourcesEnvelope([makeSource({ connectorId: "archive", authMode: "local", authState: "signedIn", connected: true })])),
    );
    const { flow } = flowWith(stub);
    await flow.start({ token: TOKEN, connectorId: "archive", credential: "key", methodHint: "access-key" });
    const views: readonly DesktopSourceFlowView[] = flow.flows();
    expect(views).toHaveLength(1);
    expect(views[0]?.row?.connectorId).toBe("archive");
    expect(flow.flow("archive")?.state).toBe("completed");
    expect(flow.flow("never-ran")).toBeNull();
  });
});
