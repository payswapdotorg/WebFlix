/**
 * R05 — the recommendation feedback store tests (PGlite, real Postgres).
 *
 * The R05 spec's acceptance points at the persistence layer:
 * - the migration 0010 table exists with the honest shape (kind CHECK
 *   enforced at the DB boundary too);
 * - CRUD: idempotent add (earliest created_at wins), ordered list,
 *   profile-scoped get, REAL delete (gone — no soft-delete theater);
 * - PROFILE ISOLATION: two profiles never see each other's controls;
 * - validation: typed invalid-input on malformed records.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock } from "@wfx/experience";

import {
  PersistenceError,
  PostgresRecommendationFeedbackStore,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 13, 10, 0, 0);
const USER = "wfxusr_00000000000000000000000001";
const USER_B = "wfxusr_00000000000000000000000002";
const ITEM = "wfxitm_01ARZ3NDEKF1XTVRE000000001";

let test: TestDb;
let clock: FixedClock;
let ids: { next(): string; n: number };
let store: PostgresRecommendationFeedbackStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  let counter = 0;
  ids = {
    n: 0,
    next() {
      counter += 1;
      return `01ARZ3NDEKF1XTVRE${String(counter).padStart(9, "0")}`;
    },
  };
  store = new PostgresRecommendationFeedbackStore({ db: test.db, clock, ids });
});

afterAll(async () => {
  await test.close();
});

describe("R05 migration 0010 — recommendation_feedback", () => {
  it("creates the table with the honest shape (kind CHECK enforced by the DB)", async () => {
    const columns = await test.raw.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'recommendation_feedback' ORDER BY ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toEqual([
      "id",
      "user_id",
      "profile_id",
      "kind",
      "target",
      "note",
      "created_at",
    ]);
    const check = await test.raw.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conrelid = 'recommendation_feedback'::regclass AND contype = 'c'`,
    );
    expect(check.rows[0]!.consrc).toContain("more-like-this");
    expect(check.rows[0]!.consrc).toContain("already-watched");
    // The CHECK has teeth: an out-of-vocabulary kind is rejected.
    await expect(
      test.db.query(
        `INSERT INTO recommendation_feedback (id, user_id, kind, target, created_at)
         VALUES ('wfxfb_bad', $1, 'ban-everything', 'x', $2)`,
        [USER, "2026-09-13T10:00:00.000Z"],
      ),
    ).rejects.toThrow();
  });
});

describe("R05 feedback store — CRUD + reversibility", () => {
  it("adds a control and reads it back verbatim (kind/target/note/timestamp)", async () => {
    const record = await store.addForProfile(
      { userId: USER, kind: "not-interested", target: ITEM, note: "seen it" },
      "user:" + USER,
    );
    expect(record.id.startsWith("wfxfb_")).toBe(true);
    expect(record.kind).toBe("not-interested");
    expect(record.target).toBe(ITEM);
    expect(record.note).toBe("seen it");
    expect(record.createdAt).toBe("2026-09-13T10:00:00.000Z");
  });

  it("re-submitting the same (profile, kind, target) is IDEMPOTENT: the earliest created_at wins", async () => {
    clock.advance(60_000);
    const again = await store.addForProfile(
      { userId: USER, kind: "not-interested", target: ITEM },
      "user:" + USER,
    );
    expect(again.createdAt).toBe("2026-09-13T10:00:00.000Z"); // NOT 10:01
    const list = await store.listForProfile("user:" + USER);
    expect(list.filter((r) => r.kind === "not-interested" && r.target === ITEM).length).toBe(1);
  });

  it("different kinds/targets are SEPARATE controls (the identity is the triple)", async () => {
    await store.addForProfile(
      { userId: USER, kind: "more-like-this", target: ITEM },
      "user:" + USER,
    );
    const list = await store.listForProfile("user:" + USER);
    expect(list.length).toBe(2); // not-interested + more-like-this on the same item
  });

  it("DELETE is a REAL delete: gone, no soft-delete theater; re-adding mints a new row", async () => {
    const list = await store.listForProfile("user:" + USER);
    const first = list[0]!;
    const removed = await store.deleteForProfile("user:" + USER, first.id);
    expect(removed).toBe(true);
    expect(await store.getForProfile("user:" + USER, first.id)).toBeNull();
    await expect(store.deleteForProfile("user:" + USER, first.id)).resolves.toBe(false);
    // A foreign profile cannot delete it either (it is already gone, but a
    // live control would answer false for them too — the isolation law).
    await store.addForProfile(
      { userId: USER, kind: "already-watched", target: ITEM },
      "user:" + USER,
    );
    const live = await store.listForProfile("user:" + USER);
    const watched = live.find((r) => r.kind === "already-watched")!;
    expect(await store.deleteForProfile("user:" + USER_B, watched.id)).toBe(false);
    expect(await store.getForProfile("user:" + USER, watched.id)).not.toBeNull();
  });

  it("lists oldest-first (stable: created_at asc, id asc)", async () => {
    const fresh = await store.listForProfile("user:" + USER);
    for (let index = 1; index < fresh.length; index += 1) {
      expect(fresh[index]!.createdAt >= fresh[index - 1]!.createdAt).toBe(true);
    }
  });
});

describe("R05 feedback store — PROFILE ISOLATION", () => {
  it("two profiles never see each other's controls", async () => {
    await store.addForProfile(
      { userId: USER, kind: "not-interested", target: "wfxitm_01ARZ3NDEKF1XTVRE000000010" },
      "wfxprof_00000000000000000000000001",
    );
    await store.addForProfile(
      { userId: USER_B, kind: "dont-recommend-source", target: "youtube" },
      "wfxprof_00000000000000000000000002",
    );
    const a = await store.listForProfile("wfxprof_00000000000000000000000001");
    const b = await store.listForProfile("wfxprof_00000000000000000000000002");
    expect(a.map((r) => r.kind)).toEqual(["not-interested"]);
    expect(b.map((r) => r.kind)).toEqual(["dont-recommend-source"]);
    // Cross-profile get/delete: invisible.
    const bOnly = b[0]!;
    expect(await store.getForProfile("wfxprof_00000000000000000000000001", bOnly.id)).toBeNull();
    expect(await store.deleteForProfile("wfxprof_00000000000000000000000001", bOnly.id)).toBe(false);
  });

  it("the same (kind, target) under two profiles are TWO rows (not a shared one)", async () => {
    await store.addForProfile(
      { userId: USER, kind: "not-interested", target: "wfxitm_01ARZ3NDEKF1XTVRE000000020" },
      "wfxprof_00000000000000000000000001",
    );
    await store.addForProfile(
      { userId: USER_B, kind: "not-interested", target: "wfxitm_01ARZ3NDEKF1XTVRE000000020" },
      "wfxprof_00000000000000000000000002",
    );
    const rows = await test.raw.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM recommendation_feedback
       WHERE target = 'wfxitm_01ARZ3NDEKF1XTVRE000000020'`,
    );
    expect(rows.rows[0]!.count).toBe(2);
  });
});

describe("R05 feedback store — validation honesty", () => {
  it("rejects malformed records with the typed invalid-input (every problem collected)", async () => {
    let caught: unknown;
    try {
      await store.addForProfile(
        { userId: "", kind: "", target: "", note: "x".repeat(501) },
        "user:" + USER,
      );
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceError);
    const error = caught as PersistenceError;
    expect(error.kind).toBe("invalid-input");
    expect(error.message).toContain("userId");
    expect(error.message).toContain("kind");
    expect(error.message).toContain("target");
    expect(error.message).toContain("note");
  });
});
