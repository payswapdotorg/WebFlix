/**
 * R22-H — the Desktop first-run parity surface tests.
 *
 * THE PARITY LAWS, proven against the REAL composition root
 * (`createDesktopApp` with the first-run block bound, over the
 * deterministic shell simulator + the stubbed service transport):
 *
 * - THE R22-B PARITY (account creation/sign-in state): the create-account
 *   journey is the SHARED state machine (the model's states, the typed
 *   failures with recovery, the anti-loop email-taken → sign-in-instead
 *   law); a successful create persists the one-time token through the OS
 *   KEYCHAIN and the boot continuity probe VERIFIES the stored session
 *   against the service (a dead token clears honestly; sign-out answers
 *   the anonymous state); the secret law holds (the surface's models are
 *   machine-checked secret-free).
 * - THE R22-A PARITY (source connector selection): the catalog derives
 *   VERBATIM over the runtime's observed rows — the seven truths, the
 *   anonymous prerequisite (never an empty dead end), the honest
 *   unsupported truth, the in-model degradation (an error status keeps
 *   entries visible).
 * - THE CONNECT/RECOVERY PARITY: the adapter-owned flows drive the
 *   runtime's observed state (the post-flow row reports through
 *   `runtime.sources.observe`); disconnect observes the signedOut row.
 * - THE BYOF PREREQUISITE TRANSITION (the F3 fix): before a
 *   feed-import-capable source connects, the BYOF view carries the
 *   bridge into the source chooser; after it connects, the import entry
 *   opens (never the old dead end, never a fabricated offer).
 * - THE COPY LAW: every string the surface can project passes the frozen
 *   stale-copy sweep; the UNBOUND composition answers the honest typed
 *   verdicts (never silent absence).
 */

import { describe, expect, it } from "bun:test";

import {
  FixedClock,
  InMemoryServerPort,
  SequentialIdGen,
  SOURCE_CATALOG_STATE_LABELS,
  createRuntime,
  isStaleCompletionCopy,
  makeDesktopCapabilities,
} from "@wfx/client-runtime";
import type { ClientRuntime } from "@wfx/client-runtime";

import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { createDesktopAuthTransport } from "../src/platform/auth-transport";
import { createShellAuthSessionStore } from "../src/platform/auth-session-store";
import { createDesktopFirstRunSurface, firstRunCopyStrings } from "../src/surface/first-run-surface";
import { jsonResponse, StubFetch } from "./discoverability-harness";
import { SimShell, SimEngineProcess } from "./shell-simulator";
import {
  makeSession,
  makeSource,
  R22_API_BASE,
  R22_T0,
  sourcesEnvelope,
} from "./r22-fixtures";

const TOKEN = "wfxsess_r22testtoken0000000000000000";
const CONTEXT = { userId: "wfx-desktop-user", sessionId: "wfx-desktop-session", locale: "en" };
const NOW = () => new Date(R22_T0).toISOString();

/** A fresh shared runtime over the in-memory port (the anonymous channel). */
function makeRuntime(): ClientRuntime {
  return createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), {
    context: CONTEXT,
    clock: new FixedClock(R22_T0),
    ids: new SequentialIdGen(),
  });
}

/** The full composition with the first-run block bound (the harness boot). */
function bootFirstRun(options: { keychainPresent?: boolean } = {}) {
  const shell = new SimShell({ keychainPresent: options.keychainPresent ?? true });
  const stub = new StubFetch();
  const app = createDesktopApp({
    shell,
    server: createDesktopServerPort({ apiBase: R22_API_BASE, context: CONTEXT, fetchImpl: stub.fetch }),
    session: {
      context: CONTEXT,
      clock: new FixedClock(R22_T0),
      ids: new SequentialIdGen(),
    },
    engine: {
      config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
      process: new SimEngineProcess(),
    },
    firstRun: {
      apiBase: R22_API_BASE,
      fetchImpl: stub.fetch,
      timeoutMs: 0,
    },
  });
  return { app, shell, stub, firstRun: app.firstRun };
}

