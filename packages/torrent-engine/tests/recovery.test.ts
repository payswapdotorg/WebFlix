/**
 * R11 — recovery (the R10 journal-replay discipline, mirrored).
 *
 * After a stop/crash/restart, the engine's `recover()` replays the journal
 * and rebuilds every recoverable session. HONEST FAILURE for vanished
 * state: a session whose data directory disappeared is `failed` with the
 * `DATA_VANISHED` evidence — never a silent restart from zero pretending
 * continuity.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTorrentEngine,
} from "../src/engine";
import { LoopbackBitTorrentBackend, type LoopbackFixture } from "../src/backend";
import { provenanceFromAuthorizedSource } from "../src/provenance";

const FIXTURES = join(import.meta.dir, "fixtures");
const TORRENT_BYTES = new Uint8Array(readFileSync(join(FIXTURES, "sintel-single.torrent")));
const SUMMARY = JSON.parse(readFileSync(join(FIXTURES, "sintel-single.summary.json"), "utf8")) as {
  infoHash: string;
  name: string;
  pieceLength: number;
  pieceCount: number;
  totalBytes: number;
  pieceSha1Hex: string[];
};
const FIXTURE_BYTES = new Uint8Array(readFileSync(join(FIXTURES, "sintel-single.bin")));

let tmpRoot: string;

function makeFixture(): LoopbackFixture {
  const pieces = SUMMARY.pieceSha1Hex.map((hex) => new Uint8Array(Buffer.from(hex, "hex")));
  return {
    infoHash: SUMMARY.infoHash,
    name: SUMMARY.name,
    pieceLengthBytes: SUMMARY.pieceLength,
    pieces,
    files: [
      {
        path: SUMMARY.name,
        lengthBytes: SUMMARY.totalBytes,
        bytes: FIXTURE_BYTES,
        playableHint: true,
      },
    ],
    peerCount: 5,
  };
}

function makeProvenance() {
  return provenanceFromAuthorizedSource({
    sourceId: "personal-vault",
    authorizationKind: "authorized-vault",
  });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "wfx-r11-recovery-"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("R11 — recovery (journal replay after restart)", () => {
  it("recover() returns an empty report when the journal is empty", async () => {
    const backend = new LoopbackBitTorrentBackend();
    backend.registerFixture(makeFixture());
    const engine = createTorrentEngine({
      dataRoot: tmpRoot,
      backend,
      sessionIdGenerator: () => "session-x",
    });
    const report = await engine.recover();
    expect(report.sessions).toEqual([]);
  });

  it("recover() rebuilds a journaled session that was not stopped", async () => {
    // Phase 1: ingest + select, then dispose the engine (simulating a crash).
    const backend1 = new LoopbackBitTorrentBackend();
    backend1.registerFixture(makeFixture());
    const engine1 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend1,
      sessionIdGenerator: () => "session-1",
    });
    await engine1.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    await engine1.selectFiles("session-1", [SUMMARY.name]);
    await engine1.pause("session-1");
    await engine1.dispose();
    // Phase 2: re-create the engine (restart) — the journal persists.
    const backend2 = new LoopbackBitTorrentBackend();
    backend2.registerFixture(makeFixture());
    const engine2 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend2,
      sessionIdGenerator: () => "session-2", // a different id for new sessions
    });
    const report = await engine2.recover();
    expect(report.sessions.length).toBe(1);
    expect(report.sessions[0]?.sessionId).toBe("session-1");
    expect(report.sessions[0]?.recovered).toBe(true);
    // The recovered session is live again — observe it.
    const observation = engine2.observe("session-1");
    expect(observation).toBeDefined();
    // Recovery re-enters as `checking` (the engine re-verifies the
    // persisted piece map against the local bytes). This is the honest
    // re-entry state — the engine never claims continuity it cannot prove.
    expect(observation?.state === "checking" || observation?.state === "downloading").toBe(true);
  });

  it("recover() reports a vanished-data session as failed (DATA_VANISHED)", async () => {
    // Phase 1: ingest + select, then dispose the engine.
    const backend1 = new LoopbackBitTorrentBackend();
    backend1.registerFixture(makeFixture());
    const engine1 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend1,
      sessionIdGenerator: () => "session-1",
    });
    await engine1.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    await engine1.selectFiles("session-1", [SUMMARY.name]);
    await engine1.dispose();
    // Phase 2: delete the session's data directory (simulating disk loss).
    const sessionDir = join(tmpRoot, "sessions", "session-1");
    expect(existsSync(sessionDir)).toBe(true);
    rmSync(sessionDir, { recursive: true, force: true });
    // Phase 3: re-create the engine — recover() should report DATA_VANISHED.
    const backend2 = new LoopbackBitTorrentBackend();
    backend2.registerFixture(makeFixture());
    const engine2 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend2,
      sessionIdGenerator: () => "session-2",
    });
    const report = await engine2.recover();
    expect(report.sessions.length).toBe(1);
    expect(report.sessions[0]?.recovered).toBe(false);
    expect(report.sessions[0]?.failure?.code).toBe("DATA_VANISHED");
    expect(report.sessions[0]?.failure?.detail).toContain("vanished");
    expect(report.sessions[0]?.failure?.detail).toContain("never a silent restart");
  });

  it("recover() excludes a session that was stopped (the control law)", async () => {
    const backend1 = new LoopbackBitTorrentBackend();
    backend1.registerFixture(makeFixture());
    const engine1 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend1,
      sessionIdGenerator: () => "session-1",
    });
    await engine1.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    await engine1.selectFiles("session-1", [SUMMARY.name]);
    await engine1.remove("session-1", false); // stop = stop control record
    await engine1.dispose();
    const backend2 = new LoopbackBitTorrentBackend();
    backend2.registerFixture(makeFixture());
    const engine2 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend2,
      sessionIdGenerator: () => "session-2",
    });
    const report = await engine2.recover();
    expect(report.sessions).toEqual([]); // stopped → not recoverable
  });

  it("recover() preserves the provenance audit trail", async () => {
    const backend1 = new LoopbackBitTorrentBackend();
    backend1.registerFixture(makeFixture());
    const engine1 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend1,
      sessionIdGenerator: () => "session-1",
    });
    await engine1.ingestTorrentFile(TORRENT_BYTES, makeProvenance());
    await engine1.dispose();
    const backend2 = new LoopbackBitTorrentBackend();
    backend2.registerFixture(makeFixture());
    const engine2 = createTorrentEngine({
      dataRoot: tmpRoot,
      backend: backend2,
      sessionIdGenerator: () => "session-2",
    });
    const report = await engine2.recover();
    expect(report.sessions.length).toBe(1);
    // The recovered session's provenance survived (invariant 5's audit trail).
    engine2.observe("session-1");
    // The engine's observation surface does not directly expose provenance;
    // verify the journal carried it by re-reading the journal file.
    const journalPath = join(tmpRoot, "torrent-journal.ndjson");
    const journalText = readFileSync(journalPath, "utf8");
    expect(journalText).toContain("personal-vault");
    expect(journalText).toContain("authorized-vault");
  });
});
