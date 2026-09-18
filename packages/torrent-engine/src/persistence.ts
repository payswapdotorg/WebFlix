/**
 * @wfx/torrent-engine — the R13 persistence/recovery core (pure).
 *
 * THE MODULE OWNS the three pure folds + validators the R13 laws are
 * built on (the `extractJournalSessions` precedent — recovery extraction
 * is PURE, a function of the record list):
 *
 * 1. `extractExposedAssets` — the library-exposure fold: the CURRENT
 *    offline-ready set, one exposure per IDENTITY KEY (the R04 canonical
 *    composition when the caller supplied it, the session identity
 *    otherwise), the latest exposure winning — NO DUPLICATE CANONICAL
 *    IDENTITY ever surfaces from the journal.
 * 2. `schedulerRearmInputsFromRecord` — the validated re-arm inputs for
 *    the R12 playback scheduler (total for garbage: malformed checkpoints
 *    are typed `INVALID_INPUT` rejections, never silent skips).
 * 3. `offlineReadyIdentityKey` — the canonical key composition (R04's
 *    `(effective profile, canonical item)` discipline; the desktop
 *    composition root derives both from the R04 library keys when it
 *    composes the exposure call).
 *
 * THE STATE CONTRACT R14 CONSUMES (documented for the lead):
 * - `engine.recover()` — what resumed: recovered sessions (journaled
 *   control point + DISK-verified pieces + `pieceMapReused`), the re-armed
 *   schedulers (state + playhead), and the honest refusals.
 * - `engine.status(id).state` — the seven honest session states.
 * - `engine.playback.state/truth/windows` — the R12 scheduling truth.
 * - `adapter.listOfflineReady()` — the offline-ready entries (the R14
 *   `Ready offline` state is EARNED here: every entry's bytes were
 *   integrity-verified at exposure and carry a live store verdict).
 *
 * This module imports NOTHING from @wfx/* (engine-internal lane law —
 * the same law `src/scheduler/**` follows; enforced by the import guard).
 */

import { torrentError, type TorrentResult } from "./errors";
import type {
  JournalAssetExposedRecord,
  JournalSchedulerCheckpointRecord,
  TorrentJournalRecord,
} from "./journal";
import type { AuthorizedProvenanceBasis } from "./provenance";
import { isPlaybackSchedulerState, type PlaybackSchedulerState } from "./scheduler/state-machine";
import type { TrackedRangeRequest } from "./scheduler/windows";

// ---------------------------------------------------------------------------
// The exposure fold (the library-exposure truth)
// ---------------------------------------------------------------------------

/** One exposed asset file, as the fold answers it. */
export interface ExposedTorrentAssetFile {
  /** The R10 store's asset identity (path-derived, deterministic). */
  readonly assetId: string;
  /** The torrent-relative source path that was landed. */
  readonly sourcePath: string;
  /** Where the store owns the bytes (absolute content path). */
  readonly contentPath: string;
  /** Size in bytes as recorded at exposure. */
  readonly sizeBytes: number;
  /** SHA-256 hex digest (matches the session's completed-digest record). */
  readonly sha256: string;
  /** The recorded content type, when one was given. */
  readonly contentType?: string;
}

/**
 * One durable library exposure, as folded from the journal: a completed
 * session's verified assets handed to the Library as offline-ready
 * entries, with the authorization provenance and (when composed) the R04
 * canonical identity.
 */
export interface ExposedTorrentExposure {
  /** The journal sequence of the exposure record (ordering proof). */
  readonly seq: number;
  /** Wall-clock epoch ms when the exposure landed. */
  readonly exposedAt: number;
  /** The engine session that produced the bytes. */
  readonly sessionId: string;
  /** v1 infohash (lowercase hex). */
  readonly infoHash: string;
  /** The authorization provenance — the JOURNALED session's own fact. */
  readonly provenance: {
    readonly sourceId: string;
    readonly basis: AuthorizedProvenanceBasis;
  };
  /** The R04 canonical-identity composition, when the caller supplied it. */
  readonly library?: {
    readonly profileKey: string;
    readonly canonicalItemId: string;
  };
  /** Every landed file of this exposure batch (atomic — all or nothing). */
  readonly assets: readonly ExposedTorrentAssetFile[];
}

/**
 * The offline-ready IDENTITY KEY — the R04 canonical-key composition:
 * `(effective profile, canonical item)` when the exposure composed a
 * library identity (ONE entry per canonical identity — the same law as
 * R04's one-row-per-(profile, item)); the session identity otherwise (an
 * exposure that claims no canonical identity never collides with one that
 * does — honest, never silently merged).
 */
export function offlineReadyIdentityKey(exposure: {
  readonly sessionId: string;
  readonly library?: { readonly profileKey: string; readonly canonicalItemId: string };
}): string {
  if (exposure.library !== undefined) {
    return `canonical:${exposure.library.profileKey}::${exposure.library.canonicalItemId}`;
  }
  return `session:${exposure.sessionId}`;
}

/**
 * PURE: fold the journal into the CURRENT offline-ready exposures — one
 * exposure per identity key, the LATEST exposure winning (a re-exposure
 * of the same canonical identity replaces the earlier realization's
 * assets, mirroring R04's primary-realization-updates-to-latest-save law).
 * Records are processed in journal (seq) order; a torn exposure tail
 * never parses, so a crashed exposure NEVER surfaces (all-or-nothing).
 */
