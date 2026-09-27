# R33-A — THE HONEST-DIVERGENCE LEDGER (WebFlix-real vs the corpus)

Every row: the captured grammar (cited from G4-CORPUS.md
docs/parity-lab/r30/gap-captures/20260926-093102/ + g4-rail-extras.json +
docs/parity-lab/r28/youtube/shorts-anatomy.md), WebFlix's real truth
(cited), and the honest resolution. Classes: `HD` honest-divergence
(WebFlix's real surface differs, by law) · `NOTE` a verification
observation recorded without changing the binding · `CLOSED` an R32 row
this lane closes. Zero regressions: the pinned controls hold (the R32
rail + channel row + swipe/keys/queue + the re-rank loop byte-identical
in behavior and grammar — the R32 + R24-W2 suites re-proven green at
their R32 counts on this lane's markup).

1. **[CLOSED] R32 row 8 — "no media element on this surface" — CLOSED.**
   The R32 ledger recorded: "WebFlix's shorts surface renders NO player
   chrome (the feed is the placeholder-art card stack — no media element
   on this surface)." This lane closes the gap: the current card now
   grows the REAL provider embed, full-bleed
   (`components/shorts/ShortsMediaStage`), resolved through the same
   seam the hover preview uses (`GET /api/preview` — the frozen
   `serverPort.resolve` path), mounted under the shared presentation law
   verbatim (embed-presentation.ts: the nocookie host + `enablejsapi` +
   `autoplay=1&mute=1` + the containment sandbox postures from
   EmbedStage.tsx). The corpus's player truth ("Vertical 716×716,
   autoplaying (readyState 4, paused false, blob src)" — G4-CORPUS.md
   "THE PLAYER") maps to WebFlix's real machinery: the provider's own
   embed player autoplaying muted inside WebFlix's contained stage. The
   blob-src/readyState internals are the provider's own player's truth
   (inside the frame, opaque by the frozen security law — never
   inspected); WebFlix's visible truth advances ONLY on the provider's
   documented broadcasts (the R26-W2 evidence law).

2. **[HD] The full-bleed form's scale adaptation.** The captured player
   is 716×716 within the 1440×900 viewport; WebFlix's shorts viewport is
   its own 420px-scale card (the established WFX-051 form —
   `.wfx-shorts__viewport { width: min(420px, 100%) }`). The stage fills
   the CARD (absolute inset 0) — the corpus's "the player IS the
   surface" law at WebFlix's own viewport scale; the captured 716px
   measure is the adaptation's recorded divergence (WebFlix's own
   viewport scale governs — the R32 rail's own precedent, divergence row
   9 there).

3. **[HD] The top chrome maps to the PROVIDER'S OWN embed controls — no
   WebFlix-side chrome row is built.** The captured top chrome (pause k
   @366 / mute m @422 / CC @906 / more @954 / fullscreen f @1002, 48×48,
   auto-hiding — g4-rail-extras.json) belongs to the provider's own
   shorts player; on WebFlix's stage the provider's own EMBED controls
   (its pause, its mute, its CC, its settings/more, its fullscreen — the
   frame carries them, `allow="fullscreen…"`) ARE the mapping (the
   chrome law). WebFlix adds ONLY the watch surface's existing chrome
   bindings: the k/m keyboard grammar (PlayerChrome.tsx's own map with
   its typing guard, driving the provider's documented channel — k also
   records the runtime command through the same /api/playback transport
   the watch chrome uses) + the unmute affordance (EmbedStage's exact
   pattern + words, evidence-gated). The captured chrome's GEOMETRY
   (48×48 at y=80) is the provider's own in-frame rendering — not
   re-measured or re-built on WebFlix's side (never from memory).

4. **[HD] CC (Subtitles/closed captions) — the WebFlix-side analog is a
   typed absence.** The captured "Subtitles/CC turned on" control has no
   WebFlix shorts-surface analog (WebFlix's caption surfaces are the
   watch surface's own — LiveCaptionsSurface/the transcript artifacts;
   the shorts surface carries none — the seam law forbids porting them
   in this lane). The provider's own in-frame CC control is the real
   path; no WebFlix-side CC control is built (never a dead imitation).

5. **[HD] "More actions" — the same typed absence.** The captured "More
   actions" control has no WebFlix shorts-surface analog (the shorts
   R24-W2 parity row — speed/clear-screen/feedback/source chip — is the
   surface's own control row, pinned byte-identical by the seam law; no
   new more-menu is built). The provider's own in-frame menu answers.

6. **[HD] Fullscreen (f) — the provider's own in-frame control is the
   binding.** The captured "Enter Full Screen (f)" maps to the
   provider's own in-frame fullscreen (the stage's iframe carries
   `allow="fullscreen"`); a WebFlix-side stage-level f binding is NOT
   built (the watch surface's f binding is PlayerChrome's own — porting
   it onto the shorts surface would be new chrome beyond the task's
   named k/m bindings; the minimal-seam law). Recorded honestly.

