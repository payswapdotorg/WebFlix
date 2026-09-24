#!/usr/bin/env bash
# R28-C VERIFICATION ROUND RUNNER — the verification loop's engine.
#
# ATOMIC BY NECESSITY: the platform reaper kills every detached background
# process within seconds-to-minutes of the spawning shell exiting (measured
# 2026-09-24: heartbeat + poll loop + dev server all reaped). A round therefore
# boots the subject, runs the instrument, captures evidence, and tears down —
# all inside ONE invocation.
#
#   subject  = Worker B's build (worktree at /home/z/webflix-b, booted @3101)
#   instrument = Worker C's harness (this lane's evidence/r28-recon/verify*.ts,
#                run from /home/z/webflix — the instrument lives on C's lane)
#
# Usage:
#   bun evidence/r28-recon/verify-round.sh <sha> <tag> [evidence-hook.sh]
#     <sha>             B's lane head to verify (fetched from wfx/r28/web)
#     <tag>             report tag -> verifications/<tag>.{report,corpus}.json
#     [evidence-hook]   optional bash file sourced while the server is up
#                       (env: BASE, TAG) — screenshots & feature-specific evals
#
set -u
SHA="${1:?usage: verify-round.sh <sha> <tag> [evidence-hook]}"
TAG="${2:?usage: verify-round.sh <sha> <tag> [evidence-hook]}"
HOOK="${3:-}"
REPO=/home/z/webflix
WT=/home/z/webflix-b
PORT=3101
BASE="http://localhost:${PORT}"

cd "$REPO" || exit 1

# 0. B's lane must be fetched (the caller polls; here we only refresh)
git fetch origin wfx/r28/web --quiet 2>/dev/null

# 1. fresh worktree at B's head
git worktree remove --force "$WT" >/dev/null 2>&1
git worktree prune >/dev/null 2>&1
rm -rf "$WT"
git worktree add "$WT" "$SHA" >/dev/null 2>&1 || { echo "FAIL: worktree add $SHA"; exit 1; }

# 2. install (bun cache makes this seconds)
( cd "$WT" && bun install --frozen-lockfile >/dev/null 2>&1 ) || { echo "FAIL: bun install"; exit 1; }

# 3. boot the subject (fixtures dev boot, same as baseline)
( cd "$WT/apps/web" && WFX_DEV_FIXTURES=1 NODE_OPTIONS=--max-old-space-size=1536 \
    ./node_modules/.bin/next dev -p $PORT > /home/z/.r28c/b-dev.log 2>&1 \
    & echo $! > /home/z/.r28c/b-server.pid )
BOOTED=""
for i in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null && BOOTED=1 && break
  sleep 1
done
[ -n "$BOOTED" ] || { echo "FAIL: server did not boot (see /home/z/.r28c/b-dev.log)"; kill $(cat /home/z/.r28c/b-server.pid) 2>/dev/null; exit 1; }
echo "SUBJECT BOOTED: $SHA @ $BASE (${i}s)"

export AGENT_BROWSER_SESSION="r28c-verify"

# 4. run the instrument (C's lane harnesses — viewport self-calibrated @1440x900)
echo "--- verify.ts (operator complaints) ---"
( cd "$REPO" && timeout 420 bun evidence/r28-recon/verify.ts "$BASE" "$TAG" 2>&1 | tail -30 )
echo "--- verify-corpus.ts (corpus spec) ---"
( cd "$REPO" && timeout 420 bun evidence/r28-recon/verify-corpus.ts "$BASE" "$TAG" 2>&1 | tail -60 )
echo "--- capture.ts (PNG evidence, real clicks) ---"
( cd "$REPO" && timeout 420 bun evidence/r28-recon/capture.ts "$BASE" "$TAG" 2>&1 | tail -80 )

# 6. teardown (next dev spawns a next-server child — kill the tree, then the port)
kill $(cat /home/z/.r28c/b-server.pid) 2>/dev/null
pkill -f "next dev -p $PORT" 2>/dev/null
pkill -f "next-server.*$WT" 2>/dev/null
sleep 2
curl -s -o /dev/null "$BASE" 2>/dev/null && echo "WARN: port $PORT still serving" || echo "TEARDOWN OK"
echo "ROUND COMPLETE: tag=$TAG sha=$SHA"
echo "reports: evidence/r28-recon/verifications/${TAG}.{report,corpus}.json"
