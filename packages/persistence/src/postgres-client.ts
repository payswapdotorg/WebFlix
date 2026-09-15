/**
 * @wfx/persistence — the production PostgreSQL client (postgres.js, WFX-052).
 *
 * Driver choice (spec-mandated): `postgres` (postgres.js) — pure JS, zero
 * native modules, runs on Bun and in Vercel's Node runtime. Configuration
 * encodes the Neon pooled-endpoint contract:
 *
 * - `prepare: false` — PgBouncer TRANSACTION mode cannot carry server-side
 *   prepared statements; every query uses the simple/extended one-shot path.
 * - Small pool (`max`, default 5) + short `idle_timeout` — serverless
 *   request handlers never need many server connections, and Neon's
 *   scale-to-zero reaps idle compute after 5 minutes.
 * - `connect_timeout` bounds the wait for a suspended/waking compute.
 *
 * Cold-start policy (degradation contract §1): the initial probe performs
 * ONE bounded retry when the first attempt fails with a cold-start-shaped
 * error (`ConnectionTimeout` / `DataSourceUnavailable`). Never more than
 * one retry, never a retry storm; config-shaped failures (bad URL,
 * authentication) fail immediately — retrying them is pointless noise.
 *
 * Errors from `query`/`begin` are classified through `classifyDriverError`
 * before callers see them: `DataSourceUnavailable` / `WriteQuotaExceeded` /
 * `ConnectionTimeout` — the typed taxonomy, not raw driver errors.
 */

import postgres from "postgres";

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { assertPostgresUrl } from "./env";
import type { DbClient, SqlClient, SqlRow } from "./sql";

/** Tuning knobs for the production client. */
export interface PostgresClientOptions {
  /** Connect timeout in ms (default 10s — generous for scale-to-zero wake-ups). */
  readonly connectTimeoutMs?: number;
  /** Idle timeout in seconds (default 20). */
  readonly idleTimeoutSeconds?: number;
  /** Max pool connections (default 5). */
  readonly maxConnections?: number;
  /** Bounded cold-start retries for the initial probe (default 1; max 1). */
  readonly coldStartRetries?: number;
}

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  idleTimeoutSeconds: 20,
  maxConnections: 5,
  coldStartRetries: 1,
} as const;

/**
 * The shape postgres.js expects for a custom `types` entry.
 */
interface PostgresTypeConfig {
  readonly to: number;
  readonly from: number[];
  readonly serialize: (value: string) => string;
  readonly parse: (value: string) => unknown;
}

/**
 * postgres.js type config: parse `json` / `jsonb` columns (OIDs 114 / 3802)
 * into JS objects.
 *
 * WITHOUT this, `sql.unsafe()` — the seam every adapter queries through —
 * returns jsonb columns as STRINGS (verified against live Neon: the tagged
 * template path parses jsonb, the unsafe path does not apply the built-in
 * parser). PGlite parses jsonb natively, so this config is what keeps the
 * `DbClient` seam behaviorally IDENTICAL on both servers: adapters always
 * see objects. `serialize` is identity because every adapter passes
 * pre-stringified JSON with an explicit `::jsonb` cast.
 */
export const JSON_COLUMN_TYPES: { json: PostgresTypeConfig } = {
  json: {
    to: 3802,
    from: [114, 3802],
    serialize: (value) => value,
    parse: (value) => JSON.parse(value),
  },
};

/** Options for the boot probe. */
export interface ProbeOptions {
  /** Retry a cold-start-shaped failure once when true (default true). */
  readonly allowColdStartRetry?: boolean;
}

/**
 * Create the production `DbClient` over a pooled PostgreSQL URL. Probes the
 * connection (with the one-bounded-retry cold-start policy) and throws the
 * classified typed error if the source is not usable — so a bad
 * `DATABASE_URL` is a LOUD boot failure, per the degradation contract.
 */
