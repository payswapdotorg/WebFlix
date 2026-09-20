/**
 * R22-I — the Desktop Model & AI management surface tests.
 *
 * THE PARITY LAWS, proven against the REAL composition root
 * (`createDesktopApp` with the first-run block bound — the management
 * surface rides the same session-scoped transport):
 *
 * - THE R22-C PARITY: the management view is the SHARED derivation
 *   VERBATIM (the binding summary, the first-party context rows, the
 *   derived verify/usable truth that names WHY a bound provider is not
 *   in use, the per-task privacy truth with the honest null + the
 *   fail-closed effective class, the single frozen ADD action, the
 *   honest empty-state sentence);
 * - ADD/BIND: the R22-C pre-flight mirrors the service's own rules (the
 *   SAME honest field errors before the round trip); the key is the
 *   secret ON ITS WAY IN (the answer is the secret-free handle ONLY;
 *   the refreshed view is machine-checked secret-free); a successful
 *   add refreshes the view;
 * - REMOVE/UNBIND: the typed operation with the R22-C recovery mapping
 *   on every transport failure (never a dead end);
 * - THE PER-TASK POLICY write lands and refreshes the task's truth;
 * - LOCAL-MODEL AVAILABILITY is the registry's own truth (the
 *   first-party local rows + the frozen platform note); the Desktop
 *   endpoint hints are INPUT SUGGESTIONS (labeled honestly — never
 *   capability claims);
 * - ANONYMOUS: every operation answers the typed sign-in-again recovery
 *   (BYOM belongs to the account); the read answers the honest
 *   first-party-only truth;
 * - THE COPY LAW: every string the surface can project passes the
 *   frozen stale-copy sweep; the UNBOUND composition answers the honest
 *   typed verdicts.
 */

import { describe, expect, it } from "bun:test";

import { isStaleCompletionCopy } from "@wfx/client-runtime";

import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import {
  modelManagementCopyStrings,
  DESKTOP_LOCAL_MODEL_PLATFORM_NOTE,
} from "../src/surface/model-management-surface";
import { jsonResponse, StubFetch } from "./discoverability-harness";
import { SimShell, SimEngineProcess } from "./shell-simulator";
import { FixedClock, SequentialIdGen } from "@wfx/client-runtime";
import { makeProviderRow, makeSession, R22_API_BASE, R22_T0 } from "./r22-fixtures";

const TOKEN = "wfxsess_r22testtoken0000000000000000";
const CONTEXT = { userId: "wfx-desktop-user", sessionId: "wfx-desktop-session", locale: "en" };

function bootManagement() {
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
    firstRun: { apiBase: R22_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 },
  });
  return { app, shell, stub, management: app.modelManagement, firstRun: app.firstRun };
}

async function signIn(stub: StubFetch) {
  stub.script(
    (url) => url.endsWith("/auth/register"),
    () => jsonResponse({ token: TOKEN, session: makeSession() }),
  );
}

function scriptProviders(stub: StubFetch, rows: readonly unknown[]) {
  stub.script(
    (url) => url.endsWith("/experience/model-providers"),
    () => jsonResponse(rows),
  );
}

