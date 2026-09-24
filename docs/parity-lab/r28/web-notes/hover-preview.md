# R28 corpus sheet — HOVER PREVIEW (self-measured, Worker A's lane ABSENT → CORPUS-PENDING)

Measured live youtube.com search results (headless Chromium, dark, 1440×900, 2026-09-24).

## What the live DOM shows (measured)

- Hover previews mount through a **singleton `<ytd-video-preview>` element** attached at
  document level (NOT inside the card). On card `mouseenter` it becomes `display: flex`
  and is positioned over the hovered card.
- Measured geometry for a hovered 500×281 search thumbnail: the singleton container
  renders at **524×305** (the card "enlarges" ~12px per side); the inner `<video>` fills
  **504×283**.
- The inner `<video>` mounts with `preload="metadata"`, no controls; in the bot-gated
  headless context it stays paused at t=0 (R27's environmental note: youtube.com
  bot-gates MEDIA playback from this sandbox — the *anatomy* is measurable, the playback
  is not).
- Hide is pointer-position-dependent (mouseleave with the real pointer elsewhere hides
  it; synthetic events alone do not).

## The documented behavior (tagged [documented]; A's live threshold sheet CORPUS-PENDING)

- Dwell threshold: **500ms** — the R27 corpus contract's own reserved value
  (`PARITY_MOTION.hoverDwellMs = 500`). The operator's escalation cites "~0.5-1.5s".
  WebFlix implements 500ms (bottom of the measured band, YouTube's own documented
  behavior).
- The preview plays **muted**, inline, in place of the thumbnail.
- A **progress bar** renders at the bottom edge of the thumbnail tracking preview
  playback (red fill on YouTube).
- On un-hover the preview unmounts and the static thumbnail is restored.

## The WebFlix implementation decision (capability truth, both directions)

- Dwell-gated (500ms) muted inline preview on feed cards, mounted only when the item
  has a **previewable embed realization** (the connector's YouTube projection — real
  stream via the embed, never a looping placeholder GIF).
- The preview progress bar reflects the REAL preview playback state (polled from the
  embed's own player state channel).
- Items with no previewable realization render NO preview (honest absence), and the
  card says so only in the existing quiet preview disclosure.
