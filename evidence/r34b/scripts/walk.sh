#!/usr/bin/env bash
# R34-B — the J41 playback-startup WALK HARNESS (WebFlix side, live production)
#
# THE PROTOCOL (the honest walk — the product's own instrumentation carries
# the per-run artifacts; this script only drives the real user path and
# harvests window.__wfxPlaybackTelemetry / window.__wfxStartupObservations
# verbatim — every number below comes from the product's own typed marker
# trace, never from an external stopwatch guess):
#
#   1. (cold only) destroy the browser context — a true fresh profile
#      (no HTTP cache, no cookies, no provider warm state).
#   2. open the ITEM HUB page (the surface a home card opens — the real
#      user path to the play decision).
#   3. wait for [data-wfx-item-play] — the one-obvious-play-action check
#      (its presence/absence is recorded per walk).
#   4. CLICK it (a real agent-browser click; the product's own
#      PlayIntentRecorder bridges the click epoch onto the player page's
#      trace — play-clicked@0).
#   5. poll the player page's trace for the provider's own "playing"
#      broadcast (first-frame-rendered, detail "the provider's own player
#      reported playing") until TIMEOUT — the honest TTFF evidence point.
#   6. harvest the full trace + states verbatim; screenshot the final state.
#
# Usage: walk.sh <content-key> <cold|warm> <sample-nn> [timeout-seconds]

set -u
BASE="https://webflix-steel.vercel.app"
SESSION="r34b"
OUT="/home/z/webflix/evidence/r34b"
KEY="$1"; CACHE="$2"; N="$3"; TIMEOUT="${4:-60}"

# The content registry — the identity pairs (WebFlix canonical id + the
# provider's own video id), recorded per walk in the harvest.
declare -A ITEM_HREF PROVIDER_REF
ITEM_HREF[rick]="/item?id=wfxitm_0Y06CM3DAFN1BR4CNV0B4R803G&connector=wfx-experience-service&ref=dQw4w9WgXcQ&title=Rick+Astley+-+Never+Gonna+Give+You+Up+%28Official+Video%29+%284K+Remaster%29&type=video&duration=214000"
PROVIDER_REF[rick]="dQw4w9WgXcQ"
ITEM_HREF[zoo]="/item?id=wfxitm_7CB0BV4Q04W1KYTND3XGZ4T3N8&connector=wfx-experience-service&ref=jNQXAC9IVRw&title=Me+at+the+zoo&type=video&duration=19000"
PROVIDER_REF[zoo]="jNQXAC9IVRw"
ITEM_HREF[wettest]="/item?id=wfxitm_0118HYEKS1NTQGRGG0TQZYADQ9&connector=wfx-experience-service&ref=DYFDc0dpc5g&title=Inside+the+Wettest+City+on+the+Planet+%28Rains+Every+Day%29&type=video&duration=2886000"
PROVIDER_REF[wettest]="DYFDc0dpc5g"
ITEM_HREF[ed]="/item?id=wfxitm_687ECHX8K20JPFY8DBZ93J0782&connector=wfx-experience-service&ref=2Vv-BfVoq4g&title=Ed+Sheeran+-+Perfect+%28Official+Music+Video%29&type=video&duration=282000"
PROVIDER_REF[ed]="2Vv-BfVoq4g"
ITEM_HREF[rainbombs]="/item?id=wfxitm_68AGMM1CXYR48TF6B05QY9ZMRR&connector=wfx-experience-service&ref=oH_pVgW5fEw&title=Rain+Bombs+%7C+Full+Documentary+%7C+NOVA+%7C+PBS&type=video&duration=3234000"
PROVIDER_REF[rainbombs]="oH_pVgW5fEw"

AB="agent-browser --session $SESSION"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. cold = a destroyed context (true fresh profile)
if [ "$CACHE" = "cold" ]; then
  $AB close >/dev/null 2>&1
  sleep 1
fi

# 2. the item hub (the surface a home card opens)
$AB set viewport 1440 900 >/dev/null 2>&1
$AB open "$BASE${ITEM_HREF[$KEY]}" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1

