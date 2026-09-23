#!/usr/bin/env bash
# R28-A observer tooling — hover preview dwell measurement.
# Moves the mouse to a search result thumbnail, records an in-page timeline of
# what appears (ytd-video-preview / inline video / overlays), samples video state,
# then moves away and records revert timing.
# Usage: hover-measure.sh <nth-result-1-based>
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
IDX="${1:-2}"

# 1. Get target rect + install in-page hover watcher
agent-browser --session "$SESS" eval "
(function(){
  var rows=[].slice.call(document.querySelectorAll('ytd-video-renderer'));
  var row=rows[($IDX)-1];
  if(!row) return 'NO-ROW';
  var thumb=row.querySelector('ytd-thumbnail a#thumbnail')||row.querySelector('ytd-thumbnail');
  var r=thumb.getBoundingClientRect();
  window.__hover={row:($IDX)-1, cx:Math.round(r.x+r.width/2), cy:Math.round(r.y+r.height/2), t0:null, samples:[], events:[]};
  window.__hmo=new MutationObserver(function(ms){
    for(var i=0;i<ms.length;i++){
      var t=ms[i].target, tn=t.tagName||'';
      if(tn==='VIDEO'||tn==='YTD-VIDEO-PREVIEW'||String(t.className||'').indexOf('video-preview')>-1||String(t.id||'').indexOf('preview')>-1){
        window.__hover.events.push([Math.round(performance.now()-window.__hover.t0), tn+'#'+(t.id||'')+'.'+String(t.className).split(' ').slice(0,3).join('.')]);
      }
    }
  });
  window.__hmo.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
  return JSON.stringify({cx:window.__hover.cx, cy:window.__hover.cy, title:(row.querySelector('#video-title')||{textContent:''}).textContent.trim().slice(0,40)});
})()" 2>&1

# 2. Move mouse onto the thumbnail (this is the hover start)
CX=$(agent-browser --session "$SESS" eval "window.__hover.cx" 2>/dev/null | tr -d '"')
CY=$(agent-browser --session "$SESS" eval "window.__hover.cy" 2>/dev/null | tr -d '"')
agent-browser --session "$SESS" eval "window.__hover.t0=performance.now(); window.__hover.titleBefore=getComputedStyle(document.querySelectorAll('ytd-video-renderer')[window.__hover.row].querySelector('#video-title')).color; 't0 set'" 2>&1 >/dev/null
agent-browser --session "$SESS" mouse move "$CX" "$CY" 2>&1

# 3. In-page sampler: 5 seconds, every 100ms
agent-browser --session "$SESS" eval "
new Promise(function(resolve){
  var n=0;
  var iv=setInterval(function(){
    n++;
    var pv=document.querySelector('ytd-video-preview');
    var cardVid=document.querySelectorAll('ytd-video-renderer')[window.__hover.row].querySelector('video');
    var vid=pv?pv.querySelector('video'):cardVid;
    var s={t:Math.round(performance.now()-window.__hover.t0), preview:!!pv, cardVideo:!!cardVid,
      videoState:vid?{muted:vid.muted,paused:vid.paused,ct:+vid.currentTime.toFixed(2),rs:vid.readyState,dur:vid.duration?Math.round(vid.duration):null}:null,
      previewText:(pv?pv.textContent||'':'').trim().slice(0,40)};
    if(n%5===0||s.preview){ window.__hover.samples.push(s) }
    if(n>=50){ clearInterval(iv); resolve('sampled '+window.__hover.samples.length) }
  },100);
})" 2>&1

# 4. State DURING hover (after 5s of dwell)
agent-browser --session "$SESS" eval "
(function(){
  var pv=document.querySelector('ytd-video-preview');
  var row=document.querySelectorAll('ytd-video-renderer')[window.__hover.row];
  var g=pv?getComputedStyle(pv):null;
  return JSON.stringify({
    previewPresent:!!pv,
    previewBox:(function(){if(!pv)return null;var r=pv.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})(),
    previewVideoAttrs:(function(){var v=pv?pv.querySelector('video'):null; if(!v)return null; return {muted:v.muted,autoplay:v.hasAttribute('autoplay'),playsinline:v.hasAttribute('playsinline'),loop:v.hasAttribute('loop'),src:(v.currentSrc||'').slice(0,60),rs:v.readyState,paused:v.paused}})(),
    titleColorAfter:getComputedStyle(row.querySelector('#video-title')).color,
    titleColorBefore:window.__hover.titleBefore,
    events:window.__hover.events.slice(0,20)
  });
})()" 2>&1 | tee "$OUT/hover-search-result$IDX.during.json"

# 5. Move away → revert timing
agent-browser --session "$SESS" eval "window.__hover.tAway=performance.now(); 'moving away'" 2>&1 >/dev/null
agent-browser --session "$SESS" mouse move 10 10 2>&1
agent-browser --session "$SESS" eval "
new Promise(function(resolve){
  var gone=null; var n=0;
  var iv=setInterval(function(){
    n++;
    if(!document.querySelector('ytd-video-preview') && gone===null){ gone=Math.round(performance.now()-window.__hover.tAway) }
    if(n>=30){ clearInterval(iv); resolve(JSON.stringify({previewGoneAfterMs:gone, stillThere:!gone})) }
  },100);
})" 2>&1 | tee "$OUT/hover-search-result$Idx.revert.json"
echo "hover measurement done for result $IDX"
