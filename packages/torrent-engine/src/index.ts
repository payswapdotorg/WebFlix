/**
 * @wfx/torrent-engine — public entry (R11, Lane: native media).
 *
 * THE PUBLIC SURFACE speaks WebFlix types ONLY (sessions, selections,
 * verdicts — no wire-protocol types leak; the mature-library seam
 * (`library/contract.ts`) is exposed as a CONSTRUCTOR DEPENDENCY type so
 * the desktop composition root can inject the production binding, but no
 * webtorrent/parse-torrent type ever appears here).
 *
 * Import ONLY from "@wfx/torrent-engine" (the lane law).
 *
 * - errors.ts            — `TorrentErrorCode` taxonomy, `TorrentEngineError`,
 *                         `TorrentResult<T>` envelope, retryability,
 *                         `InvalidTorrentTransitionError`
 * - provenance.ts        — invariant 5: `AuthorizedProvenance` (branded),
 *                         the authorized-source registry, the mint
 *                         `authorizeProvenance` + `revalidateProvenance`
 * - metadata.ts          — `TorrentMetainfo`, `TorrentFileEntry`,
 *                         `TorrentMagnetInfo` (+ the total seam mappers)
 * - selection.ts         — J22's "choose file": `validateSelection`,
 *                         `planSelection` (file -> piece ranges)
 * - journal.ts           — the append-only session journal + the PURE
 *                         recovery extraction (`extractJournalSessions`);
 *                         R13: the `scheduler-checkpoint` + `asset-exposed`
 *                         records, the ATOMIC compaction rotation
 *                         (`selectCompactionKeepers` — fold-equivalence
 *                         is a tested property), torn-tail tolerance
 * - integrity.ts         — `torrentSha256Hex` (the R10-compatible digest
 *                         primitive), `digestFileAtPath`
 * - persistence.ts       — R13's persistence/recovery core (pure): the
 *                         library-exposure fold `extractExposedAssets`
 *                         (one exposure per identity key — the R04
 *                         canonical composition, duplicates latest-wins),
 *                         `schedulerRearmInputsFromRecord` (the validated
 *                         re-arm inputs), `offlineReadyIdentityKey`
 * - session.ts           — the honest state machine (the seven states),
 *                         `TorrentSessionStatus` (stall law included)
 * - scheduler/**         — R12's playback-aware scheduler: the config
 *                         surface (startup target / steady runway / seek
 *                         burst), the byte↔piece geometry map, the pure
 *                         deadline mapping (startup / runway / seek /
 *                         range-request windows over the completion
 *                         fallback), the idle→startup→steady→seeking→
 *                         background-completion state machine, the
 *                         truthful buffering surface (runway seconds,
 *                         deadlines at risk, slow-swarm vs
 *                         no-completion-path stall kinds), and the
 *                         ordered integrity-gated reads. Surfaced through
 *                         `engine.playback` (the R10 range-gateway seam).
 * - engine.ts            — `createTorrentEngine` + `TorrentEngine` (the
 *                         facade: ingestion -> selection -> sessions ->
 *                         recovery -> playback scheduling)
 * - library/webtorrent.ts— the PRODUCTION binding factory
 *                         `createWebTorrentLibrary` over webtorrent@3.0.21
 *                         (PINNED; see that module's evaluation record).
 *                         webtorrent itself is imported LAZILY — importing
 *                         this package never loads its native module.
 *                         R12: the binding maps piece-priority hints onto
 *                         webtorrent's own `select(range, priority)` +
 *                         `critical` mechanisms (invariant 6 — no
 *                         re-implementation of piece picking).
 * - adapter/native-media-adapter.ts — `createTorrentEngineAdapter`: the
 *                         ONLY import path into @wfx/native-media (the
 *                         narrow seam; enforced by the import guard test)
 *
 * NOT exported from here (TEST/DEV only): the deterministic loopback
 * double (`tests/helpers/loopback-library.ts`) — production paths never
 * import test support (the R10 law).
 */

export * from "./errors";
export * from "./provenance";
export * from "./metadata";
export * from "./selection";
export * from "./journal";
export * from "./persistence";
export * from "./integrity";
export * from "./session";
export * from "./engine";
export {
  // The scheduler's PUBLIC VALUE surface (the TYPE vocabulary travels with
  // the engine facade's own re-exports — same barrel, same symbols):
  // consumers schedule playback through `engine.playback` and import from
  // "@wfx/torrent-engine" (the lane law).
  DEFAULT_PLAYBACK_SCHEDULER_CONFIG,
  validatePlaybackSchedulerConfig,
  PIECE_URGENCY,
  PLAYBACK_SCHEDULER_STATES,
  ALLOWED_PLAYBACK_SCHEDULER_TRANSITIONS,
  isPlaybackSchedulerState,
  canTransitionPlaybackSchedulerState,
  PlaybackSchedulerFsm,
  InvalidPlaybackSchedulerTransitionError,
  geometryForFile,
  fileByteToPiece,
  firstPieceOf,
  lastPieceOf,
  piecesCoveringFileRange,
  fileBytesIntersectingPieceSpan,
  computeStartupWindow,
  computeRunwayWindow,
  computeSeekWindows,
  computeRangeRequestWindow,
  computePlaybackWindows,
  windowSatisfied,
  computePlaybackTruth,
  readVerifiedFileRange,
} from "./scheduler";
export { createWebTorrentLibrary, WEBTORRENT_LIBRARY_IMPLEMENTATION } from "./library/webtorrent";
export type { WebTorrentLibraryOptions } from "./library/webtorrent";
export type {
  TorrentLibrary,
  LibrarySession,
  LibrarySessionEvent,
  LibrarySessionSnapshot,
  LibrarySessionSpec,
  LibraryPiecePriority,
  ParsedMetainfo,
  ParsedMagnet,
  LibraryFileMeta,
} from "./library/contract";
export {
  createTorrentEngineAdapter,
  type TorrentEngineAdapter,
  type TorrentEngineAdapterOptions,
  type LandedTorrentAsset,
  type LibraryIdentityInput,
  type OfflineReadyTorrentAsset,
  type OfflineReadyAsset,
  type OfflineReadyEntry,
} from "./adapter/native-media-adapter";
