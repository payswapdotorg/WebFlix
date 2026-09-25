# R29-B Stage 3 — the keyboard set's PER-KEY evidence (N25)

Live probes on the service boot (:3101), the /player surface, driven through
`agent-browser` key presses (real keydown events on the window — the exact
path the keys take). Each row names the observable effect recorded at probe
time. Items probed: `Inside the Wettest City on the Planet (Rains Every Day)`
(wfxitm_735412TDZHRTXNY4PWK20J3PPA) and `Embrace the tranquility of a rainy
day in a Japanese village` (wfxitm_030SS27MDW40PFWTH6EYEVCPY5).

## Fully proven live (state + provider acks)

| Key | Evidence recorded |
| --- | --- |
| `m` | Label flips `Mute (m)` → `Unmute (m)`; the provider's own `infoDelivery` acks arrive (`muted:true, volume:100`) — the postMessage control channel round-trips. |
| `↑` / `↓` | The volume state steps (slider `1` → `0.9` after ↑ then ↓); the provider acks `volume:100` + `muted:false` (the setVolume/unMute round-trip). |
| `t` | **The 1296px theater re-anchor**: stagewrap measures **1296×729 @(72,68)** @1440 (the corpus "996→1296 (theater)" — byte-exact, 72px viewport gutters); label flips `Theater view (t)` → `Exit theater view (t)`; second `t` exits. The pre-R29 100vw bleed is gone. |
| `f` | `document.fullscreenElement` = the stagewrap; label flips `Fullscreen (f)` → `Exit fullscreen (f)`; second `f` exits. |
| `i` | **The in-app miniplayer**: the press writes the dock entry (href + title + live position) and navigates to the browse surface; the dock renders (`aside.wfx-dock`, 400px + 36px head, bottom-right) and **persists across navigation** (/ → /search → /); `Expand` returns to the full player with the dock suppressed (never a double player); a DIFFERENT item on the main stage REPLACES the dock (entry cleared — YouTube's own law); `Close` clears the entry and the dock. |
| `?` | The keyboard-shortcut sheet opens (`[data-wfx-chrome-keyboard-sheet] open=true`). |

## Command-path proven; the visible effect is evidence-gated (the honest sandbox limit)

| Key | Evidence recorded |
| --- | --- |
| `k` / `space` | The keydown reaches the window (`k@BODY` probe); the play command round-trips `/api/playback` (POST 200, network log) and dispatches `playVideo` through the provider channel. The provider's player stays in its OWN reported `buffering` state (its media stream never loads in this sandbox) — so the play-state label stays honestly `Play (k)` (the display is evidence-gated: it NEVER fabricates playing). Same evidence class as C's R28 k-verdict ("iframe-internal state unobservable"). |
| `j` / `l` / `←` / `→` / `0–9` | The seek commands round-trip `/api/playback` (POST 200) and dispatch `seekTo` through the provider channel; the visible position follows the provider's own position broadcasts, which never advance in this sandbox (the stream never loads) — the position display stays honestly frozen. |

## Honestly gated (no visible surface on this host)

| Key | Evidence recorded |
| --- | --- |
| `c` | The key toggles the captions state (the handler is live); the captions CONTROL renders only when a real caption source exists (`transcript.length > 0` gate). No service item carries a transcript (probed: 0 transcript segments in the enrichment payloads) — the control is honestly absent, and `c`'s visible surface is gated on this host's data truth. |

## The labels carry the hints (the corpus grammar)

Measured on the live chrome: `Play (k)`, `Mute (m)`/`Unmute (m)`,
`Fullscreen (f)`, `Theater view (t)`, `Miniplayer (i)`/`Expand (i)` (the
compact form), `Turn captions on (c)`/`off (c)` (when a caption source
exists). The shortcut sheets (the player's settings level-2 + the gear's
Keyboard shortcuts subpage + the `?` sheet) list the full set including the
new `↑/↓` volume rows and `I` miniplayer row.

## The miniplayer's honest mechanism note (the MPA truth)

The dock persists the playback across navigation through sessionStorage (the
href + title + live position; the compact player advances the stored position
every ~3s through the same-origin seam). The iframe re-mounts per page
(a multi-page app's truth — never claimed as an SPA element transplant); each
navigation resumes from the real reported position. The pre-R29
Document-PiP stand-in (the platform's always-on-top window) is retired: the
corpus miniplayer is the IN-APP bottom-right dock.
