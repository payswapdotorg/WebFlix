# @wfx/app-desktop — the Desktop Platform Adapter (R08)

The REAL native adapter over the R01 shared client runtime, per the frozen
remediation layering law:

```
Experience Core -> Shared Client Runtime (@wfx/client-runtime)
                          |
                   THIS adapter (apps/desktop)
                          |
                 ShellIpc — ONE typed seam
                          |
          WebFlix native shell (Tauri, apps/desktop/shell)
                          |
  window events / app-data filesystem / isolated webview surfaces /
  OS notifications / background task registry / OS share sheet /
  the native-media engine child process (R10's binary)
```

The runtime owns product semantics (navigation, playback commands, watch
state, library, actions, intents). THIS adapter owns the platform: it
implements every `@wfx/platform-contracts` port over the native shell and
constructs the runtime with the truthful Desktop bundle at boot.
**Production paths contain no fixtures and never `stubEngine()`** — the
engine process is spawned/attached through the shell (the legacy
pre-remediation WFX-040 entry that booted the stub engine as its
production default is exactly what this adapter replaces).

## Composition (the public surface)

```ts
import { createDesktopApp, createTauriShellIpc, createDesktopServerPort,
         createShellEngineProcess, SystemClock, CryptoUlidGen } from "@wfx/app-desktop";

const shell = createTauriShellIpc();                       // window.__TAURI__ (withGlobalTauri)
const app = createDesktopApp({
  shell,
  server: createDesktopServerPort({                       // the frozen WFX_API_BASE transport
    apiBase: new URL(process.env.WFX_API_BASE!),
    context: { userId, sessionId, locale: "en" },
  }),
  session: { context, clock: new SystemClock(), ids: new CryptoUlidGen() },
  engine: {                                                // THE R10 SEAM
    config: { cacheDir: shellInfo.appDataDir + "/wfx-desktop/engine-cache",
              maxCacheBytes: 2 * 1024 * 1024 * 1024 },
    // process defaults to createShellEngineProcess(shell) — the production
    // spawn/attach wiring. Tests inject the simulated engine process.
  },
});
// app.runtime          — the shared client runtime (createRuntime over the bundle)
// app.capabilities     — the truthful Desktop bundle (truth-checked at boot)
// app.surface          — the thin runtime-state UI projection (the webview frontend)
// app.lifecycle        — the shutdown-drain-observable lifecycle port
// app.engine           — the NativeMediaPort binding (dispose terminates the engine)
```

## The platform bundle (`src/platform/`)

