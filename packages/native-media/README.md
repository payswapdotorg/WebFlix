# @wfx/native-media

The native media DOMAIN SERVICE behind the platform adapter's port
(the frozen `NativeMediaPort`): local playback, local storage, range
access, scheduling, persistence, and recovery. **No UI, no adapter
imports, no React, no torrent logic** — layering law:
`Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)`.

Since R10 this package contains the **PRODUCTION PATH** — a real,
spawnable engine service process over real files and real bytes —
alongside the frozen WFX-004/014/015/023/024 surfaces it builds on.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  THE PRODUCTION PATH (R10): src/service-process/                          │
│                                                                           │
│   wire (stdio JSON lines, v1 DTO)                                         │
│     │ EngineCommand                                       EngineEvent     │
│     ▼                                                       ▲             │
│   main.ts ── dispatch ──> service.ts (the host) ── acks ────┘             │
│     │                       │                                             │
│     │                       ├── engine.ts  THE REAL ENGINE                │
│     │                       │    local-file sessions · real reads ·      │
│     │                       │    SHA-256 integrity · background lane     │
│     │                       │                                             │
│     │                       ├── store.ts   ASSET STORE                    │
│     │                       │    assets/<id>/{content.bin,meta.json}     │
│     │                       │    digests · quota · no silent state       │
│     │                       │                                             │
│     │                       ├── journal.ts SESSION JOURNAL                │
│     │                       │    append-only ndjson · torn-tail replay   │
│     │                       │                                             │
│     │                       ├── gateway.ts PRODUCTION RANGE GATEWAY       │
│     │                       │    loopback HTTP · /media/<assetId>        │
│     │                       │    Range/ETag/416 over the real bytes      │
│     │                       │                                             │
│     │                       └── WFX-024 driver + translated WFX-023      │
│     │                            scheduler (the R11/R12 seams)           │
│     │                                                                      │
│     └── process.ts  the child-process transport (Bun.spawn,              │
│                     in-order acks, the crash law)                        │
└──────────────────────────────────────────────────────────────────────────┘
```

## The service entry (spawn contract)

`src/service-process/main.ts` is the SPAWNABLE entry the R08 desktop
binding talks to (through the shell's engine relay or the package-local
child-process transport):

- **Wire**: the frozen v1 DTO protocol (`engine/process.ts`) over stdio
  as JSON lines — one `EngineCommand` per stdin line; the acknowledgment
  (a `state-changed` ack or a typed `error` DTO) answers on stdout;
  spontaneous `progress`/`buffered`/`state-changed` telemetry flows on
  the same stream.
- **Config**: `WFX_ENGINE_CONFIG` (JSON `EngineConfig`); optional
  `WFX_ENGINE_TUNABLES` (JSON, partial engine config) shapes the engine.
  Malformed config/tunables ⇒ one v1 `error` event + exit 2.
- **Discovery**: `engine-info.json` under the cache dir records the
  protocol version, the pid, and the gateway port/base URL.
- **Shutdown**: the v1 wire has no shutdown command (the frozen six) —
  the spec's `shutdown`/EOF maps to stdin EOF and SIGTERM/SIGINT, both
  graceful (journal evidence + exit 0).
- **Crash law (v1 rule 3)**: a malformed inbound frame (bad JSON, a
  failed command guard, an unknown protocol version) journals every live
  session `failed` with the honest detail, emits ONE `error` event, and
  exits 1 — the process is honestly poisoned, never a zombie.

## The wire protocol + the integrity extension

The v1 protocol is extended with the **lead-authorized** `integrity`
field on `EngineSessionDto`: `integrity?: "unknown" | "verified" |
"failed"` (the frozen `NativeMediaSession.integrity` union). The field
is OPTIONAL-ADDITIVE: legacy six-field DTOs still pass every runtime
guard, legacy receivers ignore the extra field, and therefore
**`PROTOCOL_VERSION` stays 1** (the module's own rule: bump only on a
BREAKING change). This closes the R08-escalated gap — bindings no longer
need to derive verdicts from `complete`/`VERIFICATION_FAILED` alone.

`verified` is emitted ONLY when the full asset hash matched its recorded
digest; `failed` on mismatch; `unknown` until proven (never a fabricated
claim).

## The real engine (honesty laws)

1. **No fake buffering**: `bufferedMs` advances only as bytes actually
   land — a piece is accounted exclusively after a REAL read from the
   source file. The read-ahead budget is the deterministic elapsed-time
   law (`floor(elapsedMs * readBytesPerSecond / 1000)`).
2. **Nominal timeline**: the byte↔time mapping is
   `durationMs = totalBytes * 8 * 1000 / nominalBitrateBps` (the frozen
   DTO carries no duration; no container parser exists in-lane). The
   mapping is monotone, deterministic, and documented.
3. **Complete requires proof**: `complete` is reachable only after the
   asset was persisted AND the full stored hash matched the recorded
   digest (`complete ⇒ verified`, the law the R08 binding relies on). A
   persistence failure (quota/disk) or digest mismatch fails the session
   honestly instead.
4. **Store-backed opens verify**: opening `assets/<id>/content.bin`
   re-hashes the stored bytes; a mismatch rejects the open with
   `VERIFICATION_FAILED` (corrupt bytes are never served). `statMedia`
   re-stats the source (a size change since open is refused).
5. **Prioritize geometry**: wire `piece` indices are ABSOLUTE (the
   simulation's and gateway hint's geometry: `pieceCount` equal pieces,
   last absorbing the remainder). The service's scheduler wiring
   translates the WFX-023 playhead-relative ordinals onto this geometry.
6. **Pause is not a state** (the frozen union has no `paused`): the
   playback clock freezes; reads continue. `resume` performs the
   FSM-legal `buffering -> playing` / `background -> playing` hops.
7. **Background is engine-internal**: the service host's
   background-completion admission performs the FSM-legal
   `playing -> background` hop; a background session whose bytes all
   land completes through the same persist+verify law.

## The asset store

```
<root>/assets/<assetId>/content.bin   the real bytes (one file per asset in R10)
<root>/assets/<assetId>/meta.json     size, sha256, integrity verdict, timestamps
<root>/journal.ndjson                 the session journal
<root>/engine-info.json               protocol version, pid, gateway port
```

- `assetId` is the deterministic SHA-256 of the absolute source path
  (stable across restarts — the gateway URL and recovery rely on it).
- `importAsset` stream-copies with SHA-256 (`Bun.CryptoHasher` — a Bun
  builtin, no new dependency) and records the digest; a fresh import is
  `verified` only by a full re-hash against the recorded digest.
- **Quota is policy + disk truth**: the configured budget refuses BEFORE
  any write (typed `IO_ERROR` with the numbers — the port maps it to
  `unavailable`); real write failures (ENOSPC, EACCES…) surface as typed
  `IO_ERROR` with the cause. A failed import NEVER leaves partial silent
  state (staging discarded, directory removed).
- **No silent eviction**: `removeAsset` is the only deletion path.

## The session journal + recovery

`journal.ndjson` is append-only: `open` / `control` / `state` /
`evidence` records with monotonic sequence numbers that survive
restarts; a torn tail (a crash mid-append) is dropped, everything that
provably landed replays.

**Recovery on service start** (`service.recover()`):

- Non-terminal sessions are restored with their OWN ids at their last
  JOURNALED control point as **`buffering`, honestly 0 buffered** — the
  documented **paused-by-restart mapping** (the frozen union has no
  `paused`; the clock is frozen until `resume`, which continues from the
  control point). Recovery evidence is journaled, and each verdict is
  announced on the wire as a startup `state-changed` (v1 consumers
  ignore unknown-session snapshots by law — safe for legacy consumers).
- Sessions whose bytes vanished (or whose stored asset failed
  verification) are marked **`failed` with the honest detail** — a
  tombstone that answers later control with `SESSION_CLOSED`.
- The journal is a control-point journal, not a telemetry log: playback
  drift between control points is lost by design (deepening is R13's
  persistence item).

## The production range gateway

`startProductionGateway(engine, options)`: a real `Bun.serve` listener
on **127.0.0.1 only** (never `0.0.0.0` — local media serving is not a
network service), port 0 (kernel-assigned; the actual port is on the
handle and in `engine-info.json`) or a configured port (a bind failure
fails startup honestly). It serves `GET /media/<assetId>` with full
byte-range semantics — 200/206/304/416/404/405, `Range`
(closed/open/suffix), deterministic ETags, `Content-Range: bytes */N` on
416s — over the REAL stored bytes, built from the PURE pieces of
`gateway/server.ts`. The asset map is LIVE: entries appear as the store
persists assets (a background completion becomes servable immediately).
`gateway/test-server.ts` (the simulation-backed binding) remains
TEST/DEV-only.

## Background completion + the scheduler wiring

- **Admission is policy-gated**: a wire `pause` of a `playing` session
  consults the merged WFX-024 `decideCompletion` (policy × the injected
  environment). `continue` ⇒ the FSM-legal `playing -> background` hop +
  the completion driver tracks it (cap, FIFO release, typed
  `CompletionEvent`s journaled as evidence). Anything else ⇒ no
  admission — never a spurious driver resume of user-paused playback.
- R10's sources are local files + the store, so the network environment
  gates scheduling STRUCTURALLY; the byte-real network gating arrives
  with R11's torrent source through the same driver.
- **The foreground scheduler wiring**: the merged WFX-023
  `createScheduler` plans playhead-RELATIVE piece ordinals (k=0 at the
  current position — its documented model); the real engine's
  `prioritize` speaks ABSOLUTE indices. `createRelativePieceAdapter`
  translates `anchor + k` (anchor = the playhead's piece) — the honest
  pass-through **R12 deepens** into full playback-aware scheduling.

## What R11 plugs into

R11's torrent engine becomes an ASSET PRODUCER for this service: torrent
downloads pre-stage their bytes into the SAME store layout
(`assets/<id>/content.bin` + digest sidecar) and hand the engine a
`localPath` (or the store path directly). The engine's `open` then
serves those bytes with the identical read-ahead/range/integrity laws —
no torrent logic ever enters this package (the freeze's law:
"Torrent internals stay behind native-media" — and R11 keeps them
behind the torrent-engine package, feeding this one through the store).

## What R12 deepens

The scheduler wiring point is `service.tickScheduler()` +
`createRelativePieceAdapter`: today it forwards foreground playback
demands through the merged WFX-023 planner with the playhead-anchor
translation. R12's playback-aware torrent scheduler deepens this into
byte/range → piece-deadline mapping against the REAL piece geometry
(`engine.sessionGeometry()` exposes it) and closes the known limitation
below.

## Known limitations (honest)

- The v1 wire has NO request ids: the transport's in-order matching is
  sound because the entry carries command-driven changes ONLY in the
  acks (never duplicated as spontaneous events) and buffers spontaneous
  events while a command is in flight; the transport additionally
  matches structurally (only a `state-changed` for the command's session
  or an `error` DTO can resolve a pending send). The residual v1
  ambiguity — a timer-driven same-session `state-changed` racing a
  command's write through the pipe — is a documented protocol limit;
  request ids are the v2 fix (escalated for lead ratification).
- Closing a driver-tracked background session leaves the driver's record
  in place; its ticks then record typed NOT_FOUND failures (never
  swallowed, never fatal). The frozen driver surface has no removal API;
  the lifecycle deepening is R13's.
- The journal is a control-point journal; unjournaled playback drift
  between control points is lost on restart (R13).
- The engine reports a config-injected content type (default
  `application/octet-stream`); no container sniffing exists in-lane.

## The stubEngine/simulation law

`fixtures.ts` (`stubEngine`), `engine/simulation.ts`, and
`gateway/test-server.ts` are **TEST/DEV ONLY — never production**. The
production path (`src/service-process/**` + the pure gateway server)
never imports them, enforced by
`tests/production-import-guard.test.ts`. (`engine/adapter.ts` hosts the
lead-frozen WFX-014 in-process simulation pipe for TEST/DEV alongside
the production adapter — exactly as merged and lead-audited at R08; the
law is that production paths never fall back to it.)

## Testing

Deterministic, loopback-only (127.0.0.1, kernel-assigned ports), no
external network: byte-exact store/journal/engine assertions with
injected clocks and manual pumps; child-process wire tests spawn the
REAL entry (`Bun.spawn`) against temp dirs with bounded real-clock
waits; the import guard keeps the freeze's separation law visible in
every suite run.
