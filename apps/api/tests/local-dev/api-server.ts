/**
 * @wfx/app-api — the LOCAL DEV harness server (R26-W4 verification).
 *
 * ⚠️ LOCAL VERIFICATION ONLY — never a production path ⚠️
 *
 * Serves the REAL route handlers (the production modules imported
 * verbatim — the same GET functions the Next.js App Router serves) over
 * plain HTTP, booted over the REAL service composition with the
 * documented 052 `createClient` seam swapped to PGlite (the same seam
 * `tests/test-boot.ts` uses; the production boot composes the identical
 * wiring over postgres.js). The task's own words sanction this path:
 * "boot the API locally (OR VIA ITS HARNESS)".
 *
 * WHY THIS EXISTS (the honest constraint): the sandbox verification
 * station has no PostgreSQL server, and the wire-protocol bridge
 * (@electric-sql/pglite-socket) does not complete the postgres.js
 * handshake in this environment (ECONNRESET/hang — verified). The
 * harness therefore boots the REAL `ApiBoot` composition (the exact
 * `bootApi` wiring — SystemClock + CryptoUlidIdGen, the production
 * seams) over PGlite and installs it through `setBootSlotForTests`
 * (the exported singleton-slot seam in `host/boot.ts`), so the REAL
 * route handlers' `getApiBoot()` calls resolve to this composition.
 * Every convergence step the production boot performs runs here too:
 * migrations -> catalog seed -> artwork projection -> the intelligence
 * derivation pass (the honest unprovisioned model-runtime truth unless
 * WFX_INTELLIGENCE_MODEL_ENDPOINT is provisioned).
 *
 * Run: `bun tests/local-dev/api-server.ts` (port 3102 — the same port
 * the app's `next dev` uses, so the web host's WFX_API_BASE wiring is
 * identical), then boot the web with
 * WFX_API_BASE=http://localhost:3102.
 */

