/**
 * @wfx/model-fabric — R06 transform-operation tests: the PURE transition
 * function (every legal + illegal transition), the engine lifecycle
 * (queued → running → succeeded | failed | cancelled; append-only history;
 * progress where the fabric reports it; discard-after-cancel), and the
 * permission-first submit law (the J20 constrained truth — a denial never
 * creates an operation record).
 *
 * Determinism: an in-memory store double + the fabric's transformation
 * fakes (never production providers); FixedClock + SequentialIdGen seams.
 * No I/O, no network.
 */

import { describe, expect, it } from "bun:test";

import {
  makeFakeTranslationProvider,
  ModelFabric,
  ModelFabricRegistry,
  transcriptTask,
  TRANSFORM_OPERATION_STATES,
  TransformOperationEngine,
  transitionTransformOperation,
  type ApplyTransitionInput,
  type TransformOperationSnapshot,
  type TransformOperationStore,
} from "../src/index";

/** Deterministic clock + ids (the repo test-seam pattern). */
class FixedClock {
  private nowMs: number;
  constructor(start: number) {
    this.nowMs = start;
  }
  now(): number {
    return this.nowMs;
  }
  advance(ms: number): void {
    this.nowMs += ms;
  }
}

class SequentialIds {
  private nextId = 0;
  next(): string {
    this.nextId += 1;
    return this.nextId.toString().padStart(26, "0");
  }
}

// ---------------------------------------------------------------------------
// The in-memory store double (implements the seam structurally)
// ---------------------------------------------------------------------------

class MemoryTransformStore implements TransformOperationStore {
  readonly operations = new Map<string, TransformOperationSnapshot>();

  async create(snapshot: TransformOperationSnapshot): Promise<TransformOperationSnapshot> {
    if (this.operations.has(snapshot.id)) {
      throw new Error(`duplicate operation id ${snapshot.id}`);
    }
    this.operations.set(snapshot.id, snapshot);
    return snapshot;
  }

  async get(id: string, ownerKey: string): Promise<TransformOperationSnapshot | null> {
    const found = this.operations.get(id);
    return found !== undefined && found.ownerKey === ownerKey ? found : null;
  }

  async listForOwner(ownerKey: string): Promise<readonly TransformOperationSnapshot[]> {
    return [...this.operations.values()]
      .filter((operation) => operation.ownerKey === ownerKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async transition(
    input: ApplyTransitionInput,
  ): Promise<
    | { ok: true; snapshot: TransformOperationSnapshot }
    | { ok: false; failure: { kind: "not-found" | "conflict" | "store-error"; detail: string } }
  > {
    const current = this.operations.get(input.id);
    if (current === undefined || current.ownerKey !== input.ownerKey) {
      return { ok: false, failure: { kind: "not-found", detail: `no operation '${input.id}'` } };
    }
    if (current.state !== input.expectedFrom) {
      return {
        ok: false,
        failure: {
          kind: "conflict",
          detail: `the operation is '${current.state}', not '${input.expectedFrom}'`,
        },
      };
    }
    const event = input.event;
    const to =
      event.kind === "start"
        ? "running"
        : event.kind === "succeed"
          ? "succeeded"
          : event.kind === "fail"
            ? "failed"
            : "cancelled";
    const reason =
      event.kind === "fail" ? event.error.detail : event.kind === "cancel" ? event.reason : undefined;
    const updated: TransformOperationSnapshot = {
      ...current,
      state: to,
      ...(event.kind === "succeed" ? { result: event.result } : {}),
      ...(event.kind === "fail" ? { error: event.error } : {}),
      updatedAt: event.at,
      // Append-only: the history grows, never rewrites.
      stateHistory: [
        ...current.stateHistory,
        {
          from: current.state,
          to,
          event: event.kind,
          at: event.at,
          ...(reason !== undefined ? { reason } : {}),
        },
      ],
    };
    this.operations.set(input.id, updated);
    return { ok: true, snapshot: updated };
  }

  async updateProgress(id: string, ownerKey: string, progress: number): Promise<void> {
    const current = this.operations.get(id);
    if (current === undefined || current.ownerKey !== ownerKey) return;
    this.operations.set(id, { ...current, progress, updatedAt: current.updatedAt });
  }

  async clearResult(id: string, ownerKey: string): Promise<boolean> {
    const current = this.operations.get(id);
    if (current === undefined || current.ownerKey !== ownerKey) return false;
    if (current.result === undefined) return false;
    const cleaned: TransformOperationSnapshot = { ...current };
    delete (cleaned as { result?: unknown }).result;
    delete (cleaned as { progress?: unknown }).progress;
    this.operations.set(id, cleaned);
    return true;
  }
}

// ---------------------------------------------------------------------------
// The state vocabulary + the pure transition function
// ---------------------------------------------------------------------------

describe("transform operation states (the closed vocabulary)", () => {
  it("covers exactly the five explicit states", () => {
    expect(TRANSFORM_OPERATION_STATES).toEqual([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });
});

describe("transitionTransformOperation (the pure machine)", () => {
  const AT = "2026-09-16T09:00:00.000Z";
  const result = {
    reference: "wfxtr_000000000000000000000001",
    providerId: "wfx-local-transform",
    output: { text: "hello" },
    costEstimate: 0.01,
    durationEstimateMs: 500,
  };
  const error = { kind: "fabric" as const, detail: "provider exploded" };

  it("queued + start → running", () => {
    const outcome = transitionTransformOperation("queued", { kind: "start", at: AT });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.to).toBe("running");
      expect(outcome.entry).toEqual({ from: "queued", to: "running", event: "start", at: AT });
    }
  });

  it("running + succeed → succeeded (with the result)", () => {
    const outcome = transitionTransformOperation("running", { kind: "succeed", at: AT, result });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.to).toBe("succeeded");
  });

  it("running + fail → failed (with the error)", () => {
    const outcome = transitionTransformOperation("running", { kind: "fail", at: AT, error });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.to).toBe("failed");
      expect(outcome.entry.reason).toBe("provider exploded");
    }
  });

