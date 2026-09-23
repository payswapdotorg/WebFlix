#!/usr/bin/env bash
# R28-A observer tooling — core page dump (fonts, palette, masthead, rail).
# Usage: dump-core.sh <surface-name>  → writes raw/<surface>.core.json
# Provenance: every value below is read from the live rendered DOM (agent-browser eval).
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
SURF="${1:?surface name required}"
mkdir -p "$OUT"

JS=$(cat <<'EOF'
(function(){
  var cs = function(sel, props, scope){ var el=(scope||document).querySelector(sel); if(!el) return null; var o={_sel:sel}; var g=getComputedStyle(el); props.forEach(function(p){ o[p]=g.getPropertyValue(p)}); return o; };
  var q = function(s){ return document.querySelector(s) };
  var qa = function(s,n){ return [].slice.call(document.querySelectorAll(s),0,n||5) };
  var FONT = ["font-family","font-size","font-weight","line-height","letter-spacing","color"];
  var out = {
    _meta: {
      url: location.href, path: location.pathname, capturedAt: new Date().toISOString(),
      viewport: innerWidth+"x"+innerHeight, lang: document.documentElement.lang,
      ua: navigator.userAgent, dpr: devicePixelRatio,
      htmlDarkAttr: document.documentElement.hasAttribute("dark")
    },
    documentFonts: Array.from(document.fonts).map(function(f){ return {family:f.family, weight:f.weight, style:f.style, status:f.status} }),
    woff2Loaded: performance.getEntriesByType("resource").filter(function(e){ return /\.woff2?/.test(e.name) }).map(function(e){ return e.name }),
    ytSpecVars: (function(){ var o={}; var g=getComputedStyle(document.documentElement); for(var i=0;i<g.length;i++){ var n=g[i]; if(n.indexOf("--yt-spec")===0) o[n]=g.getPropertyValue(n).trim() } return o })(),
    html: cs("html", ["background-color","color","font-family","font-size"]),
    body: cs("body", ["background-color","color","font-family","font-size","font-weight","line-height","letter-spacing"]),
    app: cs("ytd-app", ["background-color","color"]),
    masthead: {
      el: cs("ytd-masthead", ["height","background-color","border-bottom"]),
      logo: cs("#logo-icon, #logo", ["height","width"]),
      searchBox: cs("#search form, ytd-searchbox form, #search", ["height","background-color","border","border-radius"]),
      searchInput: cs("input#search, ytd-searchbox input", ["height","font-family","font-size","font-weight","color"]),
      searchBtn: cs("#search-icon-legacy, ytd-searchbox button#search-icon-legacy", ["width","height","background-color","border-radius"]),
      micBtn: cs("#voice-search-button, ytd-microphone-renderer", ["width","height","background-color","border-radius"]),
      signInBtn: (function(){ var els=[].slice.call(document.querySelectorAll("ytd-masthead ytd-button-renderer, ytd-masthead .yt-spec-button-shape-next")); for(var i=0;i<els.length;i++){ if(/sign in/i.test(els[i].textContent||"")){ var g=getComputedStyle(els[i].querySelector("a,button")||els[i]); return {text:els[i].textContent.trim().slice(0,20), bg:g.backgroundColor, color:g.color, border:g.border, radius:g.borderRadius, height:g.height, fontFamily:g.fontFamily, fontSize:g.fontSize, fontWeight:g.fontWeight, padding:g.padding} } } return null })(),
      searchBoxProbe: (function(){ var input=document.querySelector("#masthead-container input, ytd-masthead input"); var box=document.querySelector("#masthead-container form, #masthead-container #container"); return {inputFound:!!input, inputId:input?input.id:null, inputPlaceholder:input?input.placeholder:null, boxFound:!!box, boxClass:box?box.className:null} })(),
    },
    rail: {
      drawerWidth: cs("tp-yt-app-drawer#guide", ["width"]),
      item: cs("ytd-guide-section-renderer ytd-guide-entry-renderer", ["height","border-radius","font-family","font-size","font-weight"]),
      itemText: cs("ytd-guide-entry-renderer .yt-formatted-string, ytd-guide-entry-renderer a#endpoint .title", ["font-family","font-size","font-weight","line-height"]),
      itemActive: (function(){ var i=q("ytd-guide-entry-renderer[active]"); if(!i) return null; var g=getComputedStyle(i); return {bg:g.backgroundColor, color:g.color, radius:g.borderRadius} })(),
      firstItems: qa("ytd-guide-entry-renderer", 10).map(function(i){ return (i.textContent||"").trim().replace(/\s+/g," ").slice(0,30) })
    }
  };
  return JSON.stringify(out);
})()
EOF
)
agent-browser --session "$SESS" eval "$JS" > "$OUT/$SURF.core.json" 2>&1
echo "core dump → $OUT/$SURF.core.json ($(wc -c < "$OUT/$SURF.core.json") bytes)"
