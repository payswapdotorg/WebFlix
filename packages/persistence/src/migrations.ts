/**
 * @wfx/persistence — the tiny typed migration runner (WFX-052).
 *
 * Contract (WFX-052 spec): forward-only, idempotent, deterministic,
 * ordered SQL files in `packages/persistence/migrations/`, each applied
 * inside ONE transaction with its checksum recorded, so:
 *
 * - ORDER: files are applied in lexicographic filename order
 *   (`0001_…`, `0002_…`, …) — the filename IS the ordering key.
 * - IDEMPOTENT: re-running the runner against an up-to-date database
 *   applies nothing (applied ids are skipped); every file's SQL is
 *   additionally written with `IF NOT EXISTS` so statement-level re-play is
 *   also safe.
 * - FORWARD-ONLY: there is no down/rollback path, by design. A bad
 *   migration is fixed by a NEW migration, never by editing an applied one.
 * - DETERMINISTIC: no data is seeded and no clock is read by the SQL
 *   itself; `applied_at` comes from the injected `now` seam.
 * - DRIFT-DETECTING: an already-applied file whose checksum changed throws
 *   `MigrationError` (the file was edited after the fact — the recorded
 *   history and the code disagree; that is a lead-visible incident, not a
 *   silent re-run).
 * - ATOMIC: each migration runs statement-by-statement inside one
 *   transaction with its bookkeeping INSERT; a rejected statement rolls
 *   the whole migration back, leaving no partial application.
 *
 * File format rule (enforced by review, safe by construction of the split):
 * plain SQL statements terminated by `;` at end-of-line. No procedures,
 * triggers, or `$$` bodies — statement splitting is a line-aware
 * semicolon split, and the migration set in this package contains only
 * plain DDL. (The split rule is documented here so future migration
 * authors keep it true.)
 *
 * Concurrency: migrations are a deploy-time, single-runner operation
 * (WFX-056's deploy automation is strictly sequential). Taking an advisory
 * lock would require session-mode connection semantics that the pooled
 * endpoint does not provide; that trade-off is deliberate and documented.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MigrationError } from "./errors";
import { epochMsToIso, type DbClient, type SqlClient } from "./sql";

/** One migration file, loaded and checksummed. */
export interface LoadedMigration {
  /** Filename without extension — the ordering + identity key. */
  readonly id: string;
  /** The full SQL text. */
  readonly sql: string;
  /** SHA-256 hex of the SQL text. */
  readonly checksum: string;
}

/** A migration already recorded in the database. */
export interface AppliedMigrationRow {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

/** The outcome of one `runMigrations` call. */
export interface MigrationRunResult {
  /** Migration ids applied by THIS call, in order. */
  readonly applied: readonly string[];
  /** Migration ids already applied and verified unchanged (skipped). */
  readonly verified: readonly string[];
  /** Total migration files known to the runner. */
  readonly total: number;
}

/** Source of migration files — overridable for tests. */
export interface MigrationSource {
  list(): readonly LoadedMigration[];
}

/** Options for `runMigrations`. */
export interface RunMigrationsOptions {
  /** Directory containing `*.sql` files. Defaults to this package's `migrations/`. */
  readonly dir?: string;
  /** Migration source override (tests inject drift scenarios). */
  readonly source?: MigrationSource;
  /** Clock seam for `applied_at` (epoch ms). Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The migrations directory shipped with this package. */
export function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "migrations");
}

/** SHA-256 hex of a UTF-8 string. */
export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

/** Split a migration file's SQL into single statements (see format rule). */
export function splitStatements(sql: string): readonly string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Load every `*.sql` file in `dir`, sorted by filename. */
export function loadMigrationsFromDir(dir: string): readonly LoadedMigration[] {
  let names: readonly string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  } catch (thrown) {
    throw new MigrationError(
      `could not read migrations directory (${dir}): ${(thrown as Error).message}`,
    );
  }
  return names.map((name) => {
    const sql = readFileSync(join(dir, name), "utf8");
    return { id: name.replace(/\.sql$/, ""), sql, checksum: checksumOf(sql) };
  });
}

/** The bookkeeping table DDL — runner-owned, created before anything else. */
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS persistence_migrations (
    id         text PRIMARY KEY,
    checksum   text NOT NULL,
    applied_at timestamptz NOT NULL
)
`;

interface MigrationRow {
  id: string;
  checksum: string;
  applied_at: unknown;
}

/**
 * Apply every not-yet-applied migration, in order, each inside its own
 * transaction. Returns what happened. Throws the typed `MigrationError` on
 * drift, unreadable files, or a rejected statement (with the migration id
 * and statement index in the message).
 */
export async function runMigrations(
  db: DbClient,
  options: RunMigrationsOptions = {},
): Promise<MigrationRunResult> {
  const now = options.now ?? Date.now;
  const source: MigrationSource =
    options.source ?? {
      list: () => loadMigrationsFromDir(options.dir ?? defaultMigrationsDir()),
    };

  // Bootstrap the bookkeeping table (idempotent).
  for (const statement of splitStatements(BOOTSTRAP_SQL)) {
    await db.query(statement);
  }

  const existing = new Map<string, AppliedMigrationRow>();
  for (const row of await db.query<MigrationRow>("SELECT id, checksum, applied_at FROM persistence_migrations")) {
    existing.set(row.id, {
      id: row.id,
      checksum: row.checksum,
      appliedAt: String(row.applied_at),
    });
  }

  const applied: string[] = [];
  const verified: string[] = [];

  for (const migration of source.list()) {
    const recorded = existing.get(migration.id);
    if (recorded !== undefined) {
      if (recorded.checksum !== migration.checksum) {
        throw new MigrationError(
          `migration '${migration.id}' was already applied with checksum ${recorded.checksum} ` +
            `but the file now hashes to ${migration.checksum} — applied migrations are immutable ` +
            "(forward-only contract). Fix drift with a NEW migration; never edit an applied file.",
        );
      }
      verified.push(migration.id);
      continue;
    }

    await db.begin(async (tx: SqlClient) => {
      const statements = splitStatements(migration.sql);
      for (const [index, statement] of statements.entries()) {
        try {
          await tx.query(statement);
        } catch (thrown) {
          throw new MigrationError(
            `migration '${migration.id}' failed at statement ${index + 1}/${statements.length}: ` +
              `${(thrown as Error).message}`,
            { cause: thrown },
          );
        }
      }
      await tx.query(
        "INSERT INTO persistence_migrations (id, checksum, applied_at) VALUES ($1, $2, $3)",
        [migration.id, migration.checksum, epochMsToIso(now())],
      );
    });
    applied.push(migration.id);
  }

  return { applied, verified, total: applied.length + verified.length };
}