| Port              | File                       | Truth |
|-------------------|----------------------------|-------|
| capabilities      | `capabilities.ts`          | `platform: "desktop"`, `storage: "filesystem"`, `browserHost: "contained"`, `nativeMedia: "native-service"`, `backgroundWork: "full"`, `sharing: true`, `notifications: true` — every level backed by its port; `checkCapabilityTruth` runs at boot (fail-fast) AND inside `createRuntime` (two gates, one truth). |
| lifecycle         | `lifecycle.ts`             | Native window events → `ready`/`background`/`resume`/`shutdown`; async shutdown hooks are AWAITED (the runtime's at-least-once outbox flush) and the shell is released after the drain (bounded by the shell's `shutdownTimeoutMs`). |
| storage           | `storage.ts`               | Async kv + blobs under `{appData}/wfx-desktop/storage/{kv,blobs}` (percent-encoded filenames, atomic writes). QUOTA IS DISK-TRUTH (usage = summed file sizes; the bound = the volume's real free space; ENOSPC → typed `quota-exceeded`). The adapter NEVER evicts (the frozen law); media cache eviction is `@wfx/native-media`'s policy over its own dir. |
| browser-host      | `browser-host.ts`          | Contained webview surfaces with MANDATORY cookie/storage isolation (own data dir per session; non-isolate requests refused before the shell). Navigation observed, never steered; no script injection, no credential capture, no content inspection — by design. |
| notifications     | `notifications.ts`         | OS notifications, permission-gated; delivery is never fabricated (permission-denied / unavailable / invalid-request are typed outcomes). |
| background-work   | `background-work.ts`       | The truthful task registry (full background work: tasks run while unfocused; idempotent taskIds; typed rejections; honest states + `-1` unknown progress). Executors: acquisition → the engine sessions (R10/R14); BYOF feed sync → the R20-F `feed-sync.ts` driver through the `taskReport` seam; other sync/maintenance executors land with their lanes. |
| feed-import       | `feed-import.ts`          | R20-F — the BYOF native file-import binding: pick → read → `FeedPort.previewImport` (the artifact crosses VERBATIM); typed verdicts for every platform outcome (dismissed / unsupported / failed / invalid-input); method-honest offers (a connector that does not declare the file method never reaches the port). |
| feed-sync         | `feed-sync.ts`            | R20-F — the `sync`-kind background executor: `scheduleSync` (idempotent `wfx-feed-sync/<importId>` task), `runSync` (scheduled → running → completed/failed through the report seam; `FeedPort.syncImport` does the work; NO deletion path — the survival law is structural), `cancelSync` (disconnect truth: stop the task, retain every record). |
| feed-cache        | `feed-cache.ts`           | R20-G — the richer Desktop feed cache: a PRESENTATION cache over the shell filesystem KV with honest `savedAt`/`capturedAt` age labels (never live); the port stays canonical; explicit eviction; a malformed cache is an honest miss. |
| sharing           | `sharing.ts`               | OS share sheet (macOS picker) with `canShare` truthful per request and platform; dismissal ≠ failure; Linux-like platforms answer honest unsupported (never a fake share). |
| server-port       | `server-port.ts`           | The frozen `WFX_API_BASE` HTTP transport with the R01 typed failures (`ServerResult`/`ServerFailure`; the event-sink law preserved verbatim; identity rides as `x-wfx-*` headers, never URLs). |
| native-media-binding | `native-media-binding.ts` | **THE R10 SEAM** — see below. |
| shell-engine-process | `shell-engine-process.ts` | The production `NativeEngineProcess` over the shell's engine commands (spawn/send/events/terminate relay; typed error mapping). |
| shell-ipc         | `shell-ipc.ts`             | THE typed seam contract (commands + events + the closed `ShellIpcError` vocabulary). |
| tauri-shell-ipc   | `tauri-shell-ipc.ts`       | The production `ShellIpc` over the Tauri v2 global API (`window.__TAURI__` — no npm dependency). |

The UI projection (`src/surface/desktop-surface.ts`) is deliberately thin:
runtime state → view models, no duplicated product logic. The full product
UI surfaces are R09's lane (rendering against this projection) and R16's
golden journeys. Two optional composition blocks project their own
surfaces the same way — R14's acquisition block
(`surface/acquisition-surface.ts`) and R20-G's BYOF feed block
(`surface/feed-surface.ts` over the frozen shared `FeedPort`: native file
import + background sync + the presentation cache, with the SAME
semantics as the Web lane — mode truth, freshness, provenance survival,
idempotent import). An absent optional block answers the honest UNBOUND
surface (typed verdicts — never a silent empty feed, never a fixture
fallback).

## THE R10 SEAM (`native-media-binding.ts`)

A REAL `NativeMediaPort` over the spawned engine process — the frozen
WFX-014 DTO protocol (`EngineCommand` in, `state-changed` acks +
spontaneous telemetry out, `PROTOCOL_VERSION` stamped, runtime guards on
every wire value), with these laws:

- **Spawn/attach**: the binding spawns through the injected
  `NativeEngineProcess` (production: the shell-backed relay; a spawn
  failure throws the typed `unavailable` error — never a silent dead
  binding).
- **Session mapping**: snapshots and observation events carry the
  ENGINE's numbers verbatim (`bufferedMs`/`positionMs` — never a ticker,
  never invented progress); `occurredAtMs` is the binding's clock stamp
  of report arrival (the v1 DTOs carry no timestamps).
