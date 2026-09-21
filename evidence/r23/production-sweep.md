# R23 Production Sweep — webflix-steel.vercel.app @ 7ee847c

Date: 2026-09-21 (the Lead's J35-equivalent procedure for R23)
Deploy: the R23 integration (eb6adc4 + the 7ee847c build fix) — the alias
serves the R23 build (verified by the R23-A SSR string "Public — plays for
everyone, no account needed." rendering live).

## Release-blocker checks (the R23 closers)

| Check | Result |
|---|---|
| Anonymous home (no account) | PASS — full render, "Signed out" truth, the honest anonymous-session note, "Sign in / Create a profile" OPTIONAL |
| Anonymous item detail + player path | PASS — 207KB full render; Where-to-watch ready; AI tray present; **zero** login-wall strings ("Log in to watch"/"sign in to watch" = 0 hits) |
| R23-A open-viewing vocabulary live | PASS — "Public — plays for everyone, no account needed." renders on the item page |
| Where-to-watch honest grouping | PASS — the frozen grouping renders; items with NO torrent realization show the honest Desktop-next-step acquisition state ("You can make this title available offline in the WebFlix desktop app…"); the "Authorized peer copy" entry renders when a torrent realization exists (fixtures-proven J38) |
| `GET /api/intelligence?q=…` | PASS — 200, the honest service-mode typed state: "Semantic search is not served by this transport yet — it stays off honestly rather than approximated." (R23-H law: never approximated) |
| `POST /api/model/open-models` | PASS — the honest typed unavailable: "Open-model registration is served by the platform's model runtime… the web transport serves the registry reads only." (R23-J law: never a fabricated registration) |
| R22 regression check | PASS — the source chooser (settings?section=sources, 7 markers), the BYOM panel (settings?section=model), the create-account mode toggle all render; `/api/model/byom/bind` answers its typed 400 |
| `/api/health` | PASS — `{"ok":true,"service":"webflix-web","version":"0.1.0"}` |

## Deployment incident (root-caused + fixed, recorded honestly)

The first R23 push (eb6adc4) DID NOT DEPLOY: `next build` failed — the
shorts API route's server import graph statically reached
`@/platform/browser-torrent`, and Next's server bundling traced the
adapter's LAZY dynamic imports (webtorrent → node-datachannel, a native
module) into the serverless bundle. Both auto-deploys failed silently (the
alias kept serving the R22-era build). Root-caused by reproducing the
Vercel build locally (`next build` — a gate the worker batteries do NOT
run; recorded as a lesson). The 7ee847c surgical fix imports the capability
constant from the zero-import `browser-torrent-environment` module (the
pattern `view-models.ts` already used); the lazy-import LAW is preserved.
Post-fix: build green (all three API routes in the table), full battery
unchanged 4311/1/0, deploy verified live.
