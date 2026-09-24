#!/usr/bin/env bash
# R28-A observer tooling — search results page dump.
# Usage: dump-search.sh <surface-name> → writes raw/<surface>.search.json
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
SURF="${1:?surface name required}"
mkdir -p "$OUT"

JS=$(cat <<'EOF'
(function(){
  var cs = function(sel, props, scope){ var el=(scope||document).querySelector(sel); if(!el) return null; var o={_sel:sel}; var g=getComputedStyle(el); props.forEach(function(p){ o[p]=g.getPropertyValue(p)}); return o; };
  var rect = function(sel, scope){ var el=(scope||document).querySelector(sel); if(!el) return null; var r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} };
  var FONT = ["font-family","font-size","font-weight","line-height","letter-spacing","color"];
  var first = document.querySelector("ytd-video-renderer");
  var vod = (function(){ var rs=[].slice.call(document.querySelectorAll("ytd-video-renderer")).filter(function(r){ return /ago/i.test(r.textContent) }); return rs[0]||null })();
  var out = {
    query: (document.querySelector("input#search")||{}).value,
    resultsCount: document.querySelectorAll("ytd-video-renderer").length,
    chipsBar: {
      el: cs("ytd-search-sub-menu-renderer yt-chip-cloud-chip-renderer", ["background-color","color","border-radius","height","font-family","font-size","font-weight"]),
      all: [].slice.call(document.querySelectorAll("ytd-search-sub-menu-renderer yt-chip-cloud-chip-renderer")).map(function(c){ var g=getComputedStyle(c); return {text:c.textContent.trim().slice(0,24), selected: c.hasAttribute("selected"), bg:g.backgroundColor, color:g.color} })
    },
    filtersBtn: cs("ytd-search-sub-menu-renderer #filter-button, #filter button", ["height","font-family","font-size","font-weight","color","background-color","border-radius"]),
    result: first ? {
      rowBox: rect("ytd-video-renderer"),
      thumbnail: (function(){ var o=cs("ytd-video-renderer ytd-thumbnail a#thumbnail", ["border-radius","background-color"]); o.rect=rect("ytd-video-renderer ytd-thumbnail a#thumbnail"); var img=first.querySelector("ytd-thumbnail img"); if(img){ var ig=getComputedStyle(img); o.imgRadius=ig.borderRadius; o.imgObjFit=ig.objectFit } return o })(),
      thumbImg: (function(){ var i=first.querySelector("img"); return i? {w:i.naturalWidth||Math.round(i.getBoundingClientRect().width), h:i.naturalHeight||Math.round(i.getBoundingClientRect().height)} : null })(),
      durationPill: (function(){ var row=vod||first; var p=row.querySelector("ytd-thumbnail-overlay-time-status-renderer, .badge-shape-wiz--thumbnail-default, ytd-thumbnail-overlay-time-status-renderer .badge-shape-wiz"); if(!p) return null; var g=getComputedStyle(p); var pr=p.getBoundingClientRect(); return {text:(p.textContent||"").trim(), bg:g.backgroundColor, color:g.color, fontSize:g.fontSize, fontWeight:g.fontWeight, fontFamily:g.fontFamily, radius:g.borderRadius, padding:g.padding, w:Math.round(pr.width), h:Math.round(pr.height), onRow:vod?"non-live-row":"first-row"} })(),
      liveBadge: (function(){ var b=first.querySelector(".badge-shape-wiz--thumbnail-live, ytd-thumbnail .badge-shape-wiz"); if(!b) return null; var g=getComputedStyle(b); return {text:(b.textContent||"").trim(), bg:g.backgroundColor, color:g.color, fontSize:g.fontSize, radius:g.borderRadius, padding:g.padding} })(),
      title: cs("ytd-video-renderer a#video-title, ytd-video-renderer #video-title", FONT),
      titleClamp: (function(){ var t=first.querySelector("#video-title"); var g=getComputedStyle(t); return {display:g.display, lineClamp:g.webkitLineClamp||g.getPropertyValue("-webkit-line-clamp"), maxHeight:g.maxHeight, lines:Math.round(t.getBoundingClientRect().height/parseFloat(g.lineHeight))} })(),
      titleText: (first.querySelector("#video-title")||{textContent:""}).textContent.trim().slice(0,70),
      metaLine: cs("ytd-video-renderer #metadata-line", ["font-family","font-size","font-weight","color","line-height"]),
      metaSpans: [].slice.call(first.querySelectorAll("#metadata-line span")).map(function(s){ return s.textContent.trim() }),
      channelRow: {
        avatar: (function(){ var a=first.querySelector("yt-avatar img, #channel-info img, ytd-channel-name img"); var av=first.querySelector("yt-avatar, #avatar-link"); var el=av||a; if(!el) return null; var g=getComputedStyle(el); var r=el.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),radius:g.borderRadius} })(),
        name: cs("ytd-video-renderer ytd-channel-name a, ytd-video-renderer ytd-channel-name", ["font-family","font-size","font-weight","color"]),
        nameText: (first.querySelector("ytd-channel-name a")||{textContent:""}).textContent.trim(),
        verified: !!first.querySelector("ytd-channel-name .badge-style-style-verified, ytd-channel-name svg[aria-label*=Verified]")
      },
      descriptionSnippet: (function(){ var d=first.querySelector(".metadata-snippet-container, .yt-content-metadata-view-model__metadata-row"); if(!d) return null; var g=getComputedStyle(d); return {text:d.textContent.trim().slice(0,80), fontSize:g.fontSize, color:g.color, fontFamily:g.fontFamily, lineHeight:g.lineHeight, lineClamp:g.webkitLineClamp} })(),
      badgeRow: [].slice.call(first.querySelectorAll(".badge-shape-wiz__text, ytd-badge-supported-renderer")).map(function(b){ return b.textContent.trim() }).filter(Boolean).slice(0,4),
      moreMenu: !!first.querySelector("ytd-menu-renderer, #button-shape-button, yt-button-shape button[aria-label*=more i]")
    } : null,
    secondResults: [].slice.call(document.querySelectorAll("ytd-video-renderer"),0,4).map(function(r){ return {title:(r.querySelector("#video-title")||{textContent:""}).textContent.trim().slice(0,50), meta:[].map.call(r.querySelectorAll("#metadata-line span"),function(s){return s.textContent.trim()}), badge:[].map.call(r.querySelectorAll(".badge-shape-wiz__text"),function(b){return b.textContent.trim()}).slice(0,2)} })
  };
  return JSON.stringify(out);
})()
EOF
)
agent-browser --session "$SESS" eval "$JS" > "$OUT/$SURF.search.json" 2>&1
echo "search dump → $OUT/$SURF.search.json ($(wc -c < "$OUT/$SURF.search.json") bytes)"
