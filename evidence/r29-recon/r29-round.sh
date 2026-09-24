#!/usr/bin/env bash
# R29-C VERIFICATION ROUND RUNNER — the R29 verification loop's engine
# (atomic: the platform reaper kills detached background processes, so a
# round boots the subject, runs the instrument, captures evidence, tears down
# — all inside ONE invocation).
#
#   subject   = the build under test (worktree at /home/z/webflix-b, booted @3101)
#               (B's lane wfx/r29/web, or base main for the baseline)
#   instrument = this lane's harness: evidence/r29-recon/r29-probe.ts + the
#                stage probes (r29-s{1..5}probe.ts) + the R28 harness set
#                (verify.ts / verify-corpus.ts / capture.ts),
#                run from /home/z/webflix (the instrument lives on C's lane)
#
# Usage:
#   bash evidence/r29-recon/r29-round.sh <sha> <tag> [boot-mode] [probe-filter]
#     <sha>          the commit to verify (fetched by the caller or refreshable)
#     <tag>          report tag -> evidence/r29-recon/<tag>.*.json + PNGs
#     [boot-mode]    fixtures (default) | service (WFX_API_BASE -> production API)
#     [probe-filter] optional comma-list limiting probes (r29,s1,s2,s3,s4,s5,
#                    verify,corpus,capture,pixels,conformance); default: all
set -u
SHA="${1:?usage: r29-round.sh <sha> <tag> [boot-mode] [probe-filter]}"
TAG="${2:?usage: r29-round.sh <sha> <tag> [boot-mode] [probe-filter]}"
MODE="${3:-fixtures}"
FILTER="${4:-all}"
REPO=/home/z/webflix
WT=/home/z/webflix-b
PORT=3101
BASE="http://localhost:${PORT}"

want() { case ",${FILTER}," in *,all,*|*,"$1",*) return 0;; *) return 1;; esac; }

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
if want r29; then
  echo "--- r29-probe.ts (the second-order set) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-probe.ts "$BASE" "$TAG" 2>&1 | tail -60 )
fi
if want s1; then
  echo "--- r29-s1probe.ts (B's stage-1 claims: watch second act + honesty gates) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-s1probe.ts "$BASE" "${TAG}-s1" 2>&1 | tail -80 )
fi
if [ -f "$REPO/evidence/r29-recon/r29-s2probe.ts" ] && want s2; then
  echo "--- r29-s2probe.ts (stage-2: search anatomy + chips + filters + URL state) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-s2probe.ts "$BASE" "$TAG" 2>&1 | tail -60 )
fi
if [ -f "$REPO/evidence/r29-recon/r29-s3probe.ts" ] && want s3; then
  echo "--- r29-s3probe.ts (stage-3: gear + signin + meta + theater + miniplayer + keyboard) ---"
  ( cd "$REPO" && timeout 500 bun evidence/r29-recon/r29-s3probe.ts "$BASE" "$TAG" 2>&1 | tail -70 )
fi
if [ -f "$REPO/evidence/r29-recon/r29-s4probe.ts" ] && want s4; then
  echo "--- r29-s4probe.ts (stage-4: rail + promo + badge grammar + shorts shelf) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-s4probe.ts "$BASE" "$TAG" 2>&1 | tail -60 )
fi
if [ -f "$REPO/evidence/r29-recon/r29-s5probe.ts" ] && want s5; then
  echo "--- r29-s5probe.ts (stage-5: the nine --wfx-* tokens + badge alpha) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r29-recon/r29-s5probe.ts "$BASE" "$TAG" "$WT" 2>&1 | tail -50 )
fi
if want verify; then
  echo "--- verify.ts (R28 operator checks — regression floor) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r28-recon/verify.ts "$BASE" "$TAG-r29" 2>&1 | tail -20 )
fi
if want corpus; then
  echo "--- verify-corpus.ts (R28 corpus spec — regression floor) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r28-recon/verify-corpus.ts "$BASE" "$TAG-r29" 2>&1 | tail -40 )
fi
if want capture; then
  echo "--- capture.ts (PNG evidence, real clicks) ---"
  ( cd "$REPO" && timeout 420 bun evidence/r28-recon/capture.ts "$BASE" "$TAG-r29" 2>&1 | tail -40 )
fi
if want conformance; then
  echo "--- parity-conformance (the subject tree's own contract gate) ---"
  ( cd "$WT" && timeout 240 bun test tests/parity-conformance.test.ts 2>&1 | tail -12 )
fi

# 5. pixel survey of the home field
if want pixels; then
  echo "--- r29-pixels.py (raised-gray survey) ---"
  ( cd "$REPO" && python3 evidence/r29-recon/r29-pixels.py "evidence/r29-recon/${TAG}-home-field.png" 2>&1 | tail -8 )
fi

# 6. teardown (next dev spawns a next-server child — kill the tree, then the port)
kill $(cat /home/z/.r29c/subject-server.pid) 2>/dev/null
pkill -f "next dev -p $PORT" 2>/dev/null
pkill -f "next-server.*$WT" 2>/dev/null
sleep 2
curl -s -o /dev/null "$BASE" 2>/dev/null && echo "WARN: port $PORT still serving" || echo "TEARDOWN OK"
echo "ROUND COMPLETE: tag=$TAG sha=$SHA mode=$MODE"
