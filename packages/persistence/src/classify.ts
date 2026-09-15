/**
 * @wfx/persistence — driver error classification (WFX-052).
 *
 * Implements the degradation contract (docs/infrastructure/degradation-behavior.md,
 * §1 "Connection layer"): classify connection failures into
 * `DataSourceUnavailable` / `WriteQuotaExceeded` / `ConnectionTimeout` —
 * typed errors, never raw driver errors leaking to handlers.
 *
 * Inputs are whatever postgres.js or PGlite throws:
 * - PG errors carry a SQLSTATE in `error.code` ("08006", "53100", …).
 * - Node/Bun network errors carry an errno string in `error.code`
 *   ("ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", …).
 * - Neon suspension-shaped failures surface as connection failures with
 *   distinctive messages; message patterns are the fallback tier.
 *
 * Classification order (most specific signal first):
 *   1. SQLSTATE ( PostgreSQL-verified semantics)
 *   2. network errno
 *   3. message patterns (suspension / quota / timeout vocabulary)
 *   4. `PersistenceError` passes through untouched; anything else becomes
 *      kind "unknown" with the original error preserved as `cause`.
 *
 * Storage-cap write rejections (SQLSTATE 53100 disk_full) are
 * `WriteQuotaExceeded` — the degradation contract's "reads keep working,
 * writes degrade visibly" family.
 */

import {
  ConnectionTimeout,
  DataSourceUnavailable,
  PersistenceError,
  WriteQuotaExceeded,
  type PersistenceErrorOptions,
} from "./errors";

/** Extract a truthy string `code` property from a thrown value. */
function errorCode(thrown: unknown): string | undefined {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    if (typeof code === "number") return String(code);
  }
  return undefined;
}

/** Extract the thrown value's message when there is one. */
function errorMessage(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  return String(thrown);
}

const NETWORK_ERRNOS: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED", // treated as unavailable: the socket died under us
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPROTO",
]);

const TIMEOUT_ERRNOS: ReadonlySet<string> = new Set(["ETIMEDOUT", "ETIMEOUT"]);

// SQLSTATE classes/prefixes → unavailable (connection_exception family,
// cannot_connect_now, too_many_connections, out_of_memory).
const UNAVAILABLE_SQLSTATES: readonly string[] = [
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "080P01",
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
  "53200", // out_of_memory
];

// SQLSTATE → write-quota family (storage ceiling rejections).
const QUOTA_SQLSTATES: readonly string[] = ["53100"]; // disk_full

// SQLSTATE → timeout family (query/statement canceled by timeout).
const TIMEOUT_SQLSTATES: readonly string[] = ["57014"];

const SUSPENSION_MESSAGE_RE =
  /suspend|suspended|not accepting connections|wake|cold start|compute.*unavailable|could not establish/i;
const QUOTA_MESSAGE_RE = /disk full|quota|storage.*(full|exceed)|exceeds? .*storage|out of storage/i;
const TIMEOUT_MESSAGE_RE = /timeout|timed out|canceling statement|connection expired/i;

function matches(sqlState: string, candidates: readonly string[]): boolean {
  return candidates.some(
    (candidate) => sqlState === candidate || (candidate.length === 5 && sqlState.startsWith(candidate)),
  );
}

/**
 * Classify a thrown driver error into the persistence failure taxonomy.
 * `PersistenceError` instances (already classified) pass through unchanged.
 */
export function classifyDriverError(thrown: unknown, operation?: string): PersistenceError {
  if (thrown instanceof PersistenceError) return thrown;

  const base = (): PersistenceErrorOptions => ({ operation, cause: thrown });
  const message = errorMessage(thrown);

  const code = errorCode(thrown);
  if (code !== undefined) {
    // 1. SQLSTATE — five chars from [0-9A-Z] (classes like 57P03 carry a
    //    letter; digits-only would silently miss them).
    if (/^[0-9A-Z]{5}$/.test(code)) {
      const withState = (): PersistenceErrorOptions => ({ ...base(), sqlState: code });
      if (matches(code, QUOTA_SQLSTATES)) {
        return new WriteQuotaExceeded(
          `write rejected by the storage quota (SQLSTATE ${code}): ${message}`,
          withState(),
        );
      }
      if (matches(code, TIMEOUT_SQLSTATES)) {
        return new ConnectionTimeout(
          `operation timed out and was canceled (SQLSTATE ${code}): ${message}`,
          withState(),
        );
      }
      if (matches(code, UNAVAILABLE_SQLSTATES)) {
        return new DataSourceUnavailable(
          `data source is not serving connections (SQLSTATE ${code}): ${message}`,
          withState(),
        );
      }
      if (code === "23505" || code === "23503" || code === "23514" || code === "23502") {
        // integrity family surfaced as constraint violations (callers map
        // these to typed domain outcomes like "email-taken").
        return new PersistenceError(
          "constraint-violation",
          `constraint violation (SQLSTATE ${code}): ${message}`,
          withState(),
        );
      }
    }

    // 2. Network errno (Node/Bun level).
    if (TIMEOUT_ERRNOS.has(code)) {
      return new ConnectionTimeout(`connection timed out (${code}): ${message}`, base());
    }
    if (NETWORK_ERRNOS.has(code)) {
      return new DataSourceUnavailable(`data source unreachable (${code}): ${message}`, base());
    }
  }

  // 3. Message patterns — the fallback tier (suspension vocabulary, quota
  //    vocabulary, timeout vocabulary), only when no code identified it.
  if (QUOTA_MESSAGE_RE.test(message)) {
    return new WriteQuotaExceeded(`write rejected by the storage quota: ${message}`, base());
  }
  if (TIMEOUT_MESSAGE_RE.test(message)) {
    return new ConnectionTimeout(`operation timed out: ${message}`, base());
  }
  if (SUSPENSION_MESSAGE_RE.test(message)) {
    return new DataSourceUnavailable(`data source is suspended or waking: ${message}`, base());
  }

  // 4. Unknown — wrapped, cause preserved, never rethrown raw.
  return new PersistenceError("unknown", `unclassified driver failure: ${message}`, base());
}

/** Is `thrown` a PostgreSQL unique_violation (SQLSTATE 23505)? */
export function isUniqueViolation(thrown: unknown): boolean {
  return errorCode(thrown) === "23505";
}
