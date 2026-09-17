/**
 * R11 — the recovery journal (the R10 discipline mirrored).
 *
 * The append-only `torrent-journal.ndjson` log: every ingest + control +
 * state transition is journaled; recovery replays it; a torn tail is
 * dropped (every record that provably landed replays); a session whose
 * data directory vanished is `failed` honestly (`DATA_VANISHED`), never
 * a silent restart from zero.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTorrentJournal,
  extractRecoverableSessions,
  type JournalRecord,
} from "../src/journal";
import { provenanceFromAuthorizedSource } from "../src/provenance";
import type { TorrentMetadata } from "../src/metadata";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "wfx-r11-journal-"));
});

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

function fakeMetadata(infoHash: string = "0d027de7aa0e4acad3b984ac860c8a16caa734b9"): TorrentMetadata {
  return {
    infoHash,
    name: "sintel-trailer.mp4",
    pieceLengthBytes: 16 * 1024,
    pieceCount: 4,
    pieces: [new Uint8Array(20), new Uint8Array(20), new Uint8Array(20), new Uint8Array(20)],
    totalBytes: 64 * 1024,
    files: [{ path: "sintel-trailer.mp4", lengthBytes: 64 * 1024, offsetBytes: 0, playableHint: true }],
    trackers: ["udp://tracker.example:1337"],
    dhtEnabled: false,
    sourceKind: "torrent-file",
  };
}

function fakeProvenance() {
  return provenanceFromAuthorizedSource({
    sourceId: "vault-1",
    authorizationKind: "authorized-vault",
    context: { vaultPath: "/nas/media" },
  });
}

describe("R11 — the recovery journal", () => {
  it("createTorrentJournal creates the root + an empty journal", () => {
    const journal = createTorrentJournal(tmpRoot);
    expect(existsSync(journal.path)).toBe(false); // no records yet → no file
    expect(journal.readAll()).toEqual([]);
    expect(journal.recoverableSessions()).toEqual([]);
    expect(journal.nextSeq()).toBe(1);
  });

  it("appendIngest writes the first record with seq=1", () => {
    const journal = createTorrentJournal(tmpRoot);
    const record = journal.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    expect(record.seq).toBe(1);
    expect(record.type).toBe("ingest");
    expect(record.sessionId).toBe("session-1");
    expect(record.provenance.sourceId).toBe("vault-1");
    expect(record.metadata.name).toBe("sintel-trailer.mp4");
    expect(existsSync(journal.path)).toBe(true);
    // The seed: nextSeq advances past what landed.
    const recreated = createTorrentJournal(tmpRoot);
    expect(recreated.nextSeq()).toBe(2);
  });

  it("appendControl + appendState record the session lifecycle", () => {
    const journal = createTorrentJournal(tmpRoot);
    journal.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    journal.appendControl({
      sessionId: "session-1",
      kind: "select-files",
      verifiedPieces: 0,
      state: "checking",
      detail: "sintel-trailer.mp4",
    });
    journal.appendState({
      sessionId: "session-1",
      state: "downloading",
      verifiedPieces: 2,
      totalPieces: 4,
      peerCount: 5,
      integrity: "unknown",
      evidence: { reason: "download-started" },
    });
    journal.appendControl({
      sessionId: "session-1",
      kind: "pause",
      verifiedPieces: 2,
      state: "paused",
    });
    const records = journal.readAll();
    expect(records.length).toBe(4);
    expect(records[0]?.type).toBe("ingest");
    expect(records[1]?.type).toBe("control");
    expect(records[2]?.type).toBe("state");
    expect(records[3]?.type).toBe("control");
  });

  it("extractRecoverableSessions recovers a non-stopped, non-terminal session", () => {
    const journal = createTorrentJournal(tmpRoot);
    journal.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    journal.appendControl({
      sessionId: "session-1",
      kind: "select-files",
      verifiedPieces: 0,
      state: "checking",
      detail: "sintel-trailer.mp4",
    });
    journal.appendState({
      sessionId: "session-1",
      state: "downloading",
      verifiedPieces: 2,
      totalPieces: 4,
      peerCount: 5,
      integrity: "unknown",
    });
    const recovered = journal.recoverableSessions();
    expect(recovered.length).toBe(1);
    expect(recovered[0]?.sessionId).toBe("session-1");
    expect(recovered[0]?.lastState).toBe("downloading");
    expect(recovered[0]?.verifiedPieces).toBe(2);
    expect(recovered[0]?.selectedFiles).toEqual(["sintel-trailer.mp4"]);
    expect(recovered[0]?.provenance.sourceId).toBe("vault-1");
  });

  it("extractRecoverableSessions excludes stopped sessions (the control law)", () => {
    const journal = createTorrentJournal(tmpRoot);
    journal.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    journal.appendControl({
      sessionId: "session-1",
      kind: "stop",
      verifiedPieces: 0,
      state: "metadata",
    });
    expect(journal.recoverableSessions().length).toBe(0);
  });

  it("extractRecoverableSessions excludes terminal sessions (complete/failed)", () => {
    const journal = createTorrentJournal(tmpRoot);
    journal.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    journal.appendState({
      sessionId: "session-1",
      state: "complete",
      verifiedPieces: 4,
      totalPieces: 4,
      peerCount: 0,
      integrity: "verified",
    });
    expect(journal.recoverableSessions().length).toBe(0);
  });

  it("the torn-tail tolerance: a partial final line is dropped, not failed", () => {
    const journal = createTorrentJournal(tmpRoot);
    journal.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    // Simulate a torn tail: append a partial line (mid-crash).
    const partial = '{"seq":2,"at":1,"type":"state","sessionId":"session-1","state":"downloading","veri';
    writeFileSync(journal.path, partial + "\n", { flag: "a" });
    const records = journal.readAll();
    expect(records.length).toBe(1); // the partial line is dropped, the first record survives
    expect(records[0]?.type).toBe("ingest");
  });

  it("sequence numbers survive restarts (the restart-continuity law)", () => {
    const j1 = createTorrentJournal(tmpRoot);
    j1.appendIngest({
      sessionId: "session-1",
      infoHash: fakeMetadata().infoHash,
      sourceKind: "torrent-file",
      provenance: fakeProvenance(),
      metadata: fakeMetadata(),
      dataDir: join(tmpRoot, "sessions", "session-1"),
      totalPieces: 4,
    });
    j1.appendControl({
      sessionId: "session-1",
      kind: "pause",
      verifiedPieces: 0,
      state: "paused",
    });
    // Simulate a restart: re-create the journal.
    const j2 = createTorrentJournal(tmpRoot);
    expect(j2.nextSeq()).toBe(3); // continues past the last landed seq
    const recovered = j2.recoverableSessions();
    expect(recovered.length).toBe(1);
    expect(recovered[0]?.lastState).toBe("paused");
  });

  it("extractRecoverableSessions is a pure function of the record list", () => {
    const records: JournalRecord[] = [
      {
        seq: 1,
        at: 0,
        type: "ingest",
        sessionId: "session-1",
        infoHash: "0d027de7aa0e4acad3b984ac860c8a16caa734b9",
        sourceKind: "torrent-file",
        provenance: { sourceId: "vault-1", authorizationKind: "authorized-vault" },
        metadata: {
          name: "sintel.mp4",
          pieceLengthBytes: 16 * 1024,
          pieceCount: 4,
          totalBytes: 64 * 1024,
          files: [{ path: "sintel.mp4", lengthBytes: 64 * 1024, offsetBytes: 0, playableHint: true }],
          trackers: [],
        },
        dataDir: "/tmp/data",
        state: "metadata",
        totalPieces: 4,
      },
    ];
    const recovered = extractRecoverableSessions(records);
    expect(recovered.length).toBe(1);
    expect(recovered[0]?.sessionId).toBe("session-1");
    expect(recovered[0]?.dataDir).toBe("/tmp/data");
  });

  it("the journal path is under the configured root", () => {
    const journal = createTorrentJournal(tmpRoot);
    expect(journal.path).toBe(join(tmpRoot, "torrent-journal.ndjson"));
  });

  it("appendEvidence writes engine-level facts", () => {
    const journal = createTorrentJournal(tmpRoot);
    journal.appendEvidence("torrent-engine-started", { dataRoot: tmpRoot });
    const records = journal.readAll();
    expect(records.length).toBe(1);
    expect(records[0]?.type).toBe("evidence");
    if (records[0]?.type === "evidence") {
      expect(records[0].message).toBe("torrent-engine-started");
      expect(records[0].data).toEqual({ dataRoot: tmpRoot });
    }
  });
});
