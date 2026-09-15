/**
 * WFX-054 — YouTube credential storage tests: the token lifecycle THROUGH
 * WFX-052's AES-256-GCM connector-account envelopes.
 *
 * The spec's acceptance point: "credential storage round-trip through the 052
 * envelopes (PGlite harness pattern from packages/persistence/tests/
 * test-db.ts)". This file follows that pattern with a LOCAL harness (the
 * persistence test helpers are not part of @wfx/persistence's public entry,
 * and cross-package test imports would violate the lane law): real
 * PostgreSQL (PGlite, WASM) + the REAL migration set via the public
 * `runMigrations`, the same `DbClient` seam, and `PostgresConnectorAccountStore`
 * sealed under a deterministic 32-byte key.
 *
 * Proven here:
 * - store → load round-trips the token set EXACTLY (the envelope is
 *   transparent to the connector; plaintext never leaves the pair);
 * - rotation: a second store REPLACES the first (the 052 UNIQUE upsert);
 * - not-found → `{ ok: true, tokens: null }` (never connected — never a
 *   silent error that would read as "never connected" for a broken seal);
 * - key-mismatch (APP_ENCRYPTION_KEY rotated without re-authorization) and
 *   ciphertext tampering surface as typed `store-error` naming the cause;
 * - NO PLAINTEXT AT REST: the raw connector_accounts row carries only
 *   AES-256-GCM ciphertext + IV + authTag + keyId;
 * - the full connector path: a `YouTubeConnector` wired with the
 *   persistence-backed source loads its token from the database and calls
 *   the API with it (scripted transport — no network).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";

import {
  PostgresConnectorAccountStore,
  runMigrations,
  type DbClient,
  type SqlRow,
} from "@wfx/persistence";

import {
  PersistenceYouTubeCredentialSource,
  serializeYouTubeTokenSet,
  parseYouTubeTokenSet,
  createScriptedYouTubeTransport,
  createYouTubeConnector,
  YOUTUBE_CONNECTOR_ID,
  type YouTubeTokenSet,
} from "../src/index";

// ---------------------------------------------------------------------------
// The local PGlite harness (persistence/tests/test-db.ts pattern)
// ---------------------------------------------------------------------------

/** Deterministic 32-byte test key (bytes 0..31) — the APP_ENCRYPTION_KEY. */
const TEST_KEY = new Uint8Array(32).map((_, index) => index);
/** A different 32-byte key (rotation / key-mismatch scenarios). */
const OTHER_KEY = new Uint8Array(32).map((_, index) => 255 - index);

/** Fixed smoke instant (deterministic stamps; no Date.now anywhere). */
const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);

/** The fixed clock seam (structural for both the store and the connector). */
const clock = { now: () => NOW };

/** Deterministic unique id bodies (ULID-shaped, counter-based). */
function makeSequentialIds(): { next(): string } {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return counter.toString(36).padStart(26, "0").toUpperCase();
    },
  };
}

interface Harness {
  readonly db: DbClient;
  readonly raw: PGlite;
  close(): Promise<void>;
}

