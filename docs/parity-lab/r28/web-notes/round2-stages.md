# R28-B round 2 — the corpus-driven fixes (the resumed session's stages)

The resumption verified the lane intact (`1d32ed8` atop `5c4c28c` atop main `3304b65`;
no newer remote state), then implemented the remaining scope as four stages. Corpus
consumed: `wfx/r28/corpus` @ `25ba5e7` — hover-preview.md, comments-anatomy.md,
share-dialog.md, color-survey.md, watch-page-anatomy.md; C's matrix @ `fb924b9`
(O6 pixel survey, N28, wave-1 verdicts).

## Stage 1 — the hover preview (the operator's #1) — commit d16700b (amended)

- **Dwell ~150ms over the thumbnail** (hover-preview.md's mutation timeline: the
  singleton at ~147ms, the video at ~193ms — the R27 "~500ms" value superseded);
  the R24 attention policy stays the derivation (Mindful off / Balanced 150ms /
  Immersive 0ms).
- **ONE reuse singleton** (`HoverPreviewLayer`, mounted once in the AppShell; the
  `ytd-video-preview` grammar: repositioned per hovered card, `pointer-events:
  none` hidden, RETAINED after the fade).
- **The popped copy**: the thumb rect + 24px outward (+12px per side — the corpus
  geometry, measured live: 288×162 thumb → 312×186 box).
