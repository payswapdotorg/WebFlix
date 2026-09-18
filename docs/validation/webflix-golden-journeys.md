# WebFlix Golden Journeys

**Status:** FROZEN ACCEPTANCE CONTRACT
**Date:** 2026-09-16

These journeys are the product-level acceptance tests for the WebFlix remediation program. Affected UI work is not complete until the worker runs the journey against the running app with agent-browser, captures snapshots/screenshots as evidence, and records pass/fail. The tech lead must independently rerun affected journeys after integration.

## Evidence format

Each run records:

- application build/commit SHA;
- environment (Web or Desktop);
- journey ID;
- preconditions;
- actions performed;
- observed result;
- expected result;
- screenshot/snapshot evidence path;
- network/console error status;
- final pass/fail.

## Journey matrix

| ID | Journey | Web | Desktop | Future Mobile | Primary owner |
|---|---|---:|---:|---:|---|
| J01 | First launch / profile selection / onboarding | Yes | Yes | Yes | Worker 1 |
| J02 | Home discovery / hero / rows / intent entry | Yes | Yes | Yes | Worker 1 + 2/3 |
| J03 | Long-form Watch browsing | Yes | Yes | Yes | Worker 2/3 |
| J04 | Shorts vertical discovery | Yes | Yes | Yes | Worker 2/3 |
| J05 | Unified search | Yes | Yes | Yes | Worker 1 + 2/3 |
| J06 | Item detail / availability / realization choice | Yes | Yes | Yes | Worker 1 + 2/3 |
| J07 | Official embed playback | Yes | Yes | Yes | Worker 2/3 |
| J08 | Contained Browser playback | Yes | Yes | Constrained | Worker 2/3 |
| J09 | External playback fallback / return context | Yes | Yes | Yes | Worker 2/3 |
| J10 | Like/save/action synchronization truth | Yes | Yes | Yes | Worker 1 |
| J11 | Library / watchlist / history | Yes | Yes | Yes | Worker 1 |
| J12 | Cross-device resume | Yes | Yes | Yes | Worker 1 |
| J13 | Account/profile/identity lifecycle | Yes | Yes | Yes | Worker 1 |
| J14 | Source connect / reauthorize / disconnect | Yes | Yes | Yes | Worker 1 |
| J15 | Recommendation feedback controls | Yes | Yes | Yes | Worker 1 |
| J16 | Anti-tunnel / exploration after a single watched topic | Yes | Yes | Yes | Worker 1 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | Yes | Yes | Yes | Worker 1 |
| J18 | Attention modes: mindful / balanced / immersive / custom | Yes | Yes | Yes | Worker 1 |
| J19 | WebFlix model / BYOM / local model policy | Yes | Yes | Yes | Worker 1 |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | Yes | Yes | Constrained | Worker 1 |
| J21 | Authorized torrent acquisition | Limited status UX | Yes | Future | Worker 3 |
| J22 | Torrent metadata and file selection | Limited status UX | Yes | Future | Worker 3 |
| J23 | Torrent playback before full completion | No native protocol | Yes | Future | Worker 3 |
| J24 | Torrent background completion | No native protocol | Yes | Future | Worker 3 |
| J25 | Torrent interruption / restart / resume | No native protocol | Yes | Future | Worker 3 |
| J26 | Verified local asset appears in Library | Status/read | Yes | Future | Worker 1 + 3 |
| J27 | Native local media playback | Constrained | Yes | Future | Worker 3 |
| J28 | Provider credential expiry/recovery | Yes | Yes | Yes | Worker 1 + lead |
| J29 | Network loss / playback recovery | Yes | Yes | Yes | Worker 2/3 + lead |
| J30 | Unsupported capability honesty | Yes | Yes | Yes | Worker 1 + 2/3 |
| J31 | Cross-platform Web/Desktop parity | Yes | Yes | Future | Lead |
| J32 | Source-neutral identity: same item, multiple realizations | Yes | Yes | Yes | Worker 1 |

## Core acceptance details

### J01 — First launch

Expected: user can choose/create the intended profile, understand the primary navigation, optionally configure sources, and land in a useful discovery state without seeing implementation diagnostics.

### J02 — Home discovery

Expected: hero, Continue Watching when applicable, personalized/discovery rows, Shorts entry, source-neutral cards, and a direct way to state current intent.

### J04 — Shorts

Expected: vertical feed, stable current card during presentation, forward skip/rerank semantics, like/save/feedback, no fake provider progress, and controls to influence future recommendations.

### J06 — Item detail

Expected: canonical content identity, metadata, availability, realizations, resume state, save/like, and a simple play decision. Raw connector capability diagnostics remain secondary.

### J08 — Browser playback

Expected: provider playback remains inside a WebFlix-owned contained browser surface whenever technically and legally permitted. Provider security and DRM are not bypassed.

### J10 — Actions

Expected: the UI differentiates WebFlix-confirmed state from provider-confirmed synchronization. Unsupported provider actions never appear as successful.

### J15 — Recommendation feedback

Expected: `More like this`, `Not interested`, `Don't recommend creator/source`, `Already watched`, and reversible feedback affect future candidate composition.

### J16 — Anti-tunnel

Expected: after watching a concentrated topic, future recommendations remain capable of exploring adjacent and unrelated interests unless the user explicitly requests narrow continuation.

### J17 — Intent

Expected: intent can be temporary/session-scoped without corrupting long-term preferences.

### J18 — Attention

