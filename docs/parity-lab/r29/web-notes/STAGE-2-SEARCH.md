# R29-B Stage 2 — Search (N3 + N23)

Worker B's lane notes for the second-order search parity set. Base: `origin/main @ ab49392` (R28 merged). Lane head after this stage: see `git log wfx/r29/web`.

## What shipped (N3 — the result-row anatomy)

Corpus (`docs/parity-lab/r28/youtube/search-anatomy.md`, A@f3dc4ba live 1440 measure):

| Part | Corpus | Shipped | Live-verified (DOM computed) |
| --- | --- | --- | --- |
| Row | 1152w × ~281h | grid `max-width: 1152px`, gap 16 | ✓ |
| Thumbnail | **500×281**, r12, img object-fit cover | `.wfx-result__thumb` 500×281 r12 @≥700px (max-width 45% keeps narrow viewports honest) | **500px × 281px r12px** |
| Title | 18px/400/26 clamp 2 #0f0f0f/#f1f1f1 | `.wfx-result__title` 18/400/26, `-webkit-line-clamp: 2`, overflow hidden | **18px/400/26px clamp=2** |
| Meta line | 12px/400/18 #606060/#aaa | `.wfx-result__meta` family (12/400/18, dim token) | ✓ |
| Channel row | avatar **24×24** + name 12/400 #606060/#aaa | `.wfx-result__avatar` 24×24 circular monogram (the honest connector-initial — sources carry no channel photos, never fabricated) + 12/400/18 dim | **24px×24px, 12px/18px rgb(96,96,96)** |

## What shipped (N23 — chips + the filters dialog)

- **Contextual chips** under the header (`#chip-bar` grammar, h32 r8 0 12 14/500 active inverted — the R28-verified chip anatomy, reused): only the types **actually present** in the result set render (`All` + `Videos` and/or `Shorts`); the corpus's Unwatched/Watched/Recently-uploaded/Live chips have no real backing on this host and are honestly absent.
- **The Filters dialog**: the corpus 696px paper dialog (bg `--wfx-menu`, **r12**, shadow **`rgba(0,0,0,0.15) 0 0 24px 12px`** — the share panel's family), title "Search filters" + X close (40px circular), the two-column group layout.
  - **TYPE** group: All / Videos / Shorts — an option renders only when a real type is present in the set (server passes the real unfiltered counts).
  - **DURATION** group: Any length / Under 3 minutes / 3–20 minutes / Over 20 minutes — derived from each result's real `durationMs` (`durationBucketOf`: <180s / ≤1200s / else; **no duration ⇒ no bucket claim** — the item leaves the filtered set honestly).
  - **UPLOAD DATE / FEATURES / PRIORITIZE**: honestly ABSENT (no upload dates, feature flags, or popularity signals on this host's sources) — named by the in-dialog absence note, never a dead imitation.
- **The state is the URL**: every option is a link (`/search?q=…&type=…&duration=…`) — a server-rendered presentation filter over the REAL result set, shareable, no-JS-friendly, never a client-side data claim. Unknown/invalid URL values are ignored (never guessed).
- **The filtered empty state**: `cards.length === 0` WITH a filter applied renders "Nothing matches this filter — Your search had real matches, but the applied filter hides them all" (a different truth than no-matches; the no-matches state keeps its semantic-results companion).
- The results subtitle carries `(filtered)` when a filter is applied.

## Live verification on real data (service boot :3101, query `the` — 17 results: 7 video + 10 short)

- `?q=the` → 17 cards, chips All/Videos/Shorts
- `?q=the&type=video` → 7 cards; `?q=the&type=short` → 10 cards
- `?q=the&duration=under-3` → 1 card; `?q=the&duration=over-20` → 6 cards, "(filtered)" suffix
- `?q=the&duration=3-20` → 0 cards → the honest filtered-empty state
- `?q=lofi` → 6 cards all shorts; every duration filter → 0 (those shorts carry no `durationMs` — no bucket claim, the honest leave)
- `?q=the&type=bogus` → 17 cards (invalid values ignored — never guessed)

## Evidence

- Red state (Stage-1 captured): `evidence/r29-web/repro/02-search-before.png`
- After: `evidence/r29-web/verifications/stage2-search-after.{light,dark}.png` (1440×900, both themes)
- Dialog: `evidence/r29-web/verifications/stage2-filters-dialog.{light,dark}.png`
- Duration filter live: `stage2-search-duration-over20.dark.png` (6 results "(filtered)")
- Filtered-empty honest state: `stage2-search-filtered-empty.light.png`
- VLM verdicts: light search (light theme, Filters pill, large left thumb, 24px avatar, chip bar — all confirmed); dark dialog (dark theme, "Search filters" title, TYPE/DURATION groups, option rows, X close, absence note — all confirmed).

## Gates

- lint: apps/web + journeys/web **clean** (0 problems). NOTE: repo-wide `bun run lint` carries 20 pre-existing `no-explicit-any` errors in `evidence/r28-recon/*.ts` — Worker C's R28 harness, committed on main lineage (095c73c/d34900b), OUTSIDE this lane's allowed paths; unchanged by this stage, escalated in the completion report.
- typecheck: ✓ (both projects)
- battery: **5132 pass / 1 skip / 0 fail = main's floor** (290 files, 33070 expects)
- contract-check: OK — 12 frozen blocks in sync
- lane-check: OK — 917 files
- parity-conformance: 19 pass — CONFORMANT
- `apps/web` build: ✓
