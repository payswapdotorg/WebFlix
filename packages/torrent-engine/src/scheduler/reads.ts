/**
 * @wfx/torrent-engine — ordered integrity-gated reads (R12).
 *
 * THE RANGE-GATEWAY COMPOSITION LAW (the dispatch): "the scheduler wires
 * into R11's adapter so R10 range-gateway reads still succeed when pieces
 * arrive in watch order (ordered reading of a partially-complete session
 * with integrity-gated reads)."
 *
 * What that means concretely: the player's byte-range requests flow
 * player -> R10 range gateway -> HERE. A read succeeds ONLY when every
 * piece covering the requested range is VERIFIED against the metainfo
 * hashes (the library's own bitfield — R11's verdict discipline carried
 * through): playback may consume bytes in WATCH ORDER, but integrity
 * still gates what the player consumes. There is no path that serves
 * unverified bytes, and no path that pretends a range is present when its
 * pieces are not.
 *
 * The bytes are the REAL on-disk files the library owns (the same
 * `<dataDir>/<file.path>` layout R11's digest pass reads) — reads compose
 * with completion: a session that finished verifying answers every
 * in-file range; a partially-complete session answers exactly its
 * verified prefix (and any verified ranges the scheduler landed out of
 * order, e.g. a seek burst).
 */

import { open } from "node:fs/promises";

import { torrentError, type TorrentResult } from "../errors";
import {
  piecesCoveringFileRange,
  type PlayableFileGeometry,
} from "./geometry";
import { bitHas } from "../session";

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * Read `[offsetBytes, offsetBytes + lengthBytes)` of the playable file's
 * REAL bytes — iff every covering piece is verified. Typed refusals:
 * - `INVALID_INPUT`  — malformed range (negative offset, zero/negative
 *   length, past EOF);
 * - `UNVERIFIED_RANGE` — the range covers pieces not yet verified (the
 *   honest missing-piece list rides along; retryable — the same read
 *   succeeds once the swarm delivers);
 * - `IO_ERROR`        — the on-disk read failed.
 */
export async function readVerifiedFileRange(input: {
  readonly geometry: PlayableFileGeometry;
  readonly dataDir: string;
  /** The live verified-piece bitfield (undefined when no library session exists). */
  readonly bitfield: Uint8Array | undefined;
  /** Whether the session completed (every selected piece verified + digested). */
  readonly sessionCompleted: boolean;
  readonly offsetBytes: number;
  readonly lengthBytes: number;
}): Promise<TorrentResult<Uint8Array>> {
  const { geometry, offsetBytes, lengthBytes } = input;
  if (
    typeof offsetBytes !== "number" ||
    !Number.isSafeInteger(offsetBytes) ||
    offsetBytes < 0
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `readVerifiedRange: offsetBytes must be a non-negative safe integer (got ${String(offsetBytes)})`,
    });
  }
  if (
    typeof lengthBytes !== "number" ||
    !Number.isSafeInteger(lengthBytes) ||
    lengthBytes < 1
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `readVerifiedRange: lengthBytes must be a safe integer >= 1 (got ${String(lengthBytes)})`,
    });
  }
  if (offsetBytes + lengthBytes > geometry.fileLengthBytes) {
    return torrentError("INVALID_INPUT", {
      detail: `readVerifiedRange: [${String(offsetBytes)}, ${String(offsetBytes + lengthBytes)}) extends past the playable file's end (${String(geometry.fileLengthBytes)} bytes)`,
    });
  }
  const span = piecesCoveringFileRange(geometry, offsetBytes, lengthBytes);
  if (span === null) {
    return torrentError("INVALID_INPUT", {
      detail: `readVerifiedRange: the range covers no piece of the playable file`,
    });
  }

  // THE INTEGRITY GATE: every covering piece verified, or the read is
  // refused with the honest missing list. A completed session has every
  // selected piece verified by construction (R11's terminal law).
  if (!input.sessionCompleted) {
    if (input.bitfield === undefined) {
      return torrentError("UNVERIFIED_RANGE", {
        detail:
          `readVerifiedRange: pieces ${String(span.fromPiece)}-${String(span.toPiece)} cover [${String(offsetBytes)}, ${String(offsetBytes + lengthBytes)}) ` +
          "but no live piece state exists to verify them against — nothing is readable yet",
      });
    }
    const missing: number[] = [];
    for (let piece = span.fromPiece; piece <= span.toPiece; piece += 1) {
      if (!bitHas(input.bitfield, piece)) missing.push(piece);
    }
    if (missing.length > 0) {
      const shown = missing.slice(0, 8).map((p) => String(p)).join(", ");
      const more = missing.length > 8 ? ` (+${String(missing.length - 8)} more)` : "";
      return torrentError("UNVERIFIED_RANGE", {
        detail:
          `readVerifiedRange: [${String(offsetBytes)}, ${String(offsetBytes + lengthBytes)}) covers unverified piece(s) ${shown}${more} — ` +
          "playback cannot consume unverified bytes; the scheduler prioritizes these pieces and the read succeeds once they verify",
      });
    }
  }

  // The real bytes, from the library's own layout on disk.
  const target = `${input.dataDir}/${geometry.filePath}`;
  let handle;
  try {
    handle = await open(target, "r");
  } catch (e) {
    return torrentError("IO_ERROR", {
      detail: `readVerifiedRange: opening '${geometry.filePath}' failed: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
  const out = new Uint8Array(lengthBytes);
  try {
    let totalRead = 0;
    while (totalRead < lengthBytes) {
      const { bytesRead } = await handle.read(
        out,
        totalRead,
        lengthBytes - totalRead,
        offsetBytes + totalRead,
      );
      if (bytesRead === 0) {
        return torrentError("IO_ERROR", {
          detail:
            `readVerifiedRange: '${geometry.filePath}' ended early at ${String(offsetBytes + totalRead)} ` +
            `(expected ${String(lengthBytes)} bytes from ${String(offsetBytes)}) — the on-disk bytes disagree with the verified piece state`,
        });
      }
      totalRead += bytesRead;
    }
  } catch (e) {
    return torrentError("IO_ERROR", {
      detail: `readVerifiedRange: reading '${geometry.filePath}' failed: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  } finally {
    try {
      await handle.close();
    } catch {
      // best-effort close; the read already succeeded or failed honestly
    }
  }
  return { ok: true, value: out };
}
