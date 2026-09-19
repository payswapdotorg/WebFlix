# Desktop Native-Only Journeys — the Equivalent Evidence Procedure (R16)

The golden journey catalog's Desktop-only paths (and the native halves
of the "Limited status UX" web journeys) cannot execute in a web
browser. Per the journey doc's rule — *"Desktop validation uses the
platform's running UI plus equivalent browser/automation
instrumentation where available"* — this file is the binding equivalent
evidence procedure. These journeys are NEVER silently skipped: every
run's manifest lists them with `kind: "desktop-procedure"` and this
file's steps.

## Affected journeys

| Id | Native-only scope (beyond the encoded web surface) |
|---|---|
| J21 | Real authorized magnet/.torrent ingestion through the torrent engine (the web encodes the lifecycle STATUS vocabulary over the scripted feed) |
| J23 | Native playback-before-completion streaming from verified ranges of an in-progress session (the web encodes the buffering/playing/runway status truth) |
| J24 | Real background completion while unfocused + full integrity verification before Ready offline (the web encodes the completing/verifying/ready-offline grammar) |
| J25 | Crash-safe interruption/restart with persistent session recovery and piece-map reuse (the web encodes the failed/retry/resuming status grammar) |
| J27 | Native local media playback of a verified asset from the Library (the web encodes the constrained capability truth) |
| J33 | Bring Your Own Feed on the NATIVE import path: the OS file dialog, the read-root law, and the background sync task registry (R20-F/R20-G, the Desktop adapter surface) |

## The procedure (per journey)

1. **Boot the real Desktop product** on a workstation with the native
   shell and the native-media engine (production path — no
   `stubEngine()`): `apps/desktop` over the Tauri shell with
   `createShellEngineProcess`, the engine binary from
   `packages/native-media`, and a real authorized source.
2. **Attach automation where available.** The Tauri webview exposes
   CDP-compatible remote debugging (`WEBKIT_INSPECTOR_SERVER` /
   devtools remote). Where the webview is Chromium-based, drive it with
   `agent-browser connect <cdp-url>` and the SAME journey helpers this
   harness ships (`journeys/lib/browser.ts` works over any session);
   where it is not, use the platform's instrumentation and record the
   same state grammar (the acquisition panel's
   `data-wfx-acquisition-state` vocabulary is the shared surface
   contract — the Desktop `surface/acquisition-surface.ts` projects the
   same `AcquisitionStatusView`).
3. **Drive the native lifecycle** and capture, per state:
   - a screenshot (`.png`) named `jNN-<state>.png` under the run's
     evidence directory (the `evidence/r14/` naming convention);
   - the observed state (`AcquisitionStatusView.state`/`label`/detail
     at each step — J21: available→preparing; J23: buffering→playing
     with runway→deadline-risk demotion; J24: completing→verifying→
     ready-offline; J25: failed/recoverable→retry→resuming with
     retained progress; J27: ready-offline→native playback);
   - the honesty checks that must FAIL on regression: no false
     completion (`J25`), no fake progress when unknown, verified before
     `Ready offline` (`J24`), recovery-first surfaces (`J25`).
4. **Interruption specifics (J25):** kill the engine process mid
   transfer, restart the app, and evidence that the session RESUMES
   with retained progress (never a fresh restart, never a claimed
   completion), then complete it and evidence the Library exposure.
5. **Record the manifest**: the same `journeys/lib/report.ts` schema —
   journey id, environment (`desktop`), states observed, artifact
   paths, pass/fail. Commit under `evidence/<rNN>/`.

## J33 — the Desktop BYOF procedure (R20-F/R20-G)

The shared J33 flow (choose Bring Your Feed → choose source/export →
authorize/import → preview → confirm → feed with provenance →
sync/refresh → disconnect) runs on the Desktop adapter through the
NATIVE surface (`apps/desktop/src/surface/feed-surface.ts` over the
frozen `FeedPort`). The Desktop-specific truths this procedure must
evidence (all test-pinned in `apps/desktop/tests/feed-*.test.ts`;
the native-shell halves below need the real product):

1. **Native import path:** the OS open-file dialog
   (`wfx_file_pick_open` over the real platform dialog), the picked
   file's real bytes through the read-root law (`wfx_file_read` serves
   only dialog-produced paths), and the artifact crossing the frozen
   `FeedPort.previewImport` VERBATIM. Dismissal is the typed
   non-event; a dialog-less platform is the typed `unsupported`
   verdict — never a silent no-op.
2. **Shared semantics (the parity law):** preview → confirm → the
   feed view in SOURCE-NATIVE order (never labeled WebFlix-ranked);
   `webflix` mode empty of imported records; snapshot freshness for
   one-time routes; `live` only for a continuously-synced route;
   idempotent re-import (the same file twice leaves the record count
   unchanged — the REAL store's UNIQUE import-key law, exercised
   through the PGlite parity tests in this repo and through the
   production server on the running product).
3. **Background sync:** schedule the import's `sync` task in the
   native registry (the tray-kept process keeps running while the
   window is hidden — the full background-work truth), run sync passes
   on the host's cadence, and evidence the task registry's truthful
   transitions (`scheduled → running → completed/failed`) plus the
   survival law (a failing or cancelled sync retains every imported
   record).
4. **Disconnect:** stop the sync task and evidence that the imported
   feed remains readable (deletion is only the explicit user path —
   the source-disconnection survival law).
5. **Cache truth (the Desktop envelope):** after a restart, the feed
   surface renders the cached view with its own `savedAt`/`capturedAt`
   age labels (never presented as live) before the first fresh read.

Sandbox honesty note: this environment has no native toolchain, so the
native-shell halves above (the OS dialog, the read-root law against
the real filesystem, the tray-kept background work) are NOT exercised
here — the TypeScript surface is proven against the deterministic
shell simulator (`apps/desktop/tests/shell-simulator.ts`) and the
REAL shared store over PGlite (`apps/desktop/tests/feed-parity.test.ts`);
the native procedure above is the lead's verification step with the
real toolchain (the same honest scoping as J21–J27).

## What the lead verifies at the torrent/native milestone

The release threshold requires J21–J25 and J27 to PASS on the
production Desktop native-media path before that milestone is
accepted. The web-side encoded journeys (J21–J26 status surfaces) are
the regression gate for the shared lifecycle vocabulary; this
procedure is the gate for the native protocol path itself.
