/**
 * WFX-052 — migration runner tests (PGlite, real Postgres).
 *
 * Covers the spec's acceptance points: ordered application, idempotency
 * (re-run applies nothing), checksum drift detection (forward-only
 * contract), and per-migration atomicity (a rejected statement leaves NO
 * partial application and NO bookkeeping row).
 */

import { describe, expect, it } from "bun:test";

import {
  MigrationError,
  checksumOf,
  loadMigrationsFromDir,
  defaultMigrationsDir,
  runMigrations,
  type DbClient,
  type LoadedMigration,
  type MigrationSource,
} from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

/** A migration source that serves an explicit list (drift scenarios). */
function sourceOf(migrations: readonly LoadedMigration[]): MigrationSource {
  return { list: () => [...migrations] };
}

describe("migration runner", () => {
  it("applies the shipped migration set in filename order", async () => {
    const test = await createTestDb();
    try {
      // createTestDb already ran them; verify the recorded history directly.
      const rows = await test.db.query<{ id: string }>(
        "SELECT id FROM persistence_migrations ORDER BY id",
      );
      const ids = rows.map((row) => row.id);
      const files = loadMigrationsFromDir(defaultMigrationsDir());
      expect(ids).toEqual(files.map((file) => file.id));
      // The shipped set covers the required table families.
      expect(ids.join("\n")).toContain("users_and_sessions");
      expect(ids.join("\n")).toContain("entertainment_graph");
      expect(ids.join("\n")).toContain("library_and_watch");
      expect(ids.join("\n")).toContain("intents_and_recommendation");
      expect(ids.join("\n")).toContain("connector_accounts");
      expect(ids.join("\n")).toContain("event_outbox");
    } finally {
      await test.close();
    }
  });

  it("is idempotent: re-running applies nothing and verifies everything", async () => {
    const test = await createTestDb();
    try {
      const result = await runMigrations(test.db);
      expect(result.applied).toEqual([]);
      expect(result.verified.length).toBe(result.total);
      expect(result.total).toBe(loadMigrationsFromDir(defaultMigrationsDir()).length);
    } finally {
      await test.close();
    }
  });

  it("rejects checksum drift on an applied migration (forward-only law)", async () => {
    const test = await createTestDb();
    try {
      const files = loadMigrationsFromDir(defaultMigrationsDir());
      const first = files[0];
      if (first === undefined) throw new Error("no migrations shipped");
      const tampered: LoadedMigration = {
        id: first.id,
        sql: `${first.sql}\n-- edited after the fact\n`,
        checksum: checksumOf(`${first.sql}\n-- edited after the fact\n`),
      };
      expect(() => sourceOf([tampered]).list()).not.toThrow();
      let caught: unknown;
      try {
        await runMigrations(test.db, { source: sourceOf([tampered]) });
      } catch (thrown) {
        caught = thrown;
      }
      expect(caught).toBeInstanceOf(MigrationError);
      expect((caught as Error).message).toContain(first.id);
      expect((caught as Error).message).toContain("forward-only");
    } finally {
      await test.close();
    }
  });

  it("applies NEW migrations after existing ones without touching them", async () => {
    const test = await createTestDb();
    try {
      const extra: LoadedMigration = {
        id: "9999_probe_extension",
        sql: "CREATE TABLE IF NOT EXISTS wfx_probe_extension (id text PRIMARY KEY)",
        checksum: checksumOf(
          "CREATE TABLE IF NOT EXISTS wfx_probe_extension (id text PRIMARY KEY)",
        ),
      };
      const result = await runMigrations(test.db, { source: sourceOf([extra]) });
      expect(result.applied).toEqual(["9999_probe_extension"]);
      const tables = await test.db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'wfx_probe_extension'",
      );
      expect(tables.length).toBe(1);
    } finally {
      await test.close();
    }
  });

  it("is atomic: a migration whose statement fails leaves no partial application", async () => {
    // A private PGlite instance (not the migrated one) so the failing
    // migration is the FIRST thing that happens after bootstrap.
    const test = await createTestDb();
    try {
      const failing: LoadedMigration = {
        id: "0001_will_fail_halfway",
        sql: [
          "CREATE TABLE wfx_partial_probe (id text PRIMARY KEY)",
          "INSERT INTO table_that_does_not_exist VALUES (1)",
        ].join(";\n"),
        checksum: "irrelevant-for-this-test",
      };
      let caught: unknown;
      try {
        await runMigrations(test.db, { source: sourceOf([failing]) });
      } catch (thrown) {
        caught = thrown;
      }
      expect(caught).toBeInstanceOf(MigrationError);
      expect((caught as Error).message).toContain("0001_will_fail_halfway");
      expect((caught as Error).message).toContain("statement 2/2");

      // Neither the table nor the bookkeeping row may exist.
      const tables = await test.db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'wfx_partial_probe'",
      );
      expect(tables.length).toBe(0);
      const rows = await test.db.query<{ id: string }>(
        "SELECT id FROM persistence_migrations WHERE id = '0001_will_fail_halfway'",
      );
      expect(rows.length).toBe(0);
    } finally {
      await test.close();
    }
  });

  it("records applied_at deterministically from the injected clock", async () => {
    const test = await createTestDb();
    try {
      const extra: LoadedMigration = {
        id: "9998_clock_probe",
        sql: "CREATE TABLE IF NOT EXISTS wfx_clock_probe (id text)",
        checksum: checksumOf("CREATE TABLE IF NOT EXISTS wfx_clock_probe (id text)"),
      };
      const fixedNow = Date.UTC(2026, 8, 13, 12, 0, 0);
      await runMigrations(test.db, {
        source: sourceOf([extra]),
        now: () => fixedNow,
      });
      const rows = await test.db.query<{ applied_at: Date }>(
        "SELECT applied_at FROM persistence_migrations WHERE id = '9998_clock_probe'",
      );
      expect(new Date(rows[0]?.applied_at ?? 0).toISOString()).toBe(
        "2026-09-13T12:00:00.000Z",
      );
    } finally {
      await test.close();
    }
  });

  it("throws a typed MigrationError for an unreadable migrations directory", async () => {
    const test = await createTestDb();
    try {
      let caught: unknown;
      try {
        await runMigrations(test.db, { dir: "/nonexistent/wfx/migrations" });
      } catch (thrown) {
        caught = thrown;
      }
      expect(caught).toBeInstanceOf(MigrationError);
    } finally {
      await test.close();
    }
  });
});

/** Compile-time: the test-suite's DbClient is the same seam production uses. */
export type _SameDbClient = DbClient;
export type _Harness = TestDb;
