#!/usr/bin/env bash
# R28-C EVIDENCE HOOK — sourced by verify-round.sh while the subject is up.
# Env: BASE (subject origin), TAG (round tag). Produces the canonical evidence
# set: evidence/r28-recon/verifications/<tag>-<feature>.png + stdout eval data.
# Every operator complaint gets a screenshot + a measured eval.

OUTD="evidence/r28-recon/verifications"
mkdir -p "$OUTD"
AB() { agent-browser "$@" 2>/dev/null; }
EV() { agent-browser eval "$1" 2>/dev/null; }

echo "== HOOK: home first screen =="
AB open "$BASE/"
AB wait --load networkidle
sleep 1
AB screenshot "$OUTD/${TAG}-home.png"
EV "JSON.stringify({path: location.pathname, title: document.title, bg: getComputedStyle(document.body).backgroundColor, htmlClass: document.documentElement.className.slice(0,60), themeAttr: document.documentElement.getAttribute('dark') !== null || document.documentElement.getAttribute('data-theme') || null})"
echo ""

echo "== HOOK: fonts (O5) =="
EV "JSON.stringify({loaded: Array.from(document.fonts).map(f=>f.family+' '+f.weight+' '+f.status), roboto16: document.fonts.check('16px Roboto'), roboto500: document.fonts.check('500 16px Roboto'), h1font: (()=>{const e=document.querySelector('h1,[class*=title]'); return e?getComputedStyle(e).fontFamily.slice(0,50):null})()})"
echo ""

echo "== HOOK: hover preview (O1) — corpus dwell ~150ms =="
HOVERPOS=$(EV "JSON.stringify((()=>{const c=[...document.querySelectorAll('main a.wfx-card, main a[href*=\"/item\"], main a[href*=\"/watch\"], main [data-wfx-card], main [class*=card]')].find(el=>{const b=el.getBoundingClientRect();return b.width>100&&b.y>0&&b.y<700});if(!c)return null;const b=c.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})())" | tr -d '"')
echo "hover target: $HOVERPOS"
if [ -n "$HOVERPOS" ] && [ "$HOVERPOS" != "null" ]; then
  HX=$(echo "$HOVERPOS" | python3 -c "import json,sys; d=json.load(sys.stdin.replace and open('/dev/stdin') or sys.stdin); print(d['x'])" 2>/dev/null || echo "")
  # robust parse (agent-browser may wrap output)
  HX=$(echo "$HOVERPOS" | sed -E 's/[^0-9x.,-]//g' | cut -d, -f1 | tr -d 'x.:')
  HY=$(echo "$HOVERPOS" | sed -E 's/[^0-9x.,-]//g' | cut -d, -f2 | tr -d 'x.:')
  if [ -n "$HX" ] && [ -n "$HY" ]; then
    AB mouse move "$HX" "$HY"
    sleep 0.4
    EV "JSON.stringify({t:'250ms', videos: document.querySelectorAll('video').length, previews: [...document.querySelectorAll('[class*=preview],[class*=cardpreview],ytd-video-preview')].map(e=>({cls:e.className.toString().slice(0,40),ch:e.children.length,box:(()=>{const b=e.getBoundingClientRect();return Math.round(b.width)+'x'+Math.round(b.height)})()})), cardTransform: getComputedStyle(document.elementFromPoint($HX,$HY).closest('a,article,div[class*=card]')||document.body).transform})"
    AB screenshot "$OUTD/${TAG}-hover-250ms.png"
    sleep 1.3
    EV "JSON.stringify({t:'1.7s', videos: document.querySelectorAll('video').length, playing: (()=>{const v=document.querySelector('video'); return v?!v.paused:false})(), previews: [...document.querySelectorAll('[class*=preview],[class*=cardpreview],ytd-video-preview')].map(e=>({ch:e.children.length, opacity: getComputedStyle(e).opacity}))})"
    AB screenshot "$OUTD/${TAG}-hover-1.7s.png"
    AB mouse move 10 10
  fi
fi
echo ""

