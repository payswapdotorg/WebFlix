"use client";

/**
 * @wfx/app-web — the home chip bar island (R27-W2).
 *
 * THE CORPUS CHIP BAR (app-shell.md): sticky under the topbar, `All`
 * inverted-active, topic chips 32px radius 8, horizontal scroll with fade
 * masks — and the chips FILTER THE REAL FEED, never decorative. The real
 * categories this host's catalog carries are the canonical types of the
 * feed's own cards (movie / series / episode / video — derived at render
 * time from the ACTUAL cards on the page, so a chip never names a
 * category the feed cannot fill) plus the honest Shorts entry (a link to
 * the real shorts surface — the shelf's own destination).
 *
 * The filtering itself is the seam globals.css owns: the island sets
 * `data-wfx-feed-filter` on the FEED ROOT (the home surface element) and
 * the stylesheet's own rule hides non-matching cards (the grid re-flows;
 * section honesty is untouched — error/empty states never hide). All
 * resets to the full feed. Keyboard operable, 32px chips with >=44px
 * effective targets via padding growth on focus.
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** One real category (derived from the feed's own cards). */
export interface ChipCategory {
  /** The chip's label (title case — the canonical type's own name). */
  readonly label: string;
  /** The filter value (the canonical type, lowercased). */
  readonly value: string;
}

/** The chip bar island. */
export function ChipBar({
  categories,
  shortsHref = "/shorts",
}: {
  /** The REAL categories present in this feed (server-derived). */
  readonly categories: readonly ChipCategory[];
  /** The shorts surface link (the shelf's own destination). */
  readonly shortsHref?: string;
}): JSX.Element {
  const [active, setActive] = useState<string>("all");

  /** Apply one chip: the feed root's data-wfx-feed-filter + the cards'
   * matching marks (CSS answers — see the [data-wfx-feed-filter] rule). */
  const apply = useCallback(
    (value: string): void => {
      setActive(value);
      const root = document.querySelector<HTMLElement>("[data-wfx-feed-root]");
      if (root === null) return;
      root.dataset.wfxFeedFilter = value;
      // Mark every card's active truth (the CSS hides the non-matching).
      const cards = root.querySelectorAll<HTMLElement>("[data-wfx-card-type]");
      for (const card of Array.from(cards)) {
        const type = card.dataset.wfxCardType ?? "";
        card.dataset.wfxCardActive = value === "all" || type === value ? "true" : "false";
      }
    },
    [],
  );

  return (
    <div className="wfx-chipbar" data-wfx-chipbar role="tablist" aria-label="Filter the feed">
      <div className="wfx-chipbar__track">
        <button
          type="button"
          className={`wfx-chip${active === "all" ? " wfx-chip--active" : ""}`}
          onClick={() => {
            apply("all");
          }}
          aria-pressed={active === "all"}
          data-wfx-chip="all"
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category.value}
            type="button"
            className={`wfx-chip${active === category.value ? " wfx-chip--active" : ""}`}
            onClick={() => {
              apply(category.value);
            }}
            aria-pressed={active === category.value}
            data-wfx-chip={category.value}
          >
            {category.label}
          </button>
        ))}
        {/* The honest Shorts chip: the real vertical surface's link. */}
        <a
          className={`wfx-chip${active === "shorts" ? " wfx-chip--active" : ""}`}
          href={shortsHref}
          data-wfx-chip="shorts"
        >
          <Icon name="shorts" size={16} />
          Shorts
        </a>
      </div>
    </div>
  );
}
