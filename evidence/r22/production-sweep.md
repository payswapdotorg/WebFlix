# R22 Production Sweep — the Lead's live-deployment verification

- **Date:** 2026-09-20 (17:34–17:38 UTC)
- **Deployment:** https://webflix-steel.vercel.app — git-linked auto-deploy of
  `main` @ `7252002` (the R22 three-lane integration merge; the served build
  provably carries the R22 code — the `data-wfx-source-chooser` and
  `data-wfx-byom-management` surfaces exist only in the R22 tree)
- **Method:** agent-browser (named session `wfx-prod-sweep`), the same
  browser-validation protocol as the journey harness (navigate → networkidle →
  read); screenshots under `evidence/r22/production/`

## The release-blocker checks (the plan §8 "Release is blocked if…" — none fire)

| # | Blocker | Observed | Verdict |
| --- | --- | --- | --- |
| 1 | Source connection CTA loops to the same empty state | The Sources section renders the R22-D chooser; the anonymous state carries the TYPED prerequisite — "Sign in or create an account" with its honest one-sentence reason — the next required choice, never a bare anchor loop | **CLEAR** |
| 2 | No visible Create Account path | The signed-out Settings → General surface renders the session controls with the register mode toggle and the "Create your account" primary action (screenshot: settings-general-create-account.png) | **CLEAR** |
| 3 | BYOM only configurable through a hidden API/direct URL | Settings → Model & AI renders the R22-F management panel: the add-provider action, the honest anonymous note (providers belong to an account), the first-party built-in section, and the provider registry — all through the normal navigation path (screenshot: settings-model-byom.png) | **CLEAR** |
| 4 | Stale accepted-lane copy ("arrives later / ships with R0x") | The home surface sweep finds none | **CLEAR** |
| 5 | Production transport differs from the accepted integrated tree | The deployment is the git-linked build of the accepted `main` @ `7252002`; the R22 surfaces are live | **CLEAR** |

## Health

`GET /api/health` → `{"ok":true,"service":"webflix-web","version":"0.1.0"}` (HTTP 200).

## Honest deployment truths observed (not blockers)

- The production deployment wires NO source connectors yet: the signed-in
  chooser would carry the honest empty-catalog sentence (the R22-A
  `catalogEmptyDetail` deployment truth); the anonymous sweep observes the
  sign-in prerequisite (the correct anonymous truth — connections belong to
  an account). Wiring real connectors is the R23+ source-onboarding work.
- The register transport is the REAL service route in production (the
  fixtures persona exists only in the dev boot); the sweep verifies the
  VISIBLE path and control; the full authenticated round trip on production
  is the operator's live account journey.
