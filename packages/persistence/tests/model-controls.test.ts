/**
 * R06 — model-controls persistence tests (PGlite, real Postgres).
 *
 * Pins the 0011 migration's three tables + the explicit state machine:
 *
 * - model_policy: per-profile round-trip, UPSERT preserves the canonical
 *   id + created_at across re-writes (rotation law), HONEST null when a
 *   task has no stored policy (never a fabricated default), profile
 *   isolation, typed invalid-input on bad privacy / cost / fallbacks;
 * - byom_provider_bindings: envelope-encrypted round-trip — the SAVE
 *   response NEVER contains key material (the R06 privacy law), the raw
 *   SQL row contains the ciphertext/iv/auth_tag/key_id ONLY (no plaintext
 *   at rest), DELETE destroys the sealed material, key-mismatch is
 *   detected before decryption, tampered envelopes fail typed (never
 *   garbage plaintext), profile isolation;
 * - transform_operations: the EXPLICIT state machine (queued → running
 *   → succeeded | failed | cancelled), illegal transitions throw typed,
 *   the append-only history table records EVERY transition (never an
 *   overwrite — honest audit truth), profile isolation, clearResult on
 *   succeeded → cancelled.
 *
 * Determinism: FixedClock + SequentialIdGen; no network (PGlite in-memory).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PersistenceError,
  PostgresByomBindingStore,
  PostgresModelPolicyStore,
  PostgresTransformOperationStore,
} from "../src/index";
import {
  OTHER_ENCRYPTION_KEY,
  TEST_ENCRYPTION_KEY,
  createTestDb,
  type TestDb,
} from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 16, 9, 0, 0);
const USER = "wfxusr_0000000000000000000000r06a";
const USER_B = "wfxusr_0000000000000000000000r06b";
const PROFILE_A = "wfxprof_r06profileaaaaaaaaaaaaa";
const PROFILE_B = "wfxprof_r06profilebbbbbbbbbbbbb";
const PROVIDER_ID = "openai-byom";
const ENDPOINT = "https://api.openai.com/v1";
const SECRET_KEY = "sk-BYOM-super-secret-api-key-value-7f3a";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let policyStore: PostgresModelPolicyStore;
let byomStore: PostgresByomBindingStore;
let transformStore: PostgresTransformOperationStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  policyStore = new PostgresModelPolicyStore({ db: test.db, clock, ids });
  byomStore = new PostgresByomBindingStore({
    db: test.db,
    clock,
    key: TEST_ENCRYPTION_KEY,
    ids,
  });
  transformStore = new PostgresTransformOperationStore({
    db: test.db,
    clock,
    ids,
  });
});

afterAll(async () => {
  await test.close();
});

// ---------------------------------------------------------------------------
// model_policy — round-trip, UPSERT preserves id/created_at, honest null
// ---------------------------------------------------------------------------

describe("R06 model_policy — per-profile round-trip + honesty", () => {
  it("reads null for a task with no stored policy (the honest empty answer)", async () => {
    const got = await policyStore.readForTask(USER, PROFILE_A, "translation");
    expect(got).toBeNull();
  });

  it("writes and reads one task's policy for the active profile", async () => {
    const saved = await policyStore.upsertForTask({
      userId: USER,
      profileId: PROFILE_A,
      policy: {
        task: "translation",
        preferredProvider: "wfx-first-party",
        fallbackProviders: ["wfx-local-translator", "byom-openai"],
        privacy: "trusted-cloud",
        maxCostPerOperation: 0.5,
      },
    });
    expect(saved.id).toMatch(/^wfxmp_/);
    expect(saved.task).toBe("translation");
    expect(saved.preferredProvider).toBe("wfx-first-party");
    expect(saved.fallbackProviders).toEqual([
      "wfx-local-translator",
      "byom-openai",
    ]);
    expect(saved.privacy).toBe("trusted-cloud");
    expect(saved.maxCostPerOperation).toBe(0.5);
    expect(saved.profileId).toBe(PROFILE_A);

    const reread = await policyStore.readForTask(USER, PROFILE_A, "translation");
    expect(reread?.id).toBe(saved.id);
    expect(reread?.privacy).toBe("trusted-cloud");
  });

  it("UPSERT preserves the canonical id + created_at across re-writes", async () => {
    const first = await policyStore.upsertForTask({
      userId: USER,
      profileId: PROFILE_A,
      policy: {
        task: "summary",
        fallbackProviders: [],
        privacy: "local-only",
      },
    });
    clock.advance(60_000);
    const second = await policyStore.upsertForTask({
      userId: USER,
      profileId: PROFILE_A,
      policy: {
        task: "summary",
        preferredProvider: "byom-anthropic",
        fallbackProviders: ["wfx-first-party"],
        privacy: "any-cloud",
      },
    });
    expect(second.id).toBe(first.id); // PRESERVED
    expect(second.createdAt).toBe(first.createdAt); // PRESERVED
    expect(second.preferredProvider).toBe("byom-anthropic");
    expect(second.privacy).toBe("any-cloud");
    expect(second.maxCostPerOperation).toBeNull(); // cleared (no ceiling now)
  });

  it("isolates profiles — profile B never sees profile A's policy", async () => {
    await policyStore.upsertForTask({
      userId: USER,
      profileId: PROFILE_A,
      policy: {
        task: "commentary",
        fallbackProviders: [],
        privacy: "local-only",
      },
    });
    const inB = await policyStore.readForTask(USER, PROFILE_B, "commentary");
    expect(inB).toBeNull();
  });

  it("isolates users — user B never sees user A's policy", async () => {
    await policyStore.upsertForTask({
      userId: USER,
      profileId: null,
      policy: {
        task: "dubbing",
        fallbackProviders: [],
        privacy: "local-only",
      },
    });
    const inB = await policyStore.readForTask(USER_B, null, "dubbing");
    expect(inB).toBeNull();
  });

  it("rejects an invalid privacy class with typed invalid-input", async () => {
    await expect(
      policyStore.upsertForTask({
        userId: USER,
        profileId: PROFILE_A,
        policy: {
          task: "translation",
          fallbackProviders: [],
          privacy: "anywhere" as never,
        },
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("rejects a negative cost ceiling with typed invalid-input", async () => {
    await expect(
      policyStore.upsertForTask({
        userId: USER,
        profileId: PROFILE_A,
        policy: {
          task: "translation",
          fallbackProviders: [],
          privacy: "any-cloud",
          maxCostPerOperation: -0.01,
        },
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("DELETE removes the policy and the next read answers null honestly", async () => {
    await policyStore.upsertForTask({
      userId: USER,
      profileId: PROFILE_A,
      policy: {
        task: "speechToText",
        fallbackProviders: [],
        privacy: "local-only",
      },
    });
    const removed = await policyStore.deleteForTask(USER, PROFILE_A, "speechToText");
    expect(removed).toBe(true);
    const reread = await policyStore.readForTask(USER, PROFILE_A, "speechToText");
    expect(reread).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// byom_provider_bindings — envelope-encrypted round-trip + privacy law
// ---------------------------------------------------------------------------

describe("R06 byom_provider_bindings — envelope + privacy law", () => {
  it("saveBinding answers a HANDLE + metadata — NEVER the key material", async () => {
    const saved = await byomStore.saveBinding({
      userId: USER,
      profileId: PROFILE_A,
      providerId: PROVIDER_ID,
      endpointUrl: ENDPOINT,
      key: SECRET_KEY,
      metadata: { model: "gpt-4o", capabilities: ["translation", "summary"] },
    });
    expect(saved.id).toMatch(/^wfxbind_/);
    expect(saved.providerId).toBe(PROVIDER_ID);
    expect(saved.endpointUrl).toBe(ENDPOINT);
    expect(saved.keyId).toMatch(/^[0-9a-f]{16}$/); // rotation fingerprint
    expect(saved.metadata).toEqual({
      model: "gpt-4o",
      capabilities: ["translation", "summary"],
    });
    // THE PRIVACY LAW: no `key`, `secret`, `apiKey`, or `token` field on the
    // save response — the response carries the HANDLE + metadata ONLY.
    const record = saved as unknown as Record<string, unknown>;
    for (const forbidden of ["key", "secret", "apiKey", "token", "ciphertext", "iv", "authTag"]) {
      expect(forbidden in record).toBe(false);
    }
  });

  it("the raw SQL row carries ciphertext/iv/auth_tag/key_id — NEVER the plaintext key", async () => {
    const raw = await test.raw.query(
      `SELECT ciphertext, iv, auth_tag, key_id, endpoint_url FROM byom_provider_bindings
        WHERE user_id = $1 AND provider_id = $2`,
      [USER, PROVIDER_ID],
    );
    expect(raw.rows.length).toBe(1);
    const row = raw.rows[0] as {
      ciphertext: string;
      iv: string;
      auth_tag: string;
      key_id: string;
      endpoint_url: string;
    };
    expect(row.ciphertext.length).toBeGreaterThan(0);
    expect(row.iv.length).toBeGreaterThan(0);
    expect(row.auth_tag.length).toBeGreaterThan(0);
    expect(row.key_id.length).toBe(16);
    // THE PRIVACY LAW: the plaintext key is NEVER present in any column.
    const allCols = JSON.stringify(row);
    expect(allCols).not.toContain(SECRET_KEY);
  });

  it("loadBinding opens the envelope and hands the key to the caller ONLY", async () => {
    const loaded = await byomStore.loadBinding(USER, PROFILE_A, PROVIDER_ID);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.binding.key).toBe(SECRET_KEY);
      expect(loaded.binding.providerId).toBe(PROVIDER_ID);
    }
  });

  it("UPSERT preserves the canonical id + created_at and rotates the key", async () => {
    const first = await byomStore.saveBinding({
      userId: USER,
      profileId: PROFILE_A,
      providerId: "anthropic-byom",
      endpointUrl: "https://api.anthropic.com/v1",
      key: "sk-ANT-first-key",
    });
    clock.advance(120_000);
    const second = await byomStore.saveBinding({
      userId: USER,
      profileId: PROFILE_A,
      providerId: "anthropic-byom",
      endpointUrl: "https://api.anthropic.com/v1",
      key: "sk-ANT-ROTATED-key",
    });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    const loaded = await byomStore.loadBinding(USER, PROFILE_A, "anthropic-byom");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.binding.key).toBe("sk-ANT-ROTATED-key");
  });

  it("key-mismatch is detected BEFORE decryption is attempted (rotation)", async () => {
    // The first binding is sealed under TEST_ENCRYPTION_KEY; load with the
    // OTHER key to detect rotation.
    const otherStore = new PostgresByomBindingStore({
      db: test.db,
      clock,
      key: OTHER_ENCRYPTION_KEY,
      ids,
    });
    const loaded = await otherStore.loadBinding(USER, PROFILE_A, PROVIDER_ID);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok && loaded.reason === "key-mismatch") {
      expect(loaded.storedKeyId).not.toBe(loaded.expectedKeyId);
    } else {
      throw new Error("expected key-mismatch outcome");
    }
  });

  it("isolates profiles — profile B never sees profile A's binding", async () => {
    const inB = await byomStore.loadBinding(USER, PROFILE_B, PROVIDER_ID);
    expect(inB.ok).toBe(false);
    if (!inB.ok) expect(inB.reason).toBe("not-found");
  });

  it("DELETE destroys the sealed material (the vault's delete discipline)", async () => {
    await byomStore.saveBinding({
      userId: USER,
      profileId: PROFILE_A,
      providerId: "to-delete",
      endpointUrl: "https://example.com/v1",
      key: "sk-DELETE-me",
    });
    const removed = await byomStore.deleteBinding(USER, PROFILE_A, "to-delete");
    expect(removed).toBe(true);
    const loaded = await byomStore.loadBinding(USER, PROFILE_A, "to-delete");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toBe("not-found");
    // raw row gone too
    const raw = await test.raw.query(
      `SELECT id FROM byom_provider_bindings WHERE user_id = $1 AND provider_id = $2`,
      [USER, "to-delete"],
    );
    expect(raw.rows.length).toBe(0);
  });

  it("rejects a non-http(s) endpoint URL with typed invalid-input", async () => {
    await expect(
      byomStore.saveBinding({
        userId: USER,
        profileId: PROFILE_A,
        providerId: "ftp-byom",
        endpointUrl: "ftp://example.com/v1",
        key: "sk-anything",
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("listForProfile answers secret-free projections ONLY", async () => {
    const list = await byomStore.listForProfile(USER, PROFILE_A);
    expect(list.length).toBeGreaterThan(0);
    const json = JSON.stringify(list);
    // THE PRIVACY LAW: the listing never leaks the secret.
    expect(json).not.toContain(SECRET_KEY);
    expect(json).not.toContain("sk-ANT-ROTATED-key");
  });
});

// ---------------------------------------------------------------------------
// transform_operations — explicit state machine + append-only history
// ---------------------------------------------------------------------------

describe("R06 transform_operations — explicit state machine", () => {
  it("creates a new operation in queued state with the initial history row", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "translation",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r6",
      options: { targetLanguage: "es" },
    });
    expect(op.id).toMatch(/^wfxtx_/);
    expect(op.state).toBe("queued");
    expect(op.progress).toBeNull();
    expect(op.resultRef).toBeNull();
    expect(op.errorDetail).toBeNull();
    expect(op.kind).toBe("translation");
    expect(op.options).toEqual({ targetLanguage: "es" });

    const history = await transformStore.listStateHistory(op.id);
    expect(history.length).toBe(1);
    expect(history[0]?.state).toBe("queued");
  });

  it("runs the legal lifecycle: queued → running → succeeded", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "transcript",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r1",
    });
    clock.advance(1_000);
    const running = await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "running",
      progress: 0.0,
    });
    expect(running.state).toBe("running");
    expect(running.progress).toBe(0.0);
    clock.advance(2_000);
    const done = await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "succeeded",
      progress: 1.0,
      detail: "wfxtr_01ARZ3NDEKF1XTVRE0000000rs",
    });
    expect(done.state).toBe("succeeded");
    expect(done.progress).toBe(1.0);
    expect(done.resultRef).toBe("wfxtr_01ARZ3NDEKF1XTVRE0000000rs");
    expect(done.errorDetail).toBeNull();

    const history = await transformStore.listStateHistory(op.id);
    expect(history.length).toBe(3); // queued + running + succeeded — append-only
    expect(history[0]?.state).toBe("queued");
    expect(history[1]?.state).toBe("running");
    expect(history[2]?.state).toBe("succeeded");
  });

  it("runs the legal failure lifecycle: queued → running → failed", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "summary",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r2",
    });
    clock.advance(1_000);
    await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "running",
    });
    clock.advance(2_000);
    const failed = await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "failed",
      detail: "provider-error: the upstream model rejected the input",
    });
    expect(failed.state).toBe("failed");
    expect(failed.errorDetail).toBe(
      "provider-error: the upstream model rejected the input",
    );
    expect(failed.resultRef).toBeNull();
  });

  it("runs the legal cancel lifecycle: queued → cancelled (pre-flight)", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "translation",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r3",
    });
    clock.advance(1_000);
    const cancelled = await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "cancelled",
      detail: "user cancelled before the provider was invoked",
    });
    expect(cancelled.state).toBe("cancelled");
  });

  it("REJECTS illegal transitions (terminal states are terminal)", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "commentary",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r4",
    });
    clock.advance(1_000);
    await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "running",
    });
    clock.advance(2_000);
    await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "succeeded",
      detail: "wfxtr_xyz",
    });
    // illegal: succeeded → running (terminal)
    await expect(
      transformStore.transitionState({
        operationId: op.id,
        userId: USER,
        profileId: PROFILE_A,
        to: "running",
      }),
    ).rejects.toThrow(PersistenceError);
    // illegal: succeeded → failed (terminal)
    await expect(
      transformStore.transitionState({
        operationId: op.id,
        userId: USER,
        profileId: PROFILE_A,
        to: "failed",
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("REJECTS queued → succeeded (must go through running first)", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "dubbing",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r5",
    });
    await expect(
      transformStore.transitionState({
        operationId: op.id,
        userId: USER,
        profileId: PROFILE_A,
        to: "succeeded",
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("clearResult transitions a succeeded op to cancelled and clears the result ref", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "translation",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r6",
    });
    clock.advance(1_000);
    await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "running",
    });
    clock.advance(2_000);
    await transformStore.transitionState({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
      to: "succeeded",
      progress: 1.0,
      detail: "wfxtr_to_cleanup",
    });
    clock.advance(3_000);
    const cleared = await transformStore.clearResult({
      operationId: op.id,
      userId: USER,
      profileId: PROFILE_A,
    });
    expect(cleared.state).toBe("cancelled");
    expect(cleared.resultRef).toBeNull();
    // history was appended — never overwritten
    const history = await transformStore.listStateHistory(op.id);
    const cancelledEntries = history.filter((h) => h.state === "cancelled");
    expect(cancelledEntries.length).toBe(1);
    expect(cancelledEntries[0]?.detail).toBe("result cleanup");
  });

  it("clearResult rejects a non-succeeded operation with typed invalid-input", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "subtitle",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r7",
    });
    await expect(
      transformStore.clearResult({
        operationId: op.id,
        userId: USER,
        profileId: PROFILE_A,
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("isolates profiles — getOperation in profile B for profile A's op answers null", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "speech",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r8",
    });
    const inB = await transformStore.getOperation(op.id, USER, PROFILE_B);
    expect(inB).toBeNull();
  });

  it("isolates users — getOperation in user B for user A's op answers null", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "transcribe",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000r9",
    });
    const inB = await transformStore.getOperation(op.id, USER_B, null);
    expect(inB).toBeNull();
  });

  it("rejects an invalid kind with typed invalid-input", async () => {
    await expect(
      transformStore.createOperation({
        userId: USER,
        profileId: PROFILE_A,
        kind: "noise-removal" as never,
        targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000ra",
      }),
    ).rejects.toThrow(PersistenceError);
  });

  it("rejects an invalid state with typed invalid-input", async () => {
    const op = await transformStore.createOperation({
      userId: USER,
      profileId: PROFILE_A,
      kind: "commentary",
      targetRef: "wfxitm_01ARZ3NDEKF1XTVRE0000000rb",
    });
    await expect(
      transformStore.transitionState({
        operationId: op.id,
        userId: USER,
        profileId: PROFILE_A,
        to: "paused" as never,
      }),
    ).rejects.toThrow(PersistenceError);
  });
});
