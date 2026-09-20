/**
 * @wfx/client-runtime — the model-controls store tests (R21-C).
 *
 * The read/write model laws over the R06 ServerPort extension:
 * - honest availability: a port WITHOUT the optional ops answers the
 *   typed `unavailable` error model naming the missing transport (never
 *   a fake empty/absent state);
 * - in-model degradation: a failing read keeps the LAST observed truth
 *   visible alongside the typed error (never a fake empty list);
 * - the honest null: an unset policy is null, never a fabricated
 *   default-as-if-configured;
 * - writes answer the typed `ServerResult` verbatim; a successful policy
 *   write refreshes the observed view from the server's own truth;
 * - the runtime wiring: `runtime.modelControls` (ADD-ONLY).
 */

import { describe, expect, it } from "bun:test";

import type {
  ModelProviderInfo,
  ServerPort,
  ServerResult,
  TransformOperation,
} from "../src/server-port";
import type { ModelPolicy, ModelTask } from "@wfx/domain";
import {
  createModelControlsStore,
  createRuntime,
  makeWebCapabilities,
  InMemoryServerPort,
} from "../src/index";

const POLICY: ModelPolicy = {
  task: "translation",
  preferredProvider: "wfx-first-party",
  fallbackProviders: ["wfx-first-party"],
  privacy: "local-only",
};

const PROVIDERS: readonly ModelProviderInfo[] = [
  {
    id: "wfx-first-party",
    privacy: "local",
    capabilities: ["translation", "summary"],
    byomBound: false,
    costs: { translation: 0 },
    availability: "available",
  },
];

