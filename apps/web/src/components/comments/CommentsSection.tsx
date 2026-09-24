"use client";

/**
 * @wfx/app-web — THE COMMENTS SECTION (R28-B, the operator's #3: "there's
 * no comments" — against the corpus sheet
 * docs/parity-lab/r28/youtube/comments-anatomy.md).
 *
 * THE YOUTUBE ANATOMY, HONESTLY BACKED (the corpus's measured values):
 *
 * - the header: "N Comments" (15px / 700) + the sort control (a menu with
 *   Top / Newest — the measured items);
 * - the rows: 36px circular avatar, @handle 12/500, time-ago 12/400
 *   secondary, body 14/400/20, the like button 32px with the count, the
 *   dislike 32px, "Reply" 12/500 secondary, the replies expander with its
 *   count, and the creator-heart + pinned-badge slots in the row grammar;
 * - the composer: the avatar + "Add a comment..." collapsed row —
 *   SIGN-IN GATED exactly as the corpus's logged-out truth (clicking it
 *   signed-out does NOT mount the editor; the honest sign-in path shows);
 *   the signed-in editor is real (textarea + Cancel / Comment);
 * - the pagination: the first 20 threads render, "Show more" continues.
 *
 * THE HONEST TRANSPORT (the frozen law: comments are WEBFLIX'S OWN, never
 * a fabricated social surface): the store is the browser's OWN localStorage
 * (`wfx-comments-v1`, keyed per item) — the comments the user (and this
 * browser's profiles) actually wrote, honestly counted, honestly labeled.
 * No number on this surface is anything but the local record's own truth:
 * the count header counts the local comments; a like shows only the user's
 * own real like; the creator heart never renders (the local author is not
 * the content's creator — the slot exists, unfilled, exactly as the corpus
 * grammar allows); the pinned badge never fabricates a pin.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The comments island's serialized input (server-computed per render). */
export interface CommentsSectionProps {
  /** The canonical item the comments attach to. */
  readonly itemId: string;
  /** The item's title (labels only). */
  readonly title: string;
  /** The session's sign-in truth (the composer gate's input). */
  readonly signedIn: boolean;
  /** The active profile's display name (the @handle's source), when signed in. */
  readonly profileName?: string;
}

/** One locally-stored comment (the honest per-user record). */
interface LocalComment {
  readonly id: string;
  readonly parentId: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly authorHandle: string;
  readonly liked: boolean;
}

/** The store's shape (localStorage `wfx-comments-v1`). */
type CommentStore = Record<string, LocalComment[]>;

const STORE_KEY = "wfx-comments-v1";

/** The honest load (absent storage = the empty truth, never an error). */
function loadStore(): CommentStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as CommentStore;
  } catch {
    return {};
  }
}

/** The honest persist (a failed write stays local to the view). */
function saveStore(store: CommentStore): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private mode / quota: the in-memory truth stays for this view.
  }
}

/** The @handle of the signed-in profile (the corpus's author format). */
function handleOf(profileName: string | undefined): string {
  const base = (profileName ?? "you").trim();
  if (base.length === 0) return "@you";
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
  return `@${normalized.length > 0 ? normalized : "you"}`;
}

