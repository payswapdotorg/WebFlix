/**
 * R13 — the resume path tests (restart, piece-map reuse, scheduler re-arm).
 *
 * The dispatch's laws, proven end-to-end over the deterministic loopback
 * double (the R10/R11 "spawnable" restart pattern: a fresh engine over the
 * same dataRoot + journal):
 *
 * - RESUME WITHOUT REDOWNLOAD: the journal's bitfield checkpoint and the
 *   library's DISK re-verification agree; the recovered session reports
 *   its verified pieces IMMEDIATELY (zero transfers), and the byte-level
 *   proof is the library's own `verifiedBytes` equality across the restart.
 * - RE-ARMED SCHEDULER: the R12 playback scheduler reconstructs its
 *   persisted state (through the FSM's own legal hops) and restores the
 *   SAME window plan; after `resume()` + `tick()` the priorities are back
 *   on the swarm — no fresh playback command required.
 * - HONEST RESUMING: the recovery report carries the journaled control
 *   point, the disk-verified count, `pieceMapReused`, and the re-armed
 *   scheduler state — never a silent fresh start.
 * - PROVENANCE RE-CHECK FIRST: a revoked source fails the session typed;
 *   its scheduler is NEVER re-armed.
 * - BACKGROUND COMPLETION: a playback-stop (background-completion intent)
 *   survives the restart and the session completes + verifies + exposes.
 * - USER STOP CLEARS INTENT: an `engine.stop` journals the idle checkpoint;
 *   restart restores the session paused with NO re-armed plan (R11's law).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { createAssetStore } from "@wfx/native-media";

import { authorizeProvenance, createAuthorizedSourceRegistry } from "../src/provenance";
import { createTorrentEngine } from "../src/engine";
import { createTorrentEngineAdapter } from "../src/adapter/native-media-adapter";
import { createTorrentSessionJournal, extractJournalSessions } from "../src/journal";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";
import { statusOf, waitFor } from "./helpers/status";
import { AUTHORIZED_ARCHIVE_V1, fixtureMagnetUri, fixtureTorrentBytes } from "./helpers/fixtures";

const TMP = join(import.meta.dir, "tmp-resume");

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

describe("R13 — resume without redownload (piece-map reuse proof)", () => {
  it("a paused-then-crashed session resumes at its JOURNALED control point — disk truth agrees, zero transfers", async () => {
    const root = dataRootFor("reuse-file");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // 4 of 6 selected pieces verified; a PAUSE journals the control point
    // (the recovery basis), then a CRASH (no stop record — the journal's
    // last checkpoint is the truth).
    library1.advanceAll();
    library1.advanceAll();
    const preCrashBytes = library1.liveSessions()[0]!.snapshot().verifiedBytes;
    expect(preCrashBytes).toBe(4 * 16_384);
    expect(engine1.pause(sessionId).ok).toBe(true);
    // The journal's bitfield control point (the piece-map proof).
    const journaledCheckpoint = extractJournalSessions(
      createTorrentSessionJournal(root).readAll(),
    )[0]?.checkpoint;
    expect(journaledCheckpoint?.verifiedPieces).toBe(4);
    await library1.destroy(); // the crash

    // RESTART.
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    const recovered = report.value.recovered[0]!;
    expect(recovered.verifiedPieces).toBe(4); // the journaled PROOF
    expect(recovered.diskVerifiedPieces).toBe(4); // the DISK truth
    expect(recovered.pieceMapReused).toBe(true); // journal proof + disk truth agree
    expect(recovered.state).toBe("seeding-paused");
    expect(recovered.resumeTarget).toBe("downloading");

    // HONEST RESUMING (not fresh): the recovered session reports its
    // pieces IMMEDIATELY — zero advances have happened on library2.
    const status = statusOf(engine2, sessionId);
    expect(status.state).toBe("seeding-paused");
    expect(status.progress.verifiedSelectedPieces).toBe(4);
    expect(status.progress.selectedPieces).toBe(6);

    // THE BYTE-LEVEL REUSE PROOF: the new library session re-verified the
    // SAME bytes from disk (verifiedBytes equal, ZERO transfers — a
    // redownload-from-zero would have answered 0).
    const resumedSession = library2.liveSessions()[0]!;
    expect(resumedSession.snapshot().verifiedBytes).toBe(preCrashBytes);
    // The piece map itself agrees with the journal's control point.
    const resumedBitfield = resumedSession.snapshot().bitfield;
    expect(Buffer.from(resumedBitfield).equals(Buffer.from(journaledCheckpoint!.bitfield))).toBe(true);

    // Resume + complete: only the REMAINING pieces transfer (2 more), then
    // the whole-asset digest pass verifies over the real bytes.
    expect(engine2.resume(sessionId).ok).toBe(true);
    library2.advanceAll();
    const completed = await waitFor(() => statusOf(engine2, sessionId).state === "completed");
    expect(completed).toBe(true);
    expect(statusOf(engine2, sessionId).digests?.length).toBe(1);
    await engine2.destroy();
  });

  it("a crash with NO journal checkpoint (mid-transfer, under the checkpoint interval) still never redownloads — the DISK re-verifies", async () => {
    const root = dataRootFor("reuse-unjournaled");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    // 4 pieces verified, then a RAW crash: under the 16-piece checkpoint
    // interval, no pause, no stop — the journal holds NO piece proof.
    library1.advanceAll();
    library1.advanceAll();
    const preCrashBytes = library1.liveSessions()[0]!.snapshot().verifiedBytes;
    expect(preCrashBytes).toBe(4 * 16_384);
    await library1.destroy();

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const recovered = report.value.recovered[0]!;
    // HONEST: the journal proves nothing (verifiedPieces 0, no reuse flag) —
    // but the LIBRARY's disk re-verification finds the 4 landed pieces, so
    // the resume still starts from the bytes that exist (never from zero).
    expect(recovered.verifiedPieces).toBe(0);
    expect(recovered.pieceMapReused).toBe(false);
    expect(recovered.diskVerifiedPieces).toBe(4);
    expect(library2.liveSessions()[0]!.snapshot().verifiedBytes).toBe(preCrashBytes);
    expect(statusOf(engine2, sessionId).progress.verifiedSelectedPieces).toBe(4);
    // And the completion only transfers the remaining 2 pieces.
    expect(engine2.resume(sessionId).ok).toBe(true);
    library2.advanceAll();
    const completed = await waitFor(() => statusOf(engine2, sessionId).state === "completed");
    expect(completed).toBe(true);
    await engine2.destroy();
  });

  it("a crashed MAGNET session with journaled metadata resumes piece-map aware (no redownload-from-zero)", async () => {
    const root = dataRootFor("reuse-magnet");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, {
      selection: { filePaths: ["authorized-archive-v1/feature-presentation.mkv"] },
    });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Advance 2: metadata resolves on the first (the selection applies
    // mid-advance), 4 pieces land across the two.
    library1.advanceAll();
    library1.advanceAll();
    const preCrashBytes = library1.liveSessions()[0]!.snapshot().verifiedBytes;
    expect(preCrashBytes).toBe(4 * 16_384);
    // A pause journals the control point, then the crash.
    expect(engine1.pause(sessionId).ok).toBe(true);
    await library1.destroy(); // the crash

    // RESTART: the journal holds the magnet session's metadata + resolved
    // selection, so the library session is re-created WITH DISK
    // RE-VERIFICATION over the journaled selection — the piece map is
    // rebuilt from the bytes that provably landed.
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    const recovered = report.value.recovered[0]!;
    expect(recovered.pieceMapReused).toBe(true);
    expect(recovered.diskVerifiedPieces).toBe(4);

    const status = statusOf(engine2, sessionId);
    expect(status.state).toBe("seeding-paused");
    expect(status.progress.verifiedSelectedPieces).toBe(4);
    // The selection SURVIVED the restart (continuity, not the default).
    expect(status.files.filter((f) => f.selected).map((f) => f.name)).toEqual([
      "feature-presentation.mkv",
    ]);
    // Byte-level reuse: zero transfers, same verified bytes.
    expect(library2.liveSessions()[0]!.snapshot().verifiedBytes).toBe(preCrashBytes);

    // Resume + complete from the persisted piece map.
    expect(engine2.resume(sessionId).ok).toBe(true);
    library2.advanceAll();
    const completed = await waitFor(() => statusOf(engine2, sessionId).state === "completed");
    expect(completed).toBe(true);
    await engine2.destroy();
  });

  it("a magnet session crashed BEFORE metadata restarts honestly (no false continuity claim)", async () => {
    const root = dataRootFor("pre-metadata");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestMagnet(fixtureMagnetUri(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, {
      selection: { filePaths: ["authorized-archive-v1/feature-presentation.mkv"] },
    });
    if (!created.ok) return;
    await library1.destroy(); // crash before ANY advance: no metadata, no bytes

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    const recovered = report.value.recovered[0]!;
    expect(recovered.verifiedPieces).toBe(0);
    expect(recovered.pieceMapReused).toBe(false); // nothing was proved — honest
    const status = statusOf(engine2, created.value.sessionId);
    expect(status.state).toBe("seeding-paused");
    expect(status.progress.verifiedSelectedPieces).toBe(0);
    await engine2.destroy();
  });
});

describe("R13 — the re-armed scheduler (persisted priorities)", () => {
  it("a crashed playback session re-arms its scheduler: SAME state, SAME plan, priorities back after resume", async () => {
    const root = dataRootFor("rearm");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Playback: start at byte 0, 8192 B/s (the startup window is 8s ->
    // 65536 bytes -> pieces 0..3).
    const started = engine1.playback.command(sessionId, {
      kind: "start",
      positionBytes: 0,
      bytesPerSecond: 8192,
    });
    expect(started.ok).toBe(true);
    // 4 pieces verify -> tick -> the startup window is satisfied -> steady.
    library1.advanceAll();
    library1.advanceAll();
    const ticked = engine1.playback.tick();
    expect(ticked.ok).toBe(true);
    const preCrashState = engine1.playback.state(sessionId);
    expect(preCrashState.ok).toBe(true);
    if (!preCrashState.ok) return;
    expect(preCrashState.value).toBe("steady");
    const preCrashWindows = engine1.playback.windows(sessionId);
    expect(preCrashWindows.ok).toBe(true);
    if (!preCrashWindows.ok) return;
    expect(preCrashWindows.value.length).toBeGreaterThan(0);
    await library1.destroy(); // the crash

    // RESTART + RECOVER: the scheduler is re-armed from the persisted
    // checkpoint — SAME state, SAME playhead, SAME window plan.
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.rearmed.length).toBe(1);
    const rearmed = report.value.rearmed[0]!;
    expect(rearmed.sessionId).toBe(sessionId);
    expect(rearmed.schedulerState).toBe("steady"); // the persisted state
    expect(rearmed.positionBytes).toBe(0);
    expect(rearmed.bytesPerSecond).toBe(8192);
    expect(rearmed.playableFile?.path).toBe("authorized-archive-v1/feature-presentation.mkv");

    // The re-armed scheduler's plan EQUALS the pre-crash plan (the plan is
    // a pure function of the persisted inputs — deterministic continuity).
    const rearmedWindows = engine2.playback.windows(sessionId);
    expect(rearmedWindows.ok).toBe(true);
    if (!rearmedWindows.ok) return;
    expect(rearmedWindows.value).toEqual(preCrashWindows.value);
    // The paused law held at recovery: priorities CLEARED while paused
    // (completion priority — the R12 law survives restarts).
    expect(library2.liveSessions()[0]!.appliedPriorities()).toEqual([]);

    // RESUME + TICK: the persisted priorities are BACK ON THE SWARM without
    // any fresh playback command — the re-arm is live, not decorative.
    expect(engine2.resume(sessionId).ok).toBe(true);
    const tick2 = engine2.playback.tick();
    expect(tick2.ok).toBe(true);
    const applied = library2.liveSessions()[0]!.appliedPriorities();
    expect(applied.length).toBeGreaterThan(0);
    expect(applied).toEqual(
      preCrashWindows.value.map((window) => ({
        fromPiece: window.fromPiece,
        toPiece: window.toPiece,
        urgency: window.urgency,
      })),
    );
    // And the honest marker: the scheduler ANSWERS as resumed.
    const command = engine2.playback.command(sessionId, {
      kind: "progress",
      positionBytes: 16_384,
      bytesPerSecond: 8192,
    });
    expect(command.ok).toBe(true);
    if (!command.ok) return;
    expect(command.value.resumed).toEqual({ fromSchedulerState: "steady" });
    await engine2.destroy();
  });

  it("an engine STOP clears the persisted intent — restart restores paused with NO re-armed plan (R11 law)", async () => {
    const root = dataRootFor("stop-clears");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    const started = engine1.playback.command(sessionId, {
      kind: "start",
      positionBytes: 0,
      bytesPerSecond: 8192,
    });
    expect(started.ok).toBe(true);
    library1.advanceAll();
    // The USER stops the session (not the playback): the intent ends.
    const stopped = await engine1.stop(sessionId);
    expect(stopped.ok).toBe(true);
    await engine1.destroy();

    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1); // the session is recoverable
    expect(report.value.rearmed.length).toBe(0); // but its plan is NOT re-armed
    // A fresh scheduler starts idle (an honest fresh start).
    const state = engine2.playback.state(sessionId);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.value).toBe("idle");
    await engine2.destroy();
  });
});

describe("R13 — provenance re-check BEFORE re-arm (invariants 4/5/6)", () => {
  it("a revoked source fails the session typed; its scheduler is NEVER re-armed", async () => {
    const root = dataRootFor("revoked-no-rearm");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    const started = engine1.playback.command(sessionId, {
      kind: "start",
      positionBytes: 0,
      bytesPerSecond: 8192,
    });
    expect(started.ok).toBe(true);
    library1.advanceAll();
    await library1.destroy(); // the crash

    // The restart's registry NO LONGER authorizes the source.
    const emptySources = createAuthorizedSourceRegistry({ sources: [] });
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources: emptySources });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.failed.length).toBe(1);
    expect(report.value.recovered.length).toBe(0);
    // THE ORDERING LAW: the provenance re-check precedes any re-arm — a
    // session that cannot re-establish authorization never gets its plan
    // (or its transfer) back.
    expect(report.value.rearmed.length).toBe(0);
    expect(report.value.rearmRefused.length).toBe(0); // no re-arm was ATTEMPTED
    const status = statusOf(engine2, sessionId);
    expect(status.state).toBe("failed");
    expect(status.failure?.reason).toBe("provenance-revoked");
    await engine2.destroy();
  });
});

describe("R13 — background completion across restarts (J24+J25)", () => {
  it("a playback-stop intent persists; the session completes, verifies, and exposes after the restart", async () => {
    const root = dataRootFor("background");
    const storeRoot = join(root, "store");
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const adapter1 = createTorrentEngineAdapter({ engine: engine1, store: { root: storeRoot } });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;

    // Playback starts, then the user stops PLAYBACK (background completion).
    const started = engine1.playback.command(sessionId, {
      kind: "start",
      positionBytes: 0,
      bytesPerSecond: 8192,
    });
    expect(started.ok).toBe(true);
    library1.advanceAll();
    const stopped = engine1.playback.command(sessionId, { kind: "stop" });
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    expect(stopped.value.schedulerState).toBe("background-completion");
    library1.advanceAll(); // more pieces land in background order
    await library1.destroy(); // the crash MID background completion

    // RESTART: the background-completion intent is re-armed; the session
    // resumes and COMPLETES (the pieces landed pre-crash are reused — the
    // library's disk re-verification proves it, 4 pieces at recovery).
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const adapter2 = createTorrentEngineAdapter({ engine: engine2, store: { root: storeRoot } });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    expect(report.value.recovered[0]?.diskVerifiedPieces).toBe(4); // disk reuse
    expect(report.value.rearmed.length).toBe(1);
    expect(report.value.rearmed[0]?.schedulerState).toBe("background-completion");

    expect(engine2.resume(sessionId).ok).toBe(true);
    library2.advanceAll();
    library2.advanceAll();
    const completed = await waitFor(() => statusOf(engine2, sessionId).state === "completed");
    expect(completed).toBe(true);
    const status = statusOf(engine2, sessionId);
    expect(status.integrity).toBe("verified");
    expect(status.digests?.length).toBe(1);

    // Verified-before-ready: the completed + verified session exposes as an
    // offline-ready Library entry (composed with the R04 canonical key).
    const exposed = await adapter2.exposeCompletedSelection({
      sessionId,
      contentType: "video/x-matroska",
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    expect(exposed.value.length).toBe(1);
    expect(exposed.value[0]?.integrity).toBe("verified");
    expect(exposed.value[0]?.library).toEqual({ profileKey: "user:42", canonicalItemId: "item-7" });
    await engine2.destroy();
    void adapter1;
  });
});

describe("R13 — the full interruption journey (J25 end-to-end over the spawnable restart pattern)", () => {
  it("play -> crash -> recover (resuming) -> resume -> complete -> verify -> expose -> restart -> durable", async () => {
    const root = dataRootFor("journey");
    const storeRoot = join(root, "store");
    const store = createAssetStore({ root: storeRoot });

    // Act I: acquisition + playback, a pause journals the control point,
    // then the process crashes.
    const library1 = newLibrary();
    const engine1 = createTorrentEngine({ library: library1, dataRoot: root, sources });
    const ingested = await engine1.ingestTorrentFile(fixtureTorrentBytes(AUTHORIZED_ARCHIVE_V1), PROVENANCE);
    if (!ingested.ok) return;
    const created = await engine1.createSession(ingested.value.id, { selection: { fileIndexes: [0] } });
    if (!created.ok) return;
    const sessionId = created.value.sessionId;
    expect(engine1.playback.command(sessionId, { kind: "start", positionBytes: 0, bytesPerSecond: 8192 }).ok).toBe(true);
    library1.advanceAll();
    library1.advanceAll();
    expect(engine1.playback.tick().ok).toBe(true);
    expect(engine1.pause(sessionId).ok).toBe(true); // the control point lands
    await library1.destroy(); // CRASH: no stop, no orderly teardown

    // Act II: restart + recovery — everything resuming, nothing fresh.
    const library2 = newLibrary();
    const engine2 = createTorrentEngine({ library: library2, dataRoot: root, sources });
    const adapter2 = createTorrentEngineAdapter({ engine: engine2, store });
    const report = await engine2.recover();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.recovered.length).toBe(1);
    expect(report.value.recovered[0]?.pieceMapReused).toBe(true);
    expect(report.value.rearmed.length).toBe(1);
    expect(report.value.rearmed[0]?.schedulerState).toBe("steady");

    // Act III: resume + background completion + verification.
    expect(engine2.resume(sessionId).ok).toBe(true);
    expect(engine2.playback.tick().ok).toBe(true); // the re-armed plan applies
    library2.advanceAll();
    const completed = await waitFor(() => statusOf(engine2, sessionId).state === "completed");
    expect(completed).toBe(true);

    // Act IV: exposure — verified-before-ready, the Library entry composes
    // with the R04 canonical identity.
    const exposed = await adapter2.exposeCompletedSelection({
      sessionId,
      library: { profileKey: "user:42", canonicalItemId: "item-7" },
    });
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) return;
    expect(exposed.value[0]?.sha256).toBe(statusOf(engine2, sessionId).digests?.[0]?.sha256);
    await engine2.destroy();

    // Act V: ANOTHER restart — the exposure is DURABLE (the journal is the
    // truth), the session stays terminal-completed, and the Library read
    // composes the journal's exposure with the store's live verdict.
    const library3 = newLibrary();
    const engine3 = createTorrentEngine({ library: library3, dataRoot: root, sources });
    const adapter3 = createTorrentEngineAdapter({ engine: engine3, store });
    const report3 = await engine3.recover();
    expect(report3.ok).toBe(true);
    if (!report3.ok) return;
    expect(report3.value.terminal.length).toBe(1); // terminal stays terminal
    expect(report3.value.terminal[0]?.state).toBe("completed");
    const listing = adapter3.listOfflineReady();
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.value.length).toBe(1);
    const entry = listing.value[0]!;
    expect(entry.key).toBe("canonical:user:42::item-7");
    expect(entry.provenance.sourceId).toBe("vault:family-media");
    expect(entry.assets.length).toBe(1);
    expect(entry.assets[0]?.integrity).toBe("verified"); // the store's live verdict
    expect(entry.assets[0]?.sizeOnDisk).toBe(88_920);
    await engine3.destroy();
  });
});