- **The REAL stream**: the provider's own embed (muted autoplay, the shared
  presentation law extracted to `embed-presentation.ts` — privacy host +
  `enablejsapi` + `autoplay=1&mute=1`). NEVER a fake GIF: the resolve truth comes
  from the NEW `GET /api/preview` (the frozen `serverPort.resolve` path, one
  cached read per hovered card, FIFO-bounded). A no-embed source keeps the card's
  static artwork with the honest pill (the corpus's gated state).
- **The chrome**: "Tap to unmute" (provider-reported mute truth), the 2x speed
  pill (the provider's `setPlaybackRate`), the Info affordance, the progress bar
  (provider-reported position/duration only — no ticker). A preview NEVER writes
  watch state (previewing is not watching).
- **No card transform** (measured: transform none, opacity 1); un-hover fades out
  in 200ms and the stream stops while the element persists (measured live).
- Evidence: `evidence/r28-web/verifications/b2-hover-{250ms,1.7s}.png` + probe —
  singleton=1, dwell=150, the real nocookie+autoplay+mute+jsapi src, chrome
  present. The provider's own bot-gate renders inside the frame in this egress
  (the corpus's binding environmental truth — identical to the inherited
  player's captured state in C's `b1-1d32ed8-player-autoplay.png`).
- Includes the resumption fix: `1d32ed8` shipped HomeSurface's
  `itemDetailHref`/`placeholderMonogram` unimported (the wiped session's
  mid-refactor state) — typecheck restored. Also discovered + fixed: the prior
  `CardPreview` was a zero-size sibling (its hover could never fire) — the
  trigger is now the card wrapper.

## Stage 2 — the card kebab + the unified share panel + the background finish — commit 08c76e4

- **The card grammar** (share-dialog.md's "Card 'More actions' button" + the O6
  residual): the always-visible quiet action row — C's pixel survey measured the
  raised-gray field at 11.7% vs YouTube's <5% — replaced by the corpus 3-dot
  kebab (40×40; menu: Add to queue / Save to playlist / Share / Details —
  WebFlix's own vocabulary; no fabricated Download entry).
- **The share panel** (share-dialog.md): 470×337 r12, the EXACT measured dialog
  shadow `rgba(0,0,0,0.15) 0 0 24px 12px` (verified live), the Share header + X,
  the scrollable 70×93 tile row in the measured order (Embed, Messages,
  WhatsApp, Facebook, X, Email, Reddit, Pinterest, LinkedIn — Embed FIRST), the
  link field + the 64×40 r20 Copy pill → the "Link copied to clipboard" toast
  (the real clipboard, verified live), the "Start at [timestamp]" checkbox
  appending `?t=` (the player page carries the live provider-reported position;
  cards carry 0:00).
- **The link**: the SOURCE's own short form (`youtu.be/<id>`, derived from the
  realization's embed URL — measured live: `https://youtu.be/3uyGhtARP4M`), with
  the WebFlix canonical absolute link as the honest fallback. NO fabricated
  `si=` share-tracking token (the provider's own per-share artifact — recorded
  as a divergence). The Embed view shows the provider's documented embed code
  (or the honest not-embeddable truth).
- **Every tile is a REAL share intent** (the platforms' own share-surface URLs;
  `sms:`/`mailto:` for the messaging/email surfaces).
- **The N28 fix**: the PWA install prompt quieted into the rail (a nav-entry
  "Install app" + the disclosure sheet inside the rail's dark field — the REAL
  deferred `beforeinstallprompt` stays one disclosure away; no in-page floating
  install chrome).
- The rail active pill retargeted to the corpus chip-family overlay
  (`--wfx-bg-hover`).
- **Pixel survey after** (the same 3px-grid method as C's): raised **5.0%**
  (from 9.2% at my before-capture; 11.7% in C's survey) — within YouTube's
  <5% band; the remaining raised = the corpus-conformant chips + the artwork's
  own gray tones. Evidence: `b2-home-dark-after.png`, `b2-kebab-open.png`,
  `b2-share-panel-{startat,embed}.png`.
- The stale orientation-zone test updated to the R28 restructure truth (the
  config lives in Settings ▸ General; the inherited head failed 2 tests in that
  file, this state passes them).

## Stage 3 — the comments (the operator's #3) — commit 33bee28

- The full corpus anatomy (comments-anatomy.md), **measured live**: header
  "N Comments" 15px/700; @handle 12px/500; time-ago 12px/400 secondary; body
  14px/400/20px; the like/dislike pills 32×32; the 36px circular avatar; Reply
  12px/500; the replies expander with its count; the Top/Newest sort menu.
- **The honest local per-user transport** (the frozen law): localStorage
  `wfx-comments-v1`, keyed per item — the browser's own record. The count counts
  the local comments; the like count shows only the user's own real like ("1"
  when liked, nothing when not — never a fabricated social number); the
  creator-heart and pinned-badge slots exist in the grammar and never fill (the
  local author is not the content's creator); the footnote names the transport.
- **The composer gate** (the corpus's logged-out truth): clicking the collapsed
  "Add a comment..." signed-out NEVER mounts the editor — the honest
  Settings ▸ General sign-in path shows. The signed-in editor is real
  (textarea + Cancel/Comment), writes persist across reload (verified live),
  replies nest under their threads with the expander.
- The page-level session read (`host/request-session-view.ts` — the same
  machinery `/api/auth/session` uses, through the request cookie) feeds the
  gate; the player page otherwise keeps the anonymous-host law unchanged.
- Placed per watch-page-anatomy.md: description → comments.
- Evidence: `b2-comments-signedin.png` (2 Comments, like=1, the nested reply,
  persistence across reload), `b2-comments-anon-gate.png` + the probe JSON (the
  measured values above).

## Stage 4 — the theme default follows the OS — commit (this push)

- layout.tsx's before-paint seam: the persisted choice (`wfx-theme`) still wins;
  with NO stored choice `prefers-color-scheme: light` boots LIGHT and dark/no-
  signal keeps the dark default (verified live both ways + the stored-choice
  precedence). The operator's binding ruling; recorded as an honest divergence
  from youtube.com's always-light logged-out boot (color-survey.md).

## Guards

`bun install --frozen-lockfile` ✓ · `bun run lint` ✓ (0 errors) ·
`bun run typecheck` ✓ · the full battery + `contract-check` + `lane-check` +
`bun test tests/parity-conformance.test.ts` (CONFORMANT) + the web build —
run atomically at push time (the platform reaper kills detached runs; see the
worklog).

## The final guard run (this push)

- `bun run lint` ✓ (0 errors, the 38 pre-existing warnings untouched)
- `bun run typecheck` ✓ (root + journeys)
- THE BATTERY, file-by-file across all 16 test roots + the 10 tests outside
  them (the sandbox's memory ceiling OOM-kills the single-process run —
  `bun test <path>` is a substring filter, so `bun test tests` runs
  EVERYTHING): **5,132 pass / 0 fail** — exactly main @ 3304b65's own
  floor (~5,132), zero regressions, zero kills.
  (One test updated to the new truth: up-next-queue's SSR assertion of
  `data-wfx-share-copy` — the unified panel mounts on open now, the
  paper-dialog model; the trigger assertion carries the contract.)
  (One stale test rewritten in discovery-surface: the orientation-zone
  grammar the R28 restructure moved to Settings ▸ General — the inherited
  head failed 2 tests there; this state passes.)
- `bun run contract-check` ✓ (12 frozen blocks, 7 extension types)
- `bun run lane-check` ✓ (911 files, no cross-lane imports)
- `bun test tests/parity-conformance.test.ts` ✓ — the web wave-state stays
  CONFORMANT (19 pass)
- `next build` (apps/web, service env) ✓ EXIT 0 — all routes compiled
  including the new /api/preview (required stopping the dev servers first:
  the 4GB sandbox ceiling).
- Live verification via `localhost` (NOT `127.0.0.1` — Next 16 dev blocks
  the hydration chain for cross-origin dev-resource consumers, an
  environment finding worth remembering: the pristine 1d32ed8 boots dead
  islands under `127.0.0.1`).
