# R27-W3 — the Desktop parity-lab evidence (the YouTube grammar, natively)

**Lane:** `wfx/r27/desktop` (W3 — the desktop app joins the parity lab).
**Corpus:** `docs/parity-lab/` (the R27-L lead capture, 2026-09-23).
**Composition under test:** the REAL `createDesktopApp` boot — the same
factory the production boot calls — with the deterministic engine double
(the same honest doctrine `journeys/desktop/README.md` records; the
CATALOG is the real production data: four Blender Foundation films,
CC-BY licensed by the rights holder, real `.torrent` metainfo, real
source artwork URLs).

## The proof chain

| Evidence | Path | What it proves |
| --- | --- | --- |
| The token mapping | `TOKEN-MAPPING.md` (machine-generated) | every corpus sheet row → the Desktop encoding (name → custom property → dark/light value → provenance) + the RENDERED geometry conformance record (player 996@x=16 y=68, secondary 412@x=1028, topbar 56, rail 240, chips 32 — measured in the capture browser against the corpus's own measured values) |
| The surface captures | `captures/desktop-*-1440.png` | browse / watch / search / library / shorts, dark + light, at exactly 1440×900 — real source artwork rendered through the GENERATED parity stylesheet |
| The side-by-sides | `captures/side-by-side/side-by-side-*-2880.png` | this lane's surface next to the corpus reference (home shell, watch shell, search dark + light), same-viewport panes |
| The honest divergences | `DIVERGENCES.md` | every YouTube feature the Desktop truthfully lacks, named + why |
| The R26 journey battery | `battery/r26-peer-watch-journey.txt` | the 10-test peer-watch journey stays GREEN (10/10, 0 fail) — the peer-realization journey is first-class, restyled INTO the grammar |
| The R27 lane battery | `battery/r27-lane-tests.txt` | the lane's own 44 tests: token pinning (13), surface grammar (14), player chrome (14), the chrome journey (3) |

## How the captures were made (reproducible)

```bash
bun apps/desktop/scripts/r27-capture-harness.ts   # writes the HTML pages + TOKEN-MAPPING.md
# open evidence/r27-w3/captures/src/<surface>-<theme>.html at 1440×900 and screenshot
# (the harness's --serve flag serves the repo root at :4173 if an HTTP
#  origin is preferred; the captures above were taken from the file:// origin)
```

The harness boots the real composition, projects the R27 grammar views,
and renders them through `r27DesktopStylesheet()` — the SAME single
encoding the webview consumes (generated from the token contract, never
hand-authored: every color rides a `var(--wfx-*)`, every number
interpolates from `R27_GEOMETRY`/`R27_MOTION`). The artwork `<img>`
elements carry the REAL source URLs verbatim (the R26 artwork law); the
captures show the real Blender artwork loading from the real sources.

## The honest window-chrome mapping (recorded per the lane packet)

The native shell opens a 1440×900 decorated window (`tauri.conf.json`,
minWidth 960): the OS title bar sits ABOVE the app surface; the corpus's
56px masthead renders as the in-app topbar below it. The watch page is
RAILLESS (the corpus's own rendered watch shell: the guide collapses,
the player sits at x=16). The <792px bottom-nav grammar never renders
(the window's 960 floor) — see DIVERGENCES #10.

## Where the peer journey lives in the grammar

The R26-W3 peer-realization journey renders inside the corpus grammar,
first-class:

- **Where-to-watch** is the watch page's viewing-source panel
  (`wfx-w2w`): the same frozen groups (WebFlix source → Authorized peer
  copy → Other ways), the same frozen vocabulary, styled as the natural
  way-to-watch choice.
- **The honest lifecycle** (Preparing → Buffering-with-verified-fraction
  → Playing → seek demotion → completing → Ready offline) renders as the
  in-chrome stage state (`R27StageStateView`), the acquisition view's
  protocol-free labels verbatim.
- **The capability rows** (Translate gate, AI actions, transcript,
  provenance, Where-to-watch) live inside the settings popup's two-level
  menu, capability-truth-gated — never removed, never faked.
- The control grammar (play/next-when-queued/volume/time/captions/
  settings/miniplayer/theater/fullscreen, red `#f03` scrub with the
  verified-runway truth, the corpus keyboard map with `t`=theater) runs
  over the UNCHANGED R26 runtime semantics.

## The conformance escalations (the lead owns)

1. W1's shared token contract had not landed on the remote when this
   lane started — this lane mirrors the sheet exactly and records the
   mapping for W1's harness (DIVERGENCES #20).
2. W2's web branch renders 24px watch padding at 1440 where the corpus
   measures 16px — the corpus wins; the conformance pass should
   arbitrate both apps to the measured values (DIVERGENCES #19).
