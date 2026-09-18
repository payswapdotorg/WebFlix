/**
 * R06 — model and AI controls persistence tests (PGlite).
 *
 * Pins migration 0011 and the three R06 stores:
 *
 * - MODEL POLICY: per-(profile, task) upsert round-trip (the frozen
 *   ModelPolicy shape), the honest null-miss, total validation failures,
 *   delete (reversibility), per-profile isolation.
 * - BYOM BINDINGS (the sealing discipline, the connector-accounts law
 *   verbatim): one binding per (profile, provider) with a stable id across
 *   re-binds; the API key is SEALED (raw-SQL check: the stored ciphertext
 *   never contains the plaintext; the read surfaces never contain the
 *   key); key-rotation mismatch answers the typed failure BEFORE
 *   decryption; tampered envelopes fail typed; delete DESTROYS the sealed
 *   row.
 * - TRANSFORM OPERATIONS: create (queued) → get/list round-trip; the
 *   guarded transition (conflict on mismatch, never a silent overwrite);
 *   the APPEND-ONLY state history (insert-only events, never rewritten);
 *   progress updates; result cleanup (payload + progress cleared, record +
 *   history kept).
 *
 * Determinism: FixedClock + SequentialIdGen; PGlite in-memory; no network;
 * the key material in fixtures is obviously fake test data.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PersistenceError,
  PostgresModelPolicyStore,
  PostgresModelProviderBindingStore,
  PostgresTransformOperationStore,
  type PersistedModelPolicy,
} from "../src/index";
import { TEST_ENCRYPTION_KEY, createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 16, 12, 0, 0);
const PROFILE = "wfxprof_00000000000000000000r06a";
const OTHER_PROFILE = "wfxprof_0000000000000000000r06b";

/** Obviously-fake BYOM key material (never a real credential). */
const FAKE_KEY = "test-byom-key-material-never-real";
const ROTATED_FAKE_KEY = "test-byom-key-material-rotated";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let policies: PostgresModelPolicyStore;
let bindings: PostgresModelProviderBindingStore;
let operations: PostgresTransformOperationStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  policies = new PostgresModelPolicyStore({ db: test.db, clock });
  bindings = new PostgresModelProviderBindingStore({
    db: test.db,
    clock,
    key: TEST_ENCRYPTION_KEY,
    ids,
  });
  operations = new PostgresTransformOperationStore({ db: test.db, clock });
});

afterAll(async () => {
  await test.close();
});

// ---------------------------------------------------------------------------
// Model policy store
// ---------------------------------------------------------------------------

