# R27-W3 — DIVERGENCES (every honest divergence from youtube.com, named)

The lab laws (docs/parity-lab/README.md): "Where YouTube has a feature
WebFlix truthfully lacks, do NOT fabricate a dead imitation: either omit
the surface or render the honest empty state, and record the divergence."
This is the Desktop lane's record — each divergence names WHAT diverges,
WHY (the truthful absence), and WHERE the honest path lives.

## Watch page

1. **No comments section.** WebFlix has no comment transport. The corpus
   itself records this expected divergence (watch-geometry.md: "WebFlix
   divergence: no comment transport — honest omission per the lab laws").
   Omitted; the Where-to-watch panel and the description expander carry
   the watch body instead.
2. **The actions row renders Feedback (segmented pill) — not like/dislike
   counters.** The runtime's real feedback vocabulary is "More like this
   / Not interested" (R05 recommendation feedback); there is no like-count
   transport, so no like-count chrome is fabricated. Share (the OS share
   sheet) and Save (the Library watchlist write) are the true pills.
3. **No Subscribe button.** No subscription transport exists. The
   `cta-surface`/`cta-ink` tokens are in the contract (the corpus's
   Subscribe-style primary CTA) for the day a truthful primary channel
   action exists; nothing renders them as a dead button today.
4. **The owner row shows no subscriber count.** No such fact exists in
   the catalog; the owner meta renders the true facts (year · type ·
   license basis).
5. **Card meta lines carry no "views · age".** The desktop catalog
   carries no view-count or publish-age facts, so the meta line renders
   the real facts (canonical type · license basis, e.g. "Video · CC BY
   3.0"). Never a fabricated count. (The corpus's home-feed cards are
   `[documented]`; the sheet's meta row is honored wherever a truthful
   views/age fact exists — none does on this surface.)
6. **Duration pills render only where the truth exists.** Rows without a
   published duration render no pill (never an invented length).

## Shell (topbar / rail)

7. **No mic affordance in the search pill.** No speech transport is
   bound on the Desktop surface (the search input + suggestions grammar
   render; the mic is honestly absent — `r27ShellView().topbar.search.mic`
   is `null` by type).
8. **No notifications bell.** The Desktop platform has OS notifications
   (the truthful `NotificationPort`), not an in-app notification feed.
   The right cluster renders the real entries: Bring-your-feed (BYOF)
   and the account entry.
9. **Rail destinations: no Subscriptions / Explore / More-from-YouTube.**
   No truthful surfaces exist for those YouTube destinations. The rail
   renders the honest WebFlix mapping app-shell.md prescribes: Home ·
   Shorts · Library · History · Settings (+ the Settings group).
10. **No bottom navigation.** The native window's minWidth is 960px
    (`shell/tauri.conf.json`), so the <792px bottom-nav grammar never
    renders on this platform — the honest window-chrome mapping (the
    792–1279 icon-rail and ≥1280 labeled-rail grammar both render).

## Search

11. **No channel-result rows.** No channel-creator surface exists on the
    Desktop browse/search reads; only video rows render (the server rows
    the transport truthfully serves + the authorized peer rows).
12. **No verified glyph.** No verification transport exists; the channel
    row renders the plain creator attribution.
13. **Snippets only where carried.** Peer rows carry the real synopsis;
    server rows honestly render no snippet line (the shape is present,
    the content is not fabricated).
14. **Filters pill renders as the header affordance.** The corpus's
    Filters pill is placed; the filter panel behind it is the R26-gated
    surfaces' own disclosure (not a fabricated filter matrix).

## Shorts

15. **The shorts feed renders the honest empty state.** The vertical
    9:16 stage + action-rail grammar renders (the CSS layer + the shell
    destination + `r27ShortsPageView`), but the runtime's shorts read
    truthfully serves no rows on this composition, so the surface shows
    the honest empty note. The peer catalog's FEATURE FILMS are never
    presented as shorts (they are not shorts — capability truth cuts
    both ways).

## Player chrome

16. **Native volume/mute are honestly "not-exposed-yet".** The R26 native
    rung does not expose volume commands; the controls render with the
    honest device-volume note (the R24 affordance discipline, unchanged).
    Provider (embed) ways carry their own volume — rendered as
    realization-exposed.
17. **`t` is THEATER (the R27 corpus retarget).** The R24 map bound `t`
    to transcript; the corpus keyboard grammar pins `t` = theater, so the
    R27 chrome map retargets it and transcript moves into the settings
    popup (the corpus's own placement for it). The R24 surface and its
    battery are untouched — this is the supersession record.
18. **The time readout renders current-only while the duration is
    unknown.** The native rung's duration arrives as the engine's own
    measured truth; until then the readout honestly shows the current
    time only (never a fabricated total).

## Cross-app notes (for the lead's conformance pass)

19. **W2's web branch uses 24px watch padding at 1440; this lane encodes
    the corpus-measured 16px** (player 996@x=16, secondary 412@x=1028 —
    16+996+16+412=1440, verified against the rendered DOM in
    TOKEN-MAPPING.md). The corpus sheet is the contract; W1's harness
    should arbitrate both apps to the measured values.
20. **W1's shared token contract (`wfx/r27/shared`) had not landed when
    this lane started** — this lane mirrors the sheet exactly in
    `apps/desktop/src/surface/r27-parity-tokens.ts` (provenance-tagged,
    machine-checked by `apps/desktop/tests/r27-parity-tokens.test.ts`)
    and records the mapping in TOKEN-MAPPING.md for the conformance pass.
