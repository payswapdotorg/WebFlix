# @wfx/platform-contracts

The adapter-side **platform capability contracts** of the WebFlix remediation
freeze (R01) — the ports every platform adapter implements and the shared
client runtime consumes.

```
Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)
                                        ^-- this package is this boundary's type-level truth
```

**Pure TypeScript:** zero package dependencies, no React, no Node/browser
APIs, no wall clock, no randomness. Nothing here knows Web/Desktop/Mobile
implementation details beyond their truthful capability vocabulary.

## The ports

| Port | Owns | Notes |
|---|---|---|
| `LifecyclePort` | ready/background/resume/shutdown events + hooks | Async `shutdown` hooks are AWAITED by the adapter before exit (the runtime's at-least-once flush rides this). |
| `StoragePort` | key-value + bounded blob storage | Async, quota-aware, typed `StorageError`s. `"quota-exceeded"` is never silent. |
| `BrowserHostPort` | the contained browser surface | open/navigate/close + observation events. A **UX surface, never a circumvention mechanism** — see the security boundary below. |
| `NativeMediaPort` | native media service binding | **INTERFACE ONLY** — R10 owns the real service. Session lifecycle, range reads, playback control, integrity/background state. Mirrors the frozen `NativeMediaEngine` surface. |
| `NotificationPort` | OS notifications | Permission-gated; `notify` never fabricates delivery. |
| `BackgroundWorkPort` | background execution | Web honestly declares `"none"`; Desktop `"full"`; Mobile typically `"limited"`. |
| `SharingPort` | OS sharing | `shared` / `dismissed` / `failed` are distinct — a user dismissal is not an error. |

## Capability truth (the law)

`PlatformCapabilities` is the aggregate bundle an adapter constructs. Its
first seven fields are **verbatim** the frozen sketch in
`docs/architecture/contracts.md` ("Shared client runtime" section):

```ts
platform: 'web' | 'desktop' | 'mobile'
storage: 'browser' | 'filesystem' | 'os-managed'
browserHost: 'none' | 'contained'
nativeMedia: 'none' | 'local' | 'native-service'
backgroundWork: 'none' | 'limited' | 'full'
sharing: boolean
notifications: boolean
```

plus the R01 aggregate additions: `descriptor` (the truthful
`CapabilityDescriptor` — identity + honest limitation reasons) and `ports`
(the provided port bundle).

**Declared levels and provided ports must agree.** `checkCapabilityTruth`
verifies every rule (`browserHost: "contained"` ⇔ a `BrowserHostPort` is
provided, …) and the runtime calls it at construction — **an incoherent
bundle is rejected; the runtime never boots on a lying adapter.**

Truthful presets the spec calls out:

- **Web:** `nativeMedia: "none"` — no native torrent on the browser; honest
  unsupported states, never fake capability. `backgroundWork: "none"`.
- **Desktop:** the full reference set — `native-media` service, filesystem
  storage, full background work, contained browser host.
- **Mobile:** OS-constrained — `local` native media, `limited` background
  work, `os-managed` storage.

Helpers: `supportsTorrentAcquisition` (native-service + background work —
the Web-vs-Desktop acquisition truth), `supportsBrowserHost`,
`supportsNativeMedia`.

## BrowserHostPort security boundary (frozen)

- The browser surface is a **UX surface, NEVER a circumvention mechanism**.
- Provider pages stay **provider-owned**: their markup, scripts, DRM, access
  controls, CAPTCHAs, anti-bot controls, rate limits, and geo restrictions
  are never circumvented, intercepted, or modified by WebFlix.
- **Cookie/storage isolation is mandatory:** every `open()` carries
  `restrictCookies: "isolate"` and the host must isolate the surface's
  cookies/storage from the WebFlix origin and every other surface session
  (mirrors the WFX-026 isolation contract — one law, two seams).
- Navigation is **observed, never blocked or steered**.
- The port has **no** script injection for circumvention, no credential
  capture, no provider-page content inspection. An adapter offering any such
  mechanism cannot satisfy the port.

## What R02–R09 consume

- **R07 (Web adapter):** implements the bundle with the truthful web preset;
  maps `StoragePort` onto browser storage, `BrowserHostPort` onto the
  contained web surface, honest nulls elsewhere.
- **R08 (Desktop adapter):** implements the full bundle (Tauri/equivalent):
  filesystem `StoragePort`, native `BrowserHostPort`, real `NativeMediaPort`
  over the R10 service, OS lifecycle/notifications/sharing/background work.
- **R09 (BrowserHost):** both adapters' contained-surface implementations
  satisfy THIS port; the runtime's browser-mode playback preparation drives
  it.
- **R10 (Native Media):** the production service binding satisfies
  `NativeMediaPort`; a test double lives in `@wfx/client-runtime`'s
  `src/testing.ts` (clearly marked, never production).

## Lead ratification items

1. The frozen `PlatformCapabilities` sketch in `contracts.md` is not yet
   regenerated into `packages/domain/src/contracts/frozen.ts` (pre-existing
   contract-check drift at base `ccb9afe` — lead-owned). This package's
   types are structurally identical to the sketch, so regeneration will not
   conflict.
2. `SettingsSection` (`sources | model | general`) and the navigation
   surface vocabulary live in `@wfx/client-runtime`; R03/R05/R06 may extend
   the settings sections — coordinate through the lead.

## R27: the parity token contract (the corpus as the shared encoding)

`src/parity-tokens.ts` (R27-W1) is THE canonical machine-readable encoding
of the YouTube parity corpus (`docs/parity-lab/reference/` — captured by
the lead from live youtube.com 2026-09-23):

- `PARITY_TOKENS` — the color/surface sheet (22 tokens, dark default +
  light seam), each row provenance-tagged (`[rendered]`/`[css]`/
  `[documented]`) with its exact sheet trace;
- `PARITY_TYPE_SCALE` — the 13-role Roboto ladder;
- `PARITY_GEOMETRY` + `PARITY_GEOMETRY_PROVENANCE` — the measured
  geometry (shell, cards, watch two-column, player chrome, scrollbar,
  skeleton);
- `PARITY_MOTION` — the motion/states contract (120–300ms ease band,
  ~500ms hover dwell, ~3s idle control fade);
- `PARITY_CHROME_CONTROLS` + `PARITY_KEYBOARD` + `PARITY_TOUCH` — the
  player-chrome OPERATE grammar with honest availability gating
  (`when-queued`, `capability-gated`);
- `parityTokenMappingTable()` — the canonical `--wfx-*` css-name mapping
  both apps' stylesheets carry (the conformance key);
- `paritySheetJson()` / `paritySheet()` — the JSON serialization.

**The single-encoding law:** ONE canonical module; both apps (Web +
Desktop) consume it. App-side mirrors must match it value-for-value (the
conformance harness asserts this). Values are immutable — the corpus is
the lead's; drift between apps is a defect.
