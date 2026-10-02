# WFX-DEPLOY-W1 — Web UX / Journeys lane — journey honesty report

Date: 2026-10-02
Branch: `work/wfx-deploy-w1-ux` (from main @ `fbbef9b244887ef3f38e7bddf1b72cff3e6f6ae4`)
Baseline verified: OBSERVED (`git log --oneline -1` → "ledger: wind-down executed (lead-ALI10) — R37 + R38-B merged…", exact SHA match).

Audit environment: `cd apps/web && WFX_DEV_FIXTURES=1 bun run dev` (:3101), agent-browser
(real navigations, interactive snapshots, screenshots) at desktop 1280×800 and mobile 390×844.
Evidence: `docs/work-items/wfx-deploy-w1-evidence/` (committed).

Evidence labels used: OBSERVED / DOCUMENTED / HYPOTHESIS / REPRODUCED / UNRESOLVED.

---

## 0. Gates — baseline (§1) vs branch HEAD

| Gate | Baseline @ fbbef9b | HEAD @ 5cddbff (code identical to 6fd1f8a) | Verdict |
|---|---|---|---|
| `bun run typecheck` | PASS | PASS | no regression |
| `bun run lint` | **RED — 33 errors / 83 warnings** (all in evidence/, apps/api/, apps/desktop/, packages/, apps/web/tests/ — zero in W1-owned paths) | **RED — 33 errors / 83 warnings** (identical file set; zero in W1-owned paths) | no regression (pre-existing, outside W1 ownership — see HANDOFF H4) |
| `bun run test` | 5418 tests / 5417 pass / 1 skip / 0 fail / 34269 expects / 316 files | 5418 tests / 5417 pass / 1 skip / 0 fail / **34270** expects / 316 files (clean runs; see flake analysis below) | no regression (identical pass/skip/fail in clean runs; +1 PASSING expect — see note) |
| `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types | OK — 12 frozen blocks in sync, 7 extension types | no regression |
| `bun run lane-check` | OK — 1014 files, no cross-lane private imports | OK — 1014 files, no cross-lane private imports | no regression |

Note on the +1 expect() call (34269 → 34270): pass/skip/fail counts are byte-identical and every
test file importing a changed component (player-chrome, shorts-rail-parity, shorts-media-stage,
shorts-parity, realtime-surface, up-next-queue, r33c-content-residuals) reports IDENTICAL expect
counts before/after (verified by stash-comparison runs). DOCUMENTED: the single extra passing
expect is a timing/ordering variance under `bun test --parallel=2` (the suite is not fully
deterministic in its assertion COUNT across runs; it is deterministic in outcomes). Not a
regression; no test outcome changed.

Full-suite flake analysis (REPRODUCED at BOTH commits — environment condition, not a W1
regression): repeated full-suite runs on this audit machine (4GB RAM, load average ~2.4 with
background sandbox services) intermittently fail 1–2 TIMEOUT-prone tests in trees W1 did not
touch — always `packages/native-media/tests/service-process.test.ts` (R10 subprocess wire
subtests: 25s waitFor timeouts) and/or `apps/api/tests/handlers-actions-sync.test.ts` (5s
beforeEach hook timeouts, `harness.testDb` undefined). Observed runs, identical protocol both
commits: baseline fbbef9b → 7 runs, results 0/0/0/0/0/2/2 fails; branch HEAD 5cddbff → 8 runs,
results 0/1/0/2/0/1/1/0 fails. The SAME subtests/subtest-files fail at both commits; no W1-owned
or W1-adjacent web test ever failed; running `packages/native-media/tests/service-process.test.ts`
in isolation at HEAD is 4/4 clean; every clean full run at HEAD reports exactly
5418/5417/1/0. CONCLUSION (labeled): the intermittent full-suite timeouts are a machine-load
condition affecting the baseline identically — DOCUMENTED for the TL as an environment note; the
test gate at HEAD is green (0 fail) in clean runs with zero regressions vs baseline.

Baseline discrepancy OBSERVED: the baseline ledger commit message claims "gates green,
5418/5417/1/0 at head", but `bun run lint` at the baseline SHA is RED with 33 committed errors
in evidence/, apps/api/, apps/desktop/, packages/, apps/web/tests/ trees (clean working tree
verified with `git status`). The test numbers match; the lint claim does not. Reported as-is;
lint is outside W1 ownership (see HANDOFF H4).

---

## 1. Per-route audit — journeys, observed states, defects, fixes

### `/` Home — verdict: FIXED-9c37176 (card-click defect); all other checks PASS

Journey exercised (desktop 1280×800 + mobile 390×844):
open `/` → verify rows → chip filters (All/short/movie/series) → topbar search submit →
card click → player; hover-dwell → preview → click; mobile: bottom-nav (Shorts, Library).

States OBSERVED:
- Loads 200, no console/runtime errors (whole session, all routes: zero console errors, zero page errors).
- Rows render: "For you" (3 cards), "Trending on your sources" (9 cards), Shorts rail (3 cards) — OBSERVED.
- Hero (resume-or-start): ABSENT — DOCUMENTED as intentional: the R28-B restructure removed the
  hero from home ("no hero, no config section" — HomeSurface.tsx header; operator's #5). The
  work order's "hero renders" expectation predates R28-B; recording honestly rather than
  re-adding a surface the corpus explicitly removed.
- Continue watching: honestly absent on a fresh session (DOCUMENTED design: "honest absence on
  a fresh session — no empty scaffolding"). Composition with real watch state is covered by
  `apps/web/tests/adapter-surfaces.test.ts` ("Continue Watching appears after real watch-state
  events through the events route" — DOCUMENTED). Browser-verified end-to-end only partially:
  see UNRESOLVED U1 (dev-boot route isolation).
- Chip bar filters work: OBSERVED All=14 visible cards, movie=1, series=1, short=2 (CSS filter seam).
- Topbar search "neon" → /search?q=neon with results: OBSERVED.
- Mobile: bottom nav (Home/Shorts/Subscriptions/Library) navigates: OBSERVED; no horizontal
  overflow (scrollW 390 = clientW 390): OBSERVED.
- Guide toggle expands the rail (aria-expanded=true, rail visible): OBSERVED.
- Sign-in links → /settings?section=general: OBSERVED (honest settings-surface sign-in flow).

Defect found + fixed:
- **W1-D1 (REPRODUCED → FIXED-9c37176)**: the hover-preview layer, once open over a card,
  swallows clicks while `resolving` and in the `not-previewable` (gated) state — the layer
  covers the thumbnail with `pointer-events: auto` but rendered no click affordance until the
  resolve answered `playing`. One-click play (R28-B's operator #1) was dead during the resolve
  window and permanently dead over the thumb for non-previewable sources. REPRODUCED by
  mouse-event clicks landing on the layer root with no navigation; REPRODUCED deterministically
  by mocking /api/preview to `not-previewable` (gated state) → click → no navigation (before),
  → /player navigation (after fix). Fix: the play clicklayer now renders in EVERY open state;
  the gate pill is `pointer-events: none` (pure text). Files: components/cards/HoverPreviewLayer.tsx,
  app/globals.css.

### `/watch` Long-form browse — verdict: PASS

Journey: open `/watch` → rows render → card click → /player → back → feed-mode radios
(Following / Your imported feed / Blend) → refusals → Personalize disclosure.

States OBSERVED:
- Loads 200; heading + feed-mode radiogroup + Personalize disclosure + For-you/Trending rows
  render; no console errors.
- Card click (Neon Rain) → /player: OBSERVED.
- Feed-mode "Following" → honest typed refusal rendered inline: "the Following mode needs
  someone you follow first" + recovery links ("Bring your feed" → /settings?section=sources):
  OBSERVED (the no-optimism law — selection follows the server's read).
- "Blend" → honest refusal: "the Blend mode needs a followed account or an imported feed first": OBSERVED.
- Mobile 390px: no horizontal overflow: OBSERVED.

### `/shorts` Short feed — verdict: FIXED-6fd1f8a (share defect); all other checks PASS

Journey: open `/shorts` → feed loads → ArrowUp (next) → ArrowDown (back) → share button →
playback-speed combobox → mobile 390px.

States OBSERVED:
- Loads 200; vertical feed renders: current article (Neon Rain) with REAL embedded iframe
  (420×744 — no blank player), next article (Midnight Scoop), rail (like/save typed-absent,
  share available), channel row + Subscribe pill, playback-speed combobox: OBSERVED.
- Keyboard: focus the feed region → ArrowUp advances (position 1/3 → 2/3, current becomes
  Midnight Scoop with its own real iframe), ArrowDown goes back (2/3 → 1/3): OBSERVED
  (keyboard interaction sane; the handler needs the feed region focused — it is tabindex=0
  focusable, and the a11y tree names the swipe instructions).
- Mobile 390px: no horizontal overflow; feed renders: OBSERVED.

Defect found + fixed:
- **W1-D3 (REPRODUCED → FIXED-6fd1f8a)**: the rail's Share button was a dead end — it POSTed a
  `share` EntertainmentEvent to /api/events, whose frozen vocabulary is progress|complete|skip
  (share belongs to the R15 external/social actions lane, which has no web-adapter sink). Every
  share click answered 400 and rendered a visible, confusing, permanent error: "Watch state was
  NOT recorded (400: type: expected one of progress | complete | skip — …)" — and opened no
  share surface. REPRODUCED: clicked Share → error text visible in the page (a11y snapshot).
  Meanwhile every other surface (player, item detail, card kebab) opens the R28-B unified
  share panel — the exact inconsistency the operator's #4 ("sharing doesn't work the same")
  complained about. Fix: SharePanel is extracted from ShareControl (exported) and the shorts
  share cell opens the IDENTICAL panel (real share intents, clipboard Copy with toast, Start-at,
  Esc/scrim/X close); the always-rejected event POST is gone (the share engagement event's sink
  remains an R15 HANDOFF — see H2). Verified: click Share → panel opens (dialog, link field,
  Copy → "Link copied to clipboard" toast, Esc closes), zero emit errors, zero console errors.
  Files: components/player/ShareControl.tsx, components/shorts/ShortsFeed.tsx.
  Note: the share button's frozen a11y label ("emits the share engagement event") now reads
  stale — it lives in packages/experience (not W1-owned): HANDOFF H3.

### `/search` — verdict: PASS

Journey: topbar search "neon" → submit → /search?q=neon → results render → open result (→ /player);
direct open /search?q=zzz-no-match → empty state.

States OBSERVED:
- Results: `data-wfx-search-state="results"`, result card (Neon Rain) with channel row,
  Filters button, "Matches by meaning" region: OBSERVED. Result click → /player: OBSERVED.
- No-results: `data-wfx-search-state="no-results"`; honest copy: "No title matches" +
  "Nothing in your sources matches … WebFlix does not fabricate results." + the
  matches-by-meaning empty message: OBSERVED. No dead navigation.
- Mobile 390px: no horizontal overflow: OBSERVED.

### `/item` Content detail — verdict: PASS

Journey: open /item with full params (Asteroid Drift) → metadata → Where to watch →
Play → /player; related card → /player; bare stale-id deep link → honest error.

States OBSERVED:
- Metadata resolves (title/type/duration/availability/source), Play link → /player: OBSERVED.
- Where-to-watch: 4 ways to play + authorized peer copy, each "Play this way"/"Switch to this"
  links navigate with their params: OBSERVED (mode=browser switch verified → URL carries mode).
- Related content ("More to explore", 7 cards) renders; card click → /player: OBSERVED.
- Capability information truthful: "Like: not available on this source", "Save: not available
  on this source" (typed absence), Your-copy status with the honest desktop-app note: OBSERVED.
- Bare stale-id deep link (id from a previous dev process, no connector/ref): honest error
  state "This link does not name a source reference…" + "Go home" recovery — no dead-end:
  OBSERVED. Full-param deep link with a cross-process id RESOLVES (connector+ref join): OBSERVED.
- Mobile 390px: no horizontal overflow: OBSERVED.

### `/player` — verdict: FIXED-915cc3e (chrome-reveal defect, page chrome); playback resolution = W2 lane

Journey: enter from card/item/switch links (URL params in: id/connector/ref/title/type/duration
[/mode][/resume]) → chrome states → controls (mouse + keyboard) → Where-to-watch switches →
Play-next links → theater (t) → mobile 390px.

States OBSERVED:
- Page chrome renders fully: embed iframe, seek slider, play/captions/fullscreen/theater/
  miniplayer controls, title, channel link + Subscribe, like/dislike, Share, Save, Comments,
  Where to watch (4 switch links), Recommendation feedback, Realtime translation, Up next +
  Autoplay switch + filter chips: OBSERVED. No console errors.
- URL params in → states render: mode=browser switch navigates with param: OBSERVED;
  Play-next (Harbor Lights) navigates: OBSERVED.
- Keyboard: `t` toggles theater (data-wfx-theater true/false, class toggles): OBSERVED;
  `k` fires the play command path (label stays "Play (k)" — playback-phase truth is W2's).
- Mobile 390px: iframe 390×219, no horizontal overflow: OBSERVED.

Defect found + fixed:
- **W1-D2 (REPRODUCED → FIXED-915cc3e)**: the control chrome fades after ~3s idle and reveals
  on window `mousemove` — but over an embed-backed stage the provider iframe swallows pointer
  events, so the parent window receives NO mousemove while the pointer is over the video. Once
  idle, the controls were unreachable from over the video (the user had to move the mouse out
  of the video area to wake them). REPRODUCED: mousemove over the iframe → chrome idle after
  3s and stays idle; mousemove outside the iframe → reveals. Fix: an always-interactive
  transparent wake strip (14px) at the stage's bottom edge — interactive ONLY while idle
  (pointer-events flips), so moving toward where the controls live reveals them, and the strip
  never blocks the buttons once visible. Verified both directions: idle → strip PE=auto → move
  reveals (idle true→false); visible → strip PE=none: OBSERVED. Files:
  components/player/PlayerChrome.tsx, app/globals.css.
- Minor OBSERVATION (not fixed — not in the defect bar): pressing `k` does not briefly reveal
  the chrome the way the corpus does; keyboard users still reach controls via focus-within
  (CSS `:focus-within` reveals — verified present in CSS) and the shortcuts work regardless.

Playback-resolution defects: none asserted by W1 (the embed stage mounted and reported playing
in fixtures mode; resolution truth is W2's lane — no HANDOFF raised from the chrome audit).

### `/offline` — verdict: PASS

Journey: open /offline (online) → read state → click "Try again".

States OBSERVED:
- Renders the self-contained honest state: "You're offline — WebFlix needs a connection to load
  your feeds. Your watch progress is safe…" + "Try again": OBSERVED. Mobile 390px: renders,
  no overflow: OBSERVED.
- Retry path: the retry is `location.reload()` BY DESIGN (DOCUMENTED in app/offline/page.tsx):
  the service worker serves this page as the FALLBACK for a navigation, so the URL bar still
  shows the original destination and reload retries it. On a DIRECT visit (as in this audit),
  reload correctly re-attempts /offline itself: OBSERVED (stays on /offline while online —
  expected for a direct visit, honest for the SW-fallback case it exists for). No dead-end,
  no dishonest state.

### Install/update UI — verdict: PASS (service-mode-gated; not renderable in this audit's mode)

- DOCUMENTED + code-verified: InstallPrompt/UpdatePrompt islands mount in AppShell only when
  `mode === "service"` (WFX-057 law); this audit runs `WFX_DEV_FIXTURES=1` (fixtures mode),
  so the islands correctly do NOT render. The service worker registers only in production
  builds booted in service mode (components/shell/pwa-logic.ts; OBSERVED SW registrations: 0
  in dev). The islands' decision logic is covered by tests/install-surface.test.ts (DOCUMENTED).
  No defect: the gating is the documented law. Full in-browser verification of the install
  prompt requires a service-mode production boot — outside this dev-fixture audit path.

### Channel page (card channel links) — verdict: PASS (navigation-completeness check)

- Card channel link → /channel/fake-source renders: channel h1, Subscribe button, channel
  sections nav, 9 cards: OBSERVED (mobile 390px).

---

## 2. Defects found → disposition

| ID | Defect | Reproduction | Disposition |
|---|---|---|---|
| W1-D1 | Hover preview swallows clicks in resolving/gated states (one-click play dead) | agent-browser mouse clicks + /api/preview mock to gated state | FIXED-9c37176 (verified in browser) |
| W1-D2 | Player controls unrevealable over embed iframes (window mousemove starved) | agent-browser mousemove over iframe vs outside; timed idle checks | FIXED-915cc3e (verified in browser, both directions) |
| W1-D3 | Shorts Share = dead end (always-rejected event POST + permanent error text) | agent-browser click Share → visible 400 error; contrasted with player/item share | FIXED-6fd1f8a (verified in browser: panel, copy toast, Esc) |

## 3. HANDOFF list (owning lane)

- **H1 → W2 (host/playback) / TL**: In the dev boot, watch-state writes through POST /api/events
  return ok, but a subsequent home page render does not reflect them (the page route and the API
  route hold separate runtime host instances in the Turbopack dev boot — HYPOTHESIS for the
  mechanism: per-route module graphs each own the module-level `bootPromise` singleton in
  src/host/web-host.ts). The composition itself is correct (one-host test proves the fold +
  the continue row). If dev-boot parity matters for verification lanes, the host singleton seam
  is W2's tree (src/host/**). No production-path claim made either way by W1.
- **H2 → TL (R15 lane owner)**: the share ENGAGEMENT event (frozen `EntertainmentEvent` type
  "share", composed by packages/experience shortFeedEvents) has NO web-adapter sink:
  /api/events rejects it by contract (watch-state only), /api/actions accepts like|save only.
  W1 removed the shorts' broken POST; the engagement-event sink (if R15 wants it) needs a
  route + runtime fold decision across src/app/api/** + packages/client-runtime (shared/TL).
- **H3 → TL (frozen-tree owner / W3)**: the shorts share cell's frozen a11y label
  ("Share '<title>' (emits the share engagement event)" in packages/experience/src/short/react.ts)
  is now stale after W1-D3 — it should read e.g. "(opens the share panel)". W1 cannot edit
  packages/**.
- **H4 → TL**: baseline `bun run lint` is RED (33 errors / 83 warnings) at the baseline SHA in
  evidence/, apps/api/, apps/desktop/, packages/, apps/web/tests/ trees, contradicting the
  baseline ledger's "gates green" claim (test/contract/lane numbers do match). Outside W1
  ownership; unchanged by W1 (identical numbers at HEAD).
- **H5 → TL (environment note)**: repeated full-suite `bun run test` runs on the audit machine
  (4GB RAM, sustained load average ~2.4) intermittently time out 1–2 subprocess/DB-harness
  tests in packages/native-media (R10 wire subtests, 25s waitFor) and apps/api
  (handlers-actions-sync beforeEach, 5s) — REPRODUCED at BOTH the baseline SHA and branch HEAD
  with identical signatures (7 baseline runs: 5 clean / 2 flaky; 8 HEAD runs: 4 clean / 4
  flaky; the flaking subtest files are outside W1 ownership and pass 4/4 in isolation). Gate
  harvesting should expect this environment-level flake and re-run on failure — or run on a
  quieter machine.

## 4. UNRESOLVED list (exact reasons)

- **U1**: Continue-watching row could not be browser-verified END-TO-END in this dev boot
  (row renders only with watch state; POST /api/events returns ok but the home render does not
  see it — see H1 for the isolation mechanism). Compensating evidence, labeled honestly:
  DOCUMENTED via apps/web/tests/adapter-surfaces.test.ts (one-host composition: progress →
  row renders with "Resume at"; complete → row removed) + OBSERVED honest absence on fresh
  sessions. The end-to-end browser journey (watch in player → home shows Continue watching)
  remains UNRESOLVED in dev fixtures mode.
- **U2**: InstallPrompt/UpdatePrompt islands not browser-observed in their open state — they
  render only in service mode with a real beforeinstallprompt (the WFX-057 law); this audit's
  documented deterministic dev path is fixtures mode. Code-verified mounting + test-verified
  logic (DOCUMENTED), but the visual states are UNRESOLVED for in-browser observation under
  this boot.
- **U3**: The `k`-shortcut chrome reveal (corpus nicety) not implemented — OBSERVED as a minor
  gap, deliberately not fixed (outside the work order's defect bar: not a dead button, not a
  dishonest state, not a trap; keyboard users have the focus-within reveal path). Recorded so
  the TL can decide.

## 5. Evidence files (committed)

All under `docs/work-items/wfx-deploy-w1-evidence/`:

- 01-home-desktop-full.png — home full page, desktop (rows render)
- 02-item-from-home-desktop.png — card-click attempt state (pre-fix, W1-D1 context)
- 03-player-from-card-desktop.png — player chrome, desktop (from card)
- 04-search-results-desktop.png — /search?q=neon results
- 05-search-empty-desktop.png — /search?q=zzz-no-match honest empty state
- 06-watch-desktop-full.png — /watch browse full page
- 07-watch-feedmode-refusal-desktop.png — feed-mode honest refusal + recovery links
- 08-shorts-desktop.png — /shorts feed, desktop
- 09-item-detail-desktop.png — /item detail full page
- 10-offline-desktop.png — /offline state, desktop
- 11-home-mobile.png — home, 390px (bottom nav)
- 12-shorts-mobile.png — shorts feed, 390px
- 13-item-mobile.png — item detail, 390px
- 14-player-mobile.png — player, 390px (iframe 390×219)
- 15-offline-mobile.png — offline, 390px
- 16-channel-mobile.png — /channel/fake-source, 390px
- 17-player-chrome-wake-fixed.png — player chrome revealed via the W1-D2 wake strip
- 18-shorts-share-panel-fixed.png — the W1-D3 unified share panel open on /shorts
- 19-home-final-desktop.png — home at branch HEAD, desktop

## 6. Commit list (this lane, oldest → newest)

- `51505df` — wfx-deploy-w1: work order recorded verbatim (dated 2026-10-02)
- `9c37176` — fix(card-preview): dead click in resolving/gated hover-preview states — the play
  clicklayer now answers in every open state (W1-D1)
- `915cc3e` — fix(player-chrome): controls unrevealable over embed iframes — always-interactive
  wake strip at the stage's bottom edge (W1-D2)
- `6fd1f8a` — fix(shorts): share button was a dead end (always-rejected event post) — opens the
  unified R28-B share panel (W1-D3)
- `5cddbff` — wfx-deploy-w1: journey honesty report + browser evidence (per-route verdicts,
  gates, handoffs, unresolved)
- (this commit) — report amendment: the full-suite flake analysis (baseline-vs-HEAD parity
  evidence) + H5 environment note
