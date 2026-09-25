#!/usr/bin/env bash
# R30-A REPRO ROUND RUNNER — boots the SUBJECT build on ONE boot mode and runs
# the reload-durability repro probe against it (the r29-round.sh atomic
# doctrine: boot → probe → teardown in ONE invocation).
#
#   subject = the checkout at /home/z/webflix (the branch under test)
#   usage:   bash evidence/r30-web/repro/r30-repro-round.sh <boot-mode> <tag> [phase]
#            boot-mode: fixtures (default) | service (WFX_API_BASE → the
#                       production API, the r29-round.sh precedent; the probe
#                       cleans up)
#            phase:     full (default) | subscribe-leave | fresh-load
#
# The two-boot repro (the production-lambda simulation — the honest split
# evidence): run subscribe-leave (boot A writes + leaves the stored truth),
# then fresh-load (boot B — a FRESH process — reads the pill + sends the
# remove a fresh runtime would send).
set -u
MODE="${1:-fixtures}"
TAG="${2:-repro-${MODE}}"
PHASE="${3:-full}"
REPO=/home/z/webflix
PORT=3101
BASE="http://localhost:${PORT}"

cd "$REPO" || exit 1
mkdir -p /home/z/.r30a

if [ "$MODE" = "service" ]; then
  BOOTENV=(WFX_API_BASE=https://webflix-api.vercel.app)
else
  BOOTENV=(WFX_DEV_FIXTURES=1)
fi

# The persona fixture state starts pristine every boot EXCEPT the fresh-load
# phase (its stored truth is whatever the earlier subscribe-leave round left
# in the persona file — the cross-boot durability subject; deleting it would
# erase the very truth under test). The service store is remote (the rm does
# not touch it — the service two-boot flow relies on the store's own truth).
if [ "$PHASE" != "fresh-load" ]; then
  rm -f "${TMPDIR:-/tmp}/wfx-dev-library-fixtures.json" 2>/dev/null
fi

( cd "$REPO/apps/web" && env "${BOOTENV[@]}" NODE_OPTIONS=--max-old-space-size=1536 \
    ./node_modules/.bin/next dev -p $PORT > /home/z/.r30a/subject-dev.log 2>&1 \
    & echo $! > /home/z/.r30a/subject-server.pid )
BOOTED=""
for i in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null && BOOTED=1 && break
  sleep 1
done
[ -n "$BOOTED" ] || { echo "FAIL: server did not boot (see /home/z/.r30a/subject-dev.log)"; kill $(cat /home/z/.r30a/subject-server.pid) 2>/dev/null; exit 1; }
echo "SUBJECT BOOTED @ $BASE (${i}s, mode=$MODE phase=$PHASE)"

export AGENT_BROWSER_SESSION="r30a-repro-${MODE}-${PHASE}"

echo "--- r30-repro-probe.ts (${MODE}/${PHASE}) ---"
( cd "$REPO" && timeout 420 bun evidence/r30-web/repro/r30-repro-probe.ts "$BASE" "$TAG" "$PHASE" 2>&1 | tail -50 )

kill $(cat /home/z/.r30a/subject-server.pid) 2>/dev/null
pkill -f "next dev -p $PORT" 2>/dev/null
pkill -f "next-server.*$REPO/apps/web" 2>/dev/null
sleep 2
curl -s -o /dev/null "$BASE" 2>/dev/null && echo "WARN: port $PORT still serving" || echo "TEARDOWN OK"
echo "ROUND COMPLETE: tag=$TAG mode=$MODE phase=$PHASE"
