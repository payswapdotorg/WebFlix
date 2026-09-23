#!/usr/bin/env bash
# R28-A observer tooling — watch page anatomy battery.
# Run on a hydrated /watch page. Usage: dump-watch.sh <surface-name>
set -u
SESS=yt
OUT="/home/z/webflix/evidence/r28-observer/raw"
SURF="${1:?surface required}"

JS=$(cat <<'EOF'
(function(){
  var cs=function(sel,props,scope){var el=(scope||document).querySelector(sel); if(!el) return null; var o={_sel:sel}; var g=getComputedStyle(el); props.forEach(function(p){o[p]=g.getPropertyValue(p)}); return o};
  var rect=function(el){var r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  var FONT=["font-family","font-size","font-weight","line-height","color"];
  var q=function(s){return document.querySelector(s)};
  var out={
    _meta:{path:location.pathname, url:location.href, capturedAt:new Date().toISOString()},
    layout:{
      primary:rect(q("#primary")), secondary:rect(q("#secondary")),
      columnsGap:(function(){var p=q("#primary"),s=q("#secondary"); return (p&&s)?Math.round(s.getBoundingClientRect().x-p.getBoundingClientRect().right):null})(),
      playerBox:rect(q("#movie_player")), titleY:q("h1.ytd-watch-metadata")?Math.round(q("h1.ytd-watch-metadata").getBoundingClientRect().y):null,
      belowPlayerY:(function(){var m=q("#movie_player"); var t=q("#below"); return (m&&t)?Math.round(t.getBoundingClientRect().y-m.getBoundingClientRect().bottom):null})()
    },
    title:{
      h1:cs("h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata",FONT),
      text:(q("h1.ytd-watch-metadata")||{textContent:""}).textContent.trim().slice(0,80),
      clamp:(function(){var h=q("h1.ytd-watch-metadata"); if(!h) return null; var g=getComputedStyle(h); return {lineClamp:g.webkitLineClamp, maxH:g.maxHeight}})()
    },
    infoRow:{
      views:(q("#info-container #info span, yt-formatted-string#info")||{textContent:""}).textContent.trim().slice(0,60),
      infoStyles:cs("#info-container #info, yt-watch-info-text #info",FONT),
      date:(q("#info-container #info span:last-child, #info span:nth-child(3)")||{textContent:""}).textContent.trim().slice(0,40)
    },
    actions:{
      rowBox:rect(q("#actions #top-level-buttons-computed, #actions")),
      likeBtn:cs("like-button-view-model button, #segmented-like-button button",["background-color","color","border-radius","height","font-family","font-size","font-weight","padding"]),
      likeLabel:((q("like-button-view-model button")||{textContent:""}).textContent||"").trim().slice(0,16),
      dislikeBtn:cs("dislike-button-view-model button, #segmented-dislike-button button",["background-color","color","border-radius","height"]),
      shareBtn:cs("ytd-watch-metadata #button-shape-shape-button, ytd-button-renderer button[aria-label*=Share], yt-button-shape button[aria-label*=Share]",["background-color","color","border-radius","height","font-family","font-size","font-weight","padding"]),
      shareText:((q("ytd-watch-metadata button[aria-label*=Share]")||{textContent:""}).textContent||"").trim().slice(0,16),
      downloadBtn:!!q("ytd-watch-metadata button[aria-label*=Download], yt-button-shape button[aria-label*=Download i]"),
      moreBtn:!!q("ytd-watch-metadata button[aria-label*=more actions i], #actions button[aria-label*=More i]")
    },
    channelRow:{
      avatar:rect(q("#owner yt-avatar, #owner #channel-name a img, #owner .yt-spec-avatar-shape")),
      name:cs("#owner #channel-name #text, ytd-channel-name yt-formatted-string",FONT),
      nameText:(q("#owner #channel-name")||{textContent:""}).textContent.trim().slice(0,40),
      subs:((q("#owner #subscriber-count")||{textContent:""}).textContent||"").trim().slice(0,24),
      subsStyles:cs("#owner #subscriber-count",FONT),
      subscribe:cs("ytd-subscribe-button-renderer button, #subscribe-button yt-button-shape button",["background-color","color","border-radius","height","font-family","font-size","font-weight","padding","text-transform"]),
      subscribeText:((q("#subscribe-button")||{textContent:""}).textContent||"").trim().slice(0,20)
    },
    description:{
      box:rect(q("#description-inline-expander")),
      text:((q("#description-inline-expander #plain-snippet-text, #description-inline-expander")||{textContent:""}).textContent||"").trim().slice(0,120),
      styles:cs("#description-inline-expander",["font-family","font-size","font-weight","color","line-height"]),
      expander:((q("#expand, tp-yt-paper-button#expand, #expand-snapshot")||{textContent:""})||{textContent:""}).textContent,
      expanderStyles:cs("#expand, #expand-snapshot",["font-family","font-size","font-weight","color"])
    },
    comments:{
      headerText:((q("ytd-comments-header-renderer #count")||{textContent:""}).textContent||"").trim().slice(0,30),
      headerStyles:cs("ytd-comments-header-renderer #count",FONT),
      sortBtn:!!q("ytd-comments-header-renderer #sort-by, ytd-comments-header-renderer yt-sort-filter-sub-menu-renderer"),
      countThreads:document.querySelectorAll("ytd-comment-thread-renderer").length,
      firstComment:(function(){
        var c=q("ytd-comment-thread-renderer");
        if(!c) return null;
        var body=c.querySelector("#comment-content, ytd-comment-renderer #body");
        return {
          box:rect(c),
          avatar:rect(c.querySelector("#author-thumbnail, img")),
          author:cs("ytd-comment-renderer #author-text",FONT),
          authorText:(c.querySelector("#author-text")||{textContent:""}).textContent.trim().slice(0,30),
          timeText:(c.querySelector(".published-time-text, #published-time-text a")||{textContent:""}).textContent.trim().slice(0,20),
          timeStyles:cs("ytd-comment-renderer #published-time-text, .published-time-text",["font-size","font-weight","color","font-family"]),
          text:cs("ytd-comment-renderer #content-text",["font-family","font-size","font-weight","line-height","color"]),
          textContent:(c.querySelector("#content-text")||{textContent:""}).textContent.trim().slice(0,100),
          likeBtn:!!c.querySelector("#like-button, like-button-view-model"),
          likeCount:((c.querySelector("#vote-count-middle")||{textContent:""}).textContent||"").trim().slice(0,12),
          dislikeBtn:!!c.querySelector("#dislike-button, dislike-button-view-model"),
          replyBtn:!!c.querySelector("#reply-button-end, #reply-button"),
          repliesExpander:((c.querySelector("#more-replies button, #more-replies")||{textContent:""}).textContent||"").trim().slice(0,40),
          pinned:!!c.querySelector("ytd-pinned-comment-badge-renderer, .pinned-comment-badge")
        };
      })(),
      composer:{
        present:!!q("ytd-comment-simplebox-renderer, #comment-dialog"),
        placeholder:(q("ytd-comment-simplebox-renderer #placeholder-area, ytd-comment-simplebox-renderer")||{textContent:""}).textContent.trim().slice(0,60),
        avatar:rect(q("ytd-comment-simplebox-renderer img, ytd-comment-simplebox-renderer yt-avatar")),
        emojiBtn:!!q("ytd-comment-simplebox-renderer [aria-label*=emoji i]")
      }
    },
    secondary:{
      relatedFirst:rect(q("#secondary ytd-compact-video-renderer, #related ytd-compact-video-renderer")),
      relatedTitle:cs("#secondary ytd-compact-video-renderer #video-title",FONT),
      relatedMeta:cs("#secondary ytd-compact-video-renderer #metadata-line, #secondary ytd-compact-video-renderer .metadata",["font-size","color","font-family"]),
      countRelated:document.querySelectorAll("#secondary ytd-compact-video-renderer").length,
      autoplayToggle:!!q("ytd-compact-autoplay-renderer, #secondary ytd-toggle-button-renderer paper-toggle-button"),
      autoplayRow:(q("ytd-compact-autoplay-renderer")||{textContent:""}).textContent.trim().replace(/\s+/g," ").slice(0,40)
    }
  };
  return JSON.stringify(out);
})()
EOF
)
agent-browser --session "$SESS" eval "$JS" > "$OUT/$SURF.watch.json" 2>&1
echo "watch dump → $OUT/$SURF.watch.json ($(wc -c < "$OUT/$SURF.watch.json") bytes)"
