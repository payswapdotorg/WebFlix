# Watch page anatomy — the R28 sheet

Captured 2026-09-23T23:0x–23:4xZ from live youtube.com by Worker A (1440×900, logged-out; three soft-nav landings: two shell-gated, one comments-hydrated). Provenance: **[rendered]** = this session's live DOM · **[rendered-by-lead-R27]** = R27 corpus · **[css]** = served stylesheet · **[documented]**. Raw: watch probes, `raw/watch-light.comments.json`, captures `20/40/41/43/44`.

## Layout (two-column) [rendered + rendered-by-lead-R27]
| Element | Measured | Provenance |
| --- | --- | --- |
| Page margins | 16px sides at 1440 (player x=16) | [rendered] |
| Player | **996×560 at (16,68)** — 16:9, sits below 56px masthead | [rendered] (matches R27 exactly) |
| Primary column | 1012px wide (rail-open @1440 per R27; degraded-session render gave 0-width transient) | [rendered-by-lead-R27] |
| Secondary column | 412px at x=1028, **16px gutter** | [rendered-by-lead-R27] |
| Below player | title block → info/actions → description → comments (y≈636 comments composer in hydrated landing) | [rendered] |
| `ytd-watch-flexy` flexes to theater/fullscreen/miniplayer states | player 996→1296 (theater)→full | [documented] |

## Title + info [rendered-by-lead-R27] (h1 present but empty in gated session [rendered])
- `h1.ytd-watch-metadata` — **20px / 700, lh 28**, `#0f0f0f`/`#f1f1f1`, single line (expands on click [documented]).
- Views + date line: "1.2M views • 2 days ago"-style inline metadata, 12–14px secondary-text grammar.

## Action row [css]/[rendered-by-lead-R27] — did not hydrate in the gated session
- Like/dislike **split pill** (segmented like-button + dislike-button, 36–40px pill, r18–20), Share pill ("Share" icon+label), Download, Save (playlist), overflow **"More actions"** kebab.
- R27 geometry: actions row w≈690 h42. Card-level share/download/menu measured live on the card surfaces (share-dialog.md).

## Channel row [rendered-by-lead-R27]/[css]
- Avatar (36–40px circular) + channel name (bold 14–16px) + subscriber count (12px secondary) + **Subscribe pill** (h≈36, r18, red `#f03`-family light / #f1f1f1-on-dark variant [rendered-by-lead-R27]; logged-out click → sign-in sheet [documented]).

## Description [rendered-by-lead-R27]/[css]
- `#description-inline-expander` — collapsed 1–2 lines + **"...more"** expander; 14px/400 secondary-text; expands inline (no dialog) [documented].

## Comments
→ `comments-anatomy.md` (fully [rendered] this session — header, rows, composer, sort, replies).

## Secondary column (Up next) [rendered-by-lead-R27]/[css]
- `ytd-compact-video-renderer` rows: thumb **168×94** left, title (14px/500, 2-line clamp) + channel + meta right, 4px gap between rows; hover row → preview singleton (same system as search).
- **Autoplay toggle** row at the section head: label "Autoplay" + `tp-yt-paper-toggle-button` switch (A/B position states) [css]/[rendered-by-lead-R27].

## Player chrome inventory [rendered — gated-state DOM inventory]
Mounted elements (all present in DOM even with streams stripped; bottom chrome bar stays `display:none` in gated state — reveal is player-state-driven):
- Large **Play button — `aria-label="Play (k)"`** (keyboard hint ships in the label)
- Progress bar (`.ytp-progress-bar` + `.ytp-gradient-bottom` scrim), time display (`.ytp-time-display` "0:00 / 0:00")
- Control family: play/pause, next, volume (mute + slider), captions, settings, **miniplayer**, **theater**, **fullscreen** [documented label set] + measured mounts: `ytp-unmute` popup, `ytp-cards-button` ("Show cards"), **`ytp-overflow-button` "More"** (overflow panel — the current build carries an overflow menu pattern), `ytp-copylink-button` ("Copy link"), `ytp-playlist-menu-button`, share-panel / overflow-panel / playlist-menu close buttons, cast (mdx) privacy confirm/cancel.
- Settings menu: Playback speed (0.25–2x), Quality, Captions, Sleep timer family [documented — panel interaction blocked by the gated overlay in this session].

## Keyboard shortcuts [documented] (label evidence [rendered])
k/space play-pause (aria-label "Play (k)" measured), j/l seek ±10s, m mute, f fullscreen, t theater, i miniplayer, arrows seek/volume, c captions, 0–9 percent-seek. Not exercisable without media in this sandbox.

## Miniplayer / theater / end screen [documented]
- Miniplayer: "i" key or miniplayer button → bottom-right floating player (persistent across navigation).
- Theater: player expands to full content width (1296 @1440); end screen: last ~20s overlays video-recommendation grid + subscribe card.

## Honest gaps
- Action row, channel row, description, related column: rendered only as skeleton/unhydrated in this session (gate) — R27 + [css] cited; pixel re-capture CORPUS-PENDING for the next healthy window (operator logged-in tab degraded identically — cite `docs/parity-lab/r28/lead-captures/README.md`).
- Media playback timing (first moving frame, sound state, end screen) gated (streamingData stripped).
