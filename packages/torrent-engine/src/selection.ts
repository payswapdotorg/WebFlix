/**
 * @wfx/torrent-engine — file selection (R11, the J21-J25 "choose file" step).
 *
 * PURE selection math: which files within a torrent the session transfers,
 * and which PIECE ranges those files cover. The session downloads ONLY the
 * selected pieces' ranges — the engine hands the resolved file indexes to
 * the mature library's own file selection (`LibrarySession.selectFiles`);
 * the piece ranges computed here drive the honest progress denominator and
 * the R12 playback-scheduler seam (byte-range -> piece mapping).
 *
 * All functions are pure and total for runtime garbage: malformed input is
 * a typed `INVALID_SELECTION` rejection, never a silent default.
 */

import { torrentError, type TorrentResult } from "./errors";
import type { TorrentFileEntry } from "./metadata";

// ---------------------------------------------------------------------------
// The selection type
// ---------------------------------------------------------------------------

/**
 * A file selection: the indexes (into the torrent's ordered file list) of
 * the files the session transfers. Empty selections are invalid — a session
 * that transfers nothing is not a session (typed rejection).
 */
export interface FileSelection {
  /** Indexes into the torrent's file list, ascending, deduplicated. */
  readonly fileIndexes: readonly number[];
}

/** A contiguous inclusive piece range. */
export interface PieceRange {
  /** First piece index (inclusive). */
  readonly fromPiece: number;
  /** Last piece index (inclusive). */
  readonly toPiece: number;
}

/** The resolved piece geometry of a selection. */
export interface SelectionPlan {
  /** The validated selection. */
  readonly selection: FileSelection;
  /** The selected files (ordered by file list order). */
  readonly selectedFiles: readonly TorrentFileEntry[];
  /** The piece ranges covering the selection (ascending, non-overlapping). */
  readonly pieceRanges: readonly PieceRange[];
  /** Every piece index in the selection (derived from `pieceRanges`). */
  readonly selectedPieces: readonly number[];
  /** Total bytes of the selected files. */
  readonly selectedBytes: number;
  /** The torrent's total piece count (context for consumers). */
  readonly totalPieces: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a file selection against the torrent's file list.
 * Rejects (typed `INVALID_SELECTION`): non-array input, an empty selection,
 * out-of-range indexes, non-integer indexes, duplicates.
 */
export function validateSelection(
  files: readonly TorrentFileEntry[],
  fileIndexes: readonly number[],
): TorrentResult<FileSelection> {
  if (!Array.isArray(fileIndexes)) {
    return torrentError("INVALID_SELECTION", {
      detail: "validateSelection: fileIndexes must be an array",
    });
  }
  if (fileIndexes.length === 0) {
    return torrentError("INVALID_SELECTION", {
      detail:
        "validateSelection: a selection must name at least one file (an empty selection transfers nothing — refuse it explicitly, never silently)",
    });
  }
  const seen = new Set<number>();
  for (const index of fileIndexes) {
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) {
      return torrentError("INVALID_SELECTION", {
        detail: `validateSelection: file index ${String(index)} is not a non-negative safe integer`,
      });
    }
    if (index >= files.length) {
      return torrentError("INVALID_SELECTION", {
        detail: `validateSelection: file index ${index} is out of range (the torrent has ${files.length} file(s))`,
      });
    }
    if (seen.has(index)) {
      return torrentError("INVALID_SELECTION", {
        detail: `validateSelection: file index ${index} is selected more than once`,
      });
    }
    seen.add(index);
  }
  return { ok: true, value: { fileIndexes: [...seen].sort((a, b) => a - b) } };
}

// ---------------------------------------------------------------------------
// Piece math
// ---------------------------------------------------------------------------

/** The piece index containing absolute byte `offset` (floor division). */
export function pieceForByte(offsetBytes: number, pieceLengthBytes: number): number {
  return Math.floor(offsetBytes / pieceLengthBytes);
}

/**
 * Compute the inclusive piece range covering the byte interval
 * `[startByte, startByte + lengthBytes - 1]`. A zero-length file covers no
 * piece (answers `null` — an honest empty range, not a fabricated one).
 */
export function pieceRangeForSpan(
  startByte: number,
  lengthBytes: number,
  pieceLengthBytes: number,
): PieceRange | null {
  if (lengthBytes <= 0) return null;
  const from = pieceForByte(startByte, pieceLengthBytes);
  const to = pieceForByte(startByte + lengthBytes - 1, pieceLengthBytes);
  return { fromPiece: from, toPiece: to };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * Resolve a validated selection to its piece geometry: the selected files,
 * the covering piece ranges, the selected piece indexes, and the selected
 * byte total. Pure; the piece count is `max(1, ceil(totalBytes/pieceLength))`
 * — the metainfo's own geometry.
 */
export function planSelection(
  files: readonly TorrentFileEntry[],
  selection: FileSelection,
  pieceLengthBytes: number,
  totalBytes: number,
): TorrentResult<SelectionPlan> {
  if (!Number.isSafeInteger(pieceLengthBytes) || pieceLengthBytes <= 0) {
    return torrentError("INVALID_SELECTION", {
      detail: `planSelection: pieceLengthBytes must be a positive safe integer (got ${String(pieceLengthBytes)})`,
    });
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    return torrentError("INVALID_SELECTION", {
      detail: `planSelection: totalBytes must be a non-negative safe integer (got ${String(totalBytes)})`,
    });
  }
  const selectedFiles = selection.fileIndexes
    .map((index) => files[index])
    .filter((file): file is TorrentFileEntry => file !== undefined);

  const ranges: PieceRange[] = [];
  for (const file of selectedFiles) {
    const range = pieceRangeForSpan(
      file.offsetBytes,
      file.lengthBytes,
      pieceLengthBytes,
    );
    if (range === null) continue; // zero-length file: no pieces
    const last = ranges[ranges.length - 1];
    // Adjacent OR piece-sharing files (two files inside one piece) merge
    // into one contiguous range — the piece geometry is the truth.
    if (last !== undefined && last.toPiece + 1 >= range.fromPiece) {
      ranges[ranges.length - 1] = {
        fromPiece: last.fromPiece,
        toPiece: Math.max(last.toPiece, range.toPiece),
      };
    } else {
      ranges.push(range);
    }
  }
  const selectedPieces: number[] = [];
  for (const range of ranges) {
    for (let p = range.fromPiece; p <= range.toPiece; p += 1) {
      selectedPieces.push(p);
    }
  }
  return {
    ok: true,
    value: {
      selection,
      selectedFiles,
      pieceRanges: ranges,
      selectedPieces,
      selectedBytes: selectedFiles.reduce((sum, f) => sum + f.lengthBytes, 0),
      totalPieces: Math.max(1, Math.ceil(totalBytes / pieceLengthBytes)),
    },
  };
}
