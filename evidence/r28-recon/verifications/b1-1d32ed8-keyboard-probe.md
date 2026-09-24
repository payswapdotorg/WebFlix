# B@1d32ed8 keyboard transport probe (N25) — service boot, player page

Method: service boot @3101, player page via card href, viewport 1440×900.
Chrome labels read before/after `press k` and `press m` (agent-browser
keyboard events to the focused page).

| step | observation |
|---|---|
| initial (3s after load) | `Play (k)` · `Mute (m)` |
| after `press k` (+1.5s) | `Play (k)` — **no visible chrome change** |
| after `press m` (+1s) | `Unmute (m)` — **label flipped** |

## Reading

- The provider control channel WORKS both ways: the m press toggled the
  provider mute state and WebFlix's chrome label reflected it
  (postMessage round-trip: command out → provider state broadcast back).
- The k press produced no chrome signal. Two hypotheses, unresolvable from
  the parent DOM (the iframe's internal play state is cross-origin):
  (a) playback never advanced (autoplay didn't start in this headless run —
  the initial label `Play (k)` rather than `Pause (k)` suggests the video
  was not yet reporting playing), so k's toggle had no visible effect;
  (b) the Play/Pause label does not track provider play state.
- Initial-label note: with `mute=1` in the embed URL, YouTube convention
  would label the button "Unmute (m)" (press to unmute); the initial label
  read "Mute (m)" — the state sync may lag the provider's initial broadcast.

## Verdict datum (N25)

Partial: m VERIFIED via label flip (channel proven); k UNVERIFIED (no
observable signal). Row stays OPEN. j/l/f/t/i/arrows/0-9/c untested.