describe("PostgresModelPolicyStore (the frozen ModelPolicy, per (profile, task))", () => {
  it("answers the HONEST null when unset (never a fabricated default)", async () => {
    const loaded = await policies.loadPolicy(PROFILE, "translation");
    expect(loaded).toBeNull();
  });

  it("round-trips a policy verbatim (preferred + chain + privacy + ceiling)", async () => {
    const policy: PersistedModelPolicy = {
      task: "translation",
      preferredProvider: "byom-alpha",
      fallbackProviders: ["byom-alpha", "wfx-first-party"],
      privacy: "trusted-cloud",
      maxCostPerOperation: 0.5,
    };
    const saved = await policies.savePolicy(PROFILE, policy);
    expect(saved.task).toBe("translation");
    expect(saved.preferredProvider).toBe("byom-alpha");
    expect(saved.fallbackProviders).toEqual(["byom-alpha", "wfx-first-party"]);
    expect(saved.privacy).toBe("trusted-cloud");
    expect(saved.maxCostPerOperation).toBe(0.5);

    const reread = await policies.loadPolicy(PROFILE, "translation");
    expect(reread).toEqual(saved);
  });

  it("a re-save REPLACES the policy for that task (a policy is configuration, not a log)", async () => {
    await policies.savePolicy(PROFILE, {
      task: "translation",
      fallbackProviders: ["wfx-first-party"],
      privacy: "local-only",
    });
    const reread = await policies.loadPolicy(PROFILE, "translation");
    expect(reread!.privacy).toBe("local-only");
    expect(reread!.preferredProvider).toBeUndefined();
    expect(reread!.maxCostPerOperation).toBeUndefined();
  });

  it("validation is TOTAL — every problem named in ONE typed failure", async () => {
    let thrown: unknown;
    try {
      await policies.savePolicy(PROFILE, {
        task: "not-a-task" as never,
        fallbackProviders: [],
        privacy: "sky" as never,
        maxCostPerOperation: -1,
        preferredProvider: "  ",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PersistenceError);
    const message = (thrown as PersistenceError).message;
    expect(message).toContain("task");
    expect(message).toContain("fallbackProviders");
    expect(message).toContain("privacy");
    expect(message).toContain("maxCostPerOperation");
    expect(message).toContain("preferredProvider");
  });

  it("per-profile isolation: another profile never sees this policy", async () => {
    await policies.savePolicy(PROFILE, {
      task: "summary",
      fallbackProviders: ["wfx-first-party"],
      privacy: "local-only",
    });
    const foreign = await policies.loadPolicy(OTHER_PROFILE, "summary");
    expect(foreign).toBeNull();
  });

  it("delete is the undo law; an honest false when nothing was stored", async () => {
    await policies.savePolicy(PROFILE, {
      task: "commentary",
      fallbackProviders: ["wfx-first-party"],
      privacy: "any-cloud",
    });
    expect(await policies.deletePolicy(PROFILE, "commentary")).toBe(true);
    expect(await policies.deletePolicy(PROFILE, "commentary")).toBe(false);
    expect(await policies.loadPolicy(PROFILE, "commentary")).toBeNull();
  });

  it("listPolicies returns every stored task for the profile", async () => {
    const list = await policies.listPolicies(PROFILE);
    const tasks = list.map((policy) => policy.task);
    expect(tasks).toContain("translation");
    expect(tasks).toContain("summary");
    expect(tasks).not.toContain("commentary"); // deleted above
  });
});

// ---------------------------------------------------------------------------
// BYOM provider bindings (the sealing discipline)
// ---------------------------------------------------------------------------

describe("PostgresModelProviderBindingStore (envelope-sealed BYOM keys)", () => {
  it("seals the key: the stored row's ciphertext NEVER contains the plaintext (raw-SQL check)", async () => {
    await bindings.saveBinding({
      profileKey: PROFILE,
      providerId: "byom-alpha",
      endpoint: "https://byom-alpha.example.test/v1",
      tasks: ["translation", "summary"],
      privacy: "trusted-cloud",
      apiKey: FAKE_KEY,
    });
    const rows = await test.db.query<{
      ciphertext: string;
      iv: string;
      auth_tag: string;
      key_id: string;
      endpoint: string;
    }>(
      `SELECT ciphertext, iv, auth_tag, key_id, endpoint FROM model_provider_bindings
        WHERE profile_key = $1 AND provider_id = 'byom-alpha'`,
      [PROFILE],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.ciphertext).not.toContain(FAKE_KEY); // plaintext NEVER at rest
    expect(JSON.stringify(row)).not.toContain(FAKE_KEY);
    expect(row.key_id).toHaveLength(16); // the rotation fingerprint
  });

  it("the binding id is stable across re-binds (re-bind replaces the sealed material)", async () => {
    const first = await bindings.saveBinding({
      profileKey: PROFILE,
      providerId: "byom-alpha",
      endpoint: "https://byom-alpha.example.test/v1",
      tasks: ["translation"],
      privacy: "trusted-cloud",
      apiKey: FAKE_KEY,
    });
    const second = await bindings.saveBinding({
      profileKey: PROFILE,
      providerId: "byom-alpha",
      endpoint: "https://byom-alpha.example.test/v2",
      tasks: ["translation", "summary"],
      privacy: "any-cloud",
      apiKey: ROTATED_FAKE_KEY,
    });
    expect(second.id).toBe(first.id); // the "reauthorize preserves the row" law
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.endpoint).toBe("https://byom-alpha.example.test/v2");
    expect(second.tasks).toEqual(["translation", "summary"]);
    // ONE binding per (profile, provider) — never a duplicate row.
    const rows = await test.db.query<{ id: string }>(
      `SELECT id FROM model_provider_bindings WHERE profile_key = $1 AND provider_id = 'byom-alpha'`,
      [PROFILE],
    );
    expect(rows).toHaveLength(1);
  });

  it("loadBinding opens the key for the TRANSPORT lane only; the read surfaces never contain it", async () => {
    const loaded = await bindings.loadBinding(PROFILE, "byom-alpha");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.binding.apiKey).toBe(ROTATED_FAKE_KEY); // the transport lane CAN open it
    }
    // The metadata-only surfaces never carry the key.
    const listed = await bindings.listBindings(PROFILE);
    const record = listed.find((entry) => entry.providerId === "byom-alpha");
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain(ROTATED_FAKE_KEY);
    expect(JSON.stringify(record)).not.toContain("apiKey");
    expect(record!.keyId).toHaveLength(16);
  });

  it("key-mismatch (rotation) answers the typed failure BEFORE decryption", async () => {
    const rotatedStore = new PostgresModelProviderBindingStore({
      db: test.db,
      clock,
      key: new Uint8Array(32).map((_, index) => 255 - index),
      ids,
    });
    const loaded = await rotatedStore.loadBinding(PROFILE, "byom-alpha");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok && loaded.reason === "key-mismatch") {
      expect(loaded.storedKeyId).not.toBe(loaded.expectedKeyId);
    } else {
      throw new Error("expected the typed key-mismatch failure");
    }
  });

  it("a tampered envelope fails typed (never garbage plaintext, never fake success)", async () => {
    await bindings.saveBinding({
      profileKey: PROFILE,
      providerId: "byom-tamper",
      endpoint: "https://byom-tamper.example.test/v1",
      tasks: ["summary"],
      privacy: "local-only",
      apiKey: FAKE_KEY,
    });
    await test.db.query(
      `UPDATE model_provider_bindings SET ciphertext = 'AAAA-tampered' WHERE provider_id = 'byom-tamper'`,
    );
    const loaded = await bindings.loadBinding(PROFILE, "byom-tamper");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.reason).toBe("decrypt-failed");
    }
  });

  it("validation is TOTAL — every problem named (endpoint, tasks, privacy, apiKey)", async () => {
    let thrown: unknown;
    try {
      await bindings.saveBinding({
        profileKey: PROFILE,
        providerId: "",
        endpoint: "not-a-url",
        tasks: [],
        privacy: "sky" as never,
        apiKey: "",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PersistenceError);
    const message = (thrown as PersistenceError).message;
    expect(message).toContain("providerId");
    expect(message).toContain("endpoint");
    expect(message).toContain("tasks");
    expect(message).toContain("privacy");
    expect(message).toContain("apiKey");
  });

  it("delete DESTROYS the sealed row (the vault's delete discipline)", async () => {
    await bindings.saveBinding({
      profileKey: PROFILE,
      providerId: "byom-temp",
      endpoint: "https://byom-temp.example.test/v1",
      tasks: ["summary"],
      privacy: "local-only",
      apiKey: FAKE_KEY,
    });
    expect(await bindings.deleteBinding(PROFILE, "byom-temp")).toBe(true);
    expect(await bindings.deleteBinding(PROFILE, "byom-temp")).toBe(false);
    const rows = await test.db.query<{ id: string }>(
      `SELECT id FROM model_provider_bindings WHERE provider_id = 'byom-temp'`,
    );
    expect(rows).toHaveLength(0); // the sealed material is GONE
    const loaded = await bindings.loadBinding(PROFILE, "byom-temp");
    expect(loaded.ok).toBe(false);
  });

  it("per-profile isolation: another profile's binding is not-found", async () => {
    const loaded = await bindings.loadBinding(OTHER_PROFILE, "byom-alpha");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe("not-found");
  });
});

