/**
 * @wfx/app-api — test composition helpers (WFX-055A, slice 3).
 *
 * Builds the object under test for the handler/route tests: a COMPLETE
 * `ApiBoot` composition — the same shape `host/boot.ts` assembles in
 * production — over a PGlite-backed database, using only PUBLIC package
 * entry points:
 *
 * - `bootPersistence` with the `createClient` seam swapped to PGlite (the
 *   documented test seam of the 052 boot: env validation, the REAL
 *   migration run, the REAL `PostgresCatalogConnector` +
 *   `PostgresEventSink` adapters over the injected client);
 * - `createFanOutConnector` over the persistence boot's connector (the
 *   exact wiring `bootApi` performs for the service);
 * - `resolveApiConfig` over a syntactically valid, never-connected env.
 *
 * Deterministic seams: `FixedClock` + `SequentialIdGen` (injected into every
 * adapter). Handlers under test are exercised by importing their GET/POST
 * functions directly and constructing `Request` objects — no server, no
 * network.
 */

import { FixedClock, SequentialIdGen } from "@wfx/experience";
import type { Ports } from "@wfx/experience";
import {
  bootPersistence,
  PostgresConnectorAccountStore,
  PostgresEventSink,
  PostgresIdentityService,
  PostgresProfileService,
  PostgresSessionService,
  decodeEncryptionKey,
  type PersistenceBoot,
} from "@wfx/persistence";

import type { ApiBoot } from "../src/host/boot";
import { resolveApiConfig } from "../src/host/config";
import { createFanOutConnector, type FanOutConnector } from "../src/host/fan-out";
import { HistoryHost } from "../src/host/history";
import {
  createSourceManagementService,
  type SourceAuthWiring,
} from "../src/host/source-management";
import { API_SERVICE_VERSION } from "../src/host/version";
import { createTestDb, TEST_DATABASE_URL, TEST_ENCRYPTION_KEY_BASE64, type TestDb } from "./test-db";

/**
 * The handler tests' clock base: 30 000 ms (epoch + 30s). Deliberately BELOW
 * `OPPORTUNISTIC_MIN_INTERVAL_MS` (60s, host/relay.ts) with margin, so the
 * events endpoint's opportunistic-drain nudge can never fire while these
 * tests assert outbox row states (the interval trigger reads
 * `now - lastDrain >= 60s`; from a pristine or recently-drained module state
 * a 30s clock is never due, and the per-file event-post count stays far
 * below the every-N-events trigger).
 */
export const HANDLER_TEST_CLOCK_MS = 30_000;

/** One fully-wired service boot over PGlite (plus its levers). */
export interface ApiTestBoot {
  readonly boot: ApiBoot;
  readonly testDb: TestDb;
  readonly clock: FixedClock;
  readonly ids: SequentialIdGen;
}

/**
 * Boot the complete service composition over a FRESH PGlite database (real
 * migrations incl. the 0007 seed, real adapters, deterministic seams).
 *
 * R03: `sourceOverrides` injects EXTRA wired sources (e.g. a stub oauth
 * connector — the SDK's testing.ts pattern) and per-connector auth-flow
 * wirings (a stubbed token exchange), so the /sources routes' round-trips
 * are exercised deterministically with NO network.
 */
