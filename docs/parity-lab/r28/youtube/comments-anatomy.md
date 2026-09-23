# Comments anatomy — the R28 sheet (the operator's complaint #3: "there's no comments")

Captured 2026-09-23T23:3xZ from a hydrated live watch page (soft-nav from channel grid, logged-out session) by Worker A (1440×900, light theme). **This surface fully hydrated** — one of the three watch landings succeeded end-to-end for the comments pipeline ("85 Comments", 20 threads). Provenance: **[rendered]** unless tagged. Raw: `raw/watch-light.comments.json`, captures `40/41/42/45`.

## Section header [rendered]
- Count: **"85 Comments"** — `ytd-comments-header-renderer #count`, `Roboto, Arial, sans-serif` **15px / 700**, color `rgb(0,0,0)` light (VLM visual check: ~16–18px bold — DOM is authoritative at 15/700).
- Sort control beside the count (`yt-sort-filter-sub-menu-renderer`) — opens a menu with **"Top" / "Newest"** options (sort menu measured open: items `Top`, `Newest`).
- Header sits below the description block; comments region begins at y≈636 in the 996px primary column.

## Comment row anatomy [rendered] — measured on thread 1 (@Yvkes, "2 days ago")
| Part | Measured value |
| --- | --- |
| Thread row | `ytd-comment-thread-renderer`, **996w × ~82h** at x=16 (full primary-column width) |
| Avatar | **36×36**, circular (host `#author-thumbnail`; rounding on the img) |
| Author | `#author-text` — **@handle format** ("@Yvkes"), **12px / 500**, `#0f0f0f`, lh 18 |
| Time-ago | `.published-time-text` — "2 days ago", **12px / 400**, `#606060`, lh 18 |
| Comment text | `#content-text` — **14px / 400**, lh **20px**, `#0f0f0f` |
| Like button | `like-button-view-model` button — **32×32** icon button, count in `#vote-count-middle` ("56"), count text sits right of the pill pair |
| Dislike button | `dislike-button-view-model` — **32×32**, no count |
| Reply button | "Reply" — **12px / 500**, `#606060` |
| Replies expander | "7 replies" chevron row under the actions (loads reply continuation — gated in this env; reply rows did not hydrate) |
| Creator heart | `ytd-creator-heart-renderer` **present** on thread 1 (VLM-verified visually beside Reply) |
| Pinned badge | component `ytd-pinned-comment-badge-renderer` exists in markup (not on thread 1) |
| Like/dislike pair position | x≈60 (like) / x≈114 (dislike) — i.e. **~48px pitch** pills starting 12px after avatar column |

## The composer [rendered] — logged-out state
- `ytd-comment-simplebox-renderer` at y=636: **avatar 24×24** (signed-out default avatar) + placeholder text **"Add a comment..."** (collapsed row 980×25).
- **Expanding the composer is sign-in-gated**: clicking it logged-out does not open the editor (no `ytd-comment-dialog-renderer`, no textarea mounts) — the honest logged-out behavior. The expanded editor (textarea, emoji button, Cancel/Comment buttons) is account-bound → **CORPUS-PENDING** for full composer anatomy (cite `docs/parity-lab/r28/lead-captures/README.md` @ 0755a38).

## Load-more behavior [rendered + environmental]
- Initial render: **20 threads** of "85 Comments".
- Continuations (infinite scroll + "7 replies" expander) go through the same /next pipeline that the sandbox gate flaked on (threads hydrated; reply continuations did not) — thread pagination itself is [documented] standard continuation loading.

## Visual truth (VLM cross-check on capture 41) [rendered]
- Circular avatars, bold @handle authors, grey time text, regular-weight body, thumb-icon pair with count, "Reply" grey text, creator heart visible, composer = default avatar + "Add a comment...".

## What B must build for parity (the operator's #3)
1. A real comments section under the watch metadata: header "N Comments" 15/700 + sort control (Top / Newest).
2. Rows: 36px circular avatar, @handle 12/500, time-ago 12/400 #606060, body 14/400/20 #0f0f0f, like 32px pill + count, dislike 32px, Reply 12/500 #606060, replies expander with count.
3. Composer: avatar + "Add a comment..." collapsed row; logged-out users cannot expand (gate the editor honestly).
4. Creator heart + pinned badge slots in the row grammar.
