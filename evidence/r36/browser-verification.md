# R36 — BROWSER VERIFICATION (the agent-browser evidence)

## The lane's own journey — J44 (the channel round trip), PASS

Run: `bun journeys/runner.ts --filter J44 --evidence-dir evidence/r36/journeys`
on the lane head `084be57` (the manifest's own record —
`evidence/r36/journeys/manifest.json`, one isolated agent-browser session,
1280×800, the fixtures boot's determinism resets).

**PASS — 57 assertions, 7 artifacts.** The walked path, asserted at every step:

1. **Home → creator search**: `/` renders; `/search?q=Fake` answers.
2. **The channel result row**: `data-wfx-channel-result="fake-source"` renders
   ABOVE the item results, carrying the sources model's own display name (the
   R33-C seam), the honest subscriber absence ("Subscriber count not declared
   by this source" — never a fabricated count), the @handle, and the real
   inline Subscribe; the row's own link points at `/channel/fake-source`.
3. **The channel page**: the typed-absence banner (with its honest sentence),
   the monogram avatar, the display name, `@fake-source` in the meta line, the
   five-tab bar (Home/Videos/Shorts/Playlists/About), the channel search
   field; the Home tab carries ≥8 of the channel's real items.
4. **The tabs**: Videos = exactly 6 long-form items (the short-form
   eligibility split) with the honest sort-absence note and ZERO dead sort
   chips; Shorts = exactly 3 short-form items, each linking into the real
   /shorts queue; Playlists = the typed-empty state; About = the typed
   absences + the source's own connection date + the derived counts
   (6 videos · 3 shorts).
5. **The in-channel search**: typing "rain" + submitting answers the honest
   filtered disclosure with exactly the 3 title matches + the Clear path.
6. **The Subscribe round trip**: the pill starts `idle` → the click performs
   the REAL `POST /api/library` write (the same seam the watch page's pill
   uses) → the typed outcome renders → the pill flips `subscribed` → the
   Library's `Subscriptions` playlist section carries the entry → back on the
   channel page, the fresh load renders `subscribed` (the connector-scoped
   stored truth — the reload-durability law, proven through the join's
   source-key resolution).
7. **The bell round trip**: the bell renders once subscribed; the menu opens
   with All/Personalized/None + the honest delivery note; choosing "none"
   flips the preference datum AND persists in the browser's local record
   (`wfx-channel-bells-v1` — asserted through the page's own localStorage);
   Escape closes the menu.
8. **The anonymous law**: the URL never left the channel route (no login
   redirect anywhere in the walk).

Screenshots: `j44-channel-home.png`, `j44-channel-about.png`,
`j44-channel-subscribed.png`, `j44-library-subscriptions.png`,
`j44-bell-none.png` + the full snapshot + narration artifacts.

## The affected journeys — ZERO regressions (the base-vs-lane diff)

Filters `J01,J02,J03,J04,J05,J06,J11,J37` and `J30,J40` run on BOTH the lane
head and an isolated `main @ 8937bb8` worktree (own node_modules, identical
determinism resets):

| Journey | base @ 8937bb8 | lane @ 084be57 | verdict |
|---|---|---|---|
| J01 first launch | FAIL (rail count 13 vs 12) | FAIL — identical reason | pre-existing stale grammar (the R33-B rail evolution) |
| J02 home discovery | FAIL (hero absent) | FAIL — identical reason | pre-existing stale grammar (the hero was removed in wave 1) |
| J03 watch browsing | **PASS** (6) | **PASS** (6) | no regression |
| J04 shorts | **PASS** (13) | **PASS** (13) | no regression (the R32/R33 pinned chrome + the channel-row link-in compose) |
| J05 unified search | FAIL (expects /item card links) | FAIL — identical reason | pre-existing stale grammar (R28-B superseded /item with one-click /player) |
| J06 item detail | FAIL (same /item navigation) | FAIL — identical reason | pre-existing stale grammar |
| J11 library | **PASS** (11) | **PASS** (11) | no regression (the Subscriptions list + the playlists section render the lane's writes) |
| J37 anonymous viewing | FAIL (7 assertions — "the item page offers Play", the stale /item-hub grammar) | FAIL — identical reason | pre-existing stale grammar (the R23 standing revalidation target class; see the flake note below) |
| J30 capability honesty | FAIL (absent-note grammar) | FAIL — identical reason | pre-existing stale grammar (the R29-B actions vocabulary) |
| J40 YouTube parity | FAIL (item-hub navigation) | FAIL — identical reason | pre-existing stale grammar |

Every failure's `summary.md` failure section is byte-identical between the two
runs — the failures are the R34-C ledger's documented journey-suite debt
("32 stale-grammar specs need re-encoding — recorded as a work item"), NOT
regressions of this lane. The zero-regression clause is satisfied at the
product level: the PASS set (the watch/shorts/library surfaces this lane
touches) passes unchanged, and every FAIL fails identically at base.

**The flake note (recorded honestly):** the lane's FIRST combined run recorded
J37 failing two assertions earlier (at the access-truth step, 61s — a poll
timeout signature). The attribution runs: J37 SOLO on the lane fails at
exactly the base's assertion with identical counts (7 assertions, 3
artifacts) — this solo run was re-executed at the final head and committed
(`evidence/r36/j37-lane-solo/`: FAIL, 7 assertions, 3 artifacts, the same
stale-grammar failure — the citation now points at shipped artifacts) — and
the combined filter's re-run
reproduces the base behavior byte-identically — the one-off earlier failure was
run-order flake in a single session (the D17 journey-flakiness class the
R28 matrix already records for the dev boot), not a lane regression. The
committed `journeys-affected/` evidence is the re-run.

**The base-side proof is committed**: `base-comparison/` carries the base
worktree's own manifests + summaries for both filter sets — the diff of the
failure sections (`diff <(base) <(lane)` → empty) is the zero-regression
instrument.
