/**
 * @wfx/torrent-engine — the playable-file piece geometry (R12).
 *
 * THE BYTE↔PIECE MAP (the thing R10's scheduler could not have: its model
 * notes "Translating to absolute torrent piece indices requires a
 * byte-offset↔piece map that no merged contract exposes yet; deferred to
 * R12" — this module IS that map, owned by the torrent engine where the
 * real metainfo lives).
 *
 * All math is BitTorrent's own geometry, made explicit:
 * - a torrent is ONE concatenated byte stream; files are intervals of it;
 * - pieces are fixed-size intervals of that stream starting at 0 (the
 *   last piece may be short);
 * - piece `i` covers stream bytes `[i * pieceLength, (i + 1) * pieceLength)`;
 * - a byte at stream offset `b` lives in piece `floor(b / pieceLength)`.
 *
 * Playback speaks FILE-relative bytes (the playable file the player
 * reads); the swarm speaks absolute piece indexes. This module is the
 * honest translator between the two — pure arithmetic, total for garbage
 * via typed rejections, no invented anchors.
 */

import { torrentError, type TorrentResult } from "../errors";
import type { TorrentFileEntry } from "../metadata";

// ---------------------------------------------------------------------------
// The geometry type
// ---------------------------------------------------------------------------

/**
 * The piece geometry of ONE playable file within a torrent: everything
 * the deadline mapping needs to translate file-relative byte ranges into
 * absolute piece indexes.
 */
export interface PlayableFileGeometry {
  /** The file's index in the torrent's ordered file list. */
  readonly fileIndex: number;
  /** The file's DISK-relative path under the session's dataDir. */
  readonly filePath: string;
  /** The file's start offset in the torrent's concatenated byte stream. */
  readonly fileOffsetBytes: number;
  /** The file's length in bytes. */
  readonly fileLengthBytes: number;
  /** The torrent's piece length in bytes. */
  readonly pieceLengthBytes: number;
  /** The torrent's TOTAL piece count (the absolute index domain). */
  readonly totalPieces: number;
}

/** An inclusive absolute piece range. */
export interface PieceSpan {
  readonly fromPiece: number;
  readonly toPiece: number;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Build the geometry of one file from the torrent's file list. Typed
 * rejections: malformed file list, out-of-range index, non-positive piece
 * length/total. The file entry's own offset/length must be sane
 * (non-negative, within the piece domain) — a metainfo that disagrees
 * with its own geometry is rejected, never papered over.
 */
export function geometryForFile(
  files: readonly TorrentFileEntry[],
  fileIndex: number,
  pieceLengthBytes: number,
  totalPieces: number,
): TorrentResult<PlayableFileGeometry> {
  if (!Array.isArray(files)) {
    return torrentError("INVALID_INPUT", {
      detail: "geometryForFile: files must be an array",
    });
  }
  if (typeof fileIndex !== "number" || !Number.isSafeInteger(fileIndex) || fileIndex < 0) {
    return torrentError("INVALID_INPUT", {
      detail: `geometryForFile: fileIndex must be a non-negative safe integer (got ${String(fileIndex)})`,
    });
  }
  if (fileIndex >= files.length) {
    return torrentError("INVALID_INPUT", {
      detail: `geometryForFile: file index ${fileIndex} is out of range (the torrent has ${files.length} file(s))`,
    });
  }
  if (!Number.isSafeInteger(pieceLengthBytes) || pieceLengthBytes <= 0) {
    return torrentError("INVALID_INPUT", {
      detail: `geometryForFile: pieceLengthBytes must be a positive safe integer (got ${String(pieceLengthBytes)})`,
    });
  }
  if (!Number.isSafeInteger(totalPieces) || totalPieces <= 0) {
    return torrentError("INVALID_INPUT", {
      detail: `geometryForFile: totalPieces must be a positive safe integer (got ${String(totalPieces)})`,
    });
  }
  const file = files[fileIndex]!;
  if (
    !Number.isSafeInteger(file.offsetBytes) ||
    file.offsetBytes < 0 ||
    !Number.isSafeInteger(file.lengthBytes) ||
    file.lengthBytes < 0
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `geometryForFile: file '${file.path}' carries malformed geometry (offset ${String(file.offsetBytes)}, length ${String(file.lengthBytes)})`,
    });
  }
  if (file.offsetBytes + file.lengthBytes > totalPieces * pieceLengthBytes) {
    return torrentError("INVALID_INPUT", {
      detail: `geometryForFile: file '${file.path}' extends past the torrent's piece domain (${String(file.offsetBytes + file.lengthBytes)} > ${String(totalPieces * pieceLengthBytes)} bytes)`,
    });
  }
  return {
    ok: true,
    value: {
      fileIndex,
      filePath: file.path,
      fileOffsetBytes: file.offsetBytes,
      fileLengthBytes: file.lengthBytes,
      pieceLengthBytes,
      totalPieces,
    },
  };
}

