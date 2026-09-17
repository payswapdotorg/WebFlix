/**
 * R11 — the stall law (honest session status).
 *
 * "never 'downloading' for a stalled session (peer count 0 for N minutes
 * answers stalled with the honest numbers)": a downloading session with
 * zero connected peers past the threshold answers `stalled: true` with
 * peers.connected === 0, the stall duration, and honest zero rates —
 * never a fabricated active impression. Stalled clears when peers return;
 * paused sessions never report stalled; the stall clock starts at session
 * start when no peer was ever seen.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine, type TorrentEngine } from "../src/engine";
import { LoopbackTorrentLibrary, scriptLoopbackSession } from "./helpers/loopback-library";
import { statusOf } from "./helpers/status";
import { AUTHORIZED_ARCHIVE_V1, fixtureTorrentBytes } from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-stall");

const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const PROVENANCE = (() => {
  const minted = authorizeProvenance(sources, "vault:family-media");
  if (!minted.ok) throw new Error("fixture provenance must mint");
  return minted.value;
})();

const STALL_THRESHOLD_MS = 5_000;

let engineCounter = 0;
/** A manual clock the test moves — stall math is deterministic. */
let clockMs = 0;

function newEngine(library: LoopbackTorrentLibrary): TorrentEngine {
  engineCounter += 1;
  clockMs = 0;
  return createTorrentEngine({
    library,
    dataRoot: join(TMP, `engine-${engineCounter}`),
    sources,
    clock: () => clockMs,
    stallThresholdMs: STALL_THRESHOLD_MS,
  });
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

async function createDownloadingSession(library: LoopbackTorrentLibrary, engine: TorrentEngine) {
  const ingested = await engine.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
  if (!ingested.ok) throw new Error("ingestion must succeed");
  const created = await engine.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
  if (!created.ok) throw new Error("session must be created");
  return created.value.sessionId;
}

describe("R11 — the honest stall law", () => {
  it("a downloading session with 0 peers past the threshold answers stalled=true with the honest numbers", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    // Attach the script BEFORE creation: the first session on a fresh
    // engine is deterministically ts-1 (the journal is empty).
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", "ts-1", "data"), {
      peersAt: (advance) => (advance <= 2 ? 4 : 0),
      piecesPerAdvance: 0, // the stall law is about peers/time, not progress
    });
    const sessionId = await createDownloadingSession(library, engine);

    library.advanceAll(); // advance 1: peers 4
    library.advanceAll(); // advance 2: peers 4
    let status = statusOf(engine, sessionId);
    {
      expect(status.peers.connected).toBe(4);
      expect(status.stalled).toBe(false);
    }
    // Poll again later: the peer contact keeps the stall clock fresh.
    clockMs += 1_000;
    status = statusOf(engine, sessionId);
    expect(status.stalled).toBe(false);

    // Peers vanish. Under the threshold: still honestly "downloading".
    library.advanceAll(); // advance 3: peers 0
    clockMs += 4_999;
    status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("downloading");
      expect(status.stalled).toBe(false);
      expect(status.peers.connected).toBe(0);
    }

    // Past the threshold: stalled, with the honest numbers.
    clockMs += 2;
    status = statusOf(engine, sessionId);
    {
      expect(status.stalled).toBe(true);
      expect(status.peers.connected).toBe(0);
      expect(status.stallDurationMs).toBeDefined();
      expect(status.stallDurationMs!).toBeGreaterThanOrEqual(STALL_THRESHOLD_MS);
      expect(status.rates.downloadBytesPerSec).toBe(0);
      expect(status.rates.uploadBytesPerSec).toBe(0);
    }
    await engine.destroy();
  });

  it("the stall clock starts at session start when NO peer was ever seen", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDownloadingSession(library, engine);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", sessionId, "data"), {
      peersAt: () => 0, // never any peer
      piecesPerAdvance: 0,
    });

    clockMs += STALL_THRESHOLD_MS - 1;
    let status = statusOf(engine, sessionId);
    expect(status.stalled).toBe(false);
    clockMs += 2;
    status = statusOf(engine, sessionId);
    {
      expect(status.stalled).toBe(true);
      expect(status.peers.connected).toBe(0);
    }
    await engine.destroy();
  });

  it("a session WITH peers never reports stalled (honest negative)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDownloadingSession(library, engine);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", sessionId, "data"), {
      peersAt: () => 7,
      piecesPerAdvance: 0,
    });
    clockMs += STALL_THRESHOLD_MS * 10;
    const status = statusOf(engine, sessionId);
    {
      expect(status.stalled).toBe(false);
      expect(status.peers.connected).toBe(7);
    }
    await engine.destroy();
  });

  it("a paused (seeding-paused) session NEVER reports stalled (paused is honest, not stalled)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDownloadingSession(library, engine);
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", sessionId, "data"), {
      peersAt: () => 0,
      piecesPerAdvance: 0,
    });
    expect(engine.pause(sessionId).ok).toBe(true);
    clockMs += STALL_THRESHOLD_MS * 10;
    const status = statusOf(engine, sessionId);
    {
      expect(status.state).toBe("seeding-paused");
      expect(status.stalled).toBe(false);
    }
    await engine.destroy();
  });

  it("stall clears when peers return (honest recovery)", async () => {
    const library = new LoopbackTorrentLibrary();
    library.registerFixture(AUTHORIZED_ARCHIVE_V1);
    const engine = newEngine(library);
    const sessionId = await createDownloadingSession(library, engine);
    let peerSchedule: (advance: number) => number = () => 0;
    scriptLoopbackSession(join(TMP, `engine-${engineCounter}`, "sessions", sessionId, "data"), {
      peersAt: (advance) => peerSchedule(advance),
      piecesPerAdvance: 0,
    });

    peerSchedule = () => 0;
    clockMs += STALL_THRESHOLD_MS + 1;
    let status = statusOf(engine, sessionId);
    expect(status.stalled).toBe(true);

    // Peers come back (the loopback answers the new schedule on the next
    // advance; a status poll with peers present clears the stall).
    peerSchedule = () => 5;
    library.advanceAll();
    clockMs += 1;
    status = statusOf(engine, sessionId);
    {
      expect(status.stalled).toBe(false);
      expect(status.peers.connected).toBe(5);
    }
    await engine.destroy();
  });
});
