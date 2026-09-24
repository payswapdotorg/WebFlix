#!/usr/bin/env bash
# R28-A observer tooling — lockup view-model card anatomy (current card markup).
# Usage: dump-lockup.sh <surface-name>
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
SURF="${1:?surface required}"

JS=$(cat <<'EOF'
(function(){
  var cs=function(sel,props,scope){var el=(scope||document).querySelector(sel); if(!el) return null; var o={_sel:sel}; var g=getComputedStyle(el); props.forEach(function(p){o[p]=g.getPropertyValue(p)}); return o};
  var rect=function(el){var r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  var FONT=["font-family","font-size","font-weight","line-height","color","letter-spacing"];
  var item=document.querySelector("ytd-rich-item-renderer");
  if(!item) return JSON.stringify({error:"no-item"});
  var lock=item.querySelector("yt-lockup-view-model");
  var out={
    _meta:{path:location.pathname, capturedAt:new Date().toISOString(), note:"current production card markup = yt-lockup-view-model"},
    lockupBox:lock?rect(lock):null,
    thumbnail:{
      vm:cs("yt-lockup-view-model yt-thumbnail-view-model",["border-radius","width","height"]),
      img:(function(){var i=lock&&lock.querySelector("img"); if(!i) return null; var g=getComputedStyle(i); return {radius:g.borderRadius, objFit:g.objectFit, box:rect(i)}})(),
      badge:(function(){var b=lock&&lock.querySelector("yt-thumbnail-badge-view-model, badge-shape"); if(!b) return null; var g=getComputedStyle(b); return {text:(b.textContent||"").trim(), bg:g.backgroundColor, color:g.color, fontSize:g.fontSize, fontWeight:g.fontWeight, fontFamily:g.fontFamily, radius:g.borderRadius, padding:g.padding, box:rect(b), positionOfParent:(function(){var p=b.parentElement.getBoundingClientRect(); return {rightOffset:Math.round(p.right-b.getBoundingClientRect().right), bottomOffset:Math.round(p.bottom-b.getBoundingClientRect().bottom)}})()}})()
    },
    metadata:{
      h3:cs("yt-lockup-view-model h3",FONT),
      h3Clamp:(function(){var h=lock&&lock.querySelector("h3"); if(!h) return null; var g=getComputedStyle(h); return {lineClamp:g.webkitLineClamp, display:g.display, lines:Math.round(h.getBoundingClientRect().height/parseFloat(g.lineHeight))}})(),
      titleText:(lock&&lock.querySelector("h3")||{textContent:""}).textContent.trim().slice(0,60),
      metaRow:cs("yt-lockup-metadata-view-model .yt-content-metadata-view-model__metadata-row",["font-family","font-size","font-weight","color","line-height"]),
      metaText:[].map.call(lock?lock.querySelectorAll(".yt-content-metadata-view-model__metadata-row *"):[],function(s){return (s.textContent||"").trim()}).filter(Boolean).slice(0,6),
      channelName:(lock&&lock.querySelector("a[href^='/@'], .yt-lockup-metadata-view-model a")||{textContent:""}).textContent.trim().slice(0,40),
      channelRowPresent:!!(lock&&lock.querySelector("yt-avatar, img.yt-spec-avatar-shape"))
    },
    menuBtn:(function(){var b=item.querySelector("button[aria-label]"); var btns=[].slice.call(item.querySelectorAll("button")); var m=btns.filter(function(x){return /more/i.test(x.getAttribute("aria-label")||"")})[0]; return m?{label:m.getAttribute("aria-label"), box:rect(m)}:null})(),
    hoverProbe:(function(){var t=lock&&lock.querySelector("yt-thumbnail-view-model"); if(!t) return null; var g=getComputedStyle(t); return {transition:g.transition.slice(0,100), transformIdle:g.transform}})()
  };
  return JSON.stringify(out);
})()
EOF
)
agent-browser --session "$SESS" eval "$JS" > "$OUT/$SURF.lockup.json" 2>&1
echo "lockup dump → $OUT/$SURF.lockup.json ($(wc -c < "$OUT/$SURF.lockup.json") bytes)"
