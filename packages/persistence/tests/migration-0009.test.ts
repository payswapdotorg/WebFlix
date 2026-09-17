/**
 * @wfx/persistence — R04 migration 0009 tests (canonical-keyed library +
 * history removals/exclusions tables; PGlite, real Postgres).
 *
 * Acceptance points:
 * - The migration applies cleanly over the 0001..0008 baseline.
 * - It is IDEMPOTENT: re-running applies nothing and verifies everything.
 * - The canonical-keyed unique index `library_entries_profile_canonical_key`
 *   EXISTS and enforces ONE row per (effective profile, item_id) for rows
 *   with a non-NULL item_id.
 * - The realization-keyed unique index `library_entries_profile_key` is GONE.
 * - Duplicate (effective_profile, item_id) rows from different realizations
 *   MERGE into ONE row (earliest added_at wins).
 * - Legacy rows whose realization vanished (NULL item_id) stay listed
 *   honestly (no NULL collapse; multiple NULLs coexist).
 * - `history_removals` and `history_exclusions` tables EXIST with the
 *   (effective_profile, item_id) unique key.
 *
 * Determinism: PGlite + the injected test clock + the migration runner.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";

import {
  defaultMigrationsDir,
  loadMigrationsFromDir,
  runMigrations,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

/** One SHARED migrated DB for the read-only schema assertions (load law:
 * one boot per file where the tests do not mutate state). */
let schema: TestDb;
beforeAll(async () => {
  schema = await createTestDb();
});
afterAll(async () => {
  await schema.close();
});

describe("migration 0009 — canonical-keyed library + history tables", () => {
  it("the 0009 migration file ships in the migrations directory", () => {
    const files = loadMigrationsFromDir(defaultMigrationsDir());
    const ids = files.map((f) => f.id);
    expect(ids).toContain("0009_canonical_library_history_exclusions");
  });

  it("is idempotent: re-running the migration set applies nothing", async () => {
    const result = await runMigrations(schema.db);
    expect(result.applied).toEqual([]);
    expect(result.verified.length).toBe(result.total);
  });

  it("creates the canonical-keyed unique index ALONGSIDE the realization one", async () => {
    const canonical = await schema.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'library_entries' AND indexname = 'library_entries_profile_canonical_key'`,
    );
    expect(canonical.length).toBe(1);
    // The realization-keyed unique index from 0007 is KEPT — it catches
    // re-saves of the SAME realization when item_id is NULL (the legacy
    // "listed honestly even when the realization vanished" path).
    const realization = await schema.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'library_entries' AND indexname = 'library_entries_profile_key'`,
    );
    expect(realization.length).toBe(1);
  });

  it("creates history_removals and history_exclusions tables with the canonical-key indexes", async () => {
    const removals = await schema.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'history_removals'`,
    );
    expect(removals.length).toBe(1);
    const exclusions = await schema.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'history_exclusions'`,
    );
    expect(exclusions.length).toBe(1);
    const removalIdx = await schema.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'history_removals' AND indexname = 'history_removals_profile_key'`,
    );
    expect(removalIdx.length).toBe(1);
    const exclIdx = await schema.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'history_exclusions' AND indexname = 'history_exclusions_profile_key'`,
    );
    expect(exclIdx.length).toBe(1);
  });

  it("the canonical-keyed unique index prevents duplicate (profile, item) rows", async () => {
    const test = await createTestDb();
    try {
      // Seed a canonical item with a realization.
      const now = "2026-09-16T12:00:00.000Z";
      await test.db.query(
        `INSERT INTO entertainment_items (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics, created_at, updated_at)
         VALUES ('wfxitm_idx_test', 'video', 'Idx Test', 1000, 'horizontal', '[]'::jsonb, '[]'::jsonb, $1, $1)`,
        [now],
      );
      await test.db.query(
        `INSERT INTO source_realizations (id, entertainment_item_id, connector_id, external_ref, capabilities, availability, playback, created_at, updated_at)
         VALUES ('wfxsrc_idx_a', 'wfxitm_idx_test', 'webflix-catalog', 'cat:idx-a', '["playEmbed"]', 'available', '[]'::jsonb, $1, $1)`,
        [now],
      );
      // First save lands.
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, item_id, title, added_at, metadata)
         VALUES ('wfxusr_idx', NULL, 'webflix-catalog', 'cat:idx-a', 'wfxitm_idx_test', 'Idx Test', $1, '{}'::jsonb)`,
        [now],
      );
      // A second save of the SAME canonical item from a DIFFERENT source
      // (same item_id) must be a no-op on the list count: ON CONFLICT DO
      // NOTHING answers no rows (the realization set would grow via the
      // store's upsert path — the index itself enforces the canonical key).
      const result = await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, item_id, title, added_at, metadata)
         VALUES ('wfxusr_idx', NULL, 'other-source', 'cat:idx-b', 'wfxitm_idx_test', 'Idx Test', $1, '{}'::jsonb)
         ON CONFLICT (COALESCE(profile_id, 'user:' || user_id), item_id) DO NOTHING`,
        [now],
      );
      expect(result.length).toBe(0);
      // The library list still has ONE entry for the canonical item.
      const rows = await test.db.query<{ external_ref: string }>(
        `SELECT external_ref FROM library_entries WHERE user_id = 'wfxusr_idx'`,
      );
      expect(rows.length).toBe(1);
    } finally {
      await test.close();
    }
  });
});

