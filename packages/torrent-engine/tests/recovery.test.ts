/**
 * R11 — persistent recovery tests (the journal + the restart law).
 *
 * The R10 discipline adapted: journal replay after a simulated restart
 * (a stopped downloading session recovers as seeding-paused with its
 * persisted bitfield); recovery is idempotent; terminal sessions stay
 * terminal; a session whose data directory VANISHED fails honestly
 * (data-vanished — never a silent restart from zero pretending
 * continuity); torn tails drop; sequence numbers continue.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine } from "../src/engine";
import { createTorrentSessionJournal } from "../src/journal";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";
import { statusOf, waitFor } from "./helpers/status";
import { AUTHORIZED_ARCHIVE_V1, fixtureTorrentBytes } from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-recovery");

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

function newLibrary(): LoopbackTorrentLibrary {
  const library = new LoopbackTorrentLibrary();
  library.registerFixture(AUTHORIZED_ARCHIVE_V1);
  return library;
}

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("R11 — journal replay after a simulated restart", () => {
  it("a stopped downloading session recovers as seeding-paused with its persisted bitfield, then completes", async () => {
    const root = dataRootFor("restart");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // 4 of 6 pieces verified, then the user stops the session.
    library1.advanceAll();
    library1.advanceAll();
    expect((await engine1.stop(sessionId)).ok).toBe(true);
    await engine1.destroy();

    // SIMULATED RESTART: a fresh engine over the same dataRoot + journal.
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    expect(report.value.recovered[0]?.sessionId).toBe(sessionId);
    expect(report.value.recovered[0]?.state).toBe("seeding-paused");
    expect(report.value.recovered[0]?.resumeTarget).toBe("downloading");
    expect(report.value.recovered[0]?.verifiedPieces).toBe(4);

    // The recovered session: paused, honest progress preserved (re-verified
    // against the disk bytes by the library on resume).
    let status = statusOf(engine2, sessionId);
    {
      expect(status.state).toBe("seeding-paused");
      expect(status.progress.verifiedSelectedPieces).toBe(4);
      expect(status.progress.selectedPieces).toBe(6);
      expect(status.files.filter((f: { selected: boolean; name: string }) => f.selected).map((f: { name: string }) => f.name)).toEqual([
        "feature-presentation.mkv",
      ]);
    }

    // Resume + drive to completion — CONTINUITY, not a restart from zero:
    // the remaining 2 pieces re-verify and the selection COMPLETES from the
    // persisted state (never restarted from zero).
    expect(engine2.resume(sessionId).ok).toBe(true);
    library2.advanceAll();
    status = statusOf(engine2, sessionId);
    {
      expect(["downloading", "verifying"]).toContain(status.state);
      expect(status.progress.verifiedSelectedPieces).toBe(6);
    }
    const completed = await waitFor(() =>
      statusOf(engine2, sessionId).state === "completed",
    );
    expect(completed).toBe(true);
    await engine2.destroy();
  });

  it("recovery is IDEMPOTENT (a second recover() skips live sessions)", async () => {
    const root = dataRootFor("idempotent");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [2] } });
    if (!created.ok) return;
    library1.advanceAll();
    await engine1.stop(created.value.sessionId);
    await engine1.destroy();

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const first = await engine2.recover();
    if (!first.ok) return;
    expect(first.value.recovered.length).toBe(1);
    const second = await engine2.recover();
    if (!second.ok) return;
    expect(second.value.recovered.length).toBe(0);
    expect(second.value.skipped.length).toBe(1);
    await engine2.destroy();
  });

  it("completed sessions stay completed across restart (terminal law) with their digests", async () => {
    const root = dataRootFor("terminal-completed");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [1] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    for (let i = 0; i < 10; i += 1) library1.advanceAll();
    await waitFor(() =>
      statusOf(engine1, sessionId).state === "completed",
    );
    const before = statusOf(engine1, sessionId);
    await engine1.destroy();

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    if (!report.ok) return;
    expect(report.value.terminal.length).toBe(1);
    expect(report.value.terminal[0]?.state).toBe("completed");
    expect(report.value.recovered.length).toBe(0);

    const after = statusOf(engine2, sessionId);
    expect(after.state).toBe("completed");
    expect(after.digests).toEqual(before.digests);
    expect(after.integrity).toBe("verified");
    await engine2.destroy();
  });

  it("failed sessions stay failed across restart (terminal law)", async () => {
    const root = dataRootFor("terminal-failed");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    // Stop with progress, then SIMULATE VANISHED DATA: delete the data dir.
    library1.advanceAll();
    await engine1.stop(sessionId);
    await engine1.destroy();
    rmSync(join(root, "sessions", sessionId), { recursive: true, force: true });

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    if (!report.ok) return;
    expect(report.value.failed.length).toBe(1);
    expect(report.value.failed[0]?.reason).toBe("data-vanished");
    expect(report.value.failed[0]?.detail).toContain("vanished");

    const status = statusOf(engine2, sessionId);
    {
      expect(status.state).toBe("failed");
      expect(status.failure?.reason).toBe("data-vanished");
      // NEVER a silent restart: the failure says so, explicitly.
      expect(status.failure?.detail).toContain("dishonest");
      expect(status.failure?.detail).toContain("fresh session");
    }
    // Terminal: no lifecycle commands.
    expect(engine2.resume(sessionId).ok).toBe(false);
    await engine2.destroy();
  });

  it("a session with ZERO persisted pieces restarts honestly (no false continuity claim)", async () => {
    const root = dataRootFor("zero-progress");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    // No advances: nothing landed. Stop + restart.
    await engine1.stop(sessionId);
    await engine1.destroy();

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    if (!report.ok) return;
    expect(report.value.failed.length).toBe(0); // nothing was lost — honest restart
    expect(report.value.recovered.length).toBe(1);
    const status = statusOf(engine2, sessionId);
    {
      expect(status.state).toBe("seeding-paused");
      expect(status.progress.verifiedSelectedPieces).toBe(0);
    }
    await engine2.destroy();
  });

  it("a live crash (no stop record) still recovers — the journal is the truth", async () => {
    const root = dataRootFor("crash");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library1.advanceAll();
    // NO stop(): destroy the library only (simulating a crash) — the
    // journal holds the piece-progress checkpoint.
    await library1.destroy();

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    const status = statusOf(engine2, created.value.sessionId);
    {
      expect(status.state).toBe("seeding-paused");
    }
    await engine2.destroy();
  });

  it("a session whose authorized source LEFT the registry fails honestly (provenance-revoked)", async () => {
    const root = dataRootFor("revoked");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    library1.advanceAll();
    await engine1.stop(created.value.sessionId);
    await engine1.destroy();

    // The restart's registry NO LONGER authorizes the source.
    const emptySources = createAuthorizedSourceRegistry({ sources: [] });
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({
      library: library2,
      dataRoot: root,
      sources: emptySources,
    });
    const report = await engine2.recover();
    if (!report.ok) return;
    expect(report.value.failed.length).toBe(1);
    const status = statusOf(engine2, created.value.sessionId);
    {
      expect(status.state).toBe("failed");
      expect(status.failure?.reason).toBe("provenance-revoked");
      expect(status.failure?.detail).toContain("no longer in the registry");
    }
    await engine2.destroy();
  });
});

describe("R11 — the journal itself (torn tails, sequence continuity)", () => {
  it("a torn tail is DROPPED; complete records replay; sequence numbers CONTINUE", () => {
    const root = dataRootFor("journal");
    let clockValue = 1_000;
    const journal = createTorrentSessionJournal(root, {
      clock: () => (clockValue += 1),
    });
    journal.appendSessionStarted({
      sessionId: "ts-1",
      ingestionKind: "torrent-file",
      infoHash: "a".repeat(40),
      provenance: { sourceId: "vault:family-media", basis: "user-owned" },
      dataDir: join(root, "sessions", "ts-1", "data"),
      selection: [0],
    });
    expect(journal.nextSeq()).toBe(2);
    // Simulate a torn append (a crash mid-write).
    appendFileSync(journal.path, '{"seq":2,"at":123,"type":"state-cha');
    const restarted = createTorrentSessionJournal(root, { clock: () => clockValue });
    expect(restarted.nextSeq()).toBe(2); // seq 1 landed; the torn tail did not
    expect(restarted.readAll().length).toBe(1);
    const views = restarted.sessions();
    expect(views.length).toBe(1);
    expect(views[0]?.sessionId).toBe("ts-1");

    // Continue the sequence after the restart (no reuse).
    const state = restarted.appendState({
      sessionId: "ts-1",
      from: "selecting",
      to: "downloading",
    });
    expect(state.seq).toBe(2);
    const checkpoint = restarted.appendCheckpoint({
      sessionId: "ts-1",
      bitfield: new Uint8Array([0b10110000]),
      verifiedPieces: 3,
      downloadedBytes: 49_152,
    });
    expect(checkpoint.seq).toBe(3);
    const parsed = readFileSync(journal.path, "utf8").trim().split("\n");
    expect(parsed.length).toBe(4); // 1 complete + torn line dropped + 2 new — wait: torn line remains on disk
    void checkpoint;
    // The torn line is still physically on disk; the reader must tolerate it.
    expect(restarted.readAll().length).toBe(3);
  });
});