/** A directly-constructed surface over one runtime (the continuity probes). */
function bootSurfaceOver(stub: StubFetch, shell: SimShell, runtime: ClientRuntime) {
  return createDesktopFirstRunSurface({
    runtime,
    transport: createDesktopAuthTransport({ apiBase: R22_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 }),
    sessionStore: createShellAuthSessionStore({ shell, now: NOW }),
    feed: { bound: false } as never,
    shell,
    now: NOW,
  });
}

function scriptRegister(stub: StubFetch, session = makeSession(), token = TOKEN) {
  stub.script(
    (url) => url.endsWith("/auth/register"),
    () => jsonResponse({ token, session }),
  );
}

function scriptSources(stub: StubFetch, sources: readonly ReturnType<typeof makeSource>[]) {
  stub.script(
    (url) => url.endsWith("/sources"),
    () => jsonResponse(sourcesEnvelope(sources)),
  );
}

async function signInForTest(firstRun: ReturnType<typeof bootFirstRun>["firstRun"], stub: StubFetch) {
  scriptRegister(stub);
  const result = await firstRun.createAccount({
    email: "viewer@example.com",
    password: "correct horse battery",
  });
  expect(result.ok).toBe(true);
}

describe("R22-H — the R22-B parity (account creation / sign-in state)", () => {
  it("the fresh boot answers the honest anonymous state (never a fabricated session)", () => {
    const { app, firstRun } = bootFirstRun();
    const state = firstRun.accountState();
    expect(state.state).toBe("anonymous");
    expect(state.session).toBeNull();
    expect(state.signInLabel).toBe("Sign in");
    expect(state.createAccountLabel).toBe("Create account");
    expect(firstRun.currentToken()).toBeNull();
    app.dispose();
  });

  it("createAccount runs the SHARED journey: validation problems are the R22-B per-field truths", async () => {
    const { app, firstRun } = bootFirstRun();
    const result = await firstRun.createAccount({
      email: "not-an-email",
      password: "short",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.model.state).toBe("failed");
      expect(result.model.failure?.kind).toBe("invalid-input");
      expect(result.model.problems?.map((problem) => problem.field)).toEqual(["email", "password"]);
      // The shared recovery: fix and retry.
      expect(result.model.nextAction.kind).toBe("fix-and-retry");
    }
    // The reset returns to idle (the dismiss path).
    expect(firstRun.resetAccountCreation().state).toBe("idle");
    app.dispose();
  });

  it("createAccount success: auto-login + the keychain persistence + the signed-in view", async () => {
    const { app, firstRun, shell, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    const state = firstRun.accountState();
    expect(state.state).toBe("signed-in");
    expect(state.profiles).toHaveLength(1);
    expect(state.activeProfileId).toBe("wfxprof_main");
    expect(firstRun.currentToken()).toBe(TOKEN);
    // The token persisted through the OS keychain (the platform law).
    const stored = await shell.authStoreGet();
    expect(stored).not.toBeNull();
    expect(stored!.payload.includes(TOKEN)).toBe(true);
    app.dispose();
  });

  it("the created journey's next action stays the downstream choose-profile step", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    scriptRegister(stub);
    const result = await firstRun.createAccount({
      email: "viewer@example.com",
      password: "correct horse battery",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.model.state).toBe("created");
      // Profile selection stays DOWNSTREAM (the R22-B law).
      expect(result.value.model.nextAction.kind).toBe("choose-profile");
      expect(result.value.persisted).toBe(true);
    }
    app.dispose();
  });

  it("email-taken answers the anti-loop sign-in-instead recovery (the R22-B law, verbatim)", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    stub.script(
      (url) => url.endsWith("/auth/register"),
      () => jsonResponse({ error: "conflict", detail: "an account with this email exists" }, 409),
    );
    const result = await firstRun.createAccount({
      email: "taken@example.com",
      password: "correct horse battery",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.model.failure?.kind).toBe("email-taken");
      expect(result.model.nextAction.kind).toBe("sign-in-instead");
      expect(result.model.nextAction.label).toBe("Sign in instead");
    }
    app.dispose();
  });

  it("the boot continuity probe VERIFIES the stored session against the service", async () => {
    const { app, shell, stub } = bootFirstRun();
    await signInForTest(app.firstRun, stub);
    stub.script((url) => url.endsWith("/auth/me"), () => jsonResponse(makeSession()));
    // A "restart": a fresh surface over the SAME keychain + a fresh runtime.
    const second = bootSurfaceOver(stub, shell, makeRuntime());
    const restored = await second.restoreSession();
    expect(restored.state.state).toBe("signed-in");
    expect(restored.verified).toBe(true);
    expect(second.currentToken()).toBe(TOKEN);
    app.dispose();
  });

  it("a dead stored token clears honestly (the anonymous truth, never a fabricated sign-in)", async () => {
    const { app, shell, stub } = bootFirstRun();
    await signInForTest(app.firstRun, stub);
    stub.script((url) => url.endsWith("/auth/me"), () => jsonResponse({ error: "unauthorized" }, 401));
    const second = bootSurfaceOver(stub, shell, makeRuntime());
    const restored = await second.restoreSession();
    expect(restored.state.state).toBe("anonymous");
    expect(second.currentToken()).toBeNull();
    // The keychain was cleared (the dead token is gone).
    expect(await shell.authStoreGet()).toBeNull();
    app.dispose();
  });

  it("an offline boot keeps the stored session unverified (the honest degraded truth)", async () => {
    const { app, shell, stub } = bootFirstRun();
    await signInForTest(app.firstRun, stub);
    stub.script((url) => url.endsWith("/auth/me"), () => {
      throw new TypeError("offline");
    });
    const second = bootSurfaceOver(stub, shell, makeRuntime());
    const restored = await second.restoreSession();
    expect(restored.state.state).toBe("signed-in");
    expect(restored.verified).toBe(false);
    app.dispose();
  });

  it("signOut revokes + clears and answers the honest anonymous state", async () => {
    const { app, firstRun, shell, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    stub.script((url) => url.endsWith("/auth/logout"), () => jsonResponse({ revoked: true }));
    const signedOut = await firstRun.signOut();
    expect(signedOut.ok).toBe(true);
    if (signedOut.ok) expect(signedOut.value.revoked).toBe(true);
    expect(firstRun.accountState().state).toBe("anonymous");
    expect(firstRun.currentToken()).toBeNull();
    expect(await shell.authStoreGet()).toBeNull();
    app.dispose();
  });

  it("signIn answers the anti-enumeration invalid-credentials failure with its recovery", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    stub.script(
      (url) => url.endsWith("/auth/login"),
      () => jsonResponse({ error: "unauthorized" }, 401),
    );
    const result = await firstRun.signIn({ email: "viewer@example.com", password: "wrong-password" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("invalid-credentials");
      expect(result.failure.recovery.kind).toBe("retry");
    }
    app.dispose();
  });

  it("selectProfile switches the active profile (the downstream choose-profile step)", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    const main = makeSession().profiles[0]!;
    const switched = makeSession({
      profiles: [{ ...main, id: "wfxprof_kids", displayName: "Kids", isDefault: false }],
      activeProfileId: "wfxprof_kids",
    });
    stub.script(
      (url) => url.endsWith("/profiles/wfxprof_kids/select"),
      () => jsonResponse(switched),
    );
    const result = await firstRun.selectProfile("wfxprof_kids");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.activeProfileId).toBe("wfxprof_kids");
    expect(firstRun.accountState().activeProfileId).toBe("wfxprof_kids");
    app.dispose();
  });

  it("the secret law: the surface's state never carries the token or the password", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    const state = firstRun.accountState();
    expect(JSON.stringify(state).includes("correct horse")).toBe(false);
    expect(JSON.stringify(state).includes(TOKEN)).toBe(false);
    const model = firstRun.accountCreationModel();
    expect(JSON.stringify(model).includes("correct horse")).toBe(false);
    expect(JSON.stringify(model).includes(TOKEN)).toBe(false);
    app.dispose();
  });

  it("a keychain-less platform still signs in (the honest will-not-persist consequence)", async () => {
    const { app, firstRun, stub } = bootFirstRun({ keychainPresent: false });
    scriptRegister(stub);
    const result = await firstRun.createAccount({
      email: "viewer@example.com",
      password: "correct horse battery",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The account IS created + signed-in; the persistence honestly failed.
      expect(result.value.persisted).toBe(false);
      expect(result.value.persistFailure?.kind).toBe("unsupported");
      expect(result.value.persistFailure?.recovery.kind).toBe("session-will-not-persist");
    }
    expect(firstRun.accountState().state).toBe("signed-in");
    expect(firstRun.accountState().identityNote).toContain("sign in again after each restart");
    app.dispose();
  });
});

