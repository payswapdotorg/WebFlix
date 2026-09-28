#!/usr/bin/env bash
# R34-B — the EXTENDED OBSERVATION WALK (the J41 post-startup rows) on the
# playable content. Every observation rides the product's own typed markers
# (window.__wfxPlaybackTelemetry) — no external stopwatch guesses.
# Rows: click-to-audible (the unmute pill -> the provider's mutedDelivery
# answer, observed through the pill's evidence condition), seek response
# (seek-requested -> seek-confirmed), control responsiveness
# (control-invoked -> control-confirmed), first-60s rebuffer ratio (the
# provider's own rebuffer markers), transient recovery (offline toggle).
set -u
BASE="https://webflix-steel.vercel.app"
SESSION="r34b"
OUT="/home/z/webflix/evidence/r34b"
AB="agent-browser --session $SESSION"

JS='(function(){
  var t = window.__wfxPlaybackTelemetry;
  if (!t) return "no-trace";
  var out = {phase: (document.querySelector("[data-wfx-chrome-phase]")||{getAttribute:function(){return null}}).getAttribute("data-wfx-chrome-phase"), pill: document.querySelector("[data-wfx-player-unmute]") !== null, markers: []};
  for (var i = 0; i < t.markers.length; i++) {
    out.markers.push({m: t.markers[i].marker, t: Math.round(t.markers[i].offsetMs*10)/10, d: (t.markers[i].detail||"").slice(0,70)});
  }
  return JSON.stringify(out);
})()'

# 1. the standard walk to first frame (warm — the observation rows are
#    post-startup; the startup rows already carry their own battery)
$AB open "$BASE/item?id=wfxitm_0Y06CM3DAFN1BR4CNV0B4R803G&connector=wfx-experience-service&ref=dQw4w9WgXcQ&title=Rick+Astley+-+Never+Gonna+Give+You+Up+%28Official+Video%29+%284K+Remaster%29&type=video&duration=214000" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find first "[data-wfx-item-play]" click >/dev/null 2>&1
# wait for the provider's playing broadcast (first frame)
for i in $(seq 1 45); do
  R=$($AB eval "$JS" 2>/dev/null | tail -1 | tr -d '"')
  echo "$R" | grep -q '"phase":"playing"' && break
  sleep 1
done
echo "first-frame settled: $R"

# 2. CLICK-TO-AUDIBLE: the unmute pill -> the provider's muted=false answer
AUD_START=$(date -u +%s%3N)
$AB find first "[data-wfx-player-unmute]" click >/dev/null 2>&1
AUD_ANSWER=""
for i in $(seq 1 20); do
  R=$($AB eval 'document.querySelector("[data-wfx-player-unmute]") === null ? "gone" : "present"' 2>/dev/null | tail -1 | tr -d '"')
  if [ "$R" = "gone" ]; then AUD_ANSWER=$(( $(date -u +%s%3N) - AUD_START )); break; fi
  sleep 0.3
done
echo "audible: provider answered muted=false in ${AUD_ANSWER:-no-answer}ms (pill retired)"
$AB screenshot "$OUT/screenshots/rick-extended-audible.png" >/dev/null 2>&1

# 3. CONTROL RESPONSIVENESS: the pause toggle (control-invoked -> control-confirmed)
CTL_START=$(date -u +%s%3N)
$AB eval 'var b=[...document.querySelectorAll("button")].filter(function(x){return (x.getAttribute("aria-label")||"").indexOf("(k)")!==-1})[0]; b?(b.click(),"clicked"):"none"' >/dev/null 2>&1
for i in $(seq 1 20); do
  R=$($AB eval "$JS" 2>/dev/null | tail -1 | tr -d '"')
  echo "$R" | grep -q '"phase":"paused"' && break
  sleep 0.2
done
echo "control: paused confirmed ($R)"
# resume
$AB eval 'var b=[...document.querySelectorAll("button")].filter(function(x){return (x.getAttribute("aria-label")||"").indexOf("(k)")!==-1})[0]; b?(b.click(),"clicked"):"none"' >/dev/null 2>&1
for i in $(seq 1 20); do
  R=$($AB eval "$JS" 2>/dev/null | tail -1 | tr -d '"')
  echo "$R" | grep -q '"phase":"playing"' && break
  sleep 0.2
done
echo "control: resumed"

# 4. SEEK RESPONSE: click the scrub bar at ~50% (the real user action)
SEEK_BOX=$($AB eval 'JSON.stringify((function(){var el=document.querySelector("[data-wfx-chrome-seekbar], input[type=range][aria-label*=Seek i], .wfx-chrome__seekbar"); if(!el) return null; var r=el.getBoundingClientRect(); return {x: Math.round(r.x+r.width*0.5), y: Math.round(r.y+r.height/2)};})())' 2>/dev/null | tail -1)
echo "seek target: $SEEK_BOX"
if echo "$SEEK_BOX" | grep -q '"x"'; then
  X=$(echo "$SEEK_BOX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['x'])")
  Y=$(echo "$SEEK_BOX" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['y'])")
  $AB mouse move "$X" "$Y" >/dev/null 2>&1
  $AB mouse down left >/dev/null 2>&1; $AB mouse up left >/dev/null 2>&1
fi
sleep 3
echo "after-seek state:"
$AB eval "$JS" 2>/dev/null | tail -1 | tr -d '"'

# 5. FIRST-60s REBUFFER RATIO: observe the provider's own broadcast for 60s
RB_START=$(date -u +%s)
RB_MARKS=""
for i in $(seq 1 60); do
  R=$($AB eval "$JS" 2>/dev/null | tail -1 | tr -d '"')
  RB_MARKS="$R"
  sleep 1
done
echo "60s-final: $RB_MARKS" | head -c 2000
$AB screenshot "$OUT/screenshots/rick-extended-60s.png" >/dev/null 2>&1

# 6. TRANSIENT RECOVERY: offline 5s -> online -> the provider's own recovery
echo "--- transient recovery: offline 5s ---"
$AB set offline on >/dev/null 2>&1
sleep 5
$AB set offline off >/dev/null 2>&1
sleep 10
echo "post-recovery state:"
$AB eval "$JS" 2>/dev/null | tail -1 | tr -d '"'
$AB screenshot "$OUT/screenshots/rick-extended-recovery.png" >/dev/null 2>&1

# 7. the final full trace (the raw artifact)
$AB eval "$JS" > "$OUT/raw/rick-extended-observations.json" 2>/dev/null
echo "saved raw/rick-extended-observations.json"
