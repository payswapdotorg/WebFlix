/**
 * @wfx/persistence test harness — PGlite (real PostgreSQL, WASM).
 *
 * The deterministic, network-free stand-in for the production server: the
 * SAME migration files and the SAME SQL the production client runs, against
 * a real Postgres engine (compiled to WASM). One instance per test FILE
 * (boot is ~1-3s); migrations applied once in `beforeAll`.
 *
 * Determinism laws (repo style): injected clock (FixedClock from
 * @wfx/experience fixtures), injected id generator (SequentialIdGen — every
 * body is a valid canonical ULID body), deterministic encryption key. No
 * Date.now / Math.random in logic under test; PGlite timestamps are always
 * normalized through toIsoTimestamp.
 */

import { PGlite } from "@electric-sql/pglite";

import {
  runMigrations,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "../src/index";

/** A PGlite-backed DbClient (the test-side twin of the postgres.js client). */
export interface TestDb {
  readonly db: DbClient;
  /** The raw PGlite handle (direct assertions on stored rows). */
  readonly raw: PGlite;
  close(): Promise<void>;
}

/**
 * Boot a fresh PGlite database with the REAL migration set applied.
 * Returns the DbClient seam + the raw handle.
 */
export async function createTestDb(): Promise<TestDb> {
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
        });
      });
    },
    close: async () => {
      await pglite.close();
    },
  };

  const result = await runMigrations(db);
  if (result.applied.length === 0) {
    throw new Error(`test harness: expected fresh migrations, applied none (total ${result.total})`);
  }
  return { db, raw: pglite, close: db.close };
}

/** Deterministic 32-byte APP_ENCRYPTION_KEY (base64) for tests. */
export const TEST_ENCRYPTION_KEY_BASE64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

/** The decoded form (bytes 0..31). */
export const TEST_ENCRYPTION_KEY = new Uint8Array(32).map((_, index) => index);

/** A second, different 32-byte key (rotation / mismatch scenarios). */
export const OTHER_ENCRYPTION_KEY = new Uint8Array(32).map((_, index) => 255 - index);