const MODEL_TASK_IDS: readonly string[] = [
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

function scriptPolicies(stub: StubFetch, policyOf: (task: string) => unknown) {
  // The stub's respond callback is argless — script each task's exact URL.
  for (const task of MODEL_TASK_IDS) {
    stub.script(
      (url) => url === `https://experience.webflix.invalid/api/experience/model-policy?task=${task}`,
      () => jsonResponse(policyOf(task)),
    );
  }
}

describe("R22-I — the R22-C parity (the management view, VERBATIM)", () => {
  it("the refreshed view carries the binding summary + the first-party context rows", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [
      makeProviderRow(),
      makeProviderRow({
        id: "my-openai",
        privacy: "cloud",
        capabilities: ["translation", "summary"],
        byomBound: true,
        costs: { translation: 4 },
      }),
    ]);
    scriptPolicies(stub, () => null);
    const view = await management.refreshManagement();
    expect(view.bound.map((entry) => entry.providerId)).toEqual(["my-openai"]);
    expect(view.firstParty.map((entry) => entry.providerId)).toEqual(["wfx-first-party"]);
    // The single frozen ADD action (the design language: one obvious primary action).
    expect(view.addAction.kind).toBe("add");
    expect(view.addAction.label).toBe("Add your model provider");
    // No BYOM binding is NOT the empty state here (one is bound).
    expect(view.emptyDetail).toBeNull();
    app.dispose();
  });

  it("the honest empty state: no BYOM provider bound (present tense, never stale copy)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [makeProviderRow()]);
    scriptPolicies(stub, () => null);
    const view = await management.refreshManagement();
    expect(view.bound).toHaveLength(0);
    expect(view.emptyDetail).not.toBeNull();
    expect(view.emptyDetail).toContain("built-in local model keeps working");
    app.dispose();
  });

  it("the derived verify/usable truth names WHY a bound cloud provider is not in use (fail-closed)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [
      makeProviderRow(),
      makeProviderRow({
        id: "my-openai",
        privacy: "cloud",
        capabilities: ["translation"],
        byomBound: true,
        costs: { translation: 4 },
      }),
    ]);
    // No stored policy for translation → the honest null + the fail-closed
    // local-only effective class → the cloud provider is NOT usable and
    // the view NAMES why (never a fabricated "works").
    scriptPolicies(stub, () => null);
    const view = await management.refreshManagement();
    const bound = view.bound[0]!;
    expect(bound.stateLabel).toBe("Added — not in use");
    const translation = bound.taskUsability.find((row) => row.task === "translation")!;
    expect(translation.usable).toBe(false);
    expect(translation.unusableReason).toContain("only uses local models");
    // The per-task privacy truth: the honest null + the effective class.
    const policy = view.taskPolicies.find((row) => row.task === "translation")!;
    expect(policy.policyPrivacy).toBeNull();
    expect(policy.effectivePrivacy).toBe("local-only");
    app.dispose();
  });

  it("a stored policy admitting cloud models flips the usability truth (the derived law)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [
      makeProviderRow(),
      makeProviderRow({
        id: "my-openai",
        privacy: "cloud",
        capabilities: ["translation"],
        byomBound: true,
        costs: { translation: 4 },
      }),
    ]);
    scriptPolicies(stub, (task) =>
      task === "translation"
        ? { task, preferredProvider: "my-openai", fallbackProviders: ["wfx-first-party"], privacy: "any-cloud" }
        : null,
    );
    const view = await management.refreshManagement();
    const bound = view.bound[0]!;
    expect(bound.stateLabel).toBe("Added");
    expect(bound.taskUsability.find((row) => row.task === "translation")?.usable).toBe(true);
    const policy = view.taskPolicies.find((row) => row.task === "translation")!;
    expect(policy.policyPrivacy).toBe("any-cloud");
    expect(policy.effectivePrivacy).toBe("any-cloud");
    app.dispose();
  });
});