// ---------------------------------------------------------------------------
// The mapping math (pure)
// ---------------------------------------------------------------------------

/**
 * The absolute piece containing FILE-relative byte `offsetInFile`.
 * Out-of-file offsets are REJECTED (typed) — mapping a byte the file does
 * not own would be a fabricated piece.
 */
export function fileByteToPiece(
  geometry: PlayableFileGeometry,
  offsetInFile: number,
): TorrentResult<number> {
  if (
    typeof offsetInFile !== "number" ||
    !Number.isSafeInteger(offsetInFile) ||
    offsetInFile < 0 ||
    offsetInFile >= geometry.fileLengthBytes
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `fileByteToPiece: offsetInFile must be a safe integer in [0, ${String(geometry.fileLengthBytes)}) (got ${String(offsetInFile)})`,
    });
  }
  return { ok: true, value: Math.floor((geometry.fileOffsetBytes + offsetInFile) / geometry.pieceLengthBytes) };
}

/** The first absolute piece that touches the file (its first byte's piece). */
export function firstPieceOf(geometry: PlayableFileGeometry): number {
  return Math.floor(geometry.fileOffsetBytes / geometry.pieceLengthBytes);
}

/** The last absolute piece that touches the file (its last byte's piece). */
export function lastPieceOf(geometry: PlayableFileGeometry): number {
  if (geometry.fileLengthBytes === 0) return firstPieceOf(geometry);
  const lastByte = geometry.fileOffsetBytes + geometry.fileLengthBytes - 1;
  return Math.min(geometry.totalPieces - 1, Math.floor(lastByte / geometry.pieceLengthBytes));
}

/**
 * The inclusive absolute piece span covering the FILE-relative byte range
 * `[startInFile, startInFile + lengthBytes - 1]`, CLAMPED to the file's
 * own bounds. A range that starts at/after EOF, or a non-positive length,
 * covers NO piece (answers `null` — an honest empty span, never a
 * fabricated one).
 */
export function piecesCoveringFileRange(
  geometry: PlayableFileGeometry,
  startInFile: number,
  lengthBytes: number,
): PieceSpan | null {
  if (typeof startInFile !== "number" || !Number.isFinite(startInFile) || startInFile < 0) return null;
  if (typeof lengthBytes !== "number" || !Number.isFinite(lengthBytes) || lengthBytes <= 0) return null;
  if (startInFile >= geometry.fileLengthBytes) return null;
  const effectiveLength = Math.min(lengthBytes, geometry.fileLengthBytes - startInFile);
  if (effectiveLength <= 0) return null;
  const from = Math.floor((geometry.fileOffsetBytes + startInFile) / geometry.pieceLengthBytes);
  const to = Math.floor(
    (geometry.fileOffsetBytes + startInFile + effectiveLength - 1) / geometry.pieceLengthBytes,
  );
  return {
    fromPiece: Math.max(0, Math.min(geometry.totalPieces - 1, from)),
    toPiece: Math.max(0, Math.min(geometry.totalPieces - 1, to)),
  };
}

/**
 * The FILE-relative byte interval of a piece span's INTERSECTION with the
 * playable file (the honest readable subset — a boundary piece may extend
 * into neighboring files, whose bytes are not this file's to serve).
 */
export function fileBytesIntersectingPieceSpan(
  geometry: PlayableFileGeometry,
  span: PieceSpan,
): { readonly fromByte: number; readonly toByte: number } | null {
  const spanStart = span.fromPiece * geometry.pieceLengthBytes;
  const spanEnd = (span.toPiece + 1) * geometry.pieceLengthBytes;
  const fromByte = Math.max(spanStart, geometry.fileOffsetBytes) - geometry.fileOffsetBytes;
  const toByte = Math.min(spanEnd, geometry.fileOffsetBytes + geometry.fileLengthBytes) - geometry.fileOffsetBytes;
  if (toByte <= fromByte) return null;
  return { fromByte, toByte };
}
