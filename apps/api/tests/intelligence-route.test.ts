/**
 * R26-W4 — the intelligence route tests (bun:test, PGlite — real Postgres).
 *
 * Pins the `/experience/intelligence` wire contract's SERVICE side over the
 * COMPLETE `ApiBoot` composition (the same wiring `bootApi` performs —
 * the derived-artifact store + the derivation pipeline + the read host):
 *
 * - THE WIRE SHAPES: every 200 body passes the FROZEN client-side guards
 *   (`@wfx/model-fabric`'s `isIntelligenceReadNotServedWire` /
 *   `isIntelligenceSearchReadWire` / `isIntelligenceItemReadWire` — the
 *   EXACT validation the web host's service transport applies; malformed
 *   payloads are rejected by the client, so the service must pass them by
 *   construction);
 * - THE SERVED ITEM READ: a boot-derived item (the honest unprovisioned
 *   truth — the source-provided semantic index with honest provenance,
 *   the embed-only catalog's legal-audio truth false);
 * - THE TYPED NO-ARTIFACTS TRUTH: an item the pass has not derived (never
 *   derived yet) and an unknown ref (no realization) both answer the
 *   typed `no-derived-artifacts` not-served;
 * - THE SERVED SEARCH READ: the honest empty-but-served envelope over the
 *   embed-only catalog (`meaningSearchAvailable: false` — the R23-H
 *   prerequisite truth, never fabricated rows);
 * - THE FULL CHAIN with the INJECTED RUNTIME STUB (the established
 *   injectable seam): a NATIVE-realization item derives transcript +
 *   chapters + BOTH embeddings through the REAL Model Fabric routing,
 *   and the search read then serves MEANING rows + MOMENT rows with the
 *   contributing models' provenance;
 * - THE HONEST-FAILURE PATH: the unprovisioned boot's stage outcomes
 *   record the not-provisioned truths (the store's prerequisite record);
 * - TYPED 400s (absent/both/empty params, garbage identity);
 * - DEGRADATION: the DB killed under a booted composition answers the
 *   honest typed not-served `transport-unavailable` 200 (never 5xx,
 *   never a fabricated served answer);
 * - THE ARTWORK PROJECTION: search + metadata answers carry the
 *   connector's `thumbnailUrl` metadata (the provider's own artwork
 *   address — the R26 production-discovery gap's fix).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  isIntelligenceItemReadWire,
  isIntelligenceReadNotServedWire,
  isIntelligenceSearchReadWire,
  type IntelligenceReadOutcome,
} from "@wfx/model-fabric";

import { GET as intelligenceGET } from "../src/app/experience/intelligence/route";
import { GET as metadataGET } from "../src/app/experience/metadata/route";
import { GET as searchGET } from "../src/app/experience/search/route";
import type { IntelligenceModelRuntime } from "../src/host/intelligence-pipeline";
import { setApiBootForTests } from "../src/host/testing";
import {
  createApiTestBoot,
  getRequest,
  identityHeaders,
  readSeededRow,
  type ApiTestBoot,
} from "./test-boot";

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/**
 * The frozen client's EXACT validation of one route answer (the mirror of
 * `apps/web/src/host/intelligence-service-transport.ts`'s read path): a
 * not-served body must pass the not-served guard; a served body's value
 * must pass the read-specific guard. Anything else is wire drift.
 */
function expectWireShape(
  body: unknown,
  scope: "search-by-meaning" | "item-artifacts",
): void {
  const record = body as Record<string, unknown>;
  if (isIntelligenceReadNotServedWire(body)) {
    expect(record.kind).toBe("not-served");
    return;
  }
  expect(record.kind).toBe("served");
  const guard = scope === "search-by-meaning" ? isIntelligenceSearchReadWire : isIntelligenceItemReadWire;
  expect(guard(record.value), `served ${scope} value: ${JSON.stringify(record.value)}`).toBe(true);
}

// ---------------------------------------------------------------------------
// The default harness — the honest UNPROVISIONED deployment truth
// ---------------------------------------------------------------------------

let harness: ApiTestBoot;
let seededRef: string;

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);
  const seeded = await readSeededRow(harness.testDb.db);
  seededRef = seeded.externalRef;
});

