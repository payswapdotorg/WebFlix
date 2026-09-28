# R34-C — Guards (every command + its captured output)

All commands run in /home/z/webflix on branch `wfx/r34c/accept-regression`
from `main @ 09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b` unless noted.

## Step 0 — the tree + the harness

```
$ git clone https://github.com/payswapdotorg/webflix.git && git rev-parse HEAD
09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b        # main HEAD = the R33-A merge (post-R33 tree)
$ git checkout -b wfx/r34c/accept-regression
Switched to a new branch 'wfx/r34c/accept-regression'   # from 09d0205, clean

$ bun journeys/runner.ts --list
WebFlix golden journeys — the encoded catalog
  J01 … J39  (41 encoded: J01–J34, J36–J39, J40, J41, J43; J35 not web-encoded)
  (+ 23 explicitly-listed not-run/reach-limit entries)

$ bun install --frozen-lockfile
618 packages installed [3.55s]                    # + typescript@5.9.3

$ which agent-browser && agent-browser --version
/usr/local/bin/agent-browser
agent-browser 0.38.1
```

## Step 0.4 — production serves the merged tree

```
$ curl -s https://webflix-steel.vercel.app/api/health
{"ok":true,"service":"webflix-web","version":"0.1.0"}          # HTTP 200, ~1.2s

$ curl -s https://webflix-steel.vercel.app/shorts | grep -o 'data-wfx-shortstage[^ >]*' | sort | uniq -c
      1 data-wfx-shortstage-item="wfxitm_01M2KR6R00XDZHNKYJ4GME8PHD"
      1 data-wfx-shortstage-item="wfxitm_255G4GYPYRT7AGZAQY6FAPHC0V"
      1 data-wfx-shortstage-prefetch="true"
      2 data-wfx-shortstage-state="resolving"
      2 data-wfx-shortstage="true"
# → the R33-A shortstage SSR markers are LIVE (97096 bytes)

$ CSS=/_next/static/immutable/chunks/2wf36gbc8dgj4.css   # from the /shorts HTML
$ curl -s https://webflix-steel.vercel.app$CSS | sha256sum
9be6abf6f0771e314018ccc81d8106f9da44626aad3f631fdfc8318091fe632e  # 103067 bytes
$ grep -o '\.wfx-shortstage__unmute{[^}]*}' prod.css | head -1
.wfx-shortstage__unmute{z-index:4;pointer-events:auto;color:#fff;min-height:36px;…}
$ grep -o '\.wfx-shortstage__frame{[^}]*}' prod.css
.wfx-shortstage__frame{pointer-events:auto;border:0;width:100%;height:100%;display:block}
# → the R33-A pointer-events re-arm rules are LIVE (the REQUIRE-CHANGES fix deployed)

$ curl -s https://webflix-steel.vercel.app/ | sha256sum
a5d6995c6fe6890fcabf36b056b481c02d5a143f97e13d387cdac9c6b85d7d76   # 735707 bytes
# 76 card channel slots, all the honest connector-id fallback (anonymous sources read = [])

$ curl -s https://webflix-api.vercel.app/api/health
{"ok":true,"service":"webflix-api","version":"0.1.0"}
$ curl -s "https://webflix-api.vercel.app/sources"                       # no identity header
{"error":"unauthorized","detail":"x-wfx-user-id: required identity header is absent …"}   # HTTP 401
$ curl -s "https://webflix-api.vercel.app/sources" -H "x-wfx-user-id: wfx-anonymous"
{"authenticated":false,"sources":[]}          # the typed envelope — the R33-C-era HTML answer is GONE
$ curl -s "https://webflix-api.vercel.app/experience/search?query=rain" -H "x-wfx-user-id: wfx-anonymous"
[{"connectorId":"wfx-experience-service","externalRef":"3uyGhtARP4M",…,"thumbnailUrl":"https://i.ytimg.com/vi/3uyGhtARP4M/hqdefault.jpg"} …]
# → real results with real provider thumbnails
```

## The production suite (the run of record — chunked, catalog order)

```
$ bun journeys/runner.ts --base-url https://webflix-steel.vercel.app \
    --evidence-dir evidence/r34c/run/chunk-01 --filter J01,J02,J03,J04,J05
  FAIL J01 (2 assertions, 9795ms) · FAIL J02 (1, 2303ms) · PASS J03 (6, 2072ms)
  FAIL J04 (3, 26135ms) · FAIL J05 (3, 2858ms)          → 1 pass / 4 fail
$ … chunk-02 J06–J10    → 0 pass / 5 fail
$ … chunk-03 J11–J15    → 1 pass / 4 fail (J13 green)
$ … chunk-04 J16–J20    → 2 pass / 3 fail (J18, J19 green)
$ … chunk-05 J21–J26    → 0 pass / 6 fail   (the scripted-acquisition chain whole)
$ … chunk-06 J27–J31    → 0 pass / 5 fail
$ … chunk-07 J32–J34,J36 → 0 pass / 4 fail
$ … chunk-08 J37–J39    → 0 pass / 3 fail
# TOTALS: 4 PASS / 34 FAIL / 38 — every manifest + failure capture under evidence/r34c/run/
```

## The flaky-check re-run sweep (every non-pass re-run)

