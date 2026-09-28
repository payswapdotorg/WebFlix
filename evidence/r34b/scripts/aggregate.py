#!/usr/bin/env python3
"""R34-B — the walk-battery AGGREGATOR.

Reads every raw walk record under evidence/r34b/raw/ (the harness's own
harvest JSONs — the product's typed marker traces, verbatim) and computes
the per-cell statistics for the J41 metric rows. Every number cites the
walk records it came from; nothing is synthesized.
"""
import json, glob, os, statistics

RAW = os.path.join(os.path.dirname(__file__), "..", "raw")

def pct(sorted_vals, p):
    """The nearest-rank percentile (honest small-n behavior)."""
    if not sorted_vals:
        return None
    n = len(sorted_vals)
    k = max(1, min(n, round(p / 100.0 * n)))
    return sorted_vals[k - 1]

def markers_of(rec):
    h = rec.get("harvest")
    if h is None:
        return []
    if isinstance(h, str):
        h = json.loads(h)
    t = h.get("trace")
    return t.get("markers", []) if t else []

def first_playing_ff(rec):
    """The provider's own playing broadcast offset (from play-clicked@0)."""
    for m in markers_of(rec):
        if m.get("marker") == "first-frame-rendered" and "own player reported playing" in (m.get("detail") or ""):
            return m["offsetMs"]
    return None

def metric(rec, name):
    for m in markers_of(rec):
        if m.get("marker") == name:
            return m["offsetMs"]
    return None

def nav_to_ff(rec):
    nav, ff = metric(rec, "navigation-start"), first_playing_ff(rec)
    if nav is None or ff is None:
        return None
    return ff - nav

def main():
    rows = {}
    for path in sorted(glob.glob(os.path.join(RAW, "*.json"))):
        rec = json.load(open(path))
        # skip non-walk artifacts (the extended-observation record keeps its
        # place in raw/ but is not a battery cell sample)
        if not isinstance(rec, dict) or "content" not in rec or "cache" not in rec:
            continue
        if rec.get("playActionPresent") is False:
            continue
        key = (rec["content"], rec["cache"])
        rows.setdefault(key, []).append(rec)

    print("content   cache   n    outcome(first-frame/timeout)  TTFFms(p50/p75/p95/min/max)  nav2ff(p50)  nav2vis(p50)  t2playable(p50)")
    summary = {}
    for (content, cache), recs in sorted(rows.items()):
        ff = [first_playing_ff(r) for r in recs]
        ff_ok = [x for x in ff if x is not None]
        n_ok = len(ff_ok); n_all = len(recs)
        n2f = [x for x in (nav_to_ff(r) for r in recs) if x is not None]
        n2v = [x for x in (metric(r, "player-surface-visible") for r in recs) if x is not None]
        # time-to-playable is from the trace origin (play-clicked@0)
        t2p = [x for x in (metric(r, "playable-declared") for r in recs) if x is not None]
        s = sorted(ff_ok)
        row = dict(
            n_total=n_all, n_first_frame=n_ok, n_timeout=n_all - n_ok,
            ttff=ff_ok,
            ttff_p50=pct(s, 50), ttff_p75=pct(s, 75), ttff_p95=pct(s, 95),
            ttff_min=min(ff_ok) if ff_ok else None, ttff_max=max(ff_ok) if ff_ok else None,
            nav2ff_p50=pct(sorted(n2f), 50) if n2f else None,
            nav2vis_p50=pct(sorted(n2v), 50) if n2v else None,
            t2playable_p50=pct(sorted(t2p), 50) if t2p else None,
        )
        summary[f"{content}-{cache}"] = row
        print(f"{content:9s} {cache:6s} {n_all:3d}  {n_ok}/{n_all - n_ok}"
              f"  {row['ttff_p50'] or 0:6.0f}/{row['ttff_p75'] or 0:6.0f}/{row['ttff_p95'] or 0:6.0f}"
              f"  {row['ttff_min'] or 0:6.0f}-{row['ttff_max'] or 0:6.0f}"
              f"  {row['nav2ff_p50'] or 0:6.0f}  {row['nav2vis_p50'] or 0:6.0f}  {row['t2playable_p50'] or 0:6.0f}")

    out = os.path.join(os.path.dirname(__file__), "..", "aggregate.json")
    json.dump(summary, open(out, "w"), indent=2)
    print(f"\nwrote {out}")

if __name__ == "__main__":
    main()