Expected: selected attention mode changes policy behavior; the system does not silently optimize for maximum time spent when the user selected another mode.

### J21–J25 — Authorized torrent lifecycle

Expected Desktop flow:

```text
authorized source
-> magnet/.torrent
-> metadata
-> choose file
-> preparing
-> buffering
-> playback
-> background completion
-> integrity verification
-> Ready offline
-> Library
-> replay
```

Interruption must preserve sufficient persistent state to recover the session without falsely claiming completion.

### J28–J30 — Recovery and capability truth

Expected: failures are specific, recoverable where possible, and honest. A missing credential, unavailable provider, unsupported playback mode, interrupted torrent, or network failure must never look like a silent success.

### J31 — Cross-platform parity

The same server-side profile state, library state, intent, and Entertainment Item identity must produce semantically equivalent Web and Desktop outcomes while allowing platform-specific capability differences.

## Browser-validation protocol

When a dev server is available:

```bash
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser snapshot -i
```

After every navigation or DOM-changing interaction, obtain a fresh snapshot before using refs. Capture screenshots for the final state and any failure state. Desktop validation uses the platform's running UI plus equivalent browser/automation instrumentation where available.

Workers must not mark a journey complete from unit tests alone.

## Release threshold

Release acceptance requires J01–J20, J26, J28–J32 to pass on the Web adapter and the corresponding applicable Desktop journeys to pass. J21–J25 and J27 must pass on the production Desktop native-media path before the torrent/native-media milestone is accepted.

## Journey automation and evidence procedure (R16, appended 2026-09-18)

The journey definitions above are FROZEN. This section appends the
automation/evidence procedure that executes them — it never modifies a
journey's definition.

### The harness (`journeys/`)

The reusable agent-browser harness lives in `journeys/` (self-contained;
it imports nothing from any `@wfx` package — journeys consume the running
product as a user, per the layering law):

- `bun run journeys:web` — boot the product (its documented deterministic
  fixtures mode: `WFX_DEV_FIXTURES=1`, `next dev -p 3101`) and run every
  encoded journey; exit code 1 on ANY journey failure (these are checks,
  not theater — every assertion binds to this document's expected states).
- `bun run journeys:ci` — the CI configuration (the same encoded set).
- `bun run journeys:list` — the catalog.
- `bun journeys/runner.ts --filter J01,J21` — a subset (the scripted
  acquisition chain J21→J24+J26 is order-dependent: a filter must include
  the full chain or none of it — the runner enforces this loudly).

Every run: resets the scripted-acquisition drive state (J21–J26 assert the
lifecycle from step 0), launches one isolated browser session with a fixed
1280×800 viewport, network-blocks the fixture provider URLs
(`fixture.invalid` — deterministic instant failure, never DNS flakiness),
executes the browser-validation protocol per navigation (`open → wait
--load networkidle → snapshot -i`), and captures per-journey screenshots,
snapshots, narrations, failure evidence, and uncaught page errors.

### Encoded vs. not-run (the honesty law)

The Web journey set is encoded in `journeys/web/` (J01–J27, J29–J32 — the
journeys the deterministic web-fixture boot can exercise, including the
J21–J26 limited-status surfaces and the J27 constrained truth). A journey
this configuration cannot execute — or cannot fully exercise — is
EXPLICITLY LISTED in the run manifest (`journeys/web/index.ts`'s
limitations) with its reason and its exact local/Desktop procedure.
Never a silent skip. As of R16's delivery:

- J28 (credential expiry/recovery) is not-run on the web fixtures boot —
  the auth flows are the service-side source-management lane; the manifest
  carries the service-mode procedure.
- J09's external-rung WIN, J12's cross-device fold, J14's connect round
  trips, J15–J18's service-side policy surfaces, J19/J20's model/transform
  operations are configuration-limited or local-only: the reachable truths
  are encoded; the rest carry procedures.
- J21/J23/J24/J25/J27's native protocol paths carry the Desktop equivalent
  evidence procedure (`journeys/desktop/README.md`).
- J31's desktop-side comparison is the lead's parity procedure; the
  web-side parity anchors are encoded.

### Evidence

Each run writes, under `evidence/rNN/` (the rNN convention):
`manifest.json` (schema `wfx-journey-manifest/1` — commit, environment,
determinism notes, per-journey id/status/assertions/artifacts/page-errors,
and the explicit limitations listing) plus `summary.md` and the
screenshots/snapshots/narrations per journey. The evidence is committed
with the delivery (`evidence/r16/` is R16's run); the CI job uploads the
same tree as an artifact.

### CI

The `journeys` job in `.github/workflows/ci.yml` runs after `verify`:
installs agent-browser (+ browser), runs `bun run journeys:ci`, and fails
on any journey regression. The CI-feasible set is the full encoded set
(zero external network: the deterministic fixtures boot only; the
service-mode journeys are local-only and listed as such in every
manifest).

### Desktop native-only equivalent evidence

`journeys/desktop/README.md` is the binding procedure for the
native-only journeys (and the native halves of the "Limited status UX"
web journeys): run the Desktop product with the native-media engine
(production path — no `stubEngine()`), attach automation where the
webview allows (`agent-browser connect` on a CDP-capable webview, or the
platform's instrumentation), drive the real lifecycle, and capture the
same state grammar (`data-wfx-acquisition-*` / the
`AcquisitionStatusView` vocabulary) with per-state screenshots and the
same manifest format. J21–J25 and J27 must pass there before the
torrent/native-media milestone is accepted (the release threshold
above).
