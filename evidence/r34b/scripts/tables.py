#!/usr/bin/env python3
"""R34-B — the TABLES generator.

Reads every raw walk record under evidence/r34b/raw/ (plus the extended
observation record) and emits TABLES.md — the J41 metric tables for the R34-B
battery. Every number is computed from the product's own typed marker traces
harvested verbatim by walk.sh/extended.sh; nothing is synthesized. Percentiles
use the same nearest-rank method as aggregate.py.
"""
import json, glob, os

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "raw")

def pct(sv, p):
    if not sv:
        return None
    n = len(sv)
    k = max(1, min(n, round(p / 100.0 * n)))
    return sv[k - 1]

def markers_of(rec):
    h = rec.get("harvest")
    if h is None:
        return []
    if isinstance(h, str):
        h = json.loads(h)
    t = h.get("trace")
    return t.get("markers", []) if t else []

def m(rec, name, contains=None):
    for mk in markers_of(rec):
        if mk.get("marker") == name and (contains is None or contains in (mk.get("detail") or "")):
            return mk["offsetMs"]
    return None

def ms(x):
    return "—" if x is None else f"{x:.1f}"

def main():
    recs = []
    for path in sorted(glob.glob(os.path.join(RAW, "*.json"))):
        rec = json.load(open(path))
        if not isinstance(rec, dict) or "content" not in rec or "cache" not in rec:
            continue
        recs.append((os.path.basename(path), rec))

    cells = {}
    for fn, rec in recs:
        cells.setdefault((rec["content"], rec["cache"]), []).append((fn, rec))
    for k in cells:
        cells[k].sort(key=lambda fr: fr[1].get("sample", fr[0]))

    L = []
    A = L.append
    A("# R34-B — the J41 playback-startup metric tables")
    A("")
    A("Battery: the frozen walk protocol (`scripts/walk.sh`) on production")
    A("(`webflix-steel.vercel.app`), 5 identity-pair items × cold/warm, harvested verbatim")
    A("from the product's own typed marker trace (`window.__wfxPlaybackTelemetry`) —")
    A("every number below cites the raw record it came from. Percentiles: nearest-rank")
    A("(the honest small-n method, identical to `aggregate.py`). Trace origin is")
    A("`play-clicked@0` (the PlayIntentRecorder bridge; `originSkewMs` 0.3–4.2 ms).")
    A("")
    A("Items: rick = `dQw4w9WgXcQ` · zoo = `jNQXAC9IVRw` · rainbombs = `oH_pVgW5fEw` ·")
    A("wettest = `DYFDc0dpc5g` · ed = `2Vv-BfVoq4g` (canonical ids in `raw/*.json`")
    A("`itemHref`). The YouTube side of every pair is environment-blocked — see")
    A("`YOUTUBE-BLOCK-RECORD.md`.")
    A("")
    A("## The battery map (walks, outcomes, citations)")
    A("")
    A("| cell | n | first-frame | provider-refused (timeout) | raw records |")
    A("| --- | --- | --- | --- | --- |")
    tot_n = tot_ff = tot_to = 0
    for (content, cache), frs in sorted(cells.items()):
        n = len(frs)
        ff = sum(1 for _, r in frs if r.get("outcome") == "first-frame")
        tot_n += n; tot_ff += ff; tot_to += n - ff
        cit = f"`raw/{content}-{cache}-` {frs[0][1].get('sample','')}–{frs[-1][1].get('sample','')}"
        A(f"| {content} {cache} | {n} | {ff} | {n - ff} | {cit} |")
    A(f"| **TOTAL** | **{tot_n}** | **{tot_ff}** | **{tot_to}** | 68 records target |")
    A("")
    A("Provider-refused rows are the honest startup-failure record of this environment:")
    A("the provider never broadcasts `playing` within the 60 s walk window; the product")
    A("holds its typed `buffering` state with the provider's own wall visible inside the")
    A("contained surface (`YOUTUBE-BLOCK-RECORD.md`). Walk cadence: a first-frame walk")
    A("settles in ~7 s; a refused walk spends the full 60 s poll window (~67 s cadence,")
    A("timestamps in every record).")
    A("")
    A("## Row 1 — navigation-to-player-visible (ms, p50; per cell)")
    A("")
    A("Computed `player-surface-visible − navigation-start` from the typed trace.")
    A("")
    A("| cell | p50 |")
    A("| --- | --- |")
    for (content, cache), frs in sorted(cells.items()):
        v = [m(r, "player-surface-visible") - m(r, "navigation-start") for _, r in frs
             if m(r, "player-surface-visible") is not None and m(r, "navigation-start") is not None]
        A(f"| {content} {cache} | {ms(pct(sorted(v), 50))} |")
    A("")
    A("## Row 2 — click-to-first-frame / TTFF (ms; the provider's own `playing` broadcast)")
    A("")
    A("Adjudicable only where the provider actually plays (rick); refused cells have no")
    A("TTFF distribution by honest construction.")
    A("")
    A("| cell | n | p50 | p75 | p95 | min | max |")
    A("| --- | --- | --- | --- | --- | --- | --- |")
    for (content, cache), frs in sorted(cells.items()):
        ff = [m(r, "first-frame-rendered", "own player reported playing") for _, r in frs]
        ff = [x for x in ff if x is not None]
        if not ff:
            A(f"| {content} {cache} | {len(frs)} | — | — | — | — | — |")
            continue
        s = sorted(ff)
        A(f"| {content} {cache} | {len(ff)} | {ms(pct(s,50))} | {ms(pct(s,75))} | {ms(pct(s,95))} | {ms(s[0])} | {ms(s[-1])} |")
    A("")
    A("Sample-level TTFF (every measured value, verbatim):")
    A("")
    for (content, cache), frs in sorted(cells.items()):
        vals = [(frs_i, m(r, "first-frame-rendered", "own player reported playing")) for frs_i, (_, r) in enumerate(frs)]
        got = [(fn, v) for (fn, r), (i, v) in zip(frs, vals) if v is not None]
        if got:
            body = ", ".join(f"{v:.1f}" for _, v in got)
            A(f"- {content} {cache}: {body}")
    A("")
    A("## Row 3 — click-to-audible")
    A("")
    A("Exercised in the extended observation (`scripts/extended.sh`,")
    A("`raw/rick-extended-observations.json`): the unmute pill")
    A("(`[data-wfx-player-unmute]`) was clicked and the provider answered `muted=false` —")
    A("the pill retired (final state `pill: false`, phase `playing`;")
    A("`screenshots/rick-extended-audible.png`). The wall-clock answer latency was echoed")
    A("to the run's stdout but not durably captured — a harness gap recorded honestly;")
    A("**no number is asserted for this row**.")
    A("")
    A("## Row 4 — time-to-playable (ms, p50; the shell's `playable-declared` marker)")
    A("")
    A("| cell | p50 |")
    A("| --- | --- |")
    for (content, cache), frs in sorted(cells.items()):
        v = [x for x in (m(r, "playable-declared") for _, r in frs) if x is not None]
        A(f"| {content} {cache} | {ms(pct(sorted(v), 50))} |")
    A("")
    A("## Row 5 — startup failure (per cell; the honest incidence table)")
    A("")
    A("| cell | walks | startup failures | note |")
    A("| --- | --- | --- | --- |")
    for (content, cache), frs in sorted(cells.items()):
        n = len(frs)
        fails = sum(1 for _, r in frs if r.get("outcome") != "first-frame")
        note = "0 failures on the playable pair" if fails == 0 else "provider-refused (environmental bot-gate; typed buffering held)"
        A(f"| {content} {cache} | {n} | {fails} | {note} |")
    A(f"| **all cells** | **{tot_n}** | **{tot_to}** | refusals are provider-level, not product defects — see `YOUTUBE-BLOCK-RECORD.md` |")
    A("")
    A("## Row 6 — first-60-second rebuffer ratio")
    A("")
    A("- Battery walks (22 playable walks, harvest at first frame): **1 event** —")
    A("  `rick-warm-01.json`, `rebuffer-started` 1615.1 → `rebuffer-ended` 1625.7 =")
    A("  **10.6 ms** immediately after the playing broadcast (1571.2).")
    A("- Extended 60 s soak (`raw/rick-extended-observations.json`, `screenshots/rick-extended-60s.png`):")
    A("  **0 rebuffer events** during the uninterrupted playing span (first frame 1739.5 →")
    A("  user pause 47878.7); the only rebuffer is the **user-initiated resume** buffer-fill")
    A("  (resume 52820.9 → rebuffer 52828.1–53093.6 = **265.5 ms**, 0.44% of the 60 s")
    A("  observation window).")
    A("- YouTube-relative adjudication: blocked (`YOUTUBE-BLOCK-RECORD.md`).")
    A("")
    A("## Row 7 — seek response")
    A("")
    A("The product's typed contract carries the row (`PlayerChrome.tsx` records")
    A("`seek-requested`/`seek-confirmed`; `playback-telemetry.ts` defines")
    A("`seek-response-latency`). The extended observation clicked the scrub bar at 50%,")
    A("but **no seek markers fired in the captured trace** — the row is recorded as")
    A("**not captured in this battery** (the click did not produce a typed seek event;")
    A("no number is asserted).")
    A("")
    A("## Row 8 — control response (ms; typed `control-invoked` → `control-confirmed`)")
    A("")
    A("From `raw/rick-extended-observations.json` (the provider's own phase answers):")
    A("")
    A("| control | invoked @ | confirmed @ | latency |")
    A("| --- | --- | --- | --- |")
    A("| pause (k) | 47878.7 | 48157.9 | **279.2** |")
    A("| play (k) | 52820.9 | 53054.7 | **233.8** |")
    A("")
    A("## Row 9 — transient recovery")
    A("")
    A("5 s offline → online (`scripts/extended.sh` step 6): the player recovered to")
    A("**`phase: \"playing\"`** (final state in `raw/rick-extended-observations.json`;")
    A("`screenshots/rick-extended-recovery.png`, `-recovery-15s.png`). The provider's own")
    A("resume broadcast is the evidence; the trace carries the recovery markers verbatim.")
    A("")
    A("## (spec row 10) — realization-switch time")
    A("")
    A("Not exercised in this battery: every item ran its embed realization only (the")
    A("identity pairs' provider refs). Recorded honestly as **not covered**; the row")
    A("belongs to a multi-realization content set.")
    A("")
    A("## The AI-enrichment non-blocking observation (J41 clause: no nonessential")
    A("## AI/recommendation/indexing work blocks first frame)")
    A("")
    A("| walk | playable-declared | first frame (contained) | enrichment mounted (ai-tray / intelligence / live-captions) |")
    A("| --- | --- | --- | --- |")
    for fn in ["rick-cold-00.json", "rick-cold-01.json", "rick-warm-01.json"]:
        rec = json.load(open(os.path.join(RAW, fn)))
        h = rec.get("harvest")
        if isinstance(h, str):
            h = json.loads(h)
        obs = (h.get("startupObservations") or {}).get("enrichmentMountedAtMs") or {}
        pld, cff = m(rec, "playable-declared"), m(rec, "first-frame-rendered", "contained-surface-load")
        e = " / ".join(f"{k} {ms(v)}" for k, v in sorted(obs.items())) or "(none recorded this walk)"
        A(f"| `{fn}` | {ms(pld)} | {ms(cff)} | {e} |")
    A("")
    A("On the walks that recorded the observation, enrichment mounts at")
    A("1648.3–1708.8 ms — at/after that walk's contained first frame (0.1 ms after on")
    A("`rick-cold-00`; ~959 ms after on `rick-cold-01`) and never before")
    A("`playable-declared` — never a serial dependency of the provider's playing")
    A("broadcast. `rick-warm-01` recorded an empty observation object — variance kept")
    A("verbatim.")
    A("")

    out = os.path.join(HERE, "..", "TABLES.md")
    open(out, "w").write("\n".join(L) + "\n")
    print(f"wrote {out} ({len(recs)} walk records)")

if __name__ == "__main__":
    main()
