/**
 * R26-W4 — the media-intelligence derived-artifact store tests
 * (PGlite, real Postgres).
 *
 * Pins migration 0014's `media_intelligence_artifacts` table + the
 * `PostgresMediaIntelligenceStore`'s honest lifecycle:
 *
 * - the table exists with the honest shape (the derivation_status CHECK
 *   enforced at the DB boundary too);
 * - SAVE/UPSERT: a derived set round-trips (jsonb verbatim); a
 *   re-derivation replaces the set while keeping the row key; the
 *   same-item structural law rejects a mismatched artifacts.itemId
 *   (typed invalid-input, never a silent fix);
 * - THE HONEST LIFECYCLE: a read for an item with no row answers null
 *   (never derived yet); a `derivation-failed` row answers ITS recorded
 *   sentence + the honest empty artifact set; the derived set excludes
 *   failed rows (they are per-item truths, not index content);
 * - stage outcomes round-trip (the prerequisite truth);
 * - FK integrity: a row for an unknown item is rejected by the database.
 *
 * Determinism: FixedClock; a manually-inserted catalog row (the package
 * harness keeps a PRISTINE catalog — the 052 decision record).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { FixedClock } from "@wfx/experience";
import type { MediaIntelligenceArtifacts } from "@wfx/model-fabric";

import { PersistenceError, PostgresMediaIntelligenceStore } from "../src/index";
import { createTestDb, type TestDb } from "./test-db";

const CLOCK_START = Date.UTC(2026, 8, 22, 12, 0, 0);
const ITEM = "wfxitm_01ARZ3NDEKF1XTVRE0000000001";
const ITEM_B = "wfxitm_01ARZ3NDEKF1XTVRE0000000002";

/** One honest partial artifact set (source-provided index only). */
function artifactSetOf(itemId: string): MediaIntelligenceArtifacts {
  return {
    itemId,
    semanticIndex: {
      kind: "semantic-index",
      itemId,
      entries: [
        {
          text: "A space documentary about patience and a telescope.",
          language: "en",
          span: null,
          source: "metadata",
        },
      ],
      buildProvenance: [
        {
          stage: "source-media",
          modelId: "source-provided",
          confidence: 1,
          producedAt: "2026-09-22T12:00:00.000Z",
        },
      ],
    },
  };
}

let test: TestDb;
let clock: FixedClock;
let store: PostgresMediaIntelligenceStore;

beforeAll(async () => {
  test = await createTestDb();
  clock = new FixedClock(CLOCK_START);
  store = new PostgresMediaIntelligenceStore({ db: test.db, clock });
  // The catalog rows the store's FK requires (the package harness keeps a
  // pristine catalog — inserted here, not seeded).
  for (const [id, title] of [
    [ITEM, "Deep Field Diary"],
    [ITEM_B, "Asteroid Drift"],
  ] as const) {
    await test.db.query(
      `INSERT INTO entertainment_items
         (id, canonical_type, canonical_title, duration_ms, orientation, creators, topics,
          created_at, updated_at)
       VALUES ($1, 'video', $2, 60000, 'horizontal', '[]'::jsonb, '[]'::jsonb,
               '2026-09-16T00:00:00Z', '2026-09-16T00:00:00Z')`,
      [id, title],
    );
  }
});

afterAll(async () => {
  await test.close();
});

