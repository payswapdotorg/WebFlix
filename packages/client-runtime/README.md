# @wfx/client-runtime

The **shared client runtime** of the WebFlix remediation freeze (R01). One
runtime, many platform adapters:

```
Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)
                   ^-- this package
```

The runtime **owns** navigation, presentation state, playback commands,
watch state, library semantics, action state, intent submission, and
error-state semantics. Adapters **own** lifecycle, storage, browser
embedding, native media, notifications, background work, and sharing —
injected through `@wfx/platform-contracts` ports.

**Pure TypeScript, UI-framework-agnostic** (no React), no direct fetching
(adapters inject the `ServerPort`), no wall clock, no randomness (the
`RuntimeClock`/`RuntimeIdGen` seams), no provider SDK calls, no torrent
logic (that lives behind the native-media boundary — R10/R11).

## The single public entry

```ts
import { createRuntime } from "@wfx/client-runtime";

const runtime = createRuntime(platform, server, {
  context: { userId, sessionId, locale, region? },
  clock,   // adapter-supplied (e.g. SystemClock) — never a hidden wall clock
  ids,     // adapter-supplied (e.g. CryptoUlidGen) — no Math.random anywhere
});
```

`createRuntime` **truth-checks the capability bundle**
(`checkCapabilityTruth`) and throws the typed `RuntimeError` on an
incoherent bundle — it never boots on a lying adapter. It registers a
lifecycle `shutdown` hook that flushes the at-least-once watch-event outbox
(adapters await async shutdown hooks before exit).

## The `ServerPort` (the transport seam)

`ServerPort` mirrors the frozen transport contract of
`apps/web/src/host/remote-ports.ts` one-for-one — search / metadata /
resolve / actions / library / events — plus `shorts` for the shorts surface.
**R07's adapter maps the WFX_API_BASE HTTP transport onto it.**

> **Refinement the lead must ratify:** the frozen web host degrades read
> failures to empty answers ("the frozen plain surface has no error channel
> for reads"). The ServerPort ADDS that channel: an adapter answers
> `ok: false` with the typed `ServerFailure` instead of silently degrading,
> so the runtime renders honest error states (a network-down search is an
> error section, never a fake empty one). The frozen laws that are preserved
> verbatim: the event-sink exception (a lost watch-state event is never a
> silent success) and action honesty (never a fabricated success).

### The R02 profile extension (ADD-ONLY)

R02 (identity + profiles) extends the port with PROFILE-AWARE operations
bound to the session's ACTIVE PROFILE — `RuntimeContext.profileId`
(optional: anonymous/transition sessions carry none; an adapter with an
authenticated session sets it from the session's selected profile, and the
profile id never appears in URLs or operation arguments — the same identity
law as `userId`):

- `readHistory()` — the active profile's server-side watch history (the
  cross-device fold; typed failures, never a fake empty history);
- `readProfileLibrary()` — the active profile's server-side library
  (cross-device saves). `readLibrary` (R01) keeps its unscoped
  connector-side semantics — the rename honors the ADD-not-reshape law
  (flagged for the lead's ratification alongside the R01 item);
- `readIntents()` / `writeIntent(command)` — the active profile's durable
  intent set (frozen `IntentRecord` shapes; the server mints ids);
- `readPolicy()` / `writePolicy(command)` — the active profile's
  recommendation policy (the frozen `RecommendationPolicy`; `null` when
  unset).

The `library()` read model hydrates through them: the history section
merges the session fold (freshest local evidence, wins per item) with the
server's profile history; the watchlist merges local-first entries with
cross-device server saves; a failing server read is an ERROR section —
never a fake empty one. `getHome`'s Continue Watching stays session-local
(R04/R05 extend it — documented, not silently changed).

### The R03 source extension (ADD-ONLY — source management)

R03 (source management) extends the port with `readSources()` — the user's
source-management truth as `SourceInfo[]` (descriptor + capability truth +
CURRENT authorization state + account linkage + availability notes +
last-checked), the read behind the settings/sources surface (R01's
`SettingsSection` vocabulary: `sources | model | general`). The shape also
lives in `server-port.ts` (`SourceInfo`, `SourceAuthState`,
`SourceAuthMode` — exported).

The runtime models the RESULTING state, never the OAuth dance itself:
`runtime.sources` (`sources.ts`) is the source-state store —

- `refresh()` — read `readSources()` through the port; a failure is an
  ERROR model that KEEPS the last observed sources (never a fake empty
  list); the anonymous session's honest empty list flows through as-is;
- `observe(source)` — the ADAPTER reports a post-flow state after its
  connect/disconnect UX completes (validated structurally; garbage throws
  the typed `RuntimeError`); the next `refresh()` reconciles with the
  server;
- `list()` / `subscribe()` — the observed view (sorted by connectorId,
  stable for diffing adapters).

> **Ratification item for the lead:** unlike the R02 profile members —
> which could be REQUIRED because no adapter had shipped when R02 landed —
> `readSources` is OPTIONAL on the port because the frozen R07/R08 adapters
> implement `ServerPort` today and R03 may not edit them. Until the lead
> wires the adapters' HTTP mapping onto `GET /sources` (delivered by R03 in
> `apps/api`), `refresh()` answers the honest `unavailable` error model.
> The `InMemoryServerPort` double implements it; the shape is final.

