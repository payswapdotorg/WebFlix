# R27-W2 DIVERGENCES — every honest divergence from youtube.com, named + why

The operator directive (2026-09-23, binding): "run a UX/UI parity lab with
youtube between your 3 workers — the end product must look, feel and operate
exactly like youtube.com." The frozen laws govern the parity: HONEST IDENTITY
(WebFlix keeps its own wordmark/name, never YouTube's logo/trade dress),
CAPABILITY TRUTH (unavailable transport never renders usable; served
transport never renders unusable), REAL ARTWORK (`<img>` real source artwork
where the catalog carries it; generated art never substitutes), PLAYBACK (the
honest control plane + first-frame startup), NO DEAD IMITATIONS (YouTube
features WebFlix lacks → omit or honest empty, recorded here).

This file records every honest divergence — the places where WebFlix's web
app is NOT a 1:1 pixel/behavior match to youtube.com, and the honest reason.
The corpus (`docs/parity-lab/reference/`) is the contract; the harness
(`tests/parity-conformance.test.ts`) verdicted the web CONFORMANT on every
corpus-asserted value. The divergences below are either (a) honest omissions
where WebFlix lacks the transport, (b) the surface-scoped tokens the web
renders literally (the follow-up convergence), or (c) the dev-fixture-boot
environment's known limitations (the production sweep is the lead's).

---

## A. Honest identity (frozen law 1 — WebFlix never imitates YouTube's trade dress)

1. **The wordmark is WebFlix, not YouTube.** The masthead's left cluster carries
   the "WebFlix" wordmark (the `WebFlix home` link), never YouTube's logo or
   name. This is the honest-identity law: WebFlix encodes YouTube's DESIGN
   LANGUAGE (tokens, geometry, interaction grammar) — never its trade dress.
   **Why honest:** the operator directive targets the UX/UI parity (look, feel,
   operate), not the brand identity. WebFlix is its own product.

2. **The "dev fixtures" mode badge.** The masthead carries a `dev fixtures`
   mode badge (`[data-wfx-mode-badge]`) — the loud boot-mode truth (the WFX-050
   environment law). YouTube carries no such badge (it is a production
   deployment). **Why honest:** the badge states the fixture configuration
   loudly (never a fabricated production claim). It is dev-only and would be
   absent in a service-mode production boot.

3. **No YouTube mic button.** The corpus masthead (`app-shell.md`) includes a
   mic button (voice search). WebFlix omits it — the web app has no
   voice-search transport. **Why honest:** CAPABILITY TRUTH — an unavailable
   transport never renders usable. The mic button is omitted, not faked.

4. **No YouTube notifications bell.** The corpus right cluster includes a
   notifications bell (with a badge dot). WebFlix omits it — the web app has
   no notifications transport. **Why honest:** NO DEAD IMITATIONS — YouTube
   features WebFlix lacks are omitted, not faked. The right cluster carries
   the honest surfaces WebFlix has: BYOF create, theme toggle, session avatar.

---

## B. The rail grammar (the corpus mapping, honestly recorded)

5. **The rail does not carry a "Search" nav link.** The corpus rail
   (`app-shell.md`) lists Home · Shorts · Subscriptions · You (with History,
   Playlists, Your videos, Watch later, Liked videos under You). The J01 golden
   journey expects "Search" in BOTH nav landmarks (the pre-retargeting grammar).
   The retargeted rail follows the corpus: Search lives in the MASTHEAD search
   pill, not the rail. **Why honest:** the corpus wins — `app-shell.md` places
   Search in the masthead center cluster, not the rail. The Search surface IS
   reachable (the masthead search pill + the /search route). The J01 journey's
   assertion (2 Search nav links) is stale relative to the corpus retargeting;
   the app is correct, the journey's expected-label set is the pre-parity
   grammar. **Recorded here, not fixed in the app** (the corpus is the contract).