echo "== HOOK: click trace (O2) — one-click law =="
AB open "$BASE/"
AB wait --load networkidle
sleep 1
CARD=$(EV "JSON.stringify((()=>{const c=[...document.querySelectorAll('main a[href*=\"/item\"], main a[href*=\"/watch\"], main a.wfx-card, main [class*=card] a')].find(el=>{const b=el.getBoundingClientRect();return b.width>100&&b.height>60&&b.y>0&&b.y<700});return c?{href:c.getAttribute('href'),x:Math.round(c.getBoundingClientRect().x+c.getBoundingClientRect().width/2),y:Math.round(c.getBoundingClientRect().y+c.getBoundingClientRect().height/2),label:(c.getAttribute('aria-label')||c.textContent||'').slice(0,40)}:null})())" | tr -d '"')
echo "card: $CARD"
CHREF=$(echo "$CARD" | python3 -c "import json,sys;print(json.load(sys.stdin).get('href'))" 2>/dev/null || echo "")
if [ -z "$CHREF" ] || [ "$CHREF" = "null" ]; then CHREF=$(echo "$CARD" | sed -E 's/.*href.:.([^\,"]+).*/\1/' | tr -d '\\'); fi
if [ -n "$CHREF" ] && [ "$CHREF" != "null" ]; then
  AB open "${BASE}${CHREF}"
  AB wait --load networkidle
  sleep 1.5
  S1=$(EV "JSON.stringify({step:1, path: location.pathname+location.search.slice(0,60), hasVideo: !!document.querySelector('video'), playing: (()=>{const v=document.querySelector('video');return v?!v.paused:false})(), hasIframe: !!document.querySelector('iframe')})")
  echo "step1: $S1"
  AB screenshot "$OUTD/${TAG}-click1.png"
  # if not playing, look for a play control (2nd action)
  NEEDS2=$(EV "JSON.stringify((()=>{const v=document.querySelector('video');if(v&&!v.paused)return 'no';const p=[...document.querySelectorAll('a,button,[role=button]')].find(e=>/^(\\s*)(play|watch now)\\b/i.test(e.getAttribute('aria-label')||e.textContent||''));return p?'yes':'none'})())" | tr -d '"')
  if [ "$NEEDS2" = "yes" ]; then
    EV "(()=>{const p=[...document.querySelectorAll('a,button,[role=button]')].find(e=>/^(\\s*)(play|watch now)\\b/i.test(e.getAttribute('aria-label')||e.textContent||''));if(p)p.click();return 'clicked'})()" >/dev/null
    sleep 1.5
    S2=$(EV "JSON.stringify({step:2, path: location.pathname+location.search.slice(0,60), hasVideo: !!document.querySelector('video'), playing: (()=>{const v=document.querySelector('video');return v?!v.paused:false})(), playBtnStill: !![...document.querySelectorAll('button,[role=button]')].find(e=>/\\bplay\\b/i.test(e.getAttribute('aria-label')||e.textContent||'')&&getComputedStyle(e).display!=='none')})")
    echo "step2: $S2"
    AB screenshot "$OUTD/${TAG}-click2.png"
  fi
fi
echo ""

echo "== HOOK: comments (O3) on the landing surface =="
AB scroll down 700
sleep 0.8
EV "JSON.stringify({path: location.pathname, commentEls: document.querySelectorAll('[class*=comment],[id*=comment],[data-wfx-comment]').length, headerText: (()=>{const h=[...document.querySelectorAll('h1,h2,h3')].find(e=>/\\d+\\s+comments?/i.test(e.textContent||''));return h?h.textContent.trim():null})(), threads: document.querySelectorAll('[class*=comment-thread],[class*=comment]:not([class*=composer])').length, composer: !!document.querySelector('[placeholder*=comment i],textarea,[contenteditable]')})"
AB screenshot "$OUTD/${TAG}-comments.png"
echo ""

echo "== HOOK: share (O4) =="
SHARE=$(EV "JSON.stringify(!![...document.querySelectorAll('[data-wfx-share-toggle],[aria-label*=share i],button,a')].find(e=>/share/i.test(e.getAttribute('aria-label')||e.textContent||'')&&e.getBoundingClientRect().width>0))" | tr -d '"')
if [ "$SHARE" = "true" ]; then
  EV "(()=>{const t=document.querySelector('[data-wfx-share-toggle]')||[...document.querySelectorAll('[aria-label*=share i],button,a')].find(e=>/share/i.test(e.getAttribute('aria-label')||e.textContent||'')&&e.getBoundingClientRect().width>0);if(t){t.click();return 'opened'}return 'none'})()" >/dev/null
  sleep 0.9
  EV "JSON.stringify((()=>{const d=document.querySelector('[role=dialog],[class*=modal],[class*=sheet],details[open],[data-wfx-share]');if(!d)return {found:false};const b=d.getBoundingClientRect();const s=getComputedStyle(d);return {found:true,box:Math.round(b.width)+'x'+Math.round(b.height),radius:s.borderRadius,bg:s.backgroundColor,shortLink:/youtu\\.be|\\?si=|\\?t=|start/i.test(d.innerText||''),startAt:/start at/i.test(d.innerText||''),tiles:(d.innerText||'').split('\\n').filter(t=>t.trim()&&t.length<24).slice(0,14)}})())"
  AB screenshot "$OUTD/${TAG}-share.png"
else
  echo "no share control on this surface"
fi
echo ""
echo "== HOOK COMPLETE =="