export function extractExposedAssets(
  records: readonly TorrentJournalRecord[],
): ExposedTorrentExposure[] {
  const byKey = new Map<string, ExposedTorrentExposure>();
  for (const record of records) {
    if (record.type !== "asset-exposed") continue;
    byKey.set(offlineReadyIdentityKey(record), exposedViewOf(record));
  }
  return [...byKey.values()];
}

/** Map one journal exposure record onto the public view (pure). */
function exposedViewOf(record: JournalAssetExposedRecord): ExposedTorrentExposure {
  return {
    seq: record.seq,
    exposedAt: record.at,
    sessionId: record.sessionId,
    infoHash: record.infoHash,
    provenance: {
      sourceId: record.provenance.sourceId,
      basis: record.provenance.basis,
    },
    ...(record.library !== undefined ? { library: record.library } : {}),
    assets: record.assets.map((asset) => ({
      assetId: asset.assetId,
      sourcePath: asset.sourcePath,
      contentPath: asset.contentPath,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      ...(asset.contentType !== undefined ? { contentType: asset.contentType } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// The scheduler re-arm inputs (validated, total for garbage)
// ---------------------------------------------------------------------------

/**
 * The validated inputs that re-arm the R12 playback scheduler after a
 * restart: everything the scheduler's plan is a pure function of. `idle`
 * is excluded — an idle checkpoint carries no playback intent to re-arm
 * (the R11 law: a stopped session's playback intent does not survive).
 */
export interface SchedulerRearmInputs {
  readonly schedulerState: Exclude<PlaybackSchedulerState, "idle">;
  readonly fileIndex?: number;
  readonly positionBytes?: number;
  readonly bytesPerSecond?: number;
  readonly seekTargetBytes?: number;
  readonly rangeRequests: readonly TrackedRangeRequest[];
}

/**
 * PURE + TOTAL: derive the validated re-arm inputs from a journaled
 * scheduler checkpoint. Malformed fields are typed `INVALID_INPUT`
 * rejections — a corrupted checkpoint is NEVER silently skipped (the
 * recovery report surfaces the refusal honestly).
 */
export function schedulerRearmInputsFromRecord(
  record: JournalSchedulerCheckpointRecord,
): TorrentResult<SchedulerRearmInputs> {
  if (!isPlaybackSchedulerState(record.schedulerState)) {
    return torrentError("INVALID_INPUT", {
      detail:
        `scheduler re-arm: the checkpoint's scheduler state '${String(record.schedulerState)}' ` +
        "is not a playback scheduler state (the journal record is malformed)",
    });
  }
  if (record.schedulerState === "idle") {
    return torrentError("INVALID_INPUT", {
      detail:
        "scheduler re-arm: an idle checkpoint carries no playback intent to re-arm " +
        "(the session was stopped — restart honestly starts a fresh scheduler)",
    });
  }
  if (record.fileIndex !== undefined && (!Number.isSafeInteger(record.fileIndex) || record.fileIndex < 0)) {
    return torrentError("INVALID_INPUT", {
      detail: `scheduler re-arm: fileIndex must be a non-negative safe integer (got ${String(record.fileIndex)})`,
    });
  }
  if (
    record.positionBytes !== undefined &&
    (!Number.isSafeInteger(record.positionBytes) || record.positionBytes < 0)
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `scheduler re-arm: positionBytes must be a non-negative safe integer (got ${String(record.positionBytes)})`,
    });
  }
  if (
    record.bytesPerSecond !== undefined &&
    (typeof record.bytesPerSecond !== "number" ||
      !Number.isFinite(record.bytesPerSecond) ||
      record.bytesPerSecond <= 0)
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `scheduler re-arm: bytesPerSecond must be a finite number > 0 (got ${String(record.bytesPerSecond)})`,
    });
  }
  if (
    record.seekTargetBytes !== undefined &&
    (!Number.isSafeInteger(record.seekTargetBytes) || record.seekTargetBytes < 0)
  ) {
    return torrentError("INVALID_INPUT", {
      detail: `scheduler re-arm: seekTargetBytes must be a non-negative safe integer (got ${String(record.seekTargetBytes)})`,
    });
  }
  const requests: TrackedRangeRequest[] = [];
  for (const request of record.rangeRequests ?? []) {
    if (
      !Number.isSafeInteger(request.offsetBytes) || request.offsetBytes < 0 ||
      !Number.isSafeInteger(request.lengthBytes) || request.lengthBytes < 1 ||
      typeof request.deadlineMs !== "number" || !Number.isFinite(request.deadlineMs) ||
      typeof request.receivedAtMs !== "number" || !Number.isFinite(request.receivedAtMs)
    ) {
      return torrentError("INVALID_INPUT", {
        detail:
          "scheduler re-arm: a tracked range request is malformed " +
          "(expected { offsetBytes >= 0, lengthBytes >= 1, deadlineMs finite, receivedAtMs finite })",
      });
    }
    requests.push({
      offsetBytes: request.offsetBytes,
      lengthBytes: request.lengthBytes,
      deadlineMs: request.deadlineMs,
      receivedAtMs: request.receivedAtMs,
    });
  }
  return {
    ok: true,
    value: {
      schedulerState: record.schedulerState,
      ...(record.fileIndex !== undefined ? { fileIndex: record.fileIndex } : {}),
      ...(record.positionBytes !== undefined ? { positionBytes: record.positionBytes } : {}),
      ...(record.bytesPerSecond !== undefined
        ? { bytesPerSecond: record.bytesPerSecond }
        : {}),
      ...(record.seekTargetBytes !== undefined
        ? { seekTargetBytes: record.seekTargetBytes }
        : {}),
      rangeRequests: requests,
    },
  };
}
