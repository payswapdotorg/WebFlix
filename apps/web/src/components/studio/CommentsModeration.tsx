"use client";

/**
 * @wfx/app-web — R38-B — THE STUDIO COMMENTS MODERATION (the per-video
 * comment list with hold/review/pin/reply — the survey's row 30
 * "comments management").
 *
 * THE MODERATION LAW (the task packet): "comments management
 * (hold/review/pin/reply) operates on the SAME comments truth the watch
 * surface renders (the R28 honest comments law) — your studio actions
 * are real persisted moderation states, never cosmetic."
 *
 * THE COMPOSITION (each action's real effect, by construction):
 * - The list reads `wfx-comments-v1` — the SAME store the watch
 *   surface renders (studio-comments.ts — never a second store).
 * - REPLY writes a real comment into that store (the watch surface
 *   renders it); sign-in gated exactly like the watch composer (the
 *   corpus law — the signed-out state shows the honest sign-in path,
 *   never a dead editor).
 * - HOLD moves the comment OUT of the store INTO the moderation record
 *   (the watch surface STOPS rendering it — real moderation); the held
 *   thread carries its replies so the review queue can restore all.
 * - APPROVE restores the thread (the watch surface renders it again);
 *   REMOVE deletes it permanently.
 * - PIN persists the pin (one per video); the studio renders the pinned
 *   thread first with the badge. THE HONEST DIVERGENCE: the watch
 *   surface's pinned-badge slot does not read this record at this base
 *   (the R28 file is frozen for this lane) — recorded in
 *   evidence/r38b/DIVERGENCES.md as the merge-time compose.
 *
 * All truths load AFTER MOUNT (the CommentsSection hydration law).
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import type { StudioItemSummary } from "@/host/studio-store/studio-views";
import type { LocalComment } from "@/host/studio-store/studio-comments";
import { readCommentsOf, writeStudioReply } from "@/host/studio-store/studio-comments";
import {
  heldThreadsOf,
  moderationStateOf,
  recordHeldThread,
  dropHeldThread,
  setPinnedComment,
  type HeldCommentThread,
} from "@/host/studio-store/studio-moderation";
import { removeCommentFromStore, restoreCommentToStore } from "@/host/studio-store/studio-comments";
import { Icon } from "@/components/shell/Icon";

/** One comment row's view (the store's record + the moderation state). */
interface ModerationRow {
  readonly comment: LocalComment;
  readonly replies: readonly LocalComment[];
  readonly pinned: boolean;
}

/** The typed outcome line the actions render verbatim. */
type ActionOutcome = { readonly ok: boolean; readonly detail: string } | null;

