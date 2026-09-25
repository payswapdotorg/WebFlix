/**
 * @wfx/app-web — the keyboard shortcuts sheet (R29-B's gear subpage,
 * extracted R30-B as the ONE shared real surface).
 *
 * THE REAL KEY SET: every row is a bound key on the player surface (the
 * transport the gear's own subpage documented — the extraction is the
 * corpus account-menu row 11's backing: the same sheet, two entries,
 * one truth). The account menu (CORPUS §3 row 11 "Keyboard shortcuts")
 * opens THIS sheet; the settings gear keeps its own entry into it.
 *
 * The extraction changed nothing: the SHORTCUTS rows and the rendering
 * are the gear's own, verbatim (the seam law — no redesign, one shared
 * module instead of a private copy).
 */

import type { JSX } from "react";

/** The shortcuts sheet's REAL key set (every row is a bound key on the player surface). */
export const SHORTCUTS: ReadonlyArray<{ readonly keys: string; readonly action: string }> = [
  { keys: "Space / K", action: "Play or pause" },
  { keys: "J / L", action: "Back or forward 10 seconds" },
  { keys: "← / →", action: "Back or forward 5 seconds" },
  { keys: "↑ / ↓", action: "Volume up or down" },
  { keys: "0–9", action: "Jump to 0%–90%" },
  { keys: "M", action: "Mute" },
  { keys: "F", action: "Fullscreen" },
  { keys: "T", action: "Theater view" },
  { keys: "I", action: "Miniplayer" },
  { keys: "C", action: "Captions" },
  { keys: "?", action: "The player's shortcut sheet" },
];

/** The shared shortcuts sheet body (the key rows + the player-surface note). */
export function ShortcutsSheetBody(): JSX.Element {
  return (
    <>
      <dl className="wfx-gear__keys" data-wfx-gear-shortcuts>
        {SHORTCUTS.map((entry) => (
          <div key={entry.keys}>
            <dt>{entry.keys}</dt>
            <dd>{entry.action}</dd>
          </div>
        ))}
      </dl>
      <p className="wfx-gear__absence">
        The keys are the player surface&apos;s transport — they are live wherever a player
        stage is the active surface.
      </p>
    </>
  );
}
