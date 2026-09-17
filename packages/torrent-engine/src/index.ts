/**
 * @wfx/torrent-engine — public entry (R11).
 *
 * THE TORRENT ENGINE for WebFlix's native-media path: authorized magnet
 * and `.torrent` ingestion, metadata, file selection, sessions, peer/
 * piece state, integrity verification, pause/resume, persistent recovery,
 * and a narrow native-media adapter. The BitTorrent protocol lives
 * INSIDE the wrapper (invariant 6) — the package's PUBLIC surface
 * speaks WebFlix types only (sessions, selections, verdicts — no
 * wire-protocol types leak).
 *
 * SURFACE (all re-exported here; import ONLY from "@wfx/torrent-engine"):
 *
 * - `errors.ts`        — `TorrentEngineError`, `TorrentEngineErrorCode`,
 *                        the retryability table, type guards, convenience
 *                        constructors.
 * - `provenance.ts`   — `Provenance` (branded nominal type), the closed
 *                        `AuthorizationKind` vocabulary, the structural
 *                        enforcement of invariant 5 (the public ingestion
 *                        API cannot construct an ingestion without a
 *                        provenance — TypeScript rejects it).
 * - `metadata.ts`     — `parseMagnetUri`, `parseTorrentFile` (wrapped
 *                        behind the mature `parse-torrent` library),
 *                        `TorrentMetadata`, `TorrentFileMetadata`.
 * - `session.ts`      — the session state machine (the frozen
 *                        `TorrentState` union's transition table) +
 *                        `HonestTorrentStatus` (the runtime projection
 *                        that names the stall truthfully).
 * - `backend.ts`      — `BitTorrentBackend` (the mature-library boundary),
 *                        `LoopbackBitTorrentBackend` (the TEST/DEV default
 *                        — deterministic, no network), `LoopbackFixture`.
 * - `journal.ts`      — the append-only recovery journal (the R10
 *                        discipline mirrored): `createTorrentJournal`,
 *                        `extractRecoverableSessions`, record shapes.
 * - `engine.ts`       — `createTorrentEngine`, `TorrentEngineSurface`
 *                        (the frozen `TorrentEngine` + additive
 *                        observability + recovery + verified-asset read).
 * - `adapter.ts`      — `createTorrentEngineAdapter` (the ONLY import
 *                        path from torrent-engine into native-media-facing
 *                        code — feeds verified assets into the R10 asset
 *                        store; boundary-guard enforced).
 *
 * DOMAIN TYPES (`TorrentEngine`, `TorrentSession`, `TorrentFile`,
 * `TorrentSource`, `TorrentState`) come from `@wfx/domain`, the frozen
 * public entry — never deep paths.
 *
 * THE LIBRARY PIN (invariant 6's documentation):
 *
 * The mature BitTorrent protocol implementation is `parse-torrent`
 * (v11.0.24, MIT — the parsing sub-package of `webtorrent`, the primary
 * candidate evaluated for the engine). The PARSE primitives (magnet URIs
 * + `.torrent` metainfo) are used DIRECTLY by `metadata.ts`. The SWARM
 * primitives (peer discovery, piece exchange, integrity) are abstracted
 * behind `BitTorrentBackend`; the production deployment wires
 * `webtorrent`'s `WebTorrent` class behind the interface (R12+ sandbox
 * limitation: webtorrent's optional `node_datachannel` native module does
 * not build in this sandbox; the loopback is the default backend, with
 * the documented testing mode described in the README).
 *
 * The frozen `TorrentSource` interface (from `@wfx/domain`) carries an
 * `authorized: boolean` field; the engine's public API
 * (`ingestMagnet`/`ingestTorrentFile`) STRUCTURALLY ENFORCES
 * authorization through the `Provenance` branded type, deriving
 * `authorized: true` at the seam (invariant 5's structural + runtime
 * enforcement).
 */

export * from "./errors";
export * from "./provenance";
export * from "./metadata";
export * from "./session";
export * from "./backend";
export * from "./journal";
export * from "./engine";
export * from "./adapter";