### The R04 server-id adoption law (durable canonical identity)

R04 (library and history) extends the canonical item registry with TWO new
methods that ADOPT server-sourced canonical ids — the spec's §4 law:

> Server-provided canonical ids WIN: when the server's library/history
> answers carry canonical item ids, the runtime's canonical registry
> ADOPTS them (durable, cross-session); session-local ULID minting retires
> to the fallback for genuinely-unseen items.

- `reconcileBySourceKey(connectorId, externalRef, itemId, title)` — when
  the server's library rows carry `metadata.canonicalItemId`, the registry
  RE-POINTS the source-keyed view to the server id (the locally-minted id
  was a placeholder; the registry reconciles to the durable id). When the
  server id matches an existing entry, the source key is added if missing.
- `registerCanonical(itemId, title)` — used for history rows whose
  realization the runtime hasn't seen yet (the server's `ProfileHistoryEntry.itemId`
  is the durable identity). The TITLE LAW: when the id is ALREADY
  registered (e.g. from a search hit that has a real title), the EXISTING
  title is KEPT — the history fold's placeholder (the itemId itself) is
  never a better title than what the registry already has.

The `library.read()` model calls these methods:

- For history entries: `registerCanonical(entry.itemId, entry.itemId)` —
  adopts the server-sourced canonical id directly.
- For watchlist entries: when `entry.metadata.canonicalItemId` is present,
  `reconcileBySourceKey` reconciles; otherwise `register` mints locally
  as before.

**The malformed-id degradation law.** Server data is never trusted past
the transport guard: only WELL-FORMED canonical ids
(`isEntertainmentItemId` — the `wfxitm_` prefix + 26-char Crockford
Base32 ULID body) adopt. A malformed `metadata.canonicalItemId` degrades
honestly to local minting; a malformed history `itemId` renders in history
as-is without adoption — neither EVER throws the library read (a server
answer with a drifted id shape is a degraded view, never a crashed model).

