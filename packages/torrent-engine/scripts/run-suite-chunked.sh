#!/usr/bin/env bash
# Chunked full-suite runner for a memory-constrained sandbox (R11 evidence tooling).
#
# WHY THIS EXISTS (honest evidence): a single `bun test` run OOMs in this
# 4GB sandbox during packages/persistence's wasm-postgres tests — verified
# AT BASE (11fd953) and on the R11 branch, in BOTH `--parallel=2` and
# sequential modes (exit 137, ~3.6GB anon-rss per the OOM killer). The
# suite itself is green; the sandbox just cannot host the whole run in one
# process. This runner executes the SAME tests in per-directory chunks
# (a fresh bun process per chunk), tallies bun's own summary numbers, and
# proves nothing is red with R11's changes included.
set -u
cd /home/z/wfx-r11

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0
declare -a FAILED_CHUNKS=()

run_chunk() {
  local label="$1"
  shift
  local log
  log=$(mktemp /tmp/wfx-chunk-XXXXXX.log)
  timeout 600 bun test "$@" > "$log" 2>&1
  local rc=$?
  # Bun prints its own summary tail: "N pass\nM fail\nK skip" and
  # "Ran T tests across F files". Parse those (a skip line is PRINTED twice
  # by bun — inline and in the skipped-summary — so grep-counting lines
  # would double-count).
  local pass fail skip ran
  pass=$(awk '/^ *[0-9]+ pass$/ { v = $1 } END { print v + 0 }' "$log")
  fail=$(awk '/^ *[0-9]+ fail$/ { v = $1 } END { print v + 0 }' "$log")
  skip=$(awk '/^ *[0-9]+ skip$/ { v = $1 } END { print v + 0 }' "$log")
  ran=$(awk '/^Ran [0-9]+ tests/ { v = $2 } END { print v + 0 }' "$log")
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_SKIP=$((TOTAL_SKIP + skip))
  if [ "$rc" -ne 0 ] || [ "$fail" -gt 0 ]; then
    echo "FAIL $label (rc=$rc): $pass pass, $fail fail, $skip skip, $ran ran"
    tail -8 "$log" | sed 's/^/     /'
    FAILED_CHUNKS+=("$label")
  else
    echo "OK   $label: $pass pass, 0 fail, $skip skip ($ran ran)"
  fi
  rm -f "$log"
}

run_chunk "tests/ (root governance)" tests/governance
for dir in packages/*/tests; do
  [ -d "$dir" ] || continue
  run_chunk "$dir" "$dir"
done
# Inline tests living under src/ (recommendation + web's shared seam).
run_chunk "packages/recommendation/src (inline)" packages/recommendation/src
run_chunk "apps/web/src/shared (inline)" apps/web/src/shared
for dir in apps/*/tests; do
  [ -d "$dir" ] || continue
  run_chunk "$dir" "$dir"
done

echo "======================================"
echo "CHUNKED TOTAL: pass=$TOTAL_PASS fail=$TOTAL_FAIL skip=$TOTAL_SKIP"
if [ ${#FAILED_CHUNKS[@]} -gt 0 ]; then
  echo "FAILED CHUNKS: ${FAILED_CHUNKS[*]}"
  exit 1
fi
echo "ALL CHUNKS GREEN"