describe("R22-I — add / remove / policy (the typed operations)", () => {
  it("addProvider pre-flights the R22-C rules (the SAME honest field errors, no round trip)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    const result = await management.addProvider({
      providerId: "",
      endpointUrl: "ftp://not-http",
      key: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("invalid-input");
      expect(result.failure.recovery.kind).toBe("fix-and-retry");
      expect(result.failure.detail).toContain("web address");
    }
    // No bind round trip happened (the pre-flight answered).
    expect(stub.requests.filter((request) => request.url.includes("/byom/"))).toHaveLength(0);
    app.dispose();
  });

  it("addProvider binds through the transport and refreshes the view (the handle is secret-free)", async () => {
    const { app, shell, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    stub.script(
      (url) => url.endsWith("/experience/model-providers/byom/my-openai"),
      () => jsonResponse({
        id: "wfxbyom_1",
        providerId: "my-openai",
        endpointUrl: "http://localhost:11434",
        keyId: "key-1",
        metadata: null,
        createdAt: new Date(R22_T0).toISOString(),
        updatedAt: new Date(R22_T0).toISOString(),
      }),
    );
    scriptProviders(stub, [
      makeProviderRow(),
      makeProviderRow({
        id: "my-openai",
        privacy: "cloud",
        capabilities: ["translation"],
        byomBound: true,
        costs: { translation: 4 },
      }),
    ]);
    scriptPolicies(stub, () => null);
    const result = await management.addProvider({
      providerId: "my-openai",
      endpointUrl: "http://localhost:11434",
      key: "sk-the-secret-key",
      capabilities: ["translation"],
      costPerCall: 4,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe("my-openai");
    // The view refreshed: the binding summary now carries the provider.
    expect(management.managementView().bound.map((entry) => entry.providerId)).toEqual(["my-openai"]);
    // THE SECRET LAW: the key never appears in the view (or the keychain).
    const serialized = JSON.stringify(management.managementView());
    expect(serialized.includes("sk-the-secret-key")).toBe(false);
    expect((await shell.authStoreGet())?.payload.includes("sk-the-secret-key")).toBe(false);
    // The key crossed the command body exactly once (sealed server-side).
    const bindRequests = stub.requests.filter((request) => request.url.endsWith("/byom/my-openai"));
    expect(bindRequests).toHaveLength(1);
    expect(JSON.parse(bindRequests[0]!.body!).key).toBe("sk-the-secret-key");
    app.dispose();
  });

  it("a bind transport failure answers the R22-C recovery (never a dead end)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    stub.script(
      (url) => url.endsWith("/experience/model-providers/byom/my-openai"),
      () => jsonResponse({ error: "unauthorized" }, 401),
    );
    const result = await management.addProvider({
      providerId: "my-openai",
      endpointUrl: "http://localhost:11434",
      key: "sk-the-secret-key",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("unauthorized");
      expect(result.failure.recovery.kind).toBe("sign-in-again");
      expect(result.failure.recovery.label).toBe("Sign in again");
    }
    app.dispose();
  });

  it("removeProvider unbinds and the view loses the binding (the delete discipline)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    stub.script(
      (url) => url.endsWith("/experience/model-providers/byom/my-openai"),
      () => jsonResponse({ revoked: true }),
    );
    scriptProviders(stub, [makeProviderRow()]);
    scriptPolicies(stub, () => null);
    const result = await management.removeProvider("my-openai");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerId).toBe("my-openai");
    expect(management.managementView().bound).toHaveLength(0);
    // The honest empty state returned (present tense).
    expect(management.managementView().emptyDetail).not.toBeNull();
    app.dispose();
  });

  it("setTaskPolicy writes the policy and refreshes the task's truth", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [makeProviderRow()]);
    scriptPolicies(stub, () => null);
    await management.refreshManagement();
    // The write lands (the bare PUT route)…
    stub.script(
      (url) => url === "https://experience.webflix.invalid/api/experience/model-policy",
      () => jsonResponse({ written: true }),
    );
    // …and the refreshed read for 'translation' answers the stored policy.
    stub.script(
      (url) => url === "https://experience.webflix.invalid/api/experience/model-policy?task=translation",
      () => jsonResponse({
        task: "translation",
        preferredProvider: "wfx-first-party",
        fallbackProviders: [],
        privacy: "trusted-cloud",
      }),
    );
    const result = await management.setTaskPolicy("translation", {
      task: "translation",
      preferredProvider: "wfx-first-party",
      fallbackProviders: [],
      privacy: "trusted-cloud",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("translation");
    const written = stub.requests.some(
      (request) => request.method === "PUT" && request.url.includes("/experience/model-policy"),
    );
    expect(written).toBe(true);
    // The task's truth refreshed: the honest stored class (not the null).
    const policy = management.managementView().taskPolicies.find((row) => row.task === "translation")!;
    expect(policy.policyPrivacy).toBe("trusted-cloud");
    expect(policy.effectivePrivacy).toBe("trusted-cloud");
    app.dispose();
  });

  it("an anonymous composition answers the typed sign-in-again recovery on every operation", async () => {
    const { app, stub, management } = bootManagement();
    void stub;
    const add = await management.addProvider({
      providerId: "my-openai",
      endpointUrl: "http://localhost:11434",
      key: "sk-the-secret-key",
    });
    expect(add.ok).toBe(false);
    if (!add.ok) {
      expect(add.failure.kind).toBe("anonymous");
      expect(add.failure.recovery.kind).toBe("sign-in-again");
    }
    const remove = await management.removeProvider("my-openai");
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.failure.kind).toBe("anonymous");
    const policy = await management.setTaskPolicy("translation", {
      task: "translation",
      preferredProvider: "wfx-first-party",
      fallbackProviders: [],
      privacy: "local-only",
    });
    expect(policy.ok).toBe(false);
    if (!policy.ok) expect(policy.failure.kind).toBe("anonymous");
    // The read answers the honest empty truth (never a fabricated binding).
    const view = await management.refreshManagement();
    expect(view.bound).toHaveLength(0);
    app.dispose();
  });
});

