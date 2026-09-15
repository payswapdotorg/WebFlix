/**
 * WFX-052 — driver-error classification tests (pure unit, no database).
 *
 * The degradation contract (docs/infrastructure/degradation-behavior.md §1):
 * connection failures are classified into typed
 * `DataSourceUnavailable` / `WriteQuotaExceeded` / `ConnectionTimeout` —
 * never raw driver errors leaking to handlers. Inputs are synthetic errors
 * shaped exactly like postgres.js / Node network errors.
 */

import { describe, expect, it } from "bun:test";

import {
  ConnectionTimeout,
  DataSourceUnavailable,
  PersistenceError,
  WriteQuotaExceeded,
  classifyDriverError,
  isUniqueViolation,
  probeClient,
  type DbClient,
  type SqlRow,
} from "../src/index";

/** A postgres.js-shaped server error (SQLSTATE in `code`). */
function pgError(code: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { code?: string }).code = code;
  return error;
}

/** A Node/Bun-shaped network error (errno string in `code`). */
function netError(code: string, message: string): Error {
  const error = new Error(message);
  (error as Error & { code?: string }).code = code;
  return error;
}

describe("classifyDriverError — SQLSTATE tier", () => {
  it("53100 (disk_full) → WriteQuotaExceeded with the SQLSTATE attached", () => {
    const classified = classifyDriverError(
      pgError("53100", "could not extend file: No space left on device"),
      "insert.watch_history",
    );
    expect(classified).toBeInstanceOf(WriteQuotaExceeded);
    expect(classified.kind).toBe("write-quota-exceeded");
    expect(classified.sqlState).toBe("53100");
    expect(classified.operation).toBe("insert.watch_history");
  });

  it("08006 (connection_failure) → DataSourceUnavailable", () => {
    const classified = classifyDriverError(pgError("08006", "connection failure"));
    expect(classified).toBeInstanceOf(DataSourceUnavailable);
    expect(classified.kind).toBe("data-source-unavailable");
  });

  it("57P03 (cannot_connect_now) → DataSourceUnavailable", () => {
    const classified = classifyDriverError(pgError("57P03", "the database system is starting up"));
    expect(classified).toBeInstanceOf(DataSourceUnavailable);
  });

  it("57014 (query_canceled) → ConnectionTimeout", () => {
    const classified = classifyDriverError(
      pgError("57014", "canceling statement due to statement timeout"),
    );
    expect(classified).toBeInstanceOf(ConnectionTimeout);
    expect(classified.kind).toBe("connection-timeout");
  });

  it("23505 (unique_violation) → constraint-violation (not a degradation class)", () => {
    const classified = classifyDriverError(
      pgError("23505", 'duplicate key value violates unique constraint "users_email_key"'),
    );
    expect(classified).toBeInstanceOf(PersistenceError);
    expect(classified).not.toBeInstanceOf(WriteQuotaExceeded);
    expect(classified.kind).toBe("constraint-violation");
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "53100" })).toBe(false);
  });
});

