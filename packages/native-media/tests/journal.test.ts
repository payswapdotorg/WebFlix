/**
 * R10 — the session journal tests.
 *
 * The append-only crash recovery log: monotonic sequence numbers that
 * SURVIVE restarts, the four record types (open/control/state/evidence),
 * torn-tail tolerance (a partial final line is dropped, everything that
 * provably landed replays), and the PURE recovery extraction (closed and
 * terminal sessions are not recoverable; the last control point is).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { NativeMediaError } from "../src/errors";
import {
  createSessionJournal,
  extractRecoverableSessions,
  type JournalRecord,
  type SessionJournal,
} from "../src/service-process/journal";

const TMP_ROOT = join(import.meta.dir, "tmp-journal-test");

let clockValue = 1_000;
const clock = (): number => {
  clockValue += 1;
  return clockValue;
};

let counter = 0;
function newJournal(): { journal: SessionJournal; root: string } {
  counter += 1;
  const root = join(TMP_ROOT, `j-${counter}`);
  mkdirSync(root, { recursive: true });
  return { journal: createSessionJournal(root, { clock }), root };
}

beforeAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("R10 — the session journal", () => {
  it("appends records with MONOTONIC sequence numbers; readAll replays in order", () => {
    const { journal } = newJournal();
    const open = journal.appendOpen({
      sessionId: "s1",
      assetId: "a1",
      fileId: "f1",
      sourcePath: "/tmp/media.bin",
      state: "buffering",
      positionMs: 0,
    });
    expect(open.seq).toBe(1);
    const control = journal.appendControl({
      sessionId: "s1",
      kind: "seek",
      positionMs: 5_000,
      state: "buffering",
      detail: "positionMs=5000",
    });
    expect(control.seq).toBe(2);
    const state = journal.appendState({
      sessionId: "s1",
      state: "playing",
      bufferedMs: 1_000,
      positionMs: 5_000,
      integrity: "unknown",
      evidence: { via: "resume" },
    });
    expect(state.seq).toBe(3);
    const evidence = journal.appendEvidence("startup", { pid: 1 });
    expect(evidence.seq).toBe(4);
    expect(journal.nextSeq()).toBe(5);

    const all = journal.readAll();
    expect(all.map((r) => r.type)).toEqual(["open", "control", "state", "evidence"]);
    expect(all.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    const openRecord = all[0] as Extract<JournalRecord, { type: "open" }>;
    // The source path is stored ABSOLUTE (recovery re-stats it).
    expect(openRecord.sourcePath).toBe("/tmp/media.bin");
    const stateRecord = all[2] as Extract<JournalRecord, { type: "state" }>;
    expect(stateRecord.evidence).toEqual({ via: "resume" });
  });

  it("sequence numbers CONTINUE across restarts (no reuse after a torn append)", () => {
    const { journal, root } = newJournal();
    journal.appendOpen({
      sessionId: "s1",
      assetId: "a1",
      fileId: "f1",
      sourcePath: "/tmp/x.bin",
      state: "buffering",
      positionMs: 0,
    });
    // Simulate a torn append: a partial line at the tail.
    appendFileSync(journal.path, '{"seq":2,"at":123,"type":"contr');
    const restarted = createSessionJournal(root, { clock });
    expect(restarted.nextSeq()).toBe(2); // seq 1 landed; the torn tail did not
  });

  it("torn tail tolerance: a partial final line is DROPPED, complete records replay", () => {
    const { journal, root } = newJournal();
    journal.appendOpen({
      sessionId: "s1",
      assetId: "a1",
      fileId: "f1",
      sourcePath: "/tmp/y.bin",
      state: "buffering",
      positionMs: 0,
    });
    journal.appendControl({
      sessionId: "s1",
      kind: "pause",
      positionMs: 2_500,
      state: "playing",
    });
    appendFileSync(journal.path, '{"seq":3,"at":999,"type":"evidence","mess');
    const replay = createSessionJournal(root, { clock });
    const all = replay.readAll();
    expect(all).toHaveLength(2);
    expect(all[1]?.seq).toBe(2);
  });

  it("malformed lines (bad seq, wrong shape, non-JSON) are dropped, never fatal", () => {
    const { journal, root } = newJournal();
    journal.appendOpen({
      sessionId: "s1",
      assetId: "a1",
      fileId: "f1",
      sourcePath: "/tmp/z.bin",
      state: "buffering",
      positionMs: 0,
    });
    appendFileSync(
      journal.path,
      [
        "not json at all",
        '{"seq":0,"at":1,"type":"evidence","message":"bad seq"}',
        '{"seq":2,"at":1,"type":"open"}',
        '{"seq":2,"at":1,"type":"nonsense","message":"x"}',
        "",
      ].join("\n") + "\n",
    );
    const replay = createSessionJournal(root, { clock });
    expect(replay.readAll()).toHaveLength(1);
  });

  it("extractRecoverableSessions: the LAST control point wins; closed/terminal are excluded", () => {
    const { journal } = newJournal();
    // s1: live, seeked to 8s, playing.
    journal.appendOpen({
      sessionId: "s1",
      assetId: "a1",
      fileId: "f1",
      sourcePath: "/tmp/live.bin",
      state: "buffering",
      positionMs: 0,
    });
    journal.appendControl({ sessionId: "s1", kind: "seek", positionMs: 8_000, state: "buffering" });
    journal.appendState({
      sessionId: "s1",
      state: "playing",
      bufferedMs: 2_000,
      positionMs: 8_000,
      integrity: "unknown",
    });
    // s2: CLOSED — not recoverable.
    journal.appendOpen({
      sessionId: "s2",
      assetId: "a2",
      fileId: "f2",
      sourcePath: "/tmp/closed.bin",
      state: "buffering",
      positionMs: 0,
    });
    journal.appendControl({ sessionId: "s2", kind: "close", positionMs: 0, state: "playing" });
    // s3: TERMINAL complete — not recoverable.
    journal.appendOpen({
      sessionId: "s3",
      assetId: "a3",
      fileId: "f3",
      sourcePath: "/tmp/done.bin",
      state: "buffering",
      positionMs: 0,
    });
    journal.appendState({
      sessionId: "s3",
      state: "complete",
      bufferedMs: 60_000,
      positionMs: 60_000,
      integrity: "verified",
    });
    // s4: TERMINAL failed — not recoverable.
    journal.appendOpen({
      sessionId: "s4",
      assetId: "a4",
      fileId: "f4",
      sourcePath: "/tmp/dead.bin",
      state: "buffering",
      positionMs: 0,
    });
    journal.appendState({
      sessionId: "s4",
      state: "failed",
      bufferedMs: 0,
      positionMs: 1_000,
      integrity: "unknown",
    });

    const recoverable = journal.recoverableSessions();
    expect(recoverable.map((r) => r.sessionId)).toEqual(["s1"]);
    const s1 = recoverable[0]!;
    expect(s1.sourcePath).toBe("/tmp/live.bin");
    expect(s1.lastState).toBe("playing");
    expect(s1.positionMs).toBe(8_000);
    expect(s1.bufferedMs).toBe(2_000);
  });

  it("extractRecoverableSessions is PURE (a function of the record list)", () => {
    const records: JournalRecord[] = [
      {
        seq: 1,
        at: 1,
        type: "open",
        sessionId: "s1",
        assetId: "a1",
        fileId: "f1",
        sourcePath: "/tmp/p.bin",
        state: "buffering",
        positionMs: 0,
      },
      {
        seq: 2,
        at: 2,
        type: "control",
        sessionId: "s1",
        kind: "resume",
        positionMs: 3_000,
        state: "playing",
      },
    ];
    const first = extractRecoverableSessions(records);
    const second = extractRecoverableSessions(records);
    expect(first).toEqual(second);
    expect(first[0]?.positionMs).toBe(3_000);
  });

  it("typed input validation on the append paths", () => {
    const { journal } = newJournal();
    expect(() =>
      journal.appendOpen({
        sessionId: "",
        assetId: "a",
        fileId: "f",
        sourcePath: "/tmp/x",
        state: "buffering",
        positionMs: 0,
      }),
    ).toThrow(NativeMediaError);
    expect(() =>
      journal.appendState({
        sessionId: "s1",
        state: "paused" as never,
        bufferedMs: 0,
        positionMs: 0,
        integrity: "unknown",
      }),
    ).toThrow(NativeMediaError);
    expect(() => journal.appendEvidence("")).toThrow(NativeMediaError);
  });

  it("a journal over an UNWRITABLE root fails honestly at construction", () => {
    expect(() => createSessionJournal("", { clock })).toThrow(NativeMediaError);
  });
});
