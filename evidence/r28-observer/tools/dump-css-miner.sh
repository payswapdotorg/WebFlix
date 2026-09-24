#!/usr/bin/env bash
# R28-A observer tooling — mine YouTube's served CSS for --yt-spec-* palette tokens
# and per-component rules. Provenance: [css] — youtube.com's own served stylesheets.
# Usage: dump-css-miner.sh <surface-name>
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
SURF="${1:?surface name required}"
mkdir -p "$OUT"

JS=$(cat <<'EOF'
(function(){
  var spec = {};
  var componentRules = {};
  var wanted = ["ytd-comment-thread-renderer","ytd-comment-renderer","ytd-comments-header-renderer","ytd-watch-metadata","ytd-video-primary-info-renderer","ytd-video-secondary-info-renderer","ytd-subscribe-button-renderer","tp-yt-paper-dialog","ytd-sentiment-bar-renderer","ytd-compact-video-renderer","ytd-rich-grid-media","ytd-rich-item-renderer","yt-chip-cloud-chip-renderer","ytd-guide-entry-renderer","ytd-menu-renderer","ytd-reel-video-renderer","ytd-shorts"];
  var grab = function(rules){
    for(var i=0;i<rules.length;i++){
      var r=rules[i];
      if(r.style){
        // capture any --yt-spec-* declarations
        for(var j=0;j<r.style.length;j++){
          var p=r.style[j];
          if(p.indexOf("--yt-spec")===0){ spec[p]=r.style.getPropertyValue(p).trim(); }
        }
        // capture component rules of interest (font/color/spacing relevant)
        var sel=r.selectorText||"";
        for(var k=0;k<wanted.length;k++){
          if(sel.indexOf(wanted[k])>-1 && sel.indexOf(" ")===-1){ // keep simple selectors
            var key=wanted[k]+" { "+(r.cssText.length>500?r.cssText.slice(0,500)+"…":r.cssText)+" }";
            (componentRules[wanted[k]]=componentRules[wanted[k]]||[]).push(key);
            break;
          }
        }
      } else if(r.cssRules){ try{ grab(r.cssRules) }catch(e){} }
    }
  };
  [].slice.call(document.styleSheets).forEach(function(s){ try{ if(s.cssRules) grab(s.cssRules) }catch(e){} });
  var rootStyles={};
  var g=getComputedStyle(document.documentElement);
  Object.keys(spec).slice(0,400).forEach(function(name){ rootStyles[name]=g.getPropertyValue(name).trim(); });
  return JSON.stringify({
    _meta:{capturedAt:new Date().toISOString(), path:location.pathname, note:"[css] mined from youtube.com served stylesheets + live :root computed values"},
    specDeclaredCount:Object.keys(spec).length,
    specDeclared:spec,
    specLiveComputed:rootStyles,
    componentRulesTruncated:(function(){var o={};Object.keys(componentRules).forEach(function(k){o[k]=componentRules[k].slice(0,3)});return o})()
  });
})()
EOF
)
agent-browser --session "$SESS" eval "$JS" > "$OUT/$SURF.cssmined.json" 2>&1
echo "css mined → $OUT/$SURF.cssmined.json ($(wc -c < "$OUT/$SURF.cssmined.json") bytes)"
