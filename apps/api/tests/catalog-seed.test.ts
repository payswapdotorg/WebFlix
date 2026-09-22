/**
 * WFX-055A catalog-seed tests (bun:test, PGlite — real Postgres).
 *
 * Pins the APP-OWNED seed (`src/host/seed.ts` — the curated webflix-catalog
 * content, applied BOOT-IF-EMPTY by the service boot; the harness applies
 * it via the same `seedCatalogIfEmpty` convergence step):
 *
 * - CONVERGENCE + IDEMPOTENCY: a second `seedCatalogIfEmpty` pass on a
 *   seeded database seeds NOTHING (the never-overwrite law — an environment
 *   with any items is left exactly as it is); a RAW re-application of the
 *   seed statements (the concurrent-cold-start race) changes no count
 *   (statement-level `ON CONFLICT DO NOTHING`); and the migration set
 *   itself re-verifies clean (the schema baseline is untouched by the seed).
 * - THE CATALOG: exactly 57 entertainment_items + 57 source_realizations.
 * - GRAPH INVARIANTS: every realization's item exists; one webflix-catalog
 *   realization per item; capabilities non-empty and drawn from the frozen
 *   `Capability` vocabulary; external_refs match the real YouTube id shape
 *   and are unique; availability is honest; the stored playback arrays are
 *   valid realizations with the REAL embed/watch URL patterns.
 * - THE SPLIT: 24 short-form (canonical type 'short', vertical) + 33
 *   long-form ('video', horizontal) — and no other combination.
 * - DETERMINISM: the ids are canonical ULIDs on a FIXED timestamp
 *   (2026-09-16T00:00:00.000Z — the seed header's claim, decoded and
 *   verified) and a SECOND fresh database converges on the identical id set.
 *
 * Determinism laws: static data, fixed timestamps, no clock reads (the SQL
 * itself never reads one). No network — PGlite is real Postgres compiled to
 * WASM, the same engine the persistence package's own harness uses.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  CAPABILITIES,
  isEntertainmentItemId,
  isSourceRealizationId,
  validatePlaybackRealization,
} from "@wfx/domain";
import { runMigrations } from "@wfx/persistence";

import { convergeCatalogArtwork, SEED_CATALOG_SQL, seedCatalogIfEmpty } from "../src/host/seed";
import { createTestDb, type TestDb } from "./test-db";

/** The seed's own statement splitter (the 052 runner's format law). */
function splitStatements(sql: string): readonly string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** The Crockford Base32 alphabet (the domain's canonical ULID encoding). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Decode the 48-bit timestamp of a 26-char ULID body (epoch ms). */
function ulidTimeMs(body: string): number {
  let time = 0;
  for (let index = 0; index < 10; index += 1) {
    time = time * 32 + CROCKFORD.indexOf(body[index] ?? "");
  }
  return time;
}

/** The fixed seed timestamp the 0007 header declares (verified by decode). */
const SEED_INSTANT = "2026-09-16T00:00:00.000Z";

/** The real YouTube video id shape (11 chars of id alphabet). */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** One graph row, joined (item + its webflix-catalog realization). */
interface CatalogRow {
  readonly item_id: string;
  readonly realization_id: string;
  readonly canonical_type: string;
  readonly canonical_title: string | null;
  readonly duration_ms: unknown;
  readonly orientation: string | null;
  readonly creators: unknown;
  readonly topics: unknown;
  readonly external_ref: string;
  readonly capabilities: unknown;
  readonly availability: string;
  readonly playback: unknown;
}

const CATALOG_SQL = `
  SELECT i.id AS item_id, r.id AS realization_id, i.canonical_type, i.canonical_title,
         i.duration_ms, i.orientation, i.creators, i.topics, r.external_ref,
         r.capabilities, r.availability, r.playback
    FROM entertainment_items i
    JOIN source_realizations r ON r.entertainment_item_id = i.id
   ORDER BY i.id`;

let first: TestDb;
let second: TestDb;
let rows: CatalogRow[];

beforeAll(async () => {
  first = await createTestDb(); // migrations + the seed convergence step
  rows = await first.db.query<CatalogRow>(CATALOG_SQL);
  second = await createTestDb(); // the determinism twin (fresh engine)
}, 30_000); // TWO migration-heavy engines: under the full-suite parallel load
// (R02's DB-heavy API/persistence test files) the twin's creation can exceed
// Bun's default 7s hook timeout — migrations, not a product defect (verified:
// 13/13 in isolation). 30s absorbs load variance without masking hangs.

afterAll(async () => {
  await first.close();
  await second.close();
});

describe("catalog seed — convergence + idempotency (boot-if-empty, never overwrite)", () => {
  it("the schema baseline is untouched: the migration set re-verifies clean (fifteen)", async () => {
    // R02 added migration 0007 (profiles + profile scoping — SCHEMA, not
    // app-owned data; the seed's never-into-the-migration-dir decision
    // record is about DATA). R03 added migration 0008 (the source-management
    // lifecycle columns + pending authorizations — SCHEMA again). R04 added
    // migration 0009 (the canonical-keyed library + history removals/
    // exclusions tables — SCHEMA again). R05 added migration 0010 (the
    // recommendation feedback controls table — SCHEMA again). R06 added
    // migration 0011 (the model policy + BYOM bindings + transform
    // operations + append-only state history tables — SCHEMA again). R15
    // added its 0011 (the durable action outbox + local action audit +
    // sync log tables — SCHEMA again; distinct filename/id, sorted order).
    // R20-A added migration 0012 (the BYOF feed imports/preview staging/
    // idempotent feed records tables — SCHEMA again). R20-C added
    // migration 0013 (the feed import sync-scope relationships column —
    // SCHEMA again). R26-W4 added migration 0014 (the media-intelligence
    // derived-artifact store + the realization metadata column — SCHEMA
    // again; the artwork DATA stays in the seed's convergence step).
    // The re-verify law is unchanged: nothing new applies, no drift.
    const again = await runMigrations(first.db);
    expect(again.applied).toEqual([]);
    expect(again.total).toBe(15);
  });

  it("a second seedCatalogIfEmpty pass seeds NOTHING (the never-overwrite law)", async () => {
    const pass = await seedCatalogIfEmpty(first.db);
    expect(pass).toEqual({ seeded: false, itemCount: 57 });
  });

  it("a RAW seed re-application (the concurrent-cold-start race) changes no count", async () => {
    for (const statement of splitStatements(SEED_CATALOG_SQL)) {
      await first.db.query(statement);
    }
  });

  it("the counts are unchanged by the re-run (57 + 57, ON CONFLICT DO NOTHING)", async () => {
    const items = await first.db.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM entertainment_items",
    );
    const realizations = await first.db.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM source_realizations",
    );
    expect(Number(items[0]?.count)).toBe(57);
    expect(Number(realizations[0]?.count)).toBe(57);

    // The graph join is still exactly one row per item (no duplicate seeds).
    const joined = await first.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM source_realizations r
         JOIN entertainment_items i ON i.id = r.entertainment_item_id`,
    );
    expect(Number(joined[0]?.count)).toBe(57);
  });
});

describe("catalog seed — the catalog and its graph invariants", () => {
  it("carries exactly 57 joined rows, one webflix-catalog realization per item", () => {
    expect(rows).toHaveLength(57);
    const itemIds = new Set(rows.map((row) => row.item_id));
    expect(itemIds.size).toBe(57);
    const realizationIds = new Set(rows.map((row) => row.realization_id));
    expect(realizationIds.size).toBe(57);
    for (const row of rows) {
      expect(isEntertainmentItemId(row.item_id), `item id: ${row.item_id}`).toBe(true);
      expect(isSourceRealizationId(row.realization_id), `realization id: ${row.realization_id}`)
        .toBe(true);
    }
  });

  it("every row has a real title, non-empty creators/topics, and honest availability", () => {
    for (const row of rows) {
      expect(typeof row.canonical_title).toBe("string");
      expect((row.canonical_title ?? "").length).toBeGreaterThan(0);
      const creators = row.creators as unknown[];
      expect(Array.isArray(creators)).toBe(true);
      expect(creators.length).toBeGreaterThan(0);
      for (const creator of creators) expect(typeof creator).toBe("string");
      const topics = row.topics as unknown[];
      expect(Array.isArray(topics)).toBe(true);
      expect(topics.length).toBeGreaterThan(0);
      for (const topic of topics) expect(typeof topic).toBe("string");
      expect(row.availability).toBe("available");
    }
  });

  it("capabilities are non-empty and drawn from the declared frozen set", () => {
    const frozenCapabilities = new Set<string>(CAPABILITIES);
    const seen = new Set<string>();
    for (const row of rows) {
      const capabilities = row.capabilities;
      expect(Array.isArray(capabilities), `row: ${row.realization_id}`).toBe(true);
      const list = capabilities as string[];
      expect(list.length).toBeGreaterThan(0);
      for (const capability of list) {
        expect(frozenCapabilities.has(capability), `capability: ${capability}`).toBe(true);
        seen.add(capability);
      }
    }
    // Exactly what the webflix-catalog connector honors (its declared law).
    expect([...seen].sort()).toEqual(["like", "playEmbed", "playExternal", "save"]);
  });

  it("external_refs match the real YouTube id shape and are unique", () => {
    const refs = new Set<string>();
    for (const row of rows) {
      expect(row.external_ref, `ref: ${row.external_ref}`).toMatch(YOUTUBE_ID_RE);
      expect(refs.has(row.external_ref), `duplicate ref: ${row.external_ref}`).toBe(false);
      refs.add(row.external_ref);
    }
    expect(refs.size).toBe(57);
  });

  it("the stored playback arrays are valid realizations with the REAL URLs", () => {
    for (const row of rows) {
      const playback = row.playback;
      expect(Array.isArray(playback), `row: ${row.realization_id}`).toBe(true);
      const realizations = playback as unknown[];
      expect(realizations).toHaveLength(2);
      const modes = new Set<string>();
      for (const candidate of realizations) {
        const checked = validatePlaybackRealization(candidate);
        expect(checked.ok, `candidate: ${JSON.stringify(candidate)}`).toBe(true);
        if (checked.ok) {
          modes.add(checked.value.mode);
          if (checked.value.mode === "embed") {
            expect(checked.value.url).toBe(`https://www.youtube.com/embed/${row.external_ref}`);
          }
          if (checked.value.mode === "external") {
            expect(checked.value.url).toBe(`https://www.youtube.com/watch?v=${row.external_ref}`);
          }
        }
      }
      expect(modes).toEqual(new Set(["embed", "external"]));
    }
  });
});

