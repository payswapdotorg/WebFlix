"use client";

/**
 * @wfx/app-web — THE SEARCH FILTERS (R29-B, N23 — the corpus
 * search-anatomy.md dialog grammar, honestly wired).
 *
 * THE CORPUS CHROME: the Filters pill opens the 696px paper dialog (r12,
 * the corpus dialog shadow `rgba(0,0,0,0.15) 0 0 24px 12px`), title
 * "Search filters" + the X close — the same dialog family as the share
 * panel.
 *
 * THE HONEST CONTENT LAW (the frozen law, both directions): a filter
 * option renders ONLY when a real truth backs it —
 * - TYPE (Videos / Shorts) derives from the canonical item types PRESENT
 *   in this result set (the server passes the real counts);
 * - DURATION (Under 3 minutes / 3–20 minutes / Over 20 minutes) derives
 *   from each result's real durationMs;
 * - the corpus's other groups (UPLOAD DATE / FEATURES / PRIORITIZE) have
 *   NO real backing on this host's sources — they are honestly ABSENT,
 *   named by the honest-absence note, never a dead imitation.
 *
 * THE STATE IS THE URL: every option is a link (`?q=…&type=…&duration=…`)
 * — the filter is a server-rendered presentation filter over the REAL
 * result set, shareable, no-JS-friendly, and never a client-side data
 * claim. The active option derives from the applied selection.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import type { SearchFilterSelection } from "@/host/view-models";

/** The filters control's serialized input (server-computed per render). */
export interface SearchFiltersProps {
  /** The query (the links' carried context). */
  readonly query: string;
  /** The APPLIED filter selection (the URL-driven state). */
  readonly filters: SearchFilterSelection;
  /** The UNFILTERED per-type counts (the contextual options' truth). */
  readonly typeCounts: ReadonlyMap<string, number>;
}

/** The corpus dialog's fixed width (the measured 696px). */
const DIALOG_WIDTH = 696;

/** Build the filter link's href (one selection change per link). */
function filterHref(query: string, next: SearchFilterSelection): string {
  const params = new URLSearchParams({ q: query });
  if (next.type !== undefined) params.set("type", next.type);
  if (next.duration !== undefined) params.set("duration", next.duration);
  return `/search?${params.toString()}`;
}

/** The option's target selection: keep the other group, replace/clear this one. */
function targetSelection(
  filters: SearchFilterSelection,
  group: "type" | "duration",
  value: "video" | "short" | "under-3" | "3-20" | "over-20" | null,
): SearchFilterSelection {
  const keep =
    group === "type"
      ? filters.duration !== undefined
        ? { duration: filters.duration }
        : {}
      : filters.type !== undefined
        ? { type: filters.type }
        : {};
  const set =
    value === null
      ? {}
      : group === "type"
        ? { type: value as "video" | "short" }
        : { duration: value as "under-3" | "3-20" | "over-20" };
  return { ...keep, ...set };
}

/** One dialog option row (a real link — the URL is the filter state). */
function FilterOption({
  query,
  filters,
  group,
  value,
  label,
  "data-wfx": dataWfx,
}: {
  readonly query: string;
  readonly filters: SearchFilterSelection;
  /** The option's filter group (which applied value it compares against). */
  readonly group: "type" | "duration";
  /** The option's value (null = the group's clear/"All" row). */
  readonly value: "video" | "short" | "under-3" | "3-20" | "over-20" | null;
  readonly label: string;
  readonly "data-wfx": string;
}): JSX.Element {
  const applied = group === "type" ? filters.type : filters.duration;
  const active = applied === value;
  return (
    <a
      className={`wfx-filtersdialog__option${active ? " wfx-filtersdialog__option--active" : ""}`}
      href={filterHref(query, targetSelection(filters, group, value))}
      aria-current={active ? "true" : undefined}
      data-wfx-filter-option={dataWfx}
    >
      {label}
    </a>
  );
}