export async function createPostgresClient(
  databaseUrl: string,
  options: PostgresClientOptions = {},
): Promise<DbClient> {
  assertPostgresUrl(databaseUrl);

  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
  const idleTimeoutSeconds = options.idleTimeoutSeconds ?? DEFAULTS.idleTimeoutSeconds;
  const maxConnections = options.maxConnections ?? DEFAULTS.maxConnections;
  const coldStartRetries = Math.min(options.coldStartRetries ?? DEFAULTS.coldStartRetries, 1);

  const sql = postgres(databaseUrl, {
    prepare: false, // PgBouncer transaction mode
    max: maxConnections,
    idle_timeout: idleTimeoutSeconds,
    connect_timeout: Math.ceil(connectTimeoutMs / 1000),
    types: JSON_COLUMN_TYPES, // jsonb → objects on the unsafe path too (see above)
    onnotice: () => {
      /* notices are not errors; keep them out of handler paths */
    },
  });

  const query = async <Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]> => {
    try {
      const rows = await sql.unsafe(sqlText, [...(params ?? [])] as never[]);
      return rows as unknown as Row[];
    } catch (thrown) {
      throw classifyDriverError(thrown, "postgres.query");
    }
  };

  const begin = async <T>(work: (tx: SqlClient) => Promise<T>): Promise<T> => {
    try {
      const result = (await sql.begin(async (tx) =>
        work({
          async query<Row extends object = SqlRow>(
            txText: string,
            txParams?: readonly unknown[],
          ): Promise<Row[]> {
            try {
              const rows = await tx.unsafe(txText, [...(txParams ?? [])] as never[]);
              return rows as unknown as Row[];
            } catch (thrown) {
              throw classifyDriverError(thrown, "postgres.transaction");
            }
          },
        }),
      )) as T;
      return result;
    } catch (thrown) {
      if (thrown instanceof PersistenceError) throw thrown;
      throw classifyDriverError(thrown, "postgres.begin");
    }
  };

  const client: DbClient = {
    query,
    begin,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };

  // Boot probe: `select 1` with the one-bounded-retry cold-start policy.
  await probeClient(client, { allowColdStartRetry: coldStartRetries >= 1 });
  return client;
}

/**
 * Probe a client with `select 1`. On a cold-start-shaped failure
 * (`ConnectionTimeout` / `DataSourceUnavailable`) and
 * `allowColdStartRetry`, sleeps a bounded pause and retries EXACTLY once —
 * the scale-to-zero wake-up window. Any other failure rethrows classified.
 */
export async function probeClient(
  client: DbClient,
  options: ProbeOptions = {},
): Promise<void> {
  const allowRetry = options.allowColdStartRetry ?? true;
  try {
    await client.query("SELECT 1 AS ok");
  } catch (first) {
    const classified = classifyDriverError(first, "probe");
    const retryable =
      classified.kind === "connection-timeout" || classified.kind === "data-source-unavailable";
    if (!(allowRetry && retryable)) throw classified;
    await sleep(1_500); // bounded wake-up window — one retry, never a storm
    try {
      await client.query("SELECT 1 AS ok");
    } catch (second) {
      throw classifyDriverError(second, "probe.retry");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a `DbClient` over an ALREADY-CONFIGURED postgres.js instance
 * (used by tooling that owns its own pool object). The same classification
 * and PgBouncer-safe assumptions apply; no boot probe is performed here.
 *
 * The caller's pool MUST be configured with `types: JSON_COLUMN_TYPES`
 * (exported by this module) so jsonb columns parse to objects on the unsafe
 * path — the seam contract every adapter relies on (see its docs above).
 */
export function wrapPostgres(sql: postgres.Sql, operation = "postgres"): DbClient {
  return {
    async query<Row extends object = SqlRow>(
      sqlText: string,
      params?: readonly unknown[],
    ): Promise<Row[]> {
      try {
        const rows = await sql.unsafe(sqlText, [...(params ?? [])] as never[]);
        return rows as unknown as Row[];
      } catch (thrown) {
        throw classifyDriverError(thrown, `${operation}.query`);
      }
    },
    async begin<T>(work: (tx: SqlClient) => Promise<T>): Promise<T> {
      try {
        const result = (await sql.begin(async (tx) =>
          work({
            async query<Row extends object = SqlRow>(
              txText: string,
              txParams?: readonly unknown[],
            ): Promise<Row[]> {
              try {
                const rows = await tx.unsafe(txText, [...(txParams ?? [])] as never[]);
                return rows as unknown as Row[];
              } catch (thrown) {
                throw classifyDriverError(thrown, `${operation}.transaction`);
              }
            },
          }),
        )) as T;
        return result;
      } catch (thrown) {
        if (thrown instanceof PersistenceError) throw thrown;
        throw classifyDriverError(thrown, `${operation}.begin`);
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/** Guard: is this thrown value a postgres.js authentication/config failure? */
export function isAuthFailure(thrown: unknown): boolean {
  const code =
    thrown !== null && typeof thrown === "object" && "code" in thrown
      ? String((thrown as { code?: unknown }).code)
      : "";
  return code === "28P01" || code === "28000" || /password auth|authentication failed/i.test(String(thrown));
}
