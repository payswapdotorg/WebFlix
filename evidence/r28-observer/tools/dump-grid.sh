#!/usr/bin/env bash
# R28-A observer tooling — rich grid card anatomy (home-family cards).
# Runs on any page with ytd-rich-grid-renderer (channel /videos when home feed
# is served the empty variant). Usage: dump-grid.sh <surface-name>
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
SURF="${1:?surface required}"

JS=$(cat <<'EOF'
(function(){
  var cs=function(sel,props,scope){var el=(scope||document).querySelector(sel); if(!el) return null; var o={_sel:sel}; var g=getComputedStyle(el); props.forEach(function(p){o[p]=g.getPropertyValue(p)}); return o};
  var grid=document.querySelector("ytd-rich-grid-renderer");
  if(!grid) return JSON.stringify({error:"no-grid"});
  var items=[].slice.call(document.querySelectorAll("ytd-rich-grid-renderer ytd-rich-item-renderer"));
  var cards=items.map(function(i){return i.querySelector("ytd-rich-grid-media")||i}).filter(Boolean);
  var card0=cards[0], card1=cards[1], card2=cards[2];
  var rect=function(el){var r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  var FONT=["font-family","font-size","font-weight","line-height","color"];
  // grid metrics from first row rects
  var row1=cards.slice(0,4).map(rect);
  var sameRow=row1.filter(function(r){return Math.abs(r.y-row1[0].y)<40});
  var cols=sameRow.length;
  var gapW=sameRow.length>1?sameRow[1].x-(sameRow[0].x+sameRow[0].w):null;
  var g0=getComputedStyle(grid);
  var out={
    _meta:{path:location.pathname, capturedAt:new Date().toISOString(), items:items.length},
    grid:{colsAt1440:cols, cardW:sameRow[0]?sameRow[0].w:null, cardH:sameRow[0]?sameRow[0].h:null, gapX:gapW, rowGapY:row1[1]?row1[1].y-(sameRow[sameRow.length-1].y+sameRow[sameRow.length-1].h):null, gridVars:{cols:g0.getPropertyValue("--ytd-rich-grid-items-per-row"), gutters:g0.getPropertyValue("--ytd-rich-grid-gutter")}, gridMargin:g0.marginLeft},
    card:{
      box:card0?rect(card0):null,
      thumbnail:cs("ytd-rich-grid-media ytd-thumbnail a#thumbnail, ytd-rich-item-renderer ytd-thumbnail a#thumbnail",["border-radius","background-color"]),
      thumbImgRadius:(function(){var im=card0&&card0.querySelector("ytd-thumbnail img"); return im?getComputedStyle(im).borderRadius:null})(),
      durationPill:(function(){var p=card0&&card0.querySelector("ytd-thumbnail-overlay-time-status-renderer, .badge-shape-wiz--thumbnail-default"); if(!p) return null; var g=getComputedStyle(p); return {text:(p.textContent||"").trim(), bg:g.backgroundColor,color:g.color,fontSize:g.fontSize,fontWeight:g.fontWeight,radius:g.borderRadius,padding:g.padding,box:rect(p)}})(),
      title:cs("ytd-rich-grid-media h3 a#video-title, ytd-rich-item-renderer #video-title",FONT),
      titleClamp:(function(){var t=card0&&card0.querySelector("#video-title"); if(!t) return null; var g=getComputedStyle(t); return {lineClamp:g.webkitLineClamp, display:g.display, maxHeight:g.maxHeight, lines:Math.round(t.getBoundingClientRect().height/parseFloat(g.lineHeight||"16"))}})(),
      titleText:(card0&&card0.querySelector("#video-title")||{textContent:""}).textContent.trim().slice(0,50),
      channelRow:{
        avatar:(function(){var a=card0&&card0.querySelector("yt-avatar, #avatar-link"); return a?{box:rect(a), radius:getComputedStyle(a).borderRadius}:null})(),
        name:cs("ytd-rich-grid-media h3.ytd-rich-grid-media a:not(#video-title), ytd-rich-grid-media #avatar-text",FONT),
        nameText:((card0&&card0.querySelector("#avatar-text"))||{textContent:""}).textContent.trim(),
        verified:!!(card0&&card0.querySelector(".badge-style-style-verified, ytd-badge-supported-renderer .yt-spec-icon-shape"))
      },
      metaLine:cs("ytd-rich-grid-media #metadata-line, ytd-rich-item-renderer #metadata-line",["font-family","font-size","font-weight","color","line-height"]),
      metaSpans:card0?[].map.call(card0.querySelectorAll("#metadata-line span"),function(s){return s.textContent.trim()}):[],
      progressWatched:(function(){var p=card0&&card0.querySelector("#progress, ytd-thumbnail-overlay-resume-playback-renderer"); if(!p) return null; var g=getComputedStyle(p); return {w:Math.round(p.getBoundingClientRect().width), bg:g.backgroundColor, h:g.height}})(),
      hoverOverlay:(function(){var o=card0&&card0.querySelector("ytd-thumbnail-overlay-toggle-button-renderer, #hover-overlays"); return o?{present:true,visible:getComputedStyle(o).opacity!=="0"}:{present:false}})(),
      menuBtn:!!(card0&&card0.querySelector("yt-button-shape button[aria-label*=More], #button-shape-button"))
    },
    firstCards:cards.slice(0,3).map(function(c){return {title:((c.querySelector("#video-title")||{textContent:""})).textContent.trim().slice(0,40), meta:[].map.call(c.querySelectorAll("#metadata-line span"),function(s){return s.textContent.trim()})}})
  };
  return JSON.stringify(out);
})()
EOF
)
agent-browser --session "$SESS" eval "$JS" > "$OUT/$SURF.grid.json" 2>&1
echo "grid dump → $OUT/$SURF.grid.json ($(wc -c < "$OUT/$SURF.grid.json") bytes)"
agent-browser --session "$SESS" screenshot "$OUT/../captures/$SURF.grid.png" 2>&1 | tail -1