async function createHarness(): Promise<Harness> {
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
    begin: async <T>(work: (tx: { query: typeof query }) => Promise<T>): Promise<T> => {
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
  const migrated = await runMigrations(db);
  if (migrated.applied.length === 0) {
    throw new Error(`test harness: expected fresh migrations, applied none (total ${migrated.total})`);
  }
  return { db, raw: pglite, close: db.close };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "wfxusr_0000000000000000000000000y";

function tokenSet(overrides: Partial<YouTubeTokenSet> = {}): YouTubeTokenSet {
  return {
    accessToken: "ya29.fixture-access-token-000",
    refreshToken: "1//fixture-refresh-token-000",
    tokenType: "Bearer",
    scope:
      "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
    expiresAtMs: NOW + 3600 * 1000,
    obtainedAtMs: NOW,
    ...overrides,
  };
}

let harness: Harness;
let accounts: PostgresConnectorAccountStore;

beforeAll(async () => {
  harness = await createHarness();
  accounts = new PostgresConnectorAccountStore({
    db: harness.db,
    clock,
    key: TEST_KEY,
    ids: makeSequentialIds(),
  });
});

afterAll(async () => {
  await harness.close();
});

// ---------------------------------------------------------------------------
// Serialization (the sealed payload contract)
// ---------------------------------------------------------------------------

describe("serializeYouTubeTokenSet / parseYouTubeTokenSet", () => {
  it("round-trips a full token set field-for-field", () => {
    const tokens = tokenSet();
    const parsed = parseYouTubeTokenSet(serializeYouTubeTokenSet(tokens));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.tokens).toEqual(tokens);
  });

  it("omits refreshToken honestly when there is none (no undefined at rest)", () => {
    const { refreshToken: _omitted, ...withoutRefresh } = tokenSet();
    const tokens: YouTubeTokenSet = withoutRefresh;
    const payload = serializeYouTubeTokenSet(tokens);
    expect(payload).not.toContain("refreshToken");
    const parsed = parseYouTubeTokenSet(payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.tokens).not.toBeNull();
    if (parsed.tokens === null) throw new Error("unreachable");
    expect("refreshToken" in parsed.tokens).toBe(false);
  });

  it("rejects malformed / foreign payloads typed (never a guessed token set)", () => {
    for (const bad of [
      "not json",
      "{}",
      "null",
      JSON.stringify({ v: 99, accessToken: "a", expiresAtMs: 1, obtainedAtMs: 1 }),
      JSON.stringify({ v: 1, expiresAtMs: 1, obtainedAtMs: 1 }),
      JSON.stringify({ v: 1, accessToken: "", expiresAtMs: 1, obtainedAtMs: 1 }),
      JSON.stringify({ v: 1, accessToken: "a", expiresAtMs: "soon", obtainedAtMs: 1 }),
    ]) {
      const parsed = parseYouTubeTokenSet(bad);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("unreachable");
      expect(parsed.reason).toBe("store-error");
      expect(parsed.detail.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The persistence-backed source over the 052 envelopes
// ---------------------------------------------------------------------------

describe("PersistenceYouTubeCredentialSource (the 052 envelope round-trip)", () => {
  it("store → load round-trips the token set exactly (envelope transparent)", async () => {
    const source = new PersistenceYouTubeCredentialSource(accounts);
    const tokens = tokenSet();
    await source.store(USER, tokens);
    const loaded = await source.load(USER);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("unreachable");
    expect(loaded.tokens).toEqual(tokens);
  });

  it("load for a never-connected user → ok + tokens null (not an error)", async () => {
    const source = new PersistenceYouTubeCredentialSource(accounts);
    const loaded = await source.load("wfxusr_0000000000000000000000zz");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("unreachable");
    expect(loaded.tokens).toBeNull();
  });

  it("a second store ROTATES (replaces) the previous set — the 052 upsert", async () => {
    const source = new PersistenceYouTubeCredentialSource(accounts);
    await source.store(USER, tokenSet({ accessToken: "ya29.old" }));
    await source.store(
      USER,
      tokenSet({ accessToken: "ya29.new", refreshToken: "1//rotated-refresh" }),
    );
    const loaded = await source.load(USER);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("unreachable");
    expect(loaded.tokens?.accessToken).toBe("ya29.new");
    expect(loaded.tokens?.refreshToken).toBe("1//rotated-refresh");
    // Exactly ONE account row for (user, youtube) — no stale sets behind.
    const rows = await harness.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM connector_accounts WHERE user_id = $1 AND connector_id = $2",
      [USER, YOUTUBE_CONNECTOR_ID],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("clear removes the account → subsequent loads see never-connected", async () => {
    const source = new PersistenceYouTubeCredentialSource(accounts);
    await source.store(USER, tokenSet());
    await source.clear(USER);
    const loaded = await source.load(USER);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("unreachable");
    expect(loaded.tokens).toBeNull();
  });

  it("NO PLAINTEXT AT REST: the raw row carries only envelope fields", async () => {
    const source = new PersistenceYouTubeCredentialSource(accounts);
    const tokens = tokenSet({ accessToken: "ya29.plaintext-canary" });
    await source.store(USER, tokens);
    const rows = await harness.db.query<{
      ciphertext: string;
      iv: string;
      auth_tag: string;
      key_id: string;
    }>(
      "SELECT ciphertext, iv, auth_tag, key_id FROM connector_accounts WHERE user_id = $1 AND connector_id = $2",
      [USER, YOUTUBE_CONNECTOR_ID],
    );
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) throw new Error("unreachable");
    const serialized = serializeYouTubeTokenSet(tokens);
    expect(row.ciphertext).not.toContain("ya29.plaintext-canary");
    expect(row.ciphertext).not.toBe(serialized);
    expect(row.iv.length).toBeGreaterThan(0);
    expect(row.auth_tag.length).toBeGreaterThan(0);
    expect(row.key_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("key-mismatch (rotated APP_ENCRYPTION_KEY) → typed store-error naming re-authorization", async () => {
    const underOldKey = new PostgresConnectorAccountStore({
      db: harness.db,
      clock,
      key: TEST_KEY,
      ids: makeSequentialIds(),
    });
    const user = "wfxusr_0000000000000000000000km";
    await new PersistenceYouTubeCredentialSource(underOldKey).store(user, tokenSet());

    // The same database read through a store built with a DIFFERENT key.
    const underNewKey = new PostgresConnectorAccountStore({
      db: harness.db,
      clock,
      key: OTHER_KEY,
      ids: makeSequentialIds(),
    });
    const loaded = await new PersistenceYouTubeCredentialSource(underNewKey).load(user);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) throw new Error("unreachable");
    expect(loaded.reason).toBe("store-error");
    expect(loaded.detail).toContain("APP_ENCRYPTION_KEY");
    expect(loaded.detail).toContain("re-authorization");
  });

  it("ciphertext tampering → typed store-error (the envelope fails loudly)", async () => {
    const user = "wfxusr_0000000000000000000000tp";
    await new PersistenceYouTubeCredentialSource(accounts).store(user, tokenSet());
    await harness.db.query(
      "UPDATE connector_accounts SET ciphertext = $1 WHERE user_id = $2 AND connector_id = $3",
      ["AAAA" + "BBBB", user, YOUTUBE_CONNECTOR_ID],
    );
    const loaded = await new PersistenceYouTubeCredentialSource(accounts).load(user);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) throw new Error("unreachable");
    expect(loaded.reason).toBe("store-error");
    expect(loaded.detail).toContain("envelope");
  });
});

// ---------------------------------------------------------------------------
// The full connector path: tokens loaded from the database
// ---------------------------------------------------------------------------

describe("YouTubeConnector over the persistence-backed credential source", () => {
  it("loads the OAuth token from connector_accounts and calls the API with it", async () => {
    // The one API call the connector makes: search (scripted, network-free).
    const SEARCH_URL =
      "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25" +
      "&q=desert+rain+documentary&regionCode=US&relevanceLanguage=en";
    const scripted = createScriptedYouTubeTransport([
      {
        url: SEARCH_URL,
        status: 200,
        body: {
          kind: "youtube#searchListResponse",
          etag: "e",
          pageInfo: { totalResults: 1, resultsPerPage: 25 },
          items: [
            {
              kind: "youtube#searchResult",
              etag: "e",
              id: { kind: "youtube#video", videoId: "Wfx54Docu001" },
              snippet: {
                publishedAt: "2025-03-14T09:00:00Z",
                channelId: "UCWfx54Channel00000000000A",
                title: "Desert Rain — A Night Documentary",
                description: "",
                channelTitle: "WebFlix Fixture Channel",
                thumbnails: {},
              },
            },
          ],
        },
      },
    ]);

    // The token lives in PGlite, sealed under the test key.
    const source = new PersistenceYouTubeCredentialSource(accounts);
    await source.store(USER, tokenSet());

    const connector = createYouTubeConnector({
      transport: scripted.transport,
      credentialSource: source,
      clock,
    });
    await connector.initialize();

    const result = await connector.searchResult(
      { userId: USER, locale: "en", region: "US" },
      "desert rain documentary",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toHaveLength(1);
    // The Authorization header carries the token loaded FROM THE DATABASE.
    expect(scripted.requests[0]?.headers["authorization"]).toBe(
      "Bearer ya29.fixture-access-token-000",
    );
    await connector.dispose();
  });

  it("a user with no stored account degrades honestly (unauthorized without an API key)", async () => {
    const scripted = createScriptedYouTubeTransport([]);
    const source = new PersistenceYouTubeCredentialSource(accounts);
    const connector = createYouTubeConnector({
      transport: scripted.transport,
      credentialSource: source,
      clock,
    });
    await connector.initialize();
    const result = await connector.searchResult(
      { userId: "wfxusr_0000000000000000000000no", locale: "en" },
      "desert rain documentary",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe("unauthorized");
    expect(scripted.requests).toHaveLength(0); // never an unauthenticated call
    await connector.dispose();
  });
});