const OPERATION: TransformOperation = {
  id: "wfxtx_00000000000000000000000001",
  kind: "translation",
  targetRef: "conn-1:ref-1",
  options: {},
  state: "queued",
  progress: null,
  resultRef: null,
  errorDetail: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

/** A port that implements ONLY the required members (the partial-port law). */
function partialPort(): ServerPort {
  const base = new InMemoryServerPort();
  return {
    serviceId: base.serviceId,
    search: (q) => base.search(q),
    shorts: (q) => base.shorts(q),
    metadata: (r) => base.metadata(r),
    resolve: (r) => base.resolve(r),
    executeAction: (a) => base.executeAction(a),
    readLibrary: () => base.readLibrary(),
    writeLibrary: (c) => base.writeLibrary(c),
    emitEvent: (e) => base.emitEvent(e),
    readHistory: () => base.readHistory(),
    readProfileLibrary: () => base.readProfileLibrary(),
    readIntents: () => base.readIntents(),
    writeIntent: (i) => base.writeIntent(i),
    readPolicy: () => base.readPolicy(),
    writePolicy: (p) => base.writePolicy(p),
    readSources: () => base.readSources(),
    // readModelPolicy / writeModelPolicy / readModelProviders / byom /
    // transforms: deliberately ABSENT (the partial port).
  };
}

/** A scripted full R06 port (answers + failure injection). */
class ScriptedModelPort extends InMemoryServerPort {
  nextPolicy: ServerResult<ModelPolicy | null> = { ok: true, value: null };
  nextPolicyFailure: ServerResult<ModelPolicy | null> | null = null;
  nextProviders: ServerResult<readonly ModelProviderInfo[]> = { ok: true, value: PROVIDERS };
  nextProvidersFailure: ServerResult<readonly ModelProviderInfo[]> | null = null;
  modelPolicyWrites: unknown[] = [];
  transformWrites: unknown[] = [];

  async readModelPolicy(): Promise<ServerResult<ModelPolicy | null>> {
    if (this.nextPolicyFailure !== null) return this.nextPolicyFailure;
    return this.nextPolicy;
  }
  async writeModelPolicy(command: { task: ModelTask; privacy: ModelPolicy["privacy"]; preferredProvider?: string; fallbackProviders: readonly string[] }): Promise<ServerResult<void>> {
    this.modelPolicyWrites.push(command);
    // The realistic server: the post-write read answers the stored policy.
    this.nextPolicy = {
      ok: true,
      value: {
        task: command.task,
        fallbackProviders: [...command.fallbackProviders],
        privacy: command.privacy,
        ...(command.preferredProvider !== undefined ? { preferredProvider: command.preferredProvider } : {}),
      },
    };
    return { ok: true, value: undefined };
  }
  async readModelProviders(): Promise<ServerResult<readonly ModelProviderInfo[]>> {
    if (this.nextProvidersFailure !== null) return this.nextProvidersFailure;
    return this.nextProviders;
  }
  async bindByomProvider(): Promise<ServerResult<never>> {
    throw new Error("not scripted");
  }
  async unbindByomProvider(): Promise<ServerResult<void>> {
    return { ok: true, value: undefined };
  }
  async submitTransform(command: unknown): Promise<ServerResult<TransformOperation>> {
    this.transformWrites.push(command);
    return { ok: true, value: OPERATION };
  }
  async readTransform(): Promise<ServerResult<TransformOperation>> {
    return { ok: true, value: OPERATION };
  }
  async cancelTransform(): Promise<ServerResult<TransformOperation>> {
    return { ok: true, value: { ...OPERATION, state: "cancelled" } };
  }
  async clearTransformResult(): Promise<ServerResult<TransformOperation>> {
    return { ok: true, value: { ...OPERATION, state: "succeeded", resultRef: null } };
  }
}

describe("R21-C model-controls — honest availability (the partial-port law)", () => {
  it("a port without the R06 ops answers the typed unavailable ERROR model naming the transport", async () => {
    const store = createModelControlsStore(partialPort());
    const policy = await store.refreshPolicy("translation");
    expect(policy.status.state).toBe("error");
    expect(policy.status.error?.kind).toBe("unavailable");
    expect(policy.status.error?.detail).toContain("readModelPolicy");
    expect(policy.policy).toBeNull();

    const providers = await store.refreshProviders();
    expect(providers.status.state).toBe("error");
    expect(providers.status.error?.detail).toContain("readModelProviders");
    expect(providers.providers).toHaveLength(0);
  });

  it("the write ops answer the typed unavailable failure (never a fabricated success)", async () => {
    const store = createModelControlsStore(partialPort());
    const write = await store.writePolicy({
      task: "translation",
      fallbackProviders: ["wfx-first-party"],
      privacy: "local-only",
    });
    expect(write).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const submit = await store.submitTransform({ kind: "translation", input: {} });
    expect(submit).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const bind = await store.bindByomProvider({
      providerId: "p",
      endpointUrl: "https://m.example",
      key: "k",
    });
    expect(bind).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const unbind = await store.unbindByomProvider("p");
    expect(unbind).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const cancel = await store.cancelTransform("wfxtx_1");
    expect(cancel).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const clear = await store.clearTransformResult("wfxtx_1");
    expect(clear).toMatchObject({ ok: false, failure: { kind: "unavailable" } });

    const read = await store.readTransform("wfxtx_1");
    expect(read).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });
});

describe("R21-C model-controls — the read models (typed, in-model degradation)", () => {
  it("the honest null policy stays null (never a fabricated default)", async () => {
    const port = new ScriptedModelPort();
    const store = createModelControlsStore(port);
    const policy = await store.refreshPolicy("translation");
    expect(policy.status.state).toBe("ready");
    expect(policy.policy).toBeNull();
  });

  it("a set policy answers verbatim; the cached view survives", async () => {
    const port = new ScriptedModelPort();
    port.nextPolicy = { ok: true, value: POLICY };
    const store = createModelControlsStore(port);
    const policy = await store.refreshPolicy("translation");
    expect(policy.policy).toEqual(POLICY);
    // The cache view without a re-refresh:
    expect(store.policy("translation").policy).toEqual(POLICY);
    expect(store.policy("translation").status.state).toBe("ready");
  });

  it("a failing read keeps the LAST observed policy visible alongside the typed error", async () => {
    const port = new ScriptedModelPort();
    port.nextPolicy = { ok: true, value: POLICY };
    const store = createModelControlsStore(port);
    await store.refreshPolicy("translation");
    // Now the read fails (the service went away):
    port.nextPolicyFailure = {
      ok: false,
      failure: { kind: "unavailable", detail: "the model-policy read did not complete" },
    };
    const degraded = await store.refreshPolicy("translation");
    expect(degraded.status.state).toBe("error");
    expect(degraded.status.error?.kind).toBe("unavailable");
    // The LAST observed truth stays visible — never a fake empty.
    expect(degraded.policy).toEqual(POLICY);
  });

  it("a failing providers read keeps the last observed rows; a good read replaces them", async () => {
    const port = new ScriptedModelPort();
    const store = createModelControlsStore(port);
    const first = await store.refreshProviders();
    expect(first.providers).toEqual(PROVIDERS);
    port.nextProvidersFailure = {
      ok: false,
      failure: { kind: "network", detail: "offline" },
    };
    const degraded = await store.refreshProviders();
    expect(degraded.status.state).toBe("error");
    expect(degraded.providers).toEqual(PROVIDERS); // last observed stays
  });
});

describe("R21-C model-controls — the write paths (typed verbatim)", () => {
  it("a successful policy write refreshes the observed view from the server's truth", async () => {
    const port = new ScriptedModelPort();
    const store = createModelControlsStore(port);
    expect(store.policy("translation").policy).toBeNull(); // the honest null before
    const write = await store.writePolicy({
      task: "translation",
      preferredProvider: "wfx-first-party",
      fallbackProviders: ["wfx-first-party"],
      privacy: "local-only",
    });
    expect(write.ok).toBe(true);
    // The store refreshed the observed view from the SERVER's post-write
    // truth (never a fabricated local echo):
    const view = store.policy("translation");
    expect(view.policy).toMatchObject({
      task: "translation",
      privacy: "local-only",
      preferredProvider: "wfx-first-party",
    });
    expect(view.status.state).toBe("ready");
    expect(port.modelPolicyWrites).toHaveLength(1);
  });

  it("a failing policy write answers the typed failure verbatim (never a fabricated success)", async () => {
    const port = new ScriptedModelPort();
    port.writeModelPolicy = async () => ({
      ok: false,
      failure: { kind: "unavailable", detail: "the service cannot serve this write" },
    });
    const store = createModelControlsStore(port);
    const write = await store.writePolicy({
      task: "translation",
      fallbackProviders: [],
      privacy: "local-only",
    });
    expect(write).toMatchObject({ ok: false, failure: { kind: "unavailable" } });
  });

  it("the transform operations pass through typed (submit/read/cancel/clear)", async () => {
    const port = new ScriptedModelPort();
    const store = createModelControlsStore(port);
    const submitted = await store.submitTransform({ kind: "translation", input: { ref: "r" } });
    expect(submitted).toMatchObject({ ok: true, value: { state: "queued" } });

    const read = await store.readTransform("wfxtx_00000000000000000000000001");
    expect(read).toMatchObject({ ok: true });

    const cancelled = await store.cancelTransform("wfxtx_00000000000000000000000001");
    expect(cancelled).toMatchObject({ ok: true, value: { state: "cancelled" } });

    const cleared = await store.clearTransformResult("wfxtx_00000000000000000000000001");
    expect(cleared).toMatchObject({ ok: true, value: { state: "succeeded" } });
  });
});

describe("R21-C model-controls — the runtime wiring (ADD-ONLY)", () => {
  it("createRuntime exposes runtime.modelControls over the real runtime", async () => {
    const runtime = createRuntime(
      makeWebCapabilities(),
      new ScriptedModelPort(),
      {
        context: { userId: "wfx-anonymous", sessionId: "s-1", locale: "en" },
        clock: { now: () => 0 },
        ids: { next: () => "00000000000000000000000001" },
      },
    );
    const policy = await runtime.modelControls.refreshPolicy("translation");
    expect(policy.status.state).toBe("ready");
    expect(policy.policy).toBeNull(); // the honest null
    const providers = await runtime.modelControls.refreshProviders();
    expect(providers.providers[0]?.id).toBe("wfx-first-party");
  });
});
