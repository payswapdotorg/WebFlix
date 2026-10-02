# WFX-DEPLOY-W3 — the DEPLOYMENT.md accuracy pass (the change record)

Owner file: `apps/web/DEPLOYMENT.md` (this lane's owned file). The work order's rule:
"Correct ONLY verified inaccuracies; record each change + its evidence." Every change
below was verified against the app source at main @ fbbef9b + this lane's live probes
before editing; nothing else in the file was touched (the health contract, the env law
rows, the boot law, the transport table, the Vercel project settings, and the WFX-057
install/update procedures were verified ACCURATE and left unchanged).

## Change 1 — the page route inventory completed (9 missing routes)

- **What changed:** the "Route inventory" page table gained `/channel/[handle]`, `/live`,
  `/library`, `/feed/subscriptions`, `/settings`, and the five `/studio*` routes; the `/`
  row's hero claim corrected to the R28-B composition (chip bar + rows; the hero moved to
  Settings→General); the `/item` row's params corrected (`?id=` first — the canonical id).
- **Evidence:** every page file carries `export const dynamic = "force-dynamic"` except
  `offline/page.tsx` (verified per file: `(home)`, `channel/andle]/`, `feed/subscriptions`,
  `library`, `live`, `search`, `settings`, `shorts`, `studio`×5, `watch`, `item`, `player`);
  the production build table (`health-offline-pwa/pwa-production-start-verification.md`)
  shows `○ /offline` as the ONE static route and every other page `ƒ` dynamic. The `/`
  row's composition: journey J02's encoded truth (the R28-B chip bar; the hero's honest
  absence documented in that journey since r35b).
- **Verified inaccuracy:** the table documented only the 8 WFX-056-era routes; the app
  ships 17 page files (R36/R37/R38-B/R30-B/R31 landed since).

## Change 2 — the internal API route table extended (4 → 21 route rows)

- **What changed:** the API table now documents every route in `src/app/api/` —
  acquisition, actions, auth (login/register/logout/session/select-profile), byof,
  capabilities, events, feed-mode, feedback, health, intelligence, library, model
  (byom bind/unbind, open-models), personalize, playback, preview, queue, search/suggest,
  shorts, shorts-session, sources, transform — each with its verified methods and purpose;
  the four documented failure laws (health deterministic; actions 400/502; events the
  closed vocabulary + 502; shorts 502) kept verbatim.
- **Evidence:** methods verified per route source (`export function GET/POST/…`);
  purposes quoted from each route's own header; the failure laws machine-tested by
  `apps/web/tests/adapter-api-routes.test.ts` (12 tests) AND verified live by this lane's
  probe battery (`health-offline-pwa/api-route-probes.txt`: actions malformed→400 ×2,
  events `type:start`→400 **with the closed-vocabulary reason verbatim**, events valid
  progress→200, shorts→200, health→200).

## Change 3 — the "five small islands" claim corrected

- **What changed:** "Client JS is limited to five small islands (…); the search box and
  avatar menu are plain HTML (form + `details`)" → the current truth: a set of small
  islands inside server-rendered surfaces (the shell islands incl. SearchBox with its
  suggestion seam and AccountMenu — both `"use client"` — the card/player/shorts/studio/
  live/settings islands; 56 client components at this writing; the PWA islands mount in
  service mode only).
- **Evidence:** `grep -rln "use client" src/` → 56 files (SearchBox.tsx and AccountMenu.tsx
  among them); SearchBox's own header documents the suggestion seam with the plain-form
  degrade path.

## Change 4 — the installable-surfaces color errors corrected

- **What changed:** `background_color + theme_color #0b0a10` → `#0f0f0f`; "the topbar
  paints `rgba(11,10,16,0.92)`" → "paints `var(--wfx-bg)`"; "`viewport.themeColor`
  (`#0b0a10`)" → the R29-B theme-color seam (`<meta name="theme-color"
  data-wfx-theme-color>` following the BOOT theme — `#ffffff` light / `#0f0f0f` dark,
  set before first paint, kept in sync live by the Appearance rows).
- **Evidence:** `public/manifest.webmanifest` declares `#0f0f0f` for both colors;
  `globals.css` `--wfx-bg: #0f0f0f` (no `#0b0a10` exists anywhere in src/ or public/ —
  `grep -rn "0b0a10"` is empty); `.wfx-topbar { background: var(--wfx-bg); }`;
  `layout.tsx` renders the `data-wfx-theme-color` meta (the R29-B comment block in that
  file documents the boot-theme seam); `tests/pwa-manifest.test.ts` asserts `#0f0f0f`.

## Verified accurate (no change)

- The health contract (`{ok,service:"webflix-web",version:"0.1.0"}` — `src/host/version.ts`
  + `route.ts`; asserted in-suite by J49 + live in all three boots + production).
- The env law rows and the boot law (`src/host/config.ts` — the typed `HostConfigError`
  paths, `WFX_DEV_FIXTURES` never in production, `WFX_API_BASE` required in service mode).
- The `WFX_API_BASE` transport table + the failure semantics (degrade laws).
- The Vercel project settings table + the WFX-056/WFX-057 records in
  `docs/infrastructure/deployment.md` (not this lane's file — verified for cross-accuracy,
  no change needed by this lane's findings).

## An OBSERVED quirk recorded for the TL (NOT a doc change — the doc documents behavior)

The channel route's directory in the app tree is literally `andle]` (a mangled `[handle]`
from the R36 lane — its own commit message names it verbatim). The ROUTE BEHAVIOR is
correct: `/channel/<any-handle>` renders the channel surface for that handle (REPRODUCED
live: `/channel/fake-source` → 200, 93KB, `data-wfx-surface="channel"`, the Fake Source
identity; J44's 57 assertions pass over it). The build table displays the literal segment.
A rename to `[handle]` is an `apps/web/src/app/**` change (outside this lane's ownership) —
HANDOFF to the TL.