/** The comments moderation island. */
export function CommentsModeration({
  item,
  signedIn,
  profileName,
}: {
  /** The selected video (the channel's own catalog item). */
  readonly item: StudioItemSummary;
  /** The session's sign-in truth (the reply composer's gate). */
  readonly signedIn: boolean;
  /** The active profile's display name (the reply's @handle source), when signed in. */
  readonly profileName?: string;
}): JSX.Element {
  // The local truths load after mount (the hydration law).
  const [rows, setRows] = useState<readonly ModerationRow[]>([]);
  const [held, setHeld] = useState<readonly HeldCommentThread[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [outcome, setOutcome] = useState<ActionOutcome>(null);
  const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const reload = useCallback((): void => {
    const comments = readCommentsOf(item.itemId);
    const state = moderationStateOf(item.itemId);
    const byParent = new Map<string, LocalComment[]>();
    for (const comment of comments) {
      if (comment.parentId === null) continue;
      const list = byParent.get(comment.parentId) ?? [];
      list.push(comment);
      byParent.set(comment.parentId, list);
    }
    const topLevel = comments.filter((comment) => comment.parentId === null);
    const next: ModerationRow[] = topLevel.map((comment) => ({
      comment,
      replies: byParent.get(comment.id) ?? [],
      pinned: state.pinned === comment.id,
    }));
    // The pinned thread first (the corpus grammar), then the store's own order.
    next.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    setRows(next);
    setHeld(heldThreadsOf(item.itemId));
    setLoaded(true);
  }, [item.itemId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** The reply write (a REAL comment into the ONE store). */
  const reply = useCallback(
    (parentId: string): void => {
      const result = writeStudioReply(item.itemId, parentId, replyBody, profileName);
      if (result.ok) {
        setOutcome({ ok: true, detail: "Reply posted — a real comment in the same store the watch surface renders." });
        setReplyBody("");
        setReplyOpenFor(null);
        reload();
      } else {
        setOutcome({ ok: false, detail: result.problem ?? "the reply was refused" });
      }
    },
    [item.itemId, profileName, reload, replyBody],
  );

  /** The hold write (the comment leaves the rendered truth; the thread is kept restorable). */
  const hold = useCallback(
    (row: ModerationRow): void => {
      const removal = removeCommentFromStore(item.itemId, row.comment.id);
      if (!removal.ok || removal.comment === null) {
        setOutcome({ ok: false, detail: removal.problem ?? "the comment could not be held" });
        return;
      }
      const recorded = recordHeldThread(item.itemId, {
        comment: removal.comment,
        replies: row.replies,
        heldAt: new Date().toISOString(),
      });
      if (!recorded.ok) {
        // Honest rollback: restore the comment — never a half-state.
        const restored = restoreCommentToStore(item.itemId, removal.comment, row.replies);
        setOutcome({
          ok: false,
          detail: restored.ok
            ? "The held record could not be written — the comment was restored unchanged (never a half-state)."
            : (recorded.problem ?? "the hold failed"),
        });
        reload();
        return;
      }
      setOutcome({
        ok: true,
        detail: "Held — the comment is out of the watch surface's rendered truth and waits in the review queue.",
      });
      reload();
    },
    [item.itemId, reload],
  );

  /** The approve write (the thread returns to the rendered truth). */
  const approve = useCallback(
    (thread: HeldCommentThread): void => {
      const restored = restoreCommentToStore(item.itemId, thread.comment, thread.replies);
      if (!restored.ok) {
        setOutcome({ ok: false, detail: restored.problem ?? "the restore was refused" });
        return;
      }
      const dropped = dropHeldThread(item.itemId, thread.comment.id);
      if (!dropped.ok) {
        setOutcome({ ok: false, detail: dropped.problem ?? "the held record could not be cleared" });
      } else {
        setOutcome({ ok: true, detail: "Approved — the comment is back in the watch surface's rendered truth." });
      }
      reload();
    },
    [item.itemId, reload],
  );

  /** The remove write (the held thread is deleted permanently). */
  const remove = useCallback(
    (thread: HeldCommentThread): void => {
      const dropped = dropHeldThread(item.itemId, thread.comment.id);
      setOutcome(
        dropped.ok
          ? { ok: true, detail: "Removed — the held comment is deleted permanently." }
          : { ok: false, detail: dropped.problem ?? "the removal was refused" },
      );
      reload();
    },
    [item.itemId, reload],
  );

  /** The pin write (one per video — a new pin replaces the old). */
  const pin = useCallback(
    (row: ModerationRow): void => {
      const result = setPinnedComment(item.itemId, row.pinned ? null : row.comment.id);
      setOutcome(
        result.ok
          ? {
              ok: true,
              detail: row.pinned
                ? "Unpinned — the studio's pin record is cleared."
                : "Pinned — the studio's own record (rendered here; the watch surface's pin slot binds at merge).",
            }
          : { ok: false, detail: result.problem ?? "the pin was refused" },
      );
      reload();
    },
    [item.itemId, reload],
  );

  const totalComments = useMemo(
    () => rows.reduce((sum, row) => sum + 1 + row.replies.length, 0),
    [rows],
  );

  return (
    <section className="wfx-channel__section" aria-label="Comments management" data-wfx-studio-comments>
      <div data-wfx-studio-comments-video>
        <h2 className="wfx-channel__name" style={{ fontSize: "1.1rem" }}>
          Comments — <span data-wfx-studio-comments-video-title>{item.title}</span>
        </h2>
        <p className="wfx-card__meta" data-wfx-studio-comments-count>
          {totalComments} comment{totalComments === 1 ? "" : "s"} on this device&apos;s record ·{" "}
          {held.length} held for review
        </p>
      </div>

      {/* THE REVIEW QUEUE (the held threads — real moderation states). */}
      {loaded && held.length > 0 ? (
        <div className="wfx-detail__section" data-wfx-studio-held-queue style={{ marginTop: "12px" }}>
          <h2>Held for review</h2>
          {held.map((thread) => (
            <div
              key={thread.comment.id}
              className="wfx-queue__item"
              data-wfx-studio-held-row={thread.comment.id}
              style={{ display: "grid", gap: "6px", padding: "10px 0", borderBottom: "1px solid var(--wfx-border, #ccc)" }}
            >
              <span className="wfx-card__meta">
                <strong>{thread.comment.authorHandle}</strong>
                {" · "}
                {thread.comment.body}
                {thread.replies.length > 0
                  ? ` · ${thread.replies.length} repl${thread.replies.length === 1 ? "y" : "ies"} held with it`
                  : ""}
              </span>
              <span style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="wfx-btn wfx-btn--sm"
                  data-wfx-moderation-approve={thread.comment.id}
                  onClick={() => {
                    approve(thread);
                  }}
                >
                  <Icon name="check" size={14} />
                  Approve
                </button>
                <button
                  type="button"
                  className="wfx-btn wfx-btn--sm"
                  data-wfx-moderation-remove={thread.comment.id}
                  onClick={() => {
                    remove(thread);
                  }}
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* THE COMMENT LIST (the SAME store the watch surface renders). */}
      <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0, marginTop: "12px" }} data-wfx-studio-moderation-rows>
        {loaded && rows.length === 0 ? (
          <p className="wfx-row__reason" data-wfx-studio-comments-empty>
            No comments on this device&apos;s record for this video — comments are WebFlix&apos;s
            own, written on the watch surface and stored locally; none is fabricated.
          </p>
        ) : null}
        {!loaded ? (
          <p className="wfx-row__reason" data-wfx-studio-local-pending>
            Reading this device&apos;s comment record…
          </p>
        ) : null}
        {rows.map((row) => (
          <li
            key={row.comment.id}
            className="wfx-queue__item"
            data-wfx-studio-moderation-row={row.comment.id}
            data-wfx-moderation-pinned={row.pinned ? "true" : "false"}
            style={{ display: "grid", gap: "6px", padding: "10px 0", borderBottom: "1px solid var(--wfx-border, #ccc)" }}
          >
            <span className="wfx-card__meta">
              {row.pinned ? (
                <span className="wfx-chip wfx-chip--active" data-wfx-moderation-pinned-badge>
                  Pinned
                </span>
              ) : null}
              <strong data-wfx-moderation-author>{row.comment.authorHandle}</strong>
              {" · "}
              <span data-wfx-moderation-text>{row.comment.body}</span>
              {row.replies.length > 0 ? ` · ${row.replies.length} repl${row.replies.length === 1 ? "y" : "ies"}` : ""}
            </span>
            {row.replies.map((replyComment) => (
              <span
                key={replyComment.id}
                className="wfx-card__meta"
                data-wfx-moderation-reply={replyComment.id}
                style={{ paddingLeft: "18px" }}
              >
                ↳ <strong>{replyComment.authorHandle}</strong> {replyComment.body}
              </span>
            ))}
            <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="wfx-btn wfx-btn--sm"
                data-wfx-moderation-reply-toggle={row.comment.id}
                onClick={() => {
                  setReplyOpenFor(replyOpenFor === row.comment.id ? null : row.comment.id);
                  setReplyBody("");
                }}
              >
                Reply
              </button>
              <button
                type="button"
                className="wfx-btn wfx-btn--sm"
                data-wfx-moderation-hold={row.comment.id}
                onClick={() => {
                  hold(row);
                }}
              >
                Hold
              </button>
              <button
                type="button"
                className={`wfx-btn wfx-btn--sm${row.pinned ? " wfx-btn--primary" : ""}`}
                data-wfx-moderation-pin={row.comment.id}
                aria-pressed={row.pinned}
                onClick={() => {
                  pin(row);
                }}
              >
                {row.pinned ? "Unpin" : "Pin"}
              </button>
            </span>
            {replyOpenFor === row.comment.id ? (
              signedIn ? (
                <form
                  className="wfx-comments__editor"
                  data-wfx-moderation-reply-form={row.comment.id}
                  style={{ display: "grid", gap: "8px" }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    reply(row.comment.id);
                  }}
                >
                  <textarea
                    className="wfx-comments__input"
                    rows={2}
                    placeholder="Reply as the creator (a real comment in the same store the watch surface renders)"
                    value={replyBody}
                    data-wfx-moderation-reply-input={row.comment.id}
                    onChange={(event) => {
                      setReplyBody(event.currentTarget.value);
                    }}
                  />
                  <div className="wfx-comments__btnrow">
                    <button
                      type="button"
                      className="wfx-comments__cancel"
                      onClick={() => {
                        setReplyOpenFor(null);
                        setReplyBody("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="wfx-comments__submit"
                      disabled={replyBody.trim().length === 0}
                      data-wfx-moderation-reply-submit={row.comment.id}
                    >
                      Reply
                    </button>
                  </div>
                </form>
              ) : (
                <p className="wfx-row__reason" data-wfx-moderation-signin-note>
                  Sign in to reply —{" "}
                  <a href="/settings?section=general" data-wfx-moderation-signin>
                    the session entry is in Settings ▸ General
                  </a>
                  . (Replies are real comments — WebFlix&apos;s own, stored locally.)
                </p>
              )
            ) : null}
          </li>
        ))}
      </ul>

      {/* THE TYPED OUTCOME LINE (rendered verbatim — never a fabricated success). */}
      {outcome !== null ? (
        <p
          className={`wfx-row__reason${outcome.ok ? "" : " wfx-channeleng__note--error"}`}
          role="status"
          data-wfx-moderation-status
          data-wfx-moderation-status-ok={outcome.ok ? "true" : "false"}
        >
          {outcome.detail}
        </p>
      ) : null}

      {/* The honest transport label (the CommentsSection footnote law). */}
      <p className="wfx-row__reason" data-wfx-studio-moderation-footnote>
        Moderation operates on this device&apos;s own comment record (WebFlix&apos;s own comments
        are local): a held comment is hidden from the watch surface on this device; your reply is
        a real comment the watch surface renders; the pin is the studio&apos;s own record (the
        watch surface&apos;s pin slot binds at merge).
      </p>
    </section>
  );
}
