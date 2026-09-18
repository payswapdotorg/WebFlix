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

## What the lead verifies at the torrent/native milestone

The release threshold requires J21–J25 and J27 to PASS on the
production Desktop native-media path before that milestone is
accepted. The web-side encoded journeys (J21–J26 status surfaces) are
the regression gate for the shared lifecycle vocabulary; this
procedure is the gate for the native protocol path itself.
