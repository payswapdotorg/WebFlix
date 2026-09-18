/**
 * R13 — the persistence core tests (journal extension + folds + rotation).
 *
 * The crash-safety discipline, extended to the R13 records: torn-write
 * tolerance for `scheduler-checkpoint` and `asset-exposed` lines, replay
 * correctness (the pure folds), the ATOMIC compaction rotation with its
 * fold-equivalence property, and the engine's verified-before-ready gate
 * on exposure recording (the journal is the proof, never the caller).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import {
  createTorrentSessionJournal,
  extractJournalSessions,
  selectCompactionKeepers,
} from "../src/journal";
import {
  extractExposedAssets,
  offlineReadyIdentityKey,
  schedulerRearmInputsFromRecord,
} from "../src/persistence";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";
import { statusOf, waitFor } from "./helpers/status";
import { AUTHORIZED_ARCHIVE_V1, fixtureTorrentBytes } from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-persistence");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

let rootCounter = 0;
function dataRootFor(name: string): string {
  rootCounter += 1;
  const root = join(TMP, `${name}-${rootCounter}`);
  mkdirSync(root, { recursive: true });
  return root;
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A valid 64-hex digest (deterministic; content-irrelevant at this layer). */
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

describe("R13 — scheduler-checkpoint journal records (crash safety)", () => {
  it("appends, replays, and folds LATEST-wins per session", () => {
    const root = dataRootFor("sched-journal");
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    journal.appendSchedulerCheckpoint({
      sessionId: "ts-1",
      schedulerState: "startup",
      fileIndex: 0,
      positionBytes: 0,
      bytesPerSecond: 16_384,
      rangeRequests: [{ offsetBytes: 0, lengthBytes: 4096, deadlineMs: 500, receivedAtMs: 999 }],
      priorities: [{ fromPiece: 0, toPiece: 2, urgency: 5 }],
      reason: "command:start",
    });
    journal.appendSchedulerCheckpoint({
      sessionId: "ts-1",
      schedulerState: "steady",
      fileIndex: 0,
      positionBytes: 49_152,
      bytesPerSecond: 32_768,
      priorities: [{ fromPiece: 3, toPiece: 9, urgency: 3 }],
      reason: "command:progress",
    });

    const views = extractJournalSessions(journal.readAll());
    expect(views.length).toBe(1);
    const checkpoint = views[0]?.schedulerCheckpoint;
    expect(checkpoint?.schedulerState).toBe("steady"); // the LATEST wins
    expect(checkpoint?.positionBytes).toBe(49_152);
    expect(checkpoint?.bytesPerSecond).toBe(32_768);
    expect(checkpoint?.priorities).toEqual([{ fromPiece: 3, toPiece: 9, urgency: 3 }]);
    expect(checkpoint?.rangeRequests).toBeUndefined(); // progress dropped demand
    expect(checkpoint?.reason).toBe("command:progress");
  });

  it("a TORN scheduler-checkpoint tail is dropped; the prior checkpoint replays", () => {
    const root = dataRootFor("torn-sched");
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    journal.appendSchedulerCheckpoint({
      sessionId: "ts-1",
      schedulerState: "steady",
      fileIndex: 0,
      positionBytes: 16_384,
      bytesPerSecond: 16_384,
      reason: "command:progress",
    });
    // A crash mid-append of the NEXT checkpoint leaves a torn final line.
    appendFileSync(journal.path, '{"seq":3,"at":1001,"type":"scheduler-checkpoint","sessionId":"ts-1","schedulerState":"see');

    const restarted = createTorrentSessionJournal(root, { clock: () => 1_000 });
    const views = extractJournalSessions(restarted.readAll());
    const checkpoint = views[0]?.schedulerCheckpoint;
    expect(checkpoint?.schedulerState).toBe("steady");
    expect(checkpoint?.positionBytes).toBe(16_384);
    // The next write repairs the torn tail and lands intact.
    const next = restarted.appendSchedulerCheckpoint({
      sessionId: "ts-1",
      schedulerState: "background-completion",
      reason: "command:stop",
    });
    expect(next.seq).toBe(3); // the torn seq was never landed — no reuse
    expect(restarted.readAll().length).toBe(3);
  });

  it("a MALFORMED checkpoint (garbage state) never parses — only what provably landed replays", () => {
    const root = dataRootFor("garbage-sched");
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    // A complete line whose payload is garbage (not a torn tail — a lie).
    appendFileSync(
      journal.path,
      JSON.stringify({ seq: 2, at: 1, type: "scheduler-checkpoint", sessionId: "ts-1", schedulerState: "warp-9" }) + "\n",
    );
    const views = extractJournalSessions(journal.readAll());
    expect(views[0]?.schedulerCheckpoint).toBeUndefined(); // refused
  });

  it("appendSchedulerCheckpoint validates its inputs (typed throws, never silent garbage)", () => {
    const root = dataRootFor("sched-validate");
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    expect(() =>
      journal.appendSchedulerCheckpoint({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the guard must reject runtime garbage
        schedulerState: "warp-9" as any,
        sessionId: "ts-1",
        reason: "test",
      }),
    ).toThrow();
    expect(() =>
      journal.appendSchedulerCheckpoint({
        sessionId: "ts-1",
        schedulerState: "steady",
        bytesPerSecond: 0, // non-positive velocity maps nothing — refused
        reason: "test",
      }),
    ).toThrow();
    expect(() =>
      journal.appendSchedulerCheckpoint({
        sessionId: "ts-1",
        schedulerState: "steady",
        priorities: [{ fromPiece: 5, toPiece: 2, urgency: 1 }], // inverted range
        reason: "test",
      }),
    ).toThrow();
    expect(journal.readAll().length).toBe(0); // nothing landed
  });
});

