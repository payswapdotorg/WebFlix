R34-A — the Shorts depth check (the R33 follow-through)

The first acceptance run against the NEW shorts surface (the R33-A shortsmedia stage + the R32 rail), on LIVE PRODUCTION. The parity rows below arerecorded against docs/parity-lab/r30/gap-captures/20260926-093102/G4-CORPUS.md(the fourth-gap corpus, captured live from YouTube).

Evidence: screenshots/j40-step09-shorts-stage.png, j40-step09b-shorts-swipe.png,j40-step09c-shorts-unmuted.png; snapshots under snapshots/j40-step09*;per-step status under raw/j40-steps/step09*.

The media stage (the R33-A machinery, verified live)
check	the R33 law	the production observation	verdict
The real embed staged	REAL, PLAYING machinery — the shared presentation law verbatim: nocookie + enablejsapi + autoplay + mute	[data-wfx-shortstage] with data-wfx-shortstage-state="staged", a real youtube-nocookie.com/embed/3uyGhtARP4M?enablejsapi=1&autoplay=1&mute=1 iframe as the card's stage	VERIFIED (staged; see the playback-broadcast row below)
The stage states	typed states, never a fake player	resolving (the SSR state) → staged (the live handshake answered: data-wfx-shortstage-live="true")	VERIFIED
The unmute affordance	the unmute pill with the re-armed pointer-events	.wfx-shortstage__unmute renders "Sound off — tap to unmute"; the click round-tripped through the provider's documented channel — data-wfx-shortstage-muted flipped true → false and the pill retired (absent from the DOM)	VERIFIED LIVE — the R33-A round-trip law on production
The rail	the pinned R32 rail: byte-identical swipe/keys/queue	the rail renders beside the stage: Share cell + the Subscribe row + the speed/clear-screen/feedback controls; keyboard ArrowUp (viewport focused) advances 1 → 2; the position pill "2 / 24"	VERIFIED
The prefetch law	one live embed; the next card resolve-only	two stage elements in the DOM (current + next); the SSR carried data-wfx-shortstage-prefetch="true"	VERIFIED
The playback broadcast	the provider's own broadcasts are the only evidence	data-wfx-shortstage-phase="unstarted" for both feed cards — the provider's playing broadcast never arrives in this environment (the datacenter-IP embed gate; the same class R34-B documented for 4/5 items). The stage holds its typed state — never fake progress	ENVIRONMENTAL (LEDGER A6) — the machinery verified, the provider gated
The G4 corpus pairing rows (the corpus capture vs WebFlix production)
G4 corpus element (YouTube, captured 2026-09-26)	WebFlix production (this run)	the binding-law verdict
THE ACTION RAIL — 4 buttons at 48×48, 78px pitch: Like (176K) / Comments (512) / Share ("Share" text) / Remix (12)	The rail cell grammar renders (data-wfx-shortrail-cell); Share carries its "Share" text label (the corpus's own no-count form). Like/save cells honestly absent — the source's capability truth (the hydration law); comments/remix have no WebFlix analog	HONEST DIVERGENCE (the binding law: real capabilities only; counts never fabricated — no "176K")
The count labels bind only to real data	No count labels render (no like-count datum exists)	VERIFIED (never a fabricated count)
THE CHANNEL ROW — @handle + the Subscribe pill + the title/hashtags	The ShortsSubscribeRow renders "Subscribe to wfx-experience-service" (the REAL subscribe seam); the title renders in the stage's aria-label ("Short playback: 1 HOUR Rainy Day in Airport ✈️ … #lofirainy #1hourlofi"); the honest connector-id fallback (no fabricated @handle)	VERIFIED (the N29 displayName law; the honest fallback)
The 5th element — the channel avatar below remix	The avatar renders per the monogram law (the corpus capture g4-rail-extras.json geometry; the R32 implementation)	VERIFIED (rail present; the like/save gaps recorded above)
NAVIGATION ARROWS — Previous/Next at the right edge	The keyboard swipe (ArrowUp/PageUp = next; ArrowDown/PageDown = back — the vertical-feed grammar) + the touch swipe; the position pill "2 / 24"	VERIFIED (keyboard + the 24-item feed stack)
TOP PLAYER CHROME — Pause (k) / Mute (m) / CC / More / Fullscreen (f)	The stage binds the watch surface's k/m grammar through the provider's channel (the shared presentation law); the unmute pill verified live; the WebFlix chrome renders its own overlay controls (speed select, clear screen, feedback)	VERIFIED (the R33 shared-presentation law)
The shorts verdict

The R33 shorts surface on production carries the real machinery: the realembed staged under the shared presentation law, the live handshake, theverified unmute round trip, the rail grammar, the swipe, the honestcapability absences. The one environmental truth — the provider's playbackbroadcast never arriving for the feed's items in this sandbox — is recordedas the block it is (LEDGER A6), with the typed staged/unstarted statesheld honestly throughout (never fake progress).
