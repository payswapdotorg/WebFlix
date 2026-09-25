"use client";

/**
 * @wfx/app-web — the playback watch-state reporter (WFX-051, client).
 *
 * EXPLICIT, honest engagement reporting: the player surface cannot observe
 * real playback positions inside a provider embed, so it never pretends
 * to. The user's own actions report the truth through the EventSink port
 * (POST /api/events → frozen `EntertainmentEvent`s): "Mark as watched"
 * fires `complete`, and abandoning the item offers the `skip` report.
 * Every report states what it did — no fake progress, no hidden timers.
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** One watch-state report request (the server route validates + composes). */
export interface WatchReportInput {
  readonly itemId: string;
  readonly type: "complete" | "skip";
  readonly playbackSessionId: string;
  readonly positionMs?: number;
}

/** The report controls with honest result states. */
export function WatchStateReporter({
  report,
  resumePositionMs,
  variant = "bar",
}: {
  readonly report: WatchReportInput;
  /** The session's resume position (offered as the reported position). */
  readonly resumePositionMs: number;
  /**
   * R29-B — the kebab menu rows (the watch action row's "More actions"
   * disclosure carries the reports: the same real controls, the menu's
   * own grammar; the corpus action row keeps its clean pill set).
   */
  readonly variant?: "bar" | "menu";
}): JSX.Element {
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const fire = useCallback(
    async (type: "complete" | "skip"): Promise<void> => {
      setStatus("pending");
      setMessage(null);
      try {
        const response = await fetch("/api/events", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itemId: report.itemId,
            type,
            payload: {
              playbackSessionId: report.playbackSessionId,
              positionMs: resumePositionMs,
            },
          }),
        });
        if (!response.ok) {
          setStatus("failed");
          setMessage(
            `The report could not reach the host (${response.status}) — your watch state was NOT updated.`,
          );
          return;
        }
        setStatus("done");
        setMessage(
          type === "complete"
            ? "Marked as watched — it moves out of Continue watching."
            : "Recorded as skipped — resumable from Continue watching.",
        );
      } catch {
        setStatus("failed");
        setMessage("Network failure — your watch state was NOT updated. Try again.");
      }
    },
    [report.itemId, report.playbackSessionId, resumePositionMs],
  );

  if (variant === "menu") {
    return (
      <div className="wfx-kebab__menuwrap" data-wfx-watch-report>
        <button
          type="button"
          className="wfx-kebab__item"
          onClick={() => {
            void fire("complete");
          }}
          disabled={status === "pending" || status === "done"}
          data-wfx-report="complete"
        >
          <Icon name="check" size={20} />
          {status === "done" ? "Watched — recorded" : "Mark as watched"}
        </button>
        <button
          type="button"
          className="wfx-kebab__item"
          onClick={() => {
            void fire("skip");
          }}
          disabled={status === "pending" || status === "done"}
          data-wfx-report="skip"
        >
          <Icon name="skip" size={20} />
          Stop and record skip
        </button>
        {message !== null ? (
          <span
            className={`wfx-kebab__note${status === "failed" ? " wfx-kebab__note--error" : ""}`}
            role="status"
            data-wfx-report-status
          >
            {message}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wfx-actionbar" data-wfx-watch-report>
      <button
        type="button"
        className="wfx-btn wfx-btn--sm"
        onClick={() => {
          void fire("complete");
        }}
        disabled={status === "pending" || status === "done"}
        data-wfx-report="complete"
      >
        <Icon name="check" size={18} />
        Mark as watched
      </button>
      <button
        type="button"
        className="wfx-btn wfx-btn--sm wfx-btn--ghost"
        onClick={() => {
          void fire("skip");
        }}
        disabled={status === "pending" || status === "done"}
        data-wfx-report="skip"
      >
        <Icon name="skip" size={18} />
        Stop and record skip
      </button>
      {message !== null ? (
        <span
          className={`wfx-actionbar__status ${status === "failed" ? "wfx-actionbar__status--error" : "wfx-actionbar__status--ok"}`}
          role="status"
          data-wfx-report-status
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
