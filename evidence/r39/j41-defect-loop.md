# r39 addendum — the J41 defect loop (the chrome-control reveal law)

**Date:** 2026-10-02 · **Lane:** WFX-DEPLOY-W3 (browser-regression/release-surface) ·
**Trigger:** TL defect loop — J41 fails at `browser.clickInteractive('[data-wfx-chrome-play]')`
at the merged integration tree (W1+W2+this lane): the play control is COVERED by the
embed iframe while the chrome is idle.

## The defect (REPRODUCED)

**The law (from the product's own CSS — both trees carry it):**

```css
.wfx-chrome[data-wfx-chrome-idle="true"] { opacity: 0; pointer-events: none; }
.wfx-chrome[data-wfx-chrome-idle="true"]:focus-within { opacity: 1; pointer-events: auto; }
```

While the chrome is idle (~3s fade), the WHOLE bar — every control — is
`pointer-events: none`, so the hit target at any control's center is whatever sits
beneath the bar: over a provider embed, the IFRAME. A hit-target-verified click can
never land. The reveal law is the product's own window `mousemove` listener
(`revealControls`); over an embed the only idle surface that can deliver a parent-document
pointer event is W1's D2 always-interactive wake strip `[data-wfx-chrome-wake]`
(14px at the stage's bottom edge, `pointer-events: auto` only while idle).

**Deterministic reproduction** (forced idle 4.5s at the locally-constructed integration
merge — `work/wfx-deploy-w1-ux` + `work/wfx-deploy-w2-host` + this lane @ 63c8862,
the throwaway `verify/integration-pre-fix` worktree, embed title "Desert Rain Doc"):

```text
IDLE STATE — chrome-idle=true stripCount=1 playActionable={"actionable":false,"hit":"iframe."}
IDLE CLICK FAILED as expected — agent-browser command failed (1): click [data-wfx-chrome-play]
strip hover dispatched
POST-GESTURE — chrome-idle=false playActionable={"actionable":true,"hit":"svg."}
POST-GESTURE CLICK SUCCEEDED — control-confirmed=true
SYNTHETIC BACKSTOP — re-idle=true → after-synthetic=false playActionable={"actionable":true,"hit":"svg."}
```

The journey-level failure is a TIMING RACE on this law: a chrome-control click that
arrives within the revealed window (or under `:focus-within`) lands; one that arrives
idle over an embed fails. The pre-fix suite passes were the race landing favorably —
the encoding depended on it.

## The fix (journeys/** only — FIXED at 92d94a0)

`revealPlayerChrome(context, controlSelector)` in `journeys/lib/journeys.ts`, applied
before every chrome-control click (the driver gains `hover` + `scrollIntoView`):

1. **The two-branch actionability check** (fresh eval, the navigation-safe law):
   - IN-VIEWPORT control: the hit-target law — the control IS the element at its own
     center point (itself or a descendant). Revealed chrome answers YES → no gesture
     (byte-identical to the pre-fix behavior); idle chrome answers NO.
   - OUT-OF-VIEWPORT control (e.g. J40's settings popup escaping past the viewport
     top — observed `point=[513,-103]`): `elementFromPoint` cannot see it and the
     click command brings its own scroll — the check falls to the CHROME's own
     interactive state, the exact CSS law (`idle !== "true" || :focus-within`).
2. **The reveal gesture:** with the D2 strip present, a REAL pointer move over the
   strip (the exact user gesture W1 designed — `agent-browser hover`); best-effort,
   never the gate.
3. **The law itself:** a parent-document `mousemove` (the product's own reveal
   listener — the same event the strip's pointer move delivers; the only path on
   pre-D2 trees like this lane's baseline).
4. **The truth gate:** a bounded 10s poll until the check holds — LOUD typed failure
   on timeout, never a silent proceed that would click into the void.

**The audited sites** (every journey-interacted selector cross-referenced against the
PlayerChrome subtree — the containment audit):

| Journey | Site | Selector | Why |
|---|---|---|---|
| J41 | seek pair | `[data-wfx-chrome]` | the chrome root is `pointer-events:none` while idle |
| J41 | control pair | `[data-wfx-chrome-play]` | **the reported defect** (both benchmark titles incl. the embed rung) |
| J40 | settings open | `[data-wfx-chrome-settings] > summary` | chrome-contained |
| J40 | speed step | `[data-wfx-chrome-speed-step='1.5']` | chrome-contained (the out-of-viewport branch — the popup escapes the viewport top) |
| J40 | keyboard seek | `[data-wfx-chrome]` | chrome root |
| J43 | translate target | `[data-wfx-translate-target='es']` | chrome-contained AND eval-opened panel (no click → no `:focus-within` hold) |

Not chrome-contained (audited, no reveal needed): `[data-wfx-watch-kebab]`/`[data-wfx-queue-add-btn]`
(WatchActions — outside the chrome), `[data-wfx-translate-audio='translated']` (the translate
experience island), the live-chat controls (J45), `[data-wfx-watch-switch]` (the item hub's
Where-to-watch row). Keyboard seeks (`press j/l`) need no hit target.

## The verification (OBSERVED)

**This lane's tree (pre-D2 baseline — backward compatibility):**

```text
J40 PASS 41 assertions · J41 PASS 46 · J43 PASS 38   (assertion counts byte-equal the r39 record)
typecheck CLEAN · lint 116 problems (33e/83w — byte-identical the frozen baseline, zero in journeys/) · lane-check OK (1014 files)
```

(The three journeys run per-journey — the documented chunked-boot pattern for this
4.16GB box: a combined `--filter J41,J40,J43` boot OOM-died twice mid-run
`Killed process (next-server) anon-rss ~2.4GB`, the same environmental class the r39
sweep recorded; every per-journey re-run GREEN.)

**The integration tree (W1+W2+this lane @ 92d94a0, the verify worktree):**

```text
FORCED-IDLE STATE (the defect) = {"actionable":false,"hitAtPlayCenter":"iframe","idle":"true","strip":1}
revealPlayerChrome returned (the reveal + poll passed) → POST-FIX CLICK — control-confirmed=true
VERDICT: FIXED (forced-idle + the real helper path → the click lands)

J40 PASS 41 · J41 PASS 46 · J43 38 PASS   (per-journey runs)
```

**One flake observed and recorded (not this fix's regression):** the first post-fix
J41 run at the integration tree failed its LAST assertion — `realization-switch-requested`
absent (the watch-switch click landed — the torrent stage appeared — but the trace
marker read raced the click bridge). GREEN on re-run with identical code; the same
journey passed 46/46 at this lane's tree across every run today. The section has no
reveal step (the watch-switch is not chrome-contained); flagged for the TL's
integration attention as the switch-marker bridge-read race class.

## Ownership note

`apps/web/src` untouched (W1's D2 wake strip and the idle-cover CSS are W1's
browser-verified product truth); this fix is entirely within `journeys/**` — the
harness now encodes the product's own reveal law instead of depending on the race.
