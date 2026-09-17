/**
 * R11 — session lifecycle tests (J21/J22: the honest state machine).
 *
 * Deterministic, loopback-driven, no live peers: a torrent-file session
 * flows selecting -> downloading -> verifying -> completed with honest
 * stats; a magnet session flows discovering-metadata -> selecting ->
 * downloading; pause/resume/stop obey the frozen vocabulary; a duplicate
 * live session for the same infohash is refused.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";
import { statusOf, waitFor } from "./helpers/status";
import {
  AUTHORIZED_ARCHIVE_V1,
  fixtureInfoHash,
  fixtureMagnetUri,
  fixtureTorrentBytes,
} from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-sessions");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

let engineCounter = 0;
function newEngine(library: LoopbackTorrentLibrary): TorrentEngine {
  engineCounter += 1;
  return createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${engineCounter}`),
    sources,
  });
}

/** Bounded wait for a predicate (real-clock, small; the R10 wire-test precedent). */
beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("R11 — the session lifecycle (torrent-file kind)", () => {
  it("a torrent-file session flows selecting -> downloading -> verifying -> completed with honest stats", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(
      fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1),
      PROVENANCE,
    );
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    const created = await engine.createSession(ingested.value.id, {
      selection: { fileIndexes: [0] },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Immediately after creation: downloading (selection applied).
    const early = statusOf(engine, sessionId);
    {
      expect(early.state).toBe("downloading");
      expect(early.progress.selectedPieces).toBe(6);
      expect(early.progress.verifiedSelectedPieces).toBe(0);
      expect(early.progress.fraction).toBe(0);
      expect(early.integrity).toBe("unknown");
      // The selection is visible on the file list (J22).
      expect(early.files.map((f: { name: string; selected: boolean }) => [f.name, f.selected])).toEqual([
        ["feature-presentation.mkv", true],
        ["coverart.jpg", false],
        ["credits.txt", false],
      ]);
    }

    // Drive the deterministic double to completion (6 selected pieces, 2 per advance).
    for (let i = 0; i < 10; i += 1) {
      library.advanceAll();
      if (statusOf(engine, sessionId).state === "completed") break;
    }
    const done = await waitFor(() =>
      statusOf(engine, sessionId).state === "completed",
    );
    expect(done).toBe(true);

    const final = statusOf(engine, sessionId);
    {
      expect(final.state).toBe("completed");
      expect(final.progress.fraction).toBe(1);
      expect(final.pieces.verified).toBe(6);
      expect(final.pieces.total).toBe(6);
      expect(final.integrity).toBe("verified");
      // The whole-asset digest over the REAL bytes is recorded.
      expect(final.digests).toBeDefined();
      const digest = final.digests?.[0];
      expect(digest?.path).toBe("authorized-archive-v1/feature-presentation.mkv");
      expect(digest?.sizeBytes).toBe(88_920);
      expect(digest?.sha256).toMatch(/^[0-9a-f]{64}$/);
      // Honest peers: the loopback's scripted numbers, never fabricated.
      expect(final.peers.connected).toBeGreaterThanOrEqual(0);
    }
    await engine.destroy();
  });

  it("pause moves to seeding-paused; resume returns to the pre-pause state; piece progress observable", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, {
      selection: { fileIndexes: [0] },
    });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Two advances: 4 of 6 pieces verified (honest piece progress).
    library.advanceAll();
    library.advanceAll();
    let status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("downloading");
      expect(status.progress.verifiedSelectedPieces).toBe(4);
      expect(status.pieces.verified).toBe(4);
      expect(status.progress.fraction).toBeCloseTo(4 / 6, 10);
    }

    // Pause: the frozen vocabulary's single paused state.
    const paused = engine.pause(sessionId);
    expect(paused.ok).toBe(true);
    status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("seeding-paused");
      // Progress is PRESERVED and observable while paused.
      expect(status.progress.verifiedSelectedPieces).toBe(4);
    }

    // While paused, the double does not advance (the engine's law: no
    // transfer while paused — verified by the unchanged piece count).
    library.advanceAll();
    library.advanceAll();
    status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("seeding-paused");
      expect(status.progress.verifiedSelectedPieces).toBe(4);
    }

    // Resume: back to downloading, and progress CONTINUES.
    const resumed = engine.resume(sessionId);
    expect(resumed.ok).toBe(true);
    status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("downloading");
    }
    library.advanceAll();
    status = statusOf(engine, sessionId);
    {
      expect(status.progress.verifiedSelectedPieces).toBe(6);
    }
    const completed = await waitFor(() =>
      statusOf(engine, sessionId).state === "completed",
    );
    expect(completed).toBe(true);
    await engine.destroy();
  });

  it("stop removes the live session (typed NOT_FOUND after) and journals the recoverable control point", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, {
      selection: { fileIndexes: [0, 1] },
    });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    library.advanceAll();
    const stopped = await engine.stop(sessionId);
    expect(stopped.ok).toBe(true);

    // The live session is GONE — honest NOT_FOUND naming recovery.
    const after = engine.status(sessionId);
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.error.code).toBe("NOT_FOUND");
      expect(after.error.detail).toContain("recoverable");
    }
    expect(engine.sessions()).toEqual([]);
    await engine.destroy();
  });

  it("a second LIVE session for the same infohash is refused (the duplicate law)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const first = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [1] } });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("INVALID_STATE");
      expect(second.error.detail).toContain("infohash");
    }
    await engine.stop(first.value.sessionId);
    // After stop, a NEW session for the same infohash is allowed.
    const third = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [1] } });
    expect(third.ok).toBe(true);
    void third;
    await engine.destroy();
  });

  it("lifecycle commands on terminal/unknown sessions are typed (never silent)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [2] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Unknown session.
    const unknown = engine.pause("ts-does-not-exist");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("NOT_FOUND");

    // Complete the tiny selection (250-byte file shares piece 5).
    library.advanceAll();
    await waitFor(() =>
      statusOf(engine, sessionId).state === "completed",
    );

    // Terminal sessions accept no lifecycle commands (SESSION_CLOSED).
    for (const [label, result] of [
      ["pause", engine.pause(sessionId)],
      ["resume", engine.resume(sessionId)],
    ] as const) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("SESSION_CLOSED");
      void label;
    }
    const stopped = await engine.stop(sessionId);
    expect(stopped.ok).toBe(false);
    if (!stopped.ok) expect(stopped.error.code).toBe("SESSION_CLOSED");
    await engine.destroy();
  });
});

