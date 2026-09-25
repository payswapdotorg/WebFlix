#!/usr/bin/env python3
"""R29-C census — the machine-counted verdict census over the matrix table.

The doctrine's scoreboard numbers are SCRIPTED counts, never hand-tallied:
this script parses docs/parity-lab/r29/reconciliation/MATRIX.md Section 1
and emits the row/class/status census as JSON. The matrix's SCOREBOARD
section must match this output exactly.
Usage: python3 evidence/r29-recon/r29-census.py [--json]
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

MATRIX = Path(__file__).resolve().parents[2] / "docs/parity-lab/r29/reconciliation/MATRIX.md"


def census() -> dict:
    rows = []
    in_section = False
    for line in MATRIX.read_text().splitlines():
        if line.startswith("## SECTION 1"):
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if not in_section or not line.startswith("| ") or "---" in line or line.startswith("| #"):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) >= 6 and re.match(r"^[A-Z]", cells[0]) and cells[4] in ("PAR", "COS", "HD", "OB"):
            rows.append({"row": cells[0], "class": cells[4], "status": cells[5]})
    classes = Counter(r["class"] for r in rows)
    statuses = Counter("VERIFIED" if "VERIFIED" in r["status"] else "OPEN" for r in rows)
    return {
        "matrix": str(MATRIX),
        "section1_rows": len(rows),
        "class": dict(classes),
        "status": dict(statuses),
        "verified_rows": [r["row"] for r in rows if "VERIFIED" in r["status"]],
        "open_rows": [r["row"] for r in rows if r["status"].startswith("OPEN")],
    }


if __name__ == "__main__":
    result = census()
    if "--json" in sys.argv:
        print(json.dumps(result, indent=2))
    else:
        print(
            f"rows={result['section1_rows']} class={result['class']} "
            f"status={result['status']}"
        )
        print("verified:", ", ".join(result["verified_rows"]))
        print("open:", ", ".join(result["open_rows"]))