describe("classifyDriverError — network errno tier", () => {
  it("ETIMEDOUT → ConnectionTimeout", () => {
    const classified = classifyDriverError(netError("ETIMEDOUT", "connect timed out"));
    expect(classified).toBeInstanceOf(ConnectionTimeout);
  });

  it("ECONNREFUSED / ENOTFOUND → DataSourceUnavailable", () => {
    expect(classifyDriverError(netError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432"))).toBeInstanceOf(
      DataSourceUnavailable,
    );
    expect(classifyDriverError(netError("ENOTFOUND", "getaddrinfo ENOTFOUND db.example.com"))).toBeInstanceOf(
      DataSourceUnavailable,
    );
  });
});

describe("classifyDriverError — message-pattern tier (fallback)", () => {
  it("suspension vocabulary → DataSourceUnavailable", () => {
    const classified = classifyDriverError(
      new Error("Neon: compute endpoint is suspended. Please retry."),
    );
    expect(classified).toBeInstanceOf(DataSourceUnavailable);
    expect(classified.message).toContain("suspended");
  });

  it("quota vocabulary → WriteQuotaExceeded", () => {
    const classified = classifyDriverError(new Error("write rejected: disk full on volume"));
    expect(classified).toBeInstanceOf(WriteQuotaExceeded);
  });

  it("timeout vocabulary → ConnectionTimeout", () => {
    const classified = classifyDriverError(new Error("connection timed out while waiting for server"));
    expect(classified).toBeInstanceOf(ConnectionTimeout);
  });
});

describe("classifyDriverError — passthrough + unknown", () => {
  it("passes an already-classified PersistenceError through untouched", () => {
    const original = new WriteQuotaExceeded("already classified");
    expect(classifyDriverError(original)).toBe(original);
  });

  it("wraps anything else as kind unknown, preserving the cause", () => {
    const raw = new Error("something exotic");
    const classified = classifyDriverError(raw, "op");
    expect(classified.kind).toBe("unknown");
    expect(classified.cause).toBe(raw);
    expect(classified.operation).toBe("op");
  });

  it("never leaks the raw error as itself", () => {
    const raw = new Error("raw failure");
    const classified = classifyDriverError(raw);
    expect(classified).not.toBe(raw);
    expect(classified).toBeInstanceOf(PersistenceError);
  });
});

// ---------------------------------------------------------------------------
// probeClient — the one-bounded-retry cold-start policy
// ---------------------------------------------------------------------------

/** A DbClient whose queries fail N times before succeeding (or forever). */
function flakyClient(failuresBeforeSuccess: number, code: string, message: string): DbClient {
  let remaining = failuresBeforeSuccess;
  return {
    async query<Row extends object = SqlRow>(
      _sqlText?: string,
      _params?: readonly unknown[],
    ): Promise<Row[]> {
      if (remaining > 0) {
        remaining -= 1;
        throw netError(code, message);
      }
      return [{ ok: 1 }] as Row[];
    },
    async begin() {
      throw new Error("not used");
    },
    async close() {},
  };
}

describe("probeClient — one bounded cold-start retry, never a storm", () => {
  it("succeeds after exactly one retry-shaped failure (scale-to-zero wake-up)", async () => {
    const client = flakyClient(1, "ETIMEDOUT", "cold start wake-up");
    await expect(probeClient(client)).resolves.toBeUndefined();
  });

  it("fails typed after the second failure — no third attempt", async () => {
    const client = flakyClient(2, "ECONNREFUSED", "still down");
    let caught: unknown;
    try {
      await probeClient(client);
    } catch (thrown) {
      caught = thrown;
    }
    expect(caught).toBeInstanceOf(DataSourceUnavailable);
    // The client was queried exactly twice: initial + ONE retry.
    const exhausted = flakyClient(2, "ETIMEDOUT", "still waking");
    let calls = 0;
    const counting: DbClient = {
      async query() {
        calls += 1;
        if (calls <= 2) throw netError("ETIMEDOUT", "waking");
        return [];
      },
      async begin() {
        throw new Error("not used");
      },
      async close() {},
    };
    await expect(probeClient(counting)).rejects.toBeInstanceOf(ConnectionTimeout);
    expect(calls).toBe(2);
    expect(exhausted).toBeDefined();
  });

  it("does NOT retry non-cold-start failures (auth/config-shaped)", async () => {
    let calls = 0;
    const authClient: DbClient = {
      async query() {
        calls += 1;
        return Promise.reject(new Error("password authentication failed for user"));
      },
      async begin() {
        throw new Error("not used");
      },
      async close() {},
    };
    await expect(probeClient(authClient)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("honors allowColdStartRetry=false (retry disabled)", async () => {
    const client = flakyClient(1, "ETIMEDOUT", "cold start");
    await expect(probeClient(client, { allowColdStartRetry: false })).rejects.toBeInstanceOf(
      ConnectionTimeout,
    );
  });
});
