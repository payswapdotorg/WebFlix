#!/usr/bin/env python3
"""R34-C — the consolidated manifest generator.

A MECHANICAL merge of the runner's own manifests:

  run/chunk-01..08/manifest.json      the production run of record
  rerun/chunk-01..08/manifest.json    the flaky-check re-run sweep
  local-baseline/full..full5/…        the local fixtures baseline (adjudication
                                      support — labeled as such, never a
                                      substitute verdict)

No hand-edited verdicts: every field below is derived from the manifests
alone. The script FAILS (non-zero exit) if any mechanical check breaks:

  1. each sweep's totals equal every chunk manifest's own `summary`
  2. the re-run sweep covers EXACTLY the run-of-record non-pass set
  3. every re-run VERDICT is identical (status) and every FAILURE MODE
     (the first-failure string) is tracked — verdict flakes vs failure-mode
     divergence are reported separately, honestly
  4. catalog order preserved (J01–J34, J36–J39; J35 has no web encoding)

Output is deterministic (no timestamps, no HEAD capture): re-running on the
same manifests reproduces byte-identical JSON.

Usage: python3 evidence/r34c/run/consolidate-manifests.py   (from the repo root)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PACK = Path(__file__).resolve().parent.parent          # evidence/r34c/
RUN, RERUN, LOCAL = PACK / "run", PACK / "rerun", PACK / "local-baseline"

CATALOG_ORDER = [f"J{n:02d}" for n in range(1, 35)] + [f"J{n:02d}" for n in (36, 37, 38, 39)]
EXPECTED_TARGETS = {
    "runOfRecord": "https://webflix-steel.vercel.app",
    "localBaseline": "http://localhost:3101",
}


def load_sweep(sweep_dir: Path, label: str) -> dict:
    """Read every chunk manifest of a sweep; verify internal totals."""
    chunks = sorted(p for p in sweep_dir.iterdir() if (p / "manifest.json").is_file())
    assert chunks, f"{label}: no chunk manifests under {sweep_dir}"
    journeys, per_chunk, totals = {}, [], {"total": 0, "encoded": 0, "passed": 0, "failed": 0, "notRun": 0}
    for cp in chunks:
        m = json.loads((cp / "manifest.json").read_text(encoding="utf-8"))
        s = m["summary"]
        for k in totals:
            totals[k] += s[k]
        # check 1: the manifest's own summary must match its journey list
        listed = [j["id"] for j in m["journeys"]]
        assert len(listed) == s["total"] == s["encoded"], f"{label}/{cp.name}: total mismatch"
        assert sum(1 for j in m["journeys"] if j["status"] == "pass") == s["passed"], f"{label}/{cp.name}: passed mismatch"
        assert sum(1 for j in m["journeys"] if j["status"] == "fail") == s["failed"], f"{label}/{cp.name}: failed mismatch"
        per_chunk.append({
            "chunk": cp.name,
            "journeys": listed,
            "webUrl": m["environment"]["webUrl"],
            "window": [m["environment"]["startedAt"], m["environment"]["finishedAt"]],
            "summary": s,
        })
        for j in m["journeys"]:
            assert j["id"] not in journeys, f"{label}: {j['id']} appears twice"
            a = j.get("assertions") or []
            journeys[j["id"]] = {
                "status": j["status"],
                "chunk": cp.name,
                "assertionsPassed": sum(1 for x in a if x.get("pass")),
                "assertionsTotal": len(a),
                "durationMs": j.get("durationMs"),
                "firstFailure": j.get("failure"),
            }
    return {"chunks": per_chunk, "totals": totals, "journeys": journeys, "webUrl": per_chunk[0]["webUrl"]}


def main() -> int:
    run = load_sweep(RUN, "run")
    rerun = load_sweep(RERUN, "rerun")
    local = load_sweep(LOCAL, "local-baseline")

    # check 4: catalog order + J35 absence
    seen = list(run["journeys"])
    assert seen == CATALOG_ORDER, f"run-of-record order drifted: {seen}"
    assert list(local["journeys"]) == CATALOG_ORDER, "local-baseline order drifted"
    assert "J35" not in run["journeys"] and "J35" not in local["journeys"], "J35 is not web-encoded"

    # check: production target is what the record claims
    assert run["webUrl"] == EXPECTED_TARGETS["runOfRecord"], f"run target drifted: {run['webUrl']}"
    assert local["webUrl"] == EXPECTED_TARGETS["localBaseline"], f"local target drifted: {local['webUrl']}"

    # check 2: the re-run covers EXACTLY the non-pass set
    nonpass = sorted(k for k, v in run["journeys"].items() if v["status"] != "pass")
    assert sorted(rerun["journeys"]) == nonpass, "rerun coverage != the non-pass set"

    # check 3: every re-run verdict identical (status) + failure-mode tracking
    verdict_flakes = [k for k in nonpass if rerun["journeys"][k]["status"] != run["journeys"][k]["status"]]
    mode_divergent = [k for k in nonpass
                      if rerun["journeys"][k]["firstFailure"] != run["journeys"][k]["firstFailure"]]

    # titles from the run manifests (single source)
    title = {}
    for cp in sorted(p for p in RUN.iterdir() if p.is_dir()):
        m = json.loads((cp / "manifest.json").read_text(encoding="utf-8"))
        for j in m["journeys"]:
            title[j["id"]] = j["title"]

    journeys = []
    for jid in CATALOG_ORDER:
        r, rr, lb = run["journeys"][jid], rerun["journeys"].get(jid), local["journeys"][jid]
        rec = {"id": jid, "title": title[jid], "runOfRecord": r}
        if rr is not None:
            rec["rerun"] = {k: rr[k] for k in ("status", "chunk")}
            rec["rerun"]["verdictIdentical"] = rr["status"] == r["status"]
            rec["rerun"]["failureModeIdentical"] = rr["firstFailure"] == r["firstFailure"]
            rec["rerun"]["firstFailure"] = rr["firstFailure"]
        else:
            rec["rerun"] = None  # a pass — not re-run by the discipline
        rec["localBaseline"] = {k: lb[k] for k in ("status", "chunk", "assertionsPassed", "assertionsTotal")}
        rec["localBaseline"]["firstFailure"] = lb["firstFailure"]
        rec["separation"] = (
            "pass-on-production" if r["status"] == "pass"
            else ("fails-both-boots" if lb["status"] != "pass" else "production-only-failure"))
        journeys.append(rec)

    consolidated = {
        "schema": "webflix-journey-consolidated-manifest/1",
        "generator": ("evidence/r34c/run/consolidate-manifests.py — a MECHANICAL merge of the "
                      "runner's own manifests (run/chunk-01..08, rerun/chunk-01..08, "
                      "local-baseline/full..full5). No hand-edited verdicts. Deterministic output."),
        "provenance": {
            "branch": "wfx/r34c/accept-regression",
            "tree": "09d02055f72a41927bc20fca8bbbfe5dd8cfeb1b (main @ the R33-A merge — post-R33)",
            "productionTarget": run["webUrl"],
            "localBaselineTarget": local["webUrl"],
            "localBaselineRole": ("adjudication support ONLY — the tree-level grammar-drift separation; "
                                  "never a substitute verdict (the PRODUCTION LAW)"),
            "sweeps": {
                "runOfRecord": run["chunks"],
                "flakyRerun": rerun["chunks"],
                "localBaseline": local["chunks"],
            },
        },
        "totals": {
            "runOfRecord": {"total": run["totals"]["total"], "passed": run["totals"]["passed"],
                            "failed": run["totals"]["failed"], "notRun": run["totals"]["notRun"]},
            "flakyRerun": {"reRun": rerun["totals"]["total"],
                           "verdictIdentical": len(nonpass) - len(verdict_flakes),
                           "verdictFlakes": len(verdict_flakes), "flakyJourneys": verdict_flakes,
                           "failureModeIdentical": len(nonpass) - len(mode_divergent),
                           "failureModeDivergent": mode_divergent},
            "localBaseline": {"total": local["totals"]["total"], "passed": local["totals"]["passed"],
                              "failed": local["totals"]["failed"], "notRun": local["totals"]["notRun"]},
        },
        "mechanicalChecks": {
            "totalsMatchEveryChunkManifestSummary": True,
            "rerunCoversExactlyTheNonPassSet": True,
            "allVerdictsStableOnRerun": not verdict_flakes,
            "failureModeDivergences": mode_divergent,
            "catalogOrderPreserved_J01_to_J39_minus_J35": True,
            "productionTargetIsTheFrozenLaw": True,
        },
        "crossSweepSeparation": {
            "passOnProduction": [j["id"] for j in journeys if j["separation"] == "pass-on-production"],
            "failsBothBoots": [j["id"] for j in journeys if j["separation"] == "fails-both-boots"],
            "productionOnlyFailures": [j["id"] for j in journeys if j["separation"] == "production-only-failure"],
        },
        "journeys": journeys,
        "classificationReference": (
            "adjudication-table.md is the HUMAN adjudication of record over these mechanical "
            "verdicts: 32 STALE-GRAMMAR (26 tree-level §A + 6 production-only §B) + "
            "2 ENVIRONMENTAL (J11, J39) + 0 REGRESSION = the 34 non-pass verdicts. "
            "J36's re-run failure-mode divergence (a browser-harness wait timeout, recorded "
            "in totals.flakyRerun) does not change its stable FAIL verdict; the run-of-record "
            "failure is the adjudicated basis."),
    }

    out = RUN / "consolidated-manifest.json"
    out.write_text(json.dumps(consolidated, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    t, sep = consolidated["totals"], consolidated["crossSweepSeparation"]
    print(f"consolidated → {out.relative_to(PACK.parent.parent)}")
    print(f"  run of record : {t['runOfRecord']['passed']} PASS / {t['runOfRecord']['failed']} FAIL / {t['runOfRecord']['total']}")
    print(f"  flaky re-run  : {t['flakyRerun']['reRun']} re-run, {t['flakyRerun']['verdictIdentical']} verdict-identical, "
          f"{t['flakyRerun']['verdictFlakes']} verdict flakes · failure-mode identical "
          f"{t['flakyRerun']['failureModeIdentical']}, divergent {t['flakyRerun']['failureModeDivergent']}")
    print(f"  local baseline: {t['localBaseline']['passed']} PASS / {t['localBaseline']['failed']} FAIL / {t['localBaseline']['total']}")
    print(f"  separation    : pass-on-production {len(sep['passOnProduction'])} · fails-both-boots "
          f"{len(sep['failsBothBoots'])} · production-only {len(sep['productionOnlyFailures'])}")
    ok = (not verdict_flakes) and t["runOfRecord"]["failed"] == 34 and t["runOfRecord"]["total"] == 38 \
        and t["localBaseline"]["passed"] == 11 and len(sep["failsBothBoots"]) == 27 \
        and len(sep["productionOnlyFailures"]) == 7 and mode_divergent == ["J36"]
    print(f"  EXPECTED SHAPE {'CONFIRMED' if ok else 'MISMATCH!!'} "
          "(4/34/38 · 11/27/38 · 27+7+4 · 0 verdict flakes · 1 recorded mode divergence [J36])")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
