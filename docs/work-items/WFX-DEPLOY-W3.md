# WFX-DEPLOY-W3 — Browser Regression / Release Surface lane (WebFlix Deployment Release)

Date: 2026-10-02

You are WFX-DEPLOY-W3, the browser-regression/release-surface worker for
the WebFlix deployment release. Mission context: the operator has ordered
the current WebFlix app deployed and browser-verified test-ready by
2026-10-03 00:00 UTC. The TL coordinates three worker lanes (W1 web UX +
W2 host/playback + you) against one baseline. The production Vercel
project `webflix` serves at https://webflix-steel.vercel.app (currently
STALE — predates the R38-B merge); the Experience API is
https://webflix-api.vercel.app. Your lane owns the browser journey
coverage, the deployment-assumption verification, and the browser
evidence packet for the release.

Deadline pressure is real — but the quality bar does NOT drop. The TL
rejects: journey theater (a journey that cannot fail is not a check),
silent skips, stale-feed behavior accepted as offline behavior, evidence
not committed. Evidence labels: OBSERVED / DOCUMENTED / HYPOTHESIS /
REPRODUCED / UNRESOLVED.

## 0. Identity and ground rules

- Repo: https://github.com/payswapdotorg/WebFlix.git (public read).
- Baseline: main @ fbbef9b244887ef3f38e7bddf1b72cff3e6f6ae4 (verify:
  `git log --oneline -1` shows the wind-down ledger with R37 + R38-B
  merged. If absent STOP and report UNRESOLVED).
- Branch: work/wfx-deploy-w3-regression from main. Push with the PAT
  below.
- Push credential (for git push ONLY; NEVER commit it to any file or history):
  https://x-access-token:__PAT_PLACEHOLDER__@github.com/payswapdotorg/WebFlix.git
- NEVER open PRs / never merge (TL-owned); NEVER commit any
  credential, token, key, or auth state to files or history.
- You own ONLY: apps/web/tests/**, journeys/**, and
  apps/web/DEPLOYMENT.md. Deployment-specific configuration changes
  happen ONLY when the TL explicitly coordinates them (your report
  proposes; the TL approves). Do NOT touch apps/web/src/app/**,
  apps/web/src/components/**, apps/web/src/host/**,
  apps/web/src/platform/**, or packages/ — needed changes there go in
  your report as HANDOFF lines.
- Shared-file rule: package.json, bun.lock, root tsconfig, workspace
  config are TL-owned. Report needed changes as HANDOFF; never rewrite
  them yourself.
- FIRST COMMIT: this work order verbatim as
  docs/work-items/WFX-DEPLOY-W3.md (dated 2026-10-02). The work-items
  index update is TL-owned — do not edit index.md.

## 1. Setup (verify before working)

~~~bash
git clone https://github.com/payswapdotorg/WebFlix.git
cd WebFlix && git checkout main && git log --oneline -1
git checkout -b work/wfx-deploy-w3-regression
bun install
bun run typecheck && bun run lint
bun run test            # record the ACTUAL baseline numbers you see
bun run contract-check && bun run lane-check
bun run journeys:list   # the journey catalog
~~~

Read first: journeys/README.md (the six laws — journeys are checks not
theater; the layering law: journeys import NOTHING from @wfx packages;
browser-validation protocol: open → wait networkidle → snapshot -i,
fresh snapshot after every DOM-changing interaction; evidence committed
under evidence/rNN/); apps/web/DEPLOYMENT.md; docs/infrastructure/
deployment.md (WFX-056 record).

## 2. Deliverable — run + strengthen the journey suite

- Run the existing suite at baseline: `bun run journeys:web` (boots the
  product in fixtures mode on :3101 + runs every encoded journey).
  Record the manifest + summary verbatim (your baseline truth).
- STRENGTHEN coverage for the deployment critical path — add missing
  critical-path assertions (as new encoded journeys or strengthened
  existing ones) so the release golden set covers: home (hero/rows/nav),
  search (query → submit → results → open result), watch browse (cards
  open, continue state), shorts feed (feed loads, next item, controls),
  item detail (metadata, related, player entry), player resolution
  state honesty, /api/health contract, /offline render + retry.
- Keep every harness law: assertions FAIL on regression; the layering
  law holds; the fixture-determinism boot (WFX_DEV_FIXTURES=1, :3101,
  .invalid embed URLs, DOM-grammar assertions) stays intact; honest
  listing — anything this configuration cannot exercise appears in the
  limitations manifest with its exact reason.
- Run the strengthened suite GREEN at your branch HEAD; commit the
  evidence packet under evidence/r39/ (manifest.json + summary.md +
  per-journey screenshots/snapshots/narrations — the rNN convention).

## 3. Deliverable — deployment-surface verification

- /api/health: HTTP 200 + {"ok":true,"service":"webflix-web","version":
  …} — deterministic, dependency-free. Assert it in the suite (the one
  route that must answer with zero configuration).
- /offline: renders with ZERO configuration and ZERO network (the one
  deliberately-static route); its retry path behaves honestly — verify
  the retry actually re-attempts navigation; STALE-FEED behavior is NOT
  offline behavior and must never pass as it.
- PWA/installable surfaces where browser automation can exercise them
  (manifest presence, service-worker registration in service mode,
  InstallPrompt/UpdatePrompt islands); offline/update behavior where
  applicable. Everything not exercisable in this configuration → the
  limitations manifest with exact reasons + the local/Desktop procedure.
- DEPLOYMENT.md accuracy pass (you own this file): verify the documented
  route inventory matches the app (force-dynamic pages; /offline static),
  the health contract, the env law rows, and the internal API route
  table (/api/actions, /api/events, /api/shorts — failure laws included).
  Correct ONLY verified inaccuracies; record each change + its evidence
  in your report.
- Deployment assumptions against the REAL platform where reachable from
  your environment: https://webflix-steel.vercel.app (production, STALE
  pre-R38-B — a reference, not the release target) and
  https://webflix-api.vercel.app (the live Experience API). Record what
  you could and could not exercise.

## 4. Deliverable — the browser evidence packet

The packet (committed under evidence/r39/) must contain: the suite
manifest + summary; per-journey screenshots + interactive snapshots;
the health/offline proofs; the PWA-surface observations (or their honest
limitations entries); and an index document that maps every release
critical-path item (the §2 golden set) to its evidence file. This packet
is what the TL's deployed-preview verification will be checked against.

## 5. Gates (must be green at your branch HEAD)

~~~bash
bun run typecheck && bun run lint && bun run test
bun run contract-check && bun run lane-check
bun run journeys:web     # the strengthened suite, GREEN, evidence committed
~~~
Zero regressions vs the baseline numbers you recorded in §1. If a gate
fails outside your ownership, report it — never patch another lane's tree.

## 6. Completion report (final message)

Produce docs/work-items/WFX-DEPLOY-W3-REPORT.md (commit it): branch +
HEAD SHA; commit list; changed-file list; the journey-coverage delta
(new/strengthened journeys + assertions); the deployment-surface verdict
table (health / offline / PWA / DEPLOYMENT.md rows → VERIFIED-REPRODUCED /
FIXED-<sha> / HANDOFF / UNRESOLVED); gates table (actual numbers);
HANDOFF list; UNRESOLVED list; the evidence-packet index. Push the
branch, then report the same summary as your final message. The TL
harvests from git truth — unsupported completion claims are ignored.