describe("R22-H — the R22-A parity (source connector selection)", () => {
  it("the anonymous catalog carries the sign-in prerequisite (never an empty dead end)", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    scriptSources(stub, []);
    await firstRun.refreshSources();
    const catalog = firstRun.sourceCatalog();
    expect(catalog.prerequisite).not.toBeNull();
    expect(catalog.prerequisite?.kind).toBe("sign-in");
    expect(catalog.prerequisite?.label).toBe("Sign in or create an account");
    expect(catalog.entries).toHaveLength(0);
    app.dispose();
  });

  it("the signed-in catalog derives the seven truths VERBATIM over the observed rows", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    scriptSources(stub, [
      makeSource({ connectorId: "youtube", authState: "signedOut" }),
      makeSource({ connectorId: "studio", authMode: "device", authState: "authorizing" }),
      makeSource({ connectorId: "archive", authMode: "local", authState: "signedIn", connected: true, accountId: "acct-1" }),
      makeSource({ connectorId: "expired-service", authState: "expired" }),
      makeSource({ connectorId: "flaky", authState: "failed" }),
      makeSource({ connectorId: "unwired", authMode: "oauth", connectable: false }),
    ]);
    await firstRun.refreshSources();
    const catalog = firstRun.sourceCatalog();
    expect(catalog.prerequisite).toBeNull();
    const states = new Map(catalog.entries.map((entry) => [entry.connectorId, entry.state]));
    expect(states.get("youtube")).toBe("not-connected");
    expect(states.get("studio")).toBe("connecting");
    expect(states.get("archive")).toBe("connected");
    expect(states.get("expired-service")).toBe("authorization-expired");
    expect(states.get("flaky")).toBe("failed");
    expect(states.get("unwired")).toBe("unsupported");
    // The labels are the SHARED derivation's (never forked copy).
    for (const entry of catalog.entries) {
      expect(entry.stateLabel).toBe(SOURCE_CATALOG_STATE_LABELS[entry.state]);
    }
    // The typed actions + the user-vocabulary method.
    const youtube = catalog.entries.find((entry) => entry.connectorId === "youtube")!;
    expect(youtube.action.kind).toBe("connect");
    expect(youtube.method.label).toBe("Sign in on the provider's website");
    const expired = catalog.entries.find((entry) => entry.connectorId === "expired-service")!;
    expect(expired.action.kind).toBe("reauthorize");
    const unwired = catalog.entries.find((entry) => entry.connectorId === "unwired")!;
    expect(unwired.action.kind).toBe("none");
    expect(unwired.recoveryHint).not.toBeNull();
    app.dispose();
  });

  it("an in-model degradation keeps entries visible (an error status never wipes the catalog)", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    scriptSources(stub, [makeSource({ connectorId: "youtube", authState: "signedOut" })]);
    await firstRun.refreshSources();
    expect(firstRun.sourceCatalog().entries).toHaveLength(1);
    // The next read fails (network down): the observed row STAYS.
    stub.script((url) => url.endsWith("/sources"), () => {
      throw new TypeError("offline");
    });
    const model = await firstRun.refreshSources();
    expect(model.status.state).toBe("error");
    expect(firstRun.sourceCatalog().entries).toHaveLength(1);
    expect(firstRun.sourceCatalog().status.state).toBe("error");
    app.dispose();
  });
});

