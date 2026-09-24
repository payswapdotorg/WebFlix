# R29-B Stage 3 — Masthead gear + sign-in + the keyboard set (N24 + N12 + N25 + the O6 meta residual)

Worker B's lane notes. Base: `origin/main @ ab49392`; lane head after Stage 2: `bcd8120`.

## What shipped

### N24 — THE SETTINGS GEAR MENU (the corpus multi-page menu)

`apps/web/src/components/shell/SettingsGear.tsx` — the masthead gear (40px,
where the R28 theme toggle sat) opens the corpus paper-menu family (raised
surface, r12, the corpus dialog shadow `rgba(0,0,0,0.15) 0 0 24px 12px`):

- **Your data** → `/settings?section=general` (WebFlix's session/data truth: the capability table + the session durability disclosure — the honest equivalent of YouTube's data page).
- **Appearance ›** → the Dark/Light rows subpage (the N15 corpus path — the R28 seam: `data-theme` + persisted `wfx-theme` + the theme-color meta kept in sync; live-verified: clicking Dark flips the app + meta + storage together).
- **Keyboard shortcuts ›** → the real key sheet (every row a bound key on the player surface — Space/K, J/L, ←/→, ↑/↓, 0–9, M, F, T, I, C, ?).
- **Settings** → `/settings`.
- **Display language / Restricted Mode / Location / Help / Send feedback**: honestly ABSENT (no language packs, no content-restriction engine, no location signal, no help surface, no feedback transport) — named by the menu's own absence note (the filters-dialog precedent's grammar), never dead rows.

The R28 **ThemeToggle button is retired** — its abbreviated surface replaced by the corpus's own Appearance path (no test/journey pinned the toggle; battery + journeys green).

### N12 — THE SIGN-IN PILL (the corpus anatomy, byte-exact)

`40px height · r20 · #065fd4 · 14px/500 · border 1px rgba(0,0,0,0.2)` + the
person mark + "Sign in" — live-measured on the masthead: `40px r20px
rgb(6,95,212) 14px/500 border 1px rgba(0,0,0,0.2)` — wired to the REAL
identity path (`/settings?section=general` — the SessionControls surface:
sign-in/profile over the completed identity transport). The avatar menu
stays (the session-honesty disclosure); the pill is the corpus CTA.

### O6 residual — THE META THEME-COLOR FOLLOWS THE BOOT

`layout.tsx`: the `viewport.themeColor` pin (always `#0f0f0f`) is replaced by
the seam's own `<meta data-wfx-theme-color>` set BEFORE first paint by the
same script that sets `data-theme` (persisted choice, else OS preference):
light boots `#ffffff`, dark boots `#0f0f0f` (the corpus core pair) —
live-verified both ways; the Appearance rows keep it in sync live.

### N25 — THE KEYBOARD SET + THEATER RE-ANCHOR + THE IN-APP MINIPLAYER

- **Theater re-anchor**: the pre-R29 `100vw` bleed (the standing divergence) → the corpus **1296px full-content-width**, viewport-centered — live-measured **1296×729 @(72,68)** @1440 (byte-exact; the ≥1600 band corrects for its 24px padding).
- **The in-app miniplayer** (`i` + the chrome control): the Document-PiP stand-in retired; the corpus bottom-right floating persistent player now ships — `MiniplayerDock` island in the shell (400px + 36px title row, expand + close actions), the `/player?…&miniplayer=1` compact form (the SAME Stage + PlayerChrome, no watch anatomy), sessionStorage persistence with the compact player advancing the stored position (~3s, same-origin seam), the REPLACE rule (a different item on the main stage clears the dock), and the SUPPRESSION law (the dock never renders alongside a main player surface — never a double player). Full flow live-verified (dock → persistence across / and /search → expand → replace → close).
- **The per-key evidence**: `evidence/r29-web/verifications/stage3-keyboard-perkey.md` — m/↑/↓ (provider-acked state flips), t (the 1296 measure), f (fullscreen state), i (the complete dock flow), ? (the sheet) fully proven; k/space/j/l/←/→/0–9 command-path proven (`/api/playback` 200 + the postMessage dispatch) with the visible effect honestly evidence-gated (the provider's stream never loads in this sandbox — the display never fabricates; C's R28 k-verdict class); c honestly gated (no caption source on this host's items — the control renders only with a real transcript).
- The shortcut sheets gained the `↑/↓` volume rows and the `I` miniplayer row (the player's settings level-2 + the `?` sheet + the gear's subpage).

## Evidence

- `stage3-masthead-signin.{light,dark}.png` — the new right cluster (gear + sign-in pill; the theme toggle gone — DOM-verified)
- `stage3-gear-menu.light.png`, `stage3-gear-appearance.dark.png` — the menu + the Appearance subpage (live theme flip)
- `stage3-theater-1296.{light,dark}.png` — the re-anchored theater (1296 @72 gutters)
- `stage3-miniplayer-dock.light.png` — the persistent dock
- `stage3-keyboard-sheet.light.png` — the `?` sheet
- `stage3-keyboard-perkey.md` — the per-key evidence table

## Gates

See the Stage-3 commit message (battery 5132/1/0 = main's floor; conformance CONFORMANT; contract + lane OK; web build OK; lanes lint-clean — the repo-wide lint's 20 pre-existing r28-recon errors unchanged, outside this lane's paths).