export async function createApiTestBoot(sourceOverrides?: {
  readonly extraSources?: readonly import("@wfx/experience").ConnectorPort[];
  readonly wirings?: ReadonlyMap<string, SourceAuthWiring>;
  readonly authGate?: import("../src/host/fan-out").FanOutAuthGate;
}): Promise<ApiTestBoot> {
  const testDb = await createTestDb();
  const clock = new FixedClock(HANDLER_TEST_CLOCK_MS);
  const ids = new SequentialIdGen();

  // The REAL 052 boot with only the client factory swapped to PGlite: env
  // validation + the idempotent migration re-run + the real Ports adapters.
  const persistence: PersistenceBoot = await bootPersistence({
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
    },
    createClient: async () => testDb.db,
    clock,
    ids,
  });

  // R03 — the durable connector-account store over the same seams (the
  // exact wiring bootApi performs).
  const connectorAccounts = new PostgresConnectorAccountStore({
    db: testDb.db,
    clock,
    key: decodeEncryptionKey(TEST_ENCRYPTION_KEY_BASE64),
    ids,
  });

  // The exact fan-out wiring bootApi performs (primary source only by
  // default; tests may add stub sources — the SDK's testing.ts pattern).
  const connector: FanOutConnector = createFanOutConnector({
    sources: [persistence.ports.connector, ...(sourceOverrides?.extraSources ?? [])],
    clock,
    version: API_SERVICE_VERSION,
    ...(sourceOverrides?.authGate !== undefined ? { authGate: sourceOverrides.authGate } : {}),
  });

  // R03 — the source-management service over the fan-out's source rows +
  // the injected (or empty) flow wirings.
  const sourceManagement = createSourceManagementService({
    sourceRows: connector.sourceRows(),
    wirings: sourceOverrides?.wirings ?? new Map(),
    accounts: connectorAccounts,
    clock,
  });

  // R04 — the history host: the read-model composition over the
  // watch-history projection + the removal/exclusion filters.
  const history = new HistoryHost({ db: testDb.db, clock, ids });

  // The R02 identity services — the SAME wiring bootApi performs (the
  // boot's 2.6 step): register/authenticate, session tokens, profiles,
  // and the profile-aware event sink, all over the shared seams.
  const identity = new PostgresIdentityService({ db: testDb.db, ids, clock });
  const sessions = new PostgresSessionService({ db: testDb.db, ids, clock });
  const profiles = new PostgresProfileService({ db: testDb.db, ids, clock });
  const profileEvents = new PostgresEventSink({ db: testDb.db, ids, clock });

  const ports: Ports = {
    connector,
    events: persistence.ports.events,
    clock,
    ids,
  };

  const config = resolveApiConfig({
    DATABASE_URL: TEST_DATABASE_URL,
    APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
  });

  const boot: ApiBoot = {
    config,
    persistence,
    connector,
    // The harness DB is already seeded by createTestDb (the same
    // seedCatalogIfEmpty convergence step the service boot performs) —
    // recorded here so the manually-composed ApiBoot tells the truth.
    seed: { seeded: true, itemCount: 57 },
    ports,
    identity,
    sessions,
    profiles,
    profileEvents,
    sourceManagement,
    connectorAccounts,
    history,
  };
  return { boot, testDb, clock, ids };
}

// ---------------------------------------------------------------------------
// Request builders (route handlers are plain functions — no server, no net)
// ---------------------------------------------------------------------------

const API_ORIGIN = "http://api.test";

/** Build a GET request with optional identity/extra headers. */
export function getRequest(pathAndQuery: string, headers: Record<string, string> = {}): Request {
  return new Request(`${API_ORIGIN}${pathAndQuery}`, { headers });
}

/** Build a POST request with a JSON body (string bodies pass through raw). */
export function postRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Build a DELETE request (no body, just headers). */
export function deleteRequest(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${API_ORIGIN}${path}`, {
    method: "DELETE",
    headers,
  });
}

/** The standard identity headers every endpoint requires/expects. */
export function identityHeaders(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return { "x-wfx-user-id": "wfx-api-test-user", ...overrides };
}

/** A seeded catalog row (real data the 0007 migration inserted). */
export interface SeededRow {
  readonly itemId: string;
  readonly externalRef: string;
  readonly title: string;
}

/** Read one seeded row (a long-form item) straight out of the graph. */
export async function readSeededRow(db: TestDb["db"]): Promise<SeededRow> {
  const rows = await db.query<{ item_id: string; external_ref: string; canonical_title: string }>(
    `SELECT i.id AS item_id, r.external_ref, i.canonical_title
       FROM entertainment_items i
       JOIN source_realizations r ON r.entertainment_item_id = i.id
      WHERE i.canonical_type = 'video'
      ORDER BY i.id
      LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error("test setup: no seeded catalog row found");
  return { itemId: row.item_id, externalRef: row.external_ref, title: row.canonical_title ?? row.external_ref };
}
