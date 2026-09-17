/**
 * R05 — recommendation-feedback store + active-intent reads (PGlite, real
 * Postgres).
 *
 * The spec's acceptance points:
 * - feedback CRUD round-trip; update-in-place determinism (same control
 *   re-submitted = one row, stable id, refreshed timestamp); delete = gone
 *   (no soft-delete theater); profile isolation (two profiles never see or
 *   remove each other's controls).
 * - the R01 live-expiry law, server side: expired temporary intents are
 *   filtered at read (`listActiveForProfile`), stored but not surfaced.
 * - profile-scoped intent get/delete (the undo law's isolation half).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { IntentId } from "@wfx/domain";
import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  PersistenceError,
  PostgresIntentStore,
  PostgresRecommendationFeedbackStore,
  type IntentUpsertInput,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 10, 0, 0);
const T0 = "2026-09-13T10:00:00.000Z";
const USER = "wfxusr_00000000000000000000000001";
const PROFILE_A = "wfxprof_00000000000000000000000001";
const PROFILE_B = "wfxprof_00000000000000000000000002";
const ITEM_1 = "wfxitm_00000000000000000000000011";
const ITEM_2 = "wfxitm_00000000000000000000000012";

let test: TestDb;
let clock: FixedClock;
let ids: SequentialIdGen;
let feedback: PostgresRecommendationFeedbackStore;
let intents: PostgresIntentStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  ids = new SequentialIdGen();
  feedback = new PostgresRecommendationFeedbackStore({ db: test.db, clock, ids });
  intents = new PostgresIntentStore({ db: test.db });
});

afterAll(async () => {
  await test.close();
});

/** A full IntentRecord literal for the upsert seam. */
function intentRecord(over: Partial<IntentUpsertInput>): IntentUpsertInput {
  return {
    id: "wfxint_00000000000000000000000101" as IntentId,
    userId: USER,
    scope: "persistent",
    objective: "space documentaries",
    weight: 0.7,
    confidence: 1,
    provenance: "explicit",
    createdAt: T0,
    updatedAt: T0,
    lastReinforcedAt: T0,
    evidenceCount: 1,
    ...over,
  };
}

