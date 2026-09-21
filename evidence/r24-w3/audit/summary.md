# WebFlix R24-W3 — the Desktop YouTube-parity interaction audit (machine-generated)

- commit: `cabd3cf72227189a9dd4ccc903dee73a0066b5b4`
- branch: `wfx/r24/desktop`
- window: 2026-09-21T04:09:03.864Z → 2026-09-21T04:09:03.877Z
- rows walked: 44 (Discovery 7, Watch/player 24, Shorts 7, Identity/continuity 6)
- classification distribution: parity=8, native-equivalent=22, platform-variant=14, intentionally-out-of-scope=0
- assertions recorded: 118

## The walked matrix

### r24-discovery-home-feed — native-equivalent
- reference: Home feed
- pairing: Home discovery with source-neutral cards and explicit intent controls
- current state: Composed: the runtime's Home read (getHome — Continue Watching + discovery rows over source-neutral canonical cards) plus the R21-G discoverability surface's intent entry (learn / happier / surprise / tonight / friend taste) and attention-mode controls; the Desktop webview renders the same Home grammar the Web adapter renders.
- entry point: Home (the primary nav rail's first destination)
- backing: @wfx/client-runtime getHome + apps/desktop/src/surface/discoverability-surface.ts
- native affordance: The fixed Desktop rail replaces the Web top navigation; the card/feed grammar is the shared runtime's own (no platform fork).
- evidence: J02/J34 (r21) + J40 walk (r24-w3)

### r24-discovery-search — native-equivalent
- reference: Search
- pairing: Unified source-neutral Search with exact, semantic and moment retrieval
- current state: Composed: the runtime's unified search (search) over canonical identity, with semantic + moment retrieval through the media-intelligence artifacts the local AI surface projects (R39); the Desktop composition serves the same search operations the Web adapter serves.
- entry point: Search (the nav rail)
- backing: @wfx/client-runtime search + apps/desktop/src/surface/local-ai-surface.ts
- native affordance: Identical query semantics; the Desktop webview's search field is the same control grammar, not a platform-specific search.
- evidence: J05/J39 + J40 walk (r24-w3)

### r24-discovery-search-suggestions — native-equivalent
- reference: Search suggestions
- pairing: WebFlix suggestions plus optional voice/AI query
- current state: Partially composed, honestly: unified search and the AI-query path exist (the local AI surface's transform/query route); the typeahead suggestion strip is not yet a Desktop affordance — the placement decision is made (the search field's dropdown, the same location a mature video product puts it), and the shared suggestion contract is Worker 1's seam when it lands.
- entry point: Search field (the dropdown where it composes)
- backing: @wfx/client-runtime search + apps/desktop/src/surface/local-ai-surface.ts
- native affordance: The voice/AI query rides the same search field on every platform; no platform-specific suggestion system.
- evidence: J05/J39 + J40 walk (r24-w3)

### r24-discovery-related-next — native-equivalent
- reference: Related/next videos
- pairing: WebFlix recommendation policy + source-neutral realizations
- current state: Composed: the recommendation policy (intents + setRecommendationPolicy, the anti-tunnel controls) drives next-content composition; the player's Up-next affordance (R24-W3) projects the next source-neutral content beside the player, and the realization choice stays the Where-to-watch decision.
- entry point: Watch page's Up-next rail (beside/below the player)
- backing: @wfx/client-runtime intents/setRecommendationPolicy + apps/desktop/src/surface/player-affordance-surface.ts
- native affordance: Same policy, same placement grammar as Web; the Desktop rail is the only platform difference.
- evidence: J15/J16/J17 + J40 walk (r24-w3)

### r24-discovery-inline-playback — platform-variant
- reference: Inline playback
- pairing: Inline previews where platform capability and user attention policy allow
- current state: Honest capability truth: the attention policy exists (mindful/balanced/immersive/custom gates autoplay-class behavior) and the Desktop webview can host inline surfaces, but the inline-preview surface is not yet composed on Desktop — the placement decision is made (hover/surface preview on discovery cards, under the attention policy), pending the shared inline-preview contract.
- entry point: Discovery cards (hover preview where it composes)
- backing: @wfx/client-runtime intents (attention modes) + the webview surface capability truth
- native affordance: Inline preview is gated by the SAME attention policy on every platform; the Desktop window manager makes always-on-top previews possible where the Web cannot — capability truth, never a promise.
- evidence: J18 + J40 walk (r24-w3)

### r24-discovery-subscriptions — native-equivalent
- reference: Subscriptions
- pairing: Following plus native/BYOF relationship semantics
- current state: Composed: Following is a feed mode (the runtime's feedMode operations — For you / Following / imported / Blend) and BYOF imports relationship truth through the Desktop file-import path (the frozen FeedPort; the OS dialog + read-root law), with source-native order kept distinct from WebFlix ranking.
- entry point: Home feed-mode control + Bring Your Feed (source context)
- backing: @wfx/client-runtime feedMode + apps/desktop/src/surface/feed-surface.ts
- native affordance: The Desktop import path is the NATIVE OS file dialog (wfx_file_pick_open) — the platform variant of the Web's file input; the semantics are the shared frozen FeedPort's.
- evidence: J33 + J40 walk (r24-w3)

### r24-discovery-shorts-surface — parity
- reference: Shorts surface
- pairing: Shorts
- current state: Composed: the runtime's shorts feed (shorts) serves the vertical feed; the Desktop webview renders the same vertical Shorts grammar (stable current card, forward skip/rerank, like/save/share after hydration, feedback).
- entry point: Shorts (the nav rail)
- backing: @wfx/client-runtime shorts
- native affordance: Wheel/arrow-key paging is the Desktop-native paging affordance where the Web scrolls — same semantics, platform input truth.
- evidence: J04/J36 + J40 walk (r24-w3)

### r24-watch-play-pause — parity
- reference: Play/pause
- pairing: Same familiar control placement and keyboard behavior
- current state: Composed: the runtime's PlaybackController (play/pause/pause-resume over the native port's pause/resume) drives the same transport control every realization uses — provider, peer copy, and local alike; the R24 player-affordance surface places the controls (the bottom transport bar) and the keyboard grammar (Space/K) over them.
- entry point: The player's transport bar + Space/K
- backing: @wfx/client-runtime PlaybackController + apps/desktop/src/surface/player-affordance-surface.ts
- native affordance: The native rung's pause/resume is the engine process's own command — the same control grammar, the platform's own mechanism.
- evidence: J03/J07 + J40 walk (r24-w3)

### r24-watch-seek-scrub — parity
- reference: Seek/scrub
- pairing: Same direct manipulation model
- current state: Composed: the controller's typed seek (acceptance = position evidence; external mode answers the typed unsupported failure) plus the R24 scrub model — the progress bar with the truthful buffered runway, the scrub-target preview, and the honest not-yet-verified-range answer for in-progress peer-copy sessions (the deadline declaration path).
- entry point: The player's progress bar + J/L/arrow keys
- backing: @wfx/client-runtime PlaybackController.seek + apps/desktop/src/surface/player-affordance-surface.ts
- native affordance: Native seeks go to the engine (the port's own seek); the scrub preview is the same direct-manipulation grammar on every platform.
- evidence: J03/J23 + J40 walk (r24-w3)

### r24-watch-volume-mute — platform-variant
- reference: Volume/mute
- pairing: Same player-local control
- current state: Honest capability truth: volume/mute is placed in the control grammar (the transport bar's player-local cluster + M/arrow-up/down keys), but the frozen NativeMediaPort contract does not yet expose a volume command — the native path answers the honest not-yet-exposed backing, provider embeds carry their own volume control, and the shared volume seam is an escalation for lead ratification (it extends the frozen port contract).
- entry point: The player's volume cluster + M / arrow-up/down
- backing: apps/desktop/src/surface/player-affordance-surface.ts (the honest backing: not-exposed on the native rung yet)
- native affordance: The OS-level volume remains available to the Desktop user (the platform's own affordance); the in-player volume is the shared seam that must be ratified — never a dead button and never a fake control.
- evidence: J40 walk (r24-w3) — honest backing asserted

### r24-watch-fullscreen — platform-variant
- reference: Fullscreen
- pairing: Same player affordance
- current state: Placed with platform truth: the control grammar carries the fullscreen affordance (the player chrome's right cluster + F), and the Desktop realization is the SHELL window's own fullscreen state (the Tauri window command) — the webview-native affordance, honestly named; the shell ride-along is verified through the real-toolchain procedure.
- entry point: The player's right control cluster + F
- backing: apps/desktop/src/surface/player-affordance-surface.ts + the shell window capability (apps/desktop/shell)
- native affordance: Desktop fullscreen is the OS window's own state, not a browser Fullscreen API call — the platform variant of the same affordance.
- evidence: J40 walk (r24-w3) — placement + honest backing

### r24-watch-miniplayer-pip — platform-variant
- reference: Miniplayer/PiP where supported
- pairing: Platform capability equivalent
- current state: Placed with platform truth: the affordance grammar carries the miniplayer/PiP entry (the player chrome's right cluster + I), and the Desktop realization is the window manager's picture-in-picture/always-on-top window — honestly NOT yet composed into the shell surface; the placement decision is made, the composition is the follow-up, and the honest state says so.
- entry point: The player's right control cluster + I
- backing: apps/desktop/src/surface/player-affordance-surface.ts (the honest backing: placed, not yet composed)
- native affordance: Desktop PiP is an OS window state (always-on-top) — a genuinely platform-native capability the Web approximates with the browser PiP API; capability truth on both.
- evidence: J40 walk (r24-w3) — honest backing asserted

### r24-watch-playback-speed — platform-variant
- reference: Playback speed
- pairing: Player settings
- current state: Honest realization truth: the speed control is placed in the player settings cluster (the same place a mature video product keeps it), the provider embed/browser realizations carry their own speed control, and the native path does not expose a rate command in the frozen NativeMediaPort — the honest where-the-realization-exposes-it answer, pending the shared rate seam's ratification.
- entry point: The player's settings cluster
- backing: apps/desktop/src/surface/player-affordance-surface.ts (realization-exposed truth)
- native affordance: Provider embeds answer speed through their own player; the native rung's rate is the frozen port contract's extension to ratify — never a fake control.
- evidence: J40 walk (r24-w3) — honest backing asserted

### r24-watch-quality — platform-variant
- reference: Quality
- pairing: Source/player quality selection where exposed
- current state: Honest realization truth: quality selection rides the realization — provider embeds expose their own quality menu, and the peer-copy/native rung's quality is the torrent's own file-selection truth (the chosen playable file IS the quality decision, made in the Where-to-watch/file-choice step); a native quality ladder is not exposed by the frozen port contract.
- entry point: The player's settings cluster (provider realizations) / the file-choice step (peer copy)
- backing: apps/desktop/src/surface/player-affordance-surface.ts + apps/desktop/src/platform/torrent-playback.ts (file choice)
- native affordance: The torrent realization's quality truth is the file selection — an honest structural difference from an adaptive ladder, expressed as capability truth.
- evidence: J22/J38 + J40 walk (r24-w3)

### r24-watch-captions — native-equivalent
- reference: Captions
- pairing: AI/provider/local subtitle paths
- current state: Composed: the AI/provider/local subtitle paths are the Model Fabric's transform operations (subtitles/translation through model-controls) plus the local AI surface's catalog truth; the player settings cluster places the captions toggle (C) over the same paths the Web player uses.
- entry point: The player's settings cluster + C
- backing: @wfx/client-runtime modelControls + apps/desktop/src/surface/local-ai-surface.ts
- native affordance: Local subtitle files ride the Desktop filesystem (the platform's own affordance); AI captions ride the same Model Fabric seam as Web.
- evidence: J20/J39 + J40 walk (r24-w3)

### r24-watch-transcript — native-equivalent
- reference: Transcript
- pairing: Timestamped transcript
- current state: Composed: the media-intelligence transcript artifact (ordered timestamped segments, honest provenance) is the R39 truth; the player's transcript panel (T) projects it beside the player with timestamp jump — the same 'find the part where…' grammar as Web.
- entry point: The player's transcript panel + T
- backing: @wfx/model-fabric media-intelligence artifacts + apps/desktop/src/surface/local-ai-surface.ts
- native affordance: The transcript panel is the same surface grammar; the Desktop panel docks in the window where the Web panel stacks — layout truth, not semantic truth.
- evidence: J39 + J40 walk (r24-w3)

### r24-watch-chapters — native-equivalent
- reference: Chapters
- pairing: Chapter rail/list + semantic chapter fallback
- current state: Composed: the media-intelligence chapters/scenes artifact (ordered structural units, honest provenance) backs the chapter rail; the semantic chapter fallback (derived chapters where the source provides none) is the same artifact path — the chapter list jumps through the SAME typed seek as the scrub bar.
- entry point: The player's chapter rail (under the progress bar) / the transcript panel's chapter list
- backing: @wfx/model-fabric media-intelligence artifacts + the typed seek (PlaybackController)
- native affordance: Chapter markers render on the shared progress bar; the derivation is the artifact's own truth on every platform.
- evidence: J39 + J40 walk (r24-w3)

### r24-watch-autoplay — native-equivalent
- reference: Autoplay
- pairing: Attention-policy-aware autoplay
- current state: Composed: the autoplay toggle rides the attention policy (mindful/balanced/immersive/custom) — the R24 player-affordance surface projects the toggle's honest state FROM the policy (never a raw always-on switch), so the same control a mature video product puts on the player obeys WebFlix's own attention law.
- entry point: The Up-next card's autoplay toggle (the player-adjacent placement)
- backing: @wfx/client-runtime intents (attention modes) + apps/desktop/src/surface/player-affordance-surface.ts
- native affordance: The policy is the shared runtime's own law; the toggle is the familiar placement over it — no platform-specific autoplay semantics.
- evidence: J18 + J40 walk (r24-w3)

### r24-watch-up-next — native-equivalent
- reference: Up next
- pairing: Source-neutral next content
- current state: Composed: the Up-next projection (R24-W3) presents the next source-neutral content beside the player with the same card grammar as discovery, driven by the recommendation policy's own next-content answer — and the autoplay behavior above is policy-aware.
- entry point: The Watch page's Up-next rail
- backing: apps/desktop/src/surface/player-affordance-surface.ts (up-next projection over the recommendation policy)
- native affordance: Same rail, same card grammar; the Desktop docks it in the window's sidebar where the Web stacks it below.
- evidence: J17/J18 + J40 walk (r24-w3)

### r24-watch-queue — native-equivalent
- reference: Queue
- pairing: Session queue + save queue to Library/playlist where supported
- current state: Composed (R24-W3): the session queue is a player-adjacent affordance — an ordered session-scoped list of canonical items (enqueue from any card's queue action, play-through resolves the head item through the SAME runtime playback path, remove/reorder are the queue's own view operations) with save-queue-to-watchlist as the Library bridge; NO new business rules (every write is a runtime operation), and the shared session-queue contract is Worker 1's seam to reconcile when it lands.
- entry point: The player's queue rail (the Up-next card's 'Add to queue' entry)
- backing: apps/desktop/src/surface/player-affordance-surface.ts (session queue over runtime ops)
- native affordance: The queue is session-scoped on every platform (the same mental model as a mature video product's queue); the watchlist is the durable shared state it saves into.
- evidence: J40 walk (r24-w3) — enqueue/play-through/save-queue asserted

### r24-watch-share — native-equivalent
- reference: Share
- pairing: Canonical WebFlix link + source link when appropriate
- current state: Composed: the sharing port (the OS share sheet on Desktop — the platform's native affordance) carries the canonical link plus the source link when appropriate; the share action sits in the player/title action row with the like/save actions.
- entry point: The title/player action row
- backing: @wfx/platform-contracts sharing port + apps/desktop/src/platform/sharing.ts
- native affordance: The OS share sheet is the Desktop-native share affordance where the Web uses its own share menu — same semantics, platform mechanism.
- evidence: J10/J36 + J40 walk (r24-w3)

### r24-watch-like-save — parity
- reference: Like/save
- pairing: Existing action model
- current state: Composed: the action system (dispatchAction — like/save with WebFlix-confirmed vs provider-confirmed truth) and the library's watchlist writes; the actions sit in the title/player action row with share, hydrated honestly per source capability.
- entry point: The title/player action row
- backing: @wfx/client-runtime dispatchAction + libraryOps
- native affordance: Identical action semantics on every platform; the confirmation truth (WebFlix-confirmed vs provider-synced) is the shared law.
- evidence: J10/J11 + J40 walk (r24-w3)

### r24-watch-feedback — native-equivalent
- reference: Feedback
- pairing: Existing recommendation feedback
- current state: Composed: the recommendation feedback vocabulary (More like this / Not interested / Don't recommend source / Already watched — reversible, affecting future composition) rides the card/player feedback menu and the recommendation policy's own seams.
- entry point: The card's feedback menu + the player's feedback entry
- backing: @wfx/client-runtime setRecommendationPolicy + the feedback action vocabulary (J15)
- native affordance: The same feedback placement grammar as Web (the card/menu), the same policy effect — the anti-tunnel law is shared.
- evidence: J15/J16 + J40 walk (r24-w3)

### r24-watch-comments — platform-variant
- reference: Comments/reactions
- pairing: Provider/social actions where authorized
- current state: Honest capability truth: comments/reactions are provider-authorized social actions — the action system carries the provider-action truth (unsupported provider actions never appear successful), and a dedicated comments surface is not yet composed on Desktop; the nearest user-facing path is the provider's own realization (the embed/browser surface where the source hosts the conversation).
- entry point: The provider realization's own surface (where authorized)
- backing: @wfx/client-runtime dispatchAction (provider-action truth) — no Desktop comments surface yet, honestly
- native affordance: Comment capability is the provider's own truth on every platform; WebFlix never fabricates a comment system a source does not offer.
- evidence: J10/J30 + J40 walk (r24-w3)

### r24-watch-watch-history — parity
- reference: Watch history
- pairing: WebFlix History
- current state: Composed: the watch-state engine's history (start/progress/complete events, at-least-once delivery) + the Library's history section; Continue Watching rides the same truth on Home.
- entry point: Library → History (the nav rail's Library destination)
- backing: @wfx/client-runtime watchState + libraryOps + navigation (Library sections)
- native affordance: Same history semantics; the Desktop Library window is the platform's presentation of the same section grammar.
- evidence: J11/J12 + J40 walk (r24-w3)

### r24-watch-watch-later — native-equivalent
- reference: Watch Later
- pairing: Watchlist
- current state: Composed: the watchlist is the Library's explicit-save section (canonical-keyed entries, the default 'Saved' collection); the save action sits on every card and in the title/player action row.
- entry point: The card/title 'Save' action + Library → Watchlist
- backing: @wfx/client-runtime libraryOps (watchlist writes) + navigation
- native affordance: The watchlist is the shared durable state; the queue (session-scoped) is its player-adjacent sibling — the same relationship a mature video product keeps.
- evidence: J11 + J40 walk (r24-w3)

### r24-watch-playlists — native-equivalent
- reference: Playlists
- pairing: WebFlix playlists/library collections
- current state: Composed at the collection level: the watchlist is the library collection ('Saved' is the default named collection) and the session queue's save-queue path lands an ordered batch into it; multiple named playlist collections are not yet exposed as a Desktop affordance — the placement decision is made (the Library's collections row + the save action's target picker), pending the shared playlist contract.
- entry point: Library → Watchlist (the collections row where it composes)
- backing: @wfx/client-runtime libraryOps (canonical-keyed collections)
- native affordance: The collection grammar is shared; the Desktop picker is the OS sheet where the Web uses its own dialog — platform affordance, same semantics.
- evidence: J11 + J40 walk (r24-w3)

### r24-watch-live-playback — platform-variant
- reference: Live playback
- pairing: Supported live realization
- current state: Honest capability truth: live playback is a realization truth (a source that offers a live realization) — the runtime plays any realization the resolver answers, and no Desktop-specific live composition (DVR window, live edge seeking) is exposed yet; the nearest user-facing path is the provider's live realization through the standard player path.
- entry point: The live item's standard player path (where a source offers it)
- backing: @wfx/client-runtime resolvePlayback (realization truth) — no Desktop live-specific affordance yet, honestly
- native affordance: Live capability is the source's declaration on every platform; the Desktop native rung can host live media where the engine supports it — capability truth, never a promise.
- evidence: J30 + J40 walk (r24-w3)

### r24-watch-live-chat — platform-variant
- reference: Live chat
- pairing: Provider/realization-specific live interaction when supported
- current state: Honest capability truth: live chat is a provider-authorized interaction — no WebFlix surface fabricates it, and no Desktop live-chat surface is composed; the nearest user-facing path is the provider's live realization (the embed/browser surface where the source hosts the chat).
- entry point: The provider live realization's own surface (where authorized)
- backing: capability truth only — the provider's own interaction surface; no fake chat, honestly
- native affordance: Live chat is the provider's truth; WebFlix carries the realization, never a synthetic audience.
- evidence: J30 + J40 walk (r24-w3)

### r24-watch-external-handoff — native-equivalent
- reference: External handoff
- pairing: Return-context-preserving source handoff
- current state: Composed: the external playback mode (the OS handoff through the adapter) preserves the return context — the runtime's navigation return-context law (J09); the Desktop handoff is the OS's own open-url path.
- entry point: The player's 'Open with the source' fallback (the honest next way to watch)
- backing: @wfx/client-runtime resolvePlayback (external mode) + the navigation return context
- native affordance: The OS URL handoff is the Desktop-native mechanism; the return-context preservation is the shared law.
- evidence: J09 + J40 walk (r24-w3)

### r24-watch-cast — platform-variant
- reference: Cast/second screen
- pairing: Platform adapter capability, not fake universal support
- current state: Honest capability truth: the reference Desktop declares NO cast sink (desktopDeviceCapabilities.casting = false — the frozen surface matrix's own value); the cast affordance is ABSENT from the Desktop control grammar because the platform truthfully does not support it — the honest absence, never a fake cast button and never a silent capability claim.
- entry point: N/A on Desktop (the capability is honestly absent; the nearest path is the external handoff)
- backing: apps/desktop/src/platform/media-surface.ts (casting: false — the frozen capability truth)
- native affordance: The absence is the truth: a cast button that cannot cast is a dead button — the design law forbids it; the external handoff is the honest second-screen path.
- evidence: J30/J31 + J40 walk (r24-w3) — the honest absence asserted

### r24-shorts-vertical-swipe — parity
- reference: Vertical swipe/binge
- pairing: ShortsFeed
- current state: Composed: the runtime's shorts feed serves the vertical binge feed; the Desktop paging affordance (wheel/arrow keys) is the platform's input truth over the same stable-current-card semantics.
- entry point: Shorts (the nav rail)
- backing: @wfx/client-runtime shorts
- native affordance: Wheel/arrow paging vs touch swipe — same feed semantics, the platform's own input affordance.
- evidence: J04 + J40 walk (r24-w3)

### r24-shorts-like-save-share — parity
- reference: Like/save/share
- pairing: Existing hydrated Shorts actions
- current state: Composed: the hydrated Shorts actions (like/save/share appear after the feed read hydrates the source's advertised actions — never fabricated where a source does not offer them).
- entry point: The current Shorts card's action rail
- backing: @wfx/client-runtime shorts + dispatchAction (hydration truth)
- native affordance: Same action rail; the share rides the OS share sheet on Desktop.
- evidence: J04/J36 + J40 walk (r24-w3)

### r24-shorts-sound-related — native-equivalent
- reference: Sound / related content
- pairing: Canonical audio/source links where available
- current state: Composed at the identity level: the canonical source-neutral identity relates the short to its source/audio context (the same item → realizations law); a dedicated sound-page affordance is not yet composed on Desktop — the placement decision is made (the card's related-content entry), pending the shared sound-context contract.
- entry point: The Shorts card's related-content entry (where it composes)
- backing: @wfx/client-runtime canonical identity + the Where-to-watch decision (realization relations)
- native affordance: The relation is the canonical identity's own truth — no platform fork.
- evidence: J32 + J40 walk (r24-w3)

### r24-shorts-remix — platform-variant
- reference: Remix/source attribution
- pairing: Authorized source-aware remix/reference path
- current state: Honest capability truth: remix is an authorized source capability (a source that permits derivative creation) — the provenance/authorization truth exists (the torrent engine's own provenance law is the same grammar), and a Desktop remix affordance is not composed; the nearest path is the authorized source's own remix surface.
- entry point: The authorized source's own remix path (where the source permits it)
- backing: capability truth (authorized source actions) — no fabricated remix, honestly
- native affordance: Remix rights are the source's truth on every platform; WebFlix attributes honestly and never fabricates a right.
- evidence: J30 + J40 walk (r24-w3)

### r24-shorts-clear-screen — native-equivalent
- reference: Clear-screen style viewing
- pairing: WebFlix distraction-free presentation under attention policy
- current state: Composed: the attention policy's distraction-free law (mindful/immersive gate the chrome) is the shared runtime's own; the Shorts presentation keeps the stable current card with quiet chrome, and the clear-screen toggle composes under the same policy.
- entry point: The Shorts surface (chrome quiet under the attention policy)
- backing: @wfx/client-runtime intents (attention modes) + the Shorts presentation law (J04)
- native affordance: The same policy-driven presentation on every platform — the Desktop window's focus state is an additional platform truth.
- evidence: J04/J18 + J40 walk (r24-w3)

### r24-shorts-speed — platform-variant
- reference: Speed controls
- pairing: Shorts player controls
- current state: Honest realization truth (the same law as the long-form speed row): the Shorts speed control is placed in the shorts player's settings cluster; provider realizations carry their own speed, and the native path's rate is not exposed by the frozen port contract — the honest where-exposed answer.
- entry point: The Shorts player's settings cluster
- backing: apps/desktop/src/surface/player-affordance-surface.ts (realization-exposed truth)
- native affordance: The same speed truth as the long-form player — one law, two surfaces.
- evidence: J40 walk (r24-w3) — honest backing asserted

### r24-shorts-feedback — native-equivalent
- reference: Recommendation feedback
- pairing: Inline Shorts feedback
- current state: Composed: the inline feedback entry on the Shorts card (the same vocabulary + reversible effect as the long-form feedback) — the anti-tunnel law applies to the Shorts feed's future composition.
- entry point: The Shorts card's inline feedback entry
- backing: @wfx/client-runtime setRecommendationPolicy + the feedback vocabulary (J15)
- native affordance: The same feedback grammar inline — no platform fork.
- evidence: J15/J16 + J40 walk (r24-w3)

### r24-identity-account-history — parity
- reference: Account-based history
- pairing: Account history
- current state: Composed: the authenticated profile's server-side history (the watch-state events over the server port, the profile-scoped reads) — the Desktop auth transport carries the same identity truth as Web.
- entry point: Sign in → Library → History
- backing: @wfx/client-runtime watchState + apps/desktop/src/platform/auth-transport.ts
- native affordance: The same account history on every platform; the Desktop session store is the platform's own persistence of the same identity.
- evidence: J12/J13 + J40 walk (r24-w3)

### r24-identity-anonymous-viewing — native-equivalent
- reference: Anonymous public viewing
- pairing: WebFlix accountless public viewing
- current state: Composed (R23-W3): the open-viewing surface renders the accountless truth (public read/play without a WebFlix login; provider auth never conflated), and anonymous playback keeps session-scoped progress — the R37 law on Desktop.
- entry point: Fresh launch → browse/play without signing in
- backing: apps/desktop/src/surface/open-viewing-surface.ts + @wfx/client-runtime anonymous-playback-boundary
- native affordance: The same accountless law; the Desktop first-run surface offers (never requires) sign-in.
- evidence: J37 (r23-w3) + J40 walk (r24-w3)

### r24-identity-cross-device — native-equivalent
- reference: Cross-device continuity
- pairing: Shared server-side profile/library state
- current state: Composed: the shared server-side state (profile-scoped library/history/intents through the server port) is the J12/J31 truth — the Desktop is an adapter over the same state, never a fork.
- entry point: Sign in on any device → the same Library/Continue Watching
- backing: @wfx/client-runtime server-port + watchState/libraryOps (the shared state law)
- native affordance: Continuity is the server state's own truth; the platform adapters only present it.
- evidence: J12/J31 + J40 walk (r24-w3)

### r24-identity-source-subscriptions — native-equivalent
- reference: Source subscription relationships
- pairing: Following + BYOF
- current state: Composed: Following is the feed-mode relationship over connected sources; BYOF imports the existing relationship truth (the Desktop native import path) — the imported feed stays source-native-ordered with provenance, never silently becomes recommendation identity.
- entry point: Home feed modes + Bring Your Feed
- backing: @wfx/client-runtime feedMode + apps/desktop/src/surface/feed-surface.ts
- native affordance: The Desktop import is the OS file dialog over the frozen FeedPort — the platform variant of the same import semantics.
- evidence: J33 + J40 walk (r24-w3)

### r24-identity-notifications — platform-variant
- reference: Notifications
- pairing: Web/desktop notification adapter when supported
- current state: Composed: the notification port (the OS notification center on Desktop — permissioned, honestly refused where the OS denies) is the platform's native notification affordance; the Web adapter carries its own browser-notification truth.
- entry point: The OS notification center (where the app notifies)
- backing: apps/desktop/src/platform/notifications.ts + @wfx/platform-contracts notifications port
- native affordance: OS notifications are a genuine Desktop-native affordance (the platform's own center, permissioned) — capability truth, not a Web fallback.
- evidence: notifications tests (r08) + J40 walk (r24-w3)

### r24-identity-second-screen — platform-variant
- reference: TV/second-screen continuation
- pairing: Platform adapter where supported
- current state: Honest capability truth: the reference Desktop declares no cast sink (the frozen capability truth), so TV/second-screen continuation is honestly absent on this platform — the honest next path is the cross-device continuity row's shared state (resume on another device) plus the external handoff; no fake cast continuation is rendered.
- entry point: N/A on Desktop (honestly absent; the cross-device resume is the honest path)
- backing: apps/desktop/src/platform/media-surface.ts (casting: false) + the cross-device continuity row
- native affordance: The absence is the platform truth — the shared state makes device handoff honest without claiming a cast the platform cannot do.
- evidence: J31 + J40 walk (r24-w3) — the honest absence asserted

## The walk log

### matrix
44 rows walked: Discovery 7, Watch/player 24, Shorts 7, Identity/continuity 6.

### distribution
Classification distribution: parity=8, native-equivalent=22, platform-variant=14, intentionally-out-of-scope=0 (the R24-C matrix pairs every row — zero out-of-scope is the honest walk, not a blank).

### honest-gaps
8 rows honestly name a not-yet-composed affordance with the placement decision recorded.

### discovery-home
Home discovery + explicit intent controls verified on the booted composition.

### discovery-search
Unified search answered 'Family Archive Feature Presentation' over canonical identity (joined to wfxitm_00000000000000000000000001).

### discovery-shorts
Shorts feed serves the vertical binge grammar on the composition.

### discovery-subscriptions
Following + BYOF feed-mode operations verified on the composition.

### watch-play
Play/pause + seek/scrub verified through the shared controller on the native rung.

### watch-volume
Volume/mute/speed honestly answer not-exposed-yet on the native rung; provider rungs answer realization-exposed.

### watch-quality
Quality rides the realization's own truth (the file selection IS the quality decision).

### watch-captions
Captions/transcript/chapters verified over the shared Model Fabric artifact truth.

### watch-autoplay
Autoplay derives from the attention policy across all four modes.

### watch-queue
The session queue verified: ordered enqueue, play-through over the composition's own action, save-queue into the watchlist.

### watch-like-save
Like/save verified through the runtime's action + library surfaces.

### watch-feedback
Recommendation feedback/policy verified through the shared intent seams.

### watch-history
Watch history + watch-later verified over the Library's shared sections.

### watch-external
External handoff resolved with the adapter-owned readiness contract.

### watch-cast
Cast honestly absent: no dead button, the honest device-capability truth rendered.

### identity-anonymous
Anonymous public viewing verified through the open-viewing surface.

### identity-history
Account history + cross-device continuity verified over the shared server state.

### identity-notifications
Notifications verified as the Desktop platform's own affordance.

## Explicit limitations (never silent skips)

- The native halves (the real engine binary behind createShellEngineProcess, the real swarm, the shell window fullscreen/PiP ride-along, the OS share sheet/notification center delivery) are the lead's real-toolchain procedure per journeys/desktop/README.md — this audit walks the REAL TypeScript composition over the deterministic doubles (the J21–J25 doctrine).
- Worker 1's shared R24-A contracts (the shared telemetry taxonomy + the shared autoplay/session-queue seams) were NOT on the remote at audit time (no `origin/wfx/r24/shared` branch); the Desktop-side projections record the reconciliation as an escalation.