describe("R22-I — the local-model truth + the native affordance", () => {
  it("the local-model truth is the registry's own rows + the frozen platform note", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [
      makeProviderRow(),
      makeProviderRow({ id: "wfx-cloud-service", privacy: "cloud", capabilities: ["translation"], byomBound: false, costs: {} }),
    ]);
    scriptPolicies(stub, () => null);
    await management.refreshManagement();
    const truth = management.localModelTruth();
    expect(truth.available).toBe(true);
    expect(truth.rows.map((row) => row.providerId)).toEqual(["wfx-first-party"]);
    expect(truth.rows[0]?.privacyLabel).toBe("Runs on this device");
    expect(truth.platformNote).toBe(DESKTOP_LOCAL_MODEL_PLATFORM_NOTE);
    expect(truth.platformNote).toContain("Local-model execution runs on this Desktop app");
    app.dispose();
  });

  it("an unavailable local row answers available: false honestly (never a fabricated runtime)", async () => {
    const { app, stub, management } = bootManagement();
    await signIn(stub);
    await app.firstRun.createAccount({ email: "viewer@example.com", password: "correct horse battery" });
    scriptProviders(stub, [makeProviderRow({ availability: "unsupported" })]);
    scriptPolicies(stub, () => null);
    await management.refreshManagement();
    expect(management.localModelTruth().available).toBe(false);
    app.dispose();
  });

  it("the endpoint hints are labeled INPUT SUGGESTIONS (never capability claims)", () => {
    const { app, management } = bootManagement();
    const hints = management.localEndpointHints();
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) {
      expect(hint.url.startsWith("http://localhost") || hint.url.startsWith("http://127.0.0.1")).toBe(true);
      // The honest suggestion language names what the hint IS.
      expect(hint.detail).toContain("edit");
      expect(hint.detail).toContain("checks what actually answers");
    }
    app.dispose();
  });
});

describe("R22-I — the copy law + the unbound truth", () => {
  it("every string the surface can project passes the frozen stale-copy sweep", () => {
    const strings = modelManagementCopyStrings({
      providers: [
        makeProviderRow(),
        makeProviderRow({
          id: "my-openai",
          privacy: "cloud",
          capabilities: ["translation"],
          byomBound: true,
          costs: { translation: 4 },
        }),
      ],
    });
    expect(strings.length).toBeGreaterThan(8);
    for (const text of strings) {
      expect(isStaleCompletionCopy(text)).toBe(false);
    }
  });

  it("the UNBOUND composition answers the honest typed verdicts", async () => {
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
    const unbound = app.modelManagement;
    expect(unbound.bound).toBe(false);
    expect(unbound.managementView().bound).toHaveLength(0);
    expect(unbound.managementView().firstParty).toHaveLength(0);
    const add = await unbound.addProvider({
      providerId: "my-openai",
      endpointUrl: "http://localhost:11434",
      key: "sk-the-secret-key",
    });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.failure.kind).toBe("unbound");
    const remove = await unbound.removeProvider("my-openai");
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.failure.kind).toBe("unbound");
    expect(unbound.localEndpointHints()).toHaveLength(0);
    expect(unbound.localModelTruth().available).toBe(false);
    app.dispose();
  });

  it("the bound composition's management surface reports bound: true", async () => {
    const { app, management } = bootManagement();
    expect(management.bound).toBe(true);
    app.dispose();
  });
});
