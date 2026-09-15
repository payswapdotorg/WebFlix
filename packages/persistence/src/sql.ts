/**
 * @wfx/persistence — the SQL client seam (WFX-052).
 *
 * One narrow interface, two interchangeable implementations:
 *
 * - `createPostgresClient` (src/postgres-client.ts) — production adapter
 *   over postgres.js (pure JS, no native modules; Bun/Vercel-compatible),
 *   configured for the Neon POOLED endpoint (PgBouncer transaction mode:
 *   prepared statements disabled, simple short transactions preferred).
 * - the PGlite adapter (tests/helpers/pglite.ts) — real PostgreSQL compiled
 *   to WASM, used ONLY as the deterministic, network-free test harness.
 *
 * Both speak plain parameterized SQL (`$1, $2, …`) with an explicit
 * transaction boundary (`begin`), which is exactly the surface the typed
 * adapters need. Writing every adapter against this seam is what keeps the
 * production and test paths behaviorally identical: the same SQL runs
 * against real Postgres in both, only the server differs.
 *
 * Laws:
 * - `query` accepts ONE statement with an optional parameter tuple. (The
 *   migration runner splits files into single statements itself.)
 * - `begin` runs its callback inside one transaction; a rejection rolls the
 *   whole thing back and rethrows.
 * - Nothing here retries. Cold-start retry policy lives in the production
 *   client's initial probe only (one bounded retry — degradation contract).
 */

/** A database row as postgres drivers return it (string-keyed). */
export type SqlRow = Record<string, unknown>;

/**
 * The read/write surface every typed adapter uses. Inside `begin`, the
 * transaction-scoped handle passed to the callback has exactly this shape.
 *
 * `Row` is bounded by `object` (not `SqlRow`): row types are plain interfaces
 * without index signatures, which is the honest shape of a mapped row — the
 * driver layer is where untyped rows live, and every adapter maps them once.
 */
export interface SqlClient {
  /**
   * Execute ONE parameterized SQL statement and return its rows (empty for
   * non-returning statements).
   */
  query<Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/**
 * A connection (or pool) able to run `SqlClient` work inside transactions
 * and to be closed. `begin` must serialize its callback's statements on one
 * server-side transaction.
 */
export interface DbClient extends SqlClient {
  /** Run `work` inside a transaction; commit on resolve, rollback on reject. */
  begin<T>(work: (tx: SqlClient) => Promise<T>): Promise<T>;
  /** Close the underlying connection(s). Idempotent. */
  close(): Promise<void>;
}

/** Normalize a driver-returned timestamp (Date | ISO string) to ISO 8601. */
export function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new TypeError(
    `toIsoTimestamp: expected a Date or ISO 8601 string, got ${typeof value}`,
  );
}

/** Epoch milliseconds → ISO 8601 UTC (the injected-clock conversion seam). */
export function epochMsToIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Read one JSON column, defaulting to `null` for SQL NULL. postgres.js and
 * PGlite both parse `jsonb` columns to JS values already; this helper only
 * types the result.
 */
export function readJsonColumn<T>(value: unknown): T | null {
  return (value ?? null) as T | null;
}
