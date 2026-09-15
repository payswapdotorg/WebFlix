/**
 * WFX-052 — intent + recommendation-state store tests (PGlite, real
 * Postgres).
 *
 * The spec's acceptance points: user-intent/preferences round-trips and the
 * recommendation state round-trip. The stores PERSIST records verbatim —
 * decay/reinforcement/liveness remain domain logic (@wfx/domain).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { IntentId } from "@wfx/domain";
import { FixedClock } from "@wfx/experience";

import {
  PersistenceError,
  PostgresIntentStore,
  PostgresRecommendationStateStore,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 10, 0, 0);
const T0 = "2026-09-13T10:00:00.000Z";
const T1 = "2026-09-13T11:00:00.000Z";
const USER = "wfxusr_00000000000000000000000001";

/** Canonical intent ids, branded for the frozen IntentId contract. */
const INTENT_SPACE = "wfxint_00000000000000000000000001" as IntentId;
const INTENT_LAUGHS = "wfxint_00000000000000000000000002" as IntentId;
const INTENT_REMINT = "wfxint_00000000000000000000000099" as IntentId;

let test: TestDb;
let clock: FixedClock;
let intents: PostgresIntentStore;
let state: PostgresRecommendationStateStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  intents = new PostgresIntentStore({ db: test.db });
  state = new PostgresRecommendationStateStore({ db: test.db, clock });
});

afterAll(async () => {
  await test.close();
});

describe("intent store", () => {
  it("round-trips a full IntentRecord verbatim", async () => {
    await intents.upsertIntent({
      id: INTENT_SPACE,
      userId: USER,
      scope: "persistent",
      objective: "space documentaries",
      weight: 0.7,
      confidence: 0.9,
      provenance: "explicit",
      createdAt: T0,
      updatedAt: T0,
      lastReinforcedAt: T0,
      evidenceCount: 3,
    });
    const reread = await intents.getIntent("wfxint_00000000000000000000000001");
    expect(reread?.userId).toBe(USER);
    expect(reread?.scope).toBe("persistent");
    expect(reread?.objective).toBe("space documentaries");
    expect(reread?.weight).toBe(0.7);
    expect(reread?.confidence).toBe(0.9);
    expect(reread?.provenance).toBe("explicit");
    expect(reread?.evidenceCount).toBe(3);
    expect(reread?.expiresAt).toBeUndefined(); // SQL NULL → absent
  });

  it("round-trips an optional expiry honestly", async () => {
    await intents.upsertIntent({
      id: INTENT_LAUGHS,
      userId: USER,
      scope: "momentary",
      objective: "quick laughs",
      weight: 0.4,
      confidence: 0.5,
      provenance: "inferred",
      expiresAt: "2026-09-13T11:00:00.000Z",
      createdAt: T0,
      updatedAt: T0,
      lastReinforcedAt: T0,
      evidenceCount: 1,
    });
    const reread = await intents.getIntent("wfxint_00000000000000000000000002");
    expect(reread?.expiresAt).toBe("2026-09-13T11:00:00.000Z");
  });

  it("keeps the CANONICAL id stable when the same identity triple is re-upserted", async () => {
    const merged = await intents.upsertIntent({
      id: INTENT_REMINT, // different minted id — must NOT win
      userId: USER,
      scope: "persistent",
      objective: "space documentaries",
      weight: 0.95, // the domain computed the reinforcement
      confidence: 0.95,
      provenance: "explicit",
      createdAt: T0,
      updatedAt: T1,
      lastReinforcedAt: T1,
      evidenceCount: 7,
    });
    expect(merged.id).toBe(INTENT_SPACE);
    expect(merged.weight).toBe(0.95);
    expect(merged.evidenceCount).toBe(7);

    const rows = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM user_intents WHERE user_id = $1",
      [USER],
    );
    expect(rows[0]?.count).toBe("2"); // one per identity triple
  });

  it("lists the user's intents heaviest-first (id ascending as tiebreak)", async () => {
    const listed = await intents.listForUser(USER);
    expect(listed.length).toBe(2);
    expect(listed[0]?.weight).toBeGreaterThanOrEqual(listed[1]?.weight ?? 0);
    expect(listed[0]?.id).toBe(INTENT_SPACE); // 0.95 heaviest
  });

  it("rejects a malformed record typed, writing nothing", async () => {
    let caught: unknown;
    try {
      await intents.upsertIntent({
        id: "not-canonical",
        userId: "",
        scope: "ephemeral",
        objective: "",
        weight: -1,
        confidence: 5,
        provenance: "guessed",
        createdAt: "yesterday",
        updatedAt: "yesterday",
        lastReinforcedAt: "yesterday",
        evidenceCount: 0,
      } as unknown as Parameters<PostgresIntentStore["upsertIntent"]>[0]);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");
    expect((caught as PersistenceError).operation).toBe("upsertIntent");
    expect(await intents.getIntent("not-canonical")).toBeNull();
  });

  it("deletes by id and answers getIntent null for unknown ids", async () => {
    expect(await intents.deleteIntent("wfxint_00000000000000000000000002")).toBe(true);
    expect(await intents.deleteIntent("wfxint_00000000000000000000000002")).toBe(false);
    expect(await intents.getIntent("wfxint_00000000000000000000000002")).toBeNull();
  });
});