describe("recommendation feedback store (R05, migration 0010)", () => {
  it("round-trips one not-interested control per profile", async () => {
    const added = await feedback.addForProfile({
      userId: USER,
      profileId: PROFILE_A,
      kind: "not-interested",
      targetId: ITEM_1,
      note: "too bleak",
    });
    expect(added.id.startsWith("wfxfeed_")).toBe(true);
    expect(added.kind).toBe("not-interested");
    expect(added.targetType).toBe("item");
    expect(added.targetId).toBe(ITEM_1);
    expect(added.note).toBe("too bleak");
    expect(added.createdAt).toBe(new Date(CLOCK_START).toISOString());

    const listed = await feedback.listForProfile(PROFILE_A);
    expect(listed.length).toBe(1);
    expect(listed[0]!.id).toBe(added.id);
  });

  it("update-in-place determinism: re-submitting the same control keeps ONE row, stable id", async () => {
    const first = await feedback.addForProfile({
      userId: USER,
      profileId: PROFILE_A,
      kind: "not-interested",
      targetId: ITEM_1,
    });
    clock.advance(5 * 60_000);
    const second = await feedback.addForProfile({
      userId: USER,
      profileId: PROFILE_A,
      kind: "not-interested",
      targetId: ITEM_1,
      note: "still too bleak",
    });
    expect(second.id).toBe(first.id); // the canonical id NEVER changes
    expect(second.createdAt).toBe(new Date(CLOCK_START + 5 * 60_000).toISOString());
    const listed = await feedback.listForProfile(PROFILE_A);
    const matches = listed.filter((row) => row.kind === "not-interested" && row.targetId === ITEM_1);
    expect(matches.length).toBe(1); // never duplicates
    expect(matches[0]!.note).toBe("still too bleak");
  });

  it("distinct kinds/targets coexist; the newest-first order law holds", async () => {
    clock.advance(60_000);
    await feedback.addForProfile({ userId: USER, profileId: PROFILE_A, kind: "more-like-this", targetId: ITEM_2 });
    clock.advance(60_000);
    await feedback.addForProfile({ userId: USER, profileId: PROFILE_A, kind: "dont-recommend-source", targetId: "youtube" });
    const listed = await feedback.listForProfile(PROFILE_A);
    expect(listed.length).toBe(3);
    // Newest first.
    expect(listed[0]!.kind).toBe("dont-recommend-source");
    expect(listed[1]!.kind).toBe("more-like-this");
    expect(listed[2]!.kind).toBe("not-interested");
    // The structural kind -> target-type law.
    expect(listed[0]!.targetType).toBe("source");
  });

  it("typed invalid-input on a garbage kind or target", async () => {
    let caught: unknown;
    try {
      await feedback.addForProfile({
        userId: USER,
        profileId: PROFILE_A,
        // @ts-expect-error -- caller misuse under test
        kind: "banish-forever",
        targetId: ITEM_1,
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    expect((caught as PersistenceError).kind).toBe("invalid-input");

    caught = undefined;
    try {
      await feedback.addForProfile({
        userId: USER,
        profileId: PROFILE_A,
        kind: "already-watched",
        targetId: "   ", // whitespace-only: rejected at RUNTIME (the trim law)
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
  });

  it("profile isolation: profile B never lists, gets, or deletes profile A's controls", async () => {
    const aRows = await feedback.listForProfile(PROFILE_A);
    expect(aRows.length).toBeGreaterThan(0);

    expect(await feedback.listForProfile(PROFILE_B)).toEqual([]);
    const aRow = aRows[0]!;
    expect(await feedback.getForProfile(PROFILE_B, aRow.id)).toBeNull();
    expect(await feedback.deleteForProfile(PROFILE_B, aRow.id)).toBe(false);

    // A's controls survive B's failed attempts untouched.
    expect((await feedback.listForProfile(PROFILE_A)).length).toBe(aRows.length);
  });

  it("delete = gone (no soft-delete theater): the row leaves the list and the table", async () => {
    const added = await feedback.addForProfile({
      userId: USER,
      profileId: PROFILE_A,
      kind: "already-watched",
      targetId: ITEM_2,
    });
    expect(await feedback.deleteForProfile(PROFILE_A, added.id)).toBe(true);
    expect(await feedback.getForProfile(PROFILE_A, added.id)).toBeNull();
    // Delete is idempotent-honest: a second delete answers false.
    expect(await feedback.deleteForProfile(PROFILE_A, added.id)).toBe(false);
    const survivors = (await feedback.listForProfile(PROFILE_A)).filter(
      (row) => row.id === added.id,
    );
    expect(survivors).toEqual([]);
  });

  it("the migration-0010 CHECK law: a mismatched kind/target pair is rejected by the engine", async () => {
    // Bypass the store's derivation and write a structurally inconsistent
    // row straight through SQL — the TABLE must refuse it.
    let caught: unknown;
    try {
      await test.db.query(
        `INSERT INTO recommendation_feedback (id, user_id, profile_id, kind, target_type, target_id, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
        [
          "wfxfeed_0000000000000000000000099",
          USER,
          PROFILE_A,
          "dont-recommend-source", // requires target_type 'source'
          "item", // ...but claims an item
          ITEM_1,
          T0,
        ],
      );
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeDefined();
    expect(String(caught)).toContain("check");
  });
});

describe("active-intent reads (R05 — the R01 live-expiry law, server side)", () => {
  it("expired temporary intents are filtered at read; live ones surface", async () => {
    const now = new Date(CLOCK_START).toISOString();
    await intents.upsertIntentForProfile(
      intentRecord({
        id: "wfxint_00000000000000000000000201" as IntentId,
        scope: "temporary",
        objective: "cozy-comedy-tonight",
        expiresAt: "2026-09-13T09:00:00.000Z", // an hour BEFORE the clock
      }),
      PROFILE_A,
    );
    await intents.upsertIntentForProfile(
      intentRecord({
        id: "wfxint_00000000000000000000000202" as IntentId,
        scope: "temporary",
        objective: "space-marathon-weekend",
        expiresAt: "2026-09-13T12:00:00.000Z", // two hours AFTER the clock
      }),
      PROFILE_A,
    );
    await intents.upsertIntentForProfile(
      intentRecord({
        id: "wfxint_00000000000000000000000203" as IntentId,
        scope: "persistent",
        objective: "space documentaries",
      }),
      PROFILE_A,
    );

    const active = await intents.listActiveForProfile(PROFILE_A, now);
    const objectives = active.map((row) => row.objective);
    expect(objectives).not.toContain("cozy-comedy-tonight"); // expired — gone from the active set
    expect(objectives).toContain("space-marathon-weekend"); // live
    expect(objectives).toContain("space documentaries"); // never expires

    // The stored set keeps the expired row (audit truth).
    const all = await intents.listForProfile(PROFILE_A);
    expect(all.map((row) => row.objective)).toContain("cozy-comedy-tonight");
  });

  it("expiry is LIVE: advancing the clock retires the second temporary intent too", async () => {
    const later = new Date(CLOCK_START + 3 * 60 * 60_000).toISOString(); // 13:00
    const active = await intents.listActiveForProfile(PROFILE_A, later);
    expect(active.map((row) => row.objective)).not.toContain("space-marathon-weekend");
    expect(active.map((row) => row.objective)).toContain("space documentaries");
  });

  it("profile isolation: another profile's intents never surface", async () => {
    await intents.upsertIntentForProfile(
      intentRecord({
        id: "wfxint_00000000000000000000000301" as IntentId,
        objective: "only-profile-b-knows",
      }),
      PROFILE_B,
    );
    const active = await intents.listActiveForProfile(PROFILE_A, new Date(CLOCK_START).toISOString());
    expect(active.map((row) => row.objective)).not.toContain("only-profile-b-knows");
  });

  it("the profile-scoped get/delete forms answer the isolation law", async () => {
    const record = await intents.upsertIntentForProfile(
      intentRecord({
        id: "wfxint_00000000000000000000000401" as IntentId,
        objective: "scoped-undo-target",
      }),
      PROFILE_B,
    );
    expect(await intents.getIntentForProfile(PROFILE_A, record.id)).toBeNull();
    expect(await intents.deleteIntentForProfile(PROFILE_A, record.id)).toBe(false);
    expect(await intents.getIntentForProfile(PROFILE_B, record.id)).not.toBeNull();
    expect(await intents.deleteIntentForProfile(PROFILE_B, record.id)).toBe(true);
    expect(await intents.getIntentForProfile(PROFILE_B, record.id)).toBeNull();
  });
});
