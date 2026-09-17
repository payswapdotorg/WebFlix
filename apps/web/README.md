# @wfx/app-web — the WEB PLATFORM ADAPTER (R07)

The web app of the **Universal Entertainment OS** — a PURE platform adapter
over the R01 shared client runtime. The frozen layering law this package
obeys:

```text
Experience Core -> Shared Client Runtime -> Platform Adapter -> Web
                                    (@wfx/client-runtime)   (THIS PACKAGE)
```

**The runtime owns the product semantics** — navigation, presentation
state, playback commands, watch state, library semantics, action states,
intent, error states. **The adapter owns the platform** — lifecycle,
browser storage, the contained browser surface, notifications, background
work (honestly none), sharing — and RENDERS runtime state. There is no
product business logic in this package: it constructs the platform bundle,
binds the transport, and projects runtime state into views.

## The architecture

### 1. The platform bundle — `src/platform/`

The truthful `PlatformCapabilities` bundle the adapter hands to
`createRuntime`. Constructed from the REAL environment (probed once, at
construction — the runtime never probes; it consumes the declaration, and
`createRuntime` re-runs `checkCapabilityTruth` so a lying bundle cannot
boot).

| Module | Port / law | Web truth |
|---|---|---|
| `environment.ts` | the browser-facility seam | every facility injectable; absent = honestly absent |
| `capabilities.ts` | `PlatformCapabilities` + `CapabilityDescriptor` | `storage: "browser"`, `browserHost: "contained"`, `nativeMedia: "none"`, `backgroundWork: "none"`, sharing/notifications **iff the facility exists** |
| `lifecycle.ts` | `LifecyclePort` | document visibility (background/resume) + `pagehide` (shutdown, async hooks awaited — the runtime's outbox flush) |
| `storage.ts` | `StoragePort` | localStorage kv (namespaced, envelope-checked) + IndexedDB blobs; quota-aware typed `quota-exceeded` (never silent, never evicting — the documented eviction policy is CALLER-managed); honest process-lifetime memory fallbacks for no-browser contexts |
| `browser-host.ts` | `BrowserHostPort` | the contained surface: a sandboxed iframe WITHOUT `allow-same-origin` (opaque origin — cookie/storage isolated from WebFlix and every other session); provider pages stay provider-owned (no injection, no credential capture, no inspection); DOM mount in the browser, RENDERED mount for server-rendered pages (the player surface mounts the session's iframe in the delivered markup) |
| `notifications.ts` | `NotificationPort` | permission-gated Web Notifications; never fabricates delivery |
| `background-work.ts` | the honest `none` | browser tabs suspend — no truthful background execution; the typed `unsupported-kind` answer with the limitation named. (A truthful `"limited"` needs a real service-worker-backed port + browser-level evidence — the lead's R16; escalate, don't patch.) |
| `sharing.ts` | `SharingPort` | the Web Share API when present; dismissal (`AbortError`) is the distinct non-failure outcome; NO port when the API is absent (honest absence; copy-link is plain UI, never a fake OS share) |
| `server-port.ts` | `ServerPort` | the R01 transport over the frozen `WFX_API_BASE` endpoint table (below) |

### 2. The ServerPort — `src/platform/server-port.ts`

Implements the frozen WFX-050 transport mapping with the **R01 typed
failure ratification** — reads NEVER degrade to empty answers (the legacy
WFX-003 degrade law is superseded here by the ratified ServerPort
channel): a network-down search is an ERROR STATE in the runtime, rendered
honestly, never a fake empty result.

| ServerPort call | HTTP | Body / query |
|---|---|---|
| `search` | `GET {base}/experience/search` | `?query=<q>` |
| `shorts` | `GET {base}/experience/search` | `?query=<q>` + the frozen short-form eligibility law (`isShortFormCandidate`) — the documented composition until the service ships a dedicated shorts endpoint |
| `metadata` | `GET {base}/experience/metadata` | `?ref=<ref>` |
| `resolve` | `GET {base}/experience/resolve` | `?ref=<ref>` |
| `executeAction` | `POST {base}/experience/actions` | `UserAction` JSON |
| `readLibrary` | `GET {base}/experience/library` | — |
| `writeLibrary` | `POST {base}/experience/library` | `LibraryCommand` JSON |
| `emitEvent` | `POST {base}/experience/events` | `EntertainmentEvent` JSON |

**Typed failure mapping** (deterministic, from real response states):
fetch rejection → `network`; 401/403 → `unauthorized`; 404 → `unavailable`
(the ratified law) — EXCEPT `metadata` 404, the one read whose type carries
absence (`ok: true, null`); 5xx/408/429 → `unavailable`; other 4xx,
non-JSON 2xx, wrong-shaped payloads → `malformed` (individually malformed
array entries are skipped — documented; a broken hit is never a card).
Identity rides as `x-wfx-*` headers, NEVER in URLs. `emitEvent` failures
answer `ok: false` — the runtime's at-least-once outbox keeps the event
pending (the EVENT SINK LAW).

### 3. The composition root — `src/host/`

- **`web-host.ts`** — `getWebRuntimeHost()`: ONE runtime instance per
  process (the boot promise is cached; concurrent requests share it),
  constructed with the truthful bundle + the transport + the session.
  Every route, API handler, and island consumes the same instance, so the
  runtime's canonical registry, watch-state fold, library, action states,
  and navigation machine are the ONE truth this process serves.
- **`session.ts`** — the anonymous-mode SEAM: the ONE module that owns
  identity (the `x-wfx-user-id: wfx-anonymous` flow, isolated here; a
  stable session id within the storage window; the honest signed-out
  state every surface renders). **R02 swaps its internals (token flow,
  profiles) without adapter surgery.**
- **`dev-fixture-server-port.ts`** — the DEV-ONLY fixture-backed ServerPort
  (`WFX_DEV_FIXTURES=1`, guarded by the 050 config law; never production).
- **`view-models.ts`** — the RUNTIME STATE → view projections (pure): the
  runtime's typed section statuses carried verbatim (an error section
  renders as an error, never a fake empty row).
- **`shorts.ts`** — the runtime's shorts model projected into the frozen
  OS short page (the WFX-028 presenter consumes it unchanged).
- **`config.ts`** — the 050 boot law (fixtures dev-only / service /
  typed `HostConfigError` — never a silent fixture fallback).

The **canonical-identity seam** (documented stopgap): the runtime's
registry mints `wfxitm_` ids per instance; routes carry the id they were
linked with, and deep links without one join through the host's
per-process map (`canonicalIdFor`). Durable cross-process canonical
identity is **R04's lane**.

### 4. Runtime wiring + navigation — `src/app/`

- **`routing.ts`** — the navigation-state ⇄ route mapping. EVERY surface
  of the runtime's state machine has a real route: home `/`, watch
  `/watch`, shorts `/shorts`, search `/search?q=`, item `/item?...`,
  library `/library?section=`, settings `/settings?section=`. The player
  and offline routes are PRESENTATION routes (the runtime's playback
  session owns the player — no navigation state). `syncNavigationToRoute`
  applies the deep-link law: reset replaces the state (no fabricated
  past); invalid payloads answer typed reasons and reset to home.
- Every page is a server component over the ONE runtime: boot → sync
  navigation → load the view (runtime read models + the adapter's
  transport metadata read) → render. Interactivity lives in the small
  client islands (`ActionButtons`, `WatchStateReporter`, `ShortsFeed`,
  the PWA prompts).
- API bridges: `POST /api/events` (the closed watch vocabulary through
  `updateWatchState`), `POST /api/actions` (`dispatchAction` + the
  watchlist write for saves — the R01 library semantics), `GET
  /api/shorts` (the runtime's shorts model), `GET /api/health` (the
  deployment probe, unchanged).

### 5. Product framing

The Guest-only framing is gone: this app is the **Web adapter of the
Universal Entertainment OS**. The session menu renders the honest
signed-out/anonymous state from the session seam ("Signed out — anonymous
session"), with the truth about the session id's durability. Profile
features surface honest "arrives with R02" states — never a fake
logged-in profile. The settings surface renders the capability TRUTH:
native media & torrent acquisition **not available on Web, named** (the
descriptor's limitation reasons, verbatim); background work honestly
none; sources (R03) and model controls (R06) render their honest absent
states.

## What R02–R06 will extend

| Lane | Extends | The seam |
|---|---|---|
| **R02 identity + profiles** | `host/session.ts` internals (token flow, profile scoping); `signedIn` becomes truthful | the ONE session module — no adapter surgery |
| **R03 source management** | the settings `sources` section (connect/reauthorize/disconnect) | the section renders the honest absent state until then |
| **R04 library + history** | durable canonical identity + the server-side watchlist read | the canonical join seam in `web-host.ts`; `runtime.library()` already carries the local model |
| **R05 recommendation controls** | the real home feed composition + policy controls | the seeded rows are typed stopgaps (`view-models.ts`); `runtime.intents` carries the policy |
| **R06 model + AI controls** | the settings `model` section | the honest absent state renders until then |

## Golden-journey status

The surfaces for the Web-relevant journeys are **structurally in place**
(J02 home discovery, J03 watch browsing, J04 shorts, J05 search, J06 item
detail, J07 embed playback, J08 contained browser playback, J09 external
handoff, J11 library, J30 unsupported-capability honesty, J32
source-neutral identity). **Browser-level journey evidence is the lead's
R16 lane** — the deterministic composition tests in `tests/` prove the
state→UI honesty laws (typed errors render as errors, capability truth
renders as unsupported, never fake success) at the render level; the
running-UI journeys with agent-browser are the lead's acceptance step.

## Development

```bash
# dev fixtures (deterministic content — the 050 law, dev only)
WFX_DEV_FIXTURES=1 bun run dev

# service mode (the REAL transport against the Experience API)
WFX_API_BASE=https://<experience-api> bun run dev
```

The tests run fully offline and deterministically (the fixture transport
for content; the REAL ServerPort under a fetch stub for the typed-failure
laws; fake browser environments for the platform ports).
