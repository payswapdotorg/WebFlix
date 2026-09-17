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
 *                         recovery extraction (`extractJournalSessions`)
 * - integrity.ts         — `torrentSha256Hex` (the R10-compatible digest
 *                         primitive), `digestFileAtPath`
 * - session.ts           — the honest state machine (the seven states),
 *                         `TorrentSessionStatus` (stall law included)
 * - engine.ts            — `createTorrentEngine` + `TorrentEngine` (the
 *                         facade: ingestion -> selection -> sessions ->
 *                         recovery)
 * - library/webtorrent.ts— the PRODUCTION binding factory
 *                         `createWebTorrentLibrary` over webtorrent@3.0.21
 *                         (PINNED; see that module's evaluation record).
 *                         webtorrent itself is imported LAZILY — importing
 *                         this package never loads its native module.
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
export * from "./integrity";
export * from "./session";
export * from "./engine";
export { createWebTorrentLibrary, WEBTORRENT_LIBRARY_IMPLEMENTATION } from "./library/webtorrent";
export type { WebTorrentLibraryOptions } from "./library/webtorrent";
export type {
  TorrentLibrary,
  LibrarySession,
  LibrarySessionEvent,
  LibrarySessionSnapshot,
  LibrarySessionSpec,
  ParsedMetainfo,
  ParsedMagnet,
  LibraryFileMeta,
} from "./library/contract";
export {
  createTorrentEngineAdapter,
  type TorrentEngineAdapter,
  type TorrentEngineAdapterOptions,
  type LandedTorrentAsset,
} from "./adapter/native-media-adapter";