describe("R22-H — the connect/recovery parity (the flows drive the runtime's state)", () => {
  it("connect runs the adapter flow and the verified row reports into the runtime", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    stub.script(
      (url) => url.endsWith("/sources/archive/connect"),
      () => jsonResponse({
        kind: "local",
        connectorId: "archive",
        authState: "signedIn",
        accountId: "acct-2",
        authorizedAt: new Date(R22_T0).toISOString(),
      }),
    );
    scriptSources(stub, [
      makeSource({ connectorId: "archive", authMode: "local", authState: "signedIn", connected: true, accountId: "acct-2" }),
    ]);
    const started = await firstRun.connect({ connectorId: "archive", credential: "the-access-key" });
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.view.state).toBe("completed");
    // The runtime's observed state carries the connected truth.
    const observed = firstRun.sourceCatalog().entries.find((entry) => entry.connectorId === "archive");
    expect(observed?.state).toBe("connected");
    app.dispose();
  });

  it("an anonymous connect answers the typed sign-in prerequisite (never a silent no-op)", async () => {
    const { app, firstRun } = bootFirstRun();
    const started = await firstRun.connect({ connectorId: "youtube" });
    expect(started.ok).toBe(false);
    if (!started.ok && "failure" in started) {
      expect(started.failure.code).toBe("anonymous");
      expect(started.failure.recovery.kind).toBe("sign-in");
    } else if (!started.ok) {
      throw new Error("expected the anonymous failure envelope");
    }
    app.dispose();
  });

  it("disconnect observes the signedOut row (the honest removal truth)", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    stub.script(
      (url) => url.endsWith("/sources/archive/disconnect"),
      () => jsonResponse({ connectorId: "archive", authState: "signedOut", hadAccount: true }),
    );
    scriptSources(stub, [
      makeSource({ connectorId: "archive", authMode: "local", authState: "signedOut", connected: false }),
    ]);
    const disconnected = await firstRun.disconnectSource("archive");
    expect(disconnected.ok).toBe(true);
    if (disconnected.ok) expect(disconnected.value.hadAccount).toBe(true);
    const observed = firstRun.sourceCatalog().entries.find((entry) => entry.connectorId === "archive");
    expect(observed?.state).toBe("not-connected");
    app.dispose();
  });

  it("an anonymous refresh surfaces the runtime's own honest model (the coherent anonymous truth)", async () => {
    const { app, firstRun } = bootFirstRun();
    const model = await firstRun.refreshSources();
    // The runtime's anonymous read (the in-memory port) answers the honest
    // empty/typed model; the surface's catalog carries the prerequisite.
    expect(firstRun.sourceCatalog().prerequisite?.kind).toBe("sign-in");
    expect(model.sources).toHaveLength(0);
    app.dispose();
  });
});