/** One local comment's id (timestamp + counter — unique per browser). */
let idCounter = 0;
function newCommentId(): string {
  idCounter += 1;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** The corpus's time-ago text (minute/hour/day precision). */
function timeAgoOf(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** The deterministic avatar tone (the handle's own hash). */
function avatarToneOf(handle: string): string {
  let hash = 0;
  for (let i = 0; i < handle.length; i += 1) {
    hash = (hash * 31 + handle.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 42% 38%)`;
}

/** The visible avatar (36px circular, the handle's monogram). */
function Avatar({ handle, size = 36 }: { readonly handle: string; readonly size?: number }): JSX.Element {
  return (
    <span
      className="wfx-comments__avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: avatarToneOf(handle) }}
      data-wfx-comment-avatar
    >
      {handle.replace("@", "").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One comment row (the corpus grammar) + its replies. */
function CommentRow({
  comment,
  replies,
  onReply,
  onToggleLike,
  depth,
}: {
  readonly comment: LocalComment;
  readonly replies: readonly LocalComment[];
  readonly onReply: (parentId: string, body: string) => void;
  readonly onToggleLike: (id: string) => void;
  readonly depth: number;
}): JSX.Element {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [repliesOpen, setRepliesOpen] = useState(false);
  const sortedReplies = useMemo(
    () => [...replies].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [replies],
  );
  return (
    <article className={depth === 0 ? "wfx-comment" : "wfx-comment wfx-comment--reply"} data-wfx-comment={comment.id} data-wfx-comment-liked={comment.liked ? "true" : "false"}>
      <Avatar handle={comment.authorHandle} size={depth === 0 ? 36 : 24} />
      <div className="wfx-comment__body">
        <p className="wfx-comment__byline">
          <span className="wfx-comment__author" data-wfx-comment-author>
            {comment.authorHandle}
          </span>
          <time className="wfx-comment__time" data-wfx-comment-time>
            {timeAgoOf(comment.createdAt)}
          </time>
          {/* The pinned-badge slot (the corpus grammar; never fabricated). */}
        </p>
        <p className="wfx-comment__text" data-wfx-comment-text>
          {comment.body}
        </p>
        <div className="wfx-comment__actions">
          <button
            type="button"
            className="wfx-comment__pill"
            aria-label={comment.liked ? "Unlike this comment" : "Like this comment"}
            aria-pressed={comment.liked}
            data-wfx-comment-like
            data-wfx-comment-liked={comment.liked ? "true" : "false"}
            onClick={() => {
              onToggleLike(comment.id);
            }}
          >
            <Icon name="like" size={16} />
          </button>
          {comment.liked ? (
            <span className="wfx-comment__likecount" data-wfx-comment-like-count>
              1
            </span>
          ) : null}
          <button
            type="button"
            className="wfx-comment__pill"
            aria-label="Dislike this comment"
            data-wfx-comment-dislike
          >
            <Icon name="dislike" size={16} />
          </button>
          <button
            type="button"
            className="wfx-comment__replybtn"
            data-wfx-comment-reply-toggle
            onClick={() => {
              setReplyOpen((open) => !open);
            }}
          >
            Reply
          </button>
          {/* The creator-heart slot (never fabricated on the local transport). */}
        </div>
        {replyOpen ? (
          <form
            className="wfx-comment__replyform"
            data-wfx-comment-reply-form
            onSubmit={(event) => {
              event.preventDefault();
              const body = replyBody.trim();
              if (body.length === 0) return;
              onReply(comment.id, body);
              setReplyBody("");
              setReplyOpen(false);
              setRepliesOpen(true);
            }}
          >
            <textarea
              className="wfx-comments__input"
              rows={1}
              placeholder="Add a reply..."
              value={replyBody}
              onChange={(event) => {
                setReplyBody(event.currentTarget.value);
              }}
              data-wfx-comment-reply-input
            />
            <div className="wfx-comments__btnrow">
              <button
                type="button"
                className="wfx-comments__cancel"
                onClick={() => {
                  setReplyOpen(false);
                  setReplyBody("");
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="wfx-comments__submit"
                disabled={replyBody.trim().length === 0}
                data-wfx-comment-reply-submit
              >
                Reply
              </button>
            </div>
          </form>
        ) : null}
        {sortedReplies.length > 0 ? (
          repliesOpen ? (
            <div className="wfx-comment__replies">
              {sortedReplies.map((reply) => (
                <CommentRow
                  key={reply.id}
                  comment={reply}
                  replies={[]}
                  onReply={onReply}
                  onToggleLike={onToggleLike}
                  depth={depth + 1}
                />
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="wfx-comment__expander"
              data-wfx-comment-replies-toggle
              onClick={() => {
                setRepliesOpen(true);
              }}
            >
              <Icon name="arrowDown" size={16} />
              {sortedReplies.length} {sortedReplies.length === 1 ? "reply" : "replies"}
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}

/** The comments section (the corpus anatomy over the honest local store). */
export function CommentsSection(props: CommentsSectionProps): JSX.Element {
  // The initial render matches the server (empty) — the local truth loads
  // after mount (never a hydration mismatch, never a fabricated count).
  const [comments, setComments] = useState<readonly LocalComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sort, setSort] = useState<"top" | "newest">("top");
  const [sortOpen, setSortOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBody, setComposerBody] = useState("");
  const [signinNote, setSigninNote] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const store = loadStore();
    setComments(store[props.itemId] ?? []);
    setLoaded(true);
  }, [props.itemId]);

  /** Write the next store state through the honest local transport. */
  const persist = useCallback(
    (next: readonly LocalComment[]): void => {
      setComments(next);
      const store = loadStore();
      store[props.itemId] = [...next];
      saveStore(store);
    },
    [props.itemId],
  );

  const handle = handleOf(props.profileName);

  /** Add one comment (or reply) as the signed-in profile. */
  const addComment = useCallback(
    (parentId: string | null, body: string): void => {
      const next: LocalComment = {
        id: newCommentId(),
        parentId,
        body,
        createdAt: new Date().toISOString(),
        authorHandle: handle,
        liked: false,
      };
      persist([...comments, next]);
    },
    [comments, handle, persist],
  );

  /** Toggle the user's own like (the only like there is — honest). */
  const toggleLike = useCallback(
    (id: string): void => {
      persist(comments.map((c) => (c.id === id ? { ...c, liked: !c.liked } : c)));
    },
    [comments, persist],
  );

  // The thread projection: top-level rows + their replies.
  const threads = useMemo(() => {
    const topLevel = comments.filter((c) => c.parentId === null);
    const byParent = new Map<string, LocalComment[]>();
    for (const c of comments) {
      if (c.parentId === null) continue;
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    const withReplies = topLevel.map((c) => ({ comment: c, replies: byParent.get(c.id) ?? [] }));
    if (sort === "newest") {
      return withReplies.sort(
        (a, b) => Date.parse(b.comment.createdAt) - Date.parse(a.comment.createdAt),
      );
    }
    // "Top": the user's own likes first (the local truth's own order), then recency.
    return withReplies.sort((a, b) => {
      const aLiked = a.replies.length + (a.comment.liked ? 1 : 0);
      const bLiked = b.replies.length + (b.comment.liked ? 1 : 0);
      if (aLiked !== bLiked) return bLiked - aLiked;
      return Date.parse(b.comment.createdAt) - Date.parse(a.comment.createdAt);
    });
  }, [comments, sort]);

  const visible = threads.slice(0, visibleCount);
  const countText = `${comments.length} Comment${comments.length === 1 ? "" : "s"}`;

  return (
    <section className="wfx-comments" data-wfx-comments data-wfx-comments-item={props.itemId} aria-label={`Comments for ${props.title}`}>
      {/* The header: the count (15/700) + the sort control (Top / Newest). */}
      <div className="wfx-comments__header">
        <h2 className="wfx-comments__count" data-wfx-comments-count>
          {countText}
        </h2>
        <details className="wfx-comments__sort" open={sortOpen} onToggle={(event) => {
          setSortOpen((event.currentTarget as HTMLDetailsElement).open);
        }}>
          <summary className="wfx-comments__sortbtn" aria-label="Sort comments" data-wfx-comments-sort>
            <Icon name="menu" size={16} />
            {sort === "top" ? "Top comments" : "Newest first"}
          </summary>
          <div className="wfx-comments__sortmenu">
            <button
              type="button"
              className="wfx-comments__sortitem"
              aria-pressed={sort === "top"}
              data-wfx-comments-sort-option="top"
              onClick={() => {
                setSort("top");
                setSortOpen(false);
              }}
            >
              Top
            </button>
            <button
              type="button"
              className="wfx-comments__sortitem"
              aria-pressed={sort === "newest"}
              data-wfx-comments-sort-option="newest"
              onClick={() => {
                setSort("newest");
                setSortOpen(false);
              }}
            >
              Newest
            </button>
          </div>
        </details>
      </div>
      {/* The composer: avatar + "Add a comment..." — sign-in gated per the
          corpus's logged-out truth (clicking signed-out never mounts the
          editor; the honest sign-in path shows instead). */}
      <div className="wfx-comments__composer" data-wfx-comments-composer data-wfx-signin-gate={props.signedIn ? "open" : "closed"}>
        <Avatar handle={props.signedIn ? handle : "@you"} size={24} />
        {props.signedIn && composerOpen ? (
          <form
            className="wfx-comments__editor"
            data-wfx-comments-editor
            onSubmit={(event) => {
              event.preventDefault();
              const body = composerBody.trim();
              if (body.length === 0) return;
              addComment(null, body);
              setComposerBody("");
              setComposerOpen(false);
            }}
          >
            <textarea
              ref={composerRef}
              className="wfx-comments__input"
              rows={1}
              placeholder="Add a comment..."
              value={composerBody}
              onChange={(event) => {
                setComposerBody(event.currentTarget.value);
              }}
              data-wfx-comments-input
            />
            <div className="wfx-comments__btnrow">
              <button
                type="button"
                className="wfx-comments__cancel"
                onClick={() => {
                  setComposerOpen(false);
                  setComposerBody("");
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="wfx-comments__submit"
                disabled={composerBody.trim().length === 0}
                data-wfx-comments-submit
              >
                Comment
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="wfx-comments__simplebox"
            data-wfx-comments-simplebox
            onClick={() => {
              if (props.signedIn) {
                setComposerOpen(true);
                setSigninNote(false);
                return;
              }
              // The honest logged-out gate: the editor NEVER mounts; the
              // sign-in path shows (the corpus's measured behavior).
              setSigninNote(true);
            }}
          >
            Add a comment...
          </button>
        )}
        {signinNote && !props.signedIn ? (
          <p className="wfx-comments__gate" data-wfx-comments-signin-note>
            Sign in to comment —{" "}
            <a href="/settings?section=general" data-wfx-comments-signin>
              the session entry is in Settings ▸ General
            </a>
            . (Comments are WebFlix&apos;s own — stored locally on this device.)
          </p>
        ) : null}
      </div>
      {/* The rows (the corpus grammar). */}
      <div className="wfx-comments__list">
        {loaded && comments.length === 0 ? (
          <p className="wfx-comments__empty" data-wfx-comments-empty>
            No comments yet — yours would be the first (stored locally on this device, honestly
            counted).
          </p>
        ) : null}
        {visible.map(({ comment, replies }) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            replies={replies}
            onReply={(parentId, body) => {
              addComment(parentId, body);
            }}
            onToggleLike={toggleLike}
            depth={0}
          />
        ))}
        {threads.length > visibleCount ? (
          <button
            type="button"
            className="wfx-comments__more"
            data-wfx-comments-more
            onClick={() => {
              setVisibleCount((count) => count + 20);
            }}
          >
            Show more
          </button>
        ) : null}
      </div>
      {/* The honest local-transport label (never a fabricated social claim). */}
      <p className="wfx-comments__footnote" data-wfx-comments-footnote>
        Comments are WebFlix&apos;s own — written on this device, stored locally, honestly counted.
      </p>
    </section>
  );
}
