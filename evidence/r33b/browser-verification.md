# R33-B — THE BROWSER-LEVEL VERIFICATION (agent-browser, the live golden paths)

Instrument: `agent-browser` @1440×900 (+ the 390×844 mobile sweep) against
`WFX_DEV_FIXTURES=1 bun run --bun next dev -p 3101` (the fixture persona
boot), the `http://localhost:3101` origin (the honest sandbox note: the
`127.0.0.1` origin trips Next 16's cross-origin dev-resource block — the HMR
resource refusal — so the pass runs on the server's own advertised origin).
The evidence screenshots live in `captures/`. Zero page errors across the
whole pass (`agent-browser errors` empty at the close of every stage).

## D6 — the rail entry (the signed-out grammar)

1. **The signed-out home rail** (`captures/01-signedout-home-rail.png`): the
   primary group reads EXACTLY the corpus order with hrefs —
   `Home → /` (aria-current="page"), `Shorts → /shorts`,
   **`Subscriptions → /feed/subscriptions`** (the REAL R31 surface — the
   row's blocker dissolved), `Library → /library`. The whole rail:
   Home · Shorts · Subscriptions · Library · History · Playlists · Offline ·
   Settings — **ONE History** (D8 re-verified live), **ZERO "Watch"** labels
   across the rail + bottom nav (the D6 remap's other half).
2. **The bottom nav** (N33): `Home · Shorts · Subscriptions · Library` — the
   corpus 4-item grammar with the honest You→Library mapping.
3. **The D6 navigation** (`captures/02-subs-feed-active.png`): clicking the
   Subscriptions entry navigates to `/feed/subscriptions` — the "Latest"
   feed heading renders, and the entry paints `aria-current="page"` on BOTH
   the rail entry and the bottom-nav item (the activeRailHref seam — the
   corpus active-item grammar, exactly one active item per landmark).

## D6 — the signed-in taxonomy (the corpus logged-in grammar)

4. **The REAL sign-in** (`captures/05-settings-after-signin.png`): the
   fixture persona through the REAL `/settings?section=general` session
   form (the email/password fields + the form's own submit → POST
   /api/auth/login → the reload law) — the signed-in chrome renders (the
   account trigger + the bell; the sign-in pill gone).
5. **The signed-in home rail** (`captures/06-signedin-home.png`): the
   primary group reads **Home · Shorts · Library** — NO Subscriptions ENTRY
   (the r30 CORPUS.md §4 logged-in taxonomy: the [Subscriptions: flat
   channel list] SECTION carries the destination, never a duplicate — the
   D8 class of sloppiness is structurally impossible). The section renders
   with its heading link → `/feed/subscriptions`. The whole rail: Home ·
   Shorts · Library · History · Playlists · Offline · Settings — ONE
   History, ZERO Watch, ZERO duplicate Subscriptions navlinks.
6. **The stored-truth round trip** (`captures/08`–`11`, the R31 restart
   law reproduced): the player's REAL Subscribe pill reads its honest
   state BEFORE any click — "Subscribed" (the prior session's REAL write
   landed in the fixtures file; the toggle law means NO re-click fires)
   → the fresh process reads the fixtures file back → **the section's
   stored row renders** ("D Deep Field Diary" — the 24x24 monogram
   avatar + the entry's own title, LINKED with the entry's real player
   destination) and **the feed grid renders the same stored truth** (1
   entry: the full card grammar "Deep Field Diary · From fake-source"),
   and **the Library's own Subscriptions list renders it too** (the
   write's third surface — `captures/09`). The feed through the
   section-heading navigation paints aria-current on the bottom-nav
   Subscriptions item.
7. **The mobile sweep** (`captures/12`–`13`, @390×844): the bottom nav
   reads Home · Shorts · **Subscriptions (aria-current="page" on the feed
   route)** · Library; the guide toggle opens the DRAWER (the corpus
   mobile behavior) carrying the same signed-in taxonomy (Home · Shorts ·
   Library + the You group).

## D4 — the bell (re-verified live)

8. **The signed-in masthead**: the bell button renders
   (`data-wfx-bell-button` ✓), **NO badge paints** (`data-wfx-bell-badge`
   absent — the honest zero, CORPUS §1's two-layer grammar), the sign-in
   pill is gone.
9. **The panel** (`captures/07-bell-panel-honest-empty.png`): the click
   opens the corpus panel — the bold "Notifications" header + the
   honest-empty row ("No notifications yet — follow sources to get them")
   + the unread truth riding as data (`data-wfx-bell-unread="0"`). Never
   a fabricated row.

## D3 — the mic (the honest absence, live)

10. **Both chrome states**: zero mic markers (`[data-wfx-mic]` count 0),
    zero voice-labeled controls — the honest-transport law's absence, live
    (and pinned by the lane tests so a future dead imitation fails).

## D8 — the History dedupe (re-verified live)

11. **Both chrome states**: exactly ONE "History" navlink in the rail
    (signed-out AND signed-in) — R29-B's fix holds on the current tree.

## N28 — the rail install entry (re-adjudicated)

12. **The fixtures boot renders NO install entry** (the honest
    service-mode-only law — `InstallPrompt` mounts only when
    `mode === "service"`); the code path re-verified: the entry renders
    only when a REAL offer exists (the phase machine — the captured
    `beforeinstallprompt` or the live event). The corpus rail's own entry
    set carries no install row; the entry is the honest capability
    exposure (kept per the honest-transport law — DIVERGENCES.md row 2).

## The meta theme-color (O6's residual — CLOSED, re-verified live)

13. **The boot truth round trips** (the SAME session, live reads):
    - persisted `wfx-theme=light` → `data-theme=light`, meta
      `content="#ffffff"` (`captures/03-meta-light.png`);
    - persisted `wfx-theme=dark` → `data-theme=dark`, meta
      `content="#0f0f0f"` (`captures/04-meta-dark.png`);
    - **no stored choice** → the OS-preference derivation (this headless
      prefers light) → `data-theme=light`, meta `content="#ffffff"`.
    The meta follows the boot truth from the SAME decision that sets
    `data-theme` (R29-B's before-paint seam) — the meta never contradicts
    the rendered field; no second theme source exists.