describe("R22-H — the BYOF prerequisite transition (the F3 fix)", () => {
  it("before a feed-import source connects: the bridge into the source chooser (never the dead end)", () => {
    const { app, firstRun } = bootFirstRun();
    const view = firstRun.byofPrerequisite();
    expect(view.ready).toBe(false);
    expect(view.feedImportSourceIds).toHaveLength(0);
    expect(view.nextAction.kind).toBe("connect-source");
    expect(view.nextAction.label).toBe("Connect a source first");
    expect(view.nextAction.detail.includes("connected source")).toBe(true);
    app.dispose();
  });

  it("after a feed-import-capable source connects: the import entry opens", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    scriptSources(stub, [
      makeSource({ connectorId: "youtube", authState: "signedIn", connected: true, accountId: "acct-1" }),
      makeSource({
        connectorId: "no-feed",
        displayName: "Plain Source",
        authMode: "none",
        authState: "signedIn",
        connected: true,
        accountId: "acct-3",
        capabilities: { ...makeSource().capabilities, feedImport: false },
      }),
    ]);
    await firstRun.refreshSources();
    const view = firstRun.byofPrerequisite();
    expect(view.ready).toBe(true);
    expect(view.feedImportSourceIds).toEqual(["youtube"]);
    expect(view.connectedCount).toBe(2);
    expect(view.nextAction.kind).toBe("import-feed");
    expect(view.nextAction.label).toBe("Bring Your Feed");
    app.dispose();
  });

  it("a connected source WITHOUT the feed-import capability does not fabricate readiness", async () => {
    const { app, firstRun, stub } = bootFirstRun();
    await signInForTest(firstRun, stub);
    scriptSources(stub, [
      makeSource({
        connectorId: "no-feed",
        authMode: "none",
        authState: "signedIn",
        connected: true,
        capabilities: { ...makeSource().capabilities, feedImport: false },
      }),
    ]);
    await firstRun.refreshSources();
    const view = firstRun.byofPrerequisite();
    expect(view.ready).toBe(false);
    expect(view.connectedCount).toBe(1);
    expect(view.nextAction.kind).toBe("connect-source");
    app.dispose();
  });
});