describe("catalog seed — the short/long split (the shorts surface)", () => {
  it("is exactly 24 short+vertical and 33 video+horizontal, with no other combination", async () => {
    const split = await first.db.query<{ canonical_type: string; orientation: string; count: string }>(
      `SELECT canonical_type, orientation, COUNT(*) AS count
         FROM entertainment_items GROUP BY canonical_type, orientation ORDER BY canonical_type`,
    );
    expect(
      split.map((row) => ({
        canonical_type: row.canonical_type,
        orientation: row.orientation,
        count: Number(row.count),
      })),
    ).toEqual([
      { canonical_type: "short", orientation: "vertical", count: 24 },
      { canonical_type: "video", orientation: "horizontal", count: 33 },
    ]);
  });

  it("shorts have an honestly-unknown (NULL) duration; longs have positive durations", () => {
    for (const row of rows) {
      if (row.canonical_type === "short") {
        expect(row.duration_ms, `short: ${row.item_id}`).toBeNull();
      } else {
        expect(row.canonical_type).toBe("video");
        expect(Number(row.duration_ms)).toBeGreaterThan(0);
      }
    }
  });
});

describe("catalog seed — deterministic canonical ids (stable across environments)", () => {
  it("every item id's ULID body decodes to the fixed seed instant 2026-09-16", () => {
    for (const row of rows) {
      const body = row.item_id.slice("wfxitm_".length);
      expect(new Date(ulidTimeMs(body)).toISOString(), `id: ${row.item_id}`).toBe(SEED_INSTANT);
    }
  });

  it("a SECOND fresh database converges on the identical catalog", async () => {
    const firstItems = await first.db.query<{ id: string }>(
      "SELECT id FROM entertainment_items ORDER BY id",
    );
    const secondItems = await second.db.query<{ id: string }>(
      "SELECT id FROM entertainment_items ORDER BY id",
    );
    expect(secondItems.map((row) => row.id)).toEqual(firstItems.map((row) => row.id));

    const firstRealizations = await first.db.query<{ id: string; external_ref: string }>(
      "SELECT id, external_ref FROM source_realizations ORDER BY id",
    );
    const secondRealizations = await second.db.query<{ id: string; external_ref: string }>(
      "SELECT id, external_ref FROM source_realizations ORDER BY id",
    );
    expect(secondRealizations).toEqual(firstRealizations);

    // The titles travel with the ids (the full rows, not just keys).
    const firstTitles = await first.db.query<{ id: string; canonical_title: string }>(
      "SELECT id, canonical_title FROM entertainment_items ORDER BY id",
    );
    const secondTitles = await second.db.query<{ id: string; canonical_title: string }>(
      "SELECT id, canonical_title FROM entertainment_items ORDER BY id",
    );
    expect(secondTitles).toEqual(firstTitles);
  });
});

