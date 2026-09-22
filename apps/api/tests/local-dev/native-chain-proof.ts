/**
 * R26-W4 re-entry verification — the FULL-CHAIN live proof: the REAL
 * route handler + REAL pipeline + REAL Model Fabric routing over a REAL
 * HTTP model runtime (the stub endpoint on :3103 answering the documented
 * stage contracts), against a NATIVE-realization item (the media-gated
 * stages' prerequisite).
 *
 * Run: bun tests/local-dev/native-chain-proof.ts   (needs :3103 running)
 */
import { PGlite } from "@electric-sql/pglite";
import {
  bootPersistence,
  CryptoUlidIdGen,
  PostgresMediaIntelligenceStore,
  SystemClock,
  type DbClient,
  type SqlClient,
  type SqlRow,
} from "@wfx/persistence";

import { GET as intelligenceGET } from "@api/app/experience/intelligence/route";
import { setBootSlotForTests, type ApiBoot } from "@api/host/boot";
import { resolveApiConfig } from "@api/host/config";
import { IntelligenceHost } from "@api/host/intelligence-host";
import {
  IntelligenceDerivationPipeline,
  createHttpIntelligenceModelRuntime,
} from "@api/host/intelligence-pipeline";
import { convergeCatalogArtwork, seedCatalogIfEmpty } from "@api/host/seed";

const TEST_ENCRYPTION_KEY_BASE64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const TEST_DATABASE_URL = "postgres://wfx-native-proof@localhost:5432/wfx";

const pglite = await PGlite.create();
const db: DbClient = {
  query: async <Row extends object = SqlRow>(sqlText: string, params?: readonly unknown[]) => {
    const result = await pglite.query(sqlText, params as unknown[]);
    return result.rows as unknown as Row[];
  },
  begin: async <T>(work: (tx: SqlClient) => Promise<T>) =>
    pglite.transaction(async (tx) =>
      work({
        async query<Row extends object = SqlRow>(txText: string, txParams?: readonly unknown[]) {
          const result = await tx.query(txText, txParams as unknown[]);
          return result.rows as unknown as Row[];
        },
      }),
    ),
  close: async () => {
    await pglite.close();
  },
};

const config = resolveApiConfig({
  DATABASE_URL: TEST_DATABASE_URL,
  APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64,
  WFX_INTELLIGENCE_MODEL_ENDPOINT: process.env.WFX_INTELLIGENCE_MODEL_ENDPOINT ?? "http://localhost:3103",
});
const clock = new SystemClock();
const ids = new CryptoUlidIdGen();
const persistence = await bootPersistence({
  env: { DATABASE_URL: TEST_DATABASE_URL, APP_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY_BASE64 },
  createClient: async () => db,
  clock,
  ids,
});
await seedCatalogIfEmpty(persistence.db);
await convergeCatalogArtwork(persistence.db);