- **The integrity law** (engine-sourced verdicts ONLY, never fabricated):
  the engine's `complete` report maps to `integrity: "verified"` (the
  frozen law — `complete` requires verified integrity, so the engine's
  complete report IS its verified verdict); a `VERIFICATION_FAILED`
  rejection maps to `integrity: "failed"` on the affected session;
  everything else answers `"unknown"`.
- **The crash law**: an `error` event on the spontaneous channel — or any
  malformed event — fails every live session (honest detail), terminates
  the handle, and rejects subsequent operations with the typed
  `unavailable` failure.
- **Typed failures**: the engine taxonomy maps onto the port vocabulary
  (`INVALID_INPUT`/`UNSUPPORTED_SOURCE`/`RANGE_NOT_SATISFIABLE` →
  `invalid-input`; `NOT_FOUND`/`SESSION_CLOSED` → `unknown-session`;
  `VERIFICATION_FAILED` → `corrupt`; `ENGINE_TIMEOUT` → `deadline-missed`;
  `IO_ERROR`/`INTERNAL` → `unavailable`). The wire deadline is enforced
  (a silent engine answers `deadline-missed`; the session is not failed).
- **Honest seams by default**:
  - `rangeAccess` (R10): the v1 wire has NO read command — without the
    channel, `readRange` rejects with the typed `unavailable` failure
    naming the R10 extension (NEVER fabricated bytes). R10's
    productionized service binds the real range gateway here.
  - `deadlineMapper` (R12): the port's byte-range deadlines and the
    engine's piece deadlines need the piece map (R12's scheduler lane) —
    without the mapper, `prioritize` rejects with the typed `unavailable`
    failure naming the R12 seam (NEVER a fabricated piece index).

**What R10–R13 plug into:** R10 replaces the engine binary behind the
shell host and binds `rangeAccess` (byte-range serving + integrity
reporting through the service); R11's torrent engine stays entirely
behind the engine boundary (this adapter exposes the seam, nothing
more); R12 binds `deadlineMapper` (byte→piece mapping against the
engine's piece maps); R13 keys durable session recovery on the engine's
own persistence (the adapter's shutdown drain keeps watch-state honest
across restarts). The R14 acquisition UX consumes the binding's
observation stream through the runtime's playback controller.

## Tests (deterministic; no network, no real process spawn)

`tests/shell-simulator.ts` — the in-process shell double (the full
`ShellIpc` contract; a manual clock; the engine side speaking the real
DTO protocol through JSON round-trips + the frozen guards). The suites:
capability truth (desktop CAN torrent / web honestly cannot), storage
layout + quota honesty + never-silent-eviction, lifecycle transitions +
the shutdown drain, browser-host observation + cookie isolation,
notification truth, background-work truth (full, while unfocused),
sharing honesty, the server-port endpoint mapping + typed failures + the
event-sink law, the binding protocol (spawn/attach, session mapping, the
integrity law, the crash law, typed failures, the R10/R12 seams, the
wire deadline), the production engine transport over the simulated shell,
and the runtime integration (boot truth-check, navigation, native
playback over the doubles, browser playback, the cross-adapter gate, the
shutdown flush).

## Known gaps (escalated, not worked around)

1. **The v1 `EngineSessionDto` carries no integrity field.** The binding
   derives `verified` from the engine's `complete` report per the frozen
   law (the only honest derivation available). Recommend the lead extend
   the DTO with an explicit integrity field when R10 productionizes the
   service — an adapter must never need to infer a verdict.
2. **The v1 wire protocol has no byte-range read command** (the WFX-014
   documented gap). `readRange` answers the typed honest failure until
   R10 binds the range gateway through `rangeAccess`.
3. **The `shorts` ServerPort operation maps to `GET /experience/shorts`**
   (the natural extension of the frozen transport table, which has no
   shorts row — R07's web adapter ratifies the endpoint; flagged for the
   lead).
4. **The native shell is source-delivered, not compile-verified in this
   sandbox** (no Rust toolchain). The TypeScript side is proven against
   the shell simulator; the lead verifies the native build at R19
   acceptance. See `shell/README.md` for the build procedure and the
   verification checklist.
