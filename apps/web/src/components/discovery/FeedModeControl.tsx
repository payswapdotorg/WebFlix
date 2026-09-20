"use client";

/**
 * @wfx/app-web — the feed-mode control (R21-D, client).
 *
 * The everyday ORIENTATION control of the Home / Watch / Shorts feeds:
 * For you / Following / Your imported feed / Blend (the frozen R21-A
 * vocabulary, the frozen labels — never re-worded). Posting goes to
 * `/api/feed-mode` (the R21-A store's typed transport); the honest
 * answer is the store's — NO optimistic selection:
 *
 * - an unavailable mode is DISCOVERABLE, NOT HIDDEN: its choice renders
 *   (never silently dropped), and choosing it answers the typed refusal
 *   with the recovery next-action (the "Bring your feed" link — the
 *   existing IA, never a new route);
 * - the current selection is the server's next read (the page reloads
 *   from the honest state — the same no-optimism law the source actions
 *   follow);
 * - the selected mode is never silently swapped for another (the store's
 *   report-only law).
 */

import { useCallback, useState, type JSX } from "react";

import type { FeedModeView } from "@/host/discoverability";

/** One typed refusal the store answered (rendered with its recovery). */
interface FeedModeRefusal {
  readonly detail: string;
  readonly recoveryHint: string;
}

export function FeedModeControl({
  view,
  compact = false,
}: {
  /** The feed-mode view (the current mode + every choice). */
  readonly view: FeedModeView;
  /** The compact variant (Watch / Shorts headers; fewer chrome words). */
  readonly compact?: boolean;
}): JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<FeedModeRefusal | null>(null);

  const select = useCallback(async (mode: string) => {
    setPending(mode);
    setRefusal(null);
    try {
      const response = await fetch("/api/feed-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          failure?: { recoveryHint?: string };
        } | null;
        setRefusal({
          detail: body?.error ?? "that mode cannot be honored right now",
          recoveryHint: body?.failure?.recoveryHint ?? "bring your feed from Settings to unlock it",
        });
      } else if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setRefusal({
          detail: body?.error ?? "the mode could not be changed",
          recoveryHint: "",
        });
      } else {
        // Re-render from the server's honest next state (no optimism).
        if (typeof window !== "undefined") window.location.reload();
      }
    } catch (thrown) {
      setRefusal({
        detail: thrown instanceof Error ? thrown.message : "the mode could not be changed",
        recoveryHint: "",
      });
    } finally {
      setPending(null);
    }
  }, []);

  return (
    <div
      className="wfx-disc__feedmode"
      data-wfx-feed-mode-control
      data-wfx-feed-mode-selected={view.mode}
      role="group"
      aria-label="Feed mode"
    >
      {!compact ? (
        <p className="wfx-disc__label">What your feed shows</p>
      ) : null}
      <div className="wfx-disc__feedmode-options" role="radiogroup" aria-label="Feed mode">
        {view.options.map((option) => {
          const selected = option.id === view.mode;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`wfx-disc__modechip${selected ? " wfx-disc__modechip--active" : ""}${
                option.available ? "" : " wfx-disc__modechip--unavailable"
              }`}
              data-wfx-feed-mode-option={option.id}
              data-wfx-feed-mode-available={option.available ? "true" : "false"}
              {...(selected ? { "data-wfx-feed-mode-current": "true" } : {})}
              disabled={pending !== null}
              title={
                option.available
                  ? option.label
                  : (option.reason ?? option.label)
              }
              onClick={() => {
                void select(option.id);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {refusal !== null ? (
        <div
          className="wfx-disc__refusal"
          data-wfx-feed-mode-refusal
          role="alert"
        >
          <p className="wfx-disc__refusal-detail">{refusal.detail}</p>
          <div className="wfx-disc__refusal-actions">
            <a className="wfx-btn wfx-btn--sm" href="/settings?section=sources">
              Bring your feed
            </a>
            <a className="wfx-disc__link" href="/settings?section=sources">
              Manage feeds in Settings
            </a>
          </div>
        </div>
      ) : null}
      {!compact ? (
        <a className="wfx-disc__link" href={view.manageHref} data-wfx-feed-mode-manage>
          Manage feeds in Settings
        </a>
      ) : null}
    </div>
  );
}