import { PGlite } from "@electric-sql/pglite";
import {
  bootPersistence,
  CryptoUlidIdGen,
  PostgresConnectorAccountStore,
  PostgresEventSink,
  PostgresIdentityService,
  PostgresMediaIntelligenceStore,
  PostgresProfileService,
  PostgresSessionService,
  SystemClock,
  decodeEncryptionKey,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "@wfx/persistence";

import { GET as healthGET } from "../../src/app/api/health/route";
import { GET as intelligenceGET } from "../../src/app/experience/intelligence/route";
import { GET as metadataGET } from "../../src/app/experience/metadata/route";
import { GET as resolveGET } from "../../src/app/experience/resolve/route";
import { GET as searchGET } from "../../src/app/experience/search/route";
import { setBootSlotForTests, type ApiBoot } from "../../src/host/boot";
import { resolveApiConfig } from "../../src/host/config";
import { RecommendationControlsHost } from "../../src/host/controls";
import { createFeedImportHost } from "../../src/host/feed-import";
import { createFanOutConnector } from "../../src/host/fan-out";
import { HistoryHost } from "../../src/host/history";
import { IntelligenceHost } from "../../src/host/intelligence-host";
import {
  IntelligenceDerivationPipeline,
  createHttpIntelligenceModelRuntime,
  type IntelligenceModelRuntime,
} from "../../src/host/intelligence-pipeline";
import { ModelControlsHost } from "../../src/host/model-controls";
import { convergeCatalogArtwork, seedCatalogIfEmpty } from "../../src/host/seed";
import { createSourceManagementService } from "../../src/host/source-management";
import { API_SERVICE_VERSION } from "../../src/host/version";

const PORT = 3102;
const TEST_ENCRYPTION_KEY_BASE64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const TEST_DATABASE_URL = "postgres://wfx-local-dev@localhost:5432/wfx";

// --- the PGlite DbClient (the documented 052 test seam) -------------------

const pglite = await PGlite.create();
const db: DbClient = {
  query: async <Row extends object = SqlRow>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]> => {
    const result = await pglite.query(sqlText, params as unknown[]);
    return result.rows as unknown as Row[];
  },
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

// --- the REAL bootApi composition (the production seams) ------------------

const config = resolveApiConfig({
  DATABASE_URL: TEST_DATABASE_URL,
  APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
  ...(process.env.WFX_INTELLIGENCE_MODEL_ENDPOINT !== undefined
    ? { WFX_INTELLIGENCE_MODEL_ENDPOINT: process.env.WFX_INTELLIGENCE_MODEL_ENDPOINT }
    : {}),
  ...(process.env.WFX_INTELLIGENCE_DERIVATION_LIMIT !== undefined
    ? { WFX_INTELLIGENCE_DERIVATION_LIMIT: process.env.WFX_INTELLIGENCE_DERIVATION_LIMIT }
    : {}),
});

const clock = new SystemClock();
const ids = new CryptoUlidIdGen();
const persistence = await bootPersistence({
  env: {
    DATABASE_URL: TEST_DATABASE_URL,
    APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
  },
  createClient: async () => db,
  clock,
  ids,
});
const seed = await seedCatalogIfEmpty(persistence.db);
const artworkConvergence = await convergeCatalogArtwork(persistence.db);

const identity = new PostgresIdentityService({ db: persistence.db, ids, clock });
const sessions = new PostgresSessionService({ db: persistence.db, ids, clock });
const profiles = new PostgresProfileService({ db: persistence.db, ids, clock });
const profileEvents = new PostgresEventSink({ db: persistence.db, ids, clock });
const connectorAccounts = new PostgresConnectorAccountStore({
  db: persistence.db,
  clock,
  key: decodeEncryptionKey(TEST_ENCRYPTION_KEY_BASE64),
  ids,
});
const connector = createFanOutConnector({
  sources: [persistence.ports.connector],
  clock,
  version: API_SERVICE_VERSION,
});
const sourceManagement = createSourceManagementService({
  sourceRows: connector.sourceRows(),
  wirings: new Map(),
  accounts: connectorAccounts,
  clock,
});
const history = new HistoryHost({ db: persistence.db, clock, ids });
const controls = new RecommendationControlsHost({ db: persistence.db, clock, ids });
const modelControls = new ModelControlsHost({
  db: persistence.db,
  clock,
  ids,
  key: decodeEncryptionKey(TEST_ENCRYPTION_KEY_BASE64),
});
const feedImports = await createFeedImportHost({
  db: persistence.db,
  clock,
  ids,
  accounts: connectorAccounts,
  wirings: new Map(),
});

const intelligenceStore = new PostgresMediaIntelligenceStore({ db: persistence.db, clock });
const intelligenceRuntime: IntelligenceModelRuntime | null =
  config.intelligenceModelEndpoint !== null
    ? createHttpIntelligenceModelRuntime({ endpoint: config.intelligenceModelEndpoint })
    : null;
const intelligencePipeline = new IntelligenceDerivationPipeline({
  db: persistence.db,
  store: intelligenceStore,
  clock,
  runtime: intelligenceRuntime,
});
const intelligence = new IntelligenceHost({ db: persistence.db, store: intelligenceStore });
const derivationStarted = Date.now();
const derivation = await intelligencePipeline.deriveCatalog(config.intelligenceDerivationLimit);

const boot: ApiBoot = {
  config,
  persistence,
  connector,
  seed,
  ports: { connector, events: persistence.ports.events, clock, ids },
  identity,
  sessions,
  profiles,
  profileEvents,
  sourceManagement,
  connectorAccounts,
  history,
  controls,
  modelControls,
  feedImports,
  intelligence: {
    host: intelligence,
    pipeline: intelligencePipeline,
    derivation,
    artworkConvergence,
  },
};

// Install the composition through the singleton-slot seam so the REAL
// route handlers' getApiBoot() resolves to it.
setBootSlotForTests(Promise.resolve(boot));

console.log("[local-dev] the REAL service composition over PGlite:");
console.log(`[local-dev]   seed: ${JSON.stringify(seed)}`);
console.log(`[local-dev]   artwork convergence: ${JSON.stringify(artworkConvergence)}`);
console.log(
  `[local-dev]   intelligence derivation pass: derived=${derivation.derived} failed=${derivation.failed} unknown=${derivation.unknown} (${Date.now() - derivationStarted}ms)`,
);
console.log(
  `[local-dev]   model runtime: ${intelligenceRuntime === null ? "NOT provisioned (the honest unprovisioned truth)" : config.intelligenceModelEndpoint}`,
);

// --- the HTTP surface (the REAL route handlers) ---------------------------

const routes: ReadonlyArray<{ readonly path: string; readonly handler: (request: Request) => Response | Promise<Response> }> = [
  { path: "/api/health", handler: healthGET },
  { path: "/experience/intelligence", handler: intelligenceGET },
  { path: "/experience/search", handler: searchGET },
  { path: "/experience/metadata", handler: metadataGET },
  { path: "/experience/resolve", handler: resolveGET },
];

Bun.serve({
  port: PORT,
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    // Mirror the REAL Next.js deployment's path normalization: Next answers
    // `//experience/...` with a 308 redirect to the single-slash path (which
    // the standard fetch redirect-following resolves — verified against the
    // real `next dev` server). The harness normalizes directly, so the web
    // host's transport (whose URL concatenation can produce the double
    // slash when WFX_API_BASE has no path) sees the same answers the real
    // deployment serves.
    const path = url.pathname.replace(/^\/{2,}/, "/");
    const route = routes.find((entry) => entry.path === path);
    if (route === undefined) {
      return Response.json({ error: "not-found", detail: `no harness route for ${url.pathname}` }, { status: 404 });
    }
    if (request.method !== "GET") {
      return Response.json({ error: "method-not-allowed", detail: "the harness serves GET" }, { status: 405 });
    }
    return route.handler(request);
  },
});

console.log(`[local-dev] the REAL route handlers serving on http://localhost:${PORT}`);
console.log("[local-dev]   GET /api/health | /experience/intelligence?q=|item= | /experience/search?query= | /experience/metadata?ref= | /experience/resolve?ref=");