The local-first fold STAYS INTACT (R07's surface story): local saves
render immediately; the server merge reconciles ids on the next read.

## The semantics (and where their laws are tested)

| Area | Module | Key laws |
|---|---|---|
| **Navigation** | `navigation.ts` | Typed states with required payloads; the explicit `NAVIGATION_TRANSITIONS` table; search refines (replace-top), item chains (push), destination surfaces (`settings`/`library`) never re-enter; bounded back-stack (overflow drops oldest); `back()` on empty answers `no-history`; deep-link `reset()` fabricates no history. |
| **Playback** | `playback.ts` | Capability-filtered resolution (frozen precedence Native > Embed > Browser > External, filtered by platform truth); **no fake progress** (position moves only on surface evidence or accepted seeks); truthful `buffering`/`degraded` states; terminal phases are terminal; `prepare` engages the ports (browser surface open / native session open with the caller's authorized input — the R10 seam, never invented); external handoff cannot be seeked. |
| **Watch state** | `watch-state.ts` | The WFX-029 fold laws (chronological last-writer-wins, start/progress/complete/skip labels) + the staleness law (older evidence is dropped — at-least-once redelivery never rewinds position) + idempotent per-event application + honest completion ratios; **at-least-once delivery** through the outbox — a failed emit keeps the event pending, THROWS the typed error (never silent), and is retried/flushed. |
| **Library** | `library.ts` | Canonical-item-keyed (`wfxitm_`) saves; local-first with honest sync states (`synced`/`pending`/`failed`/`unsupported`/`conflict` — the WFX-022 mirror; `local-only` receipts are `conflict`, visibly distinct); watchlist vs history in one read model with typed section statuses; unknown items cannot be saved (typed `not-found` — no fake local-only saves). |
| **Action state** | `actions.ts` | `requested → confirmed-locally | confirmed-by-provider | unsupported | failed`; **unsupported is never rendered as success** (terminal, own kind, no transition out); platform capability gating BEFORE dispatch (e.g. `download` on Web settles `unsupported` with the limitation named, never dispatched as theater); the frozen `ActionReceipt` statuses map 1:1. |
| **Intent** | `intent.ts` | The frozen `IntentScope` vocabulary; `temporary` REQUIRES a future `expiresAt`; one objective per scope (re-submission updates); live expiry filtering; session/momentary intents cleared at session end; attention-mode submission validated against the frozen `ATTENTION_MODES`. |
| **Errors** | `errors.ts` | The closed taxonomy (`invalid-input`, `network`, `unauthorized`, `unavailable`, `unsupported-capability`, `degraded`, `not-found`) with retryability + recovery hints (`retry` / `re-authenticate` / `inspect-capability` / `none`). A missing credential or unavailable realization can never look like silent success. |

### The channel law (how failures travel)

1. `invalid-input` — caller misuse — **thrown** as the typed `RuntimeError`
   (the `ExperienceError` discipline).
2. Watch-state delivery failure — **thrown** (the EventSink law); the event
   stays pending in the at-least-once outbox.
3. Capability-unsupported operations — **in-band** (`ActionState`
   `unsupported`, playback terminal phases, `unsupported-capability` results
   / typed throws from `resolvePlayback`) — never a throw for state the UI
   must render, never fake success.
4. Read-model degradation — **in the model** (section statuses carry the
   typed error kind + detail).

> **Lead ratification item:** the frozen `ClientRuntime` sketch in
> `contracts.md` returns bare types (`Promise<PlaybackSession>`,
> `Promise<void>`). This runtime keeps those bare signatures where the
> sketch specifies them and carries failure through the channels above
> (typed throws + in-band states). If the lead prefers `RuntimeResult<T>`
> envelopes, that is a sketch edit + synchronized update.

## The read models

`getHome` / `search` / `shorts` / `library` answer presentation models whose
sections carry typed statuses — `ready` sections carry real data; a failing
server read is an `error` section with the failure detail (never a fake
empty one). `search`/`shorts` hits are joined to **canonical `wfxitm_`
identities** through the runtime's registry (stable per source key for the
session — the same stopgap discipline as the experience feed, with the
stability the runtime's library/watch-state keying needs).

`getHome` assembles what the runtime itself owns (Continue Watching from the
session fold). The server-backed recommendation feed is R05's lane; when it
lands, its section joins `HomeModel` without changing the laws.

## Test doubles (`src/testing.ts`) — ⚠️ testing only

`InMemoryServerPort` (programmable answers + failure injection + the
emitted-event log), `FixedClock`, `SequentialIdGen`, in-memory
implementations of every platform port, and the truthful per-platform
capability presets (`makeWebCapabilities` / `makeDesktopCapabilities` /
`makeMobileCapabilities`). **Production code must never import it** (the
same discipline as the fixtures modules elsewhere; frozen invariant 10).

## What R02–R09 consume

- **R02 (Identity/profiles): DELIVERED.** `RuntimeContext.profileId` is the
  runtime's active-profile seam (optional — anonymous transition sessions
  carry none); the ServerPort's profile extension (readHistory /
  readProfileLibrary / readIntents / writeIntent / readPolicy /
  writePolicy — see above) is the profile-scoped read/write surface. R07's
  adapter maps them onto the apps/api auth/profile/session endpoints.
- **R03 (Source management): DELIVERED.** `runtime.sources` is the
  source-state store (refresh + observe + subscribe — see the R03 section
  above); `ServerPort.readSources()` is the read the adapters map onto the
  API's `GET /sources`; the settings navigation's `sources` section is the
  surface that renders it.
- **R04 (Library/history):** the canonical registry is the join point;
  server-side history hydration extends the R02 `readHistory` operation
  into the remaining read models (getHome's Continue Watching is the
  documented next step).
- **R05 (Recommendation controls):** the intent store + policy view are the
  client half; `readIntents`/`writeIntent`/`readPolicy`/`writePolicy` are
  the server seam; the server feed joins `HomeModel`.
- **R07/R08 (Web/Desktop adapters):** construct `PlatformCapabilities`
  bundles + a `ServerPort` implementation, then drive the runtime's
  navigation/playback/watch/library/action/intent surfaces. Honest
  unsupported states come from the capability truth — never hand-rolled.
- **R09 (BrowserHost):** browser-mode `prepare()` already drives
  `BrowserHostPort.open()` with the cookie-isolation contract.

## Drift discipline

This package consumes `@wfx/domain` (frozen contracts) and
`@wfx/platform-contracts` only — never `@wfx/experience` (its semantics are
formalized here, not imported), never a deep path (lane-check enforced).
