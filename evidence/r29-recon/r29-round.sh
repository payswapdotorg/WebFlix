#!/usr/bin/env bash
# R29-C VERIFICATION ROUND RUNNER — the R29 verification loop's engine
# (atomic: the platform reaper kills detached background processes, so a
# round boots the subject, runs the instrument, captures evidence, tears down
# — all inside ONE invocation).
#
#   subject   = the build under test (worktree at /home/z/webflix-b, booted @3101)
#               (B's lane wfx/r29/web, or base main for the baseline)
#   instrument = this lane's harness: evidence/r29-recon/r29-probe.ts + the
#                R28 harness set (verify.ts / verify-corpus.ts / capture.ts),
#                run from /home/z/webflix (the instrument lives on C's lane)
#
# Usage:
#   bash evidence/r29-recon/r29-round.sh <sha> <tag> [boot-mode]
#     <sha>        the commit to verify (fetched by the caller or refreshable)
#     <tag>        report tag -> evidence/r29-recon/<tag>.*.json + PNGs
#     [boot-mode]  fixtures (default) | service (WFX_API_BASE -> production API)
set -u
SHA="${1:?usage: r29-round.sh <sha> <tag> [boot-mode]}"
TAG="${2:?usage: r29-round.sh <sha> <tag> [boot-mode]}"
MODE="${3:-fixtures}"
REPO=/home/z/webflix
WT=/home/z/webflix-b
PORT=3101
BASE="http://localhost:${PORT}"

cd "$REPO" || exit 1
mkdir -p /home/z/.r29c

# 1. fresh worktree at the subject sha
git worktree remove --force "$WT" >/dev/null 2>&1
git worktree prune >/dev/null 2>&1
rm -rf "$WT"
git worktree add "$WT" "$SHA" >/dev/null 2>&1 || { echo "FAIL: worktree add $SHA"; exit 1; }

# 2. install (bun cache makes this seconds)
( cd "$WT" && bun install --frozen-lockfile >/dev/null 2>&1 ) || { echo "FAIL: bun install"; exit 1; }

# 3. boot the subject
if [ "$MODE" = "service" ]; then
  BOOTENV=(WFX_API_BASE=https://webflix-api.vercel.app)
else
  BOOTENV=(WFX_DEV_FIXTURES=1)
fi
( cd "$WT/apps/web" && env "${BOOTENV[@]}" NODE_OPTIONS=--max-old-space-size=1536 \
    ./node_modules/.bin/next dev -p $PORT > /home/z/.r29c/subject-dev.log 2>&1 \
    & echo $! > /home/z/.r29c/subject-server.pid )
BOOTED=""
for i in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null && BOOTED=1 && break
  sleep 1
done
[ -n "$BOOTED" ] || { echo "FAIL: server did not boot (see /home/z/.r29c/subject-dev.log)"; kill $(cat /home/z/.r29c/subject-server.pid) 2>/dev/null; exit 1; }
echo "SUBJECT BOOTED: $SHA @ $BASE (${i}s, mode=$MODE)"

export AGENT_BROWSER_SESSION="r29c-verify"

# 4. run the instrument
echo "--- r29-probe.ts (the second-order set) ---"
( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-probe.ts "$BASE" "$TAG" 2>&1 | tail -60 )
echo "--- r29-s1probe.ts (B's stage-1 claims: watch second act + honesty gates) ---"
( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-s1probe.ts "$BASE" "${TAG}-s1" 2>&1 | tail -80 )
echo "--- verify.ts (R28 operator checks — regression floor) ---"
( cd "$REPO" && timeout 420 bun evidence/r28-recon/verify.ts "$BASE" "$TAG-r29" 2>&1 | tail -20 )
echo "--- verify-corpus.ts (R28 corpus spec — regression floor) ---"
( cd "$REPO" && timeout 420 bun evidence/r28-recon/verify-corpus.ts "$BASE" "$TAG-r29" 2>&1 | tail -40 )
echo "--- capture.ts (PNG evidence, real clicks) ---"
( cd "$REPO" && timeout 420 bun evidence/r28-recon/capture.ts "$BASE" "$TAG-r29" 2>&1 | tail -40 )

# 5. pixel survey of the home field
echo "--- r29-pixels.py (raised-gray survey) ---"
( cd "$REPO" && python3 evidence/r29-recon/r29-pixels.py "evidence/r29-recon/${TAG}-home-field.png" 2>&1 | tail -8 )

# 6. teardown (next dev spawns a next-server child — kill the tree, then the port)
kill $(cat /home/z/.r29c/subject-server.pid) 2>/dev/null
pkill -f "next dev -p $PORT" 2>/dev/null
pkill -f "next-server.*$WT" 2>/dev/null
sleep 2
curl -s -o /dev/null "$BASE" 2>/dev/null && echo "WARN: port $PORT still serving" || echo "TEARDOWN OK"
echo "ROUND COMPLETE: tag=$TAG sha=$SHA mode=$MODE"
