R34-A — the parity adjudication tables (J40 + J42)

Lane wfx/r34a/accept-j40-j42 · base main @ 09d0205 · production targethttps://webflix-steel.vercel.app · every row below cites its run artifactunder evidence/r34a/ (screenshots screenshots/j40-* / j42-*, snapshotssnapshots/, per-step status raw/j40-steps/ / raw/j42-steps/, the runnermanifest j40-runner/manifest.json).

Row-id vocabulary: ParityTaxonomyRowId frompackages/client-runtime/src/parity-taxonomy.ts (the frozen 65-row matrix;the id list rides _survey/taxonomy-row-ids.txt). Classification vocabularyper docs/validation/youtube-parity-lab.md: PARITY / NATIVE-EQUIVALENT /PLATFORM-VARIANT / INTENTIONALLY-OUT-OF-SCOPE.

Part 1 — the J40 pairing rows (every exercised viewer-facing behavior)

The walk (the spec path verbatim): Home -> Search -> open video -> Play ->player controls -> browse adjacent content -> queue/watchlist/playlist ->Shorts -> feedback -> Library/History.

#	exercised behavior (the walk's own step)	taxonomy row	lab classification	the production observation (evidence)
1	Home feed — fresh anonymous arrival, source-neutral cards	home-feed	NATIVE-EQUIVALENT	[data-wfx-surface='home'] + 100 data-wfx-card in the live DOM (SSR carries 1484 markers); nav = Home/Shorts/Following/Library/Offline/Settings (j40-step01)
2	Search — unified, exact-title lane	search	NATIVE-EQUIVALENT	the searchbox renders; "Never Gonna" submits to results (j40-step02/03); the honest typed empty states answer absent terms verbatim (the catalog probe)
3	Search suggestions under the box	search-suggestions	NATIVE-EQUIVALENT	[data-wfx-suggestions] renders for a catalog term with the rick row; /api/search/suggest answered 200 (j40-step02)
4	Open a video — the search result opens the watch surface directly	channel-profile-pages adjacency + inline-playback grammar note	NATIVE-EQUIVALENT	the results lane's card links straight to /player (the YouTube watch-page grammar); the item hub is reachable via the kebab's Details link + home cards (j40-step03)
5	One obvious play action	R24-E qualitative law (cited by play-pause)	PARITY	[data-wfx-item-play] present + clicked → the player route (j40-step04); the production catalog probe + every player landing
6	Play/pause control (Space/K grammar)	play-pause	PARITY	[data-wfx-chrome-play] renders; the transport bar's Pause (k) (j40-step05)
7	Seek/scrub — direct manipulation + J/L keys	seek-scrub	PARITY	[data-wfx-chrome-seek] renders; the L seek moved the position readout 2:01 → 2:13 (acceptance-as-evidence — raw/j40-steps/step06-lseek.json)
8	Volume/mute — player-local control	volume-mute	PARITY	Mute (m) in the transport cluster; the m-key binding rides the live provider channel (embedLive) — see LEDGER B5 for the volume-truth row adjudication
9	Fullscreen	fullscreen	PLATFORM-VARIANT	Fullscreen (f) renders in the transport bar (j40-step05)
10	Theater + miniplayer	miniplayer-pip	PLATFORM-VARIANT	Theater view (t) + Miniplayer (i) render (the R29-N25 compact dock grammar; j40-step05)
11	Playback speed	playback-speed	PARITY	the settings disclosure renders 8 steps (0.25×–2×) + the honest "Applies to this provider embed's own player" sentence; the 1.5× click took (j40-step05)
12	Quality — the honest per-rung truth	quality	PLATFORM-VARIANT	"Quality — This way of watching carries its own quality selection — the provider's player answers it." (j40-step05)
13	Captions presence	captions	NATIVE-EQUIVALENT	the settings panel carries the captions control slot; the provider's timedtext fetch observed live on the rick player (network status, step11)
14	Autoplay — attention-policy-derived	autoplay	NATIVE-EQUIVALENT	[data-wfx-autoplay-toggle] + the policy sentence "Balanced mode lets the next thing start when this one ends, if autoplay is on." (j40-step07)
15	Up next / related	up-next + related-next-videos	NATIVE-EQUIVALENT	[data-wfx-up-next] + [data-wfx-up-next-related] render; the rail carries "Play next:" links (queue-first) incl. the lofi/monarchy/space rows (j40-step07 probe)
16	Queue — session queue add	queue	NATIVE-EQUIVALENT	the kebab's Add to queue → data-wfx-queue-added="true" at the control; /api/queue reads the entry back cross-page (j40-step08/08b)
17	Save queue / playlists	save-queue + playlists	NATIVE-EQUIVALENT	the item hub's Save to a playlist form round trip ("Parity Walk" list lands in the Library's Playlists section — j40-step08c + step11; see LEDGER B2/B3 for the read-path truths)
18	Like/save (Watch Later)	like-save + watch-later	PARITY / NATIVE-EQUIVALENT	the watchlist save answers "Saved to your Watchlist." at the control; the Library's Watchlist section lists the row (j40-step08/step11)
19	Share	share	NATIVE-EQUIVALENT	the Share pill renders in the watch action row (j40-step05 transport + WatchActions composition)
20	Feedback — recommendation vocabulary	negative-feedback	NATIVE-EQUIVALENT	the player's [data-wfx-feedback-controls] renders all four kinds: more-like-this / not-interested / not-interested-source / already-watched (j40-step10)
21	Shorts — the vertical feed	shorts-surface + shorts-vertical-swipe	PARITY	the viewport renders; keyboard swipe ArrowUp advances 1 → 2; the position pill "2 / 24" (j40-step09/09b; see SHORTS-DEPTH-CHECK.md)
22	Shorts speed control	shorts-speed-controls	PARITY	[data-wfx-shorts-speed] renders (j40-step09)
23	Shorts clear-screen viewing	shorts-clear-screen	NATIVE-EQUIVALENT	[data-wfx-shorts-clearscreen-toggle] renders + toggles (j40-step09)
24	Shorts inline feedback	shorts-inline-feedback	NATIVE-EQUIVALENT	the feedback menu opens with "More like this" / "Not interested" (j40-step09b)
25	Shorts like/save/share rail	shorts-like-save-share	PARITY	the share cell renders with its "Share" text label; like/save cells honestly absent (the source's capability truth — LEDGER B6)
26	Watch history	watch-history + account-history	PARITY	the Library's History section carries the walk's own watch state: "In progress at 3m 27s" (j40-step11)
27	Library sections (Watchlist/History/Playlists)	watch-later/account-history/playlists surfaces	—	all three sections render with the walk's own writes visible (j40-step11)

WebFlix-only encounters on the J40 walk (classified per the parityadjudication law):

encounter	placement classification	the observation
Where to watch (realization chooser) on the item hub + the player's Where-to-watch row	contextual (near Play — the familiar playback-source selector grammar)	state=ready, per-option access truths ("Public — plays for everyone"), "2 ways to play here" (j42-step03)
The queue/watchlist/playlist writes from the player's kebab + action row	contextual (the watch-page action row + the overflow kebab — YouTube's own More-actions grammar)	the kebab: Add to queue / Save / watch-state reports / Details (j40-step08)
The AI tray on the player	contextual (the player's own tray — see J42 placement table)	j42-step07
The translate row in settings (honest absence on this host)	contextual + honest	"The realtime translation bridge is not serving on this host — this boot runs without the WebSocket bridge (the deployment's realtime transport is the lead's lane). Playback and original captions are unaffected." (j40-step05) — the honest typed absence, never a dead control

Dead buttons / stale copy / placeholder states found on the walk: nonebeyond the honestly-typed absences above; the candidate findings are recordedwith reproduction evidence in LEDGER.md (F2/F3/F4/F9 — read-path andcopy-grade items, none a dead button on the exercised path).

Part 2 — the J42 placement decisions (every WebFlix-only capability on the canonical path)

The path (spec verbatim): canonical identity -> Where to watch ->provider/peer/torrent realization -> BYOF context -> recommendationintent/attention -> AI actions -> semantic moment search ->Library/offline/provenance.

#	WebFlix-only capability	taxonomy row	placement decision (the six R24-B laws)	the production evidence
1	Source-neutral canonical identity	canonical-identity	contextual — Search/item/player carry one title, multiple realizations; the h1 is the item's own title on every surface	j42-step03 + the yt-compare WebFlix walks (h1 = the title; the same item resolves embed + external)
2	Where to watch / realization switching	where-to-watch	contextual — near Play / in the player's second act; behaves like a familiar playback-source selector	[data-wfx-where-to-watch] state=ready, "Plays inside WebFlix when you press play." + per-option truths (j42-step03)
3	Authorized peer/torrent copy	authorized-peer-copy	contextual — torrent stays first-class: the peer-copy group sits in the SAME Where-to-watch decision flow (webflix-source + authorized-peer-copy groups); a peer realization, never a download-only admin flow	the group renders only for items that HAVE one (the honest absence for rick — j42-step04; the group vocabulary + switch semantics verified in WhereToWatch.tsx; the fixtures-boot J38 lane owns the scripted-acquisition proof)
4	Bring Your Own Feed	bring-your-own-feed	contextual — the Settings sources surface carries the entry ("Bring Your Feed"); the feed-mode mental model parallels Following	[data-wfx-byof-entry] + the BYOF copy on Settings (j42-step05)
5	WebFlix / Following / imported / Blend feed modes	feed-modes	contextual — Settings → General "Your feed" (the R28-B home restructure moved the config off Home; the home chip bar keeps the current-mode grammar)	all four options render: foryou / following / byof / hybrid (j42-step05 probe)
6	Explicit session intent	session-intent	contextual — the Personalize control on the Watch/Shorts discovery header ("Personalize · Balanced"), one obvious primary ("Set for this session"), never a settings maze	the panel: objective input + set/clear + the session-scope sentence + manage link (j42-step06b); the write answers 200 and the route reads both intents back (LEDGER C2 records the page-reflection divergence)
7	Attention modes (mindful/balanced/immersive/custom)	attention-policy	contextual — the same Personalize panel; the current mode surfaces in the toggle's own summary	all four [data-wfx-attention-mode] render; current = "Balanced" (j42-step06 watch probe)
8	AI transformations (transcribe/subtitles/translate/dub/commentary)	ai-transformations + model-selection	contextual — the player's AI tray: the five frozen actions, per-action model truth ("Not configured — the WebFlix model (wfx-first-party) runs it."), one Run primary each, a Manage link — an in-context media-tools tray, never an architecture console	j42-step07 (the tray panel + the vocabulary row "transcribe · subtitles · translate · dub · commentary")
9	Semantic moment search	semantic-moment-search + natural-language-search	contextual — the Search surface's own by-meaning lane ("find the part where…"); the item-level moment/chapters truth discloses honestly per deployment	"the part where it rains" → 25 semantic results (j42-step08); the intelligence API names the item-level missing features verbatim (transcript-segments etc.) — the platform limits stay honest
10	Contained BrowserHost	browser-host	contextual — a playback realization inside Where to watch (the embed realization verified live; the browser rung is the same decision flow)	the embed option + the honest containment sentence on the shorts stage; the R33 stage machinery (SHORTS-DEPTH-CHECK.md)
11	Local/offline media	local-offline-media + offline-viewing	honest platform truth — the web answers /offline with the typed state page ("You're offline — WebFlix needs a connection to load your feeds. Your watch progress is safe."); the Library's "Offline and verified" section carries the verification law + the honest empty state; the full offline path is Desktop-owned	j42-step09 + the Library offline-section probe
12	Provenance / model / license transparency	provenance-transparency	contextual + progressive disclosure — the player's "Where this came from" provenance block	"source-media by source-provided at 100% confidence. Models generate these signals; your recommendations and choices stay yours — no model authorizes a playback or acquisition action" (j42-step10)
13	Anti-tunnel feedback	anti-tunnel-controls	contextual — the same recommendation-feedback seam as the parity feedback row (the four-kind vocabulary on the player; the shorts inline menu)	j40-step10 + j40-step09b

The J42 acceptance bullets, adjudicated:

every WebFlix-only capability has a placement decision — 13/13 recordedabove (all 14 taxonomy extension rows are covered; browser-host andlocal-offline-media share the realization/offline rows above).
the placement follows the familiar video interaction grammar — verifiedper row (the action row, the kebab, the settings cluster, the tray, theWhere-to-watch selector).
no feature requires an architecture dashboard — no dashboard route existsin the closed surface union (machine-checked by the placement contract);the walk never needed one.
anonymous public viewing remains frictionless — the fresh anonymous walkhit no login wall anywhere on the public path (100 cards, playback, search,shorts, library all anonymous; the sign-in is an offer, never a gate —j42-step01 + the whole J40 walk ran anonymous).
torrent remains first-class — the authorized-peer-copy group lives in thesame Where-to-watch flow with the same title/item/player language; thehonest absence (no registered copy for the walked items on production) isthe capability truth, never a demotion (j42-step04).
platform/source capability limits remain honest — the quality/volumetruths, the translate honest-absence, the intelligence feature-absencenaming, the offline state page, the shorts like/save hydration law — alltyped, all verbatim-quoted in the evidence.