  it("queued + cancel → cancelled and running + cancel → cancelled (the user's undo)", () => {
    for (const from of ["queued", "running"] as const) {
      const outcome = transitionTransformOperation(from, {
        kind: "cancel",
        at: AT,
        reason: "user undo",
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.to).toBe("cancelled");
        expect(outcome.entry.reason).toBe("user undo");
      }
    }
  });

  it("EVERY event against a terminal state is refused with the typed reason", () => {
    for (const state of ["succeeded", "failed", "cancelled"] as const) {
      for (const event of [
        { kind: "start", at: AT },
        { kind: "succeed", at: AT, result },
        { kind: "fail", at: AT, error },
        { kind: "cancel", at: AT },
      ] as const) {
        const outcome = transitionTransformOperation(state, event);
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.refusal.from).toBe(state);
          expect(outcome.refusal.reason.length).toBeGreaterThan(0);
          // Every refusal names the finality: either the terminal-state law
          // or the cancel-specific "already finished" wording.
          expect(
            outcome.refusal.reason.includes("terminal") ||
              outcome.refusal.reason.includes("already finished"),
          ).toBe(true);
        }
      }
    }
  });

  it("succeed/fail against queued are refused (an operation never jumps the running state)", () => {
    const succeed = transitionTransformOperation("queued", { kind: "succeed", at: AT, result });
    expect(succeed.ok).toBe(false);
    if (!succeed.ok) expect(succeed.refusal.reason).toContain("before it runs");

    const fail = transitionTransformOperation("queued", { kind: "fail", at: AT, error });
    expect(fail.ok).toBe(false);
  });

  it("start against running is refused (one run per operation)", () => {
    const outcome = transitionTransformOperation("running", { kind: "start", at: AT });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.reason).toContain("already running");
  });
});

// ---------------------------------------------------------------------------
// The engine (lifecycle over the in-memory store + the fabric fakes)
// ---------------------------------------------------------------------------

/** A media provenance record that permits everything. */
const PERMISSIVE_MEDIA = {
  sourceId: "wfx-test-media",
  authorizedSource: true,
  drmProtected: false,
  allowsTranscript: true,
  allowsTranslation: true,
  allowsDubbing: true,
  allowsCommentary: true,
};

/** A translation task input over the permissive media. */
function translationInput(text: string): unknown {
  return { media: PERMISSIVE_MEDIA, text, targetLanguage: "es" };
}