// ---------------------------------------------------------------------------
// Transform operations (the explicit state machine, durable)
// ---------------------------------------------------------------------------

/** A queued snapshot fixture. */
function queuedSnapshot(id: string, ownerKey: string) {
  return {
    id,
    ownerKey,
    kind: "translation" as const,
    input: { media: { sourceId: "s", authorizedSource: true, drmProtected: false, allowsTranscript: true, allowsTranslation: true, allowsDubbing: true, allowsCommentary: true }, text: "hi", targetLanguage: "es" },
    options: { privacy: "local-only", fallbackProviders: [] },
    state: "queued" as const,
    createdAt: new Date(CLOCK_START).toISOString(),
    updatedAt: new Date(CLOCK_START).toISOString(),
    stateHistory: [] as never[],
  };
}

describe("PostgresTransformOperationStore (the durable state machine)", () => {
  it("create → get round-trips the queued snapshot; ownership is the honest miss", async () => {
    const created = await operations.create(queuedSnapshot("wfxop_000000000000000000000001", PROFILE));
    expect(created.state).toBe("queued");
    expect(created.stateHistory).toHaveLength(0);

    const fetched = await operations.get("wfxop_000000000000000000000001", PROFILE);
    expect(fetched).not.toBeNull();
    expect(fetched!.kind).toBe("translation");

    const foreign = await operations.get("wfxop_000000000000000000000001", OTHER_PROFILE);
    expect(foreign).toBeNull(); // another profile's operation is not-found
  });

  it("the transition is guarded: a mismatch answers the typed conflict — never a silent overwrite", async () => {
    const id = "wfxop_000000000000000000000002";
    await operations.create(queuedSnapshot(id, PROFILE));
    // A racing double-start: one wins, one conflicts.
    const first = await operations.transition({
      id,
      ownerKey: PROFILE,
      event: { kind: "start", at: new Date(CLOCK_START + 1000).toISOString() },
      expectedFrom: "queued",
    });
    expect(first.ok).toBe(true);
    const second = await operations.transition({
      id,
      ownerKey: PROFILE,
      event: { kind: "start", at: new Date(CLOCK_START + 1500).toISOString() },
      expectedFrom: "queued",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.kind).toBe("conflict");
  });

  it("the state history is APPEND-ONLY: every transition appends; none rewrite or drop", async () => {
    const id = "wfxop_000000000000000000000003";
    await operations.create(queuedSnapshot(id, PROFILE));
    await operations.transition({
      id,
      ownerKey: PROFILE,
      event: { kind: "start", at: new Date(CLOCK_START + 2000).toISOString() },
      expectedFrom: "queued",
    });
    await operations.transition({
      id,
      ownerKey: PROFILE,
      event: {
        kind: "succeed",
        at: new Date(CLOCK_START + 3000).toISOString(),
        result: {
          reference: "wfxtr_000000000000000000000001",
          providerId: "wfx-test",
          output: { text: "hola" },
          costEstimate: 0.001,
          durationEstimateMs: 300,
        },
      },
      expectedFrom: "running",
    });
    const final = await operations.get(id, PROFILE);
    expect(final!.state).toBe("succeeded");
    expect(final!.result!.reference).toBe("wfxtr_000000000000000000000001");
    expect(final!.stateHistory.map((entry) => `${entry.from}>${entry.to}`)).toEqual([
      "queued>running",
      "running>succeeded",
    ]);
    // The raw events table is insert-only truth: the two rows exist.
    const events = await test.db.query<{ operation_id: string; event: string }>(
      `SELECT operation_id, event FROM transform_operation_events WHERE operation_id = $1 ORDER BY id`,
      [id],
    );
    expect(events.map((event) => event.event)).toEqual(["start", "succeed"]);
  });

  it("a failure transition records the typed error detail", async () => {
    const id = "wfxop_000000000000000000000004";
    await operations.create(queuedSnapshot(id, PROFILE));
    await operations.transition({
      id,
      ownerKey: PROFILE,
      event: { kind: "start", at: new Date(CLOCK_START).toISOString() },
      expectedFrom: "queued",
    });
    await operations.transition({
      id,
      ownerKey: PROFILE,
      event: {
        kind: "fail",
        at: new Date(CLOCK_START + 1000).toISOString(),
        error: { kind: "fabric", detail: "no-provider: no registered provider can serve task 'translation'" },
      },
      expectedFrom: "running",
    });
    const failed = await operations.get(id, PROFILE);
    expect(failed!.state).toBe("failed");
    expect(failed!.error!.kind).toBe("fabric");
    expect(failed!.error!.detail).toContain("no-provider");
  });

  it("progress updates land as field updates (never history rewrites)", async () => {
    const id = "wfxop_000000000000000000000005";
    await operations.create(queuedSnapshot(id, PROFILE));
    await operations.updateProgress(id, PROFILE, 0.3);
    await operations.updateProgress(id, PROFILE, 0.85);
    const fetched = await operations.get(id, PROFILE);
    expect(fetched!.progress).toBe(0.85);
    expect(fetched!.stateHistory).toHaveLength(0); // progress ≠ transitions
    let thrown: unknown;
    try {
      await operations.updateProgress(id, PROFILE, 1.5);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PersistenceError); // dishonest fractions rejected
  });

  it("result cleanup: payload + progress cleared, the record + history STAY (audit truth)", async () => {
    const id = "wfxop_000000000000000000000006";
    await operations.create(queuedSnapshot(id, PROFILE));
    await operations.transition({
      id,
      ownerKey: PROFILE,
      event: { kind: "start", at: new Date(CLOCK_START).toISOString() },
      expectedFrom: "queued",
    });
    await operations.transition({
      id,
      ownerKey: PROFILE,
      event: {
        kind: "succeed",
        at: new Date(CLOCK_START + 1000).toISOString(),
        result: {
          reference: "wfxtr_000000000000000000000002",
          providerId: "wfx-test",
          output: { text: "hola" },
          costEstimate: 0.001,
          durationEstimateMs: 300,
        },
      },
      expectedFrom: "running",
    });
    await operations.updateProgress(id, PROFILE, 1);
    expect(await operations.clearResult(id, PROFILE)).toBe(true);
    expect(await operations.clearResult(id, PROFILE)).toBe(false); // nothing left to clean
    const cleaned = await operations.get(id, PROFILE);
    expect(cleaned!.state).toBe("succeeded"); // the record stays
    expect(cleaned!.result).toBeUndefined(); // the result material is GONE
    expect(cleaned!.progress).toBeUndefined();
    expect(cleaned!.stateHistory).toHaveLength(2); // the audit truth stays
  });

  it("listForOwner returns the owner's operations, newest first", async () => {
    const list = await operations.listForOwner(PROFILE);
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.every((operation) => operation.ownerKey === PROFILE)).toBe(true);
    for (let index = 1; index < list.length; index += 1) {
      expect(list[index - 1]!.createdAt >= list[index]!.createdAt).toBe(true);
    }
    const foreignList = await operations.listForOwner(OTHER_PROFILE);
    expect(foreignList).toHaveLength(0);
  });

  it("create validation refuses a non-queued snapshot with history", async () => {
    let thrown: unknown;
    try {
      await operations.create({
        ...queuedSnapshot("wfxop_000000000000000000000099", PROFILE),
        state: "succeeded",
        stateHistory: [{ from: "running", to: "succeeded", event: "succeed", at: new Date(CLOCK_START).toISOString() }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PersistenceError);
  });
});
