#!/usr/bin/env bash
# R34-B — the RESUMABLE cell runner (the re-entry law: never restart, resume).
# Runs one cell (content × cache × n) in the foreground, SKIPPING any walk
# whose raw record already exists. Usage: cell.sh <key> <cache> <n> [timeout]
set -u
WALK=/home/z/webflix/evidence/r34b/scripts/walk.sh
RAW=/home/z/webflix/evidence/r34b/raw
KEY="$1"; CACHE="$2"; N="${3:-10}"; TMO="${4:-60}"

for i in $(seq -f "%02g" 1 "$N"); do
  REC="$RAW/$KEY-$CACHE-$i.json"
  if [ -f "$REC" ]; then
    echo "[$(date -u +%H:%M:%S)] $KEY $CACHE $i: exists (resumed)"
    continue
  fi
  $WALK "$KEY" "$CACHE" "$i" "$TMO"
done
echo "[$(date -u +%H:%M:%S)] CELL $KEY-$CACHE COMPLETE (n=$N)"