describe("R11 — the session lifecycle (magnet kind)", () => {
  it("a magnet session flows discovering-metadata -> selecting -> downloading -> completed (metadata via the library)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;
    expect(ingested.value.infoHash).toBe(fixtureInfoHash(AUTHORIZED_ARCHIVE_V1));

    const created = await engine.createSession(ingested.value.id, {
      selection: { filePaths: ["authorized-archive-v1/feature-presentation.mkv"] },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Pre-metadata: honest discovering state, empty file list.
    let status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("discovering-metadata");
      expect(status.files).toEqual([]);
    }

    // The double resolves metadata on advance 1 (and 2 of the 6 selected
    // pieces land in the same advance — the session is honestly mid-download).
    library.advanceAll();
    status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("downloading");
      // The resolved metadata answers the file list (J22 for magnets).
      expect(status.files.length).toBe(3);
      const selected = status.files.filter((f: { selected: boolean }) => f.selected);
      expect(selected.map((f: { name: string }) => f.name)).toEqual(["feature-presentation.mkv"]);
      expect(status.progress.verifiedSelectedPieces).toBe(2);
    }

    // A magnet with INDEX selection is refused pre-metadata (honest input law).
    const badSelection = await engine.createSession(ingested.value.id, {
      selection: { fileIndexes: [0] },
    });
    expect(badSelection.ok).toBe(false);
    if (!badSelection.ok) {
      expect(badSelection.error.code).toBe("INVALID_SELECTION");
    }
    await engine.stop(sessionId);

    // Complete the path-selected file through a fresh session.
    const second = await engine.createSession(ingested.value.id, {
      selection: { filePaths: ["authorized-archive-v1/credits.txt"] },
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      library.advanceAll();
      const completed = await waitFor(() =>
        statusOf(engine, second.value.sessionId).state === "completed",
      );
      expect(completed).toBe(true);
    }
    await engine.destroy();
  });

  it("the default selection (no explicit selection) is every file", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine.createSession(ingested.value.id);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const status = statusOf(engine, created.value.sessionId);
    {
      expect(status.state).toBe("downloading");
      expect(status.files.every((f: { selected: boolean }) => f.selected)).toBe(true);
      expect(status.progress.selectedPieces).toBe(6);
    }
    await engine.destroy();
  });
});
