# WFX-R23R — R23 Current-Production Revalidation lane (WebFlix)

Date: 2026-10-03

You are WFX-R23R, the R23 revalidation worker for WebFlix. Mission context:
the WFX-DEPLOY deployment release is MERGED and production-verified (main @
7703890, evidence/r40/production-sweep.md — the TL closed the wave 2026-10-03
00:35 UTC). The work-items registry carries a STANDING R23 revalidation
obligation: "Revalidation is required whenever a current production surface
reports a previously accepted transport as unavailable. Current revalidation
target: J39 semantic/moment search, plus current Web/API deployment parity and
J37/J38 regression confirmation." Your lane discharges that obligation against
the CURRENT production release.

The quality bar does NOT drop. The TL rejects: screenshot-only claims, "it
rendered" as success where a journey was required, silent skips, fabricated
evidence. Evidence labels: OBSERVED / DOCUMENTED / HYPOTHESIS / REPRODUCED /
UNRESOLVED. Never silently promote HYPOTHESIS to FACT.

## 0. Identity and ground rules

- Repo: https://github.com/payswapdotorg/WebFlix.git (public read).
- Baseline: main @ 7703890 — verify with `git log --oneline -1` (shows "TL
  closure: WFX-DEPLOY production release VERIFIED…"). If absent STOP and
  report UNRESOLVED. The exact SHA to verify:
  7703890 (full: run `git rev-parse HEAD` after checkout of main and compare
  its prefix).
- Branch: work/wfx-r23-reval from main. Push with the PAT below;
  - Push credential (for git push ONLY; NEVER commit it to any file or history):
    https://x-access-token:__PAT_PLACEHOLDER__@github.com/payswapdotorg/WebFlix.git
  NEVER open PRs / never merge (TL-owned); NEVER commit any credential,
  token, key, or auth state to files or history.

  [WFX-R23R worker note, 2026-10-03: the order's "verbatim" first-commit law
  carries one deliberate deviation — the push credential line above is
  committed with the repo's established `__PAT_PLACEHOLDER__` redaction
  (the convention of WFX-DEPLOY-W1/W2/W3), because the credential law in
  the SAME order ("NEVER commit any credential, token, key, or auth state
  to files or history") is absolute and stated twice. Everything else is
  verbatim. The live PAT lives only in the worker's session memory for the
  `git push`, never in any file.]
- You own ONLY: journeys/** and evidence/r41/**. You may fix journey-encoding
  drift (specs that pre-date product evolution) in journeys/** with the drift
  documented. Do NOT touch apps/**, packages/**, docs/work-items/index.md
  (TL-owned), or any product source — needed changes go in your report as
  HANDOFF lines with REPRODUCED evidence.
- FIRST COMMIT: this work order verbatim as
  docs/work-items/WFX-R23R.md (dated 2026-10-03).

## 1. Setup (verify before working)

~~~bash
git clone https://github.com/payswapdotorg/WebFlix.git
cd WebFlix && git checkout main && git rev-parse HEAD   # expect 7703890…
git checkout -b work/wfx-r23-reval
bun install
bun run typecheck && bun run lint
~~~

## 2. The revalidation matrix (all against CURRENT production)

Production surfaces:
- Web host: https://webflix-steel.vercel.app (Vercel project `webflix`,
  auto-deploy from main; /api/health → {"ok":true,"service":"webflix-web","version":"0.1.0"})
- Experience API: https://webflix-api.vercel.app (project `webflix-api`;
  /api/health → {"ok":true,"service":"webflix-api","version":"0.1.0"})

Run the web journey runner against production (the runner consumes a running
product): `bun run` the journeys runner with
`--base-url https://webflix-steel.vercel.app` (see journeys/runner.ts CLI).
MEMORY LAW: run in CHUNKS (the estate OOM lesson — never one giant run;
turbopack dev + chrome cap ~2GB). The required matrix:

1. **J39 — media intelligence** (journeys/web/j39-media-intelligence.ts):
   search-by-meaning with provenance, the moment jump, license-true R2T2
   routing, the model-authority boundary. This is the STANDING revalidation
   target — the prior acceptance (2026-09-21, R23 record) must be re-proven
   on the current deployment. If the semantic/moment search transport answers
   an honest typed unavailable state in production, record it VERBATIM
   (service mode, HTTP status, payload) — that is the revalidation finding,
   not a failure to hide.
2. **J37 — anonymous playback / no-login-wall** regression confirmation:
   the no-login-wall law machine-checked (public viewing with zero login
   gates) + the anonymous playback path.
3. **J38 — torrent first-class realization** regression confirmation:
   the Where-to-watch "Authorized peer copy" grouping primary-eligible, the
   protocol-free lifecycle, the earned ready-offline.
4. **Web/API deployment parity**: the deployed web host and the deployed
   Experience API agree — boot transport (the web host's service ports hit
   webflix-api.vercel.app), health contracts byte-exact on both, and at least
   one real content round trip (home rows or search) served end-to-end through
   the split runtime. Record response identities (headers + payload digests).

## 3. Honest verdict law (the R34c precedent)

- Verdict vocabulary: PASS / STALE-GRAMMAR (spec pre-dates product evolution —
  document the drift, fix the encoding in journeys/**) / ENVIRONMENTAL (name
  the environmental wall verbatim — e.g. the YouTube datacenter-IP bot-gate)
  / UNRESOLVED.
- Re-run EVERY non-pass verdict at least once (zero verdict flakes).
- Never fabricate, never patch over, never silently skip. A blocked check
  with its wall named is honest evidence; a green check without artifacts is
  not evidence.

## 4. Evidence packet

evidence/r41/ with: a manifest (per-check: verdict, method, artifacts), the
runner's chunk manifests, per-journey logs/screenshots/snapshots, the parity
probes (request/response identities for both production surfaces), and
INDEX.md summarizing the verdict matrix. Commit everything to your branch.

## 5. Report + push

- COMPLETION REPORT as your final message: verdict per matrix clause, the
  J39 transport's exact production answer, any STALE-GRAMMAR drift fixed
  (file + drift description), any HANDOFF lines (product defects with
  REPRODUCED evidence), and the branch HEAD SHA.
- Push work/wfx-r23-reval with the push URL above. The push row in your
  report: the SHA + `git ls-remote` proof.
