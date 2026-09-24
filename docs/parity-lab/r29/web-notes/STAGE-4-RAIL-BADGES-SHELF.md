# R29-B Stage 4 — the rail grammar + the duration badge + the shorts shelf (D8/N4 + N13 + N19 + N20)

Worker B's lane notes. Lane head after Stage 3: `01dc579`.

## What shipped

### D8/N4 — THE HISTORY DEDUPE

The rail's "You" group carried TWO History entries (the top-level link →
`/library?section=history` + the group's library-surface link → `/library`).
The duplicate is gone — ONE History entry (the explicit link with its section
href). Live-verified: the rail reads `Home | Shorts | Watch | Library |
History | Offline | Settings` — History ×1.

### N13 — THE RAIL GRAMMAR

- **Item anatomy**: the labeled rail forms (≥1280 + the drawer) adopt the corpus measure — **40h r10 14/400/20** (live-verified: `h=40px r=10px font=14px/400/20`; the active item's 500 is the active-pill grammar). The base 44px touch floor yields to the corpus measure in the labeled forms; the icon-rail and bottom-nav bands keep it.
- **THE SIGN-IN PROMO** (the corpus open-guide grammar): "Sign in to like videos, comment, and subscribe." + the blue Sign-in pill (36px rail form) — wired to the REAL identity path (`/settings?section=general`), exactly the corpus's logged-out rail truth. Live-verified present in the open guide.
- **Honestly absent** (recorded, never dead rows): the Explore section (Music/Movies/Live — no category taxonomy beyond the canonical types on this host), More-from-YouTube (no such surfaces), footer links (About/Press/… — no such pages), the location chip (no location signal).

### N19 — THE DURATION BADGE CORNER GRAMMAR

- The badge is now the **corpus corner badge**: bottom-right of the thumbnail at the **8px inset**, **12/500 #fff on rgba(0,0,0,0.6), r4, pad 1px 4px**, the **m:ss / h:mm:ss** format (`formatPosition` — "10:00:02" / "2:30:27" measured live). Live-verified computed: `12px/500 bg=rgba(0,0,0,0.6) r=4px pad=1px 4px inset right=8 bottom=8` — every corpus value.
- The visible **type badge left the card stack** (the corpus card carries no type label); the canonical type stays in the aria-label, the chip-filter seam (`data-wfx-card-type`), and the detail surface's own meta. Live-verified: 0 type badges on home cards + 0 on search rows.
- The search result variant carries the same corner badge inside its 500×281 thumb (live: "2:30:27" at the 8px inset).
- The item detail's meta badge (j06's assertion) is untouched.

### N20 — THE SHORTS SHELF 208×387

- The shelf card is the **corpus lockup**: **208px column**, thumb **208×311** (the measured 9:16-ish vertical), **4px gutters** (live: 4px measured), **5–6 columns** in the content width (VLM: 6 visible), **title below, NOTHING else** (no channel row, no meta — the shelf's own engagement model), **no duration badge** (shorts never carry one).
- **THE LONG-STANDING SHELF BUG FIXED**: the base scroller's responsive `grid-template-columns` (the 1/2/3/4-col feed grid) leaked into the horizontal shelf — the first four cards silently rendered in ZERO-WIDTH explicit tracks (a pre-R29 defect, invisible until this re-anchor measured it). The shelf now declares its own track law (`grid-template-columns: none` at every breakpoint — the later-rule override) and every card renders at 208px (live: first-6 widths 208,208,208,208,208,208).

## Evidence

- `stage4-home-badges.light.png` — corner badges live, type badges gone, the rail promo (VLM-confirmed: badges ✓, absent type ✓, promo ✓)
- `stage4-shorts-shelf.{light,dark}.png` — the 208×311 lockups at 4px gutters (VLM: vertical ✓, 6 across ✓, title-only ✓, no duration badges ✓)
- `stage4-search-badge.dark.png` — the result row's corner badge ("2:30:27", 8px inset)
- Live DOM measures recorded above (badge computed anatomy; shelf geometry; rail anatomy; History ×1)

## Gates

Battery **5132/1/0 = main's floor** · conformance CONFORMANT · contract-check OK · lane-check OK (918 files) · web build OK · lanes lint-clean.