// ---------------------------------------------------------------------------
// THE CONVERSION LAW — realization-keyed rows migrate to canonical keys
// (duplicate resolution: earliest-saved row wins, realizations merge,
// no data loss; idempotent; legacy NULL rows stay listed)
// ---------------------------------------------------------------------------

/** The pre-R04 (0001..0008) migration source. */
function preR04Source() {
  const files = loadMigrationsFromDir(defaultMigrationsDir());
  const pre = files.filter((file) => !file.id.startsWith("0009"));
  if (pre.length === 0) throw new Error("test setup: no pre-0009 migrations found");
  return { list: () => pre };
}

/**
 * A FRESH, UNMIGRATED PGlite (unlike `createTestDb`, which applies the full
 * set at boot) — the conversion law needs to seed the PRE-0009 state before
 * 0009 applies. Same DbClient wrapper shape as the shared harness.
 */
async function createUnmigratedDb(): Promise<TestDb> {
  const pglite = new PGlite();
  const query = async <Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]> => {
    const result = await pglite.query(sqlText, params as unknown[]);
    return result.rows as unknown as Row[];
  };
  const db: DbClient = {
    query,
    begin: async <T>(work: (tx: SqlClient) => Promise<T>): Promise<T> => {
      return pglite.transaction(async (tx) => {
        return work({
          async query<Row extends object = SqlRow>(
            txText: string,
            txParams?: readonly unknown[],
          ): Promise<Row[]> {
            const result = await tx.query(txText, txParams as unknown[]);
            return result.rows as unknown as Row[];
          },
        }) as Promise<T>;
      });
    },
    close: async () => {
      await pglite.close();
    },
  };
  return { db, raw: pglite, close: db.close };
}

interface MigratedRow {
  item_id: string | null;
  connector_id: string;
  external_ref: string;
  title: string;
  added_at: unknown;
  metadata: { realizations?: Array<{ connectorId: string; externalRef: string; addedAt: string }> } | null;
}

/** Normalize a driver timestamp (Date | string) to ISO 8601 (the harness law). */
function iso(value: unknown): string {
  return new Date(value as string).toISOString();
}

