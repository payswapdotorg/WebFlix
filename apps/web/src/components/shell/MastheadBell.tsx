"use client";

/**
 * @wfx/app-web — THE MASTHEAD NOTIFICATIONS BELL (R30-B, CORPUS §1+§2 —
 * docs/parity-lab/r30/lead-captures/CORPUS.md).
 *
 * THE CORPUS CHROME (§1): the bell button 40x40 (the icon-button shell
 * family) with the unread badge whose text CAPS AT "9+" while the TRUE
 * count surfaces in the document title ("(167) YouTube" — the captured
 * window read badge "9+" + title 167: TWO grammar layers for one
 * datum, both implemented in `bell-grammar.ts` and bound to the REAL
 * notification truth).
 *
 * THE HONEST BINDING (the frozen law, both layers): this host carries
 * NO notification source — the real unread count is the honest ZERO —
 * so no badge paints and the title keeps its base form (never a
 * fabricated "9+", never a fabricated "(167)"). The layers are real
 * mechanisms: a notification source that honestly lands later binds to
 * the same seam.
 *
 * THE PANEL (§2): the corpus panel anatomy — the bold "Notifications"
 * header + the settings gear + the collapse arrow, ~360-400px wide
 * anchored top-right under the bell. WebFlix has (and honestly gains)
 * NO notification source, so the panel renders the HONENT-EMPTY row —
 * the capability-placement row's own frozen empty state ("No
 * notifications yet — follow sources to get them") + the source
 * note — and the row anatomy (unread dot + thumb + bold source/action
 * + grey time + kebab) NEVER renders without rows behind it (never a
 * fabricated notification). The gear row links to the REAL management
 * surface (Settings — where the notification capability's truth lives,
 * settingsManaged: true in the capability row's own grammar).
 */

import { useEffect, useRef, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";
import { bellBadgeText, documentTitleWithCount } from "@/components/shell/bell-grammar";
import type { NotificationTruth } from "@/host/account-chrome";

/**
 * THE PANEL CONTENT (§2) — exported as the sync presentational surface
 * so the grammar is unit-provable (the island's open state stays the
 * browser-level truth, the gear's own pattern). The corpus anatomy:
 * header ("Notifications" + gear + collapse arrow) + the rows-or-empty
 * body. With no notification source, the body is the honest-empty row.
 */
export function BellPanelContent({
  truth,
  onClose,
}: {
  /** The notification truth (the real unread count + the honest lines). */
  readonly truth: NotificationTruth;
  /** The collapse arrow's close action (the island wires it). */
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div className="wfx-bellpanel" role="dialog" aria-label="Notifications" data-wfx-bell-panel>
      <div className="wfx-bellpanel__head">
        <p className="wfx-bellpanel__title" data-wfx-bell-title>
          Notifications
        </p>
        {/* The gear: the notification capability's REAL management entry
            (Settings — the capability row's own settingsManaged grammar). */}
        <a
          className="wfx-bellpanel__iconbtn"
          href="/settings"
          aria-label="Notification settings"
          title="Notification settings — the capability's truth in Settings"
          data-wfx-bell-gear
        >
          <Icon name="settings" size={20} />
        </a>
        {/* The collapse arrow (the corpus header's close control). */}
        <button
          type="button"
          className="wfx-bellpanel__iconbtn"
          onClick={onClose}
          aria-label="Close notifications"
          data-wfx-bell-collapse
        >
          <Icon name="arrowLeft" size={20} />
        </button>
      </div>
      <div className="wfx-bellpanel__body">
        {/* THE HONEST-EMPTY ROW (§2's law: the panel renders only with a
            real notification source; otherwise this row — the
            capability-placement row's own frozen empty state, verbatim). */}
        <p className="wfx-bellpanel__empty" data-wfx-bell-empty>
          {truth.emptyState}
        </p>
        <p className="wfx-bellpanel__note" data-wfx-bell-source-note>
          {truth.sourceNote}
        </p>
        {/* The unread truth rides as data (the two layers' datum — 0
            today; a real source binds here when one exists). */}
        <p className="wfx-bellpanel__note" data-wfx-bell-unread={truth.unread}>
          {truth.unread === 0 ? "No unread notifications." : `${truth.unread} unread.`}
        </p>
      </div>
    </div>
  );
}

/** The masthead bell island: the 40x40 button + the badge layers + the panel. */
export function MastheadBell({ truth }: { readonly truth: NotificationTruth }): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const badge = bellBadgeText(truth.unread);

  // THE TITLE LAYER (§1's second grammar layer): the TRUE count rides
  // the document title as the "(N) " prefix — bound to the real datum
  // (the honest zero keeps the title byte-identical; the layer never
  // fabricates a count).
  useEffect(() => {
    if (truth.unread > 0) {
      document.title = documentTitleWithCount(truth.unread, "WebFlix");
    }
  }, [truth.unread]);

  // The panel's keyboard + outside-pointer close (the gear's own law).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
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

  return (
    <div className="wfx-bell" ref={rootRef} data-wfx-bell={open ? "open" : "closed"}>
      <button
        type="button"
        className="wfx-topbar__guide wfx-bell__button"
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Notifications"
        title="Notifications"
        data-wfx-bell-button
      >
        <Icon name="bell" size={22} />
        {/* THE BADGE LAYER (§1): the cap grammar — 1–9 paints the count,
            10+ paints "9+", 0 paints NOTHING (the honest zero). */}
        {badge !== null ? (
          <span className="wfx-bell__badge" data-wfx-bell-badge aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <BellPanelContent
          truth={truth}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