afterAll(async () => {
  setApiBootForTests(null);
  await harness.testDb.close();
});

describe("GET /experience/intelligence — the unprovisioned boot's honest truths", () => {
  it("serves the boot-derived item read: the source-provided index with honest provenance", async () => {
    const response = await intelligenceGET(
      getRequest(`/experience/intelligence?item=${encodeURIComponent(seededRef)}`, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as IntelligenceReadOutcome<{
      artifacts: { semanticIndex?: { entries: unknown[]; buildProvenance: unknown[] } };
      audioStreamLegallyAvailable: boolean;
    }>;
    expectWireShape(body, "item-artifacts");
    expect(body.kind).toBe("served");
    if (body.kind !== "served") return;
    // The source-provided semantic index: the catalog's own metadata truth.
    const index = body.value.artifacts.semanticIndex;
    expect(index).toBeDefined();
    expect((index?.entries.length ?? 0)).toBeGreaterThan(0);
    // The honest provenance: the source-provided block, never a fabricated model.
    const provenance = index?.buildProvenance ?? [];
    expect(provenance.some((block) => (block as { modelId?: string }).modelId === "source-provided")).toBe(true);
    // The embed-only catalog's legal-audio truth (fail-closed).
    expect(body.value.audioStreamLegallyAvailable).toBe(false);
  });

  it("answers the typed no-derived-artifacts truth for an item the pass has not derived", async () => {
    // A catalog row inserted AFTER the boot pass — never derived yet.
    await harness.testDb.db.query(
      `INSERT INTO entertainment_items
         (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics,
          created_at, updated_at)
       VALUES ('wfxitm_01TESTINTELLIGENCE000000001', 'video', 'Undeclared Storm Diaries',
               5400000, 'horizontal', '["Later Insert"]'::jsonb, '["documentary"]'::jsonb,
               '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    await harness.testDb.db.query(
      `INSERT INTO source_realizations
         (id, entertainment_item_id, connector_id, external_ref, capabilities, availability,
          playback, created_at, updated_at)
       VALUES ('wfxsrc_01TESTINTELLIGENCE000000001', 'wfxitm_01TESTINTELLIGENCE000000001',
               'webflix-catalog', 'test-undeclared-ref', '["playEmbed","playExternal"]'::jsonb,
               'available', '[]'::jsonb, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    const response = await intelligenceGET(
      getRequest("/experience/intelligence?item=test-undeclared-ref", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as IntelligenceReadOutcome<unknown>;
    expectWireShape(body, "item-artifacts");
    expect(body.kind).toBe("not-served");
    if (body.kind !== "not-served") return;
    expect(body.reason).toBe("no-derived-artifacts");
    expect(body.detail.length).toBeGreaterThan(0);
    expect(body.dependency.length).toBeGreaterThan(0);
    expect(body.nextAction?.label).toBeDefined();
  });

  it("answers the typed no-derived-artifacts truth for an unknown ref (no realization)", async () => {
    const response = await intelligenceGET(
      getRequest("/experience/intelligence?item=not-a-real-ref", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as IntelligenceReadOutcome<unknown>;
    expectWireShape(body, "item-artifacts");
    expect(body.kind).toBe("not-served");
    if (body.kind !== "not-served") return;
    expect(body.reason).toBe("no-derived-artifacts");
    expect(body.dependency).toContain("no catalog realization");
  });

  it("serves the search read with the honest prerequisite truth (empty but SERVED)", async () => {
    const response = await intelligenceGET(
      getRequest("/experience/intelligence?q=storm", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as IntelligenceReadOutcome<{
      meaning: unknown[];
      moments: unknown[];
      meaningSearchAvailable: boolean;
    }>;
    expectWireShape(body, "search-by-meaning");
    expect(body.kind).toBe("served");
    if (body.kind !== "served") return;
    // The embed-only catalog derives NO embeddings — search-by-meaning's
    // prerequisites are honestly missing, so no rows are fabricated.
    expect(body.value.meaning).toEqual([]);
    expect(body.value.moments).toEqual([]);
    expect(body.value.meaningSearchAvailable).toBe(false);
  });

  it("records the honest not-provisioned stage truths in the store (the prerequisite record)", async () => {
    const derived = await harness.boot.intelligence.host
      .searchByMeaning("storm")
      .then(() => harness.testDb.db.query<{ stage_outcomes: unknown }>(
        `SELECT stage_outcomes FROM media_intelligence_artifacts
          WHERE derivation_status = 'derived' LIMIT 1`,
      ));
    const outcomes = derived[0]?.stage_outcomes as Array<{ stage: string; outcome: string; detail: string }>;
    expect(Array.isArray(outcomes)).toBe(true);
    const transcription = outcomes.find((outcome) => outcome.stage === "transcription");
    expect(transcription?.outcome).toBe("skipped-prerequisite-missing");
    expect(transcription?.detail).toContain("no server-fetchable audio realization");
    const textEmbedding = outcomes.find((outcome) => outcome.stage === "text-embeddings");
    expect(textEmbedding?.outcome).toBe("failed");
    expect(textEmbedding?.detail).toContain("WFX_INTELLIGENCE_MODEL_ENDPOINT is unset");
  });

  it("answers typed 400s for garbage params (and serves ANONYMOUSLY — the R23-K boundary)", async () => {
    const neither = await intelligenceGET(
      getRequest("/experience/intelligence"),
    );
    expect(neither.status).toBe(400);

    const both = await intelligenceGET(
      getRequest("/experience/intelligence?q=a&item=b"),
    );
    expect(both.status).toBe(400);

    const empty = await intelligenceGET(
      getRequest("/experience/intelligence?q=%20%20"),
    );
    expect(empty.status).toBe(400);

    // THE ANONYMOUS BOUNDARY: the wire contract's client sends NO identity
    // headers (accept: application/json only) — the read serves without a
    // login wall (R23-K), unlike the identity-carrying /experience routes.
    const anonymous = await intelligenceGET(
      getRequest("/experience/intelligence?q=storm"),
    );
    expect(anonymous.status).toBe(200);
    const body = (await json(anonymous)) as IntelligenceReadOutcome<unknown>;
    expectWireShape(body, "search-by-meaning");
    expect(body.kind).toBe("served");
  });
});

// ---------------------------------------------------------------------------
// The full chain — the injected runtime stub over a NATIVE-realization item
// ---------------------------------------------------------------------------

/**
 * The deterministic runtime stub (the ESTABLISHED injectable seam — the
 * same law the fabric's own testing.ts keeps): answers the documented
 * stage contracts with deterministic content. TEST-ONLY.
 */
const stubRuntime: IntelligenceModelRuntime = {
  async execute(invocation) {
    switch (invocation.stage) {
      case "transcription":
        return {
          language: "en",
          confidence: 0.94,
          segments: [
            { startMs: 0, endMs: 6400, text: "The storm front crosses the ridge at dusk.", language: "en", speakerLabel: "Narrator" },
            { startMs: 6500, endMs: 15200, text: "We follow the chase team through the open plains.", language: "en", speakerLabel: "Field Reporter" },
          ],
          events: [
            { kind: "speaker", label: "Narrator", startMs: 0, endMs: 6400 },
            { kind: "acoustic", event: "thunder", startMs: 9000, endMs: 10000, confidence: 0.86 },
          ],
        };
      case "structural-analysis":
        return {
          confidence: 0.88,
          units: [
            { kind: "chapter", startMs: 0, endMs: 6400, title: "Storm front", summary: "The storm front crosses the ridge at dusk." },
            { kind: "chapter", startMs: 6500, endMs: 15200, title: "The chase", summary: "Following the chase team through the plains." },
          ],
          detections: [
            { name: "storm cloud", kind: "concept", confidence: 0.97, startMs: 0, endMs: 6400 },
            { name: "plains", kind: "concept", confidence: 0.9 },
          ],
        };
      case "video-embeddings":
        return { confidence: 0.9, vector: [0.12, -0.34, 0.56], dimensions: 3 };
      case "text-embeddings":
        return { confidence: 0.91, vector: [0.22, -0.14, 0.41], dimensions: 3, language: "en" };
    }
  },
};

describe("GET /experience/intelligence — the full chain over the injected runtime stub", () => {
  const NATIVE_ITEM = "wfxitm_01TESTNATIVEINTEL0000001";
  const NATIVE_REF = "test-native-ref";
  let stubbed: ApiTestBoot;

  beforeAll(async () => {
    stubbed = await createApiTestBoot({
      intelligenceRuntime: stubRuntime,
      intelligenceDerivationLimit: 0, // derive nothing at boot; drive the pipeline explicitly below
    });
    setApiBootForTests(stubbed.boot);
    await stubbed.testDb.db.query(
      `INSERT INTO entertainment_items
         (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics,
          created_at, updated_at)
       VALUES ('${NATIVE_ITEM}', 'video', 'Native Storm Chase', 5400000, 'horizontal',
               '["Test Creator"]'::jsonb, '["storm"]'::jsonb,
               '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    await stubbed.testDb.db.query(
      `INSERT INTO source_realizations
         (id, entertainment_item_id, connector_id, external_ref, capabilities, availability,
          playback, created_at, updated_at)
       VALUES ('wfxsrc_01TESTNATIVEINTEL0000001', '${NATIVE_ITEM}', 'webflix-catalog',
               '${NATIVE_REF}', '["playNative","playEmbed"]'::jsonb, 'available', '[]'::jsonb,
               '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    const outcome = await stubbed.boot.intelligence.pipeline.deriveItem(NATIVE_ITEM);
    expect(outcome.kind).toBe("derived");
  });

  afterAll(() => {
    setApiBootForTests(harness.boot); // restore the default composition
  });

  it("derives the FULL artifact set through the real Model Fabric routing", async () => {
    const response = await intelligenceGET(
      getRequest(`/experience/intelligence?item=${encodeURIComponent(NATIVE_REF)}`, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as IntelligenceReadOutcome<{
      artifacts: {
        transcript?: { model: { modelId: string } };
        speechEvents?: unknown;
        chaptersScenes?: { model: { modelId: string } };
        visualConcepts?: unknown;
        videoEmbedding?: unknown;
        textEmbedding?: unknown;
        searchableMoments?: unknown;
        semanticIndex?: { buildProvenance: Array<{ modelId: string }> };
      };
      audioStreamLegallyAvailable: boolean;
    }>;
    expectWireShape(body, "item-artifacts");
    expect(body.kind).toBe("served");
    if (body.kind !== "served") return;
    const artifacts = body.value.artifacts;
    // Every stage derived: transcript + diarization + chapters + concepts +
    // BOTH embeddings + moments + the folded index.
    expect(artifacts.transcript?.model.modelId).toBe("open-model:moss-transcribe-diarize");
    expect(artifacts.speechEvents).toBeDefined();
    expect(artifacts.chaptersScenes?.model.modelId).toBe("open-model:qwen2.5-vl-7b-instruct");
    expect(artifacts.visualConcepts).toBeDefined();
    expect(artifacts.videoEmbedding).toBeDefined();
    expect(artifacts.textEmbedding).toBeDefined();
    expect(artifacts.searchableMoments).toBeDefined();
    // The legal-audio truth flips for a NATIVE realization.
    expect(body.value.audioStreamLegallyAvailable).toBe(true);
    // The contributing models' provenance (the ownership law — never authority).
    const models = (artifacts.semanticIndex?.buildProvenance ?? []).map((block) => block.modelId);
    expect(models).toContain("source-provided");
    expect(models).toContain("open-model:moss-transcribe-diarize");
    expect(models).toContain("open-model:qwen2.5-vl-7b-instruct");
    expect(models).toContain("open-model:videoprism-base-f16r288");
    expect(models).toContain("open-model:bge-m3");
  });

  it("serves MEANING rows + MOMENT rows with provenance over the fully-derived set", async () => {
    const response = await intelligenceGET(
      getRequest("/experience/intelligence?q=storm", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as IntelligenceReadOutcome<{
      meaning: Array<{ itemId: string; title: string; matchedText: string; score: number }>;
      moments: Array<{ itemId: string; startMs: number; description: string }>;
      provenance: Array<{ modelId: string }>;
      meaningSearchAvailable: boolean;
    }>;
    expectWireShape(body, "search-by-meaning");
    expect(body.kind).toBe("served");
    if (body.kind !== "served") return;
    expect(body.value.meaningSearchAvailable).toBe(true);
    const meaning = body.value.meaning.filter((row) => row.itemId === NATIVE_ITEM);
    expect(meaning.length).toBe(1);
    expect(meaning[0]?.title).toBe("Native Storm Chase");
    expect(meaning[0]?.matchedText.length).toBeGreaterThan(0);
    expect(meaning[0]?.score).toBeGreaterThan(0);
    const moments = body.value.moments.filter((row) => row.itemId === NATIVE_ITEM);
    expect(moments.length).toBeGreaterThan(0);
    const models = body.value.provenance.map((block) => block.modelId);
    expect(models).toContain("open-model:moss-transcribe-diarize");
    expect(models).toContain("open-model:bge-m3");
  });
});

// ---------------------------------------------------------------------------
// Degradation — the DB killed under a booted composition
// ---------------------------------------------------------------------------

describe("GET /experience/intelligence — degradation (the DB is killed)", () => {
  let dead: ApiTestBoot;

  beforeAll(async () => {
    dead = await createApiTestBoot({ intelligenceDerivationLimit: 1 });
    await dead.testDb.close(); // kill the database under a booted composition
    setApiBootForTests(dead.boot);
  });
  afterAll(() => {
    setApiBootForTests(harness.boot); // restore the healthy composition
  });

  it("answers the honest typed not-served transport-unavailable 200 (never 5xx, never fabricated)", async () => {
    const search = await intelligenceGET(
      getRequest("/experience/intelligence?q=storm", identityHeaders()),
    );
    expect(search.status).toBe(200);
    const searchBody = (await json(search)) as IntelligenceReadOutcome<unknown>;
    expectWireShape(searchBody, "search-by-meaning");
    expect(searchBody.kind).toBe("not-served");
    if (searchBody.kind !== "not-served") return;
    expect(searchBody.reason).toBe("transport-unavailable");
    expect(searchBody.detail).toContain("temporarily unreachable");

    const item = await intelligenceGET(
      getRequest(`/experience/intelligence?item=${encodeURIComponent(seededRef)}`, identityHeaders()),
    );
    expect(item.status).toBe(200);
    const itemBody = (await json(item)) as IntelligenceReadOutcome<unknown>;
    expectWireShape(itemBody, "item-artifacts");
    expect(itemBody.kind).toBe("not-served");
    if (itemBody.kind !== "not-served") return;
    expect(itemBody.reason).toBe("transport-unavailable");
  });
});

// ---------------------------------------------------------------------------
// The artwork projection (the production-discovery gap's fix)
// ---------------------------------------------------------------------------

describe("the artwork projection — search + metadata carry the connector's thumbnailUrl", () => {
  it("every search hit carries the provider's own artwork address in metadata", async () => {
    const response = await searchGET(
      getRequest("/experience/search?query=rain", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const hits = (await json(response)) as Array<{
      externalRef: string;
      metadata?: { thumbnailUrl?: string };
    }>;
    expect(hits.length).toBeGreaterThanOrEqual(5);
    for (const hit of hits) {
      expect(hit.metadata?.thumbnailUrl).toBe(
        `https://i.ytimg.com/vi/${hit.externalRef}/hqdefault.jpg`,
      );
    }
  });

  it("the metadata read carries the same projection (the item detail's carrier)", async () => {
    const response = await metadataGET(
      getRequest(`/experience/metadata?ref=${encodeURIComponent(seededRef)}`, identityHeaders()),
    );
    expect(response.status).toBe(200);
    const item = (await json(response)) as {
      externalRef: string;
      metadata?: { thumbnailUrl?: string };
    } | null;
    expect(item).not.toBeNull();
    expect(item?.metadata?.thumbnailUrl).toBe(
      `https://i.ytimg.com/vi/${item?.externalRef}/hqdefault.jpg`,
    );
  });
});