describe("R13 — asset-exposed journal records (the exposure fold)", () => {
  function seedExposure(root: string): void {
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    journal.appendCompleted({
      sessionId: "ts-1",
      files: [{ path: "authorized-archive-v1/feature-presentation.mkv", sizeBytes: 88_920, sha256: DIGEST_A }],
    });
    journal.appendAssetExposure({
      sessionId: "ts-1",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
      assets: [
        {
          assetId: "asset-1",
          sourcePath: "authorized-archive-v1/feature-presentation.mkv",
          contentPath: join(root, "store", "assets", "asset-1", "content.bin"),
          sizeBytes: 88_920,
          sha256: DIGEST_A,
          contentType: "video/x-matroska",
        },
      ],
    });
  }

  it("the fold answers one exposure per identity key — LATEST wins (no duplicate canonical identity)", () => {
    const root = dataRootFor("exposure-fold");
    seedExposure(root);
    const journal = createTorrentSessionJournal(root, { clock: () => 2_000 });
    // A SECOND exposure of the SAME canonical identity from another session
    // (the cross-source realization replacement analog of R04's law).
    journal.appendSessionStarted({
      sessionId: "ts-2",
      ingestionKind: "torrent-file",
      infoHash: "b".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-2", "data"),
      selection: [0],
    });
    journal.appendCompleted({
      sessionId: "ts-2",
      files: [{ path: "other/file.mkv", sizeBytes: 100, sha256: DIGEST_B }],
    });
    journal.appendAssetExposure({
      sessionId: "ts-2",
      infoHash: "b".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
      assets: [
        {
          assetId: "asset-2",
          sourcePath: "other/file.mkv",
          contentPath: join(root, "store", "assets", "asset-2", "content.bin"),
          sizeBytes: 100,
          sha256: DIGEST_B,
        },
      ],
    });
    const exposures = extractExposedAssets(journal.readAll());
    expect(exposures.length).toBe(1); // ONE entry per canonical identity
    expect(exposures[0]?.sessionId).toBe("ts-2"); // the LATEST realization wins
    expect(exposures[0]?.infoHash).toBe("b".repeat(40));
    expect(exposures[0]?.assets[0]?.sha256).toBe(DIGEST_B);
    expect(exposures[0]?.library).toEqual({ profileKey: "user:42", canonicalItemId: "item-7" });
  });

  it("canonical and session-scoped identities never collide (honest separation)", () => {
    expect(offlineReadyIdentityKey({ sessionId: "ts-1" })).toBe("session:ts-1");
    expect(
      offlineReadyIdentityKey({ sessionId: "ts-1", library: { profileKey: "p", canonicalItemId: "i" } }),
    ).toBe("canonical:p::i");
  });

  it("a TORN asset-exposed tail never surfaces — a crashed exposure is not an exposure", () => {
    const root = dataRootFor("torn-exposure");
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    // The crash mid-exposure-append: a torn final line.
    appendFileSync(journal.path, '{"seq":2,"at":1,"type":"asset-exposed","sessionId":"ts-1","infoHash":"aa","prov');
    expect(extractExposedAssets(journal.readAll())).toEqual([]); // all-or-nothing
  });

  it("appendAssetExposure validates its inputs (typed throws; nothing lands)", () => {
    const root = dataRootFor("exposure-validate");
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    expect(() =>
      journal.appendAssetExposure({
        sessionId: "ts-1",
        infoHash: "a".repeat(40),
        provenance: { sourceId: "vault:family-media", basis: "user-owned" },
        assets: [], // an empty batch is not an exposure
      }),
    ).toThrow();
    expect(() =>
      journal.appendAssetExposure({
        sessionId: "ts-1",
        infoHash: "a".repeat(40),
        provenance: { sourceId: "vault:family-media", basis: "user-owned" },
        assets: [
          {
            assetId: "asset-1",
            sourcePath: "x",
            contentPath: "y",
            sizeBytes: 10,
            sha256: "not-hex", // a digest must be 64 lowercase hex
          },
        ],
      }),
    ).toThrow();
    expect(journal.readAll().length).toBe(0);
  });
});