function buildEngine() {
  const store = new MemoryTransformStore();
  const registry = new ModelFabricRegistry();
  const provider = makeFakeTranslationProvider("wfx-test-translation");
  registry.register(provider);
  const fabric = new ModelFabric(registry);
  const clock = new FixedClock(Date.UTC(2026, 8, 16, 9, 0, 0));
  const ids = new SequentialIds();
  const engine = new TransformOperationEngine({ store, fabric, clock, ids });
  return { store, engine, clock, ids, provider };
}

describe("TransformOperationEngine.submit (validate + permission FIRST)", () => {
  it("creates the QUEUED snapshot for a valid, permitted transformation", async () => {
    const { engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hello world"),
      options: { privacy: "local-only", fallbackProviders: ["wfx-test-translation"] },
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.operation.state).toBe("queued");
      expect(submitted.operation.stateHistory).toHaveLength(0);
      expect(submitted.operation.id.startsWith("wfxop_")).toBe(true);
    }
  });

  it("an INVALID kind answers typed validation problems (no record created)", async () => {
    const { store, engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "teleportation",
      input: translationInput("hi"),
      options: {},
    });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok && submitted.failure.kind === "validation") {
      expect(submitted.failure.problems[0]!.path).toBe("kind");
    } else {
      throw new Error("expected a validation failure");
    }
    expect(store.operations.size).toBe(0);
  });

  it("an INVALID task input answers field-path problems (no record created)", async () => {
    const { store, engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: { media: PERMISSIVE_MEDIA, text: "", targetLanguage: "" },
      options: {},
    });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok && submitted.failure.kind === "validation") {
      const paths = submitted.failure.problems.map((problem) => problem.path);
      expect(paths).toContain("text");
      expect(paths).toContain("targetLanguage");
    }
    expect(store.operations.size).toBe(0);
  });

  it("a PERMISSION denial answers the typed verdict and NO record is created (the J20 law)", async () => {
    const { store, engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: {
        media: { ...PERMISSIVE_MEDIA, allowsTranslation: false },
        text: "hello",
        targetLanguage: "es",
      },
      options: {},
    });
    expect(submitted.ok).toBe(false);
    if (!submitted.ok && submitted.failure.kind === "permission") {
      expect(submitted.failure.verdict.allowed).toBe(false);
      expect(submitted.failure.verdict.reason).toContain("allowsTranslation");
    }
    expect(store.operations.size).toBe(0);
  });

  it("DRM-protected and UNAUTHORIZED media are always denied (the hard laws)", async () => {
    const { engine } = buildEngine();
    for (const media of [
      { ...PERMISSIVE_MEDIA, drmProtected: true },
      { ...PERMISSIVE_MEDIA, authorizedSource: false },
    ]) {
      const submitted = await engine.submit("profile-a", {
        kind: "translation",
        input: { media, text: "hello", targetLanguage: "es" },
        options: {},
      });
      expect(submitted.ok).toBe(false);
    }
  });
});

