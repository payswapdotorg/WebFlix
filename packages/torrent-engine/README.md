# @wfx/torrent-engine

The authorized torrent engine (R11 + R12) behind the native-media boundary:
authorized magnet and `.torrent` ingestion, metadata and file selection,
sessions with honest peer/piece observability, integrity verification,
persistent recovery, the playback-aware piece scheduler (R12), and the
narrow native-media adapter that lands verified assets in the R10 store.
**No UI, no adapter imports, no reimplementation of BitTorrent** — the
protocol lives behind the mature-library seam (invariant 6).

```
Experience Core -> Shared Client Runtime -> Platform Adapter -> Desktop
                                                              |
                                              Native Capability Ports
                                                              |
                                              +---------------+-------------->
                                              |                              |
                                       Local Media Engine (R10)      Torrent Engine (R11)
                                                                            |
                                                             Mature BitTorrent library
                                                                            |
                                                             Piece map / peers / integrity
                                                                            |
                                                              (R12: playback-aware scheduler)
```

## The authorization law (invariant 5 — structural)

Native acquisition is limited to **user-owned, licensed, public-domain,
Creative Commons, or otherwise authorized media**. The engine is
AUTHORIZED-SOURCE-ONLY, and the enforcement is structural, not advisory:

```ts
// The ONLY way to obtain the ingestion argument:
const sources = createAuthorizedSourceRegistry({
  sources: [{ sourceId: "vault:family-media", basis: "user-owned", label: "Family media vault" }],
});
const provenance = authorizeProvenance(sources, "vault:family-media"); // <- the only mint
if (!provenance.ok) { /* a TYPED PROVENANCE_REJECTED rejection — never a warning */ }

const ingestion = await engine.ingestMagnet(magnetUri, provenance.value);
//                                            ^^^^^^^^^^^^^^^^^^^
// AuthorizedProvenance is a branded nominal type: the ingestion APIs cannot
// be called without it (compile-time), and revalidateProvenance() re-checks
// the registry at ingest time (runtime — defense in depth against `as any`).
```

Three layers:
1. **Type-level** — `AuthorizedProvenance` is branded by a module-private
   `unique symbol`; a plain object with the same fields is not assignable.
2. **Mint gate** — `authorizeProvenance` consults the injected
   authorized-source registry; an unknown source is a typed rejection.
3. **Ingest re-validation** — the engine re-validates every provenance at
   ingest time; forged brands with unregistered sources are rejected.

Recovery re-mints the provenance against the **current** registry: a
session whose source lost its authorization fails honestly
(`provenance-revoked`) rather than resuming.

## The mature-library boundary (invariant 6 — the evaluation record)

**Chosen: `webtorrent@3.0.21`** (MIT, the WebTorrent project), pinned
EXACTLY in `package.json`, wrapped behind `src/library/contract.ts` (the
frozen seam: `TorrentLibrary` / `LibrarySession`). The parser is
**`parse-torrent@11.0.24`** (MIT, the same project — webtorrent's own
pinned parser, `^11.0.24` in its dependency list), also pinned exactly.
No other dependencies were added; the seam types are WebFlix-owned, so no
wire-protocol type ever leaks onto the public surface.

Why these pins (the evaluation evidence — see
`tests/library-evaluation.test.ts`):
- webtorrent is the reference Node torrent client (10+ years, MIT, wired
  for both `.torrent` and magnet, DHT/tracker/PEX).
- `webtorrent@2.x` is **incompatible** with parse-torrent >= 11.0.19
  (`arr2hex(parsedTorrent.infoHash)` receives a string; verified: adding a
  torrent throws `ERR_INVALID_ARG_TYPE` under both Bun and Node). v3.0.21
  fixed that line; it is the coherent pin.