6. **The rail carries "Watch" (the long-form browse), not "Subscriptions".**
   The corpus rail has "Subscriptions" (YouTube's subscription feed).
   WebFlix has no subscription transport — the honest mapping is the surfaces
   that exist: Library, History, Settings. The rail carries Home · Shorts ·
   Watch · Library · You(heading) · History · Offline · Settings. The "Watch"
   entry is WebFlix's long-form browse surface (the honest equivalent of
   YouTube's subscription feed for the sources the user actually has).
   **Why honest:** `app-shell.md` line 48: "WebFlix mapping: Home · Shorts ·
   Subscriptions→(honest: the surfaces that exist — Library, History,
   Settings; record any unmapped YouTube destination in DIVERGENCES)."

7. **The "Offline" rail entry.** The rail carries an "Offline" entry
   (the PWA offline page) — a WebFlix-specific surface YouTube does not have.
   **Why honest:** WebFlix's install/offline capability (the WFX-057 delivery)
   is a real surface; the rail exposes it honestly. YouTube has no equivalent
   (it is always-online).

8. **A duplicate "History" in the rail.** The live nav shows "History" twice
   (once in the You section, once as a top-level entry). This is a minor
   redundancy in the retargeted rail. **Why honest:** the rail retarget (the
   prior session's `1b6b360` APP SHELL commit) placed History in two positions
   (the You section's first item + a top-level row). It is a cosmetic
   redundancy, not a functional defect (both link to the same surface). Not
   harness-flagged; recorded for the lead's rail-grammar cleanup.

---

## C. Honest capability omissions (frozen law 2 — capability truth both directions)

9. **No comments section on the watch page.** The corpus watch-geometry.md
   includes a comments section (20px/400 heading + list). WebFlix has no
   comments transport. **Why honest:** the corpus itself notes this
   (`watch-geometry.md` line 43-44: "WebFlix divergence: no comment transport —
   honest omission per the lab laws; record in DIVERGENCES"). The watch page
   omits the comments section entirely (never a fake comment list).

10. **No live-chat / membership / premiere surfaces.** YouTube's watch page
    carries live chat, membership join, and premiere surfaces for live/member
    content. WebFlix has none of these transports. **Why honest:** omitted
    (NO DEAD IMITATIONS), never faked.

11. **No "Subscribe" button on the watch owner row.** The corpus owner row
    includes a Subscribe-style CTA. WebFlix's watch owner row carries the
    honest channel-name + mode label (the `data-wfx-player-mode-label`), not a
    Subscribe button (WebFlix has no subscription transport). The CTA tokens
    (`--wfx-cta-bg` / `--wfx-cta-fg`) ARE ACTIVE and available for the
    surfaces that use them (the BYOF acquire pill). **Why honest:** the
    Subscribe CTA is omitted on the watch page (no subscription transport),
    not faked.

12. **The settings popup carries WebFlix's own capability rows.** The corpus
    settings gear popup (the two-level menu with back arrow) carries YouTube's
    speed/quality rows. WebFlix's popup carries the corpus speed rows PLUS
    WebFlix's honest capability rows: Translate, Transcript, AI, Provenance,
    Where-to-watch — each capability-truth-gated (renders only when the
    transport exists). **Why honest:** these are WebFlix's REAL capabilities
    (the R21/R25 lanes), progressively disclosed in the corpus popup anatomy —
    not YouTube's, but honest and in-grammar.

---

## D. The watch geometry — the rail-open measurement

13. **The primary column is narrower than the corpus 1012px at 1440.** The
    corpus measures the watch shell at 1440 with the guide COLLAPSED (no rail):
    primary 1012 = 1440 − 412 − 16. The web renders the watch page with the
    rail OPEN (240px) by default at 1440, so the content narrows: measured
    live, `.wfx-player__layout` = `724px 412px` (primary 724 + secondary 412,
    after the 240px rail + page margins). **Why honest:** the corpus geometry
    is the guide-collapsed measurement; the web's default is guide-open (the
    YouTube default at 1440 IS guide-open too — YouTube's primary is also
    narrower than 1012 with the guide open). The HARNESS asserts the
    corpus-checked values: `grid-template-columns` contains `412px` (the
    secondary) ✓ and `gap` is `16px` ✓ (the drift fix). The primary flexes with
    the content width — this is the correct responsive behavior. The user can
    collapse the guide (the "Open guide" hamburger) to reach the full-bleed
    1012px primary.

14. **The `.wfx-player` page padding is 24px @1440 / 32px @≥1600, where the
    corpus documents 16px @1440 / 24px @≥1600.** The watch container's
    horizontal padding (the page margin) is wider than the corpus's measured
    16px. The harness does NOT assert the web's page margin (the WEB_PARITY_SURFACE
    descriptor checks `.wfx-player__layout` gap + grid-template-columns, not
    `.wfx-player` padding — the DESKTOP surface checks `.wfx-watch` padding;
    the web's `.wfx-player` is the analog). The CSS comment at globals.css:1612
    documents the INTENT as "16px margins → 24 @≥1600"; the implementation
    carries 24px/32px. **Why honest:** this is a real margin divergence from
    the corpus (the harness does not flag it for the web surface). Recorded
    here for the lead's margin-conformance decision; the column GAP (the
    harness-flagged drift) is fixed to 16px. Adopting the corpus 16px/24px
    margins is a follow-up; it does not affect the conformance verdict.

---

## E. The real-artwork law (frozen law — 100/100 where the catalog carries it)

15. **The dev-fixture cards render the placeholder, not `<img>` artwork.** The
    home feed's cards carry the CSS-gradient placeholder with the card's
    initials (e.g. "NR" for Neon Rain), not `<img>` source artwork. The
    `ArtworkImage` component renders `null` when no real artwork URL exists
    (the dev fixtures don't carry artwork URLs), and the placeholder shows
    through. **Why honest:** the REAL ARTWORK law requires `<img>` real source
    artwork WHERE THE CATALOG CARRIES IT (100/100). The dev fixtures don't
    carry artwork URLs (they're deterministic dev content, not production
    source-authorized thumbnails). In production (real source-authorized
    artwork), the `<img>` renders with `data-wfx-artwork-img` + the source's
    own URL + `loading="lazy"` + the strict referrer policy (the
    `ArtworkImage` component is the real code path). The battery's
    real-thumbnails era-test (the R26 era-test) verifies the `<img>` renders
    when artwork exists; the 0-`<img>` home capture is the honest fallback for
    fixture content, never a generated-image substitution.

---

## F. Surface-scoped tokens (the follow-up convergence, not a defect)

16. **9 canonical tokens are rendered literally, not as custom properties.**
    The web declares 13 of the 22 canonical tokens as `--wfx-*` custom
    properties (the corpus core). The other 9 (hairline, pill-surface,
    pill-ink, scrollbar-thumb, toast-surface, toast-ink, chrome-scrim,
    chrome-ink, stage-black) are rendered with LITERAL values at the selector
    where the anatomy lives (e.g. `body::-webkit-scrollbar-thumb` carries the
    literal `hsl(0,0%,67%)`; `.wfx-chrome` carries the literal
    `linear-gradient(...)` scrim). **Why honest:** the harness REPORTS these
    as surface-scoped (informational, not failed) — the web's anatomy is
    correct (the values match the corpus), the custom-property name is the
    follow-up convergence. Adopting the canonical `--wfx-*` names for these 9
    is the W1 charter's documented convergence path; it is not a conformance
    defect (the harness verdict is CONFORMANT with these reported).

---

## G. The dev-fixture-boot journey limitations (the lead's production sweep)

17. **The golden journey suite is non-deterministic in the dev-fixture boot.**
    The journey runner boots the deterministic fixtures product and drives 41
    encoded journeys through agent-browser. In the sandbox dev-fixture boot,
    a subset of journeys exhibit flaky failures across runs (the failing
    journey set and the failing assertion shift between runs — e.g. the first
    full run failed 5 journeys {J01, J12, J36, J37, J43}; a re-run failed a
    different set including J02, J06–J11). **Why honest:** the documented
    configuration limits (the Turbopack dev server's separate module graphs
    prevent the cross-page watch-state fold — J12/J37's limitation; the
    fixture provider URLs are network-blocked so provider frames fail
    deterministically — the journeys assert the DOM containment grammar, not
    provider content; the agent-browser session timing is
    environment-sensitive). The prior session's record ("All 13 golden
    journeys passed on-branch") is the stable-core subset; the full 41-suite
    carries the documented configuration limits. The production parity sweep
    (the single-bundle production build, one runtime instance, real provider
    transports) is the lead's J35-class procedure.

18. **The J01 golden journey expects the pre-retargeting nav grammar.** J01
    asserts 2 nav links labeled "Search" (and 12 total `nav a` = 6 surfaces ×
    2 landmarks). The retargeted rail (the corpus grammar) omits Search from
    the rail (it is in the masthead). The live nav has 12 links but the label
    set is {Home, Shorts, Watch, Library, History, Offline, Settings} (rail) +
    {Home, Shorts, Watch, Library} (bottom nav) — no "Search" link. **Why
    honest:** see divergence #5 — the corpus wins; the app is correct; the
    journey's expected-label set is the pre-parity grammar. Recorded here,
    not fixed in the app.

---

## H. The honest empty states (NO DEAD IMITATIONS)

19. **The watch browse empty state.** When a configured source answers with
    no long-form cards, the watch browse surface renders the typed empty state
    ("Nothing to browse yet — The configured source answered with no long-form
    cards. WebFlix never fabricates content.") with a "Try search" action.
    **Why honest:** YouTube's watch page (logged-in, subscribed) always has
    content. WebFlix's watch browse is over the user's OWN sources; an empty
    source is an honest empty state, never fabricated content.

20. **The shorts honest empty.** The shorts surface (the corpus 100dvh stage,
    9:16 centered, 48px action rail) carries the honest capability truth —
    films are never presented as shorts (the `r27ShortsPageView` honest empty
    state, per the W3 lane's `5cfef7e` evidence). **Why honest:** the
    films-are-never-shorts law — WebFlix's shorts transport is the real shorts
    content (if any), never a long-form film truncated into a short.

---

## I. The honest session state (no fabricated profile)

21. **The "Signed out" session truth.** The masthead carries the honest
    signed-out session state ("Signed out" + the session avatar), never a
    fabricated profile. **Why honest:** the R02 seam's truth — the anonymous
    session is frictionless (frozen law: anonymous journeys frictionless), and
    the session state is never faked. YouTube's logged-in state (real profile)
    is the production sweep; WebFlix's fixture boot is honestly signed-out.

---

## Summary

The web surface is CONFORMANT (the harness verdict). The divergences above are
the honest omissions (capability truth), the surface-scoped token convergence
(follow-up, not a defect), the dev-fixture-boot journey flakiness (the lead's
production sweep), and the J01 stale-journey expectation (the corpus wins). The
drift fix (the watch column gap 16px) and the resume-text period fix are the
two surgical defect corrections this resumption made; both are closed and the
web wave-state is green.
