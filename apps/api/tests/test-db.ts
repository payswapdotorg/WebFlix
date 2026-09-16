/**
 * @wfx/app-api — the app-local PGlite test harness (WFX-055A, slice 3).
 *
 * The repo's shared PGlite harness lives at
 * `packages/persistence/tests/test-db.ts`, but the LANE LAW
 * (`scripts/check-lanes.mjs`, from docs/architecture/dependency-graph.md —
 * "Workers communicate through versioned interfaces and fixtures, not
 * private imports") forbids this app from importing another package's
 * private test files (no relative escapes, no deep `@wfx/<pkg>/...`
 * imports). This is therefore the app-local TWIN of that harness: the SAME
 * real migration set via the PUBLIC `@wfx/persistence` entry points, then
 * the app-owned curated catalog seed (`seedCatalogIfEmpty` — the same
 * convergence step the service boot performs) — real PostgreSQL compiled
 * to WASM, one instance per test file, migrations + seed applied once in
 * `beforeAll` (~1-3s per boot).
 *
 * Determinism laws (repo style): injected clock, injected id generator,
 * deterministic encryption key. No `Date.now` / `Math.random` in logic under
 * test.
 */

import { PGlite } from "@electric-sql/pglite";

import {
  runMigrations,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "@wfx/persistence";

import { seedCatalogIfEmpty } from "../src/host/seed";

/** A PGlite-backed DbClient (the test-side twin of the postgres.js client). */
export interface TestDb {
  readonly db: DbClient;
  /** The raw PGlite handle (direct assertions on stored rows). */
  readonly raw: PGlite;
  close(): Promise<void>;
}

/**
 * Boot a fresh PGlite database with the REAL migration set applied
 * (0001..0007 — the 052 schema plus the WFX-055A catalog seed).
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
  // The app-owned curated catalog — the SAME convergence step the service
  // boot performs (seedCatalogIfEmpty, host/seed.ts): the harness baseline
  // is the seeded webflix-catalog, exactly what production serves.
  const seed = await seedCatalogIfEmpty(db);
  if (!seed.seeded || seed.itemCount !== 57) {
    throw new Error(
      `test harness: expected the catalog seed to apply 57 items, got ${JSON.stringify(seed)}`,
    );
  }
  return { db, raw: pglite, close: db.close };
}

/**
 * Deterministic 32-byte APP_ENCRYPTION_KEY (base64) — bytes 0..31, the same
 * key the persistence package's own harness uses.
 */
export const TEST_ENCRYPTION_KEY_BASE64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

/** A syntactically valid, never-connected PostgreSQL URL for env validation. */
export const TEST_DATABASE_URL = "postgres://wfx-api-test@localhost:5432/wfx";
