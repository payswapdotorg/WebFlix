# R33-C — BROWSER-VERIFIED LIVE (the golden paths, measured)

Boot: `WFX_DEV_FIXTURES=1 next dev -p 3101` (the R29/R32 verification
pattern — the deterministic fixture content; the previous session's dev
server held the same port in service mode for the BEFORE service capture,
then the lane swapped it to the fixtures boot). Instrument: agent-browser
(Playwright-backed), viewport 1440×900 unless a row's captured breakpoint
says otherwise. Every number below is a live DOM/computed measurement
(the full table: `measured-facts.json`; the captures: `captures/`).

## 1. D14 — the player padding, both captured breakpoints

- **@1440×900** (`watch-geometry-1440-guide-collapsed.png`): the stage
  measures **996×560 at (16,68)** — the corpus's own player row EXACT
  (x=16 = the 16px page margin; y=68 = the 56px masthead + the 12px gap);
  the computed `.wfx-player` padding is `12px 0px 48px 16px` (the ≥1016
  band's `padding-right: 0` is the corpus's own flush-right secondary —
  16+996+16+412 = 1440).
- **@1600×900**: the computed padding is **`24px 24px 48px`** EXACT (the
  corpus ≥1600 row); the stage 1124×632 at (24,80); the secondary 412 at
  x=1164 (24+1124+16+412+24 = 1600).

## 2. D13 — the watch primary column (guide-collapsed = the spec)

- Guide-collapsed (the default watch state): **player 996 @(16) +
  secondary 412 @(1028)** — the corpus two-column composition EXACT.
- Guide-open (`watch-geometry-1440-guide-open.png`): the stage STAYS
  996@(16) — WebFlix's drawer is a 240px OVERLAY (measured display:flex
  at x=0). The corpus's guide-open narrowing (YouTube's push) is the
  recorded mechanism divergence (DIVERGENCES row 1) — never faked.

## 3. D11 — the owner-row Subscribe CTA round-trip (the R32 pattern)

1. The watch page's owner row renders the sources model's displayName +
   the Subscribe pill (36px h, r18 — the corpus anatomy).
2. Click → `data-wfx-subscribe-state="subscribed"`, the label
   "Subscribed", the note "Subscribed — saved to your Subscriptions list
   in Library." (`d11-subscribed-clicked.png`).
3. **Reload** → the state STAYS `subscribed` (`d11-subscribed-after-reload.png`)
   — the R30 reload-durability read (the stored row joined by
   connectorId+externalRef) re-proven on this lane head.

## 4. N19 — the duration badge's pill grammar (measured)

Search result badge: **32×16, 8px inset (right+bottom), text "0:45"
(m:ss), font 12px/500, color rgb(255,255,255), background
rgba(0,0,0,0.6), radius 4px, padding 1px 4px** — the captured pill form
EXACT. Home card badge: "40:00" at the same grammar. The shorts shelf
card carries NO badge (the corpus shorts shelf — measured).

## 5. N3 — the search row geometry (measured)

Row **1152×281**, thumb **500×281 radius 12px** — the corpus row form
EXACT (`search-rows-1440.png`). The row fonts: title 18px/400/26px
clamp 2 #0f0f0f; meta 12px/400 #606060; channel 12px/400 #606060; the
avatar 24×24 r50%. (The capture's thumbs render the fixtures' honest
placeholder art — the fixture boot's search hits carry no source
artwork; the geometry measures are unaffected.)

## 6. N29 — the channel slot's honest identity (all three surfaces)

- **Home** (`home-cards-1440.png`): every card channel slot renders
  **"From Fake Source (TEST FIXTURE — never production)"** — the sources
  model's own displayName (the fixtures source's honest, loud test
  identity, rendered verbatim — never edited). The connector id no
  longer fills the slot.
- **Search** (`search-rows-1440.png`): the result channel rows render
  the same displayName; the 24×24 monogram avatar derives its initial
  from the resolved name.
- **Watch browse**: the browse cards' channel slots render the same.
- **The honest fallback** (SSR test + the service truth): a connector
  the sources model does not carry keeps the connector id; the empty-map
  rendering is test-proven, and the current service boot's failing
  sources read keeps the connector-id identity (the environmental truth
  recorded in DIVERGENCES row 3).

## 7. The raised-gray residual — the computed values + the pixel surveys

Computed (live, both themes):
- `.wfx-result__avatar`: **rgb(242,242,242)** light / **rgb(39,39,39)**
  dark — the corpus raised EXACT.
- `.wfx-channel__avatar`: rgb(39,39,39) dark — EXACT.
- `.wfx-card__actionbtn` (the row form, /item surface): rgb(39,39,39)
  dark — EXACT (was #212121).
- The inactive chip: #f2f2f2 (light) / #272727-family (dark) — the
  corpus inactive form (unchanged).
- The four hover surfaces (chips/filterspill/upnext/actions-pill): bound
  to `--wfx-bg-hover` (row 29's family) — rule-level bindings (the CSS
  tests) + the tokens' values asserted.

Pixel survey (r29-pixels.py, the matrix's own methodology, 3px grid,
1440×900):

| Surface | BEFORE | AFTER | Corpus |
|---|---|---|---|
| Fixture home, light | 1.9% | **2.1%** | 4.1% |
| Fixture home, dark | 2.1% | **2.4%** | <5% |
| Service home, light (empty feed) | 1.8% | 1.8% | — |

The share moved TOWARD the corpus reference from below, only by binding
real surfaces to the corpus raised values (the card actionbtn's
#f7f7f7→#f2f2f2 light binding moves near-white-family pixels into the
raised band; the dark bindings land in the corpus raised-dark band). The
R29-C over-share (7.7%) is measured GONE on the current tree; the
remaining under-share is the surface-count truth (DIVERGENCES row 4) —
never a fabricated gray.

## 8. The fresh sweep (the content surfaces, re-observed)

Home: chips 32px/r8/14-500; card titles 16/500 clamp 2; card meta
12/400 #606060; channel rows 14/400 #606060 (hover primary); the shorts
shelf 208×311 vertical thumbs, no badges, no channel rows; the kebab
40×40. Search: the row grammar above. Watch: the upnext chips 32px
14/500 (the active inverted form); the desc panel #f2f2f2 r12 14/20; the
actions pills 40px r20; the owner row (D11). **No new visible residual
found on this lane's content surfaces.**
