/**
 * @wfx/persistence — the production composition root for the Ports seams
 * (WFX-052).
 *
 * `@wfx/experience`'s use-cases operate on the injected `Ports` bundle
 * (connector / events / clock / ids — ports.ts of that package). Fixtures
 * fill it for dev/tests (`makeFixturePorts`); THIS module is the
 * production-backed twin:
 *
 * - `connector` → `PostgresCatalogConnector` (real SQL over the
 *   Entertainment Graph tables; the platform's own durable catalog source)
 * - `events`    → `PostgresEventSink` (the transactional outbox write side)
 * - `clock`/`ids` → the injected seams. PRODUCTION defaults live here, and
 *   ONLY here: `SystemClock` (Date.now) and `CryptoUlidIdGen` (the domain's
 *   canonical `generateUlid` — timestamp-first, crypto-random, monotonic).
 *   This mirrors the web host's law (WFX-050): the system clock and the
 *   crypto id generator are the ONLY Date.now/crypto seams; all logic under
 *   test receives them injected (tests use FixedClock/SequentialIdGen).
 *
 * `bootPersistence` is the one-call production boot: read + validate the env
 * (typed loud `PersistenceConfigError` naming the variables — NEVER a
 * fixture fallback), connect (PgBouncer-safe, one bounded cold-start retry),
 * run migrations (forward-only, idempotent), and return the client + ports.
 * A later wave's service layer / serverless handler calls exactly this.
 */

import { generateUlid } from "@wfx/domain";
import type { Clock, IdGen, Ports } from "@wfx/experience";

import { createPostgresClient, type PostgresClientOptions } from "./postgres-client";
import { PostgresCatalogConnector } from "./catalog-connector";
import { PostgresEventSink } from "./outbox";
import { readPersistenceEnv, type EnvBag, type PersistenceEnv } from "./env";
import { runMigrations, type MigrationRunResult } from "./migrations";
import type { DbClient } from "./sql";

/**
 * The production `Clock`: `Date.now()`. Exists ONLY as the composition-root
 * default — logic never calls it directly (the web host keeps the same law).
 */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * The production `IdGen`: the domain's canonical `generateUlid()` — 26-char
 * Crockford Base32 body, timestamp-first (lexicographically sortable),
 * crypto-random, in-process monotonic. Composition-root default only.
 */
export class CryptoUlidIdGen implements IdGen {
  next(): string {
    return generateUlid();
  }
}

/** Options for `makePostgresPorts` (every seam injectable; tests inject all). */
export interface MakePostgresPortsOptions {
  readonly db: DbClient;
  /** Defaults to `new SystemClock()` (production). */
  readonly clock?: Clock;
  /** Defaults to `new CryptoUlidIdGen()` (production). */
  readonly ids?: IdGen;
}

/**
 * Assemble the full production `Ports` bundle over a `DbClient`. The bundle
 * is assignable to `Ports` by construction — the compile-time assertion at
 * the bottom proves the adapter set really fills the frozen seams.
 */
export function makePostgresPorts(options: MakePostgresPortsOptions): Ports {
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new CryptoUlidIdGen();
  return {
    connector: new PostgresCatalogConnector({ db: options.db, clock, ids }),
    events: new PostgresEventSink({ db: options.db, clock, ids }),
    clock,
    ids,
  };
}

/** Client factory seam — production uses postgres.js; tests inject PGlite. */
export type DbClientFactory = (databaseUrl: string, options: PostgresClientOptions) => Promise<DbClient>;

/** Options for `bootPersistence`. */
export interface BootPersistenceOptions extends PostgresClientOptions {
  /** Env bag (defaults to `process.env`). */
  readonly env?: EnvBag;
  /** Client factory override (tests boot the real path against PGlite). */
  readonly createClient?: DbClientFactory;
  /** Clock seam override (defaults to `SystemClock`). */
  readonly clock?: Clock;
  /** Id seam override (defaults to `CryptoUlidIdGen`). */
  readonly ids?: IdGen;
  /** Skip migrations (operators that run DDL via the direct endpoint). */
  readonly skipMigrations?: boolean;
}

/** What a successful production boot returns. */
export interface PersistenceBoot {
  readonly env: PersistenceEnv;
  readonly db: DbClient;
  readonly ports: Ports;
  /** The migration run result (`applied: []` when already up to date). */
  readonly migrations: MigrationRunResult | null;
  /** Shut the pool down (serverless handlers call this in `finally`). */
  close(): Promise<void>;
}

/**
 * The one-call production boot: validate env → connect (typed loud failures,
 * one bounded cold-start retry) → migrate → assemble `Ports`. Throws
 * `PersistenceConfigError` / `MigrationError` / the degradation family —
 * never falls back to fixtures, never invents a database.
 */
export async function bootPersistence(
  options: BootPersistenceOptions = {},
): Promise<PersistenceBoot> {
  const env = readPersistenceEnv(options.env ?? process.env);
  const createClient = options.createClient ?? createPostgresClient;
  const db = await createClient(env.databaseUrl, options);

  let migrations: MigrationRunResult | null = null;
  if (options.skipMigrations !== true) {
    migrations = await runMigrations(db);
  }

  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new CryptoUlidIdGen();
  const ports = makePostgresPorts({ db, clock, ids });

  return {
    env,
    db,
    ports,
    migrations,
    close: async () => {
      await db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Compile-time proofs
// ---------------------------------------------------------------------------

/** The assembled bundle IS the frozen `Ports` shape — or this fails to build. */
type AssertPorts<T extends Ports> = T;
type _PostgresPortsSatisfiesPorts = AssertPorts<ReturnType<typeof makePostgresPorts>>;
