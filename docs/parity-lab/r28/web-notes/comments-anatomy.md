# R28 corpus sheet — COMMENTS ANATOMY (self-measured on live watch page; A's lane ABSENT → CORPUS-PENDING)

Measured on live youtube.com watch page reached via search-result click-through (direct
watch URLs are bot-gated to /sorry; click-through passes), dark theme, 1440×900,
2026-09-24. The comments tree FULLY rendered headless (19 thread rows).

## The section anatomy (measured)

```
ytd-comments#comments
└─ ytd-comments-header-renderer
   ├─ #count            "1,110 Comments"        15px / 700, #f1f1f1
   └─ sort control      "Sort by" + Top / Newest / "Show featured comments"… options
└─ ytd-comment-thread-renderer (×N, progressive)
   ├─ #author-thumbnail   avatar, ~36-40px, round
   ├─ header row          #author-text "@handle" 12px/500 #f1f1f1 (margin-right 4px)
   │                      #published-time-text "1 year ago" 12px #aaaaaa
   ├─ #content-text       14px / 400 / 20px, #f1f1f1
   ├─ action row          Like ("Like this comment along with N other people"),
   │                      Dislike, vote count ("527", 12px #aaaaaa),
   │                      "Reply" 12px / 500
   └─ replies             nested threads (collapsible), then load-more
└─ composer: ytd-comment-simplebox-renderer (avatar + "Add a comment…" box that
   expands into a text field with CANCEL / COMMENT buttons)
```

## The WebFlix implementation decision (operator override, honest transport)

The operator has overridden R27's honest-omission: comments are IN SCOPE, backed by
WebFlix's OWN local transport — per-browser localStorage, honestly labeled
("Local comments — stored in this browser"). NEVER fabricated YouTube social counts:

- The count header shows the REAL local count ("0 Comments" initially — the honest
  empty state, never a seeded number).
- Sort (Top comments / Newest), composer (avatar + box + Comment/Cancel), rows with
  avatar/author/time/text/like+dislike pills/Reply, replies, load-more — the full
  measured anatomy.
- Likes/dislikes on local comments are the local viewer's own state (localStorage),
  honestly rendered.
