/**
 * WFX-052 — the composition root tests (PGlite as the injected client).
 *
 * `makePostgresPorts` must fill the frozen `Ports` bundle; `bootPersistence`
 * must run the REAL boot path (env validation → client → migrations →
 * ports) end-to-end — here against PGlite with a fake-but-valid env, so the
 * only untested remainder is the postgres.js socket itself (covered by
 * scripts/verify-live.ts against live Neon).
 */

import { afterAll, describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { FixedClock, SequentialIdGen } from "@wfx/experience";

import {
  bootPersistence,
  makePostgresPorts,
  CryptoUlidIdGen,
  PersistenceConfigError,
  PostgresCatalogConnector,
  PostgresEventSink,
  SystemClock,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "../src/index";
import { TEST_ENCRYPTION_KEY_BASE64 } from "./test-db";

/** A PGlite DbClient WITHOUT migrations (bootPersistence applies them). */
function pgliteClient(): DbClient {
  const pglite = new PGlite();
  const query = async <Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]> => {
    const result = await pglite.query(sqlText, params as unknown[]);
    return result.rows as unknown as Row[];
  };
  return {
    query,
    begin: async <T>(work: (tx: SqlClient) => Promise<T>): Promise<T> => {
      return pglite.transaction(async (tx) =>
        work({
          async query<Row extends object = SqlRow>(
            txText: string,
            txParams?: readonly unknown[],
          ): Promise<Row[]> {
            const result = await tx.query(txText, txParams as unknown[]);
            return result.rows as unknown as Row[];
          },
        }),
      );
    },
    close: async () => {
      await pglite.close();
    },
  };
}

const FAKE_ENV = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/webflix",
  APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
};

const openedClients: DbClient[] = [];

afterAll(async () => {
  for (const client of openedClients) await client.close();
});

describe("production seams (SystemClock / CryptoUlidIdGen)", () => {
  it("SystemClock answers epoch milliseconds", () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(Number.isFinite(now)).toBe(true);
  });

  it("CryptoUlidIdGen mints valid, unique canonical ULID bodies", () => {
    const gen = new CryptoUlidIdGen();
    const bodies = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const body = gen.next();
      expect(body).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      bodies.add(body);
    }
    expect(bodies.size).toBe(200);
  });
});

describe("makePostgresPorts — the frozen Ports bundle", () => {
  it("fills every seam with the Postgres adapters + injected clock/ids", async () => {
    const db = pgliteClient();
    openedClients.push(db);
    const clock = new FixedClock(Date.UTC(2026, 8, 13));
    const ids = new SequentialIdGen();
    const ports = makePostgresPorts({ db, clock, ids });

    expect(ports.connector).toBeInstanceOf(PostgresCatalogConnector);
    expect(ports.events).toBeInstanceOf(PostgresEventSink);
    expect(ports.clock).toBe(clock);
    expect(ports.ids).toBe(ids);
    expect(ports.connector.descriptor().id).toBe("webflix-catalog");
  });

  it("the bundle WORKS: a seeded item is searchable through the port", async () => {
    const db = pgliteClient();
    openedClients.push(db);
    const clock = new FixedClock(Date.UTC(2026, 8, 13));
    const ids = new SequentialIdGen();
    const ports = makePostgresPorts({ db, clock, ids });

    // Boot the schema through the same runner the production boot uses.
    const { runMigrations, PostgresGraphStore } = await import("../src/index");
    await runMigrations(db);
    const graph = new PostgresGraphStore(db);
    await graph.upsertItem({
      id: "wfxitm_00000000000000000000000001",
      canonicalType: "movie",
      canonicalTitle: "Composition Root Blues",
      creators: [],
      topics: [],
      createdAt: "2026-09-13T10:00:00.000Z",
      updatedAt: "2026-09-13T10:00:00.000Z",
    });
    await graph.upsertRealization({
      id: "wfxsrc_00000000000000000000000001",
      entertainmentItemId: "wfxitm_00000000000000000000000001",
      connectorId: "webflix-catalog",
      externalRef: "cat:blues",
      capabilities: ["playEmbed"],
      availability: "available",
      playback: [],
      createdAt: "2026-09-13T10:00:00.000Z",
      updatedAt: "2026-09-13T10:00:00.000Z",
    });

    const hits = await ports.connector.search(
      { userId: "wfxusr_00000000000000000000000001", locale: "en-US" },
      "blues",
    );
    expect(hits.map((hit) => hit.externalRef)).toEqual(["cat:blues"]);

    await ports.events.emit({
      userId: "wfxusr_00000000000000000000000001",
      itemId: "wfxitm_00000000000000000000000001",
      type: "impression",
      occurredAt: "2026-09-13T10:00:00.000Z",
      sessionId: "wfxpses_00000000000000000000000001",
    });
    const rows = await db.query<{ status: string }>("SELECT status FROM event_outbox");
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("pending");
  });
});

describe("bootPersistence — the real production boot path", () => {
  it("boots env → client → migrations → ports end-to-end (PGlite client)", async () => {
    const db = pgliteClient();
    const clock = new FixedClock(Date.UTC(2026, 8, 13));
    const ids = new SequentialIdGen();

    const boot = await bootPersistence({
      env: FAKE_ENV,
      createClient: async () => db,
      clock,
      ids,
    });

    expect(boot.env.databaseUrl).toBe(FAKE_ENV.DATABASE_URL);
    expect(boot.migrations?.applied.length).toBeGreaterThan(0);
    expect(boot.ports.connector).toBeInstanceOf(PostgresCatalogConnector);
    expect(boot.ports.clock).toBe(clock);

    // Idempotent re-boot: migrations verify, apply nothing.
    const reboot = await bootPersistence({
      env: FAKE_ENV,
      createClient: async () => db,
      clock,
      ids,
    });
    expect(reboot.migrations?.applied).toEqual([]);
    expect(reboot.migrations?.verified.length).toBe(reboot.migrations?.total);

    // skipMigrations honors the operator's DDL-via-direct-endpoint choice.
    const skipped = await bootPersistence({
      env: FAKE_ENV,
      createClient: async () => db,
      clock,
      ids,
      skipMigrations: true,
    });
    expect(skipped.migrations).toBeNull();
    await boot.close();
  });

  it("fails LOUD and typed on a missing env (naming the variables, no fallback)", async () => {
    let caught: unknown;
    try {
      await bootPersistence({ env: {}, createClient: async () => pgliteClient() });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceConfigError);
    const error = caught as PersistenceConfigError;
    expect(error.missing).toContain("DATABASE_URL");
    expect(error.missing).toContain("APP_ENCRYPTION_KEY");
  });

  it("fails typed on a non-PostgreSQL URL scheme", async () => {
    let caught: unknown;
    try {
      await bootPersistence({
        env: { DATABASE_URL: "sqlite://nope.db", APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64 },
        createClient: async () => pgliteClient(),
      });
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(PersistenceConfigError);
    expect((caught as PersistenceConfigError).missing).toContain("DATABASE_URL");
  });
});