describe("R13 — the ATOMIC compaction rotation", () => {
  function richJournal(root: string): ReturnType<typeof createTorrentSessionJournal> {
    const journal = createTorrentSessionJournal(root, { clock: () => 1_000 });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    journal.appendState({ sessionId: "ts-1", from: "selecting", to: "downloading" });
    journal.appendState({ sessionId: "ts-1", from: "downloading", to: "seeding-paused" });
    journal.appendCheckpoint({ sessionId: "ts-1", bitfield: new Uint8Array([0b10000000]), verifiedPieces: 1, downloadedBytes: 16_384 });
    journal.appendCheckpoint({ sessionId: "ts-1", bitfield: new Uint8Array([0b11000000]), verifiedPieces: 2, downloadedBytes: 32_768 });
    journal.appendSchedulerCheckpoint({ sessionId: "ts-1", schedulerState: "steady", positionBytes: 1, bytesPerSecond: 2, reason: "command:progress" });
    journal.appendSchedulerCheckpoint({ sessionId: "ts-1", schedulerState: "seeking", seekTargetBytes: 9, reason: "command:seek" });
    journal.appendEvidence("noise-1");
    journal.appendEvidence("noise-2");
    journal.appendCompleted({
      sessionId: "ts-1",
      files: [{ path: "f", sizeBytes: 1, sha256: DIGEST_A }],
    });
    journal.appendAssetExposure({
      sessionId: "ts-1",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      assets: [
        { assetId: "asset-1", sourcePath: "f", contentPath: "c", sizeBytes: 1, sha256: DIGEST_A },
      ],
    });
    journal.appendStopped("ts-1");
    return journal;
  }

  it("FOLD-EQUIVALENCE (the tested property): compaction changes the file, never the folds", () => {
    const root = dataRootFor("compaction");
    const journal = richJournal(root);
    const before = journal.readAll();
    const beforeSessions = extractJournalSessions(before);
    const beforeExposures = extractExposedAssets(before);

    const outcome = journal.compact();
    expect(outcome.dropped).toBeGreaterThan(0); // evidence + superseded history
    const after = journal.readAll();
    expect(after.length).toBeLessThan(before.length);

    // THE PROPERTY: identical session + exposure views.
    expect(extractJournalSessions(after)).toEqual(beforeSessions);
    expect(extractExposedAssets(after)).toEqual(beforeExposures);
    // The terminal fact + the exposure audit trail + the session basis stay.
    expect(after.some((r) => r.type === "session-completed")).toBe(true);
    expect(after.some((r) => r.type === "asset-exposed")).toBe(true);
    expect(after.some((r) => r.type === "session-started")).toBe(true);
    expect(after.some((r) => r.type === "session-stopped")).toBe(true);
    // Superseded checkpoints are gone; the LATEST of each kind stays.
    const states = after.filter((r) => r.type === "state-changed");
    expect(states.length).toBe(1);
    expect(states[0]?.type === "state-changed" ? states[0].to : "").toBe("seeding-paused");
    const sched = after.filter((r) => r.type === "scheduler-checkpoint");
    expect(sched.length).toBe(1);
    expect(sched[0]?.type === "scheduler-checkpoint" ? sched[0].schedulerState : "").toBe("seeking");
    // Engine evidence never survives a compaction.
    expect(after.some((r) => r.type === "engine-evidence")).toBe(false);
  });

  it("the rewrite is ATOMIC: a leftover .compact.tmp never affects reads; idempotent when nothing is superseded", () => {
    const root = dataRootFor("atomic");
    const journal = richJournal(root);
    journal.compact();
    const compacted = journal.readAll().length;
    // A stale temp file (simulating a crash MID-rewrite of a LATER compaction).
    writeFileSync(`${journal.path}.compact.tmp`, '{"seq":99,"at":1,"type":"engine-evi');
    const restarted = createTorrentSessionJournal(root, { clock: () => 1_000 });
    expect(restarted.readAll().length).toBe(compacted); // untouched by the tmp
    // A no-op compaction does not rewrite (nothing superseded).
    const outcome = restarted.compact();
    expect(outcome.dropped).toBe(0);
    expect(existsSync(`${journal.path}.compact.tmp`)).toBe(true); // stale tmp stays ignored
    // Sequence continuity survives the rotation (no seq reuse: the next
    // record is max-landed-seq + 1, regardless of gaps compaction left).
    const maxLandedSeq = Math.max(...restarted.readAll().map((record) => record.seq));
    const next = restarted.appendEvidence("after-compaction");
    expect(next.seq).toBe(maxLandedSeq + 1);
    // The stale tmp is eventually overwritten by the next real compaction.
    journal.compact();
  });

  it("selectCompactionKeepers is PURE (the record list is never mutated)", () => {
    const root = dataRootFor("pure-keepers");
    const journal = richJournal(root);
    const before = journal.readAll().slice();
    selectCompactionKeepers(journal.readAll());
    expect(journal.readAll()).toEqual(before);
  });
});

