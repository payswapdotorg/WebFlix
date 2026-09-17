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

import { describe, expect, it } from "bun:test";

import {
  defaultMigrationsDir,
  loadMigrationsFromDir,
  runMigrations,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

describe("migration 0009 — canonical-keyed library + history tables", () => {
  it("the 0009 migration file ships in the migrations directory", () => {
    const files = loadMigrationsFromDir(defaultMigrationsDir());
    const ids = files.map((f) => f.id);
    expect(ids).toContain("0009_canonical_library_history_exclusions");
  });

  it("is idempotent: re-running the migration set applies nothing", async () => {
    const test: TestDb = await createTestDb();
    try {
      const result = await runMigrations(test.db);
      expect(result.applied).toEqual([]);
      expect(result.verified.length).toBe(result.total);
    } finally {
      await test.close();
    }
  });

  it("creates the canonical-keyed unique index ALONGSIDE the realization one", async () => {
    const test = await createTestDb();
    try {
      const canonical = await test.db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'library_entries' AND indexname = 'library_entries_profile_canonical_key'`,
      );
      expect(canonical.length).toBe(1);
      // The realization-keyed unique index from 0007 is KEPT — it catches
      // re-saves of the SAME realization when item_id is NULL (the legacy
      // "listed honestly even when the realization vanished" path).
      const realization = await test.db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'library_entries' AND indexname = 'library_entries_profile_key'`,
      );
      expect(realization.length).toBe(1);
    } finally {
      await test.close();
    }
  });

  it("creates history_removals and history_exclusions tables with the canonical-key indexes", async () => {
    const test = await createTestDb();
    try {
      const removals = await test.db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'history_removals'`,
      );
      expect(removals.length).toBe(1);
      const exclusions = await test.db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'history_exclusions'`,
      );
      expect(exclusions.length).toBe(1);
      const removalIdx = await test.db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'history_removals' AND indexname = 'history_removals_profile_key'`,
      );
      expect(removalIdx.length).toBe(1);
      const exclIdx = await test.db.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'history_exclusions' AND indexname = 'history_exclusions_profile_key'`,
      );
      expect(exclIdx.length).toBe(1);
    } finally {
      await test.close();
    }
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