// ---------------------------------------------------------------------------
// R26-W4 — the artwork projection convergence (every boot, idempotent)
// ---------------------------------------------------------------------------

describe("catalog artwork convergence — the connector's thumbnailUrl projection", () => {
  it("the harness baseline is CONVERGED: every webflix-catalog row carries the provider's own artwork address", async () => {
    // The harness applies the SAME convergence steps the service boot
    // performs (createTestDb), so the pass here is a no-op (updated 0 —
    // the idempotency law) and the rows carry the projection.
    const pass = await convergeCatalogArtwork(first.db);
    expect(pass.updated).toBe(0);
    const rows = await first.db.query<{
      external_ref: string;
      metadata: { thumbnailUrl?: string };
    }>(
      `SELECT external_ref, metadata FROM source_realizations
        WHERE connector_id = 'webflix-catalog' ORDER BY external_ref`,
    );
    expect(rows).toHaveLength(57);
    for (const row of rows) {
      expect(row.metadata?.thumbnailUrl).toBe(
        `https://i.ytimg.com/vi/${row.external_ref}/hqdefault.jpg`,
      );
    }
  });

  it("is IDEMPOTENT — a second pass updates nothing (the convergence law)", async () => {
    const pass = await convergeCatalogArtwork(first.db);
    expect(pass.updated).toBe(0);
  });

  it("NEVER OVERWRITES an operator- or connector-written thumbnailUrl", async () => {
    await first.db.query(
      `UPDATE source_realizations
          SET metadata = '{"thumbnailUrl": "https://example.test/operator-artwork.jpg"}'::jsonb
        WHERE external_ref = 'jNQXAC9IVRw'`,
    );
    const pass = await convergeCatalogArtwork(first.db);
    expect(pass.updated).toBe(0);
    const rows = await first.db.query<{ metadata: { thumbnailUrl?: string } }>(
      `SELECT metadata FROM source_realizations WHERE external_ref = 'jNQXAC9IVRw'`,
    );
    expect(rows[0]?.metadata?.thumbnailUrl).toBe("https://example.test/operator-artwork.jpg");
  });

  it("scopes HONESTLY — non-YouTube-shaped refs and other connectors are untouched", async () => {
    await first.db.query(
      `INSERT INTO entertainment_items
         (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics,
          created_at, updated_at)
       VALUES ('wfxitm_01TESTARTWORKSCOPE000001', 'video', 'Scope Test', 60000, 'horizontal',
               '[]'::jsonb, '[]'::jsonb, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    // A webflix-catalog row with a NON-YouTube-shaped ref (a torrent hash,
    // say) — the projection must not fabricate a YouTube URL for it.
    await first.db.query(
      `INSERT INTO source_realizations
         (id, entertainment_item_id, connector_id, external_ref, capabilities, availability,
          playback, created_at, updated_at)
       VALUES ('wfxsrc_01TESTARTWORKSCOPE000001', 'wfxitm_01TESTARTWORKSCOPE000001',
               'webflix-catalog', 'deadbeefcafebabe', '["playNative"]'::jsonb, 'available',
               '[]'::jsonb, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    // A YouTube-shaped ref on ANOTHER connector — out of the projection's
    // authorization boundary.
    await first.db.query(
      `INSERT INTO source_realizations
         (id, entertainment_item_id, connector_id, external_ref, capabilities, availability,
          playback, created_at, updated_at)
       VALUES ('wfxsrc_01TESTARTWORKSCOPE000002', 'wfxitm_01TESTARTWORKSCOPE000001',
               'some-other-connector', 'jNQXAC9IVRw', '["playEmbed"]'::jsonb, 'available',
               '[]'::jsonb, '2026-09-22T00:00:00Z', '2026-09-22T00:00:00Z')`,
    );
    const pass = await convergeCatalogArtwork(first.db);
    expect(pass.updated).toBe(0);
    const rows = await first.db.query<{ connector_id: string; external_ref: string; metadata: unknown }>(
      `SELECT connector_id, external_ref, metadata FROM source_realizations
        WHERE entertainment_item_id = 'wfxitm_01TESTARTWORKSCOPE000001'`,
    );
    for (const row of rows) {
      expect((row.metadata as { thumbnailUrl?: string } | null)?.thumbnailUrl).toBeUndefined();
    }
  });

  it("converges an ALREADY-SEEDED database missing the projection (the production gap's fix)", async () => {
    // Simulate the production DB as the R26 sweep found it: seeded rows
    // carrying NO artwork metadata (the pre-0014 truth).
    await first.db.query(
      `UPDATE source_realizations SET metadata = '{}'::jsonb WHERE connector_id = 'webflix-catalog'`,
    );
    const pass = await convergeCatalogArtwork(first.db);
    expect(pass.updated).toBe(57);
    const rows = await first.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM source_realizations
        WHERE connector_id = 'webflix-catalog' AND metadata ? 'thumbnailUrl'`,
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(57);
  });
});
