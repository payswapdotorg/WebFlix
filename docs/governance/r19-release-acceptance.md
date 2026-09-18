# R19 — Production and Release Acceptance (Lead)

Status: **ACCEPTED — FINAL** on `main @ <final>` (the release commit that
carries this document). Verified per the remediation freeze's acceptance
rule: environment configuration, full Web golden journeys, CI, and
source/import/persistence inspection — with machine-checked evidence and
the fresh-clone golden path.

## 1. Full Web golden journeys (the release gate)

`bun journeys/runner.ts --ci --evidence-dir evidence/r19-release`:

**32 passed · 0 failed · 0 not-run (listed with procedures) · 32 total**

- J01–J20 (core experience: onboarding, discovery, watch/shorts/search,
  item detail, embed/contained/external playback, action sync, library,
  cross-device resume, identity lifecycle, source management,
  recommendation controls, anti-tunnel, intents, attention modes,
  model/BYOM policy, AI transformations) — ALL PASS.
- J21–J26 (authorized acquisition lifecycle on the web status surface:
  authorized acquire, metadata/file selection, playback-before-completion,
  background completion, interruption/restart/resume, verified-asset
  library) — ALL PASS.
- J27 (native playback web-constrained truth: the settings capability
  table + the unscripted item's desktop-elsewhere note) — PASS.
- J28–J30 (R17 recovery hardening: credential expiry/recovery, network
  loss/playback recovery, unsupported capability honesty) — ALL PASS.
- J31–J32 (cross-platform parity web-side anchors; source-neutral
  identity) — ALL PASS.

Evidence: `evidence/r19-release/manifest.json` (full assertion journals,
determinism notes, per-journey screenshots/snapshots/narrations).
Release-run integration fixes (lead, recorded): J14/J27 re-anchored after
R17's fixture growth (the case-insensitive chip law; J27's unscripted
item moved from the now-scripted "Midnight Scoop" to "Neon Rain").

## 2. Environment configuration

- Canonical inventory: `docs/infrastructure/environment-inventory.md`
  (names only; values in the operator secrets store + platform env store)
  mirrored by `.env.example` (comments only, no values).
- Degradation contract: `docs/infrastructure/degradation-behavior.md`
  (SUSPENSION vs REJECTION families; typed, honest degradation — never
  fake success). The R17 hardening journey evidence (J28/J29) exercises
  the failure states this contract promises.

## 3. CI

`.github/workflows/ci.yml`: the full six-gate chain (lint → typecheck →
test → contract-check → lane-check → web journey checks), bun PINNED to
1.3.14 (the verified toolchain — upgrades deliberate, never by drift),
frozen-lockfile installs, gate step caching.

## 4. Source / import / persistence inspection (the fresh-clone golden path)

Fresh `git clone` from the canonical remote @ the R18 audit SHA →
`bun install --frozen-lockfile` → full battery:

| Gate | Result |
|---|---|
| lint | 0 errors / 10 warnings (pre-existing baseline, untouched files) |
| typecheck | 0 errors (root + journeys projects) |
| test | **3444 tests: 0 fail + 1 documented skip** (19295 expect calls) |
| contract-check | OK — 10 frozen blocks in sync, 7 extension types |
| lane-check | OK — 593 files, no cross-lane private imports |

The same battery is green on the working tree at the release SHA (double
run). The known parallel-load flakes (pre-existing R10/R15 files, pass in
isolation 12/12 and 16/16) did not appear in the release runs.

## 5. Desktop / native-media dimension

- The desktop native-media chain is covered by the executable suites in
  the battery (native-media process/gateway/integrity/journal + the
  torrent-engine ingestion/metadata/scheduler/persistence/recovery
  families — all green above).
- The web-side constrained truth is journey-verified (J27); the desktop
  parity anchors are journey-verified (J31).
- Per the golden-journey acceptance matrix: J21–J25 + J27's production
  Desktop native-media runs are the Desktop equivalent procedures (the
  documented evidence procedure ships with the journey encoding; the
  web-side status-surface runs are green here).

## 6. Release evidence bundle

- `evidence/r19-release/` — the 32/32 journey manifest + artifacts
- `docs/governance/r18-security-privacy-audit.md` — the closed audit
- This document — the acceptance record
- origin/main = the sole source of truth (every merge lead-verified
  on-branch before landing; the fresh-clone boot re-proves it)

## Verdict

**ACCEPTED — the 2026-09-16 remediation freeze (R00–R19) is COMPLETE:
20/20.**

— Tech Lead, 2026-09-18