describe("PostgresMediaIntelligenceStore — the honest lifecycle", () => {
  it("answers null for an item the pipeline has not derived yet (the honest absence)", async () => {
    expect(await store.artifactsOf(ITEM)).toBeNull();
    expect(await store.artifactsOf("")).toBeNull();
  });

  it("saves a derived set that round-trips verbatim (jsonb + stage outcomes)", async () => {
    const saved = await store.saveDerivedArtifacts({
      itemId: ITEM,
      artifacts: artifactSetOf(ITEM),
      audioStreamLegallyAvailable: false,
      stageOutcomes: [
        {
          stage: "transcription",
          outcome: "skipped-prerequisite-missing",
          detail: "no server-fetchable audio realization (the honest truth)",
        },
        {
          stage: "semantic-index",
          outcome: "derived",
          detail: "the canonical semantic index folded (1 entries)",
        },
      ],
    });
    expect(saved.itemId).toBe(ITEM);
    expect(saved.derivationStatus).toBe("derived");
    expect(saved.audioStreamLegallyAvailable).toBe(false);
    expect(saved.artifacts.semanticIndex?.entries[0]?.text).toBe(
      "A space documentary about patience and a telescope.",
    );
    expect(saved.artifacts.semanticIndex?.buildProvenance[0]?.modelId).toBe("source-provided");
    expect(saved.stageOutcomes).toHaveLength(2);
    expect(saved.stageOutcomes[0]?.outcome).toBe("skipped-prerequisite-missing");
    expect(saved.derivedAt).toBe(new Date(CLOCK_START).toISOString());

    const read = await store.artifactsOf(ITEM);
    expect(read?.derivationStatus).toBe("derived");
    expect(read?.artifacts.itemId).toBe(ITEM);
    expect(read?.stageOutcomes).toHaveLength(2);
  });

  it("re-derivation replaces the set while keeping the row key (the upsert law)", async () => {
    clock.advance(60_000);
    const rederived = await store.saveDerivedArtifacts({
      itemId: ITEM,
      artifacts: {
        ...artifactSetOf(ITEM),
        transcript: {
          kind: "transcript",
          language: "en",
          segments: [
            { startMs: 0, endMs: 5000, text: "First light.", language: "en", speakerLabel: "Narrator" },
          ],
          model: {
            stage: "transcription",
            modelId: "open-model:moss-transcribe-diarize",
            modelRevision: "research-2026-09-20",
            confidence: 0.94,
            producedAt: new Date(CLOCK_START).toISOString(),
          },
        },
      },
      audioStreamLegallyAvailable: true,
      stageOutcomes: [
        { stage: "transcription", outcome: "derived", detail: "1 segment", modelId: "open-model:moss-transcribe-diarize" },
      ],
    });
    expect(rederived.artifacts.transcript?.segments[0]?.text).toBe("First light.");
    expect(rederived.audioStreamLegallyAvailable).toBe(true);
    expect(rederived.derivedAt).toBe(new Date(CLOCK_START + 60_000).toISOString());
    // ONE row — the re-derivation upserted, never duplicated.
    const rows = await test.db.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM media_intelligence_artifacts WHERE item_id = $1",
      [ITEM],
    );
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it("rejects a set whose own itemId mismatches the row key (the same-item law)", async () => {
    expect.assertions(3);
    try {
      await store.saveDerivedArtifacts({
        itemId: ITEM,
        artifacts: artifactSetOf(ITEM_B),
        audioStreamLegallyAvailable: false,
        stageOutcomes: [],
      });
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(PersistenceError);
      expect((thrown as PersistenceError).kind).toBe("invalid-input");
      expect((thrown as PersistenceError).message).toContain("artifacts.itemId");
    }
  });

  it("records an honest failed derivation that answers ITS recorded sentence", async () => {
    const failed = await store.recordFailedDerivation({
      itemId: ITEM_B,
      detail: "the derived artifact set failed the frozen R23-F validation (transcript.segments[0]: invalid segment shape)",
      stageOutcomes: [
        { stage: "transcription", outcome: "failed", detail: "the runtime answer failed the segment shapes" },
      ],
    });
    expect(failed.derivationStatus).toBe("derivation-failed");
    expect(failed.derivationDetail).toContain("failed the frozen R23-F validation");
    expect(failed.artifacts.itemId).toBe(ITEM_B);
    expect(failed.artifacts.transcript).toBeUndefined();
    expect(failed.audioStreamLegallyAvailable).toBe(false);

    // The derived set EXCLUDES failed rows (per-item truths, not index content).
    const derived = await store.derivedSet();
    expect(derived.some((row) => row.itemId === ITEM_B)).toBe(false);
    expect(derived.some((row) => row.itemId === ITEM)).toBe(true);
  });

  it("rejects a failed-derivation record without an honest sentence", async () => {
    expect.assertions(2);
    try {
      await store.recordFailedDerivation({ itemId: ITEM_B, detail: "", stageOutcomes: [] });
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(PersistenceError);
      expect((thrown as PersistenceError).kind).toBe("invalid-input");
    }
  });

  it("enforces the FK: a row for an unknown item is rejected by the database", async () => {
    await expect(
      store.saveDerivedArtifacts({
        itemId: "wfxitm_01ARZ3NDEKF1XTVRE0000000999",
        artifacts: artifactSetOf("wfxitm_01ARZ3NDEKF1XTVRE0000000999"),
        audioStreamLegallyAvailable: false,
        stageOutcomes: [],
      }),
    ).rejects.toThrow();
  });

  it("enforces the derivation_status CHECK at the DB boundary", async () => {
    await expect(
      test.db.query(
        `INSERT INTO media_intelligence_artifacts
           (item_id, artifacts, derivation_status, derived_at, updated_at)
         VALUES ($1, '{}'::jsonb, 'garbage', '2026-09-22T12:00:00Z', '2026-09-22T12:00:00Z')`,
        [ITEM],
      ),
    ).rejects.toThrow();
  });
});
