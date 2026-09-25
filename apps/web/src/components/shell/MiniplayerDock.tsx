"use client";

/**
 * @wfx/app-web — THE MINIPLAYER DOCK (R29-B, N25 — the corpus
 * FEATURE-INVENTORY.md miniplayer anatomy, honestly wired).
 *
 * THE CORPUS GRAMMAR: the miniplayer ("i" key or the player's own
 * miniplayer control) docks the CURRENT playback as a bottom-right
 * floating player that PERSISTS across navigation — the item keeps
 * playing in the corner on every surface.
 *
 * THE HONEST MECHANISM (a multi-page app's truth, never a fabricated
 * SPA): the dock state lives in sessionStorage (`wfx-miniplayer` — the
 * player href + title); every page's shell mounts this dock island,
 * which renders the floating 400×225 stage (the SAME /player route in
 * its compact `&miniplayer=1` form) from the LAST REPORTED position.
 * The compact player inside the dock iframe is same-origin and shares
 * this tab's sessionStorage — it advances the stored position as it
 * plays, so each navigation resumes from the real position (the
 * honest continuation; the iframe itself re-mounts per page — the MPA
 * truth, never claimed otherwise).
 *
 * THE REPLACE RULE (YouTube's own law): opening a DIFFERENT item on
 * the main player surface replaces the dock — the dock clears itself
 * when the page it lands on is a player surface playing another item;
 * when the main surface plays the SAME item, the entry survives (the
 * "i" press that docked it).
 *
 * The dock carries REAL controls only: the title (this dock's own
 * item), the expand action (back to the full player surface at the
 * current position), and the close action (clears the dock). Never a
 * dead widget.
 */

import { useEffect, useState, type JSX } from "react";

/** The dock's sessionStorage vocabulary. */
const DOCK_KEY = "wfx-miniplayer";

/** The stored dock state (the player href + the live position). */
interface DockState {
  readonly href: string;
  readonly title: string;
  readonly positionMs: number;
}

/** Read the dock state (null when absent/corrupt — never a guess). */
function readDock(): DockState | null {
  try {
    const raw = sessionStorage.getItem(DOCK_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<DockState>;
    if (
      typeof parsed.href !== "string" ||
      parsed.href.length === 0 ||
      typeof parsed.title !== "string"
    ) {
      return null;
    }
    return {
      href: parsed.href,
      title: parsed.title,
      positionMs: typeof parsed.positionMs === "number" ? parsed.positionMs : 0,
    };
  } catch {
    return null;
  }
}

/** The id param of a player href (the item identity for the replace rule). */
function playerIdOf(href: string): string {
  return new URLSearchParams(href.split("?")[1] ?? "").get("id") ?? "";
}

/** The miniplayer dock island (renders nothing until a dock is stored). */
export function MiniplayerDock(): JSX.Element | null {
  const [dock, setDock] = useState<DockState | null>(null);

  useEffect(() => {
    const current = readDock();
    // THE REPLACE RULE + THE SUPPRESSION (YouTube's own law): a MAIN
    // player surface on this page supersedes the dock — the dock never
    // renders alongside the main stage (never a double player); a
    // DIFFERENT item clears the dock entirely (the new video replaced
    // it); the SAME item keeps the entry (the "i"-press flow: the
    // handler stores the dock then navigates away — this page's own
    // mount must not undo it) while still suppressing the render.
    const mainSurface = document.querySelector<HTMLElement>(
      "main [data-wfx-surface='player'], .wfx-main [data-wfx-surface='player']",
    );
    if (mainSurface !== null) {
      if (current !== null) {
        const pageId =
          new URLSearchParams(window.location.search).get("id") ??
          playerIdOf(window.location.href);
        if (pageId.length > 0 && pageId !== playerIdOf(current.href)) {
          sessionStorage.removeItem(DOCK_KEY);
        }
      }
      setDock(null);
      return;
    }
    setDock(current);
    // The compact player inside the dock advances the stored position
    // (same-origin sessionStorage) — re-read on return to this tab so
    // the title row never goes stale after an in-dock position change.
    const onVisible = (): void => {
      setDock(readDock());
    };
    window.addEventListener("focus", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  if (dock === null) return null;
  // The compact stage src: the stored player href + the compact flag.
  const srcHref = dock.href.includes("?")
    ? `${dock.href}&miniplayer=1`
    : `${dock.href}?miniplayer=1`;
  // The expand destination: the full player surface at the live position.
  const expandUrl = new URL(dock.href, window.location.origin);
  const position = readDock()?.positionMs ?? dock.positionMs;
  if (position > 0) expandUrl.searchParams.set("resume", String(Math.round(position)));
  expandUrl.searchParams.delete("miniplayer");
  return (
    <aside className="wfx-dock" data-wfx-miniplayer aria-label={`Miniplayer: ${dock.title}`}>
      <div className="wfx-dock__head">
        <span className="wfx-dock__title" data-wfx-miniplayer-title>
          {dock.title}
        </span>
        <a
          className="wfx-dock__action"
          href={expandUrl.pathname + expandUrl.search}
          aria-label="Expand (back to the full player)"
          data-wfx-miniplayer-expand
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ display: "block" }}>
            <path d="M14 4h6v6M20 4l-8.5 8.5" />
            <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
        <button
          type="button"
          className="wfx-dock__action"
          aria-label="Close miniplayer"
          onClick={() => {
            sessionStorage.removeItem(DOCK_KEY);
            setDock(null);
          }}
          data-wfx-miniplayer-close
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ display: "block" }}>
            <path d="M5 5l14 14M19 5 5 19" />
          </svg>
        </button>
      </div>
      <iframe
        className="wfx-dock__stage"
        src={srcHref}
        title={`Miniplayer: ${dock.title}`}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        data-wfx-miniplayer-stage
      />
    </aside>
  );
}
