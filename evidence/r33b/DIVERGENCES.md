# R33-B — THE HONEST-DIVERGENCE LEDGER (WebFlix-real vs the shell corpus)

Every row: the corpus grammar (cited), WebFlix's real truth (cited), and the
honest resolution. Classes: `HD` honest-divergence (WebFlix's real surface
differs, by law) · `PEND` corpus-pending (never built — the gap that stays
pending) · `NOTE` a verification observation recorded without changing the
binding. Zero regressions: the pinned controls hold (the masthead, the
account menu, the gear, the search box, the RailSubscriptions section's rows,
the You group's History/Playlists/Offline entries, the install prompt island,
the footer — byte-identical; the pre-existing suites green at their R32
counts; the battery 5200/1/0 + exactly the 17 new lane tests).

1. **[HD] D3 — the mic stays the honest absence (no voice-search
   transport).** The corpus carries the mic at masthead center (app-shell.md
   — the logged-out anatomy: "mic button — 40px circle, raised bg, same 1px
   border"; r30 lead-captures/CORPUS.md §1 — the logged-in measure: 40x40,
   radius 50%, INSIDE the search bar's right edge). WebFlix's search
   transport is TEXT-ONLY (the SearchBox + /api/search read; no audio input
   path exists anywhere in apps/web/src), and the repo's only speech
   machinery is the model-fabric R2T2 ROUTING contract
   (packages/model-fabric/src/open-models/live-asr.ts — live captions and
   realtime translation lanes, never a search-input seam; the "speechToText"
   mentions in the capability vocabulary are ModelTask policy rows, not a
   search transport). The honest-transport law bars the chrome: the row
   stays the honest absence, now PINNED (apps/web/tests/shell-residuals.test.ts
   asserts no mic affordance renders in either chrome state — a future dead
   imitation fails the pin).

2. **[HD] N28 — the rail install entry: non-YouTube chrome, real
   transport, kept.** The corpus rail's own entry set (app-shell.md's
   section list: primary group · Explore · More from YouTube · footer
   links) carries NO install entry — YouTube's install lives in the
   browser's 3-dot chrome, never in-page. WebFlix's rail entry renders
   ONLY in service mode and ONLY when a REAL offer exists (InstallPrompt's
   phase machine: the captured `beforeinstallprompt` or the live event —
   never a fabricated offer), one disclosure quieter than the original
   floating prompt (N28's original finding, fixed at 96bb075). The
   honest-transport law permits the keep: the affordance is bound to a
   real WebFlix capability. Removing it would orphan the real capability;
   keeping it is the honest capability exposure. Re-adjudicated unchanged
   on the current tree.

3. **[PEND] D6's flat-list "Show more" collapse — the bound is
   CORPUS-PENDING, never invented.** The two corpus records disagree on
   the collapse bound: the lead healthy-window record (logged-in-surfaces,
   the D6 row's cite) shows 7 visible channels then "Show more"; the r30
   CORPUS.md §4 taxonomy shows 3 named + "+7 more channels". The DIRECT
   observations agree only on the flat-list grammar itself (24x24 avatars
   left, 204x40 entries, "Show more" present when more exist). WebFlix's
   RailSubscriptions renders the flat list over the stored truth (all
   entries, the honest empty note when none) — the R30-B/R31-verified
   surface, byte-identical on this lane. A collapse bound was NOT built
   from memory (the never-from-memory law); when a corpus capture settles
   the bound, the extension lands per the corpus. In practice the stored
   list is short (the subscribe keys items; the fixture persona carries
   single-digit entries), so the collapse never triggers today.

4. **[HD] D6's signed-in primary keeps the Library entry.** The r30
   CORPUS.md §4 logged-in taxonomy reads [Home, Shorts] as the primary
   group (the You section carries the library destination). WebFlix's
   signed-in primary renders Home · Shorts · Library — the "Library" entry
   is the established R29-verified You→Library destination mapping (the
   honest You entry + the You group's items below it), NOT this lane's
   seam to redesign (the seam law: no redesign beyond the rows). The
   ordering divergence (Library before the Subscriptions section vs the
   corpus's You-section-after) is the established mapping's own geometry,
   recorded here rather than re-shaped.

5. **[HD] The Watch browse surface loses its rail slot (the D6 remap's
   other half).** The corpus rail (both captured states) carries NO
   Watch-like long-form browse entry — YouTube's long-form watching flows
   through the home feed's cards. WebFlix's /watch surface keeps its
   frozen route + surface id (URL-direct, the frozen SurfaceId set is
   untouched) but no longer holds the rail slot Subscriptions owns. The
   surface itself is UNCHANGED (components/watch is a sibling lane's —
   byte-identical); the watch page's now-inert `active="watch"` prop is
   left as-is (the page file is outside this lane's seam).

6. **[NOTE] The J01 journey grammar is stale — the lead's own ruling
   stands.** journeys/web/j01-first-launch.ts pins the pre-D5/pre-D6 rail
   grammar (nav-a count 12, labels incl. "Search" ×2 and "Settings" ×2 —
   already failing on main per D5's recorded ruling: "J01 journey grammar
   is stale, not the app. No action."). The D6 remap changes the pinned
   labels further ("Watch" → 0 occurrences, "Subscriptions" → 2) — the
   journey file is NOT this lane's seam (journeys/ is outside
   components/shell + the rail data seam), no action per the ruling; the
   journeys runner is not in the gate battery.

7. **[NOTE] The meta theme-color residual — CLOSED by R29-B, re-verified
   live on this lane.** The task brief's premise ("the meta still reads
   #0f0f0f while the app boots light") described the pre-R29-B state: the
   CURRENT tree carries the seam (`app/layout.tsx` — the before-interactive
   script sets `meta[data-wfx-theme-color]`'s content from the SAME
   decision that sets `data-theme`; SettingsGear's `applyTheme` and the
   R31 picker's write-through keep it live). The static SSR attribute
   stays `#0f0f0f` (the conservative server default) with the script
   correcting it BEFORE the first paint on light boots — the
   `suppressHydrationWarning` seam's own honest form. Re-verified live by
   this lane's browser pass (persisted light → #ffffff, persisted dark →
   #0f0f0f, no stored choice → the OS-preference derivation); the O6 row's
   verdict note records the closure. No second theme source exists (the
   no-forked-tokens law holds — the meta reads the seam's own decision,
   never an independent value).

8. **[NOTE] The bottom-nav You mapping stays "Library".** The corpus
   bottom-nav grammar reads Home · Shorts · Subscriptions · You
   (app-shell.md); WebFlix renders Library in the fourth slot — the SAME
   honest You→Library mapping the rail carries (the R29-verified
   destination mapping, D1/D7's own family), applied to the mobile form
   when N33 closed it. Consistent with the rail's mapping; recorded so
   the mobile form's mapping decision is explicit.