/** The search filters control: the Filters pill + the corpus dialog. */
export function SearchFilters(props: SearchFiltersProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape (the keyboard path) + outside click (the pointer path).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent): void => {
      if (panelRef.current !== null && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  const videoCount = props.typeCounts.get("video") ?? 0;
  const shortCount = props.typeCounts.get("short") ?? 0;

  return (
    <div className="wfx-searchbar" data-wfx-search-filters-row>
      <button
        type="button"
        className={`wfx-filterspill${open ? " wfx-filterspill--open" : ""}`}
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-wfx-search-filters
      >
        <Icon name="settings" size={16} />
        Filters
      </button>
      {open ? (
        <div className="wfx-filtersdialog__scrim" data-wfx-filters-scrim>
          {/* The corpus dialog: 696px, r12, the dialog shadow, the title + X. */}
          <div
            ref={panelRef}
            className="wfx-filtersdialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search filters"
            style={{ width: DIALOG_WIDTH }}
            data-wfx-filters-dialog
          >
            <div className="wfx-filtersdialog__header">
              <h2 className="wfx-filtersdialog__title">Search filters</h2>
              <button
                type="button"
                className="wfx-filtersdialog__close"
                aria-label="Cancel"
                onClick={close}
                data-wfx-filters-close
              >
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  style={{ display: "block" }}
                >
                  <path d="M5 5l14 14M19 5 5 19" />
                </svg>
              </button>
            </div>
            <div className="wfx-filtersdialog__groups">
              {/* TYPE — the real canonical types present in this result set. */}
              <section className="wfx-filtersdialog__group" data-wfx-filter-group="type">
                <h3 className="wfx-filtersdialog__grouphead">TYPE</h3>
                <FilterOption
                  query={props.query}
                  filters={props.filters}
                  group="type"
                  value={null}
                  label="All"
                  data-wfx="type-all"
                />
                {videoCount > 0 ? (
                  <FilterOption
                    query={props.query}
                    filters={props.filters}
                    group="type"
                    value="video"
                    label="Videos"
                    data-wfx="type-video"
                  />
                ) : null}
                {shortCount > 0 ? (
                  <FilterOption
                    query={props.query}
                    filters={props.filters}
                    group="type"
                    value="short"
                    label="Shorts"
                    data-wfx="type-short"
                  />
                ) : null}
              </section>
              {/* DURATION — the real durationMs buckets (an item without a
                  duration makes no bucket claim and leaves the filtered
                  set honestly). */}
              <section className="wfx-filtersdialog__group" data-wfx-filter-group="duration">
                <h3 className="wfx-filtersdialog__grouphead">DURATION</h3>
                <FilterOption
                  query={props.query}
                  filters={props.filters}
                  group="duration"
                  value={null}
                  label="Any length"
                  data-wfx="duration-any"
                />
                <FilterOption
                  query={props.query}
                  filters={props.filters}
                  group="duration"
                  value="under-3"
                  label="Under 3 minutes"
                  data-wfx="duration-under-3"
                />
                <FilterOption
                  query={props.query}
                  filters={props.filters}
                  group="duration"
                  value="3-20"
                  label="3 – 20 minutes"
                  data-wfx="duration-3-20"
                />
                <FilterOption
                  query={props.query}
                  filters={props.filters}
                  group="duration"
                  value="over-20"
                  label="Over 20 minutes"
                  data-wfx="duration-over-20"
                />
              </section>
            </div>
            {/* The honest-absence note (the frozen law: no dead imitations
                of the corpus's UPLOAD DATE / FEATURES / PRIORITIZE groups —
                this host's sources carry no upload dates, feature flags,
                or popularity signals to filter by). */}
            <p className="wfx-filtersdialog__absence" data-wfx-filters-absent>
              Only filters with a real truth behind them appear here — this host’s sources carry no
              upload dates, feature flags, or popularity signals to filter by.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