describe("R13 — the re-arm input validation (total for garbage)", () => {
  function checkpoint(overrides: Record<string, unknown>): { seq: number; at: number; type: "scheduler-checkpoint"; sessionId: string; schedulerState: string; reason: string } {
    return {
      seq: 1,
      at: 1,
      type: "scheduler-checkpoint",
      sessionId: "ts-1",
      schedulerState: "steady",
      reason: "command:progress",
      ...overrides,
    } as { seq: number; at: number; type: "scheduler-checkpoint"; sessionId: string; schedulerState: string; reason: string };
  }

  it("a well-formed checkpoint yields validated re-arm inputs", () => {
    const inputs = schedulerRearmInputsFromRecord({
      ...checkpoint({}),
      fileIndex: 0,
      positionBytes: 1_000,
      bytesPerSecond: 16_384,
      rangeRequests: [{ offsetBytes: 0, lengthBytes: 4, deadlineMs: 5, receivedAtMs: 6 }],
    } as Parameters<typeof schedulerRearmInputsFromRecord>[0]);
    expect(inputs.ok).toBe(true);
    if (!inputs.ok) return;
    expect(inputs.value.schedulerState).toBe("steady");
    expect(inputs.value.positionBytes).toBe(1_000);
    expect(inputs.value.rangeRequests.length).toBe(1);
  });

  it("malformed checkpoints are TYPED rejections (never silent skips)", () => {
    const badState = schedulerRearmInputsFromRecord(checkpoint({ schedulerState: "warp-9" }) as Parameters<typeof schedulerRearmInputsFromRecord>[0]);
    expect(badState.ok).toBe(false);
    if (badState.ok) return;
    expect(badState.error.code).toBe("INVALID_INPUT");

    const idle = schedulerRearmInputsFromRecord(checkpoint({ schedulerState: "idle" }) as Parameters<typeof schedulerRearmInputsFromRecord>[0]);
    expect(idle.ok).toBe(false);
    if (idle.ok) return;
    expect(idle.error.detail).toContain("no playback intent");

    const badVelocity = schedulerRearmInputsFromRecord(checkpoint({ bytesPerSecond: 0 }) as Parameters<typeof schedulerRearmInputsFromRecord>[0]);
    expect(badVelocity.ok).toBe(false);
  });
});