7. **[NOTE] The tap law's carrier.** The corpus's tap behavior (tap the
   playing video ⇒ pause — G4-CORPUS.md's player truth) is delivered by
   the PROVIDER'S OWN in-frame tap: the click reaches the provider's
   player (its own channel), and the resulting state broadcast
   (onStateChange) advances WebFlix's visible truth through the
   documented channel. The stage deliberately does NOT cover the frame
   with a WebFlix click layer — a layer would block the provider's own
   controls (the chrome law's mapping) and falsify the corpus's chrome.
   WebFlix-issued toggles (the k binding) command the same pause/play
   through the documented channel AND record with the runtime; the
   provider-in-frame actions are the provider's own (observed, not
   re-recorded — the same law the watch surface keeps for in-frame
   provider actions).

8. **[HD] The prev/next arrows — the existing real navigation stands
   (R32 divergence row 7, reaffirmed).** The captured 56×56 arrows at
   x=1359; WebFlix's REAL queue navigation (the `wfx-shorts__nav`
   Next/Back round buttons + swipe + arrow keys, all driving the ONE
   frozen presenter) stays byte-identical (the seam law's pin). No
   rebuild; the 56×56 icon-arrow FORM remains the recorded divergence.

9. **[HD] The R24-W2 speed control does not reach the provider's
   embed.** The pinned parity row's speed select applies "where a stage
   media element exists" (its own documented application seam —
   `video, audio` elements inside the shorts viewport); the media stage
   is the provider's own embed (no WebFlix-owned media element — the
   provider's own player is the real player), so the pinned control
   stays byte-identical and applies to nothing on a staged card. The
   provider's own in-frame speed control is the real path. A
   channel-bound rate join (`setPlaybackRate` through the documented
   channel — the watch surface's own chrome binding) is a future
   minimal seam, recorded here rather than silently wired around the
   pinned control's byte-identical law.

10. **[HD] The card's monogram watermark renders OVER the stage.** The
    established card identity mark (the WFX-051 monogram —
    `.wfx-shortcard__monogram`, a 16%-alpha watermark) stays in the
    pinned card form (the seam law: nothing else about the card
    changes); the corpus's captured player carries no analogous
    watermark. The stage joins UNDER it (the DOM-order stacking — the
    first child), so the faint watermark overlays the playing video:
    the pinned form's own consequence, recorded rather than removed.

11. **[NOTE] The clear-screen law's extension.** The R24-W2
    distraction-free presentation hides overlay chrome (the overlay +
    the rail — the R32-extended rule); the stage is the MEDIA and stays
    visible (the corpus's own clear-screen intent — the player keeps
    playing full-bleed). The unmute affordance also stays (a sound
    control is playback, not chrome — the watch surface's stage keeps
    its own unmute visible in every presentation).

12. **[NOTE] The session fold's honest scope.** The stage's plays record
    through the SAME session seam the watch surface uses (the runtime's
    resolvePlayback + prepare + the playback bridge's record, through
    `POST /api/shorts-session`), with the provider-reported progress
    (5s throttle) / complete (the provider's own ended) / the final
    position at unmount folding through `POST /api/events` (the closed
    vocabulary, playbackSessionId-bound). The feed's OWN engagement
    seams stay untouched: the forward-swipe skip event keeps its frozen
    emission (the app layer's one documented decision), and like/save
    keep the actionStates seam. The stage never fabricates engagement;
    `"start"` stays the runtime controller's own fold (never duplicated
    client-side — the events route's own law).

13. **[NOTE] The fixture boot's staged-but-unbound truth.** In the
    fixtures boot (`WFX_DEV_FIXTURES=1`), the fixture shorts' embed
    realizations live at `https://fixture.invalid/embed/fake:short-N`
    (packages/experience's fixture catalog) — a non-provider host: the
    stage mounts the embed (staged, the honest resolve answer) but the
    provider family check answers "unknown" (embed-presentation.ts —
    not a YouTube embed host), so the frame keeps the OPAQUE_ORIGIN
    sandbox and NO control channel binds (the honest unbound state —
    `data-wfx-shortstage-live="false"` after the 3s timeout, disclosed,
    never simulated). The REAL playing embed is verified live in the
    SERVICE boot (browser-verification.md).

14. **[HD] The prefetch law's form.** The task's parenthetical "(± the
    existing prefetch window)" binds to the presenter's own window
    (DEFAULT_PREFETCH_AHEAD=2 — the frozen stack's prefetch): the view
    renders exactly current + next, and the stage honors the hover
    preview's SINGLETON discipline — only the CURRENT card mounts an
    embed; the NEXT card's stage is the resolve-only form (the per-item
    cache warms — the mount on swipe is a cache hit). Cards beyond the
    view's next never resolve, never mount (never the whole stack).

15. **[HD] The unmute affordance's placement + measure.** The corpus
    carries no unmute measure for the shorts player (its chrome record
    has mute, not an unmute pill); WebFlix's affordance is the watch
    surface's own family form verbatim (EmbedStage's
    `wfx-player__unmute` grammar: the pill, the words "Sound off — tap
    to unmute", evidence-gated), placed at the card's top-left — clear
    of the pinned channel row (bottom-left) and the R32 rail (right
    edge), inside the corpus's own top-chrome zone. On the mobile form
    the pill carries the 44px touch-target law (the established family
    law; the desktop form keeps the watch surface's 36px family
    measure).