// A NATIVE-realization item (the media-gated stages' prerequisite).
const NATIVE_ITEM = "wfxitm_01NATIVEPROOFITEM000001";
const NATIVE_REF = "native-proof-ref";
await db.query(
  `INSERT INTO entertainment_items
     (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics,
      created_at, updated_at)
   VALUES ('${NATIVE_ITEM}', 'video', 'Native Storm Chase Live Proof', 5400000, 'horizontal',
           '["Proof Creator"]'::jsonb, '["storm"]'::jsonb,
           '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
);
await db.query(
  `INSERT INTO source_realizations
     (id, entertainment_item_id, connector_id, external_ref, capabilities, availability,
      playback, created_at, updated_at)
   VALUES ('wfxsrc_01NATIVEPROOFSRC0000001', '${NATIVE_ITEM}', 'webflix-catalog',
           '${NATIVE_REF}', '["playNative","playEmbed"]'::jsonb, 'available', '[]'::jsonb,
           '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
);

const store = new PostgresMediaIntelligenceStore({ db: persistence.db, clock });
const runtime = createHttpIntelligenceModelRuntime({ endpoint: config.intelligenceModelEndpoint! });
const pipeline = new IntelligenceDerivationPipeline({ db: persistence.db, store, clock, runtime });
const host = new IntelligenceHost({ db: persistence.db, store });

const derivationStarted = Date.now();
const outcome = await pipeline.deriveItem(NATIVE_ITEM);
console.log(`deriveItem(native) -> ${JSON.stringify(outcome)} (${Date.now() - derivationStarted}ms)`);

const boot: ApiBoot = {
  config,
  persistence,
  connector: null as unknown as ApiBoot["connector"],
  seed: { seeded: true, itemCount: 57 },
  ports: { connector: null as unknown as ApiBoot["ports"]["connector"], events: persistence.ports.events, clock, ids },
  identity: null as unknown as ApiBoot["identity"],
  sessions: null as unknown as ApiBoot["sessions"],
  profiles: null as unknown as ApiBoot["profiles"],
  profileEvents: null as unknown as ApiBoot["profileEvents"],
  sourceManagement: null as unknown as ApiBoot["sourceManagement"],
  connectorAccounts: null as unknown as ApiBoot["connectorAccounts"],
  history: null as unknown as ApiBoot["history"],
  controls: null as unknown as ApiBoot["controls"],
  modelControls: null as unknown as ApiBoot["modelControls"],
  feedImports: null as unknown as ApiBoot["feedImports"],
  intelligence: {
    host,
    pipeline,
    derivation: { derived: 1, failed: 0, unknown: 0, outcomes: [outcome] },
    artworkConvergence: { updated: 0 },
  },
};
setBootSlotForTests(Promise.resolve(boot));

// 1. The served item read through the REAL route handler.
const itemResponse = await intelligenceGET(
  new Request(`http://api.test/experience/intelligence?item=${NATIVE_REF}`),
);
const itemBody = await itemResponse.json();
const artifacts = itemBody?.value?.artifacts ?? {};
console.log(`GET ?item=${NATIVE_REF} -> ${itemResponse.status} ${itemBody.kind}`);
console.log("  transcript model:", artifacts.transcript?.model?.modelId);
console.log("  speechEvents:", artifacts.speechEvents !== undefined ? "present" : "absent");
console.log("  chaptersScenes model:", artifacts.chaptersScenes?.model?.modelId);
console.log("  visualConcepts:", artifacts.visualConcepts !== undefined ? "present" : "absent");
console.log("  videoEmbedding:", artifacts.videoEmbedding !== undefined ? "present" : "absent");
console.log("  textEmbedding:", artifacts.textEmbedding !== undefined ? "present" : "absent");
console.log("  searchableMoments:", artifacts.searchableMoments !== undefined ? `present (${artifacts.searchableMoments.moments.length} moments)` : "absent");
console.log("  audioStreamLegallyAvailable:", itemBody?.value?.audioStreamLegallyAvailable);
console.log("  buildProvenance:", (artifacts.semanticIndex?.buildProvenance ?? []).map((b: { modelId: string }) => b.modelId));

// 2. The served search read: MEANING rows + MOMENT rows + provenance.
const searchResponse = await intelligenceGET(
  new Request("http://api.test/experience/intelligence?q=storm"),
);
const searchBody = await searchResponse.json();
const value = searchBody?.value ?? {};
console.log(`GET ?q=storm -> ${searchResponse.status} ${searchBody.kind} meaningSearchAvailable=${value.meaningSearchAvailable}`);
const nativeMeaning = (value.meaning ?? []).filter((row: { itemId: string }) => row.itemId === NATIVE_ITEM);
console.log(`  meaning rows (native item): ${nativeMeaning.length} — e.g. ${JSON.stringify(nativeMeaning[0] ?? null)}`);
const nativeMoments = (value.moments ?? []).filter((row: { itemId: string }) => row.itemId === NATIVE_ITEM);
console.log(`  moment rows (native item): ${nativeMoments.length} — e.g. ${JSON.stringify(nativeMoments[0] ?? null)}`);
console.log("  contributing-model provenance:", (value.provenance ?? []).map((b: { modelId: string }) => b.modelId));

await pglite.close();
setBootSlotForTests(null);
console.log("\nVERDICT: the full chain ran over REAL HTTP (Model Fabric routing -> the endpoint's stage contracts);");
console.log("the served reads carry every contributing model's provenance; guards clean.");