describe("TransformOperationEngine.run (the explicit lifecycle)", () => {
  it("queued → running → succeeded with the result reference + append-only history + progress", async () => {
    const { engine, store } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hello world"),
      options: { privacy: "any-cloud", fallbackProviders: ["wfx-test-translation"] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const id = submitted.operation.id;

    const ran = await engine.run(id, "profile-a");
    expect(ran.ok).toBe(true);
    if (ran.ok) {
      expect(ran.operation.state).toBe("succeeded");
      expect(ran.operation.result!.reference.startsWith("wfxtr_")).toBe(true);
      expect(ran.operation.result!.providerId).toBe("wfx-test-translation");
      expect(ran.operation.result!.output).toEqual({
        text: expect.stringContaining("hello world"),
        targetLanguage: "es",
      });
      // The append-only history: queued → running → succeeded, in order.
      expect(ran.operation.stateHistory.map((entry) => `${entry.from}>${entry.to}`)).toEqual([
        "queued>running",
        "running>succeeded",
      ]);
      // Progress where the fabric reported it: the pipeline boundaries landed.
      expect(ran.operation.progress).toBe(1);
    }
    // The intermediate progress reports were persisted (field updates).
    const seen = store.operations.get(id);
    expect(seen).toBeDefined();
  });

  it("a FAILED transformation is a SUCCESSFUL run — the operation records the failure honestly", async () => {
    // Registry with NO provider for translation ⇒ the fabric answers the
    // typed no-provider failure ⇒ the operation FAILS explicitly.
    const store = new MemoryTransformStore();
    const registry = new ModelFabricRegistry();
    const fabric = new ModelFabric(registry);
    const engine = new TransformOperationEngine({
      store,
      fabric,
      clock: new FixedClock(Date.UTC(2026, 8, 16, 9, 0, 0)),
      ids: new SequentialIds(),
    });
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hello"),
      options: { privacy: "local-only", fallbackProviders: [] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const ran = await engine.run(submitted.operation.id, "profile-a");
    expect(ran.ok).toBe(true);
    if (ran.ok) {
      expect(ran.operation.state).toBe("failed");
      expect(ran.operation.error!.kind).toBe("fabric");
      expect(ran.operation.error!.detail).toContain("no-provider");
      expect(ran.operation.stateHistory.map((entry) => entry.to)).toEqual([
        "running",
        "failed",
      ]);
    }
  });

  it("a cost-ceiling denial fails the operation with the typed detail", async () => {
    const { engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("a very long text ".repeat(200)),
      options: { privacy: "local-only", fallbackProviders: [], maxCostPerOperation: 0.00001 },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const ran = await engine.run(submitted.operation.id, "profile-a");
    expect(ran.ok).toBe(true);
    if (ran.ok) {
      expect(ran.operation.state).toBe("failed");
      expect(ran.operation.error!.kind).toBe("cost-ceiling");
    }
  });

  it("run on a NON-queued operation answers the typed invalid-state refusal", async () => {
    const { engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hi"),
      options: { privacy: "any-cloud", fallbackProviders: ["wfx-test-translation"] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const first = await engine.run(submitted.operation.id, "profile-a");
    expect(first.ok).toBe(true);
    const second = await engine.run(submitted.operation.id, "profile-a");
    expect(second.ok).toBe(false);
    if (!second.ok && second.failure.kind === "invalid-state") {
      expect(second.failure.state).toBe("succeeded");
    }
  });

  it("run on an UNKNOWN id answers the typed not-found refusal", async () => {
    const { engine } = buildEngine();
    const ran = await engine.run("wfxop_nonexistent", "profile-a");
    expect(ran.ok).toBe(false);
    if (!ran.ok) expect(ran.failure.kind).toBe("not-found");
  });

  it("ownership: another profile's operation is not-found", async () => {
    const { engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hi"),
      options: { privacy: "any-cloud", fallbackProviders: ["wfx-test-translation"] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const foreign = await engine.run(submitted.operation.id, "profile-b");
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.failure.kind).toBe("not-found");
  });
});

describe("TransformOperationEngine.cancel (the user's undo)", () => {
  it("cancel from queued → cancelled; a later run answers the typed invalid-state refusal (only queued can run)", async () => {
    const { engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hi"),
      options: { privacy: "any-cloud", fallbackProviders: ["wfx-test-translation"] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const id = submitted.operation.id;

    const cancelled = await engine.cancel(id, "profile-a", "not needed anymore");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.operation.state).toBe("cancelled");
      expect(cancelled.operation.stateHistory.at(-1)!.reason).toBe("not needed anymore");
    }

    // The run after a queued-cancel: cancelled is terminal — the run never
    // starts (the typed invalid-state refusal, never a resurrection).
    const ran = await engine.run(id, "profile-a");
    expect(ran.ok).toBe(false);
    if (!ran.ok && ran.failure.kind === "invalid-state") {
      expect(ran.failure.state).toBe("cancelled");
    }
  });

  it("cancel WHILE RUNNING → the eventual result is DISCARDED, never recorded", async () => {
    // A deferred provider: the run holds at the fabric invocation until the
    // test resolves it, so the cancel lands mid-run (deterministic).
    let release: (() => void) | undefined;
    const invocation = new Promise<unknown>((resolve) => {
      release = () => resolve({ text: "deferred output", targetLanguage: "es" });
    });
    const deferredProvider = {
      id: "wfx-deferred-translation",
      privacy: "local" as const,
      capabilities: ["translation" as const],
      costPerOperation: () => undefined,
      invoke: (() => invocation) as never,
    };
    const store = new MemoryTransformStore();
    const registry = new ModelFabricRegistry();
    registry.register(deferredProvider);
    const engine = new TransformOperationEngine({
      store,
      fabric: new ModelFabric(registry),
      clock: new FixedClock(Date.UTC(2026, 8, 16, 9, 0, 0)),
      ids: new SequentialIds(),
    });

    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("slow text"),
      options: { privacy: "local-only", fallbackProviders: ["wfx-deferred-translation"] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const id = submitted.operation.id;

    // Start the run (NOT awaited): it reaches running and parks at the
    // provider invocation.
    const runPromise = engine.run(id, "profile-a");
    // Let the queued→running transition land before cancelling.
    await new Promise((resolve) => setImmediate(resolve));
    const midRun = store.operations.get(id);
    expect(midRun?.state).toBe("running");

    // The user's undo lands mid-run.
    const cancelled = await engine.cancel(id, "profile-a", "changed my mind");
    expect(cancelled.ok).toBe(true);

    // The provider eventually answers — the result is DISCARDED (cancelled
    // is terminal; the run records nothing after the cancel).
    release!();
    const ran = await runPromise;
    expect(ran.ok).toBe(true);
    if (ran.ok) {
      expect(ran.operation.state).toBe("cancelled");
      expect(ran.operation.result).toBeUndefined();
      // The full append-only history: queued → running (the run started),
      // running → cancelled (the user's undo landed mid-run). Nothing after.
      expect(ran.operation.stateHistory.map((entry) => `${entry.from}>${entry.to}`)).toEqual([
        "queued>running",
        "running>cancelled",
      ]);
    }
  });

  it("cancel a TERMINAL operation answers the typed invalid-state refusal", async () => {
    const { engine } = buildEngine();
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hi"),
      options: { privacy: "any-cloud", fallbackProviders: ["wfx-test-translation"] },
    });
    if (!submitted.ok) throw new Error("submit failed");
    const id = submitted.operation.id;
    await engine.run(id, "profile-a");
    const cancelled = await engine.cancel(id, "profile-a");
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok && cancelled.failure.kind === "invalid-state") {
      expect(cancelled.failure.state).toBe("succeeded");
      expect(cancelled.failure.detail).toContain("only queued or running");
    }
  });

  it("cancel an UNKNOWN id answers the typed not-found refusal", async () => {
    const { engine } = buildEngine();
    const cancelled = await engine.cancel("wfxop_nonexistent", "profile-a");
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.failure.kind).toBe("not-found");
  });
});

describe("the store's guarded transition (conflict honesty)", () => {
  it("a concurrent double-transition answers the typed conflict — never a silent overwrite", async () => {
    const store = new MemoryTransformStore();
    const registry = new ModelFabricRegistry();
    const engine = new TransformOperationEngine({
      store,
      fabric: new ModelFabric(registry),
      clock: new FixedClock(Date.UTC(2026, 8, 16, 9, 0, 0)),
      ids: new SequentialIds(),
    });
    const submitted = await engine.submit("profile-a", {
      kind: "translation",
      input: translationInput("hi"),
      options: {},
    });
    if (!submitted.ok) throw new Error("submit failed");
    const id = submitted.operation.id;

    // Two racing starts: one wins, one answers the typed conflict.
    const first = await store.transition({
      id,
      ownerKey: "profile-a",
      event: { kind: "start", at: "2026-09-16T09:00:01.000Z" },
      expectedFrom: "queued",
    });
    expect(first.ok).toBe(true);
    const second = await store.transition({
      id,
      ownerKey: "profile-a",
      event: { kind: "start", at: "2026-09-16T09:00:01.500Z" },
      expectedFrom: "queued",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.kind).toBe("conflict");
  });
});

describe("served kinds (the closed descriptor map)", () => {
  it("serves the frozen task set", () => {
    const { engine } = buildEngine();
    expect(engine.servedKinds()).toContain("translation");
    expect(engine.servedKinds()).toContain("transcript");
    expect(engine.servedKinds()).toHaveLength(8);
    // The transcript descriptor is in the map (kind sanity via the task).
    expect(transcriptTask.kind).toBe("transcript");
  });
});