describe("recommendation state store", () => {
  const policy = {
    id: "wfxpol_00000000000000000000000001",
    userId: USER,
    objectives: [
      { id: "novelty", weight: 0.8, direction: "maximize" as const },
      { id: "fatigue", weight: 0.3, direction: "minimize" as const },
    ],
    exploration: 0.4,
    novelty: 0.6,
    socialInfluence: 0.2,
    attentionMode: "balanced" as const,
  };

  it("save + load round-trips the frozen policy AND the opaque engine blob", async () => {
    const saved = await state.save({
      userId: USER,
      policy,
      state: { fatigue: { "wfxitm_00000000000000000000000001": 3 }, version: 2 },
    });
    expect(saved.policy.attentionMode).toBe("balanced");

    const loaded = await state.load(USER);
    expect(loaded.found).toBe(true);
    expect(loaded.state?.policy).toEqual(policy);
    expect(loaded.state?.state).toEqual({
      fatigue: { "wfxitm_00000000000000000000000001": 3 },
      version: 2,
    });
  });

  it("re-save replaces the row (one row per user)", async () => {
    await state.save({
      userId: USER,
      policy: { ...policy, attentionMode: "immersive" },
      state: { version: 3 },
    });
    const rows = await test.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM recommendation_state WHERE user_id = $1",
      [USER],
    );
    expect(rows[0]?.count).toBe("1");
    const loaded = await state.load(USER);
    expect(loaded.state?.policy.attentionMode).toBe("immersive");
    expect(loaded.state?.state).toEqual({ version: 3 });
  });

  it("load answers found:false for a user with no row (a query, not an error)", async () => {
    const loaded = await state.load("wfxusr_000000000000000000000099");
    expect(loaded.found).toBe(false);
    expect(loaded.state).toBeNull();
  });

  it("rejects an invalid policy typed on WRITE (the policy is user-controlled law)", async () => {
    let caught: unknown;
    try {
      await state.save({
        userId: USER,
        policy: { ...policy, attentionMode: "chaotic" },
      } as unknown as Parameters<PostgresRecommendationStateStore["save"]>[0]);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as Error).message).toContain("policy");
  });

  it("a stored policy that no longer validates is a TYPED incident on read", async () => {
    // Tamper directly (schema drift simulation), then load.
    await test.db.query(
      `UPDATE recommendation_state SET policy = jsonb_build_object('broken', true) WHERE user_id = $1`,
      [USER],
    );
    let caught: unknown;
    try {
      await state.load(USER);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as Error).message).toContain("failed validation");
  });

  it("delete removes the row and reports honestly", async () => {
    // Restore a valid row first.
    await state.save({ userId: USER, policy });
    expect(await state.delete(USER)).toBe(true);
    expect(await state.delete(USER)).toBe(false);
    expect((await state.load(USER)).found).toBe(false);
  });
});
