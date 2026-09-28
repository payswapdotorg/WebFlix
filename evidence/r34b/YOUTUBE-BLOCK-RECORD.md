# R34-B — the YouTube-side environmental block record (the J41 baseline gate)

The J41 acceptance thresholds are YouTube-relative (`p50 TTFF <= YouTube + 150 ms` etc.).
This record documents, with captured and VLM-read evidence, that the YouTube side of
every identity pair in this battery is **blocked at the environment level in this
sandbox** — the same block the prior session recorded ("YouTube bot-gate = environmental
block"), now re-confirmed on this session's own attempts with quoted wall text.

## The attempts (this session, live, headless agent-browser)

| identity pair (provider ref) | YouTube watch attempt | capture |
| --- | --- | --- |
| rick — `dQw4w9WgXcQ` | `youtube.com/watch?v=dQw4w9WgXcQ` | `screenshots/youtube-watch-dQw4w9WgXcQ.png` |
| zoo — `jNQXAC9IVRw` | settled load | `screenshots/youtube-watch-jNQXAC9IVRw.png`, `-settled.png` |
| zoo — `jNQXAC9IVRw` | after the page's own play affordance was clicked | `screenshots/youtube-watch-jNQXAC9IVRw-after-own-play.png` |
| wettest — `DYFDc0dpc5g` | `youtube.com/watch?v=DYFDc0dpc5g` | `screenshots/youtube-watch-DYFDc0dpc5g.png` |
| ed — `2Vv-BfVoq4g` | `youtube.com/watch?v=2Vv-BfVoq4g` | `screenshots/youtube-watch-2Vv-BfVoq4g.png` |
| rainbombs — `oH_pVgW5fEw` | `youtube.com/watch?v=oH_pVgW5fEw` | `screenshots/youtube-watch-oH_pVgW5fEw.png` |

No YouTube watch page reached a playing state in this environment. No TTFF baseline
number exists on the YouTube side for any pair.

## What the walls say (VLM reads, verbatim quotes — records in `vlm/`)

1. **The bot-check wall** (zoo, settled and *after clicking the page's own play
   affordance* — the wall persists through the interaction):
   > Headline: **"Sign in to confirm you're not a bot"**
   > Subtext: "This helps protect our community"
   > Buttons: "Sign in" / "Learn more"

   (`vlm/vlm-yt-zoo-settled.json`, `vlm/vlm-yt-after-play.json`; the video title
   "Me at the zoo", channel "jawed" render — the page is the real watch page, the
   player area is the wall.)

2. **The unusual-traffic wall** (rick):
   > "Our systems have detected unusual traffic from your computer network. Please
   > try your request again later."
   > with the sandbox egress IP quoted.

   (`vlm/vlm-yt-rick.json`)

## The block reaches the provider's embed surface too (the WebFlix-side cells)

The same provider wall renders **inside WebFlix's contained embed** for 4 of the 5
battery items — zoo, rainbombs, wettest, ed never receive the provider's "playing"
broadcast (0/41 walks; every record is an honest `timeout` row with the product's
typed `buffering` state held):

- `vlm/vlm-wfx-zoo.json` — the WebFlix player page for "Me at the zoo" after 60s:
  the contained surface shows the provider's own sign-in wall; WebFlix's shell is
  intact around it (unmute pill "Sound off — tap to unmute" present, page state
  "(buffering)").
- `vlm/vlm-wfx-wettest.json` — same provider wall inside the contained embed for
  the wettest item; page state "(buffering)".

Only rick (`dQw4w9WgXcQ`) passes the provider's embed gate in this environment and
actually plays (22/22 walks broadcast playing) — while the **site-side** attempt for
the very same video is walled by the unusual-traffic block above. The embed path and
the site path are gated independently by the provider; the battery records both truths.

## Consequence for the acceptance adjudication

- The five YouTube-relative thresholds of J41 cannot be numerically adjudicated in
  this environment. No YouTube-side number was fabricated, estimated, or borrowed
  from any other round to fill the gap.
- The WebFlix side is fully measured on the one playable identity pair (rick) and
  fully recorded as honest provider-refusal rows on the other four; see
  `TABLES.md` and `ACCEPTANCE-SUMMARY.md`.
- Re-running this battery in an environment where the YouTube side (site and embed)
  is not bot-gated would make the five thresholds adjudicable with zero harness
  changes — the walk protocol, the raw records, and the aggregator are all
  YouTube-baseline-ready (`scripts/aggregate.py` computes the same percentile rows
  for any walk records dropped into `raw/`).