```
$ bun journeys/runner.ts --base-url https://webflix-steel.vercel.app \
    --evidence-dir evidence/r34c/rerun/chunk-01 --filter J01,J02,J04,J05   → 4 fail (same verdicts)
$ … rerun/chunk-02 J06–J12 → 7 fail (same)      $ … rerun/chunk-03 J14–J20 → 5 fail (same)
$ … rerun/chunk-05 J21–J26 → 6 fail (same)      $ … rerun/chunk-06 J27–J31 → 5 fail (same)
$ … rerun/chunk-07 J32–J36 → 4 fail (same)      $ … rerun/chunk-08 J37–J39 → 3 fail (same)
# 34/34 VERDICT-stable (zero verdict flakes); 33/34 the identical first-failing
# assertion; J36's re-run failed at an earlier browser-harness wait timeout
# ([data-wfx-session-signed-in], 25s) instead of the run-of-record BYOF assertion
# — FAIL either way; the run-of-record failure remains the adjudicated basis
# (mechanically verified: run/consolidated-manifest.json)
```

## The mechanical consolidation (the closing audit's verification)

```
$ python3 evidence/r34c/run/consolidate-manifests.py
consolidated → evidence/r34c/run/consolidated-manifest.json
  run of record : 4 PASS / 34 FAIL / 38
  flaky re-run  : 34 re-run, 34 verdict-identical, 0 verdict flakes · failure-mode identical 33, divergent ['J36']
  local baseline: 11 PASS / 27 FAIL / 38
  separation    : pass-on-production 4 · fails-both-boots 27 · production-only 7
  EXPECTED SHAPE CONFIRMED (4/34/38 · 11/27/38 · 27+7+4 · 0 verdict flakes · 1 recorded mode divergence [J36])
# checks enforced (non-zero exit on any break): totals match every chunk manifest's
# own summary · the re-run covers exactly the non-pass set · catalog order J01–J39
# minus J35 · the frozen production target. Deterministic output (re-run = byte-identical).
```

## The local fixtures baseline (adjudication support — labeled as such)

```
$ bun journeys/runner.ts --evidence-dir evidence/r34c/local-baseline/full   --filter J01…J13
  # product booted (web fixtures mode) at http://localhost:3101 (the R23 record's configuration)
  PASS J03, J04, J11, J13 · FAIL J01, J02, J05–J10, J12          → 4/13
$ … full2  J14–J20 → PASS J14, J15, J16, J18, J19 · FAIL J17, J20  → 5/7
$ … full3  J21–J28 → 0/8
$ … full4  J29–J34 → PASS J33 · FAIL J29–J32, J34                  → 1/6
$ … full5  J36–J39 → PASS J38 · FAIL J36, J37, J39                 → 1/4
# LOCAL TOTALS: 11 PASS / 27 FAIL / 38 (the tree-level grammar drift separation)
```

## The battery gate (no code touched)

```
$ nice -n 19 ionice -c3 bun test --parallel=1
 5255 pass
 1 skip
 0 fail
 33627 expect() calls
Ran 5256 tests across 300 files. [223.28s]
# → 5256/1/0 — IDENTICAL to main @ 09d0205 (the frozen gate)
```

The completion audit re-ran the gate first-hand on the final lane head:

```
$ nice -n 19 ionice -c3 bun test --parallel=1          # the closing audit's re-verification
 5255 pass
 1 skip
 0 fail
 33627 expect() calls
Ran 5256 tests across 300 files. [223.11s]
# → 5256/1/0 AGAIN — IDENTICAL (both runs recorded; the 1 skip is R11's recorded
#   webtorrent-unavailable honesty skip)
```

## The lane-scope guard (no product code changes)

```
$ git add evidence/r34c && git status --short | grep -v '^A  evidence/r34c' | head
# (empty — every added file is under evidence/r34c/; zero product/journey/doc changes)
$ git diff main --stat -- . ':(exclude)evidence/r34c'
# (empty)
```

## The adjudication evidence (the bisects)

```
$ grep -rln "data-wfx-hero" apps/web/src                # → EMPTY (the hero is gone from the tree)
$ git log --oneline -1 1d32ed8
1d32ed8 R28-B: fonts + ONE-CLICK PLAY (card→player autoplay+muted-unmute; /item demoted to
  Details deep action) + HOME RESTRUCTURE (chip bar + rows immediately; hero + feed config
  moved to Settings→General …)
$ git log --oneline -6 -- apps/web/src/components/shell/AppShell.tsx
7661a17 R33-B (D6 + N33): the shell residuals' rail batch — the Subscriptions entry remap …
eb52685 R30-B — THE ACCOUNT-CHROME FAMILY …
b852d97 R29-B STAGE 4 COMPLETE — the rail grammar + the corner badge + the shorts shelf …
01dc579 R29-B STAGE 3 COMPLETE — the masthead's corpus chrome …
$ grep -rln "ActionButtons" apps/web/src/components/player/    # → EMPTY (moved to the item surface)
$ grep -rln "FeedModeControl" apps/web/src --include=*.tsx | grep -v FeedModeControl
apps/web/src/components/settings/SettingsSurface.tsx  apps/web/src/components/discovery/DiscoveryHeader.tsx
$ grep -rln "SourceStrip" apps/web/src --include=*.tsx | grep -v SourceStrip
apps/web/src/components/discovery/DiscoveryHeader.tsx          # (NOT Home — the R28-B restructure)
$ python3 (prod home HTML nav parse)
nav0: 9 links (/,/shorts,/feed/subscriptions,/library,/library?section=history,/library,/offline,/settings)
nav1: 4 links (/,/shorts,/feed/subscriptions,/library)          # 9+4=13 vs the journey's 12

$ curl -s "https://webflix-api.vercel.app/experience/library" -H "x-wfx-user-id: wfx-anonymous"
[{"…","title":"1 HOUR Rainy Day in Airport ✈️ …","addedAt":"2026-09-27T20:50:50.690Z",
  "metadata":{"list":"Saved",…}}]                              # the J11 environmental truth
```
