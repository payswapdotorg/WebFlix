"use client";

/**
 * @wfx/app-web — THE PLAYLIST CONTROLS (R30-B, CORPUS §8/§9 —
 * docs/parity-lab/r30/lead-captures/CORPUS.md).
 *
 * THE CORPUS GRAMMAR (§8 — the Watch-later playlist page's header
 * panel): two pill buttons — "Play all" (white) + "Shuffle" (dark) —
 * and (§9 — the Liked page) the sort chips row: All (selected) ·
 * Videos · Shorts.
 *
 * THE HONEST BACKING (the real seams, never decorative):
 *
 * - PLAY ALL seeds the session's REAL queue (POST /api/queue — the
 *   same typed queue store the player's up-next rail renders) with
 *   every playlist entry whose source identity this process joined,
 *   then navigates to the FIRST entry's own player surface — the same
 *   one-click-play law the cards carry. An entry without a joined
 *   identity cannot be queued (the store's own typed validation) and
 *   is honestly skipped — the unavailable-notice row above the list
 *   names that count (the Library surface's own grammar).
 * - SHUFFLE performs the same real seeding over a SHUFFLED order (a
 *   real Fisher-Yates shuffle — the set is exactly the playlist's
 *   joinable entries, the order is random each click) and navigates
 *   to the shuffled first.
 * - THE SORT CHIPS filter the playlist's rows by the entries' REAL
 *   canonical types — the home chip bar's own seam (the island sets
 *   the filter datum on the section root; globals.css hides the
 *   non-matching rows; the CSS re-flow, never a re-render). A chip
 *   renders ONLY for a type the playlist actually carries (the
 *   ChipBar law: a chip never names a category the feed cannot fill).
 */

import { useCallback, useRef, useState, type JSX } from "react";

import { playerHref } from "@/app/href";

/** One queueable playlist target (the joined entry's own fields). */
export interface PlaylistTarget {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
}

/** The sort-chip vocabulary (§9): All + the real types the list carries. */
export interface PlaylistChip {
  /** The chip's label (the corpus row: "Videos" / "Shorts"). */
  readonly label: string;
  /** The filter value (the canonical type). */
  readonly value: string;
}

/** One typed queue-seed outcome (rendered verbatim, never a fake success). */
interface SeedOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The real Fisher-Yates shuffle (in-place over a copy — the set is exact). */
export function shuffled<T>(entries: readonly T[]): T[] {
  const copy = [...entries];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

/** The playlist controls island: the Play all + Shuffle pills + the sort chips. */
export function PlaylistControls({
  listName,
  targets,
  chips,
}: {
  /** The playlist's own name (the pills' aria context). */
  readonly listName: string;
  /** The playlist's JOINED entries (the queueable set — the unavailable ones never reach here). */
  readonly targets: readonly PlaylistTarget[];
  /** The sort chips (All + the real types the list carries). */
  readonly chips: readonly PlaylistChip[];
}): JSX.Element {
  const [active, setActive] = useState("all");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<SeedOutcome | null>(null);
  // The island's own root (the chip filter targets THIS playlist's section —
  // the closest ancestor section, never a querySelector's first match).
  const rootRef = useRef<HTMLDivElement | null>(null);

  /** Seed the queue with the entries in the given order, then navigate to the first. */
  const seedAndPlay = useCallback(
    async (order: readonly PlaylistTarget[]): Promise<void> => {
      if (order.length === 0) {
        setOutcome({ ok: false, detail: "Nothing playable in this list yet — save something first." });
        return;
      }
      setPending(true);
      try {
        // The REAL queue writes (one typed POST per entry — the store's
        // own seam; duplicate adds are idempotent moves, the familiar
        // queue semantics).
        for (const target of order) {
          const response = await fetch("/api/queue", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "add", entry: target }),
          });
          if (!response.ok) {
            setOutcome({
              ok: false,
              detail: `The queue refused '${target.title}' — nothing else was queued past it.`,
            });
            return;
          }
        }
        // Navigate to the order's first entry's own player surface (the
        // one-click-play law — the same href every card carries).
        window.location.assign(playerHref(order[0]!));
      } catch {
        setOutcome({ ok: false, detail: "The queue could not be reached — nothing was played." });
      } finally {
        setPending(false);
      }
    },
    [],
  );

  /** Apply one chip: the island's OWN playlist section carries the filter
   * datum (the ChipBar's CSS-seam pattern — the section root, found by
   * closest(), never a document-wide query that could hit another list). */
  const applyChip = useCallback((value: string): void => {
    setActive(value);
    const section = rootRef.current?.closest<HTMLElement>("[data-wfx-playlist]");
    if (section !== null && section !== undefined) {
      section.dataset.wfxPlaylistFilter = value;
    }
  }, []);

  return (
    <div className="wfx-plcontrols" ref={rootRef} data-wfx-playlist-controls>
      {/* §8 — THE PILLS: "Play all" (white) + "Shuffle" (dark) — the real
          queue seeding + the first entry's player surface. */}
      <div className="wfx-plcontrols__pills">
        <button
          type="button"
          className="wfx-plcontrols__playall"
          disabled={pending}
          onClick={() => {
            setOutcome(null);
            void seedAndPlay(targets);
          }}
          data-wfx-playlist-playall={listName}
        >
          <span aria-hidden="true">▶</span>
          <span>Play all</span>
        </button>
        <button
          type="button"
          className="wfx-plcontrols__shuffle"
          disabled={pending}
          onClick={() => {
            setOutcome(null);
            void seedAndPlay(shuffled(targets));
          }}
          data-wfx-playlist-shuffle={listName}
        >
          <span aria-hidden="true">⇄</span>
          <span>Shuffle</span>
        </button>
      </div>
      {/* §9 — THE SORT CHIPS: All (selected) + the real types the list
          carries; the filter datum on the section root (CSS re-flow). */}
      {chips.length > 0 ? (
        <div className="wfx-plcontrols__chips" role="tablist" aria-label="Sort playlist">
          <button
            type="button"
            className={`wfx-plchip${active === "all" ? " wfx-plchip--on" : ""}`}
            role="tab"
            aria-selected={active === "all"}
            onClick={() => {
              applyChip("all");
            }}
            data-wfx-playlist-chip="all"
          >
            All
          </button>
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`wfx-plchip${active === chip.value ? " wfx-plchip--on" : ""}`}
              role="tab"
              aria-selected={active === chip.value}
              onClick={() => {
                applyChip(chip.value);
              }}
              data-wfx-playlist-chip={chip.value}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
      {outcome !== null ? (
        <p className="wfx-plcontrols__outcome" role="alert" data-wfx-playlist-outcome>
          {outcome.detail}
        </p>
      ) : null}
    </div>
  );
}