describe("migration 0009 — THE CONVERSION LAW (realization-keyed → canonical-keyed)", () => {
  it("migrates duplicate realization-keyed rows: earliest wins, realizations MERGE, no data loss", async () => {
    const test = await createUnmigratedDb();
    try {
      // 1. Apply the pre-R04 baseline only (0001..0008).
      const baseline = await runMigrations(test.db, { source: preR04Source() });
      expect(baseline.applied.length).toBe(8);

      // 2. Seed the PRE-R04 state: one canonical item with TWO realizations
      //    (different sources), saved TWICE (the realization-keyed duplicate
      //    state), plus a legacy row whose realization has no catalog row.
      const now = "2026-09-16T12:00:00.000Z";
      await test.db.query(
        `INSERT INTO entertainment_items (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics, created_at, updated_at)
         VALUES ('wfxitm_conv_test', 'movie', 'Conversion Law Test', 5000, 'horizontal', '[]'::jsonb, '[]'::jsonb, $1, $1)`,
        [now],
      );
      await test.db.query(
        `INSERT INTO source_realizations (id, entertainment_item_id, connector_id, external_ref, capabilities, availability, playback, created_at, updated_at)
         VALUES ('wfxsrc_conv_a', 'wfxitm_conv_test', 'source-a', 'a:ref-1', '["playEmbed"]', 'available', '[]'::jsonb, $1, $1)`,
        [now],
      );
      await test.db.query(
        `INSERT INTO source_realizations (id, entertainment_item_id, connector_id, external_ref, capabilities, availability, playback, created_at, updated_at)
         VALUES ('wfxsrc_conv_b', 'wfxitm_conv_test', 'source-b', 'b:ref-2', '["playNative"]', 'available', '[]'::jsonb, $1, $1)`,
        [now],
      );
      // The EARLIEST save (source-a, t1) — the duplicate-resolution WINNER.
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ('wfxusr_conv', NULL, 'source-a', 'a:ref-1', 'Earliest Title', $1, '{"list":"Saved"}'::jsonb)`,
        ["2026-09-16T10:00:00.000Z"],
      );
      // The LATER save (source-b, t2) — the duplicate-resolution LOSER.
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ('wfxusr_conv', NULL, 'source-b', 'b:ref-2', 'Later Title', $1, '{}'::jsonb)`,
        ["2026-09-16T11:00:00.000Z"],
      );
      // A legacy row whose realization vanished (no source_realizations row)
      // — stays listed with a NULL item_id.
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ('wfxusr_conv', NULL, 'gone-source', 'gone:ref-9', 'Vanished Source', $1, '{}'::jsonb)`,
        ["2026-09-16T09:00:00.000Z"],
      );
      // A second user's row (different effective-profile partition) — must
      // NOT be touched by the merge.
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ('wfxusr_other', NULL, 'source-a', 'a:ref-1', 'Other User', $1, '{}'::jsonb)`,
        ["2026-09-16T10:30:00.000Z"],
      );

      // 3. Apply 0009 (the only outstanding migration).
      const applied = await runMigrations(test.db);
      expect(applied.applied).toEqual(["0009_canonical_library_history_exclusions"]);

      // 4. THE MERGE: exactly ONE row for (user, item) — the earliest-saved
      //    row WINS (its title, its added_at, its metadata.list preserved).
      const rows = await test.db.query<MigratedRow>(
        `SELECT item_id, connector_id, external_ref, title, added_at, metadata
           FROM library_entries WHERE user_id = 'wfxusr_conv'`,
      );
      expect(rows.length).toBe(2); // the canonical-keyed row + the vanished-source legacy row
      const merged = rows.find((row) => row.item_id === "wfxitm_conv_test");
      expect(merged).toBeDefined();
      expect(merged?.title).toBe("Earliest Title"); // earliest row's title wins
      expect(iso(merged?.added_at)).toBe("2026-09-16T10:00:00.000Z"); // earliest added_at wins
      expect(merged?.connector_id).toBe("source-a"); // earliest row's primary ref wins
      expect(merged?.external_ref).toBe("a:ref-1");
      expect((merged?.metadata as Record<string, unknown>)?.list).toBe("Saved"); // no metadata loss

      // 5. REALIZATIONS MERGE: the winner's metadata.realizations carries
      //    BOTH realization references (the loser's reference survives —
      //    no data loss) with deterministic addedAt stamps.
      const realizations = merged?.metadata?.realizations ?? [];
      expect(realizations.length).toBe(2);
      const byRef = new Map(realizations.map((r) => [r.externalRef, r]));
      expect(byRef.get("a:ref-1")).toMatchObject({ connectorId: "source-a" });
      expect(byRef.get("b:ref-2")).toMatchObject({ connectorId: "source-b" });
      expect(byRef.get("a:ref-1")?.addedAt).toBe("2026-09-16T10:00:00.000Z");
      expect(byRef.get("b:ref-2")?.addedAt).toBe("2026-09-16T11:00:00.000Z");

      // 6. The legacy vanished-realization row stays listed (NULL item_id,
      //    untouched primary ref — honest unavailable, still saved).
      const legacy = rows.find((row) => row.item_id === null);
      expect(legacy).toBeDefined();
      expect(legacy?.external_ref).toBe("gone:ref-9");
      expect(legacy?.title).toBe("Vanished Source");

      // 7. The OTHER user's partition is untouched (still its own row).
      const other = await test.db.query<{ item_id: string | null; title: string }>(
        `SELECT item_id, title FROM library_entries WHERE user_id = 'wfxusr_other'`,
      );
      expect(other.length).toBe(1);
      expect(other[0]?.item_id).toBe("wfxitm_conv_test");
      expect(other[0]?.title).toBe("Other User");
    } finally {
      await test.close();
    }
  });

  it("is idempotent at the DATA level: re-applying the 0009 statements changes nothing", async () => {
    const test = await createUnmigratedDb();
    try {
      await runMigrations(test.db, { source: preR04Source() });
      const now = "2026-09-16T12:00:00.000Z";
      await test.db.query(
        `INSERT INTO entertainment_items (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics, created_at, updated_at)
         VALUES ('wfxitm_idem_test', 'movie', 'Idem Test', 5000, 'horizontal', '[]'::jsonb, '[]'::jsonb, $1, $1)`,
        [now],
      );
      await test.db.query(
        `INSERT INTO source_realizations (id, entertainment_item_id, connector_id, external_ref, capabilities, availability, playback, created_at, updated_at)
         VALUES ('wfxsrc_idem_a', 'wfxitm_idem_test', 'source-a', 'a:idem-1', '["playEmbed"]', 'available', '[]'::jsonb, $1, $1)`,
        [now],
      );
      await test.db.query(
        `INSERT INTO source_realizations (id, entertainment_item_id, connector_id, external_ref, capabilities, availability, playback, created_at, updated_at)
         VALUES ('wfxsrc_idem_b', 'wfxitm_idem_test', 'source-b', 'b:idem-2', '["playNative"]', 'available', '[]'::jsonb, $1, $1)`,
        [now],
      );
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ('wfxusr_idem', NULL, 'source-a', 'a:idem-1', 'First', '2026-09-16T10:00:00.000Z', '{}'::jsonb)`,
      );
      await test.db.query(
        `INSERT INTO library_entries (user_id, profile_id, connector_id, external_ref, title, added_at, metadata)
         VALUES ('wfxusr_idem', NULL, 'source-b', 'b:idem-2', 'Second', '2026-09-16T11:00:00.000Z', '{}'::jsonb)`,
      );
      await runMigrations(test.db);

      // Capture the post-migration state.
      const before = await test.db.query<MigratedRow>(
        `SELECT item_id, connector_id, external_ref, title, added_at, metadata
           FROM library_entries WHERE user_id = 'wfxusr_idem' ORDER BY added_at`,
      );
      expect(before.length).toBe(1);

      // Re-play the 0009 statements VERBATIM (statement-level idempotency —
      // the migration file's discipline; the runner itself skips by id, but
      // every statement must also be safe to re-run).
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const sql = readFileSync(
        join(defaultMigrationsDir(), "0009_canonical_library_history_exclusions.sql"),
        "utf8",
      );
      const { splitStatements } = await import("../src/migrations");
      for (const statement of splitStatements(sql)) {
        await test.db.query(statement);
      }

      // The state is UNCHANGED — the same single row, the same merged
      // realization set (statement re-play neither re-appends nor drops).
      const after = await test.db.query<MigratedRow>(
        `SELECT item_id, connector_id, external_ref, title, added_at, metadata
           FROM library_entries WHERE user_id = 'wfxusr_idem' ORDER BY added_at`,
      );
      expect(after.length).toBe(1);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    } finally {
      await test.close();
    }
  });
});
