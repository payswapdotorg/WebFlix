#!/usr/bin/env bash
# R34-B — the full walk battery (the J41 content set, cold + warm, n per cell)
# Runs walks sequentially in one browser session line; cold walks destroy
# the context per walk (the fresh-profile law). Progress logged per walk.
set -u
WALK=/home/z/webflix/evidence/r34b/scripts/walk.sh
LOG=/home/z/webflix/evidence/r34b/scripts/battery-progress.log
N="${1:-10}"

run_cell() {
  local key="$1" cache="$2"
  for i in $(seq -f "%02g" 1 "$N"); do
    # warm walks: 01..N walk back-to-back in the same context
    # cold walks: 01..N each destroy + relaunch the context
    OUT=$($WALK "$key" "$cache" "$i" 60)
    echo "[$(date -u +%H:%M:%S)] $OUT" | tee -a "$LOG"
  done
}

# The playable set first (the spot-check already produced rick cold/warm 00)
for key in rick zoo rainbombs; do
  run_cell "$key" cold
  run_cell "$key" warm
done

# The prior-session provider-refused set (the honest startup-failure rows)
for key in wettest ed; do
  run_cell "$key" cold
  run_cell "$key" warm
done

echo "[$(date -u +%H:%M:%S)] BATTERY COMPLETE" | tee -a "$LOG"
