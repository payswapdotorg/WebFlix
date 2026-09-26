# R31 — THE BROWSER-LEVEL VERIFICATION (agent-browser, the live golden paths)

UNLIKE the R30-B sandbox (its divergence row 20: the dev server OOM-killed at
compile — the BLK class), THIS sandbox's dev server boots cleanly, so the two
surfaces were verified LIVE at the browser level — beyond the R30-B evidence
standard (SSR composition captures only).

Instrument: `agent-browser` @1440×900 against
`WFX_DEV_FIXTURES=1 bun run --bun next dev -p 3101` (the fixture persona boot).
The evidence screenshots live in `captures/browser-*.png`.

## §G1 — the theme-picker submenu (the live golden path)

1. **The sign-in** (the fixture persona through the REAL
   `/settings?section=general` session form): the signed-in corpus chrome
   renders — the Notifications bell + the account-menu avatar trigger.
2. **The menu opens** (the avatar click): the R30-B row grammar renders,
   including `menuitem "Appearance: Device theme"`.
3. **The picker opens** (the Appearance row click — the captured path): the
   sub-page renders EXACTLY the captured grammar —
   - the header: `menu "Appearance"` + `button "Back"` (the arrow icon);
   - the subtext: "Setting applies to this browser only";
   - exactly 3 `menuitemradio` rows in the captured order:
     "Use device theme" `[checked=true]` (the captured state — no stored
     choice), "Dark theme" `[checked=false]`, "Light theme" `[checked=false]`.
4. **The measured geometry** (the DOM rects): rows **300×40 each**, stacked at
   **exactly the 40px vertical pitch** (y=148/188/228); the header at y=63
   (the corpus: the "Appearance" header at y=67); the panel right-anchored
   (x=1119 — the corpus's x=1108 family). The selected row's mark slot
   carries the **check-in-box** (`rect` present); the unselected rows' slots
   are reserved but unpainted — the captured label alignment.
   → `captures/browser-01-picker-device.png`.
5. **The Dark write-through** (the "Dark theme" click):
   `{ theme: "dark", stored: "dark", meta: "#0f0f0f" }` — the REAL seam
   wrote (dataset + `wfx-theme` + the theme-color meta).
6. **The back arrow returns to the main menu** and the root row's label
   UPDATED: `menuitem "Appearance: Dark theme"` — the two-layer truth (the
   menu row carries the STATE, the picker row carries the CHECK).
7. **The device write** (the "Use device theme" click):
   `{ theme: "light", stored: null }` — the stored choice REMOVED (the boot
   law's OS-preference follow resumes) and the OS preference applied LIVE
   (this headless browser prefers light → light) — the before-paint script's
   own derivation.

## §G2 — the subscriptions-feed grid (the live golden path)

1. **The real subscribe write**: search → the item page → Play → the player's
   channel row → the REAL Subscribe pill → "Subscribed — saved to your
   Subscriptions list in Library." (the POST /api/library seam).
   → `captures/browser-02-subscribe-write.png`.
2. **The feed at /feed/subscriptions** (the corpus URL): the "Latest" heading
   + the honest EMPTY state first ("No subscriptions yet — subscribe from any
   watch page") — the dev-server split-module law (the page engine's memoized
   hydrate predates the write; the fixtures FILE is the truth) — then, after
   the server restart, the stored truth reads back and **the card renders**.
3. **The cold-boot UNLINKED card** (the Library's own law, verified side by
   side: `/library` renders the same stored entry as "Source unknown in this
   session"): the feed page runs no view loader, so the process join map is
   empty — the honest UNLINKED cell (never a fabricated link).
4. **The connector read joins**: after the search view (the real connector
   read that learns the join), the same card renders LINKED — the full card
   grammar (`title "Deep Field Diary"`, `"From fake-source"`, the player
   href) — and the card's click NAVIGATES to the entry's own player surface
   (the rail rows' route law, proven end-to-end).
   → `captures/browser-03-subs-feed-grid.png` (the unlinked cold boot) +
   `captures/browser-04-subs-feed-linked.png` (the joined card).
5. **The measured grid**: x=240 (the shell's content area — the frozen 240px
   rail; the corpus's x=72 was the collapsed-guide window, recorded as the
   divergence), w=1200, **4 columns** at 1440 (the browse column law; the
   captured 1352px bar's 3-full-plus-partial-4th geometry).
6. **The responsive law**: at 390px the grid is **1 column** (the
   1 <600 law).
7. **Zero page errors, zero console errors/warnings** across the whole run.

## The honest notes

- The dev-server split-module reality (the library-fixtures.ts law: the
  Turbopack route/page module graphs split; the fixtures FILE is the truth)
  means an in-session subscribe reaches a fresh page render only after the
  page engine's hydrate memo resets (a server restart) — the ESTABLISHED
  R30-A seam behavior, unchanged by this lane (the rail has the same law on
  a cold page; the tests prove the same-process flow through the REAL seam).
- The cold-boot UNLINKED card is the honest per-process join law the Library
  and the rail already follow (verified live side by side) — never a
  fabricated link; the connector read (the search view) joins the card in
  the same process, exactly as the task's "through the real connector read"
  demands.
