# R24-W2 — The Web YouTube-parity audit (the viewer-facing walk)

**Commit:** recorded at the R24-web-audit checkpoint on `wfx/r24/web`
**Date:** 2026-09-21T05:29:12.110Z
**Method:** the R24-C pairing matrix walked against the LIVE Web product — the fixtures boot (`WFX_DEV_FIXTURES=1`, port 3101) driven through agent-browser (navigate → networkidle → fresh snapshot per surface), plus the composition-level walking test (`apps/web/tests/r24-parity-audit.test.ts`).

## Walked rows

51 reference rows — Discovery 10 / Watch-player 26 / Shorts 7 / Identity-continuity 8 — every row classified, zero blank, zero "to be considered", machine-aligned to the shared lead-ratified taxonomy (alignment problems: 0; coverage problems: 0).

## Classification distribution

- parity: 11
- native-equivalent: 31
- platform-variant: 9
- intentionally-out-of-scope: 0

## The honest gap set (26 rows carrying R24-W2 corrections)

- **search-suggestions** (native-equivalent) — GAP — the search box was a plain form submit: no suggestion list appeared under the box while typing (no suggestion seam, no suggestion UI).
- **related-next-videos** (native-equivalent) — PARTIAL GAP — the item hub rendered a related rail ('More to explore') but the PLAYER surface rendered NO adjacent content: nothing beside the player named what could play next.
- **inline-playback** (native-equivalent) — GAP (policy+capability-gated row) — no inline preview behavior existed on any card: hovering/focusing a card showed nothing beyond the static card.
- **channel-profile-pages** (native-equivalent) — PARTIAL GAP — the source name rendered inside Where-to-watch sentences on the item hub, but the card and item surfaces carried no explicit source link row (the source identity was sentence-embedded only).
- **watch-later** (native-equivalent) — GAP — the Library Watchlist section existed, but the only save write was tied to the PROVIDER's save capability (the /api/actions bridge wrote libraryOps.save only after a provider 'save' action): a source without the save capability left NO way to save to the WebFlix watchlist at all (the fixture source is exactly this case).
- **play-pause** (parity) — GAP — the Web player rendered NO WebFlix playback controls at all: no play/pause control, no Space/K behavior (the provider iframes carry their own hidden players; the WebFlix-owned torrent stage had no transport).
- **seek-scrub** (parity) — GAP — no timeline, no scrubber, no arrow-key seeks existed anywhere on the Web player (the moment-jump links landed resume positions, but the player itself had no direct-manipulation seek).
- **volume-mute** (parity) — GAP — no volume or mute control existed on any WebFlix Web surface (provider iframes own their own volume; the WebFlix-owned stages had no volume control either).
- **fullscreen** (platform-variant) — GAP — the embed iframes declared allow="fullscreen" but the WebFlix player offered NO fullscreen control of its own (no F/Escape behavior; the user had to find the provider's own button inside the iframe, if any).
- **miniplayer-pip** (platform-variant) — GAP (capability-dependent row) — no miniplayer/PiP control existed; the browser platform does support Document Picture-in-Picture for WebFlix-owned stages, but nothing exposed it.
- **playback-speed** (parity) — GAP — no playback-speed control existed anywhere on the Web player (no settings cluster at all).
- **quality** (platform-variant) — GAP — no quality selection existed on the Web player (no settings cluster); the plan's pairing is explicitly 'where exposed'.
- **captions** (native-equivalent) — PARTIAL — the live-ASR surface (R23-G) and the transcript artifact existed, but the player had NO captions toggle and no caption rendering over the stage (the C keyboard behavior did not exist).
- **chapters** (native-equivalent) — PARTIAL GAP — the chapter LIST rendered (the intelligence surface's chapter section with jump paths) but the timeline carried no chapter marks (no timeline existed at all).
- **autoplay** (native-equivalent) — GAP — no autoplay control or behavior existed on the Web player (the attention policy existed in Personalize but nothing derived an autoplay decision from it on the player).
- **up-next** (native-equivalent) — GAP — the player had no Up-next surface (nothing named what plays next; the item hub's related rail was the only adjacent-content answer).
- **queue** (native-equivalent) — GAP — no session queue existed (the CSS classes were present; the feature was absent: no add-to-queue control on any surface, no queue panel, no queue ordering).
- **save-queue** (native-equivalent) — GAP — no queue existed to save, and no playlist write path existed on any surface.
- **share** (native-equivalent) — PARTIAL GAP — Share existed on the Shorts card (the engagement event) but NOT on the player, the item hub or content cards: no way to copy/share a canonical link from the long-form surfaces.
- **negative-feedback** (native-equivalent) — The J15 feedback vocabulary rendered on the item hub and the player; the Shorts card and content cards carried no feedback entry (the vocabulary lived on the decision surfaces only).
- **playlists** (native-equivalent) — GAP — no playlist surface existed: the Library had no Playlists section, and no save-to-playlist control existed anywhere (the runtime's listName seam existed unused).
- **shorts-sound-related** (native-equivalent) — PARTIAL GAP — the card carried no sound/source link (no canonical audio relation or source chip rendered on the Shorts card).
- **shorts-clear-screen** (native-equivalent) — GAP — no clear-screen/distraction-free toggle existed on the Shorts card (the overlay always rendered).
- **shorts-speed-controls** (parity) — GAP — no speed control existed on the Shorts card.
- **shorts-inline-feedback** (native-equivalent) — GAP — the Shorts card carried no feedback entry (the feed-level re-rank hint existed, but no per-card feedback control).
- **notifications** (platform-variant) — The web notification adapter existed (the platform seam with its tests) but NO settings entry exposed it on the visible Settings surface — the adapter was wired, the entry point was not.

## Startup-law finding (R24-E)

The live player composition resolved playback only AFTER the AI/model enrichment reads completed (the where-to-watch server resolve + the AI-tray/live-ASR model-controls reads serialized before `resolvePlayback`) — the serial chain the R24-E startup architecture law forbids. Mechanically proven by the audit-time walking test; the correction reorders the media path first.

## Evidence artifacts

- `live-home.png` — the Home walk (rows, hero, feed modes, Personalize)
- `live-player-before.png` — the player BEFORE the corrections (no WebFlix chrome)
- `live-shorts-before.png` — the Shorts walk BEFORE the corrections
- `live-library-before.png` — the Library walk BEFORE the corrections (no playlists)