describe("R22-H — the copy law + the unbound truth", () => {
  it("every string the surface can project passes the frozen stale-copy sweep", () => {
    const strings = firstRunCopyStrings({
      sources: [
        makeSource({ connectorId: "youtube", authState: "signedOut" }),
        makeSource({ connectorId: "unwired", authMode: "oauth", connectable: false }),
      ],
      authenticated: true,
    });
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
  });

  it("the UNBOUND composition answers the honest typed verdicts (never silent absence)", async () => {
    const shell = new SimShell();
    const stub = new StubFetch();
    const app = createDesktopApp({
      shell,
      server: createDesktopServerPort({ apiBase: R22_API_BASE, context: CONTEXT, fetchImpl: stub.fetch }),
      session: {
        context: CONTEXT,
        clock: new FixedClock(R22_T0),
        ids: new SequentialIdGen(),
      },
      engine: {
        config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
        process: new SimEngineProcess(),
      },
    });
    const unbound = app.firstRun;
    expect(unbound.bound).toBe(false);
    expect(unbound.accountState().state).toBe("anonymous");
    expect(unbound.accountState().identityNote).toContain("isn't wired");
    const signIn = await unbound.signIn({ email: "viewer@example.com", password: "correct horse battery" });
    expect(signIn.ok).toBe(false);
    if (!signIn.ok) expect(signIn.failure.code).toBe("unbound");
    const connect = await unbound.connect({ connectorId: "youtube" });
    expect(connect.ok).toBe(false);
    if (!connect.ok && "failure" in connect) {
      expect(connect.failure.code).toBe("unbound");
    } else if (!connect.ok) {
      throw new Error("expected the unbound failure envelope");
    }
    const signOut = await unbound.signOut();
    expect(signOut.ok).toBe(false);
    if (!signOut.ok) expect(signOut.failure.code).toBe("unbound");
    expect(unbound.sourceCatalog().entries).toHaveLength(0);
    expect(unbound.sourceCatalog().prerequisite?.kind).toBe("sign-in");
    expect(unbound.byofPrerequisite().nextAction.kind).toBe("connect-source");
    expect(unbound.sourceFlows()).toHaveLength(0);
    expect(unbound.currentToken()).toBeNull();
    app.dispose();
  });

  it("the bound composition's first-run surface reports bound: true", () => {
    const { app, firstRun } = bootFirstRun();
    expect(firstRun.bound).toBe(true);
    app.dispose();
  });
});