describe("R13 — the engine's verified-before-ready gate on exposure recording", () => {
  async function completedEngine(): Promise<{ engine: TorrentEngine; library: LoopbackTorrentLibrary; sessionId: string; root: string }> {
    const root = dataRootFor("gate");
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = createTorrentEngine({ library, dataRoot: root, sources });
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) throw new Error("ingestion must succeed");
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) throw new Error("session must create");
    for (let i = 0; i < 10; i += 1) library.advanceAll();
    await waitFor(() => statusOf(engine, created.value.sessionId).state === "completed");
    return { engine, library, sessionId: created.value.sessionId, root };
  }

  it("a NON-completed session's assets are refused (typed INVALID_STATE — never exposed)", async () => {
    const root = dataRootFor("gate-incomplete");
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = createTorrentEngine({ library, dataRoot: root, sources });
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library.advanceAll(); // downloading, NOT completed
    const outcome = engine.recordAssetExposure({
      sessionId: created.value.sessionId,
      assets: [
        {
          assetId: "asset-x",
          sourcePath: "authorized-archive-v1/feature-presentation.mkv",
          contentPath: "nowhere",
          sizeBytes: 88_920,
          sha256: DIGEST_A,
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("INVALID_STATE");
    expect(outcome.error.detail).toContain("verified-before-ready");
    expect(engine.exposedAssets()).toEqual([]); // nothing landed
    await engine.destroy();
  });

  it("a digest that contradicts the journal's completion record is refused (typed)", async () => {
    const { engine, sessionId } = await completedEngine();
    const outcome = engine.recordAssetExposure({
      sessionId,
      assets: [
        {
          assetId: "asset-x",
          sourcePath: "authorized-archive-v1/feature-presentation.mkv",
          contentPath: "nowhere",
          sizeBytes: 88_920,
          sha256: DIGEST_A, // NOT the digest the journal proved
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("INVALID_STATE");
    expect(outcome.error.detail).toContain("digest cross-check FAILED");
    expect(engine.exposedAssets()).toEqual([]);
    await engine.destroy();
  });

  it("a MATCHING digest records the exposure — with the JOURNALED provenance + infohash", async () => {
    const { engine, sessionId } = await completedEngine();
    const status = statusOf(engine, sessionId);
    const digest = status.digests?.[0];
    expect(digest).toBeDefined();
    if (digest === undefined) return;
    const outcome = engine.recordAssetExposure({
      sessionId,
      assets: [
        {
          assetId: "asset-ok",
          sourcePath: digest.path,
          contentPath: "/store/assets/asset-ok/content.bin",
          sizeBytes: digest.sizeBytes,
          sha256: digest.sha256,
          contentType: "video/x-matroska",
        },
      ],
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.infoHash).toBe(status.infoHash);
    expect(outcome.value.provenance.sourceId).toBe("vault:family-media"); // the journal's fact
    expect(outcome.value.provenance.basis).toBe("user-owned");
    expect(outcome.value.library).toEqual({ profileKey: "user:42", canonicalItemId: "item-7" });
    expect(engine.exposedAssets().length).toBe(1);
    await engine.destroy();
  });

  it("a journal reading survives the RESTART (durable exposures fold from disk truth)", async () => {
    const { engine, library, sessionId, root } = await completedEngine();
    const status = statusOf(engine, sessionId);
    const digest = status.digests?.[0];
    if (digest === undefined) return;
    const outcome = engine.recordAssetExposure({
      sessionId,
      assets: [
        {
          assetId: "asset-ok",
          sourcePath: digest.path,
          contentPath: "/store/assets/asset-ok/content.bin",
          sizeBytes: digest.sizeBytes,
          sha256: digest.sha256,
        },
      ],
    });
    expect(outcome.ok).toBe(true);
    void library;
    await engine.destroy();

    // RESTART: a fresh engine over the same dataRoot sees the same exposure.
    const library2 = new LoopbackTorrentLibrary();
    library2.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const exposures = engine2.exposedAssets();
    expect(exposures.length).toBe(1);
    expect(exposures[0]?.sessionId).toBe(sessionId);
    expect(exposures[0]?.assets[0]?.sha256).toBe(digest.sha256);
    await engine2.destroy();
  });

  it("malformed exposure inputs are typed rejections (never journal garbage)", async () => {
    const { engine, sessionId } = await completedEngine();
    const empty = engine.recordAssetExposure({ sessionId, assets: [] });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe("INVALID_INPUT");
    const unknown = engine.recordAssetExposure({
      sessionId: "ts-nope",
      assets: [
        { assetId: "a", sourcePath: "x", contentPath: "y", sizeBytes: 1, sha256: DIGEST_A },
      ],
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.code).toBe("NOT_FOUND");
    await engine.destroy();
  });
});
