# R40 — TL Production Verification Sweep (WFX-DEPLOY release closure)

**Date:** 2026-10-03 00:10–00:35 UTC
**Operator:** TL #2 (resident)
**Target:** https://webflix-steel.vercel.app (production, Vercel project `webflix`, git-app auto-deploy from `main`)
**Release under verification:** `main` @ `1b982f1` — "Merge PR #31: WebFlix deployment release — the 3-lane wave + TL integration (WFX-DEPLOY)" (merged 2026-10-02 23:15 UTC)

Context: recycle #7 destroyed the sandbox estate ~23:36–23:45 UTC; this sweep ran
from the rebuilt estate against production directly (the documented fallback when
preview URLs are SSO-gated). All checks below ran in a real browser (agent-browser,
fresh context, anonymous visitor) unless noted.

## Checks and verdicts

| # | Check | Method | Verdict |
|---|---|---|---|
| 1 | Health contract `/api/health` | curl + browser | **PASS** — HTTP 200, `{"ok":true,"service":"webflix-web","version":"0.1.0"}` (byte-exact contract) |
| 2 | Home `/` composition (R28-B) | browser eval + screenshot | **PASS** — chip bar (6 chips), content rows (76 item/watch links), Shorts rail present, zero page errors; dynamic render (792KB, `x-vercel-cache: MISS`, iad1) |
| 3 | W1-D1 card-preview click law | dwell-free click on the visible shorts-rail card anchor (mouse-position click over `IMG.wfx-card__img` inside the anchor) | **PASS** — navigates to `/player?id=wfxitm_01M2KR6R…&type=short` (the one-click play path answers; the hover-preview layer stays parked in the anonymous default attention mode — previews policy-off, by design, not a defect) |
| 4 | W1-D2 player-chrome wake strip over embeds | player page: real `youtube-nocookie.com` embed iframe present; `.wfx-chrome` idle = `pointer-events:none`; mouse hover on `.wfx-chrome__wake` (836×14 strip) | **PASS** — chrome transitions to `pointer-events:auto`; hit-test over the control band returns `SPAN.wfx-chrome__track` (the seek track is the hit target, NOT the iframe — the reveal law holds) |
| 5 | W1-D3 shorts share dead-end fix | `/shorts` → Share button (aria-label verified) → panel opens | **PASS** — unified R28-B share panel (Embed/Messages/WhatsApp/Facebook/X/Email/Reddit/Pinterest/LinkedIn + Share link + Copy + Start at 0:00); Copy → "copied" toast OBSERVED; Esc → panel closes; `[role=dialog]` semantics correct |
| 6 | `/live` route | browser + screenshot | **PASS** — h2 "Live", live rail renders, zero errors, honest typed state |
| 7 | `/studio` route (R38-B) | browser + screenshot | **PASS** — honest signed-out surface (Sign-in gate for creator tools), zero errors |

## Build-identity proof (the release is live)

The verified surfaces include changes that exist ONLY in the WFX-DEPLOY release
tree: `.wfx-chrome__wake` (W1-D2 fix, 915cc3e) and the unified R28-B share panel
with copy-toast behavior on `/shorts` (W1-D3 fix, 6fd1f8a). Their presence in
production proves the deployment serves the merged release (post-58c2ba8 product
tree; later commits in the merge chain are journeys/docs/eslint-only — the product
tree is identical through `1b982f1`).

## Screenshots

- `01-home.png` — home, R28-B composition
- `02-player.png` — player over the real provider embed (chrome + wake strip)
- `03-shorts-share.png` — the unified share panel open
- `04-live.png` — live browse
- `05-studio.png` — studio, honest signed-out state

## Honest boundaries

- Anonymous-visitor scope only: signed-in surfaces (library persistence, studio
  editor, channel subscribe round trip) were not exercised — the journey suite
  (J01–J49) owns the full behavioral matrix; this sweep verifies the deployment
  release surface (the WFX-DEPLOY closure scope).
- The attention-mode-gated hover preview (R28-B preview singleton) does not open
  in the anonymous default mode — verified by source (`previewDelayMsOf`:
  `mindful → null`) — so the D1 fix's open-layer states were verified at the
  station during W1 (agent-browser evidence committed in the W1 lane) and the
  production check here verifies the always-working one-click play path.
- No Vercel API token in this environment (lost in recycle #7): deployment-state
  claims rest on the git-app link contract + the build-identity proof above.

**Verdict: the WFX-DEPLOY production release is LIVE, HEALTHY, and BROWSER-VERIFIED.**
