/**
 * R11 — file selection tests (J22's "choose file" step).
 *
 * Pure selection math: which files, which piece ranges, honest byte
 * totals, and the typed rejections for malformed selections.
 */

import { describe, expect, it } from "bun:test";

import { planSelection, validateSelection } from "../src/selection";
import { deriveFileOffsets } from "../src/metadata";
import { AUTHORIZED_ARCHIVE_V1, SINGLE_FILE_DOCUMENT, fixtureTorrentBytes } from "./helpers/fixtures";
import { LoopbackTorrentLibrary } from "./helpers/loopback-library";

async function fixtureMetainfo(spec: typeof AUTHORIZED_ARCHIVE_V1) {
  const library = new LoopbackTorrentLibrary();
  const parsed = await library.parseTorrentFile(fixtureTorrentBytes(spec));
  if (!parsed.ok) throw new Error("fixture must parse");
  return parsed.value;
}

describe("R11 — file selection (the choose-file step)", () => {
  it("selecting file 0 of 3 covers exactly its pieces (5 full + 1 partial = 6 pieces)", async () => {
    const meta = await fixtureMetainfo(AUTHORIZED_ARCHIVE_V1);
    const validated = validateSelection(meta.files, [0]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const plan = planSelection(meta.files, validated.value, meta.pieceLengthBytes, meta.totalBytes);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // File 0 is 88,920 bytes: pieces 0..5 (the last one partial).
    expect(plan.value.pieceRanges).toEqual([{ fromPiece: 0, toPiece: 5 }]);
    expect(plan.value.selectedPieces).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.value.selectedBytes).toBe(88_920);
    expect(plan.value.totalPieces).toBe(6);
  });

  it("selecting the middle file maps to the correct piece window (bytes 88,920..92,919 = piece 5)", async () => {
    const meta = await fixtureMetainfo(AUTHORIZED_ARCHIVE_V1);
    const validated = validateSelection(meta.files, [1]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const plan = planSelection(meta.files, validated.value, meta.pieceLengthBytes, meta.totalBytes);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // coverart.jpg spans [88920, 92920) — entirely inside piece 5.
    expect(plan.value.pieceRanges).toEqual([{ fromPiece: 5, toPiece: 5 }]);
    expect(plan.value.selectedBytes).toBe(4_000);
  });

  it("selecting the tail file shares its piece with file 1 (byte-adjacent geometry)", async () => {
    const meta = await fixtureMetainfo(AUTHORIZED_ARCHIVE_V1);
    const validated = validateSelection(meta.files, [2]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const plan = planSelection(meta.files, validated.value, meta.pieceLengthBytes, meta.totalBytes);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.pieceRanges).toEqual([{ fromPiece: 5, toPiece: 5 }]);
    expect(plan.value.selectedBytes).toBe(250);
  });

  it("selecting ALL files covers every piece exactly once", async () => {
    const meta = await fixtureMetainfo(AUTHORIZED_ARCHIVE_V1);
    const validated = validateSelection(meta.files, [0, 1, 2]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const plan = planSelection(meta.files, validated.value, meta.pieceLengthBytes, meta.totalBytes);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.pieceRanges).toEqual([{ fromPiece: 0, toPiece: 5 }]);
    expect(plan.value.selectedPieces).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.value.selectedBytes).toBe(meta.totalBytes);
  });

  it("adjacent selected files merge into one contiguous piece range", async () => {
    const meta = await fixtureMetainfo(AUTHORIZED_ARCHIVE_V1);
    const validated = validateSelection(meta.files, [1, 2]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const plan = planSelection(meta.files, validated.value, meta.pieceLengthBytes, meta.totalBytes);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.pieceRanges).toEqual([{ fromPiece: 5, toPiece: 5 }]);
  });

  it("a single-file torrent's selection covers its pieces with the partial tail absorbed", async () => {
    const meta = await fixtureMetainfo(SINGLE_FILE_DOCUMENT);
    // 8192*2 + 1234 = 17618 bytes → 3 pieces.
    expect(meta.totalBytes).toBe(17_618);
    expect(meta.pieceCount).toBe(3);
    const validated = validateSelection(meta.files, [0]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const plan = planSelection(meta.files, validated.value, meta.pieceLengthBytes, meta.totalBytes);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.pieceRanges).toEqual([{ fromPiece: 0, toPiece: 2 }]);
  });

  it("malformed selections are TYPED rejections: empty, out-of-range, duplicated, non-integer", async () => {
    const meta = await fixtureMetainfo(AUTHORIZED_ARCHIVE_V1);
    for (const [label, indexes] of [
      ["empty", []],
      ["out-of-range", [0, 3]],
      ["negative", [-1]],
      ["non-integer", [0.5]],
    ] as const) {
      const result = validateSelection(meta.files, indexes as readonly number[]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_SELECTION");
        expect((result.error.detail ?? "").length).toBeGreaterThan(0);
      }
      void label;
    }
    const dup = validateSelection(meta.files, [0, 0]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.detail).toContain("more than once");
    }
  });

  it("deriveFileOffsets assigns cumulative offsets (the pure fold)", () => {
    const files = deriveFileOffsets([
      { path: "a/b.bin", name: "b.bin", lengthBytes: 100 },
      { path: "a/c.bin", name: "c.bin", lengthBytes: 50 },
      { path: "a/d.txt", name: "d.txt", lengthBytes: 25 },
    ]);
    expect(files.map((f) => f.offsetBytes)).toEqual([0, 100, 150]);
  });
});