- Under **Bun 1.3.x**, the uTP listener trips an unsupported NAPI call
  (`uv_timer_init`, oven-sh/bun#18546) — the binding constructs every
  client with `utp: false` (uTP is an optional transport; TCP/WebRTC are
  unaffected). Verified offline in this sandbox: client construction,
  `add` + `verify: true` over pre-seeded bytes, per-piece `verified`
  events, file `select`/`deselect`, pause/resume, destroy — all green.
- `node-datachannel` (webtorrent's WebRTC stack) is a native module: the
  root `package.json` carries `"trustedDependencies": ["node-datachannel"]`
  so `bun install` fetches its prebuilt. webtorrent is imported ONLY via
  dynamic `import()` inside the binding (`the lazy-import law`), so
  importing `@wfx/torrent-engine` never loads the native module —
  environments without the prebuilt keep parsing + every other surface.
- In TESTS the seam is driven by the deterministic **loopback double**
  (`tests/helpers/loopback-library.ts`): no network, no peers, no timers —
  progression happens only when the test calls `advance()`. Parsing in
  tests goes through the REAL parse-torrent (the same offline code the
  production binding uses).

The honest limitation: the production webtorrent binding's session path
(peer discovery, live swarm behavior) is NOT exercised by the suite (the
no-live-swarm law) — what is exercised offline: the pinned stack's
parsing, client construction, and disk verification of fixture bytes.

## The engine surface

```ts
const engine = createTorrentEngine({
  library: createWebTorrentLibrary(),   // production; tests inject the loopback double
  dataRoot: "<app data dir>/torrents",   // <root>/sessions/<id>/data + torrent-journal.ndjson
  sources,                              // the authorized-source registry (invariant 5)
  stallThresholdMs: 60_000,             // the stall law's threshold
});

const ingestion = await engine.ingestTorrentFile(bytes, provenance.value);
ingestion.value.files;                  // the J22 file list (name/length/offset) BEFORE any transfer
const session = await engine.createSession(ingestion.value.id, {
  selection: { fileIndexes: [0, 2] },   // or filePaths (magnets), or omit = every file
});
const status = engine.status(session.sessionId).value;  // the honest answer (below)
await engine.pause(id); await engine.resume(id); await engine.stop(id);
await engine.recover();                  // journal replay after restart/crash
```

## The honest state machine (the session lifecycle)

```
discovering-metadata -> selecting -> downloading -> verifying -> completed
        |                   |              |             |
        +-----------------> seeding-paused <-----------+
                                  (resume returns to the recorded pre-pause state)
(every live state may transition to failed(reason); completed/failed are terminal)
```

- **`seeding-paused`** is the vocabulary's single paused state (pausing
  during discovery, selection, download, or verification all map here).
- **The stall law**: a `downloading` session with ZERO connected peers for
  longer than the threshold answers `stalled: true` with the honest numbers
  (`peers.connected === 0`, zero rates, the stall duration) — never a bare
  "downloading" that implies progress. The stall clock starts at session
  start when no peer was ever seen.
- Every number in `TorrentSessionStatus` comes from the library's live
  snapshot or the journaled terminal record — peers, per-piece progress,
  selection-relative fractions, rates. Nothing is extrapolated.
- `integrity` uses the R10 verdict vocabulary: `unknown` until every
  selected piece is verified, `verified` on completion, `failed` on
  corruption.

## Integrity (two layers, both over REAL bytes)

1. **Piece hashes per the metainfo** — the mature library's own
   verification (the loopback performs the equivalent SHA-1-per-piece check
   in tests; a scripted corruption fails the session
   `corruption-detected`).
2. **The final whole-asset digest** — SHA-256 over the landed bytes using
   the SAME primitive as the R10 asset store (`Bun.CryptoHasher("sha256")`;
   `torrentSha256Hex === sha256Hex` from the store, byte for byte). A
   completed session records one digest per selected file, derived from
   the bytes actually on disk.

## The recovery discipline (the R10 journal, adapted)

`<dataRoot>/torrent-journal.ndjson` — append-only, one JSON record per
line, monotonic sequence numbers seeded across restarts, torn-tail
tolerance (a partial final line is dropped; the writer repairs the line
boundary so post-crash appends land intact). Record kinds:
`session-started` (identity + **provenance** + dataDir + selection + the
magnet URI or the full metainfo base64), `metadata-resolved` (the magnet
path's file list), `selection-applied` (the resolved "choose file"),
`state-changed`, `progress-checkpoint` (the verified-piece bitfield — the
recovery control point, written on pause/stop/completion and every N
verified pieces), `session-completed` (with the per-file digests),
`session-failed`, `session-stopped`, `engine-evidence`.

`recover()` (idempotent, the R10 laws):
- live sessions return **`seeding-paused`** with their journaled control
  points; `resume()` continues them (the library re-verifies existing disk
  bytes before transferring);
- **terminal stays terminal** — completed sessions restore with their
  digests; failed sessions restore as tombstones;
- **vanished data is an honest failure** — a session whose journal proves
  verified pieces but whose data directory contains no bytes fails
  `data-vanished` with the proof in the detail. NEVER a silent restart
  from zero pretending continuity. (Zero persisted progress + missing
  data = an honest fresh restart — nothing was lost.);
- **invariant 5 survives restarts** — the provenance is re-minted against
  the current registry; revoked sources fail `provenance-revoked`.

## The native-media adapter (the narrow seam)

`createTorrentEngineAdapter({ engine, store })` is the ONLY import path
from torrent-engine into native-media-facing code (enforced by
`tests/import-guard.test.ts`). It lands a **completed, piece-verified
selection** into the REAL R10 asset store (`createAssetStore` from
`@wfx/native-media`) through the store's own `importAsset`
(stream-copy + SHA-256 + full re-hash verification), then
**cross-checks** the engine's recorded digest against the store's own —
both computed over real bytes by the same algorithm; a mismatch refuses
the landing. Landed assets serve through the R10 range gateway exactly
like local files, so the desktop's NATIVE rung plays torrent-acquired
media through the same path (J23/J26). Non-completed sessions are refused
typed — only proven bytes land.

## The boundary guards (lint-visible laws)

`tests/import-guard.test.ts` enforces:
- only `src/adapter/**` imports `@wfx/native-media`;
- no production module imports test support (loopback/fixtures/bencode);
- webtorrent is imported ONLY dynamically (the lazy-import law);
- `@wfx/native-media` never imports `@wfx/torrent-engine` (the freeze's
  layering law);
- the package entry never re-exports test support;
- R12: `src/scheduler/**` imports nothing from `@wfx/*` (the scheduler
  is engine-internal — it feeds sessions and the range-gateway seam
  through the engine facade, never sideways into another package), the
  public entry re-exports the scheduler vocabulary, and the library seam
  carries the piece-priority surface both bindings implement.

## Testing (deterministic, no live swarm)

Loopback-only sessions (no peers, no network, no timers — the test drives
`advance()`), REAL parse-torrent for parsing, REAL R10 store for adapter
landing, REAL webtorrent client for the offline evaluation evidence
(skipped honestly when the native prebuilt is absent). The committed
fixture `.torrent` files under `tests/fixtures/` are generated
deterministically (`bun tests/fixtures/generate.ts`) — the drift test
asserts byte-stable regeneration, and the suite parses every committed
file through the real mature library.

## The playback-aware scheduler (R12 — delivered)

`engine.playback` is the surface the R10 native-media range gateway
consumes. The player's byte-range requests flow
`player -> R10 range gateway -> engine.playback (deadline mapping) ->
piece priorities -> swarm`, and gateway reads flow back through
integrity-gated ordered reads:

```ts
// The host declares playback (never inferred from reads):
engine.playback.command(sessionId, {
  kind: "start",              // | "progress" | "seek" | "stop"
  positionBytes: 0,           // playhead within the playable file
  bytesPerSecond: 250_000,    // real consumption velocity
}, { fileIndex: 0 });         // default: the first SELECTED file

// The gateway's observed demand (byte ranges + deadlines):
engine.playback.noteRangeRequests(sessionId, [
  { offsetBytes: 1_048_576, lengthBytes: 65536, deadlineMs: Date.now() + 5_000 },
]);

// The truthful buffering answer (what it refuses to fabricate):
const truth = engine.playback.truth(sessionId);
// truth.runway.seconds        — VERIFIED CONTIGUOUS seconds ahead (a
//                               single unverified piece stops it dead)
// truth.deadlinesAtRisk       — windows the current rate cannot meet,
//                               with the honest arithmetic (ETA absent
//                               when the rate is 0 — never invented)
// truth.stall.kind            — "slow-swarm" | "no-completion-path" | "none"
// truth.playableNow           — the bytes at the playhead are verified

// The ordered integrity-gated read (R11's verdict discipline gates what
// the player consumes; watch-order arrival is readable mid-download):
const bytes = await engine.playback.readVerifiedRange(
  sessionId,
  { offsetBytes: 0, lengthBytes: 16384 },
); // UNVERIFIED_RANGE (retryable) names the missing pieces otherwise

// The host-owned cadence (no hidden timers):
engine.playback.tick();
```

The window model (pure, in `src/scheduler/windows.ts`): the **startup
window** (`[P, P + V*startupTargetSeconds)` at urgency 4), the
**steady-state runway** (`[P, P + V*steadyRunwaySeconds)` at urgency 3),
the **seek burst** (`seekBurstPieces` pieces from the target at
critical urgency 5, clamped to the playable file's last piece), and the
**player's explicit range requests** (critical urgency 5, carrying their
own deadlines). Outside active playback (idle / background-completion /
a paused torrent session) the priorities are cleared — the mature
library's own selection order IS the completion fallback (invariant 6:
no re-implementation of piece picking; the webtorrent binding maps
urgency onto its own `select(range, priority)` + `critical`).

The scheduler state machine (pure, in `src/scheduler/state-machine.ts`):
`idle -> startup -> steady <-> seeking -> background-completion`, with
fact-driven transitions (startup→steady only when the startup window's
pieces are all VERIFIED; seeking→steady only when the burst is) and
typed refusals for illegal host commands.

The config surface (validated, no hidden magic):
`{ startupTargetSeconds: 8, steadyRunwaySeconds: 30, seekBurstPieces: 8 }`
— overridable via `createTorrentEngine({ schedulerConfig })`.

**The desktop seam (R13/R14 wiring point)**: the desktop binding's
documented R12 seams — `rangeAccess: EngineRangeChannel` and
`deadlineMapper` — bind to `engine.playback.readVerifiedRange` and the
byte-range demand surface above (see
`apps/desktop/src/platform/native-media-binding.ts`'s "SEAMS R10/R12
PLUG INTO"). The adapter's completed-session landing is deliberately
UNCHANGED: only proven bytes land in the store; live playback reads
flow through `engine.playback`, integrity-gated.

## What R13/R14 consume

- **R13** (persistence/recovery deepening): the journal + `recover()` are
  the control-point contract; `engine.status()` and the terminal digests
  are the "Ready offline" evidence. Scheduler state is deliberately NOT
  journaled — playback intent does not survive restarts; a fresh command
  on a recovered session starts a fresh scheduler (R13 may revisit).
- **R14** (acquisition UX): the seven-state session machine + stall law +
  `TorrentSessionStatus` are the product states; the R12 truth surface
  (`engine.playback.truth()`) is the honest Buffering/Playing evidence,
  and the scheduler states map onto Preparing/Buffering/Playing/
  Completing. Torrent jargon stays here (the advanced diagnostic
  surface).
- The DESKTOP composition root wires:
  `createTorrentEngine({ library: createWebTorrentLibrary(), sources, dataRoot })`
  and hands the adapter the engine service's own store; the range
  gateway binds `engine.playback` per the seam above.

## Notes for the lead (ratification items)

- The frozen domain sketch (`packages/domain/src/contracts/frozen.ts`,
  "Torrent engine" section) carries a legacy `TorrentEngine` interface
  with an `authorized: boolean` flag and a different state union. R11's
  surface follows the remediation dispatch's vocabulary (the branded
  provenance structurally replaces the boolean; the seven-state machine
  replaces `TorrentState`). Mapping R11 onto that legacy sketch — or
  retiring it — is a lead-owned contract decision.
- `parse-torrent` is a DIRECT dependency: it is webtorrent's own pinned
  parser (same project, MIT), used at the seam so parsing never loads the
  native module. Flagged for ratification per the "no new dependencies
  beyond the evaluated mature library" drift rule.
- The lane/contract checkers needed no changes (the new package follows
  the workspace patterns; `trustedDependencies` was added to the root
  `package.json` for `node-datachannel` — minimal root wiring).