# 3. the one-obvious-play-action check
PLAY_PRESENT=$($AB eval 'document.querySelector("[data-wfx-item-play]") !== null ? "yes" : "no"' 2>/dev/null | tail -1 | tr -d '"')

if [ "$PLAY_PRESENT" != "yes" ]; then
  # the honest no-play-action record (never fabricated)
  $AB screenshot "$OUT/screenshots/$KEY-$CACHE-$N-no-play-action.png" >/dev/null 2>&1
  printf '{"content":"%s","cache":"%s","sample":"%s","outcome":"no-play-action","playActionPresent":false,"stamp":"%s"}\n' \
    "$KEY" "$CACHE" "$N" "$STAMP" > "$OUT/raw/$KEY-$CACHE-$N.json"
  echo "$KEY $CACHE $N: NO-PLAY-ACTION"
  exit 0
fi

# 4. the real click (the PlayIntentRecorder bridges the epoch)
CLICK_WALL=$(date -u +%s%3N)
$AB find first "[data-wfx-item-play]" click >/dev/null 2>&1

# 5. poll the player page's trace for the provider's playing broadcast
JS_POLL='(function(){
  var t = window.__wfxPlaybackTelemetry;
  if (!t) return "no-trace";
  var ff = null;
  for (var i = 0; i < t.markers.length; i++) {
    var m = t.markers[i];
    if (m.marker === "first-frame-rendered" && typeof m.detail === "string" && m.detail.indexOf("own player reported playing") !== -1) { ff = m; }
  }
  return ff === null ? "waiting" : "playing:" + ff.offsetMs;
})()'

OUTCOME="timeout"
FF=""
for i in $(seq 1 "$TIMEOUT"); do
  R=$($AB eval "$JS_POLL" 2>/dev/null | tail -1 | tr -d '"')
  case "$R" in
    playing:*) OUTCOME="first-frame"; FF="${R#playing:}"; break ;;
    waiting|no-trace) sleep 1 ;;
    *) sleep 1 ;;
  esac
done

# 6. the verbatim harvest (one eval — the product's own trace + states)
JS_HARVEST='(function(){
  var t = window.__wfxPlaybackTelemetry || null;
  var o = window.__wfxStartupObservations || null;
  return JSON.stringify({
    trace: t,
    startupObservations: o,
    playerState: (document.querySelector("[data-wfx-player-state]")||{}).getAttribute ? document.querySelector("[data-wfx-player-state]").getAttribute("data-wfx-player-state") : null,
    chromePhase: (document.querySelector("[data-wfx-chrome-phase]")||{}).getAttribute ? document.querySelector("[data-wfx-chrome-phase]").getAttribute("data-wfx-chrome-phase") : null,
    embedControl: (document.querySelector("[data-wfx-embed-control]")||{}).getAttribute ? document.querySelector("[data-wfx-embed-control]").getAttribute("data-wfx-embed-control") : null,
    embedContainment: (document.querySelector("[data-wfx-embed-containment]")||{}).getAttribute ? document.querySelector("[data-wfx-embed-containment]").getAttribute("data-wfx-embed-containment") : null,
    unmutePillPresent: document.querySelector("[data-wfx-player-unmute]") !== null,
    url: location.href
  });
})()'

HARVEST=$($AB eval "$JS_HARVEST" 2>/dev/null | tail -1)
$AB screenshot "$OUT/screenshots/$KEY-$CACHE-$N.png" >/dev/null 2>&1

# compose the walk record
printf '{"content":"%s","cache":"%s","sample":"%s","outcome":"%s","playActionPresent":true,"clickWallEpochMs":%s,"firstFrameOffsetMs":%s,"providerRef":"%s","itemHref":"%s","stamp":"%s","harvest":%s}\n' \
  "$KEY" "$CACHE" "$N" "$OUTCOME" "$CLICK_WALL" "${FF:-null}" "${PROVIDER_REF[$KEY]}" "${ITEM_HREF[$KEY]}" "$STAMP" "${HARVEST:-null}" \
  > "$OUT/raw/$KEY-$CACHE-$N.json"

echo "$KEY $CACHE $N: $OUTCOME ${FF:+ff=${FF}ms}"
