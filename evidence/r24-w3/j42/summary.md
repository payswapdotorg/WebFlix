# WebFlix J42 Desktop — the WebFlix extension parity journey (machine-generated)

- commit: `c6e954276cc10a1bf1fda24cc5585ece441f314a`
- branch: `wfx/r24/desktop`
- window: 2026-09-21T04:36:40.773Z → 2026-09-21T04:36:40.783Z
- steps recorded: 10
- assertions recorded: 70
- WebFlix-only capabilities with placement decisions: 13

## The placement decisions (the R24-B capability list)

- **Source-neutral canonical identity** — Search / item / player (one title, multiple realizations) (audit row: r24-discovery-search)
- **Where to watch / realization switching** — Near Play — the Watch page's decision hub (audit row: r24-discovery-related-next)
- **Authorized peer/torrent copy** — Where to watch — a peer realization, never a download-only admin flow (audit row: r24-watch-queue)
- **Bring Your Own Feed** — Home feed mode + source context (the Following mental model) (audit row: r24-discovery-subscriptions)
- **Explicit session intent** — Home (the intent entry rides Home's own semantics) (audit row: r24-discovery-home-feed)
- **Attention modes (mindful/balanced/immersive/custom)** — Home/Personalize/player — the autoplay toggle derives from it (audit row: r24-watch-autoplay)
- **Anti-tunnel recommendation controls** — The card/player feedback menu (the familiar placement) (audit row: r24-watch-feedback)
- **Model selection (WebFlix/BYOM/local)** — The AI tray + Model & AI (optional, never required to watch) (audit row: r24-watch-captions)
- **AI transformations (transcript/translation/dubbing/commentary)** — The player's AI tray (contextual media tools) (audit row: r24-watch-transcript)
- **Semantic moment search** — Search + the transcript/chapters panel ('find the part where…') (audit row: r24-discovery-search-suggestions)
- **Contained provider BrowserHost** — The player's realization (another playback surface) (audit row: r24-watch-external-handoff)
- **Local media + verified offline Library** — Library + playback (the same item continues locally) (audit row: r24-watch-watch-later)
- **Provenance/model/license transparency** — Progressive disclosure beside the truth it describes (audit row: r24-watch-chapters)

## The walk log

### X1
Canonical identity → Where to watch: the decision hub lists the peer copy first-class beside the provider ways.

### X2
Provider → peer realization switch: both rungs through the same play-decision grammar.

### X3
BYOF context: the feed modes answer (foryou); the Desktop import discovery carries the OS-dialog truth.

### X4
Intent/attention: the session intent landed locally (never corrupting durable preferences — the J17 law); the autoplay affordance derives from the attention policy.

### X5
AI actions: the transcript/chapters render with their provenance truth from the player-adjacent AI tray.

### X6
Semantic moment search: "the parade rounds the corner" → moment@4200ms → the playhead jumped.

### X7
Library/offline/provenance: the offline section + the item-surface affordance answer; the artifacts carry their provenance truth.

### X8
Anonymous viewing stayed frictionless: the entire extension journey ran accountless.

### X9
Platform capability differences stay honest: not-exposed, honestly absent, and realization-exposed — each named, never faked.

### X10
All 13 WebFlix-only capabilities carry contextual placement decisions — every entry point is a familiar product surface.

## The assertions

- [X1] the canonical identity answers the search
- [X1] the decision hub renders the three frozen groups
- [X1] the authorized peer copy is a first-class way to watch (torrent stays first-class)
- [X2] the provider realization engaged (the contained surface)
- [X2] the realization switch to the peer copy started
- [X2] the peer copy plays (the familiar grammar on the native rung)
- [X3] the feed-mode operations answer the availability truth
- [X3] the current feed mode answers (the For-you default)
- [X3] the BYOF import discovery answers (the Desktop file-import truth)
- [X4] the session-scoped intent landed in the LOCAL active set
- [X4] the session-scoped intent NEVER wrote the server (the J17 session law)
- [X4] the mindful policy keeps autoplay off (the user control, not hidden optimization)
- [X4] the balanced policy keeps the familiar default
- [X5] the media-intelligence view answers derived
- [X5] the transcript renders with provenance (the model truth)
- [X5] the chapters render with provenance
- [X5] the not-derived note names the explicit action (never a silent background claim)
- [X6] the peer copy plays (the playhead exists)
- [X6] the semantic moment matched the query
- [X6] the moment jump executed (the playhead moved)
- [X6] the playhead landed on the moment's timestamp
- [X7] the Library's offline section answers
- [X7] the make-available-offline affordance answers from the item's own surface
- [X7] the transcript's provenance names its source honestly (source-provided, never a fabricated model)
- [X7] the chapters' provenance names the deriving model
- [X8] the open-viewing view renders for the anonymous session
- [X8] the extension journey completed without a WebFlix login
- [X9] the native volume answers not-exposed-yet (capability truth)
- [X9] the cast absence is the platform's honest truth
- [X9] the provider volume answers realization-exposed
- [X10] the 'Source-neutral canonical identity' capability has a walked audit row ('r24-discovery-search')
- [X10] the 'Source-neutral canonical identity' placement is a FAMILIAR surface ('Search / item / player (one title, multiple realizations)')
- [X10] the 'Source-neutral canonical identity' placement never requires an architecture dashboard
- [X10] the 'Where to watch / realization switching' capability has a walked audit row ('r24-discovery-related-next')
- [X10] the 'Where to watch / realization switching' placement is a FAMILIAR surface ('Near Play — the Watch page's decision hub')
- [X10] the 'Where to watch / realization switching' placement never requires an architecture dashboard
- [X10] the 'Authorized peer/torrent copy' capability has a walked audit row ('r24-watch-queue')
- [X10] the 'Authorized peer/torrent copy' placement is a FAMILIAR surface ('Where to watch — a peer realization, never a download-only admin flow')
- [X10] the 'Authorized peer/torrent copy' placement never requires an architecture dashboard
- [X10] the 'Bring Your Own Feed' capability has a walked audit row ('r24-discovery-subscriptions')
- [X10] the 'Bring Your Own Feed' placement is a FAMILIAR surface ('Home feed mode + source context (the Following mental model)')
- [X10] the 'Bring Your Own Feed' placement never requires an architecture dashboard
- [X10] the 'Explicit session intent' capability has a walked audit row ('r24-discovery-home-feed')
- [X10] the 'Explicit session intent' placement is a FAMILIAR surface ('Home (the intent entry rides Home's own semantics)')
- [X10] the 'Explicit session intent' placement never requires an architecture dashboard
- [X10] the 'Attention modes (mindful/balanced/immersive/custom)' capability has a walked audit row ('r24-watch-autoplay')
- [X10] the 'Attention modes (mindful/balanced/immersive/custom)' placement is a FAMILIAR surface ('Home/Personalize/player — the autoplay toggle derives from it')
- [X10] the 'Attention modes (mindful/balanced/immersive/custom)' placement never requires an architecture dashboard
- [X10] the 'Anti-tunnel recommendation controls' capability has a walked audit row ('r24-watch-feedback')
- [X10] the 'Anti-tunnel recommendation controls' placement is a FAMILIAR surface ('The card/player feedback menu (the familiar placement)')
- [X10] the 'Anti-tunnel recommendation controls' placement never requires an architecture dashboard
- [X10] the 'Model selection (WebFlix/BYOM/local)' capability has a walked audit row ('r24-watch-captions')
- [X10] the 'Model selection (WebFlix/BYOM/local)' placement is a FAMILIAR surface ('The AI tray + Model & AI (optional, never required to watch)')
- [X10] the 'Model selection (WebFlix/BYOM/local)' placement never requires an architecture dashboard
- [X10] the 'AI transformations (transcript/translation/dubbing/commentary)' capability has a walked audit row ('r24-watch-transcript')
- [X10] the 'AI transformations (transcript/translation/dubbing/commentary)' placement is a FAMILIAR surface ('The player's AI tray (contextual media tools)')
- [X10] the 'AI transformations (transcript/translation/dubbing/commentary)' placement never requires an architecture dashboard
- [X10] the 'Semantic moment search' capability has a walked audit row ('r24-discovery-search-suggestions')
- [X10] the 'Semantic moment search' placement is a FAMILIAR surface ('Search + the transcript/chapters panel ('find the part where…')')
- [X10] the 'Semantic moment search' placement never requires an architecture dashboard
- [X10] the 'Contained provider BrowserHost' capability has a walked audit row ('r24-watch-external-handoff')
- [X10] the 'Contained provider BrowserHost' placement is a FAMILIAR surface ('The player's realization (another playback surface)')
- [X10] the 'Contained provider BrowserHost' placement never requires an architecture dashboard
- [X10] the 'Local media + verified offline Library' capability has a walked audit row ('r24-watch-watch-later')
- [X10] the 'Local media + verified offline Library' placement is a FAMILIAR surface ('Library + playback (the same item continues locally)')
- [X10] the 'Local media + verified offline Library' placement never requires an architecture dashboard
- [X10] the 'Provenance/model/license transparency' capability has a walked audit row ('r24-watch-chapters')
- [X10] the 'Provenance/model/license transparency' placement is a FAMILIAR surface ('Progressive disclosure beside the truth it describes')
- [X10] the 'Provenance/model/license transparency' placement never requires an architecture dashboard
- [X10] all 13 WebFlix-only capabilities (the R24-B list) carry placement decisions

## Explicit limitations (never silent skips)

- The native halves (the real engine binary, the OS file dialog, the tray-kept background sync) are the lead's real-toolchain procedure per journeys/desktop/README.md — this run walks the REAL TypeScript composition over the deterministic doubles.
- The webview rendering of each placement is the lead's screenshot step; this run proves the SURFACE PROJECTION and the placement decisions.